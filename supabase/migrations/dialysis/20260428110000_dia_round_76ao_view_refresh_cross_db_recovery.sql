-- ============================================================================
-- Round 76ao — auto-refresh v_sales_comps + cross-DB rent recovery
--
-- 1. v_sales_comps materialized view was stale until manually REFRESHED.
--    Added unique index on sale_id (required for CONCURRENTLY refresh) and
--    a refresh_v_sales_comps() helper that prefers CONCURRENTLY (zero
--    blocking) but falls back to plain REFRESH if the unique index is
--    missing. Then scheduled it via pg_cron every 15 minutes.
--
-- 2. Cross-DB rent recovery: 333 leases were still rent-blind even after
--    Round 76ak's promoter fix because they were promoted PRE-fix. Pulled
--    annual_rent values from staged_intake_extractions snapshots (LCC Opps)
--    and patched the corresponding active dia.leases row when blank.
--    Result: 333 -> 299 rent-blind leases (-34 recovered).
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

-- ── 1. Unique index for CONCURRENT refresh ─────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS v_sales_comps_sale_id_uniq
  ON public.v_sales_comps (sale_id);

-- ── 2. Refresh helper ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_v_sales_comps()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.v_sales_comps;
EXCEPTION
  WHEN feature_not_supported THEN
    REFRESH MATERIALIZED VIEW public.v_sales_comps;
END $$;

-- ── 3. Cron schedule (run from inside the dialysis DB) ─────────────────────
-- Schedule via SELECT cron.schedule(...) at deploy time; included here as
-- documentation. Idempotent — cron.schedule() upserts by job name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'refresh-v-sales-comps',
      '*/15 * * * *',
      'SELECT public.refresh_v_sales_comps();'
    );
  END IF;
END $$;
