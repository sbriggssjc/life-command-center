-- ============================================================================
-- 20260524131000_dia_A3_continuous_worker.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — A3 continuous worker (dia)
--
-- The one-shot A3b cleanup tagged all NULL-price live sales as needs_review.
-- But new sidebar captures kept landing NULL-priced rows. Within hours of
-- A3b, dia missing-price was back to 105 and gov was similar.
--
-- This worker runs A3b hourly so the live lane stays clean.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sales_needs_review_tick()
RETURNS TABLE (rows_reclassified BIGINT, run_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE v_n BIGINT := 0;
BEGIN
  WITH patched AS (
    UPDATE public.sales_transactions
       SET transaction_state = 'needs_review',
           updated_at        = now()
     WHERE transaction_state = 'live' AND sold_price IS NULL
    RETURNING sale_id
  )
  SELECT COUNT(*) INTO v_n FROM patched;
  RETURN QUERY SELECT v_n, now();
END;
$$;

COMMENT ON FUNCTION public.sales_needs_review_tick IS
  'Continuous A3b worker (dia). Tags new live-lane sales with NULL sold_price as needs_review. Idempotent.';

DO $$
DECLARE v_jid BIGINT;
BEGIN
  SELECT jobid INTO v_jid FROM cron.job WHERE jobname='lcc-dia-sales-needs-review-tick';
  IF v_jid IS NOT NULL THEN PERFORM cron.unschedule(v_jid); END IF;
  PERFORM cron.schedule('lcc-dia-sales-needs-review-tick', '5 * * * *',
    $cron$SELECT public.sales_needs_review_tick();$cron$);
END $$;
