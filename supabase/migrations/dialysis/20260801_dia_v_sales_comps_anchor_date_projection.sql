-- ============================================================================
-- Dia — v_sales_comps: project the CONFIRMED anchor rent from its OWN effective
-- date, not the lease commencement (Prompt 01 / property 35724 root cause).
--
-- Target: dialysis Supabase (zqzrriwuavgrquhisnoa). Applied live 2026-08-01.
--
-- The matview projected `rent` (and scaled `rent_per_sf`) to the sale date via
-- dia_project_rent_at_date(anchor_rent, l.lease_start, sale_date, ...). When the
-- rent basis is the CONFIRMED property anchor (properties.anchor_rent with
-- anchor_rent_source in lease_confirmed/om_confirmed) — which is the CURRENT
-- in-place rent as of properties.anchor_rent_date — anchoring the projection to
-- the lease COMMENCEMENT (l.lease_start) re-escalates it forward and inflates
-- the comp rent/PSF (property 35724: $943,794 -> $1,016,362.91). The recorded
-- cap (st.cap_rate_final) is already derived by dia_compute_cap_rate FROM the
-- anchor date, so the view's rent disagreed with its own cap for every
-- anchor-bearing property whose anchor_rent_date <> lease_start (412 live).
--
-- Fix: when the confirmed anchor is the rent basis, project from
-- COALESCE(anchor_rent_date, lease_start). For every row where anchor_rent_date
-- equals lease_start (the backfilled norm) or the anchor is not confirmed, the
-- projection basis is unchanged — so this only corrects the divergent rows and
-- brings the view into agreement with the deployed cap engine.
--
-- DROP+CREATE (Postgres has no CREATE OR REPLACE MATERIALIZED VIEW). Re-grants
-- anon/authenticated/service_role and recreates the CONCURRENTLY-refresh unique
-- index. Body is otherwise the live definition verbatim (cap_rate = cap_rate_final).
-- Reversal: re-create with `l.lease_start` as the projection date argument.
-- ============================================================================

DROP MATERIALIZED VIEW public.v_sales_comps;
CREATE MATERIALIZED VIEW public.v_sales_comps AS
 SELECT st.sale_id,
    st.property_id,
    p.medicare_id AS clinic_id,
    COALESCE(p.tenant, p.operator::character varying) AS tenant_operator,
    p.address, p.city, p.state, p.land_area, p.year_built,
    p.building_size AS rba,
    proj.rent_at_sale AS rent,
    CASE WHEN l.rent_per_sf IS NOT NULL AND proj.anchor_rent > 0::numeric
         THEN round(l.rent_per_sf * proj.rent_at_sale / proj.anchor_rent, 2)
         ELSE l.rent_per_sf END AS rent_per_sf,
    l.lease_expiration,
    CASE WHEN l.lease_expiration IS NOT NULL THEN round(EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - CURRENT_DATE::timestamp without time zone) / 86400::numeric / 365.25, 1) ELSE NULL::numeric END AS term_remaining_yrs,
    l.expense_structure AS expenses,
    COALESCE(le.raw_escalation_text, CASE WHEN le.escalation_type = 'percent'::text THEN round(le.escalation_value, 2) || '% annual'::text WHEN le.escalation_type = 'flat'::text THEN ('$'::text || round(le.flat_increase_amount, 0)) || '/yr'::text WHEN le.escalation_type IS NOT NULL THEN le.escalation_type ELSE NULL::text END) AS bumps,
    st.sold_price AS price,
    CASE WHEN p.building_size > 0::numeric AND st.sold_price IS NOT NULL THEN round(st.sold_price / p.building_size, 2) ELSE NULL::numeric END AS price_per_sf,
    st.cap_rate_final AS cap_rate,
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
            COALESCE(CASE WHEN p.anchor_rent_source = ANY (ARRAY['lease_confirmed'::text,'om_confirmed'::text]) THEN p.anchor_rent ELSE NULL::numeric END, l.annual_rent, l.rent) AS anchor_rent,
            public.dia_project_rent_at_date(
              COALESCE(CASE WHEN p.anchor_rent_source = ANY (ARRAY['lease_confirmed'::text,'om_confirmed'::text]) THEN p.anchor_rent ELSE NULL::numeric END, l.annual_rent, l.rent),
              -- FIX (property 35724): project the CONFIRMED anchor from its own
              -- effective date, not the lease commencement, so current in-place
              -- rent is not re-escalated forward.
              COALESCE(CASE WHEN p.anchor_rent_source = ANY (ARRAY['lease_confirmed'::text,'om_confirmed'::text]) AND p.anchor_rent > 0::numeric THEN p.anchor_rent_date END, l.lease_start),
              st.sale_date,
              COALESCE(p.lease_bump_pct, 0.02), COALESCE(p.lease_bump_interval_mo, 12)) AS rent_at_sale
        ) proj ON true
     LEFT JOIN LATERAL ( SELECT b.broker_name FROM sale_brokers sb JOIN brokers b ON b.broker_id = sb.broker_id WHERE sb.sale_id = st.sale_id AND sb.role = 'listing'::text LIMIT 1) lb ON true
     LEFT JOIN LATERAL ( SELECT b.broker_name FROM sale_brokers sb JOIN brokers b ON b.broker_id = sb.broker_id WHERE sb.sale_id = st.sale_id AND sb.role = 'procuring'::text LIMIT 1) pb ON true
     LEFT JOIN LATERAL ( SELECT available_listings.initial_price, available_listings.last_price, available_listings.initial_cap_rate, available_listings.last_cap_rate, available_listings.listing_date
           FROM available_listings WHERE available_listings.property_id = st.property_id
          ORDER BY available_listings.off_market_date DESC NULLS LAST, available_listings.listing_date DESC NULLS LAST LIMIT 1) al ON true
  WHERE COALESCE(st.exclude_from_market_metrics, false) = false AND st.transaction_state = 'live'::text;

CREATE UNIQUE INDEX v_sales_comps_uniq ON public.v_sales_comps USING btree (sale_id);
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_sales_comps TO anon, authenticated, service_role;

SELECT public.refresh_v_sales_comps();
