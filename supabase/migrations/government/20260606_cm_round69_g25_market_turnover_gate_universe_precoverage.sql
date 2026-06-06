-- ============================================================================
-- Round 69 (G25) — Market Turnover (TTM): gate the active-universe series to
-- the window where listing coverage actually exists. Target: government
-- (scknotsqkcheojiaewwh). Applied live 2026-06-06.
--
-- Scott (2026-06-05): "We are missing several pieces of data from this chart
-- (total available and monthly clearance rate)."
--
-- The chart re-adds Total Available (active_count) + Months-to-clear
-- (months_of_supply) -- see the LCC chart-wiring change in
-- api/_shared/cm-native-chart-injector.js + cm-chart-image-renderer.js (R66s
-- had STRIPPED them for gov). Live receipts (2026-06-06): active_count is 0 for
-- every month before mid-2011/2012 (no listing history that far back) and ramps
-- to a stable 20-98 with 4-8 months of supply from 2012 on. Plotting the
-- flat-zero head would read as "zero inventory" rather than "no data", and
-- turnover_rate is a degenerate 1.0 there (universe == sales). So NULL the two
-- PLOTTED universe columns (active_count, months_of_supply) for the
-- pre-coverage months; the real-sales columns (ttm/annual/monthly sales) keep
-- their full 2005+ history.
--
-- market_universe / turnover_rate are left numerically unchanged (computed from
-- raw active) -- they are not plotted on the gov combo and other readers /
-- Data-tab expectations stay byte-identical.
--
-- NOTE (documented in the review): the gov active-universe is ~80%
-- synthetic_from_sale (sale-derived listing windows), so months_of_supply is a
-- RELATIVE inventory-vs-pace indicator, not an organic on-market count. It
-- self-heals as organic page-marker capture accrues.
--
-- Verified after: 255 months total; active_count / months_of_supply non-null
-- for 178 months starting 2011-06-30; annual_sales_rate non-null for all 255.
-- ============================================================================
CREATE OR REPLACE VIEW public.cm_gov_market_turnover_m AS
 WITH months AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2005-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), sentinel_dates AS (
         SELECT al.listing_date
           FROM available_listings al
          WHERE al.listing_date IS NOT NULL AND al.listing_source IS DISTINCT FROM 'synthetic_from_sale'::text AND NOT COALESCE(al.exclude_from_listing_metrics, false)
          GROUP BY al.listing_date
         HAVING count(*) >= 20
        ), eff AS (
         SELECT al.listing_id,
            al.property_id,
            COALESCE(al.listing_date, (al.off_market_date - '196 days'::interval)::date) AS eff_start,
            al.off_market_date AS eff_end
           FROM available_listings al
          WHERE NOT COALESCE(al.exclude_from_listing_metrics, false) AND NOT (al.off_market_date IS NOT NULL AND al.listing_date IS NOT NULL AND al.off_market_date <= al.listing_date) AND (al.listing_date IS NULL OR al.listing_source = 'synthetic_from_sale'::text OR NOT (al.listing_date IN ( SELECT sentinel_dates.listing_date
                   FROM sentinel_dates)))
        ), base AS (
         SELECT m.period_end,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS ttm_sales,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE s.sale_date > (m.period_end - '1 mon'::interval)::date AND s.sale_date <= m.period_end AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS monthly_sales,
            ( SELECT count(DISTINCT e.property_id) AS count
                   FROM eff e
                  WHERE e.eff_start IS NOT NULL AND e.eff_start <= m.period_end AND (e.eff_end IS NULL OR e.eff_end > m.period_end) AND (m.period_end - e.eff_start) <= 1095) AS active_count
           FROM months m
        )
 SELECT period_end,
    'all'::text AS subspecialty,
    ttm_sales AS ttm_sales_count,
    active_count + ttm_sales AS market_universe,
    ttm_sales::numeric / NULLIF(active_count + ttm_sales, 0)::numeric AS turnover_rate,
    -- R69 G25: gate the plotted universe series to the listing-coverage window
    NULLIF(active_count, 0) AS active_count,
    ttm_sales AS annual_sales_rate,
        CASE
            WHEN active_count > 0 AND ttm_sales > 0 THEN active_count::numeric * 12::numeric / ttm_sales::numeric
            ELSE NULL::numeric
        END AS months_of_supply,
    monthly_sales AS monthly_sales_count
   FROM base
  ORDER BY period_end;
