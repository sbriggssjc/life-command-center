-- Migration: dia inventory/turnover/available views — R66r batch-import guard
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa). Applied to prod 2026-06-02.
--
-- Mirrors the gov sentinel-date guard (R66o/R66p) on the dia side. The dia
-- listing_date repair pass left a residual batch artifact: 56 listings stamped
-- onto two import dates (2026-06-02: 33, 2026-05-07: 23) — across all history
-- the only listing_dates carrying >=15 listings. These inflate the Active
-- inventory / Added counts on the Market Turnover, Inventory Backlog, and
-- Available Market Size charts. A sentinel_dates CTE (>=15 listings on one
-- exact date) excludes them. Listings with a NULL listing_date (which the
-- turnover/backlog views backdate by 196 days) are unaffected.
--
-- NOTE: this does NOT fix the separate 2025 starvation (14 listings vs ~120
-- expected) — that is missing data, not excess, and needs another listing_date
-- capture pass. Column names/order/types preserved (CREATE OR REPLACE).

-- 1) Market Turnover -----------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_market_turnover_m AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2014-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), sentinel_dates AS (
   SELECT listing_date FROM available_listings
   WHERE listing_date IS NOT NULL GROUP BY listing_date HAVING count(*) >= 15
 ), eff AS (
   SELECT al.listing_id,
     COALESCE(al.listing_date, (COALESCE(al.sold_date, al.off_market_date) - '196 days'::interval)::date) AS eff_start,
     COALESCE(al.sold_date, al.off_market_date) AS eff_end
   FROM available_listings al
   WHERE NOT (al.sold_date IS NOT NULL AND al.listing_date IS NOT NULL AND al.sold_date <= al.listing_date)
     AND (al.listing_date IS NULL OR al.listing_date NOT IN (SELECT listing_date FROM sentinel_dates))
 ), base AS (
   SELECT m.period_end,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
          AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS ttm_sales,
     ( SELECT count(*) FROM eff e
        WHERE e.eff_start IS NOT NULL AND e.eff_start <= m.period_end AND (e.eff_end IS NULL OR e.eff_end > m.period_end)
          AND (m.period_end - e.eff_start) <= 1095) AS active_count
   FROM months m
 )
 SELECT base.period_end,
   'all'::text AS subspecialty,
   base.ttm_sales AS ttm_sales_count,
   base.active_count + base.ttm_sales AS market_universe,
   base.ttm_sales::numeric / NULLIF(base.active_count + base.ttm_sales, 0)::numeric AS turnover_rate,
   base.active_count,
   base.ttm_sales AS annual_sales_rate,
   CASE WHEN base.ttm_sales > 0 THEN base.active_count::numeric * 12::numeric / base.ttm_sales::numeric
        ELSE NULL::numeric END AS months_of_supply
 FROM base
 ORDER BY base.period_end;

-- 2) Inventory Backlog ---------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_inventory_backlog_m AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2014-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), sentinel_dates AS (
   SELECT listing_date FROM available_listings
   WHERE listing_date IS NOT NULL GROUP BY listing_date HAVING count(*) >= 15
 ), eff AS (
   SELECT al.listing_id,
     COALESCE(al.listing_date, (COALESCE(al.sold_date, al.off_market_date) - '196 days'::interval)::date) AS eff_start,
     COALESCE(al.sold_date, al.off_market_date) AS eff_end
   FROM available_listings al
   WHERE NOT (al.sold_date IS NOT NULL AND al.listing_date IS NOT NULL AND al.sold_date <= al.listing_date)
     AND (al.listing_date IS NULL OR al.listing_date NOT IN (SELECT listing_date FROM sentinel_dates))
 ), base AS (
   SELECT m.period_end,
     ( SELECT count(*) FROM eff e
        WHERE e.eff_start IS NOT NULL AND e.eff_start <= m.period_end AND (e.eff_end IS NULL OR e.eff_end > m.period_end)) AS active_count,
     ( SELECT count(*) FROM eff e
        WHERE e.eff_start IS NOT NULL AND e.eff_start > (m.period_end - '1 year'::interval)::date AND e.eff_start <= m.period_end) AS added_ttm,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
          AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS sold_ttm,
     ( SELECT count(*) FROM eff e
        WHERE e.eff_start >= date_trunc('month', m.period_end::timestamptz)::date AND e.eff_start <= m.period_end) AS added_month,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date >= date_trunc('month', m.period_end::timestamptz)::date AND s.sale_date <= m.period_end
          AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS sold_month
   FROM months m
 )
 SELECT base.period_end,
   'all'::text AS subspecialty,
   base.active_count,
   base.added_ttm,
   base.sold_ttm,
   base.sold_ttm AS ttm_sales,
   CASE WHEN base.sold_ttm > 0 THEN base.active_count::numeric * 12::numeric / base.sold_ttm::numeric
        ELSE NULL::numeric END AS months_of_supply,
   base.added_month,
   base.sold_month,
   base.added_month - base.sold_month AS net_to_market_month
 FROM base
 ORDER BY base.period_end;

-- 3) Available Market Size ------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_available_market_size_q AS
 WITH quarter_anchors AS (
   SELECT (date_trunc('quarter', g.d) + '3 mons -1 days'::interval)::date AS period_end
   FROM generate_series('2013-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '3 mons'::interval) g(d)
 ), sentinel_dates AS (
   SELECT listing_date FROM available_listings
   WHERE listing_date IS NOT NULL GROUP BY listing_date HAVING count(*) >= 15
 ), marketed AS (
   SELECT q.period_end,
     al.listing_id,
     COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) AS cap,
     (( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
          FROM leases l
         WHERE l.property_id = al.property_id AND l.is_active = true
           AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'expired'::text, 'terminated'::text, 'placeholder'::text, 'closed'::text, 'closed but obligated'::text]))
           AND l.lease_expiration IS NOT NULL AND l.lease_expiration >= q.period_end AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
         ORDER BY l.lease_expiration DESC LIMIT 1)) >= 10::numeric AS is_core
   FROM quarter_anchors q
   JOIN available_listings al ON al.listing_date IS NOT NULL
     AND al.listing_date > (q.period_end - '1 year'::interval)::date
     AND al.listing_date <= q.period_end
     AND NOT (al.sold_date IS NOT NULL AND al.sold_date <= al.listing_date)
     AND al.listing_date NOT IN (SELECT listing_date FROM sentinel_dates)
 )
 SELECT marketed.period_end,
   'all'::text AS subspecialty,
   count(*) AS count_total,
   count(*) FILTER (WHERE marketed.is_core) AS count_core_10plus,
   avg(marketed.cap) FILTER (WHERE marketed.cap >= 0.04 AND marketed.cap <= 0.12) AS avg_cap_total,
   CASE WHEN count(*) FILTER (WHERE marketed.is_core AND marketed.cap >= 0.04 AND marketed.cap <= 0.12) >= 3
        THEN avg(marketed.cap) FILTER (WHERE marketed.is_core AND marketed.cap >= 0.04 AND marketed.cap <= 0.12)
        ELSE NULL::numeric END AS avg_cap_core_10plus
 FROM marketed
 GROUP BY marketed.period_end
 HAVING count(*) >= 5
 ORDER BY marketed.period_end;
