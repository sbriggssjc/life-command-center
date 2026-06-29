-- R2-C Unit 2 (gov) — raise the year-built cohort density floor 8 -> 10 for
-- cm_gov_rent_by_year_built.
--
-- Grounded live 2026-06-29 (gov scknotsqkcheojiaewwh):
--   * The "2018 avg == upper quartile" complaint is a small-sample artifact:
--     2018 has n=9 with avg 42.09 ≈ uq 42.14 (the mean is dragged up by a high
--     value to nearly the 75th percentile). 2020 (n=8) is the other thinnest
--     cohort. Raising the HAVING floor to 10 gaps both degenerate cohorts; every
--     remaining year (n >= 10) produces a non-degenerate box (avg < median < uq).
--   * The "missing 2017/2019/2021-2026" years are REAL gaps, not a bug: those
--     build-years have fewer than the floor of leased gov properties (few gov
--     leases sit in newly-constructed buildings). The existing HAVING floor
--     already drops them; we keep them as honest gaps rather than fabricate.
--
-- Reversible: restore HAVING count(*) >= 8.

CREATE OR REPLACE VIEW public.cm_gov_rent_by_year_built AS
 WITH base AS (
         SELECT properties.year_built,
            COALESCE(properties.gross_rent_psf,
                CASE
                    WHEN properties.gross_rent > 0::numeric AND properties.sf_leased > 0 THEN properties.gross_rent / properties.sf_leased::numeric
                    ELSE NULL::numeric
                END) AS rpsf,
            properties.rba
           FROM properties
          WHERE properties.year_built >= 1990 AND properties.year_built <= (EXTRACT(year FROM CURRENT_DATE)::integer + 1)
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
 HAVING count(*) >= 10
  ORDER BY year_built;
