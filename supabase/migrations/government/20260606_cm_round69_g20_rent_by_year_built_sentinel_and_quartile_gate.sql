-- ============================================================================
-- Round 69 (G20) — Rent by Year Built: drop the 9999 sentinel + thin-vintage
-- quartile gate. Target: government (scknotsqkcheojiaewwh). Applied live
-- 2026-06-06.
--
-- Scott (2026-06-05): "The data from 2021 on seems to be much more inconsistent
-- than the balance. Review to ensure we are pulling in accurate information."
--
-- Root causes found (live receipts 2026-06-06):
--   1) year_built = 9999 SENTINEL (13 props, all excel_master "unknown year")
--      passed the `>= 1990` filter and rendered as a phantom vintage bucket
--      (n=13, avg $37.24) — a grab-bag of unrelated buildings, pure noise on a
--      year axis. The n-gate alone never catches it (n=13 >= 8).
--   2) Recent vintages are genuinely thin AND mixed-basis: only 5 of 179
--      properties built 2021+ have an in-band gross_rent_psf, ALL from
--      costar_sidebar (CoStar new-construction capture), spanning a 1.05M-SF
--      GSA distribution warehouse @ $7.27 (prop 9525) to small offices @ $38.
--      2023 n=3, 2024 n=2 -> quartiles (Q1/median/Q3) are degenerate; the
--      warehouse drags 2023 avg to $18.15. 2021/2022/2025 have zero in-band.
--
-- Fix:
--   * Cap year_built at CURRENT_YEAR+1 -> the 9999 sentinel (and any impossible
--     future vintage) drops out entirely.
--   * HAVING count(*) >= 8 -> quartile-band stability gate. Same threshold the
--     dia cap-quartile band uses (Round 68b, 20260714_cm_round68b_dia_cap_
--     quartile_gate_8.sql): below 8, Q1/median/Q3 whipsaw. The Round 10 thin-
--     sample convention is >=5 for single-value lines; quartile charts use 8.
--
-- Effect (verified before/after):
--   BEFORE: 34 buckets, 1990..9999 (incl. 9999 sentinel + 2016-2024 at n=2-7).
--   AFTER : 26 buckets, 1990..2015, all n>=8 (min n=9) and every avg in [Q1,Q3].
-- 2016-2020 were ALSO sub-gate (n=4-7), so the cut is at 2015, not just 2021.
-- 2021+ is GENUINELY THIN (5 in-band, warehouse-contaminated); it self-heals as
-- recent-vintage leases accrue. Pooling into a "2021+" bucket was rejected: 5
-- mixed rows incl. a 1M-SF $7 warehouse would still fail the gate and hide the
-- contamination rather than surface it.
-- Column names/types preserved; chart injector + Data tab unchanged.
-- ============================================================================
CREATE OR REPLACE VIEW public.cm_gov_rent_by_year_built AS
WITH base AS (
  SELECT year_built, gross_rent_psf AS rpsf, rba
  FROM public.properties
  WHERE year_built >= 1990
    AND year_built <= (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
    AND gross_rent_psf BETWEEN 5::numeric AND 200::numeric
)
SELECT
  year_built AS year,
  avg(rpsf)::numeric(8,2) AS avg_rpsf,
  (percentile_cont(0.5)  WITHIN GROUP (ORDER BY rpsf))::numeric(8,2) AS median_rpsf,
  (percentile_cont(0.75) WITHIN GROUP (ORDER BY rpsf))::numeric       AS upper_quartile_rpsf,
  (percentile_cont(0.25) WITHIN GROUP (ORDER BY rpsf))::numeric       AS lower_quartile_rpsf,
  count(*)::integer AS n_leases,
  avg(rba)::numeric(10,2) AS avg_building_rsf
FROM base
GROUP BY year_built
HAVING count(*) >= 8
ORDER BY year_built;
