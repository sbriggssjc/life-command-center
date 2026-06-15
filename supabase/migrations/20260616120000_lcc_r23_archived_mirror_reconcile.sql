-- R23 (2026-06-16): teach the R22 mirror reconcile to prune SOFT-ARCHIVED gov
-- properties, not just hard-gone ones.
--
-- R22 pruned the genuinely-gone orphans (834 rows) and DELIBERATELY kept gov's
-- soft-archived rows. But ~6,662 archived gov properties (~35% of the gov
-- mirror) carry full attributes (rent) in lcc_property_attributes and feed the
-- R17 connected-value tier, the representative-property rent fallback, and the
-- queue / Decision-Center value ranking. The gov anon view the syncs read
-- (v_property_attributes_portfolio) ALREADY excludes archived, so once a synced
-- property is archived in gov it is never refreshed AND never returned for
-- removal — permanently stale in the mirror, quietly inflating 35% of the gov
-- value signal (a gov owner who SOLD / merged / archived properties still ranks
-- by those dead assets). dia HARD-deletes on merge, so dia has no equivalent
-- soft-archived class (R22 already handles dia) — this is gov-specific.
--
-- Doctrine: archived = NOT a current BD asset. Exclude it from the LCC value-
-- ranking mirror. The owner RELATIONSHIP persists via their ACTIVE properties;
-- archived assets just shouldn't inflate the value math. So we treat archived
-- like gone FOR THE MIRROR. An owner whose properties are ALL archived correctly
-- drops to no-portfolio-value (NULLS-LAST) — that is right (no current assets).
--
-- Implementation (recommended approach #1 in the R23 ask): the domain census
-- views now carry `status` (gov real status; dia constant NULL). This reconcile
-- builds its KEEP set as "every census id whose status IS DISTINCT FROM
-- 'archived'" and an ARCHIVED set for reason-tagging. The existing anti-join
-- ("mirror row whose source_property_id is NOT in the keep set") then prunes
-- BOTH archived AND hard-gone rows in one pass — reusing all of R22's machinery
-- (paged fetch, completeness/sanity guards, reversible snapshot, crons). gov
-- 'cmbs_discovery' (38) + 'inactive' (2) are KEPT — only 'archived' is excluded.
--
-- SAFE BY CONSTRUCTION (R22 guards, refined for the two prune reasons):
--   * completeness — every fired page HTTP 200 AND the max-offset page came back
--     EMPTY (proves the full census was paged); given that, BOTH the archived
--     flag and the hard-gone classification are trustworthy.
--   * sanity floor — assembled KEEP-id count >= p_min_live (1000).
--   * hard-gone anomaly cap (p_max_prune_frac, default 0.5) applies to the
--     HARD-GONE class only — the truncation-risk class (a census view narrowed
--     by accident would make rows look absent). A legitimate ~35% archived prune
--     no longer trips this cap.
--   * archived backstop (constant 0.95) — refuse if a mirror's archived-orphan
--     share is implausibly high (a census redefinition that flags everything
--     archived); archived is otherwise census-authoritative and bounded.
-- Any guard failure SKIPS that mirror's prune (mirror untouched). The upsert
-- syncs are untouched, so a skipped reconcile only ever costs staleness, never
-- correctness. dia stays byte-identical to R22 (its archived set is empty).
--
-- DEPLOY ORDERING: apply the gov + dia census-status views FIRST
-- (government/20260616_gov_r23_property_id_census_status.sql +
-- dialysis/20260616_dia_r23_property_id_census_status.sql). If a census view
-- still lacks `status`, the new fetch's `select=...,status` 400s -> the
-- completeness guard fails -> no prune (graceful, the cache-or-live pattern).
-- Everything here is additive / idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Fetch: page the id+status census per domain. Same signature/returns as
--    R22; the only change is the census select now carries `status`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_reconcile_mirrors_fetch(p_domain text DEFAULT 'both')
RETURNS TABLE(domain text, pages_fired int) AS $$
DECLARE
  v_url        text;
  v_anon_key   text;
  v_page       int;
  v_request_id bigint;
  v_pages_fired int;
  v_domain     text;
  v_domains    text[];
  v_page_size  int := 1000;   -- PostgREST hard cap; larger strides silently skip
  v_max_pages  int := 30;     -- 31 pages * 1000 = 31k cap; domains ~12-19k (headroom)
BEGIN
  IF p_domain = 'both' THEN
    v_domains := ARRAY['dia','gov'];
  ELSE
    v_domains := ARRAY[p_domain];
  END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    IF v_domain NOT IN ('dia','gov') THEN
      RAISE NOTICE 'lcc_reconcile_mirrors_fetch(%): unknown domain, skipping', v_domain;
      CONTINUE;
    END IF;

    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_url';
    SELECT decrypted_secret INTO v_anon_key
    FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_anon_key';

    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_reconcile_mirrors_fetch(%): missing vault secret, skipping', v_domain;
      CONTINUE;
    END IF;

    v_pages_fired := 0;
    FOR v_page IN 0..v_max_pages LOOP
      SELECT net.http_get(
        url := v_url || '/rest/v1/v_property_id_census'
          || '?select=property_id,status'
          || '&order=property_id.asc'
          || '&limit=' || v_page_size || '&offset=' || (v_page * v_page_size),
        headers := jsonb_build_object('apikey', v_anon_key, 'Authorization', 'Bearer ' || v_anon_key)
      ) INTO v_request_id;

      INSERT INTO public.lcc_mirror_reconcile_inflight (request_id, source_domain, page_offset, page_size)
      VALUES (v_request_id, v_domain, v_page * v_page_size, v_page_size);

      v_pages_fired := v_pages_fired + 1;
    END LOOP;

    domain := v_domain;
    pages_fired := v_pages_fired;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_reconcile_mirrors_fetch(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Apply: assemble the KEEP id set (status != 'archived') + the ARCHIVED set,
--    guard, anti-join + prune (or count). Returns gain orphans_gone /
--    orphans_archived so a dry-run shows the split. DROP first because the
--    RETURNS TABLE shape changes (CREATE OR REPLACE can't widen it). The cron
--    command `SELECT lcc_reconcile_mirrors_apply(false)` is unaffected (it
--    resolves by name+args and ignores the result rows).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lcc_reconcile_mirrors_apply(boolean, text[], int, numeric);

CREATE FUNCTION public.lcc_reconcile_mirrors_apply(
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
  v_note       text := 'r23_reconcile ' || to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS');
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
    -- ARCHIVED set for this domain. Together they partition the complete census:
    -- a census id is in exactly one (every non-archived id -> keep; every
    -- 'archived' id -> archived). A mirror row absent from BOTH is hard-gone.
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

    -- Sanity floor: never reconcile against a suspiciously tiny KEEP set.
    IF v_live < p_min_live THEN
      domain := v_domain; mirror := '(all)'; live_ids := v_live; orphans_found := 0;
      orphans_deleted := 0; orphans_gone := 0; orphans_archived := 0;
      status := 'skipped_below_min_live';
      RETURN NEXT;
      -- leave inflight for retry/age-out
      CONTINUE;
    END IF;

    -- Walk each property-keyed mirror.
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
        -- Hard-gone anomaly: too many rows absent from the census entirely.
        -- Smells like a truncated/narrowed census view -> refuse the whole prune.
        v_status := 'skipped_anomaly_over_frac';
      ELSIF v_mirror_rows > 0 AND v_orphans_arch > (c_max_archived_frac * v_mirror_rows) THEN
        -- Archived backstop: a census that flags ~everything archived is suspect.
        v_status := 'skipped_anomaly_archived';
      ELSIF p_dry_run THEN
        v_status := 'dry_run';
      ELSE
        -- Snapshot then delete (reversible). Reason-tag each snapshot row.
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

    -- Done with this domain: clear its inflight rows + the consumed responses.
    -- Only on a real run — a dry-run is non-destructive (repeatable; leaves the
    -- census for a follow-up real apply). Stale dry-run inflight ages out below.
    IF NOT p_dry_run THEN
      DELETE FROM net._http_response r
      USING public.lcc_mirror_reconcile_inflight i
      WHERE i.request_id = r.id AND i.source_domain = v_domain;
      DELETE FROM public.lcc_mirror_reconcile_inflight WHERE source_domain = v_domain;
    END IF;
  END LOOP;

  -- Age-out any inflight rows left by an incomplete pass (retry already covered
  -- by the next fetch; this just bounds the tracker).
  DELETE FROM public.lcc_mirror_reconcile_inflight WHERE issued_at < now() - interval '6 hours';

  -- Keep planner stats fresh on the pruned mirrors (R6 ANALYZE lesson).
  IF NOT p_dry_run THEN
    ANALYZE public.lcc_property_attributes;
    ANALYZE public.lcc_property_owner_facts;
    ANALYZE public.lcc_entity_portfolio_facts;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_reconcile_mirrors_apply(boolean, text[], int, numeric) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Crons unchanged from R22 (fetch 05:10, apply REAL 05:15). Re-register
--    idempotently so a replay/rebuild keeps them bound to the current functions.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-mirror-reconcile-fetch') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-mirror-reconcile-fetch');
    PERFORM cron.unschedule('lcc-mirror-reconcile-apply') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-mirror-reconcile-apply');
    PERFORM cron.schedule('lcc-mirror-reconcile-fetch', '10 5 * * *', $$SELECT public.lcc_reconcile_mirrors_fetch('both')$$);
    PERFORM cron.schedule('lcc-mirror-reconcile-apply', '15 5 * * *', $$SELECT public.lcc_reconcile_mirrors_apply(false)$$);
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule lcc_reconcile_mirrors_fetch/apply manually.';
  END IF;
END $cron$;

COMMIT;
