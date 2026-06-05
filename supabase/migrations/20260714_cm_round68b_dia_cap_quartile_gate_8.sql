-- =============================================================================
-- Round 68 batch 3 — Task 3 (D12): raise the dia cap-quartile band gate 4 -> 8
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa) | Date: 2026-06-05
--
-- D12: the Volume+Cap+Quartile combo chart whipsaws pre-2011 — 21-32 sales/yr
-- with only ~half cap-bearing means the TTM quartile band rides 4-7 samples,
-- where Q1/median/Q3 are unstable (often degenerate). cm_dialysis_cap_quartile_m
-- already NULLs the band at n<4 (R54); raise that to n<8 so the BAND is
-- suppressed through the genuinely thin window while the avg-cap line (a separate
-- master_m column, untouched) keeps drawing. Honest gate, not fabricated data —
-- the dia twin of the gov min-n philosophy.
--
-- GROUNDED (live 2026-06-05) — months the band is kept at n>=4 vs n>=8:
--   yr    ge4   ge8   (band dropped by the 8-gate)
--   2005   8     0    full year suppressed (n 4-7)
--   2006  12     8    4 months
--   2007  12    12    -
--   2008  12    12    -
--   2009  12    10    2 months
--   2010  12     0    full year suppressed (n 4-7 all year)
--   2011+ 12    12    fully retained
-- So 2007-2008 stay, the thin 2005/2010 (and partial 2006/2009) blank — exactly
-- the choppy cells the user reads as noise. Both consumers (volume_cap_quartile_
-- combo, cap_rate_top_bottom_quartile) share this view; n>=8 is a better quartile
-- bar for both. The avg/median cap LINE is unaffected (different column/source).
--
-- Surgical replace on the live def: every band gate `band_n.n >= 4` -> `>= 8`
-- (SQL replace is global; all three CASE arms move together). Idempotent: the
-- '>= 4' substring is gone after the first apply.
-- =============================================================================
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_dialysis_cap_quartile_m'::regclass, true);
  v := replace(v, 'band_n.n >= 4', 'band_n.n >= 8');
  IF position('band_n.n >= 8' IN v) = 0 THEN
    RAISE EXCEPTION 'round68 cap-quartile gate: target substring not found — live def drifted';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_dialysis_cap_quartile_m AS ' || v;
END $$;
