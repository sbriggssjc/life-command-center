-- =============================================================================
-- Migration: cm_dialysis_dom_pct_ask_m — R66g % of ask = initial-ask, no <1.0 clamp
-- Project:   Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Date:       2026-06-01
--
-- Audit fix #5 (% of Ask). The master measures "% of Int Ach" = sold_price /
-- INITIAL ask, and includes at/above-ask closings. Our view used sold / LAST ask
-- and clamped the ratio to [0.5, 1.0), which structurally excluded every deal
-- that closed at or above ask -> mechanically biased below 100%. Now:
--   * ratio = sold_price / initial_price (initial-ask reference), and
--   * band widened to [0.5, 1.5] (drops the <1.0 ceiling; matches the gov view).
-- Result moves from a clamped sub-100% mean to ~95.8-97.9% (median up to 100%).
--
-- DATA CAVEAT: our value still runs higher than the master's published ~90-94%
-- because `available_listings.initial_price` is ~equal to last_price in our data
-- (it captures an adjusted price, not the true original ask), so real initial->
-- sold markdowns aren't recorded. The DEFINITION now matches the master; closing
-- the value gap requires capturing the genuine original asking price at intake.
-- Column contract unchanged. Applied to prod 2026-06-01.
-- =============================================================================
CREATE OR REPLACE VIEW public.cm_dialysis_dom_pct_ask_m AS
 WITH month_anchors AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2001-01-01'::date::timestamptz, CURRENT_DATE::timestamptz, '1 mon'::interval) g(d)
 ), sold AS (
   SELECT m.period_end,
     al.sold_date - al.listing_date AS dom,
     CASE WHEN al.initial_price > 0 AND al.sold_price > 0 THEN al.sold_price / al.initial_price
          ELSE NULL::numeric END AS ratio
   FROM month_anchors m
   LEFT JOIN available_listings al ON al.sold_date > (m.period_end - '1 year'::interval)::date AND al.sold_date <= m.period_end
     AND al.listing_date IS NOT NULL AND al.sold_price IS NOT NULL AND al.sold_price > 0
 )
 SELECT period_end, 'all'::text AS subspecialty,
   count(*) FILTER (WHERE dom >= 0 AND dom <= 730) AS n_sales,
   avg(dom) FILTER (WHERE dom >= 0 AND dom <= 730)::numeric(10,1) AS avg_dom,
   avg(ratio) FILTER (WHERE ratio IS NOT NULL AND ratio >= 0.5 AND ratio <= 1.5)::numeric(8,5) AS pct_of_ask,
   percentile_cont(0.5) WITHIN GROUP (ORDER BY dom::double precision) FILTER (WHERE dom >= 0 AND dom <= 730)::numeric(10,1) AS median_dom,
   percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio::double precision) FILTER (WHERE ratio IS NOT NULL AND ratio >= 0.5 AND ratio <= 1.5)::numeric(8,5) AS median_pct_of_ask
 FROM sold
 GROUP BY period_end
 ORDER BY period_end;
