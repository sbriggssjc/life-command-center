-- ============================================================================
-- 20260523130000_gov_C1_sales_dedup_unique_and_B1_tick.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Track C1 + B1 (gov)
--
-- Mirror of the dia C1 + B1 migration. See dia file for design notes.
-- Differences:
--   * Gov sale_id is UUID (vs dia INTEGER) — no type difference here
--     because dedup_group_id is already UUID on gov.
--   * ORDER BY uses sale_id::text for deterministic tiebreaks because
--     UUID sort order is fine but explicit cast makes intent clear.
-- ============================================================================

DROP INDEX IF EXISTS public.idx_sales_transactions_dedup_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_transactions_dedup_live
  ON public.sales_transactions (dedup_natural_key)
  WHERE transaction_state = 'live' AND dedup_natural_key IS NOT NULL;

COMMENT ON INDEX public.ux_sales_transactions_dedup_live IS
  'C1: prevents new duplicate sales from entering the live lane. Partial: only enforced on rows with transaction_state=live AND a computable dedup_natural_key.';

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
                              ORDER BY r.prio ASC, r.sale_id::text ASC) AS rn,
           FIRST_VALUE(r.sale_id) OVER (PARTITION BY r.dedup_natural_key
                                        ORDER BY r.prio ASC, r.sale_id::text ASC) AS survivor_sale_id
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
  'B1: continuous-propagation worker. Re-runs A2a survivor-selection over the live lane. Idempotent. Scheduled by lcc-gov-sales-dedup-tick at */15 * * * *.';

DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_existing_jobid
  FROM cron.job
  WHERE jobname = 'lcc-gov-sales-dedup-tick';

  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
    RAISE NOTICE '[B1] Unscheduled prior lcc-gov-sales-dedup-tick (jobid=%)', v_existing_jobid;
  END IF;

  PERFORM cron.schedule(
    'lcc-gov-sales-dedup-tick',
    '*/15 * * * *',
    $cron$SELECT public.sales_dedup_tick();$cron$
  );

  RAISE NOTICE '[B1] Scheduled lcc-gov-sales-dedup-tick (*/15 min)';
END $$;
