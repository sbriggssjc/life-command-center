-- =============================================================================
-- CM Round 74 — dia: ONE canonical availability/inventory definition.
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa). APPLIED LIVE 2026-06-22.
-- Implements CM_EXPORT_CHART_AUDIT_2026-06-22 Task 1 (dia leg).
--
-- PROBLEM (grounded live 2026-06-22, Q1-2026 / period_end 2026-03-31):
--   canonical cm_dialysis_active_listings_m  count(DISTINCT property_id) = 119
--   cm_dialysis_available_market_size_q.count_total                       = 119  (already canonical)
--   cm_dialysis_market_turnover_m.active_count                            = 119  (matches canonical
--                                                                                  for ALL 147 periods, exact)
--   cm_dialysis_inventory_backlog_m.active_count                          = 468  <-- OUTLIER (own eff logic)
--   cm_dialysis_available_by_term_bucket SUM(n_listings)                  =  82  <-- drops unknown-term
--                                                                                  + counts listings not props
--
-- CANONICAL DEFINITION (single source of truth, consumed everywhere):
--   the point-in-time active set = cm_dialysis_active_listings_m / _q,
--   counted as count(DISTINCT property_id) (one row per property).
-- Most availability charts already read it (available_cap_dot, available_by_tenant,
-- asking_cap_quartiles_active_q, dom_price_change_active_q, asking_cap_by_term_m,
-- inventory_snapshot_kpis, on_market_snapshot_q, available_market_size_q, market_turnover_m).
-- This migration repoints the only two stragglers so the active count is IDENTICAL (119)
-- across every availability chart for a given quarter.
--
-- Reversible: re-apply the prior DDL (captured in
--   20260611_cm_round19_market_turnover_and_inventory_backlog.sql and the term-bucket round).
-- =============================================================================

-- 1) inventory_backlog_m: active stock now counts the CANONICAL active set.
--    Flow metrics (added_ttm/sold_ttm/added_month/sold_month/net_to_market_month)
--    are legitimately separate and unchanged; only active_count (and the
--    months_of_supply it drives) are repointed.
CREATE OR REPLACE VIEW public.cm_dialysis_inventory_backlog_m AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2014-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), sentinel_dates AS (
   SELECT al.listing_date FROM available_listings al
   WHERE al.listing_date IS NOT NULL AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
   GROUP BY al.listing_date HAVING count(*) >= 15
 ), eff AS (
   SELECT al.listing_id,
     COALESCE(al.listing_date, (COALESCE(al.sold_date, al.off_market_date) - '196 days'::interval)::date) AS eff_start,
     COALESCE(al.sold_date, al.off_market_date) AS eff_end,
     COALESCE(al.listing_date_source, '') <> ALL (ARRAY['date_unknown_r70b34','capture_date_fallback','date_unknown']) AS addable
   FROM available_listings al
   WHERE NOT (al.sold_date IS NOT NULL AND al.listing_date IS NOT NULL AND al.sold_date <= al.listing_date)
     AND (al.listing_date IS NULL OR al.data_source = 'synthetic_from_sale' OR NOT (al.listing_date IN (SELECT sentinel_dates.listing_date FROM sentinel_dates)))
 ), base AS (
   SELECT m.period_end,
     -- CANONICAL active stock (one row per property) — was a divergent eff-based 468 count.
     ( SELECT count(DISTINCT a.property_id) FROM cm_dialysis_active_listings_m a
        WHERE a.period_end = m.period_end AND a.subspecialty = 'all') AS active_count,
     ( SELECT count(*) FROM eff e
        WHERE e.eff_start IS NOT NULL AND e.eff_start > (m.period_end - '1 year'::interval)::date AND e.eff_start <= m.period_end AND e.addable) AS added_ttm,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS sold_ttm,
     ( SELECT count(*) FROM eff e
        WHERE e.eff_start >= date_trunc('month', m.period_end::timestamptz)::date AND e.eff_start <= m.period_end AND e.addable) AS added_month,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date >= date_trunc('month', m.period_end::timestamptz)::date AND s.sale_date <= m.period_end AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS sold_month
   FROM months m
 )
 SELECT base.period_end,
    'all'::text AS subspecialty,
    base.active_count,
    base.added_ttm,
    base.sold_ttm,
    base.sold_ttm AS ttm_sales,
    CASE WHEN base.sold_ttm > 0 THEN base.active_count::numeric * 12::numeric / base.sold_ttm::numeric ELSE NULL::numeric END AS months_of_supply,
    base.added_month,
    base.sold_month,
    base.added_month - base.sold_month AS net_to_market_month
   FROM base
  ORDER BY base.period_end;

