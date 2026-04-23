-- ============================================================================
-- Migration: extend public.v_available_listings to expose the intake-artifact
--            columns (and keep the url / listing_url pair) so the dialysis
--            dashboard can render the marketing-collateral icon cell alongside
--            the same link behavior we shipped for gov.available_listings.
--
-- Target:    dialysis Supabase (DIA_SUPABASE_URL)
--
-- Why: gov.available_listings carries source_url + tracked_urls (jsonb) plus
--      intake_artifact_path + intake_artifact_type. The dia available_listings
--      base table was migrated to carry intake_artifact_path/type on
--      2026-04-23 but the wrapper view used by dialysis.js wasn't
--      updated, so dialysis listings still lacked the "View OM" button.
--      This reshapes the view to pass through those columns without
--      changing any existing field ordering that downstream SQL relies on
--      (we append, we don't reorder).
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
          WHERE ls.property_id = al.property_id AND ls.is_active = true
          ORDER BY ls.lease_expiration DESC NULLS LAST
         LIMIT 1) l ON true
  WHERE al.status::text = ANY (ARRAY['active'::text, 'Active'::text, 'Available'::text, 'For Sale'::text]);

COMMENT ON VIEW public.v_available_listings IS
  'Active dialysis listings with property/lease rollups. Appended intake_artifact_path + intake_artifact_type on 2026-04-23 so the LCC dialysis dashboard can render the marketing-collateral icon cell (PDF/OM + listing URL) in parity with the gov dashboard.';
