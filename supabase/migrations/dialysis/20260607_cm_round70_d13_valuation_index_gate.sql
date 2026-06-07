-- Round 70 B5 / D13 — dia valuation index: gate the pre-2010 "mechanical" tail.
--
-- *** CANDIDATE — NOT APPLIED LIVE. Held for Scott's go-ahead. ***
-- This REMOVES visible history from the deck (2008-Q3 -> 2010-Q1), so unlike the
-- additive G29 fix it is not auto-shipped.
--
-- Receipts (docs/capital-markets/ROUND70_B5_TAIL_RECEIPTS_2026-06-07.md §3):
-- The render gate is ttm_n >= 12, but the index BASE (=100) is the first quarter
-- with ttm_n >= 30 (2010-Q2). Every quarter 2008-Q3 -> 2010-Q1 is rendered on a
-- trailing-12mo sample of 12-28 sales (below base grade) and divided by a base
-- from a LATER quarter. 2009-Q1 has n_sales = 0 and prints a value byte-identical
-- to 2008-Q4 — a dead-flat carry, the "mechanical" artifact Scott flagged.
--
-- Fix: align the render gate with the base threshold (ttm_n >= 30). Series begins
-- 2010-Q2 at the 100 base. Drops 7 thin/back-cast quarters incl. the 2009-Q1
-- dead-flat carry. "Gate, don't fabricate." Only change vs the current view is the
-- final WHERE clause: ttm_n >= 12  ->  ttm_n >= 30.

CREATE OR REPLACE VIEW public.cm_dialysis_valuation_index_q AS
 WITH quarter_anchors AS (
         SELECT (date_trunc('quarter'::text, g.d) + '3 mons -1 days'::interval)::date AS period_end
           FROM generate_series('2008-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '3 mons'::interval) g(d)
        ), comps AS (
         SELECT s.sale_date,
            (date_trunc('quarter'::text, s.sale_date::timestamp with time zone) + '3 mons -1 days'::interval)::date AS q_end,
                CASE
                    WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric
                    ELSE s.cap_rate_final
                END AS cap_rate,
            s.rent_at_sale / NULLIF(COALESCE(( SELECT l.leased_area
                   FROM leases l
                  WHERE l.property_id = s.property_id AND l.leased_area > 0::numeric AND (l.lease_expiration IS NULL OR l.lease_expiration >= s.sale_date) AND (l.lease_start IS NULL OR l.lease_start <= s.sale_date)
                  ORDER BY l.lease_expiration DESC NULLS LAST
                 LIMIT 1), ( SELECT p.building_size
                   FROM properties p
                  WHERE p.property_id = s.property_id AND p.building_size > 0::numeric
                 LIMIT 1)), 0::numeric) AS rent_psf
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false) AND s.rent_at_sale > 0::numeric
        ), quarterly AS (
         SELECT qa.period_end,
            avg(c.rent_psf) FILTER (WHERE c.rent_psf >= 10::numeric AND c.rent_psf <= 80::numeric)::numeric(14,2) AS q_rent,
            avg(c.cap_rate) FILTER (WHERE c.cap_rate >= 0.04 AND c.cap_rate <= 0.12)::numeric(8,5) AS q_cap,
            count(*) FILTER (WHERE c.rent_psf >= 10::numeric AND c.rent_psf <= 80::numeric) AS n_sales
           FROM quarter_anchors qa
             LEFT JOIN comps c ON c.q_end = qa.period_end
          GROUP BY qa.period_end
        ), ttm AS (
         SELECT quarterly.period_end, quarterly.q_rent, quarterly.q_cap, quarterly.n_sales,
            avg(quarterly.q_rent) OVER w_ttm AS ttm_rent,
            avg(quarterly.q_cap) OVER w_ttm AS ttm_cap,
            sum(quarterly.n_sales) OVER w_ttm AS ttm_n
           FROM quarterly
          WINDOW w_ttm AS (ORDER BY quarterly.period_end ROWS BETWEEN 7 PRECEDING AND CURRENT ROW)
        ), base AS (
         SELECT ttm.ttm_rent / NULLIF(ttm.ttm_cap, 0::numeric) AS base_value
           FROM ttm
          WHERE ttm.ttm_n >= 30::numeric AND ttm.ttm_cap > 0::numeric AND ttm.ttm_rent > 0::numeric
          ORDER BY ttm.period_end
         LIMIT 1
        ), indexed AS (
         SELECT t.period_end, t.q_rent, t.q_cap, t.n_sales, t.ttm_rent, t.ttm_cap, t.ttm_n,
                CASE
                    WHEN t.ttm_cap > 0::numeric AND t.ttm_rent > 0::numeric AND b.base_value > 0::numeric THEN t.ttm_rent / t.ttm_cap / b.base_value * 100::numeric
                    ELSE NULL::numeric
                END AS valuation_index
           FROM ttm t CROSS JOIN base b
        )
 SELECT indexed.period_end,
    'all'::text AS subspecialty,
    NULL::numeric AS avg_rent_psf,
    NULL::numeric AS avg_expenses_psf,
    NULL::numeric AS avg_noi_psf,
    indexed.ttm_cap AS avg_cap_rate,
    indexed.valuation_index,
    indexed.q_rent,
    indexed.q_cap AS q_cap_rate,
    indexed.n_sales,
    indexed.ttm_rent,
    indexed.ttm_n AS n_with_cap_ttm,
    indexed.ttm_n AS n_with_noi_ttm,
        CASE
            WHEN lag(indexed.valuation_index, 4) OVER (ORDER BY indexed.period_end) IS NOT NULL AND lag(indexed.valuation_index, 4) OVER (ORDER BY indexed.period_end) <> 0::numeric THEN indexed.valuation_index / lag(indexed.valuation_index, 4) OVER (ORDER BY indexed.period_end) - 1::numeric
            ELSE NULL::numeric
        END AS yoy_change_pct
   FROM indexed
  WHERE indexed.valuation_index IS NOT NULL AND indexed.ttm_n >= 30::numeric   -- R70 D13: was >= 12 (aligns render gate with base-anchor threshold)
  ORDER BY indexed.period_end;
