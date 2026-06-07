-- Round 70 B5 / D13 — DIA VALUATION INDEX master splice (applied live 2026-06-07)
--
-- Pairs with the D13 gate (ttm_n>=30, which removed the thin/back-cast pre-2010-Q2
-- tail incl. the n=0 2009-Q1 dead-flat carry). Rather than LOSE the mechanical
-- history, this GAINS honest history: the dia master's own Valuation Index
-- (Dialysis Comp Work MASTER.xlsx / Charts) is spliced as the pre-2010-Q2 segment,
-- tagged source='master_curated', scaled by k for a continuous join at the
-- 2010-Q2 base. Same pattern as cm_gov_valuation_index_q.
--
-- Continuity (verified live): k (2011 overlap) = 0.4536; master-scaled 2010-Q1 =
-- 99.19 -> computed 2010-Q2 base = 100.00 (no step). New series start 2009-Q1.
--
-- Architecture: cm_dialysis_valuation_index_sales_q holds the gated computed math;
-- cm_dialysis_valuation_index_q is the splice wrapper (master pre-2010-Q2 UNION
-- sales). yoy_change_pct recomputed across the seam. `source` appended.

CREATE TABLE IF NOT EXISTS public.cm_dialysis_valuation_index_master_curated (
  period_end      date PRIMARY KEY,
  valuation_index numeric NOT NULL
);
TRUNCATE public.cm_dialysis_valuation_index_master_curated;
INSERT INTO public.cm_dialysis_valuation_index_master_curated (period_end, valuation_index) VALUES
('2009-03-31',227.5132),('2009-06-30',215.6957),('2009-09-30',216.7707),('2009-12-31',208.4113),
('2010-03-31',218.6715),('2010-06-30',216.4655),('2010-09-30',228.7571),('2010-12-31',234.4209),
('2011-03-31',243.0422),('2011-06-30',260.0996),('2011-09-30',268.0713),('2011-12-31',258.6158),
('2012-03-31',260.2712),('2012-06-30',259.4953),('2012-09-30',255.5178),('2012-12-31',258.4771),
('2013-03-31',248.2473),('2013-06-30',257.4212),('2013-09-30',269.3803),('2013-12-31',272.253),
('2014-03-31',277.8198),('2014-06-30',277.0025),('2014-09-30',277.7307),('2014-12-31',276.1928),
('2015-03-31',281.3935),('2015-06-30',284.4227),('2015-09-30',285.5934),('2015-12-31',290.6191),
('2016-03-31',289.6176),('2016-06-30',291.871),('2016-09-30',297.7823),('2016-12-31',303.0815),
('2017-03-31',307.5813),('2017-06-30',318.8419),('2017-09-30',322.3553),('2017-12-31',328.8543),
('2018-03-31',325.3697),('2018-06-30',323.1282),('2018-09-30',326.882),('2018-12-31',322.5447),
('2019-03-31',326.6947),('2019-06-30',328.3714),('2019-09-30',324.5142),('2019-12-31',327.7042),
('2020-03-31',328.0943),('2020-06-30',327.4481),('2020-09-30',327.2851),('2020-12-31',330.8736),
('2021-03-31',331.0719),('2021-06-30',336.8846),('2021-09-30',344.8563),('2021-12-31',350.3868),
('2022-03-31',357.9863),('2022-06-30',365.8158),('2022-09-30',373.6715),('2022-12-31',375.2397),
('2023-03-31',369.1403),('2023-06-30',359.9935),('2023-09-30',343.955),('2023-12-31',332.375),
('2024-03-31',333.482),('2024-06-30',331.6535),('2024-09-30',318.8426),('2024-12-31',309.5979),
('2025-03-31',305.8214),('2025-06-30',305.2166),('2025-09-30',300.7416),('2025-12-31',304.2966);

