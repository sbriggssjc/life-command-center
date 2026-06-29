-- R2-C Unit 2 (dia) — de-duplicate the rent/SF lease pool and raise the
-- per-quarter density floor for cm_dialysis_rent_box_q.
--
-- Grounded live 2026-06-29 (dia zqzrriwuavgrquhisnoa):
--   2023 box upper-quartiles blew through the chart's $50 ceiling (Q1 uq 62.92,
--   Q2 uq 73.91) while every other quarter sits ~$20-36. Triage of the high
--   leases: rent_per_sf is CORRECTLY derived (annual_rent / leased_area matches
--   to the cent in every row) -> NOT a unit/parse error. The inflation is
--   (a) genuine premium leases (Hilo HI $70.75 — Hawaii is expensive; a Hialeah
--   FL "trophy" OM at $73-75) in 5-6 lease quarters where 2 outliers dominate
--   the 75th percentile, and (b) DUPLICATION: the same Hilo lease attached to
--   two property records (44546/25267, identical annual_rent 754721 + area
--   10667), and the Hialeah lease captured as two near-identical rows.
--
-- Fix (real values kept, thin/duplicated quarters gapped):
--   1. De-dup the lease pool on (lease_start, leased_area, rent_per_sf) so an
--      identical lease captured under two property records counts once. (Two
--      genuinely-distinct leases sharing an exact start + area + rent/SF is
--      effectively impossible with continuous rent, so this only collapses real
--      duplicates — verified: it drops 2023-Q1 6->5 and 2025-12 15->13, leaving
--      every clean quarter untouched.)
--   2. Raise the density floor n_leases >= 4 -> >= 6. A 5-number box summary is
--      noise below ~6 points; combined with the de-dup this gaps both inflated
--      2023 quarters (Q1 5, Q2 5) and the thinnest noise quarters while keeping
--      the well-populated boxes (2022 Q1/Q3/Q4, 2024 Q1/Q2/Q4, 2025-12).
--   Charts render the gap honestly (no box for a sub-floor quarter).
--
-- Reversible: restore the prior body (no DISTINCT dedup; HAVING n_leases >= 4).

CREATE OR REPLACE VIEW public.cm_dialysis_rent_box_q AS
 WITH quarterly_leases AS (
         -- R2-C Unit 2: DISTINCT collapses exact-duplicate lease captures
         -- (same start/area/rent) so a lease on two property records counts once.
         SELECT DISTINCT (date_trunc('quarter'::text, l.lease_start::timestamp with time zone) + '3 mons -1 days'::interval)::date AS period_end,
            l.lease_start,
            l.leased_area,
            l.rent_per_sf
           FROM leases l
          WHERE l.lease_start IS NOT NULL AND l.rent_per_sf IS NOT NULL AND l.rent_per_sf >= 5::numeric AND l.rent_per_sf <= 100::numeric
        ), agg AS (
         SELECT quarterly_leases.period_end,
            count(*) AS n_leases,
            min(quarterly_leases.rent_per_sf)::numeric(10,2) AS rent_min,
            percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (quarterly_leases.rent_per_sf::double precision))::numeric(10,2) AS rent_lower_quartile,
            percentile_cont(0.50::double precision) WITHIN GROUP (ORDER BY (quarterly_leases.rent_per_sf::double precision))::numeric(10,2) AS rent_median,
            percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (quarterly_leases.rent_per_sf::double precision))::numeric(10,2) AS rent_upper_quartile,
            max(quarterly_leases.rent_per_sf)::numeric(10,2) AS rent_max
           FROM quarterly_leases
          GROUP BY quarterly_leases.period_end
        )
 SELECT agg.period_end,
    'all'::text AS subspecialty,
    agg.n_leases,
    agg.rent_min,
    agg.rent_lower_quartile,
    agg.rent_median,
    agg.rent_upper_quartile,
    agg.rent_max
   FROM agg
  WHERE agg.n_leases >= 6
  ORDER BY agg.period_end;
