-- ============================================================================
-- Round 76eb — NPI signals: self-cleaning matview + duplicate auto-resolver
--
-- Goal: turn the 2,367-row "needs review" stream into a roughly 600-650 row
-- stream of signals that actually need human judgement, by:
--
-- 1. Filtering inactive medicare_clinics rows out of missing_inventory_npi
--    (closed clinics aren't actionable BD signals — pure CSV cruft).
-- 2. For duplicate_inventory_npi: classifying each cluster by severity so the
--    UI can default-hide the auto_resolvable ones and surface only the
--    data-quality / data-error cases that need a human.
-- 3. Adding dia_auto_resolve_duplicate_npi() — for NPI clusters where every
--    medicare_clinics row shares the same address (re-issued CCN at the same
--    physical clinic), promote exactly one row to is_primary_ccn=true. Once
--    that runs, those clusters fall into severity='auto_resolvable' and
--    drop out of the default UI filter.
-- 4. Scheduling the resolver at 06:45 UTC daily, immediately before the
--    existing 06:50 UTC matview refresh job.
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

-- ── 0. Audit table for auto-resolver runs ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.npi_signal_auto_resolutions (
  id              bigserial PRIMARY KEY,
  resolved_at     timestamptz NOT NULL DEFAULT now(),
  resolution_kind text        NOT NULL,
  npi             text        NOT NULL,
  winner_medicare_id text,
  loser_medicare_ids text[],
  cluster_size    integer,
  reason          text
);
CREATE INDEX IF NOT EXISTS npi_signal_auto_resolutions_npi_idx
  ON public.npi_signal_auto_resolutions (npi);
CREATE INDEX IF NOT EXISTS npi_signal_auto_resolutions_resolved_at_idx
  ON public.npi_signal_auto_resolutions (resolved_at DESC);

GRANT SELECT ON public.npi_signal_auto_resolutions TO anon;

-- ── 1. Drop the wrapper view and matview (we're recreating both) ──────────
DROP VIEW IF EXISTS public.v_npi_inventory_signal_summary;
DROP VIEW IF EXISTS public.v_npi_inventory_signals;
DROP MATERIALIZED VIEW IF EXISTS public.mv_npi_inventory_signals;

-- ── 2. Recreate matview with severity classification ──────────────────────
-- Each row carries enough context that the UI can:
--   • prioritize (signal_priority 1=high, 5=low)
--   • bulk-dismiss the auto_resolvable rows
--   • show signal-type-specific guidance per row
CREATE MATERIALIZED VIEW public.mv_npi_inventory_signals AS
WITH dup_clusters AS (
  SELECT npi,
         COUNT(*)                                      AS cluster_size,
         COUNT(DISTINCT lower(regexp_replace(coalesce(address,''),'[^a-z0-9]+','','gi')) || '|' || upper(coalesce(state,''))) AS distinct_addrs,
         COUNT(DISTINCT lower(regexp_replace(coalesce(facility_name,''),'[^a-z0-9]+','','gi'))) AS distinct_names,
         COUNT(*) FILTER (WHERE is_primary_ccn) AS primary_count
  FROM public.medicare_clinics
  WHERE COALESCE(npi,'') <> ''
  GROUP BY npi
  HAVING COUNT(*) > 1
)
-- ── missing_inventory_npi ───────────────────────────────────────────────
SELECT
  'missing_inventory_npi'::text AS signal_type,
  mc.medicare_id  AS clinic_id,
  mc.npi,
  public.sanitize_facility_name(mc.facility_name, mc.address) AS facility_name,
  mc.address, mc.city, mc.state, mc.zip_code,
  mc.owner_name   AS operator_name,
  mc.latest_estimated_patients AS latest_total_patients,
  mc.is_active,
  mc.last_seen_date,
  mc.cms_updated_at,
  1::integer      AS cluster_size,
  false           AS same_address_in_cluster,
  NULL::text      AS cluster_winner_medicare_id,
  'unresolved'::text AS severity,
  -- High-patient active clinics first; inactive last
  CASE
    WHEN mc.is_active AND mc.latest_estimated_patients >= 50 THEN 1
    WHEN mc.is_active AND mc.latest_estimated_patients >= 20 THEN 2
    WHEN mc.is_active                                       THEN 3
    ELSE 5
  END             AS signal_priority,
  'Clinic record exists but NPI is blank — look up the NPI on the registry by name + address and patch medicare_clinics.npi.'::text AS signal_reason
FROM public.medicare_clinics mc
WHERE COALESCE(mc.npi,'') = ''
  AND mc.is_active = true   -- inactive (closed) clinics are not actionable signals

UNION ALL

-- ── duplicate_inventory_npi ────────────────────────────────────────────
SELECT
  'duplicate_inventory_npi'::text AS signal_type,
  mc.medicare_id AS clinic_id,
  mc.npi,
  public.sanitize_facility_name(mc.facility_name, mc.address) AS facility_name,
  mc.address, mc.city, mc.state, mc.zip_code,
  mc.owner_name AS operator_name,
  mc.latest_estimated_patients AS latest_total_patients,
  mc.is_active,
  mc.last_seen_date,
  mc.cms_updated_at,
  d.cluster_size,
  (d.distinct_addrs = 1) AS same_address_in_cluster,
  -- pick a "winner" hint when same-address: highest-priority row by primary→active→last_seen→patients→medicare_id
  CASE
    WHEN d.distinct_addrs = 1 THEN
      (SELECT mc2.medicare_id FROM public.medicare_clinics mc2
       WHERE mc2.npi = mc.npi
       ORDER BY mc2.is_primary_ccn DESC NULLS LAST,
                mc2.is_active      DESC NULLS LAST,
                mc2.last_seen_date DESC NULLS LAST,
                mc2.cms_updated_at DESC NULLS LAST,
                mc2.latest_estimated_patients DESC NULLS LAST,
                mc2.medicare_id ASC
       LIMIT 1)
    ELSE NULL
  END AS cluster_winner_medicare_id,
  -- Severity is what drives the UI default filter:
  --   auto_resolvable: same address, exactly one is_primary_ccn=true → cluster
  --                    is already resolved; UI hides by default.
  --   data_quality:    same name across cluster but different addresses
  --                    (operator may have relocated, or two locations share
  --                    NPI by error). Needs a human.
  --   data_error:      different names AND addresses → almost certainly a
  --                    typo'd NPI on one row. Needs a human.
  --   unresolved:      same address, but no clear winner picked yet
  --                    (auto-resolver will fix on next run).
  CASE
    WHEN d.distinct_addrs = 1 AND d.primary_count = 1 THEN 'auto_resolvable'
    WHEN d.distinct_addrs = 1                          THEN 'unresolved'
    WHEN d.distinct_names = 1                          THEN 'data_quality'
    ELSE 'data_error'
  END AS severity,
  CASE
    WHEN d.distinct_addrs = 1 AND d.primary_count = 1 THEN 5  -- noise; default-hidden
    WHEN d.distinct_addrs > 1 AND d.distinct_names > 1 THEN 1 -- likely typo, fix urgently
    WHEN d.distinct_names = 1 AND d.distinct_addrs > 1 THEN 2 -- multi-loc operator, real review
    ELSE 3
  END AS signal_priority,
  CASE
    WHEN d.distinct_addrs = 1 AND d.primary_count = 1 THEN
      'Same physical clinic, multiple CCNs — non-primary CCN holds the same NPI for lineage. No action needed.'
    WHEN d.distinct_addrs = 1 THEN
      'Multiple CCNs at the same address share this NPI but no primary is selected. Auto-resolver will promote one on the next nightly run.'
    WHEN d.distinct_names = 1 THEN
      'Different addresses share this NPI under the same operator name — verify if this is a relocation, a closed sister site, or a data error.'
    ELSE
      'This NPI appears on rows with different names AND different addresses — almost certainly a typo on one row. Open both records and pick the correct NPI.'
  END AS signal_reason
FROM public.medicare_clinics mc
JOIN dup_clusters d ON d.npi = mc.npi
WHERE mc.is_active = true   -- inactive copies don't help review
;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX mv_npi_inventory_signals_uniq
  ON public.mv_npi_inventory_signals (signal_type, clinic_id, npi);

CREATE INDEX mv_npi_inventory_signals_severity_idx
  ON public.mv_npi_inventory_signals (severity, signal_priority);

GRANT SELECT ON public.mv_npi_inventory_signals TO anon;

-- ── 3. Wrapper view (PostgREST surface used by the UI) ────────────────────
CREATE OR REPLACE VIEW public.v_npi_inventory_signals AS
SELECT
  signal_type, clinic_id, npi, facility_name, address, city, state, zip_code,
  operator_name, latest_total_patients, is_active, last_seen_date, cms_updated_at,
  cluster_size, same_address_in_cluster, cluster_winner_medicare_id,
  severity, signal_priority, signal_reason
FROM public.mv_npi_inventory_signals;

GRANT SELECT ON public.v_npi_inventory_signals TO anon;

-- ── 4. Summary view — adds severity-aware counts ──────────────────────────
CREATE OR REPLACE VIEW public.v_npi_inventory_signal_summary AS
SELECT
  signal_type,
  COUNT(*)                                              AS signal_count,
  COUNT(*) FILTER (WHERE severity = 'auto_resolvable')  AS auto_resolvable_count,
  COUNT(*) FILTER (WHERE severity = 'data_quality')     AS data_quality_count,
  COUNT(*) FILTER (WHERE severity = 'data_error')       AS data_error_count,
  COUNT(*) FILTER (WHERE severity = 'unresolved')       AS unresolved_count
FROM public.v_npi_inventory_signals
GROUP BY signal_type;

GRANT SELECT ON public.v_npi_inventory_signal_summary TO anon;

-- ── 5. Auto-resolver function ─────────────────────────────────────────────
-- For NPI clusters where every medicare_clinics row shares the same
-- normalized address+state, ensure exactly one row is is_primary_ccn=true.
-- Idempotent: re-running has no effect once each cluster has a primary.
-- Skips clusters with multiple distinct addresses (those need human review).
CREATE OR REPLACE FUNCTION public.dia_auto_resolve_duplicate_npi()
RETURNS TABLE (
  clusters_processed integer,
  primaries_promoted integer,
  primaries_demoted  integer
) LANGUAGE plpgsql AS $$
DECLARE
  v_clusters integer := 0;
  v_promoted integer := 0;
  v_demoted  integer := 0;
  v_step     integer;
  r          record;
  v_winner   text;
  v_prim_cnt integer;
BEGIN
  FOR r IN
    SELECT npi
    FROM public.medicare_clinics
    WHERE COALESCE(npi,'') <> ''
    GROUP BY npi
    HAVING COUNT(*) > 1
       AND COUNT(DISTINCT lower(regexp_replace(coalesce(address,''),'[^a-z0-9]+','','gi'))
              || '|' || upper(coalesce(state,''))) = 1
  LOOP
    v_clusters := v_clusters + 1;

    SELECT COUNT(*) FILTER (WHERE is_primary_ccn) INTO v_prim_cnt
    FROM public.medicare_clinics WHERE npi = r.npi;

    -- Already exactly one primary — nothing to do.
    CONTINUE WHEN v_prim_cnt = 1;

    -- Pick the winner deterministically.
    SELECT medicare_id INTO v_winner
    FROM public.medicare_clinics
    WHERE npi = r.npi
    ORDER BY is_primary_ccn          DESC NULLS LAST,
             is_active               DESC NULLS LAST,
             last_seen_date          DESC NULLS LAST,
             cms_updated_at          DESC NULLS LAST,
             latest_estimated_patients DESC NULLS LAST,
             medicare_id             ASC
    LIMIT 1;

    -- Promote the winner (idempotent — only writes if currently false/null).
    UPDATE public.medicare_clinics
       SET is_primary_ccn = true,
           updated_at     = now()
     WHERE medicare_id = v_winner
       AND COALESCE(is_primary_ccn,false) = false;
    GET DIAGNOSTICS v_step = ROW_COUNT;
    v_promoted := v_promoted + v_step;

    -- Demote everyone else in the cluster (only those currently true).
    UPDATE public.medicare_clinics
       SET is_primary_ccn = false,
           updated_at     = now()
     WHERE npi = r.npi
       AND medicare_id <> v_winner
       AND COALESCE(is_primary_ccn,false) = true;
    GET DIAGNOSTICS v_step = ROW_COUNT;
    v_demoted := v_demoted + v_step;

    INSERT INTO public.npi_signal_auto_resolutions(
      resolution_kind, npi, winner_medicare_id, loser_medicare_ids,
      cluster_size, reason
    )
    SELECT 'duplicate_npi_primary_promoted',
           r.npi,
           v_winner,
           array_agg(medicare_id) FILTER (WHERE medicare_id <> v_winner),
           COUNT(*)::int,
           'Same address; promoted ' || v_winner || ' to is_primary_ccn=true'
    FROM public.medicare_clinics WHERE npi = r.npi;
  END LOOP;

  clusters_processed := v_clusters;
  primaries_promoted := v_promoted;
  primaries_demoted  := v_demoted;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.dia_auto_resolve_duplicate_npi() TO anon;

-- ── 6. Cron — auto-resolve at 06:45 UTC, before the 06:50 matview refresh ─
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('auto-resolve-duplicate-npi'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'auto-resolve-duplicate-npi',
      '45 6 * * *',
      $cron$ SELECT public.dia_auto_resolve_duplicate_npi(); $cron$
    );
  END IF;
END $$;

-- ── 7. Initial population — refresh and run resolver once ─────────────────
REFRESH MATERIALIZED VIEW public.mv_npi_inventory_signals;
SELECT public.dia_auto_resolve_duplicate_npi();
REFRESH MATERIALIZED VIEW public.mv_npi_inventory_signals;
