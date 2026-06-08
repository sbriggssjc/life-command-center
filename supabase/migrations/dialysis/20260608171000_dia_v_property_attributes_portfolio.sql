-- R11 Unit 2 (2026-06-08): dia property-attributes anon view with projected
-- per-property rent, so LCC's representative-property fallback rank has a dia
-- source (and so the dia attributes sync stops pulling the RAW properties table
-- — the BD-engine "extend the views, not the tables" posture the R11 audit
-- flagged for the dia leg).
--
-- Mirrors the columns the LCC attributes sync already reads from dia.properties
-- (so the finalize dia branch needs only to ADD annual_rent + noi), PLUS:
--   - annual_rent — the property's PRIMARY lease rent projected to CURRENT_DATE,
--                   identical math to v_ownership_history_portfolio /
--                   v_sales_comps (dia_project_rent_at_date). Reuses the helper.
--   - noi         — NULL for dia: dia leases are NNN (net rent), so annual_rent
--                   already is the net figure; there is no separate NOI haircut.
--
-- PRIMARY-LEASE PICK (multi-active-lease, 40 props): active lease preferred,
-- then largest leased_area, then most recent lease_start (mirrors the
-- v_sales_comps anchor selection).
--
-- PII posture: structural attributes + tenant/operator (already exposed to LCC
-- via the existing raw-properties pull) + property-level rent. No contact PII.
-- Plain (definer-privilege) view so anon can read while leases stays
-- RLS-protected. DEPLOY ORDERING: apply BEFORE the LCC attributes-sync repoint.

BEGIN;

DROP VIEW IF EXISTS public.v_property_attributes_portfolio;

CREATE VIEW public.v_property_attributes_portfolio AS
SELECT
  p.property_id,
  p.address,
  p.city,
  p.state,
  p.zip_code,
  p.county,
  p.latitude,
  p.longitude,
  p.building_size,
  p.year_built,
  p.year_renovated,
  p.building_type,
  p.property_type,
  p.tenant,
  p.operator,
  proj.rent_now AS annual_rent,
  NULL::numeric AS noi
FROM public.properties p
LEFT JOIN LATERAL (
  SELECT l.lease_start, l.annual_rent, l.rent
  FROM public.leases l
  WHERE l.property_id = p.property_id
  ORDER BY l.is_active DESC NULLS LAST,
           l.leased_area DESC NULLS LAST,
           l.lease_start DESC NULLS LAST
  LIMIT 1
) l ON true
LEFT JOIN LATERAL (
  SELECT public.dia_project_rent_at_date(
    COALESCE(
      CASE WHEN p.anchor_rent_source IN ('lease_confirmed','om_confirmed')
           THEN p.anchor_rent END,
      l.annual_rent, l.rent),
    l.lease_start, CURRENT_DATE,
    COALESCE(p.lease_bump_pct, 0.02), COALESCE(p.lease_bump_interval_mo, 12)
  ) AS rent_now
) proj ON true;

GRANT SELECT ON public.v_property_attributes_portfolio TO anon, authenticated;

COMMENT ON VIEW public.v_property_attributes_portfolio IS
  'dia structural property attributes + tenant/operator + primary-lease rent '
  'projected to CURRENT_DATE (annual_rent), exposed for LCC property-attribute '
  'sync + representative-property fallback rank (R11 Unit 2). noi is NULL (dia '
  'is NNN). Plain definer-privilege view; anon can read while leases stays '
  'RLS-protected.';

COMMIT;
