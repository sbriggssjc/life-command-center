-- Migration: cm_gov_market_turnover_m — R66p exclude batch-import listing_dates
-- Project: government (scknotsqkcheojiaewwh). Applied to prod 2026-06-02.
--
-- CHART: "Market Turnover — TTM Sales / Active Universe" (tab Data_Market_Turnover).
--   Active Listings (light bar) / Monthly Sales Rate (dark bar) / Months of
--   Supply (line). market_universe = active_count; turnover_rate = ttm_sales /
--   active_count; months_of_supply = active_count * 12 / ttm_sales.
--
-- WHAT THIS FIXES: the recent end inflated because ~90 listings were batch-
--   imported with a synthetic listing_date (2026-03-31, 2026-03-12, 2026-05-06),
--   pushing active_count / months_of_supply up artificially. This adds the same
--   sentinel_dates guard used by cm_gov_inventory_backlog_m (R66o): listing_dates
--   carrying >=20 listings on one exact date are batch-import stamps, not market
--   activity, and are excluded from the active-inventory window.
--
-- WHAT THIS DOES NOT FIX (the deeper issue — flagged for the listing-history
--   capture prompt): active_count is built from inv_windows, which require a
--   listing_date (available_listings) or an on_market_date / days_on_market
--   (sales_transactions). Only ~6.5% of gov sales carry a listing window, and
--   available_listings covers ~211 properties (mostly recent). So active_count
--   sits at 1-13 against TTM sales of 37-174 EVERY month of EVERY year
--   (active < TTM-sales in 100% of periods) — which makes turnover_rate read
--   8-89x and months_of_supply read 0.1-1.8mo across the whole timeline, not
--   just the spike. The active-universe / turnover / months-of-supply series on
--   this chart are therefore NOT reliable until listing-inventory history is
--   captured for the broader sale universe. This guard removes the one obvious
--   artifact; it does not make the metric trustworthy on its own.
--
-- Column names/order/types preserved so CREATE OR REPLACE is non-breaking.

CREATE OR REPLACE VIEW public.cm_gov_market_turnover_m AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2005-01-01'::date::timestamptz,
                        cm_last_completed_quarter_end()::timestamptz,
                        '1 mon'::interval) g(d)
 ), sentinel_dates AS (
   SELECT listing_date
   FROM available_listings
   WHERE listing_date IS NOT NULL AND NOT COALESCE(exclude_from_listing_metrics, false)
   GROUP BY listing_date
   HAVING count(*) >= 20
 ), inv_windows AS (
   SELECT al.property_id,
     al.listing_date AS s,
     COALESCE(al.off_market_date, (al.listing_date + '1 year 6 mons'::interval)::date) AS e
   FROM available_listings al
   WHERE al.listing_date IS NOT NULL
     AND NOT COALESCE(al.exclude_from_listing_metrics, false)
     AND al.listing_date NOT IN (SELECT listing_date FROM sentinel_dates)
   UNION ALL
   SELECT sales_transactions.property_id,
     COALESCE(sales_transactions.on_market_date, (sales_transactions.sale_date - make_interval(days => sales_transactions.days_on_market))::date) AS s,
     sales_transactions.sale_date AS e
   FROM sales_transactions
   WHERE sales_transactions.sold_price > 0::numeric
     AND sales_transactions.sale_date IS NOT NULL
     AND NOT COALESCE(sales_transactions.exclude_from_market_metrics, false)
     AND (sales_transactions.on_market_date IS NOT NULL
          OR sales_transactions.days_on_market IS NOT NULL AND sales_transactions.days_on_market > 0)
 ), base AS MATERIALIZED (
   SELECT m.period_end,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
          AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS ttm_sales,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 mon'::interval)::date AND s.sale_date <= m.period_end
          AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS monthly_sales,
     ( SELECT count(DISTINCT w.property_id) FROM inv_windows w
        WHERE w.s <= m.period_end AND (w.e IS NULL OR w.e > m.period_end)) AS active_count
   FROM months m
 )
 SELECT period_end,
   'all'::text AS subspecialty,
   ttm_sales AS ttm_sales_count,
   active_count AS market_universe,
   ttm_sales::numeric / NULLIF(active_count, 0)::numeric AS turnover_rate,
   active_count,
   ttm_sales AS annual_sales_rate,
   CASE WHEN ttm_sales > 0 THEN active_count::numeric * 12::numeric / ttm_sales::numeric
        ELSE NULL::numeric END AS months_of_supply,
   monthly_sales AS monthly_sales_count
 FROM base
 ORDER BY period_end;
