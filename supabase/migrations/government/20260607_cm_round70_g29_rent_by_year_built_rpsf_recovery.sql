-- Round 70 B5 / G29 — gov rent-by-year-built: recover rent-PSF from the
-- property's own gross_rent / sf_leased when gross_rent_psf is NULL.
--
-- Receipts (docs/capital-markets/ROUND70_B5_TAIL_RECEIPTS_2026-06-07.md §2):
-- 2017+ vintages were overwhelmingly gross_rent_psf NULL (2018: 291/297 NULL),
-- and NONE were recoverable from leases / gsa_leases (no lease rows at all).
-- ~11 properties 2017+ DO carry gross_rent + sf_leased but a NULL
-- gross_rent_psf column (enrich_properties never computed it for GSA-sourced
-- rows). COALESCE(gross_rent_psf, gross_rent/sf_leased) recovers that real data.
--
-- Purely additive — recovers real values, removes nothing. Band [5,200] retained.
-- Before -> after: 2018 vintage 6 -> 8 (now renders, $43.24/SF); 2012 (35->36)
-- and 2015 (11->14) gain depth; 2017/2019/2020/2022 stay genuinely < 8.
-- Column shape unchanged (year, avg_rpsf, median_rpsf, upper_quartile_rpsf,
-- lower_quartile_rpsf, n_leases, avg_building_rsf). Applied live 2026-06-07.

CREATE OR REPLACE VIEW public.cm_gov_rent_by_year_built AS
WITH base AS (
  SELECT properties.year_built,
    COALESCE(properties.gross_rent_psf,
             CASE WHEN properties.gross_rent > 0::numeric AND properties.sf_leased > 0
                  THEN properties.gross_rent / properties.sf_leased END) AS rpsf,
    properties.rba
  FROM properties
  WHERE properties.year_built >= 1990
    AND properties.year_built <= (EXTRACT(year FROM CURRENT_DATE)::integer + 1)
)
SELECT year_built AS year,
  avg(rpsf)::numeric(8,2) AS avg_rpsf,
  percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (rpsf::double precision))::numeric(8,2) AS median_rpsf,
  percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (rpsf::double precision))::numeric AS upper_quartile_rpsf,
  percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (rpsf::double precision))::numeric AS lower_quartile_rpsf,
  count(*)::integer AS n_leases,
  avg(rba)::numeric(10,2) AS avg_building_rsf
FROM base
WHERE rpsf >= 5::numeric AND rpsf <= 200::numeric
GROUP BY year_built
HAVING count(*) >= 8
ORDER BY year_built;
