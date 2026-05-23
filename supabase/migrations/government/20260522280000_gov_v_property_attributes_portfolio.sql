-- Topic 12 (audit §11.28): expose a slim, anon-readable property
-- attributes view for LCC's listing-fan-out and priority queue work.
--
-- gov.properties is RLS-protected and carries financial fields (noi,
-- expenses, treasury_spread, ...) that the LCC BD layer doesn't need.
-- This view exposes only the structural attributes — address, lat/lng,
-- size, year, type, agency identity — and grants SELECT to anon.
-- Mirrors the same pattern already in place for true_owners and
-- v_ownership_history_portfolio.

BEGIN;

DROP VIEW IF EXISTS public.v_property_attributes_portfolio;

CREATE VIEW public.v_property_attributes_portfolio AS
SELECT
  property_id,
  address,
  city,
  state,
  zip_code,
  county,
  metro_area,
  latitude,
  longitude,
  rba                  AS building_size_sqft,
  land_acres,
  year_built,
  year_renovated,
  building_type,
  agency               AS tenant_short,
  agency_full_name     AS tenant_label,
  lease_commencement,
  lease_expiration,
  firm_term_remaining,
  term_remaining
FROM public.properties;

GRANT SELECT ON public.v_property_attributes_portfolio TO anon, authenticated;

COMMENT ON VIEW public.v_property_attributes_portfolio IS
  'Non-financial structural attributes of gov.properties exposed for '
  'LCC listing-event fan-out + future priority queue bands. SECURITY '
  'DEFINER (default) so anon can read while properties itself stays '
  'RLS-protected. PII-free — agency_full_name is government agency '
  'identity, not personal contact info.';

COMMIT;
