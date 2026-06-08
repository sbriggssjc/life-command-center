-- =============================================================================
-- Round 73 Layer B — #9 dia Market Turnover: genuinely-available active count
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa). APPLIED LIVE 2026-06-08.
-- Receipts/decision: reports/CM_ROUND73_LAYER_B_RECEIPTS.md
--
-- The point-in-time ACTIVE count over-stated genuinely-available inventory two
-- ways (verified 2024-Q3: 312 = 249 organic + 63 synthetic):
--   (a) synthetic_from_sale rows (sold deals back-cast as listings) counted as
--       active while "in flight" to their sale -- not tracked-available
--       inventory; they belong only in the historical added-to-market series.
--   (b) organic listings with NO off-market date counted active for up to 1095
--       days (3yr); real dia DOM is median 196d / p90 453d, so a listing with no
--       recorded close after well over a year is almost always a MISSED
--       off-market event (stale data), not live 1.5-3yr-old inventory.
--
-- FIX (Scott-gated 2026-06-08, 540d chosen over 365d to keep the real 4-8%
--      legitimately-long-on-market tail that p90=453d implies):
--   * exclude synthetics from the active count (COALESCE the is_syn test to
--     false -- organic rows have data_source NULL, and NOT NULL would otherwise
--     drop EVERY organic row -> active_count=0; this bit the first apply);
--   * off_market_date / sold_date ALWAYS wins -- a listing with a real end date
--     is active until that date with NO age cap (genuine signal);
--   * the 540-day cap is a BACKSTOP governing ONLY the null-end organic tail.
--     The availability-checker is increasingly stamping real off-market dates
--     via URL probing, so this assumed-active residual shrinks over time.
-- ttm_sales (turnover numerator) unchanged. Landed: active 2024-09 312->239,
-- 2026-03 265->166; turnover 2024-09 0.26->0.31; months-of-supply max 34->26.
-- (The 2025-H2 residual elevation is the SEPARATE #8/#24 over-stamping item.)
-- =============================================================================
CREATE OR REPLACE VIEW public.cm_dialysis_market_turnover_m AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2014-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), sentinel_dates AS (
   SELECT available_listings.listing_date FROM available_listings
   WHERE available_listings.listing_date IS NOT NULL AND available_listings.data_source IS DISTINCT FROM 'synthetic_from_sale'
   GROUP BY available_listings.listing_date HAVING count(*) >= 15
 ), eff AS (
   SELECT al.listing_id,
     COALESCE(al.data_source = 'synthetic_from_sale', false) AS is_syn,
     COALESCE(al.listing_date, (COALESCE(al.sold_date, al.off_market_date) - '196 days'::interval)::date) AS eff_start,
     COALESCE(al.sold_date, al.off_market_date) AS eff_end
   FROM available_listings al
   WHERE NOT (al.sold_date IS NOT NULL AND al.listing_date IS NOT NULL AND al.sold_date <= al.listing_date)
     AND (al.listing_date IS NULL OR al.data_source = 'synthetic_from_sale' OR NOT (al.listing_date IN (SELECT sentinel_dates.listing_date FROM sentinel_dates)))
 ), base AS (
   SELECT m.period_end,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
          AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS ttm_sales,
     ( SELECT count(*) FROM eff e
        WHERE NOT e.is_syn                                   -- (a) synthetics excluded from active
          AND e.eff_start IS NOT NULL AND e.eff_start <= m.period_end
          AND ( (e.eff_end IS NOT NULL AND e.eff_end > m.period_end)               -- genuine: end date wins, no age cap
                OR (e.eff_end IS NULL AND (m.period_end - e.eff_start) <= 540) ) ) AS active_count  -- (b) null-end tail backstop = 540d
   FROM months m
 )
 SELECT base.period_end,
    'all'::text AS subspecialty,
    base.ttm_sales AS ttm_sales_count,
    base.active_count + base.ttm_sales AS market_universe,
    base.ttm_sales::numeric / NULLIF(base.active_count + base.ttm_sales, 0)::numeric AS turnover_rate,
    base.active_count,
    base.ttm_sales AS annual_sales_rate,
    CASE WHEN base.ttm_sales > 0 THEN base.active_count::numeric * 12::numeric / base.ttm_sales::numeric ELSE NULL::numeric END AS months_of_supply
   FROM base
  ORDER BY base.period_end;
