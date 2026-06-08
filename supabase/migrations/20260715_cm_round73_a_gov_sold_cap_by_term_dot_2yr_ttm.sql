-- =============================================================================
-- Round 73 Layer A — gov Closed-Sales-by-Term dot plot cohort consistency (#25)
-- Project: government (scknotsqkcheojiaewwh). APPLIED LIVE 2026-06-08.
-- Receipts: reports/CM_ROUND73_LAYER_A_COHORT_RECEIPTS.md
--
-- cm_gov_sold_cap_by_term_dot emits per-period cohort AVERAGES (10+/5-10/<5/
-- outside) rendered as markers -- the SAME closed-sales cohort comparison as
-- #14 (cm_gov_cap_by_term_m), just a dot rendering. It carried the identical
-- 1yr-TTM + n>=3 thin-tail bug. Same fix as #14 so a line and its dot twin
-- can't disagree: TTM 1yr -> 2yr, gate n>=3 -> n>=5 (+/-3mo smoothing kept).
-- Result mirrors #14: ordered 2018-2023, genuine 2024+ inversion.
--
-- dia's sold dot (cm_dialysis_sold_cap_by_term_dot) is deliberately NOT touched
-- (canonical Round-66x series; sold-side stays separate from the asking pool).
-- Surgical + idempotent.
-- =============================================================================
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_gov_sold_cap_by_term_dot'::regclass, true);
  v := replace(v, '(m.period_end - ''1 year''::interval)::date', '(m.period_end - ''2 years''::interval)::date');
  v := replace(v, 'ttm.n_10plus >= 3',  'ttm.n_10plus >= 5');
  v := replace(v, 'ttm.n_5to10 >= 3',   'ttm.n_5to10 >= 5');
  v := replace(v, 'ttm.n_less5 >= 3',   'ttm.n_less5 >= 5');
  v := replace(v, 'ttm.n_outside >= 3', 'ttm.n_outside >= 5');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_sold_cap_by_term_dot AS ' || v;
END $$;
