-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

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
