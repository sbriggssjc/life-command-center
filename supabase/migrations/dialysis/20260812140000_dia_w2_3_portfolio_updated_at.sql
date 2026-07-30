-- ============================================================================
-- W2.3 companion (dia, zqzrriwuavgrquhisnoa) — expose updated_at on the two
-- anon-readable portfolio views so the LCC watermark mirror sync can page by
-- `WHERE updated_at > watermark ORDER BY updated_at` instead of an offset ceiling.
--
-- Mirror of the gov companion (see government/20260812140000). dia is under the
-- ceiling today (~12.3k properties vs a 14-page/15,000-row ceiling) but is fixed
-- in lockstep so both domains share one keyset code path and dia can grow safely.
--
-- Additive + append-only (new column at the END of each SELECT). SECURITY INVOKER
-- preserved. Reversible: re-create each view without the trailing updated_at.
--
-- The attributes view keeps its exact existing body (the LATERAL rent projection
-- via dia_project_rent_at_date); only `p.updated_at AS updated_at` is appended.
--
-- ⚠️ These dia views are security_invoker=on but dia.properties/recorded_owners/
-- true_owners have NO anon RLS policy (unlike gov, which carries anon_read_* qual=true),
-- so they currently return [] to the anon pg_net key and the dia mirror legs no-op
-- (surfaced loudly by the W2.3 suspect_empty_source alarm). This migration is forward-
-- compatible: the moment dia anon-readability is restored (add anon_read_* to mirror
-- gov, or flip these views to security_invoker=off), the walk picks up updated_at and
-- syncs. See the LCC companion migration header for the full finding.
-- ============================================================================

-- ── v_property_attributes_portfolio — append p.updated_at ───────────────────
CREATE OR REPLACE VIEW public.v_property_attributes_portfolio
WITH (security_invoker = on) AS
SELECT p.property_id,
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
    NULL::numeric AS noi,
    p.updated_at                            -- W2.3: watermark column (append-only)
   FROM properties p
     LEFT JOIN LATERAL ( SELECT l_1.lease_start,
            l_1.annual_rent,
            l_1.rent
           FROM leases l_1
          WHERE l_1.property_id = p.property_id
          ORDER BY l_1.is_active DESC NULLS LAST, l_1.leased_area DESC NULLS LAST, l_1.lease_start DESC NULLS LAST
         LIMIT 1) l ON true
     LEFT JOIN LATERAL ( SELECT dia_project_rent_at_date(COALESCE(
                CASE
                    WHEN p.anchor_rent_source = ANY (ARRAY['lease_confirmed'::text, 'om_confirmed'::text]) THEN p.anchor_rent
                    ELSE NULL::numeric
                END, l.annual_rent, l.rent), l.lease_start, CURRENT_DATE, COALESCE(p.lease_bump_pct, 0.02), COALESCE(p.lease_bump_interval_mo, 12)) AS rent_now) proj ON true;

-- ── v_property_owner_facts_portfolio — append GREATEST(...) AS updated_at ────
CREATE OR REPLACE VIEW public.v_property_owner_facts_portfolio
WITH (security_invoker = on) AS
SELECT p.property_id,
    ro.name AS recorded_owner_name,
    to2.name AS true_owner_name,
    p.developer AS developer_name,
    GREATEST(p.updated_at, ro.updated_at, to2.updated_at) AS updated_at  -- W2.3
   FROM properties p
     LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
     LEFT JOIN true_owners to2 ON to2.true_owner_id = p.true_owner_id;

GRANT SELECT ON public.v_property_attributes_portfolio  TO anon, authenticated, service_role;
GRANT SELECT ON public.v_property_owner_facts_portfolio TO anon, authenticated, service_role;

-- Verification (run post-apply):
--   SELECT count(*), min(updated_at), max(updated_at) FROM public.v_property_attributes_portfolio;
--   SELECT count(*), count(updated_at)                FROM public.v_property_owner_facts_portfolio;