-- Computed (D13-gated) math as the base view
CREATE OR REPLACE VIEW public.cm_dialysis_valuation_index_sales_q AS
 WITH quarter_anchors AS (
         SELECT (date_trunc('quarter'::text, g.d) + '3 mons -1 days'::interval)::date AS period_end
           FROM generate_series('2008-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '3 mons'::interval) g(d)
        ), comps AS (
         SELECT s.sale_date,
            (date_trunc('quarter'::text, s.sale_date::timestamp with time zone) + '3 mons -1 days'::interval)::date AS q_end,
                CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.cap_rate_final END AS cap_rate,
            s.rent_at_sale / NULLIF(COALESCE(( SELECT l.leased_area FROM leases l
                  WHERE l.property_id = s.property_id AND l.leased_area > 0::numeric AND (l.lease_expiration IS NULL OR l.lease_expiration >= s.sale_date) AND (l.lease_start IS NULL OR l.lease_start <= s.sale_date)
                  ORDER BY l.lease_expiration DESC NULLS LAST LIMIT 1),
                ( SELECT p.building_size FROM properties p WHERE p.property_id = s.property_id AND p.building_size > 0::numeric LIMIT 1)), 0::numeric) AS rent_psf
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false) AND s.rent_at_sale > 0::numeric
        ), quarterly AS (
         SELECT qa.period_end,
            avg(c.rent_psf) FILTER (WHERE c.rent_psf >= 10::numeric AND c.rent_psf <= 80::numeric)::numeric(14,2) AS q_rent,
            avg(c.cap_rate) FILTER (WHERE c.cap_rate >= 0.04 AND c.cap_rate <= 0.12)::numeric(8,5) AS q_cap,
            count(*) FILTER (WHERE c.rent_psf >= 10::numeric AND c.rent_psf <= 80::numeric) AS n_sales
           FROM quarter_anchors qa LEFT JOIN comps c ON c.q_end = qa.period_end GROUP BY qa.period_end
        ), ttm AS (
         SELECT quarterly.period_end, quarterly.q_rent, quarterly.q_cap, quarterly.n_sales,
            avg(quarterly.q_rent) OVER w_ttm AS ttm_rent, avg(quarterly.q_cap) OVER w_ttm AS ttm_cap, sum(quarterly.n_sales) OVER w_ttm AS ttm_n
           FROM quarterly WINDOW w_ttm AS (ORDER BY quarterly.period_end ROWS BETWEEN 7 PRECEDING AND CURRENT ROW)
        ), base AS (
         SELECT ttm.ttm_rent / NULLIF(ttm.ttm_cap, 0::numeric) AS base_value FROM ttm
          WHERE ttm.ttm_n >= 30::numeric AND ttm.ttm_cap > 0::numeric AND ttm.ttm_rent > 0::numeric ORDER BY ttm.period_end LIMIT 1
        ), indexed AS (
         SELECT t.period_end, t.q_rent, t.q_cap, t.n_sales, t.ttm_rent, t.ttm_cap, t.ttm_n,
                CASE WHEN t.ttm_cap > 0::numeric AND t.ttm_rent > 0::numeric AND b.base_value > 0::numeric THEN t.ttm_rent / t.ttm_cap / b.base_value * 100::numeric ELSE NULL::numeric END AS valuation_index
           FROM ttm t CROSS JOIN base b
        )
 SELECT indexed.period_end, 'all'::text AS subspecialty, NULL::numeric AS avg_rent_psf, NULL::numeric AS avg_expenses_psf, NULL::numeric AS avg_noi_psf,
    indexed.ttm_cap AS avg_cap_rate, indexed.valuation_index, indexed.q_rent, indexed.q_cap AS q_cap_rate, indexed.n_sales, indexed.ttm_rent,
    indexed.ttm_n AS n_with_cap_ttm, indexed.ttm_n AS n_with_noi_ttm
   FROM indexed WHERE indexed.valuation_index IS NOT NULL AND indexed.ttm_n >= 30::numeric ORDER BY indexed.period_end;

-- Splice wrapper (DROP+CREATE because the master UNION widens q_rent's typmod)
DROP VIEW IF EXISTS public.cm_dialysis_valuation_index_q;
CREATE VIEW public.cm_dialysis_valuation_index_q AS
 WITH k AS (
   SELECT (SELECT avg(valuation_index) FROM cm_dialysis_valuation_index_sales_q WHERE period_end BETWEEN '2011-01-01' AND '2011-12-31')
        / NULLIF((SELECT avg(valuation_index) FROM cm_dialysis_valuation_index_master_curated WHERE period_end BETWEEN '2011-01-01' AND '2011-12-31'),0) AS k
 ), unified AS (
   SELECT mc.period_end, 'all'::text AS subspecialty,
     NULL::numeric AS avg_rent_psf, NULL::numeric AS avg_expenses_psf, NULL::numeric AS avg_noi_psf,
     NULL::numeric AS avg_cap_rate,
     mc.valuation_index * (SELECT k FROM k) AS valuation_index,
     NULL::numeric AS q_rent, NULL::numeric AS q_cap_rate, NULL::bigint AS n_sales, NULL::numeric AS ttm_rent,
     NULL::bigint AS n_with_cap_ttm, NULL::bigint AS n_with_noi_ttm,
     'master_curated'::text AS source
   FROM cm_dialysis_valuation_index_master_curated mc
   WHERE mc.period_end < '2010-06-30'::date
   UNION ALL
   SELECT s.period_end, s.subspecialty, s.avg_rent_psf, s.avg_expenses_psf, s.avg_noi_psf, s.avg_cap_rate,
     s.valuation_index, s.q_rent, s.q_cap_rate, s.n_sales, s.ttm_rent, s.n_with_cap_ttm, s.n_with_noi_ttm,
     'sales_computed'::text AS source
   FROM cm_dialysis_valuation_index_sales_q s
   WHERE s.valuation_index IS NOT NULL
 )
 SELECT period_end, subspecialty, avg_rent_psf, avg_expenses_psf, avg_noi_psf, avg_cap_rate,
   valuation_index, q_rent, q_cap_rate, n_sales, ttm_rent, n_with_cap_ttm, n_with_noi_ttm,
   CASE WHEN lag(valuation_index,4) OVER w IS NOT NULL AND lag(valuation_index,4) OVER w <> 0::numeric
        THEN valuation_index / lag(valuation_index,4) OVER w - 1::numeric ELSE NULL::numeric END AS yoy_change_pct,
   source
 FROM unified
 WINDOW w AS (ORDER BY period_end)
 ORDER BY period_end;
