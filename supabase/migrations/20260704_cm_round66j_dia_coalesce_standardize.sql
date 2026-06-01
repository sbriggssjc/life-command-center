-- Migration: standardize dia cap-rate COALESCE order (audit #8). Dialysis_DB. Prod 2026-06-01.
-- valuation_index / core_cap_rate_dots / notable_transactions used raw-cap-first; now
-- COALESCE(calculated_cap_rate, stated_cap_rate, cap_rate) like every other chart (1,003 rows).
-- DEFERRED (separate workstream): gov volume/count/avg/PSF skipping exclude_from_market_metrics
-- (needs gov master matview change); Top Buyers/Sellers ttm_* labels (rename breaks the Excel
-- column contract -> documentation note only).

CREATE OR REPLACE VIEW public.cm_dialysis_core_cap_rate_dots AS
 SELECT s.sale_date,
   CASE WHEN s.cap_rate_quality='implausible_unverified' THEN NULL::numeric
        ELSE COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate) END AS cap_rate,
   ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - s.sale_date::timestamp without time zone)/(86400.0*365.25)
      FROM leases l
      WHERE l.property_id=s.property_id AND l.lease_expiration IS NOT NULL AND l.lease_expiration>=s.sale_date
        AND (l.lease_start IS NULL OR l.lease_start<=s.sale_date)
        AND COALESCE(l.effective_date,l.lease_start,s.sale_date)<=s.sale_date
        AND (l.superseded_at IS NULL OR l.superseded_at::date>s.sale_date)
        AND (EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - COALESCE(l.lease_start,l.effective_date)::timestamp without time zone)/(86400.0*365.25))<=15::numeric
      ORDER BY (COALESCE(l.effective_date,l.lease_start)) DESC NULLS LAST, l.lease_expiration DESC LIMIT 1) AS firm_term_years,
   s.is_northmarq, s.sold_price
 FROM sales_transactions s
 WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price>0::numeric AND NOT COALESCE(s.exclude_from_market_metrics,false);

CREATE OR REPLACE VIEW public.cm_dialysis_notable_transactions AS
 WITH nm_sales AS (
   SELECT s.sale_id, s.sale_date, s.sold_price,
     CASE WHEN s.cap_rate_quality='implausible_unverified' THEN NULL::numeric
          ELSE COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate) END AS cap_rate,
     s.buyer_type, p.tenant, p.operator, p.city, p.state, p.address, p.building_name,
     COALESCE(s.property_id::text, lower(btrim(p.address))) AS dedup_key
   FROM sales_transactions s LEFT JOIN properties p ON p.property_id=s.property_id
   WHERE s.is_northmarq=true AND s.sold_price IS NOT NULL AND s.sold_price>0::numeric AND NOT COALESCE(s.exclude_from_market_metrics,false)
 ), deduped AS (
   SELECT DISTINCT ON (dedup_key) sale_id, sale_date, sold_price, cap_rate, buyer_type, tenant, operator, city, state, address, building_name
   FROM nm_sales ORDER BY dedup_key, sale_date DESC, sold_price DESC NULLS LAST
 )
 SELECT sale_id, 'all'::text AS subspecialty, sale_date, sold_price AS sale_price, cap_rate, buyer_type,
   COALESCE(NULLIF(btrim(tenant::text),''), NULLIF(btrim(operator),''), '—') AS tenant_display,
   tenant, operator, city, state, address, building_name,
   rank() OVER (ORDER BY sold_price DESC NULLS LAST)::integer AS rank,
   COALESCE(NULLIF(btrim(address),''), NULLIF(btrim(building_name),''), NULLIF(btrim(city::text),''), '—') AS property_display,
   COALESCE(NULLIF(btrim(buyer_type::text),''), '—') AS buyer_type_display
 FROM deduped ORDER BY sold_price DESC NULLS LAST;

CREATE OR REPLACE VIEW public.cm_dialysis_valuation_index_m AS
 WITH month_anchors AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2010-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), closed_sales AS (
   SELECT s.sale_date, s.rent_at_sale,
     CASE WHEN s.cap_rate_quality='implausible_unverified' THEN NULL::numeric ELSE COALESCE(s.calculated_cap_rate,s.stated_cap_rate,s.cap_rate) END AS cap_rate
   FROM sales_transactions s
   WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price>0 AND NOT COALESCE(s.exclude_from_market_metrics,false)
     AND s.rent_at_sale IS NOT NULL AND s.rent_at_sale>0
     AND CASE WHEN s.cap_rate_quality='implausible_unverified' THEN NULL::numeric ELSE COALESCE(s.calculated_cap_rate,s.stated_cap_rate,s.cap_rate) END > 0
     AND s.sale_date <= cm_last_completed_quarter_end()
 ), ttm_per_month AS (
   SELECT m.period_end, cs.rent_at_sale, cs.cap_rate
   FROM month_anchors m JOIN closed_sales cs ON cs.sale_date > (m.period_end - '1 year'::interval)::date AND cs.sale_date <= m.period_end
 ), ttm_agg AS (
   SELECT period_end, avg(rent_at_sale)::numeric(14,2) AS ttm_rent, avg(cap_rate)::numeric(8,5) AS ttm_cap, count(*) AS ttm_n
   FROM ttm_per_month GROUP BY period_end
 ), base AS (
   SELECT ttm_rent / NULLIF(ttm_cap,0) AS base_value FROM ttm_agg
   WHERE ttm_n >= 30 AND ttm_cap IS NOT NULL AND ttm_cap>0 AND ttm_rent IS NOT NULL AND ttm_rent>0
   ORDER BY period_end LIMIT 1
 ), indexed AS (
   SELECT t.period_end, t.ttm_rent, t.ttm_cap, t.ttm_n,
     CASE WHEN t.ttm_cap>0 AND t.ttm_rent>0 THEN t.ttm_rent/t.ttm_cap END AS implied_value,
     CASE WHEN t.ttm_cap>0 AND t.ttm_rent>0 AND b.base_value>0 THEN t.ttm_rent/t.ttm_cap/b.base_value*100 END AS valuation_index
   FROM ttm_agg t CROSS JOIN base b
 )
 SELECT i.period_end, 'all'::text AS subspecialty, i.ttm_rent, i.ttm_cap, i.ttm_n, i.ttm_cap AS avg_cap_rate, i.valuation_index,
   CASE WHEN lag(i.valuation_index,12) OVER (ORDER BY i.period_end) IS NOT NULL AND lag(i.valuation_index,12) OVER (ORDER BY i.period_end)<>0
        THEN i.valuation_index/lag(i.valuation_index,12) OVER (ORDER BY i.period_end) - 1 END AS yoy_change_pct
 FROM indexed i WHERE i.valuation_index IS NOT NULL ORDER BY i.period_end;
