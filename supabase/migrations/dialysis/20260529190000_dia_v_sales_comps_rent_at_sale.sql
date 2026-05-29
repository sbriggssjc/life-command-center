-- ============================================================================
-- Dia — Sales comps: rent shown AT SALE DATE + dedup review queue
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- 2026-05-29 comps-review #3 (display): the dia sales-comp rent was inconsistent
-- across surfaces — the dashboard (loadDiaSalesCompsFromTxns) showed Y1
-- leases.annual_rent, while v_sales_comps (matview, read by detail.js) showed
-- raw leases.rent; neither was escalated to the sale date. Decision: show rent
-- AT SALE DATE (the rent basis behind that sale's cap rate), consistently.
--
-- This migration recreates the v_sales_comps matview with rent projected to
-- sale_date via public.dia_project_rent_at_date (anchor = confirmed
-- properties.anchor_rent, else leases.annual_rent, else leases.rent; bumps from
-- the property), with rent_per_sf scaled by the same ratio. It also adds an
-- explicit transaction_state='live' gate (defense-in-depth on the
-- exclude-from-metrics invariant) and recreates the unique index used by the
-- CONCURRENTLY refresh (refresh_v_sales_comps). The dashboard JS is updated in
-- dialysis.js (diaProjectRentAtDate) to match. No dependents.
-- Applied live 2026-05-29: 2,860 rows.
-- ============================================================================

DROP MATERIALIZED VIEW public.v_sales_comps;
CREATE MATERIALIZED VIEW public.v_sales_comps AS
 SELECT st.sale_id, st.property_id, p.medicare_id AS clinic_id,
    COALESCE(p.tenant, p.operator::character varying) AS tenant_operator,
    p.address, p.city, p.state, p.land_area, p.year_built, p.building_size AS rba,
    proj.rent_at_sale AS rent,
    CASE WHEN l.rent_per_sf IS NOT NULL AND proj.anchor_rent > 0
         THEN round(l.rent_per_sf * proj.rent_at_sale / proj.anchor_rent, 2)
         ELSE l.rent_per_sf END AS rent_per_sf,
    l.lease_expiration,
    CASE WHEN l.lease_expiration IS NOT NULL THEN round(EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - CURRENT_DATE::timestamp without time zone) / 86400::numeric / 365.25, 1) ELSE NULL::numeric END AS term_remaining_yrs,
    l.expense_structure AS expenses,
    COALESCE(le.raw_escalation_text, CASE WHEN le.escalation_type = 'percent'::text THEN round(le.escalation_value, 2) || '% annual'::text WHEN le.escalation_type = 'flat'::text THEN ('$'::text || round(le.flat_increase_amount, 0)) || '/yr'::text WHEN le.escalation_type IS NOT NULL THEN le.escalation_type ELSE NULL::text END) AS bumps,
    st.sold_price AS price,
    CASE WHEN p.building_size > 0::numeric AND st.sold_price IS NOT NULL THEN round(st.sold_price / p.building_size, 2) ELSE NULL::numeric END AS price_per_sf,
    CASE WHEN st.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric WHEN st.cap_rate > 1::numeric THEN st.cap_rate / 100.0 ELSE st.cap_rate END AS cap_rate,
    st.sale_date AS sold_date, st.seller_name AS seller, lb.broker_name AS listing_broker,
    st.buyer_name AS buyer, pb.broker_name AS procuring_broker,
    al.initial_price::numeric AS original_ask, al.last_price::numeric AS current_ask,
    al.initial_cap_rate AS original_ask_cap, al.last_cap_rate AS current_ask_cap, al.listing_date AS list_date,
    CASE WHEN al.last_price > 0::numeric AND st.sold_price > 0::numeric THEN round((st.sold_price - al.last_price) / al.last_price * 100::numeric, 1) ELSE NULL::numeric END AS bid_ask_spread,
    CASE WHEN al.initial_price > 0::numeric AND st.sold_price > 0::numeric THEN round((st.sold_price - al.initial_price) / al.initial_price * 100::numeric, 1) ELSE NULL::numeric END AS pct_of_original,
    CASE WHEN al.listing_date IS NOT NULL AND st.sale_date IS NOT NULL THEN st.sale_date - al.listing_date ELSE NULL::integer END AS dom
   FROM sales_transactions st
     JOIN properties p ON p.property_id = st.property_id
     LEFT JOIN LATERAL ( SELECT leases.lease_id, leases.lease_start, leases.lease_expiration, leases.expense_structure, leases.rent_per_sf, leases.rent, leases.annual_rent, leases.is_active
           FROM leases WHERE leases.property_id = st.property_id
          ORDER BY leases.is_active DESC NULLS LAST, leases.lease_expiration DESC NULLS LAST LIMIT 1) l ON true
     LEFT JOIN LATERAL ( SELECT lease_escalations.escalation_type, lease_escalations.escalation_value, lease_escalations.flat_increase_amount, lease_escalations.raw_escalation_text
           FROM lease_escalations WHERE lease_escalations.lease_id = l.lease_id
          ORDER BY lease_escalations.effective_date DESC NULLS LAST LIMIT 1) le ON true
     LEFT JOIN LATERAL ( SELECT
            COALESCE(CASE WHEN p.anchor_rent_source IN ('lease_confirmed','om_confirmed') THEN p.anchor_rent END, l.annual_rent, l.rent) AS anchor_rent,
            public.dia_project_rent_at_date(
              COALESCE(CASE WHEN p.anchor_rent_source IN ('lease_confirmed','om_confirmed') THEN p.anchor_rent END, l.annual_rent, l.rent),
              l.lease_start, st.sale_date,
              COALESCE(p.lease_bump_pct, 0.02), COALESCE(p.lease_bump_interval_mo, 12)) AS rent_at_sale
        ) proj ON true
     LEFT JOIN LATERAL ( SELECT b.broker_name FROM sale_brokers sb JOIN brokers b ON b.broker_id = sb.broker_id WHERE sb.sale_id = st.sale_id AND sb.role = 'listing'::text LIMIT 1) lb ON true
     LEFT JOIN LATERAL ( SELECT b.broker_name FROM sale_brokers sb JOIN brokers b ON b.broker_id = sb.broker_id WHERE sb.sale_id = st.sale_id AND sb.role = 'procuring'::text LIMIT 1) pb ON true
     LEFT JOIN LATERAL ( SELECT available_listings.initial_price, available_listings.last_price, available_listings.initial_cap_rate, available_listings.last_cap_rate, available_listings.listing_date
           FROM available_listings WHERE available_listings.property_id = st.property_id
          ORDER BY available_listings.off_market_date DESC NULLS LAST, available_listings.listing_date DESC NULLS LAST LIMIT 1) al ON true
  WHERE COALESCE(st.exclude_from_market_metrics, false) = false
    AND st.transaction_state = 'live';
