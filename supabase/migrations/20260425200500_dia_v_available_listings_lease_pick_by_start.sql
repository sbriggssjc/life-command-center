-- ============================================================================
-- Migration: tighten v_available_listings lease pick to order by
--            lease_start DESC and filter out superseded statuses
--
-- Target:    dialysis Supabase (DIA_SUPABASE_URL)
--
-- Why: the prior LATERAL lease pick was
--          ORDER BY lease_expiration DESC NULLS LAST LIMIT 1
--      which let a stale placeholder lease win over the real current
--      lease whenever the placeholder's expiration drifted past the
--      real one. Audit 2026-04-25 hit this on property_id 29237
--      (US Renal Care - Hondo): lease 16793 had a 2015 commencement,
--      NN expense structure, 2030-07-01 expiration, and beat lease 17827
--      (the real OM-derived lease, 2025-07-01 → 2030-06-30, NNN) by one
--      day on the expiration tie. The Available view's Expenses column
--      kept showing "NN" instead of "NNN" until lease 16793 was
--      manually deactivated.
--
-- New lease pick:
--   - filter: is_active = true AND (status IS NULL OR status = 'active')
--             — so superseded leases drop out automatically
--   - order: lease_start DESC NULLS LAST,
--            lease_expiration DESC NULLS LAST (tie-break),
--            lease_id DESC (deterministic)
--
-- This makes the view robust against future placeholder rows: they can
-- have any wild expiration and still lose to a real OM-derived lease
-- with a recent start date.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_available_listings AS
SELECT al.listing_id,
    al.property_id,
    al.status,
    al.listing_date,
    al.listing_url,
    al.url,
    COALESCE(p.tenant, p.operator::character varying) AS tenant_operator,
    p.address,
    p.city,
    p.state,
    p.land_area::numeric AS land_area,
    p.year_built,
    p.building_size::numeric AS rba,
    l.rent,
    l.rent_per_sf,
    l.lease_expiration,
        CASE
            WHEN l.lease_expiration IS NOT NULL THEN round(EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone::timestamp with time zone - now()) / 86400.0 / 365.25, 1)
            ELSE NULL::numeric
        END AS term_remaining_yrs,
    l.expense_structure AS expenses,
    l.renewal_options AS bumps,
    al.last_price::numeric AS ask_price,
    al.price_per_sf,
    COALESCE(al.last_cap_rate, al.current_cap_rate, al.cap_rate) AS ask_cap,
    al.seller_name AS seller,
    al.listing_broker,
        CASE
            WHEN al.listing_date IS NOT NULL THEN CURRENT_DATE - al.listing_date
            ELSE NULL::integer
        END AS dom,
    p.operator,
    p.zip_code,
    al.initial_price,
    al.initial_cap_rate,
    al.broker_email,
    al.intake_artifact_path,
    al.intake_artifact_type
   FROM available_listings al
     JOIN LATERAL ( SELECT al2.listing_id
           FROM available_listings al2
          WHERE al2.property_id = al.property_id AND (al2.status::text = ANY (ARRAY['active'::text, 'Active'::text, 'Available'::text, 'For Sale'::text]))
          ORDER BY al2.listing_date DESC NULLS LAST, al2.listing_id DESC
         LIMIT 1) best ON al.listing_id = best.listing_id
     LEFT JOIN properties p ON al.property_id = p.property_id
     LEFT JOIN LATERAL ( SELECT ls.rent,
            ls.rent_per_sf,
            ls.lease_expiration,
            ls.expense_structure,
            ls.renewal_options
           FROM leases ls
          WHERE ls.property_id = al.property_id
            AND ls.is_active = true
            AND (ls.status IS NULL OR ls.status = 'active')
          ORDER BY ls.lease_start DESC NULLS LAST,
                   ls.lease_expiration DESC NULLS LAST,
                   ls.lease_id DESC
         LIMIT 1) l ON true
  WHERE al.status::text = ANY (ARRAY['active'::text, 'Active'::text, 'Available'::text, 'For Sale'::text]);

COMMENT ON VIEW public.v_available_listings IS
  'Active dialysis listings with property/lease rollups. Lease pick now
   orders by lease_start DESC (with status=''active'' filter), so
   placeholder rows with stale-extended expirations no longer win over
   the real current lease. Updated 2026-04-25 — see audit fix for
   property_id 29237.';
