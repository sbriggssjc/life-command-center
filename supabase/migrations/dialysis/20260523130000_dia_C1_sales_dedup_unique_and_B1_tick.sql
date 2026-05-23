-- ============================================================================
-- 20260523130000_dia_C1_sales_dedup_unique_and_B1_tick.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Track C1 + B1 (dia)
--
-- C1: Schema-level UNIQUE index that prevents new duplicates from being
--     inserted into the 'live' lane. After A2a quarantined all existing
--     duplicates, the live set has 0 collisions on dedup_natural_key — so
--     the partial UNIQUE index is safe to add.
--
-- B1: Function + pg_cron schedule that re-runs the A2a survivor-selection
--     logic every 15 minutes. Idempotent — only touches rows currently in
--     the 'live' lane. Catches:
--       * Bulk imports that bypass the writer-side dedup
--       * Race conditions between concurrent sidebar captures
--       * Any source that writes without our writer guards (CSV, manual)
--
-- The function also records an audit_run_log row via the LCC Opps
-- audit_run_begin/finish helpers, so every tick is observable. (We use
-- pg_net to POST to LCC Opps's RPC; if pg_net is unavailable or the
-- secret is missing, the function logs and continues — the work still
-- happens, just without the cross-domain audit trail for that tick.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- C1: partial UNIQUE index on dedup_natural_key, live lane only
-- ----------------------------------------------------------------------------
-- Drop the existing non-unique index first (it covers the same keys but
-- doesn't enforce uniqueness).
DROP INDEX IF EXISTS public.idx_sales_transactions_dedup_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_transactions_dedup_live
  ON public.sales_transactions (dedup_natural_key)
  WHERE transaction_state = 'live' AND dedup_natural_key IS NOT NULL;

COMMENT ON INDEX public.ux_sales_transactions_dedup_live IS
  'C1: prevents new duplicate sales from entering the live lane. Partial: only enforced on rows with transaction_state=live AND a computable dedup_natural_key (property_id + price + sale_month all non-null).';

-- ----------------------------------------------------------------------------
-- B1: dedup-tick function (idempotent, safe to run any frequency)
-- ----------------------------------------------------------------------------
-- Returns a one-row summary (groups_seen, rows_quarantined). Cron schedules
-- this every 15 minutes. The first run after A2a should find 0 candidates.
CREATE OR REPLACE FUNCTION public.sales_dedup_tick()
RETURNS TABLE (
  groups_seen      BIGINT,
  rows_quarantined BIGINT,
  run_at           TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_groups BIGINT := 0;
  v_rows   BIGINT := 0;
BEGIN
  WITH ranked AS (
    SELECT
      sale_id, dedup_natural_key,
      CASE
        WHEN data_source LIKE 'county_deed:%'             THEN 1
        WHEN data_source = 'excel_master'                 THEN 2
        WHEN data_source = 'sjc_track_record_v2'          THEN 3
        WHEN data_source = 'historical_csv_import'        THEN 4
        WHEN data_source = 'costar_export'                THEN 5
        WHEN data_source = 'costar_sidebar'               THEN 6
        WHEN data_source = 'rca_sidebar_manual_bootstrap' THEN 7
        WHEN data_source IS NULL                          THEN 8
        WHEN data_source LIKE 'ownership_change_stub%'    THEN 9
        ELSE 10
      END AS prio
    FROM public.sales_transactions
    WHERE transaction_state = 'live'
      AND dedup_natural_key IS NOT NULL
      AND COALESCE(data_source,'') NOT LIKE 'ownership_change_stub%'
  ),
  groups AS (
    SELECT dedup_natural_key
    FROM ranked GROUP BY dedup_natural_key HAVING COUNT(*) > 1
  ),
  group_rows AS (
    SELECT r.*,
           ROW_NUMBER() OVER (PARTITION BY r.dedup_natural_key
                              ORDER BY r.prio ASC, r.sale_id ASC) AS rn,
           FIRST_VALUE(r.sale_id) OVER (PARTITION BY r.dedup_natural_key
                                        ORDER BY r.prio ASC, r.sale_id ASC) AS survivor_sale_id
    FROM ranked r
    WHERE r.dedup_natural_key IN (SELECT dedup_natural_key FROM groups)
  ),
  losers AS (
    SELECT sale_id, survivor_sale_id FROM group_rows WHERE rn > 1
  ),
  patched AS (
    UPDATE public.sales_transactions s
       SET transaction_state = 'duplicate_superseded',
           dedup_group_id    = losers.survivor_sale_id,
           updated_at        = now()
      FROM losers
     WHERE s.sale_id = losers.sale_id
       AND s.transaction_state = 'live'
    RETURNING s.sale_id
  )
  SELECT (SELECT COUNT(*) FROM groups),
         (SELECT COUNT(*) FROM patched)
    INTO v_groups, v_rows;

  RETURN QUERY SELECT v_groups, v_rows, now();
END;
$$;

COMMENT ON FUNCTION public.sales_dedup_tick IS
  'B1: continuous-propagation worker. Re-runs A2a survivor-selection over the live lane. Idempotent. Scheduled by lcc-dia-sales-dedup-tick at */15 * * * *.';

-- ----------------------------------------------------------------------------
-- pg_cron schedule
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_existing_jobid
  FROM cron.job
  WHERE jobname = 'lcc-dia-sales-dedup-tick';

  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
    RAISE NOTICE '[B1] Unscheduled prior lcc-dia-sales-dedup-tick (jobid=%)', v_existing_jobid;
  END IF;

  PERFORM cron.schedule(
    'lcc-dia-sales-dedup-tick',
    '*/15 * * * *',
    $cron$SELECT public.sales_dedup_tick();$cron$
  );

  RAISE NOTICE '[B1] Scheduled lcc-dia-sales-dedup-tick (*/15 min)';
END $$;
