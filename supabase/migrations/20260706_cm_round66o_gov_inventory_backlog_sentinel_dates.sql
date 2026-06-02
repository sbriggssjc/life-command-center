-- Migration: cm_gov_inventory_backlog_m — R66o exclude batch-import listing_dates
-- Project: government (scknotsqkcheojiaewwh). Applied to prod 2026-06-02.
--
-- CHART: "Market Turnover — Added vs Sold (Monthly) + Net to Market"
--   (tab Data_Inventory_Backlog). added_month (light bar) / sold_month (dark
--   bar) / net_to_market_month (line).
--
-- PROBLEM: the final month spiked to ~92 "Added" while every prior month sits
--   at 0-1. The spike is a listing_date import artifact: batches of listings
--   were stamped with the import/scrape date instead of their true on-market
--   date. Across ALL history only three listing_dates carry >=20 listings on
--   one exact date — 2026-03-31 (64), 2026-03-12 (26), 2026-05-06 (44) — all
--   recent import batches. Real listings trickle in on varied dates; a single
--   date carrying dozens is a batch-stamp signature, not market activity.
--
-- FIX: add a sentinel_dates CTE (listing_date with >=20 listings) and exclude
--   those listings from the available_listings branch of inv_windows, so the
--   synthetic batch dates no longer inflate added_month / added_ttm /
--   active_count. Mirrors the existing sentinel pattern in
--   cm_gov_seller_sentiment_m (event_dates with >1000 rows). The genuine fix is
--   to repair listing_date at the source (see the gov listing_date / listing-
--   history capture work); this guard stops the chart from being dominated by
--   the artifact in the meantime, without hiding any legitimately-dated listing.
--
-- Column names/order/types preserved so CREATE OR REPLACE is non-breaking.

CREATE OR REPLACE VIEW public.cm_gov_inventory_backlog_m AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2014-01-01'::date::timestamptz,
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
 ), base AS (
   SELECT m.period_end,
     ( SELECT count(DISTINCT w.property_id) FROM inv_windows w
        WHERE w.s <= m.period_end AND (w.e IS NULL OR w.e > m.period_end)) AS active_count,
     ( SELECT count(DISTINCT w.property_id) FROM inv_windows w
        WHERE w.s > (m.period_end - '1 year'::interval)::date AND w.s <= m.period_end) AS added_ttm,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
          AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS sold_ttm,
     ( SELECT count(DISTINCT w.property_id) FROM inv_windows w
        WHERE w.s >= date_trunc('month', m.period_end::timestamptz)::date AND w.s <= m.period_end) AS added_month,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date >= date_trunc('month', m.period_end::timestamptz)::date AND s.sale_date <= m.period_end
          AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS sold_month
   FROM months m
 )
 SELECT period_end,
   'all'::text AS subspecialty,
   active_count,
   added_ttm,
   sold_ttm,
   sold_ttm AS ttm_sales,
   CASE WHEN sold_ttm > 0 THEN active_count::numeric * 12::numeric / sold_ttm::numeric
        ELSE NULL::numeric END AS months_of_supply,
   added_month,
   sold_month,
   added_month - sold_month AS net_to_market_month
 FROM base
 ORDER BY period_end;
