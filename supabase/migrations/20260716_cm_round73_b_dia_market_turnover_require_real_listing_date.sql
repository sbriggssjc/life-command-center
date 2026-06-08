-- =============================================================================
-- Round 73 Layer B #9 FOLLOW-UP — dia Market Turnover: active_count must use a
-- REAL listing_date, not the 196d synthetic start. Project: Dialysis_DB
-- (zqzrriwuavgrquhisnoa). APPLIED LIVE 2026-06-08. Scott-flagged.
-- Supersedes the active_count branch of 20260715_cm_round73_b_dia_market_turnover_active_universe.sql.
--
-- The first #9 fix correctly drops old null-off_market listings (verified: 0 of
-- the 295 such rows counted at 2025-12). But active_count still read 308 vs the
-- ~87 genuinely-active. Root cause (NOT the backstop): 222 of the 308 had a NULL
-- listing_date AND a FUTURE (2026) off_market_date -- the availability-checker
-- over-stamp wall. For those, eff_start is synthesized as off_market-196d
-- (~2025-08), a fake-recent start that sails through the 540d test, and
-- "off_market wins" then exempts them from any cap. 308 - 222 = 86 ≈ ~87.
--
-- FIX: the point-in-time ACTIVE count requires a REAL listing_date. The 196d
-- synthetic start is legitimate for the historical *added-to-market* series but
-- NOT for asserting a listing was on-market at an arbitrary past quarter-end.
-- eff_start then always equals listing_date. ttm_sales unchanged.
-- Landed (active_count): 2025-12 308->86, 2026-03 166->59, 2024-09 239->187,
-- 2023-03 185->142. CAVEAT: the recent-edge decline (2025-H2/2026) is GENUINE --
-- recent CoStar/availability captures increasingly arrive WITHOUT a listing_date,
-- so fewer rows are confirmable-active at the data edge. That makes the most
-- recent months-of-supply read tight (2026-03 mos 3.8); treat the last ~2
-- quarters as capture-coverage-limited, not a market signal. Definition
-- tightening on the same view (no new data).
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
     al.listing_date,
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
        WHERE NOT e.is_syn
          AND e.listing_date IS NOT NULL                       -- REAL start required (no 196d synthetic start in the active count)
          AND e.listing_date <= m.period_end
          AND ( (e.eff_end IS NOT NULL AND e.eff_end > m.period_end)               -- genuine: real end date wins, no age cap
                OR (e.eff_end IS NULL AND (m.period_end - e.listing_date) <= 540) ) ) AS active_count  -- null-end tail backstop = 540d
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
