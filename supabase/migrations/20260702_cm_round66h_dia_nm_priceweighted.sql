-- Migration: cm_dialysis_nm_vs_market_m — R66h NM leg price-weighted (audit #6)
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa). Applied to prod 2026-06-01.
-- Master NM leg is rent-weighted (SUM(RENT)/SUM(PRICE)); our rent_at_sale is
-- unreliable (3.6% vs true 6.8%), so NM uses the equivalent SUM(price*cap)/SUM(price)
-- deal-size weighting. Market leg stays simple, brokered non-NM only (blank excluded).
CREATE OR REPLACE VIEW public.cm_dialysis_nm_vs_market_m AS
 WITH month_anchors AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2001-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), classified AS (
   SELECT s.sale_date, s.sold_price,
     CASE WHEN s.cap_rate_quality='implausible_unverified' THEN NULL::numeric ELSE COALESCE(s.calculated_cap_rate,s.stated_cap_rate,s.cap_rate) END AS cap_rate,
     s.is_northmarq,
     (COALESCE(NULLIF(btrim(s.listing_broker),''), NULLIF(btrim(s.procuring_broker),'')) IS NOT NULL
       OR s.listing_broker_id IS NOT NULL OR s.procuring_broker_id IS NOT NULL) AS brokered
   FROM sales_transactions s
   WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0
     AND NOT COALESCE(s.exclude_from_market_metrics,false)
     AND (s.transaction_type IS NULL OR s.transaction_type = ANY (ARRAY['Investment','Resale']))
     AND s.sale_date <= cm_last_completed_quarter_end()
 ), ttm AS (
   SELECT m.period_end,
     sum(c.sold_price * c.cap_rate) FILTER (WHERE c.is_northmarq AND c.cap_rate BETWEEN 0.04 AND 0.12) AS nm_wsum,
     sum(c.sold_price)              FILTER (WHERE c.is_northmarq AND c.cap_rate BETWEEN 0.04 AND 0.12) AS nm_psum,
     count(*)                       FILTER (WHERE c.is_northmarq AND c.cap_rate BETWEEN 0.04 AND 0.12) AS nm_n,
     avg(c.cap_rate) FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate BETWEEN 0.04 AND 0.12) AS mkt_raw,
     count(*)        FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate BETWEEN 0.04 AND 0.12) AS mkt_n
   FROM month_anchors m
   LEFT JOIN classified c ON c.sale_date > (m.period_end - '1 year'::interval)::date AND c.sale_date <= m.period_end
   GROUP BY m.period_end
 ), gated AS (
   SELECT period_end,
     CASE WHEN nm_n  >= 3 THEN nm_wsum / NULLIF(nm_psum,0) END AS nm_g,
     CASE WHEN mkt_n >= 3 THEN mkt_raw END AS mkt_g
   FROM ttm
 )
 SELECT period_end, 'all'::text AS subspecialty,
   avg(nm_g)  OVER w AS nm_cap_rate,
   avg(mkt_g) OVER w AS market_cap_rate
 FROM gated WINDOW w AS (ORDER BY period_end ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING)
 ORDER BY period_end;
