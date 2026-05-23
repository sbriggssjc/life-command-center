-- ============================================================================
-- 20260523135000_dia_extend_cap_rate_quality_check.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — A5 prep (dia)
--
-- The existing cap_rate_quality CHECK constraint was added in Round 76ek
-- for the NOI-provenance pipeline and only allows the four NOI-source
-- values (cmbs_audited, om_actual, om_pro_forma, market_implied). A5
-- adds three band-check values that describe whether the cap rate is
-- inside / outside the asset-class plausibility band.
--
-- We extend the constraint additively — old values still valid, new ones
-- added. The two domains use the same allowed set so cross-DB views
-- behave identically.
-- ============================================================================

ALTER TABLE public.sales_transactions
  DROP CONSTRAINT IF EXISTS sales_transactions_cap_rate_quality_check;

ALTER TABLE public.sales_transactions
  ADD CONSTRAINT sales_transactions_cap_rate_quality_check
  CHECK (
    cap_rate_quality IS NULL OR cap_rate_quality = ANY (ARRAY[
      -- NOI-source values (pre-existing, Round 76ek):
      'cmbs_audited', 'om_actual', 'om_pro_forma', 'market_implied',
      -- Band-check values (A5 + B5, Round 76et):
      'verified', 'stated_only', 'implausible_unverified'
    ])
  );

COMMENT ON CONSTRAINT sales_transactions_cap_rate_quality_check
  ON public.sales_transactions IS
  'Allowed cap_rate_quality values. NOI-source set (cmbs_audited/om_actual/om_pro_forma/market_implied) from Round 76ek + band-check set (verified/stated_only/implausible_unverified) from A5/B5.';
