-- ============================================================================
-- W2.3 companion (gov, scknotsqkcheojiaewwh) — expose updated_at on the two
-- anon-readable portfolio views so the LCC watermark mirror sync can page by
-- `WHERE updated_at > watermark ORDER BY updated_at` instead of an offset ceiling.
--
-- Audit 3.3.4/3.3.5: the LCC pg_net mirrors (lcc_sync_property_attributes /
-- lcc_sync_property_owner_facts) paged by a hard offset ceiling (18 pages =
-- 19,000 rows) and blindly discarded inflight rows after 24h. gov has 20,175
-- properties, so the mirror sits at/near silent truncation. The fix on the LCC
-- side (companion migration 20260812140000_lcc_w2_3_watermark_mirror_sync.sql)
-- replaces the offset walk with a keyset walk on (updated_at, property_id). For
-- that to work the *source* endpoint must expose an orderable/filterable
-- `updated_at` column — these two views did not.
--
-- Both views select from `properties` (owner-facts LEFT JOINs the owner tables),
-- so the property row's updated_at is the driving change signal; owner-facts also
-- folds in the owner tables' updated_at via GREATEST so an owner-name edit (which
-- does not touch properties.updated_at) still advances the watermark.
--
-- Additive + append-only (new column at the END of the SELECT — Postgres 42P16
-- guard). SECURITY INVOKER preserved (anon-readable, non-PII slice unchanged).
-- Reversible: re-create each view without the trailing updated_at column.
-- ============================================================================

-- ── v_property_attributes_portfolio — append properties.updated_at ──────────
CREATE OR REPLACE VIEW public.v_property_attributes_portfolio
WITH (security_invoker = on) AS
SELECT property_id,
    address,
    city,
    state,
    zip_code,
    county,
    metro_area,
    latitude,
    longitude,
    rba AS building_size_sqft,
    land_acres,
    year_built,
    year_renovated,
    building_type,
    agency AS tenant_short,
    agency_full_name AS tenant_label,
    lease_commencement,
    lease_expiration,
    firm_term_remaining,
    term_remaining,
    sam_active_opportunities,
    total_federal_investment,
    federal_employee_count,
    gross_rent AS annual_rent,
    noi,
    updated_at                              -- W2.3: watermark column (append-only)
   FROM properties
  WHERE COALESCE(status, 'active'::text) <> 'archived'::text;

-- ── v_property_owner_facts_portfolio — append GREATEST(...) AS updated_at ────
-- GREATEST ignores NULL inputs (returns the largest non-null), so an unmatched
-- LEFT JOIN owner row does not null out the watermark; properties.updated_at is
-- always present.
CREATE OR REPLACE VIEW public.v_property_owner_facts_portfolio
WITH (security_invoker = on) AS
SELECT p.property_id,
    ro.name AS recorded_owner_name,
    to2.name AS true_owner_name,
    p.developer AS developer_name,
    GREATEST(p.updated_at, ro.updated_at, to2.updated_at) AS updated_at  -- W2.3
   FROM properties p
     LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
     LEFT JOIN true_owners to2 ON to2.true_owner_id = p.true_owner_id
  WHERE COALESCE(p.status, 'active'::text) <> 'archived'::text;

-- Grants persist across CREATE OR REPLACE; re-assert defensively.
GRANT SELECT ON public.v_property_attributes_portfolio  TO anon, authenticated, service_role;
GRANT SELECT ON public.v_property_owner_facts_portfolio TO anon, authenticated, service_role;

-- Verification (run post-apply):
--   SELECT count(*), min(updated_at), max(updated_at) FROM public.v_property_attributes_portfolio;
--   SELECT count(*), count(updated_at)                FROM public.v_property_owner_facts_portfolio;
--   -- updated_at must be non-null for every row (properties.updated_at NOT NULL).