-- 2) available_by_term_bucket: derive from the CANONICAL active set, de-duped to
--    one row per property, and add an explicit "Undisclosed Term" bucket so the
--    bucket counts SUM to the canonical active total (honest labeling — unknown
--    term is surfaced, not hidden). Was 82 (listing-level, unknown-term dropped).
CREATE OR REPLACE VIEW public.cm_dialysis_available_by_term_bucket AS
 WITH latest AS (
   SELECT max(period_end) AS period_end FROM cm_dialysis_active_listings_q
 ), dedup AS (
   SELECT DISTINCT ON (al.property_id)
     al.property_id, al.firm_term_years, al.last_price, al.last_cap_rate
   FROM cm_dialysis_active_listings_q al
   JOIN latest l ON l.period_end = al.period_end
   ORDER BY al.property_id, al.firm_term_years DESC NULLS LAST, al.listing_id
 ), bucketed AS (
   SELECT
     CASE
       WHEN d.firm_term_years IS NULL THEN 'Undisclosed Term'
       WHEN d.firm_term_years < 5::numeric THEN 'Sub 5 Year Term'
       WHEN d.firm_term_years < 8::numeric THEN '5-8 Year Term'
       WHEN d.firm_term_years < 12::numeric THEN '8-12 Year Term'
       ELSE '12+ Year Term'
     END AS term_bucket,
     CASE
       WHEN d.firm_term_years IS NULL THEN 5
       WHEN d.firm_term_years < 5::numeric THEN 1
       WHEN d.firm_term_years < 8::numeric THEN 2
       WHEN d.firm_term_years < 12::numeric THEN 3
       ELSE 4
     END AS sort_order,
     d.last_price, d.last_cap_rate
   FROM dedup d
 )
 SELECT (SELECT latest.period_end FROM latest) AS period_end,
    'all'::text AS subspecialty,
    bucketed.term_bucket,
    bucketed.sort_order,
    count(*) AS n_listings,
    avg(bucketed.last_price) FILTER (WHERE bucketed.last_price >= 100000::numeric AND bucketed.last_price <= 30000000::numeric) AS avg_price,
    percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (bucketed.last_cap_rate::double precision)) FILTER (WHERE bucketed.last_cap_rate >= 0.04 AND bucketed.last_cap_rate <= 0.12) AS lower_quartile_cap,
    percentile_cont(0.50::double precision) WITHIN GROUP (ORDER BY (bucketed.last_cap_rate::double precision)) FILTER (WHERE bucketed.last_cap_rate >= 0.04 AND bucketed.last_cap_rate <= 0.12) AS median_cap,
    percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (bucketed.last_cap_rate::double precision)) FILTER (WHERE bucketed.last_cap_rate >= 0.04 AND bucketed.last_cap_rate <= 0.12) AS upper_quartile_cap,
    avg(bucketed.last_cap_rate) FILTER (WHERE bucketed.last_cap_rate >= 0.04 AND bucketed.last_cap_rate <= 0.12) AS avg_cap
   FROM bucketed
  GROUP BY bucketed.term_bucket, bucketed.sort_order
  ORDER BY bucketed.sort_order;
