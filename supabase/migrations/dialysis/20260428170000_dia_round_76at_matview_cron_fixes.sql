-- ============================================================================
-- Round 76at — fix 5 silently-failing dia matview cron jobs
--
-- Audit of cron.job_run_details on the dialysis project showed five
-- nightly refresh jobs failing for two distinct reasons:
--
-- 1. Three matviews (v_marketing_deals, mv_counts_freshness,
--    mv_npi_inventory_signals) had cron jobs trying to REFRESH MATERIALIZED
--    VIEW CONCURRENTLY but no unique index — Postgres requires one. Same
--    pattern as v_sales_comps fixed in Round 76ao. Fix: add a unique index
--    on the natural primary key for each.
--
-- 2. Two cron jobs reference views that no longer exist as matviews:
--    - refresh-mv-available-listings: rebuilt as a regular VIEW in
--      Round 76am (with current_ask + original_ask aliases). REFRESH
--      MATERIALIZED VIEW now errors because it's not a matview.
--      Cron is obsolete — unschedule.
--    - refresh-mv-backfill-candidates: references
--      'v_clinic_lease_backfill_candidates' which doesn't exist in the
--      schema at all (renamed/dropped at some point). Unschedule.
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

-- ── 1. Unique indexes for CONCURRENT refresh ───────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS v_marketing_deals_uniq
  ON public.v_marketing_deals (activity_id);

CREATE UNIQUE INDEX IF NOT EXISTS mv_counts_freshness_uniq
  ON public.mv_counts_freshness (latest_month);

CREATE UNIQUE INDEX IF NOT EXISTS mv_npi_inventory_signals_uniq
  ON public.mv_npi_inventory_signals (signal_type, clinic_id, npi);

-- ── 2. Unschedule obsolete crons ──────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('refresh-mv-available-listings'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('refresh-mv-backfill-candidates'); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END $$;
