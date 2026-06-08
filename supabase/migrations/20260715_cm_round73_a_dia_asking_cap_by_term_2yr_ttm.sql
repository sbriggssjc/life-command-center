-- =============================================================================
-- Round 73 Layer A — dia ASKING cap-by-lease-term cohort consistency (#11)
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa). APPLIED LIVE 2026-06-08.
-- Receipts: reports/CM_ROUND73_LAYER_A_COHORT_RECEIPTS.md
--
-- ASKING-SIDE ONLY. cm_dialysis_asking_cap_by_term_m reads exclusively from
-- cm_dialysis_active_listings_m (listings). SEPARATE from the sold-side
-- canonical series cm_dialysis_sold_cap_by_term_dot (Round 66x) -- this change
-- does NOT touch the sold definition (sold/asking kept separate per directive).
--
-- Same disease as gov #14: 1yr TTM + n>=3 left the sparse 6-8yr asking cohort
-- at n=4-17 in 2020 (spikes to 7.6-7.8%) so the lines crossed 2019-2022.
-- FIX: TTM 1yr -> 2yr, gate n>=3 -> n>=5 (+/-3mo smoothing unchanged). 2019 and
-- 2023-2026 order cleanly; the residual 2020-2022 6-8 elevation SURVIVES 2yr
-- pooling at n=26-105 -> genuine asking-side behavior (broker theater), not an
-- artifact. Surgical + idempotent.
-- =============================================================================
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_dialysis_asking_cap_by_term_m'::regclass, true);
  v := replace(v, '(m.period_end - ''1 year''::interval)::date', '(m.period_end - ''2 years''::interval)::date');
  v := replace(v, 'ttm.cap_12plus_n >= 3',  'ttm.cap_12plus_n >= 5');
  v := replace(v, 'ttm.cap_8to12_n >= 3',   'ttm.cap_8to12_n >= 5');
  v := replace(v, 'ttm.cap_6to8_n >= 3',    'ttm.cap_6to8_n >= 5');
  v := replace(v, 'ttm.cap_5orless_n >= 3', 'ttm.cap_5orless_n >= 5');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_dialysis_asking_cap_by_term_m AS ' || v;
END $$;
