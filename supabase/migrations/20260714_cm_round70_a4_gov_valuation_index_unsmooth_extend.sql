-- Migration: gov — Round 70 Layer A4: gov valuation index — less smoothing +
-- longer reach. Project: government (scknotsqkcheojiaewwh). Applied live.
--
-- Scott (G20): "Something changed... it looks smoother than what previous
-- versions had. It no longer matches our Excel/PDF." The R69 build widened the
-- expense median to a 24-MONTH trailing window, which over-dampened the index
-- (the expense leg glides monotonically instead of tracking quarter-to-quarter).
--
-- TWO changes, applied identically to cm_gov_valuation_index_m and _q (each has
-- exactly one '2 years' interval = the expense window, and one '2015-01-01'
-- anchor start; cap window stays 1 year, rent stays point-in-time monthly):
--
--   1. Expense median window  '2 years' -> '1 year' (12-mo). Restores movement.
--      Receipt (median expense $/SF, 24mo -> 12mo):
--        2024-03 9.53 -> 8.87 | 2024-09 9.22 -> 8.61 | 2025-03 8.75 -> 8.22
--        2025-09 8.50 -> 8.38 | 2025-12 8.81 -> 8.86
--      The 24-mo series is a smooth monotonic glide 9.53->8.50; the 12-mo
--      series wiggles (the q-to-q movement Scott wants back). Coverage: n_exp
--      stays healthy through 2024 (47/42/41) and thins late-2025 (20/17/13/9) --
--      acceptable for a median, and the index's own n_with_cap>=12 gate already
--      suppresses ultra-thin periods.
--
--   2. Anchor start  '2015-01-01' -> '2013-01-01'. gsa_snapshots begins
--      2013-01-01 (164k rows / 19 snapshot dates before 2015), so the prior
--      2015 floor discarded 2 years of REAL data. The rebased index now
--      baselines at the first non-null VI in 2013 (the natural gsa-data rebase
--      point), lengthening the trend.
--
-- NOT in this migration (documented follow-up): the pre-2013 splice of the
-- master's curated VI (1995-2013, source='master_curated'). Those values live
-- only in the workstation Excel (no master-curated VI table exists in the gov
-- DB), so the splice needs a one-time import of the master series first. G21
-- (returns indexes) / G31 (returns y-axis + missing YoY + reach) are related
-- secondary notes tracked separately.
--
-- Idempotent / reproducible in filename order (base views created earlier; this
-- patch swaps only the two literals, SELECT list unchanged so dependents are
-- safe). Re-running finds the new literals and is a no-op for the old ones.

DO $r70a4$
DECLARE d text;
BEGIN
  d := pg_get_viewdef('public.cm_gov_valuation_index_m'::regclass);
  d := replace(d, '2 years', '1 year');
  d := replace(d, '2015-01-01', '2013-01-01');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_valuation_index_m AS ' || d;

  d := pg_get_viewdef('public.cm_gov_valuation_index_q'::regclass);
  d := replace(d, '2 years', '1 year');
  d := replace(d, '2015-01-01', '2013-01-01');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_valuation_index_q AS ' || d;
END $r70a4$;
