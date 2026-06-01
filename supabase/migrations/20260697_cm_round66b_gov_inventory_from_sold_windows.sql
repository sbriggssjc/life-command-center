-- =============================================================================
-- Migration: cm_gov_market_turnover_m + cm_gov_inventory_backlog_m — R66b
-- Project:   government (scknotsqkcheojiaewwh)
-- Date:       2026-06-01
--
-- Note (gov Inventory_Backlog / Market_Turnover "missing data" / "monthly sales
-- rate not showing"): the government available_listings table is a data-
-- collection gap — 407 of 418 listing-dated rows are dated 2026 (point-in-time
-- CoStar captures, not true historical on-market dates), so historical active
-- inventory was effectively 1/mo for 2018-2025.
--
-- Fix: derive a REAL historical inventory signal by UNIONing two window sources
-- and counting DISTINCT properties on-market each month:
--   (a) live available_listings, staleness-capped at listing_date + 18 months
--       so never-closed captures don't accrue forever, and
--   (b) implied on-market windows from SOLD deals:
--       [COALESCE(on_market_date, sale_date - days_on_market), sale_date]
--       (278 gov sales carry a usable marketing window).
-- Result: historical active inventory becomes ~8-13/mo (was flat 1) and turnover
-- ~8-20x, so the monthly sales line is finally legible against inventory.
--
-- KNOWN RESIDUAL (data-collection, not code): the 2025->2026 transition still
-- shows a level shift because systematic listing capture began in 2026 and the
-- sold-deal windows fade near the present (recent sales not yet tagged with
-- on_market_date). A full fix requires back-filling historical on-market dates.
-- Column contracts unchanged. Validated read-only + applied to prod 2026-06-01.
-- =============================================================================

CREATE OR REPLACE VIEW public.cm_gov_market_turnover_m AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2005-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), inv_windows AS (
   SELECT property_id, listing_date AS s,
          COALESCE(off_market_date, (listing_date + '18 months'::interval)::date) AS e
   FROM available_listings
   WHERE listing_date IS NOT NULL AND NOT COALESCE(exclude_from_listing_metrics, false)
   UNION ALL
   SELECT property_id,
          COALESCE(on_market_date, (sale_date - make_interval(days => days_on_market))::date) AS s,
          sale_date AS e
   FROM sales_transactions
   WHERE sold_price > 0 AND sale_date IS NOT NULL AND NOT COALESCE(exclude_from_market_metrics, false)
     AND (on_market_date IS NOT NULL OR (days_on_market IS NOT NULL AND days_on_market > 0))
 ), base AS MATERIALIZED (
   SELECT m.period_end,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
          AND s.sold_price > 0 AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS ttm_sales,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 mon'::interval)::date AND s.sale_date <= m.period_end
          AND s.sold_price > 0 AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS monthly_sales,
     ( SELECT count(DISTINCT w.property_id) FROM inv_windows w
        WHERE w.s <= m.period_end AND (w.e IS NULL OR w.e > m.period_end)) AS active_count
   FROM months m
 )
 SELECT period_end, 'all'::text AS subspecialty,
   ttm_sales AS ttm_sales_count,
   active_count AS market_universe,
   ttm_sales::numeric / NULLIF(active_count, 0)::numeric AS turnover_rate,
   active_count,
   ttm_sales AS annual_sales_rate,
   CASE WHEN ttm_sales > 0 THEN active_count::numeric * 12::numeric / ttm_sales::numeric ELSE NULL::numeric END AS months_of_supply,
   monthly_sales AS monthly_sales_count
 FROM base ORDER BY period_end;

CREATE OR REPLACE VIEW public.cm_gov_inventory_backlog_m AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2014-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), inv_windows AS (
   SELECT property_id, listing_date AS s,
          COALESCE(off_market_date, (listing_date + '18 months'::interval)::date) AS e
   FROM available_listings
   WHERE listing_date IS NOT NULL AND NOT COALESCE(exclude_from_listing_metrics, false)
   UNION ALL
   SELECT property_id,
          COALESCE(on_market_date, (sale_date - make_interval(days => days_on_market))::date) AS s,
          sale_date AS e
   FROM sales_transactions
   WHERE sold_price > 0 AND sale_date IS NOT NULL AND NOT COALESCE(exclude_from_market_metrics, false)
     AND (on_market_date IS NOT NULL OR (days_on_market IS NOT NULL AND days_on_market > 0))
 ), base AS (
   SELECT m.period_end,
     ( SELECT count(DISTINCT w.property_id) FROM inv_windows w
        WHERE w.s <= m.period_end AND (w.e IS NULL OR w.e > m.period_end)) AS active_count,
     ( SELECT count(DISTINCT w.property_id) FROM inv_windows w
        WHERE w.s > (m.period_end - '1 year'::interval)::date AND w.s <= m.period_end) AS added_ttm,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
          AND s.sold_price > 0 AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS sold_ttm
   FROM months m
 )
 SELECT period_end, 'all'::text AS subspecialty,
   active_count, added_ttm, sold_ttm, sold_ttm AS ttm_sales,
   CASE WHEN sold_ttm > 0 THEN active_count::numeric * 12::numeric / sold_ttm::numeric ELSE NULL::numeric END AS months_of_supply
 FROM base ORDER BY period_end;
