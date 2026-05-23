-- ============================================================================
-- 20260523135000_gov_extend_cap_rate_quality_check.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — A5 prep (gov)
--
-- Mirror of dia extend_cap_rate_quality_check. See dia file for design.
-- ============================================================================

ALTER TABLE public.sales_transactions
  DROP CONSTRAINT IF EXISTS sales_transactions_cap_rate_quality_check;

ALTER TABLE public.sales_transactions
  ADD CONSTRAINT sales_transactions_cap_rate_quality_check
  CHECK (
    cap_rate_quality IS NULL OR cap_rate_quality = ANY (ARRAY[
      'cmbs_audited', 'om_actual', 'om_pro_forma', 'market_implied',
      'verified', 'stated_only', 'implausible_unverified'
    ])
  );

COMMENT ON CONSTRAINT sales_transactions_cap_rate_quality_check
  ON public.sales_transactions IS
  'Allowed cap_rate_quality values (gov). NOI-source set (Round 76ek) + band-check set (A5/B5).';
