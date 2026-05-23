-- Topic 19 prep (audit §11.36): extend gov.v_property_attributes_portfolio
-- with the federal-activity columns LCC needs for P8/P9 priority bands.
--
-- Adds:
--   sam_active_opportunities   — gov tenant's active SAM solicitations
--   total_federal_investment   — cumulative federal $ at this address
--   federal_employee_count     — agency headcount (operational anchor)
--
-- All are non-PII; sam_active_opportunities and federal_employee_count
-- are publicly-published GSA / OPM figures.

BEGIN;

DROP VIEW IF EXISTS public.v_property_attributes_portfolio;

CREATE VIEW public.v_property_attributes_portfolio AS
SELECT
  property_id,
  address, city, state, zip_code, county, metro_area,
  latitude, longitude,
  rba AS building_size_sqft,
  land_acres,
  year_built, year_renovated,
  building_type,
  agency AS tenant_short,
  agency_full_name AS tenant_label,
  lease_commencement, lease_expiration,
  firm_term_remaining, term_remaining,
  sam_active_opportunities,
  total_federal_investment,
  federal_employee_count
FROM public.properties;

GRANT SELECT ON public.v_property_attributes_portfolio TO anon, authenticated;

COMMENT ON VIEW public.v_property_attributes_portfolio IS
  'Non-financial structural attributes + federal-activity signals '
  '(sam_active_opportunities, total_federal_investment, federal'
  '_employee_count) for the LCC priority queue. SECURITY DEFINER '
  'default so anon can read while properties stays RLS-protected.';

COMMIT;
