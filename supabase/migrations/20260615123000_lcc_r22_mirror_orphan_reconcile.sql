-- R22 (2026-06-15): cross-DB mirror deletion propagation (orphan reconcile).
--
-- The dia/gov -> LCC mirror syncs (lcc_sync_property_attributes,
-- lcc_sync_property_owner_facts, lcc_sync_entity_portfolios) are insert/update-
-- only: they never DELETE a mirror row when its source property is merged/removed
-- in the domain's dedup work. Result (grounded live 2026-06-15): the property-
-- keyed LCC mirrors accumulate orphans whose (source_domain, source_property_id)
-- no longer exists in the domain. dia hard-deletes on merge -> ~782
-- lcc_property_attributes orphans; gov is the same shape for genuine hard
-- deletes.
--
-- This migration adds a deletion-aware reconcile that prunes only rows that are
-- GENUINELY GONE from the domain (a hard delete), using an all-status id-only
-- census view per domain (gov/dia v_property_id_census). gov SOFT-archives merged
-- properties (status='archived'); those rows still exist in the census and are
-- DELIBERATELY KEPT here (the audit's intent: "genuinely gone, not soft state").
-- The archived-but-anon-view-filtered rows are a separate concern (see the R22
-- changelog note) — this round does not bulk-delete soft state.
--
-- Mechanism (the existing cross-DB pg_net read path, paged at 1000/page — the
-- PostgREST 1000-row cap lesson):
--   * lcc_reconcile_mirrors_fetch(domain)  fans paged id-only GETs of the census
--     into lcc_mirror_reconcile_inflight.
--   * lcc_reconcile_mirrors_apply(dry_run)  assembles the full live id set, runs
--     completeness + sanity + anomaly guards, then anti-joins each property-keyed
--     mirror and prunes confirmed orphans (snapshotted to a backup table first,
--     so the delete is reversible).
--
-- SAFE BY CONSTRUCTION — a partial/failed census fetch can never mass-delete:
--   1. completeness: every fired page returned HTTP 200 AND the max-offset page
--      came back EMPTY (proves we paged past the end of the census).
--   2. sanity floor: assembled live id count >= p_min_live (default 1000).
--   3. anomaly cap: never prune a mirror by more than p_max_prune_frac of its
--      rows (default 0.5) in one pass — a source regression (e.g. a view that
--      suddenly returns a truncated set) is skipped + logged, never applied.
-- Any guard failure SKIPS the prune for that domain/mirror (mirror untouched);
-- the upsert syncs are entirely separate, so a skipped reconcile only ever costs
-- staleness, never correctness. dia/gov pipelines are untouched.
--
-- DEPLOY ORDERING: apply AFTER the domain census views
-- (government/20260615_gov_r22_property_id_census.sql +
-- dialysis/20260615_dia_r22_property_id_census.sql). If a census view is absent
-- the fetch pages 404 -> the completeness guard fails -> no prune (graceful, the
-- cache-or-live pattern). Everything here is additive.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. pg_net request tracking for the census id-set pull.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_mirror_reconcile_inflight (
  request_id    bigint PRIMARY KEY,
  source_domain text   NOT NULL CHECK (source_domain IN ('dia','gov')),
  page_offset   int    NOT NULL,
  page_size     int    NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_mirror_reconcile_inflight IS
  'R22: pg_net request_ids issued by lcc_reconcile_mirrors_fetch() for '
  'lcc_reconcile_mirrors_apply() to assemble the live domain id census from.';

-- ---------------------------------------------------------------------------
-- 2. Reversible backup of every pruned orphan row (full snapshot). Small +
--    append-only; the audit trail / undo path for the reconcile.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_mirror_reconcile_deletions (
  id                 bigserial PRIMARY KEY,
  reconciled_at      timestamptz NOT NULL DEFAULT now(),
  mirror             text NOT NULL,   -- property_attributes | owner_facts | portfolio_facts
  source_domain      text NOT NULL,
  source_property_id text NOT NULL,
  row_snapshot       jsonb NOT NULL,
  note               text
);

CREATE INDEX IF NOT EXISTS idx_lcc_mirror_reconcile_deletions_key
  ON public.lcc_mirror_reconcile_deletions(mirror, source_domain, source_property_id);

COMMENT ON TABLE public.lcc_mirror_reconcile_deletions IS
  'R22: full snapshot of every mirror row pruned as a confirmed orphan. '
  'Reversible undo path; bounded (only genuine orphans).';

-- Keep churn reclaimed (full-replace nothing here, but bound growth).
ALTER TABLE public.lcc_mirror_reconcile_deletions
  SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);

-- ---------------------------------------------------------------------------
-- 3. Fetch: page the all-status id census per domain into the inflight tracker.
--    Reads vault secrets exactly like the sibling syncs; missing secret => skip.
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
          || '?select=property_id'
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
-- 4. Apply: assemble the live id set, guard, anti-join + prune (or count).
--    p_dry_run=true (default) only counts. The cron calls it false.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_reconcile_mirrors_apply(
  p_dry_run          boolean DEFAULT true,
  p_domains          text[]  DEFAULT ARRAY['dia','gov'],
  p_min_live         int     DEFAULT 1000,
  p_max_prune_frac   numeric DEFAULT 0.5
)
RETURNS TABLE(domain text, mirror text, live_ids int, orphans_found int, orphans_deleted int, status text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_domain     text;
  v_fired      int;
  v_responded  int;
  v_tail_empty boolean;
  v_live       int;
  v_note       text := 'r22_reconcile ' || to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS');
  m            record;
  v_mirror_rows int;
  v_orphans     int;
  v_deleted     int;
  v_status      text;
BEGIN
  -- Reusable per-domain live id staging.
  CREATE TEMP TABLE IF NOT EXISTS _r22_live (pid text PRIMARY KEY) ON COMMIT DROP;

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
      orphans_deleted := 0; status := 'skipped_incomplete_fetch';
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
      orphans_deleted := 0; status := 'skipped_tail_not_reached';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Assemble the live id set for this domain.
    TRUNCATE _r22_live;
    INSERT INTO _r22_live (pid)
    SELECT DISTINCT (elem->>'property_id')::text
    FROM public.lcc_mirror_reconcile_inflight i
    JOIN net._http_response r ON r.id = i.request_id,
         LATERAL jsonb_array_elements(r.content::jsonb) AS elem
    WHERE i.source_domain = v_domain AND r.status_code = 200
      AND elem->>'property_id' IS NOT NULL
    ON CONFLICT (pid) DO NOTHING;

    SELECT count(*) INTO v_live FROM _r22_live;

    -- Sanity floor: never reconcile against a suspiciously tiny live set.
    IF v_live < p_min_live THEN
      domain := v_domain; mirror := '(all)'; live_ids := v_live; orphans_found := 0;
      orphans_deleted := 0; status := 'skipped_below_min_live';
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

      EXECUTE format(
        'SELECT count(*) FROM %s t WHERE t.source_domain = $1 '
        'AND NOT EXISTS (SELECT 1 FROM _r22_live l WHERE l.pid = t.source_property_id)',
        m.tbl
      ) INTO v_orphans USING v_domain;

      v_deleted := 0;

      IF v_orphans = 0 THEN
        v_status := 'clean';
      ELSIF v_mirror_rows > 0 AND v_orphans > (p_max_prune_frac * v_mirror_rows) THEN
        -- Anomaly: refuse to prune more than the configured fraction in one pass.
        v_status := 'skipped_anomaly_over_frac';
      ELSIF p_dry_run THEN
        v_status := 'dry_run';
      ELSE
        -- Snapshot then delete (reversible). Effect-first backup, then DELETE.
        EXECUTE format(
          'INSERT INTO public.lcc_mirror_reconcile_deletions '
          '(mirror, source_domain, source_property_id, row_snapshot, note) '
          'SELECT %L, t.source_domain, t.source_property_id, to_jsonb(t), %L '
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
      orphans_found := v_orphans; orphans_deleted := v_deleted; status := v_status;
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
-- 5. Cron: deletion-aware reconcile so orphans cannot re-accumulate. Daily,
--    after the property-attribute (:35/:40) + owner-facts (:50/:55) syncs so the
--    upserts land first. fetch at 05:10, apply (REAL, not dry-run) at 05:15.
--    Idempotent re-registration.
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
