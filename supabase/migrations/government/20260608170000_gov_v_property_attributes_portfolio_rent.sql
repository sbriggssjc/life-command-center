-- R11 Unit 2 (2026-06-08): expose per-property rent on the gov property-
-- attributes anon view so LCC can use the REPRESENTATIVE property's rent as a
-- fallback rank for entities with no portfolio rollup (P0.4 ownership-resolution
-- band — 102 gov rows ranked at $0 today because they carry a representative
-- property but no portfolio edge).
--
-- Appends annual_rent (= gross_rent, the lease's gross annual rent) and noi to
-- the existing view. CREATE OR REPLACE is append-only for columns (42P16 if
-- inserted mid-list), so the two new columns go at the END after the federal
-- signals added in 20260522370000.
--
-- PII posture unchanged — gross_rent / noi are property-level economics, not
-- contact PII. DEPLOY ORDERING: apply BEFORE the LCC attributes-sync rent
-- extension (lcc 20260608171000), which selects these columns over PostgREST.

BEGIN;

CREATE OR REPLACE VIEW public.v_property_attributes_portfolio AS
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
  term_remaining,
  sam_active_opportunities,
  total_federal_investment,
  federal_employee_count,
  gross_rent           AS annual_rent,
  noi
FROM public.properties;

GRANT SELECT ON public.v_property_attributes_portfolio TO anon, authenticated;

COMMIT;
