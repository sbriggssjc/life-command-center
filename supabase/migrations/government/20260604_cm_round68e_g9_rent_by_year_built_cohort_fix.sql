-- ============================================================================
-- Round 68-E (G9) — Rent by Year Built: fix avg-outside-quartile-band bug
--
-- Target: Government_DB (scknotsqkcheojiaewwh)
--
-- BUG (Scott's 2026-06-04 review): the Rent-by-Year-Built chart plotted the
-- average dot OUTSIDE the IQR (Q1-Q3) band for several build-year buckets
-- (1995, 2016, 2017, 2023). Root cause: cm_gov_rent_by_year_built passed
-- through pre-computed avg / median / quartile columns from rent_survey, where
-- the average and the quartiles had been computed over DIFFERENT cohorts
-- (Excel-sourced avg over all rows vs quartiles over a filtered subset). A
-- single coherent cohort keeps the four statistics consistent.
--
-- Fix: recompute all four statistics from ONE cohort — gov properties with a
-- plausible gross_rent_psf (5-200 band) and year_built >= 1990 — instead of the
-- mismatched rent_survey aggregates. Column names/types preserved so the chart
-- injector + Data tab are unchanged.
--
-- Verified live before/after (assert avg BETWEEN lower_q AND upper_q):
--   BEFORE: 4 of 34 buckets out of band (1995, 2016, 2017, 2023)
--   AFTER : 0 of 34 buckets out of band (all 34 avg ∈ [Q1,Q3])
-- The companion chart y-axis was tightened 0-70 -> 0-50 in
-- api/_shared/cm-native-chart-injector.js (max upper-quartile rent/SF ~$46).
-- ============================================================================

CREATE OR REPLACE VIEW public.cm_gov_rent_by_year_built AS
WITH base AS (
  SELECT year_built, gross_rent_psf AS rpsf, rba
  FROM public.properties
  WHERE year_built >= 1990
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
ORDER BY year_built;
