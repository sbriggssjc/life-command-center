-- ============================================================================
-- 20260524131000_gov_A3_continuous_worker.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — A3 continuous worker (gov)
--
-- Continuous version of A3a + A3b for gov:
--   * ownership_change_stub data_source -> transaction_state='ownership_stub'
--   * other NULL-price live rows -> transaction_state='needs_review'
-- Runs hourly to keep the live lane clean.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sales_needs_review_tick()
RETURNS TABLE (rows_reclassified BIGINT, ownership_stub_reclassified BIGINT, run_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE v_nr BIGINT := 0; v_st BIGINT := 0;
BEGIN
  WITH patched AS (
    UPDATE public.sales_transactions
       SET transaction_state = 'ownership_stub', updated_at = now()
     WHERE transaction_state = 'live'
       AND COALESCE(data_source,'') LIKE 'ownership_change_stub%'
    RETURNING sale_id
  ) SELECT COUNT(*) INTO v_st FROM patched;

  WITH patched AS (
    UPDATE public.sales_transactions
       SET transaction_state = 'needs_review', updated_at = now()
     WHERE transaction_state = 'live' AND sold_price IS NULL
       AND COALESCE(data_source,'') NOT LIKE 'ownership_change_stub%'
    RETURNING sale_id
  ) SELECT COUNT(*) INTO v_nr FROM patched;

  RETURN QUERY SELECT v_nr, v_st, now();
END;
$$;

COMMENT ON FUNCTION public.sales_needs_review_tick IS
  'Continuous A3a+A3b worker (gov). Tags new ownership_stub and needs_review rows. Idempotent.';

DO $$
DECLARE v_jid BIGINT;
BEGIN
  SELECT jobid INTO v_jid FROM cron.job WHERE jobname='lcc-gov-sales-needs-review-tick';
  IF v_jid IS NOT NULL THEN PERFORM cron.unschedule(v_jid); END IF;
  PERFORM cron.schedule('lcc-gov-sales-needs-review-tick', '5 * * * *',
    $cron$SELECT public.sales_needs_review_tick();$cron$);
END $$;