CREATE UNIQUE INDEX v_sales_comps_uniq ON public.v_sales_comps USING btree (sale_id);

-- Dedup review queue: medium-confidence near-duplicate live sale pairs (price
-- within 5%, within 45 days) NOT auto-merged by the 20260529180000 cleanup.
CREATE OR REPLACE VIEW public.v_sales_dedup_review AS
WITH live AS (
  SELECT sale_id, property_id, sold_price, sale_date, data_source
  FROM sales_transactions
  WHERE transaction_state='live' AND exclude_from_market_metrics IS NOT TRUE AND sold_price>0
)
SELECT a.property_id,
       a.sale_id AS sale_id_a, a.sale_date AS date_a, a.sold_price AS price_a, a.data_source AS src_a,
       b.sale_id AS sale_id_b, b.sale_date AS date_b, b.sold_price AS price_b, b.data_source AS src_b,
       abs(b.sale_date - a.sale_date) AS days_apart,
       round(abs(a.sold_price - b.sold_price) / GREATEST(a.sold_price, b.sold_price) * 100, 2) AS price_diff_pct
FROM live a JOIN live b
  ON a.property_id = b.property_id AND a.sale_id < b.sale_id
 AND abs(a.sold_price - b.sold_price) <= 0.05 * GREATEST(a.sold_price, b.sold_price)
 AND abs(a.sale_date - b.sale_date) <= 45
ORDER BY a.property_id, days_apart;
