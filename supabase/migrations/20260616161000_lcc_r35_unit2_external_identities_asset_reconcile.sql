-- R35 Unit 2 + 3 (2026-06-16): teach the R22/R23 mirror reconcile to also prune
-- ORPHANED external_identities ASSET rows — the one table R22/R23 never covered.
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq).
--
-- WHY (AUDIT 2026-06-16): R22/R23 reconcile the property-keyed value mirrors
-- (lcc_property_attributes / _owner_facts / lcc_entity_portfolio_facts) against
-- the domain census, but external_identities asset rows — the ENTITY-GRAPH
-- linkage between a property-anchor entity and its domain property — were never
-- reconciled on a domain merge/delete. Grounding found dia asset rows that no
-- longer resolve to a dia property (dia HARD-deletes on merge; the asset link
-- was never cleaned) plus a few malformed UUID external_ids (a UUID is never a
-- valid property_id). gov asset rows are mostly NOT orphans — active gov
-- properties are present in the all-status census and are KEPT.
--
-- DOCTRINE DIFFERENCE vs R23 (important): R23 prunes SOFT-ARCHIVED gov rows from
-- the VALUE-ranking mirrors (archived assets shouldn't inflate value math). The
-- entity-graph linkage is different: an archived property's entity-link is still
-- meaningful history and is NOT pruned. So the external_identities asset prune
-- uses the FULL ALL-STATUS census as its KEEP set (every census id, incl
-- status='archived'); it removes ONLY rows whose external_id is absent from the
-- census entirely (hard-gone) OR malformed (UUID). This reuses R23's already-
-- assembled temp sets: KEEP = _r22_live (non-archived) UNION _r23_archived.
--
-- R35 Unit 1 (migration 20260616160000) retyped the 345 dia CCN-mislabel rows to
-- (source_system='cms', source_type='medicare_ccn') BEFORE this runs, so they no
-- longer match (source_system in (dia,gov) AND source_type='asset') and cannot
-- be falsely pruned. The 14 real 6-digit dia property_ids are present in the
-- census and KEPT.
--
-- SAFE BY CONSTRUCTION (reuses every R22/R23 guard):
--   * completeness: every fired census page HTTP 200 AND the max-offset page
--     came back EMPTY (proves the full census was paged).
--   * sanity floor: assembled KEEP count >= p_min_live (1000).
--   * anomaly cap: never prune more than p_max_prune_frac (0.5) of a mirror's
--     rows in one pass — a truncated census is skipped, never applied.
--   * reversible: every pruned row is snapshotted to
--     lcc_mirror_reconcile_deletions (full to_jsonb row incl entity_id /
--     source_system / source_type) BEFORE the DELETE.
-- Any guard failure SKIPS the prune (untouched); the upsert writers are
-- separate, so a skipped reconcile only costs staleness.
--
-- UNIT 3 (forward reconcile): this folds external_identities into the EXISTING
-- daily reconcile (lcc-mirror-reconcile-fetch 05:10 / -apply 05:15), so a future
-- domain merge/delete cleans its asset links automatically — no new cron, no
-- extra pg_net (it consumes the same census fetch).
--
-- CREATE OR REPLACE (signature + RETURNS TABLE shape UNCHANGED from R23 — we
-- only emit additional RETURN NEXT rows with mirror='external_identities_asset').
-- The cron `SELECT lcc_reconcile_mirrors_apply(false)` resolves by name+args and
-- ignores result rows, so it is unaffected.
--
-- DEPLOY ORDERING: apply AFTER R35 Unit 1 (the CCN retype) so the retyped rows
-- are already out of the (dia, asset, *) space. The gov/dia census-status views
-- (R23) are a prerequisite and already live.

BEGIN;

CREATE OR REPLACE FUNCTION public.lcc_reconcile_mirrors_apply(
  p_dry_run          boolean DEFAULT true,
  p_domains          text[]  DEFAULT ARRAY['dia','gov'],
  p_min_live         int     DEFAULT 1000,
  p_max_prune_frac   numeric DEFAULT 0.5
)
RETURNS TABLE(domain text, mirror text, live_ids int, orphans_found int,
              orphans_deleted int, orphans_gone int, orphans_archived int, status text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_domain     text;
  v_fired      int;
  v_responded  int;
  v_tail_empty boolean;
  v_live       int;
  v_census_all int;
  v_note       text := 'r35_reconcile ' || to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS');
  m            record;
  v_mirror_rows int;
  v_orphans     int;
  v_orphans_arch int;
  v_orphans_gone int;
  v_deleted     int;
  v_status      text;
  c_max_archived_frac numeric := 0.95;  -- archived backstop (census-authoritative)
BEGIN
  -- Reusable per-domain staging: KEEP (non-archived live ids) + ARCHIVED ids.
  CREATE TEMP TABLE IF NOT EXISTS _r22_live (pid text PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _r23_archived (pid text PRIMARY KEY) ON COMMIT DROP;

  FOREACH v_domain IN ARRAY p_domains LOOP
    -- How many pages were fired vs how many came back HTTP 200.
    SELECT count(*) INTO v_fired
    FROM public.lcc_mirror_reconcile_inflight WHERE source_domain = v_domain;

    SELECT count(*) INTO v_responded
    FROM public.lcc_mirror_reconcile_inflight i
    JOIN net._http_response r ON r.id = i.request_id
    WHERE i.source_domain = v_domain AND r.status_code = 200;

    -- Completeness guard 1: every fired page must have a 200 response.
    IF v_fired = 0 OR v_responded < v_fired THEN
      domain := v_domain; mirror := '(all)'; live_ids := 0; orphans_found := 0;
      orphans_deleted := 0; orphans_gone := 0; orphans_archived := 0;
      status := 'skipped_incomplete_fetch';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Completeness guard 2: the MAX-offset fired page must have come back EMPTY
    -- (proves we paged past the end of the census — no tail was missed).
    SELECT (jsonb_array_length(r.content::jsonb) = 0) INTO v_tail_empty
    FROM public.lcc_mirror_reconcile_inflight i
    JOIN net._http_response r ON r.id = i.request_id
    WHERE i.source_domain = v_domain AND r.status_code = 200
    ORDER BY i.page_offset DESC
    LIMIT 1;

    IF NOT COALESCE(v_tail_empty, false) THEN
      domain := v_domain; mirror := '(all)'; live_ids := 0; orphans_found := 0;
      orphans_deleted := 0; orphans_gone := 0; orphans_archived := 0;
      status := 'skipped_tail_not_reached';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Assemble the KEEP set (status IS DISTINCT FROM 'archived') and the
    -- ARCHIVED set for this domain. Together they partition the complete census.
    TRUNCATE _r22_live, _r23_archived;

    INSERT INTO _r22_live (pid)
    SELECT DISTINCT (elem->>'property_id')::text
    FROM public.lcc_mirror_reconcile_inflight i
    JOIN net._http_response r ON r.id = i.request_id,
         LATERAL jsonb_array_elements(r.content::jsonb) AS elem
    WHERE i.source_domain = v_domain AND r.status_code = 200
      AND elem->>'property_id' IS NOT NULL
      AND (elem->>'status') IS DISTINCT FROM 'archived'
    ON CONFLICT (pid) DO NOTHING;

    INSERT INTO _r23_archived (pid)
    SELECT DISTINCT (elem->>'property_id')::text
    FROM public.lcc_mirror_reconcile_inflight i
    JOIN net._http_response r ON r.id = i.request_id,
         LATERAL jsonb_array_elements(r.content::jsonb) AS elem
    WHERE i.source_domain = v_domain AND r.status_code = 200
      AND elem->>'property_id' IS NOT NULL
      AND (elem->>'status') = 'archived'
    ON CONFLICT (pid) DO NOTHING;

    SELECT count(*) INTO v_live FROM _r22_live;
    SELECT v_live + (SELECT count(*) FROM _r23_archived) INTO v_census_all;

    -- Sanity floor: never reconcile against a suspiciously tiny KEEP set.
    IF v_live < p_min_live THEN
      domain := v_domain; mirror := '(all)'; live_ids := v_live; orphans_found := 0;
      orphans_deleted := 0; orphans_gone := 0; orphans_archived := 0;
      status := 'skipped_below_min_live';
      RETURN NEXT;
      -- leave inflight for retry/age-out
      CONTINUE;
    END IF;

    -- Walk each property-keyed VALUE mirror (R22/R23: archived excluded).
    FOR m IN
      SELECT * FROM (VALUES
        ('property_attributes', 'public.lcc_property_attributes'),
        ('owner_facts',         'public.lcc_property_owner_facts'),
        ('portfolio_facts',     'public.lcc_entity_portfolio_facts')
      ) AS t(mname, tbl)
    LOOP
      EXECUTE format('SELECT count(*) FROM %s WHERE source_domain = $1', m.tbl)
        INTO v_mirror_rows USING v_domain;

      -- Total orphans = rows NOT in the KEEP set (archived + hard-gone).
      EXECUTE format(
        'SELECT count(*) FROM %s t WHERE t.source_domain = $1 '
        'AND NOT EXISTS (SELECT 1 FROM _r22_live l WHERE l.pid = t.source_property_id)',
        m.tbl
      ) INTO v_orphans USING v_domain;

      -- Of those, how many are explicitly archived (reason split).
      EXECUTE format(
        'SELECT count(*) FROM %s t WHERE t.source_domain = $1 '
        'AND EXISTS (SELECT 1 FROM _r23_archived a WHERE a.pid = t.source_property_id)',
        m.tbl
      ) INTO v_orphans_arch USING v_domain;

      v_orphans_gone := v_orphans - v_orphans_arch;
      v_deleted := 0;

      IF v_orphans = 0 THEN
        v_status := 'clean';
      ELSIF v_mirror_rows > 0 AND v_orphans_gone > (p_max_prune_frac * v_mirror_rows) THEN
        v_status := 'skipped_anomaly_over_frac';
      ELSIF v_mirror_rows > 0 AND v_orphans_arch > (c_max_archived_frac * v_mirror_rows) THEN
        v_status := 'skipped_anomaly_archived';
      ELSIF p_dry_run THEN
        v_status := 'dry_run';
      ELSE
        EXECUTE format(
          'INSERT INTO public.lcc_mirror_reconcile_deletions '
          '(mirror, source_domain, source_property_id, row_snapshot, note) '
          'SELECT %L, t.source_domain, t.source_property_id, to_jsonb(t), '
          '  %L || CASE WHEN EXISTS (SELECT 1 FROM _r23_archived a WHERE a.pid = t.source_property_id) '
          '             THEN '' archived'' ELSE '' hard_gone'' END '
          'FROM %s t WHERE t.source_domain = $1 '
          'AND NOT EXISTS (SELECT 1 FROM _r22_live l WHERE l.pid = t.source_property_id)',
          m.mname, v_note, m.tbl
        ) USING v_domain;

        EXECUTE format(
          'WITH del AS (DELETE FROM %s t WHERE t.source_domain = $1 '
          'AND NOT EXISTS (SELECT 1 FROM _r22_live l WHERE l.pid = t.source_property_id) '
          'RETURNING 1) SELECT count(*) FROM del',
          m.tbl
        ) INTO v_deleted USING v_domain;

        v_status := 'pruned';
      END IF;

      domain := v_domain; mirror := m.mname; live_ids := v_live;
      orphans_found := v_orphans; orphans_deleted := v_deleted;
      orphans_gone := v_orphans_gone; orphans_archived := v_orphans_arch;
      status := v_status;
      RETURN NEXT;
    END LOOP;

    -- ----------------------------------------------------------------------
    -- R35: external_identities ASSET rows (the entity-graph linkage).
    -- KEEP = the FULL all-status census (_r22_live UNION _r23_archived) — an
    -- archived property's entity-link is meaningful history and is NOT pruned.
    -- Prune = asset rows for this domain whose external_id is absent from the
    -- census entirely (hard-gone property) OR is a malformed non-property id
    -- (e.g. a UUID — never a valid property_id, also naturally absent from the
    -- census). source_type='asset' + source_system=v_domain excludes vendor
    -- rows and the R35 Unit-1 retyped (cms, medicare_ccn) rows automatically.
    -- ----------------------------------------------------------------------
    SELECT count(*) INTO v_mirror_rows
    FROM public.external_identities
    WHERE source_system = v_domain AND source_type = 'asset';

    SELECT count(*) INTO v_orphans
    FROM public.external_identities ei
    WHERE ei.source_system = v_domain AND ei.source_type = 'asset'
      AND NOT EXISTS (SELECT 1 FROM _r22_live l WHERE l.pid = ei.external_id)
      AND NOT EXISTS (SELECT 1 FROM _r23_archived a WHERE a.pid = ei.external_id);

    v_deleted := 0;
    v_orphans_arch := 0;        -- archived is KEPT for the entity graph (N/A here)
    v_orphans_gone := v_orphans;

    IF v_orphans = 0 THEN
      v_status := 'clean';
    ELSIF v_mirror_rows > 0 AND v_orphans > (p_max_prune_frac * v_mirror_rows) THEN
      v_status := 'skipped_anomaly_over_frac';
    ELSIF p_dry_run THEN
      v_status := 'dry_run';
    ELSE
      -- Snapshot (reversible) then delete. Reason-tag each row: a UUID-shaped
      -- external_id is 'malformed_uuid', anything else absent is 'hard_gone'.
      INSERT INTO public.lcc_mirror_reconcile_deletions
        (mirror, source_domain, source_property_id, row_snapshot, note)
      SELECT 'external_identities_asset', v_domain, ei.external_id, to_jsonb(ei),
             v_note || CASE
               WHEN ei.external_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F-]{20,}$'
                 OR ei.external_id !~ '^[0-9]+$'
               THEN ' malformed_uuid' ELSE ' hard_gone' END
      FROM public.external_identities ei
      WHERE ei.source_system = v_domain AND ei.source_type = 'asset'
        AND NOT EXISTS (SELECT 1 FROM _r22_live l WHERE l.pid = ei.external_id)
        AND NOT EXISTS (SELECT 1 FROM _r23_archived a WHERE a.pid = ei.external_id);

      WITH del AS (
        DELETE FROM public.external_identities ei
        WHERE ei.source_system = v_domain AND ei.source_type = 'asset'
          AND NOT EXISTS (SELECT 1 FROM _r22_live l WHERE l.pid = ei.external_id)
          AND NOT EXISTS (SELECT 1 FROM _r23_archived a WHERE a.pid = ei.external_id)
        RETURNING 1
      ) SELECT count(*) INTO v_deleted FROM del;

      v_status := 'pruned';
    END IF;

    domain := v_domain; mirror := 'external_identities_asset'; live_ids := v_census_all;
    orphans_found := v_orphans; orphans_deleted := v_deleted;
    orphans_gone := v_orphans_gone; orphans_archived := v_orphans_arch;
    status := v_status;
    RETURN NEXT;

    -- Done with this domain: clear its inflight rows + the consumed responses.
    IF NOT p_dry_run THEN
      DELETE FROM net._http_response r
      USING public.lcc_mirror_reconcile_inflight i
      WHERE i.request_id = r.id AND i.source_domain = v_domain;
      DELETE FROM public.lcc_mirror_reconcile_inflight WHERE source_domain = v_domain;
    END IF;
  END LOOP;

  -- Age-out any inflight rows left by an incomplete pass.
  DELETE FROM public.lcc_mirror_reconcile_inflight WHERE issued_at < now() - interval '6 hours';

  -- Keep planner stats fresh on the pruned mirrors (R6 ANALYZE lesson).
  IF NOT p_dry_run THEN
    ANALYZE public.lcc_property_attributes;
    ANALYZE public.lcc_property_owner_facts;
    ANALYZE public.lcc_entity_portfolio_facts;
    ANALYZE public.external_identities;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_reconcile_mirrors_apply(boolean, text[], int, numeric) FROM PUBLIC;

COMMIT;
