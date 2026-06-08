-- =============================================================================
-- Round 73 Layer A — gov Seller Sentiment cohort -> 6+yr core (#22)
-- Project: government (scknotsqkcheojiaewwh). APPLIED LIVE 2026-06-08.
-- Receipts: reports/CM_ROUND73_LAYER_A_COHORT_RECEIPTS.md
--
-- Scott (Round 73 #22): "government should be a 6+ year cohort here, confirm and
-- fix the labels." R70 A1 moved the gov CORE definition to firm_term_years >= 6
-- but deliberately left seller_sentiment at 10+; Scott now overrides that --
-- the sentiment long-term cohort must be the gov 6+yr core. Threshold-only
-- change (10 -> 6); column NAMES (_long_term) kept so the renderer/injector
-- contracts are unchanged. The 10+ cohort was near-empty in the recent tail
-- (R70 A1: n=0-2 in 2024-25); 6+ carries n=5-17, which also addresses the
-- "missing data" half of the note. Labels fixed JS-side, vertical-aware so dia
-- (which stays 10+) is not mislabeled. Idempotent: re-run finds no >=10.
-- =============================================================================
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_gov_seller_sentiment_m'::regclass, true);
  v := replace(v, 'firm_term_years >= 10::numeric', 'firm_term_years >= 6::numeric');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_seller_sentiment_m AS ' || v;
END $$;
