-- Topic A10 Lane 3 (audit §11.28): geographic proximity fan-out.
--
-- Now that lcc_property_attributes carries lat/lng for 26.6k properties
-- (10,829 dia + 15,803 gov with coordinates), this function answers
-- the second BD fan-out question: "what other owners have properties
-- near this listing?" — useful for cohort outreach.
--
-- Uses spherical-law-of-cosines haversine arithmetic (no postgis /
-- earthdistance extensions required). Accurate to within ~0.5% under
-- 1000 miles; for the radii we care about (5–50 miles) the error is
-- negligible.

BEGIN;

CREATE OR REPLACE FUNCTION public.lcc_listing_geographic_neighbors(
  p_source_domain      text,
  p_source_property_id text,
  p_radius_miles       numeric DEFAULT 5,
  p_limit              int     DEFAULT 50
) RETURNS TABLE (
  source_domain text,
  source_property_id text,
  neighbor_domain text,
  neighbor_property_id text,
  neighbor_address text,
  neighbor_city text,
  neighbor_state text,
  distance_miles numeric,
  neighbor_owner_entity_id uuid,
  neighbor_owner_name text,
  neighbor_owner_role text,
  neighbor_owner_role_confidence numeric,
  cadence_id uuid,
  cadence_phase text,
  bd_opportunity_id uuid,
  bd_opportunity_open boolean
) AS $$
#variable_conflict use_column
DECLARE
  v_lat numeric;
  v_lng numeric;
BEGIN
  SELECT a.latitude, a.longitude INTO v_lat, v_lng
  FROM public.lcc_property_attributes a
  WHERE a.source_domain = p_source_domain
    AND a.source_property_id = p_source_property_id;

  IF v_lat IS NULL OR v_lng IS NULL THEN
    RETURN;  -- source property has no coordinates
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      a.source_domain   AS neighbor_domain,
      a.source_property_id AS neighbor_property_id,
      a.address          AS neighbor_address,
      a.city             AS neighbor_city,
      a.state            AS neighbor_state,
      3959.0 * acos(LEAST(1.0,
          cos(radians(v_lat)) * cos(radians(a.latitude))
        * cos(radians(a.longitude) - radians(v_lng))
        + sin(radians(v_lat)) * sin(radians(a.latitude))
      ))::numeric        AS distance_miles
    FROM public.lcc_property_attributes a
    WHERE a.latitude IS NOT NULL AND a.longitude IS NOT NULL
      AND NOT (a.source_domain = p_source_domain AND a.source_property_id = p_source_property_id)
      -- Coarse bounding box first (within ~1.5° in lat ~= 100 miles)
      -- before the more expensive haversine. A degree of latitude is
      -- ~69 miles; a degree of longitude varies, so we use the lat
      -- bound as a conservative upper bound on radius.
      AND a.latitude  BETWEEN v_lat - (p_radius_miles / 69.0) - 0.01
                          AND v_lat + (p_radius_miles / 69.0) + 0.01
      AND a.longitude BETWEEN v_lng - (p_radius_miles / 50.0) - 0.01
                          AND v_lng + (p_radius_miles / 50.0) + 0.01
  ),
  within_radius AS (
    SELECT c.*
    FROM candidates c
    WHERE c.distance_miles <= p_radius_miles
    ORDER BY c.distance_miles
    LIMIT p_limit
  ),
  current_owners AS (
    SELECT DISTINCT ON (f.source_domain, f.source_property_id)
      f.source_domain, f.source_property_id, f.entity_id
    FROM public.lcc_entity_portfolio_facts f
    JOIN within_radius w
      ON w.neighbor_domain = f.source_domain
     AND w.neighbor_property_id = f.source_property_id
    WHERE f.is_current = true
    ORDER BY f.source_domain, f.source_property_id, f.ownership_start_date DESC NULLS LAST
  ),
  enriched AS (
    SELECT
      p_source_domain      AS source_domain,
      p_source_property_id AS source_property_id,
      w.neighbor_domain,
      w.neighbor_property_id,
      w.neighbor_address,
      w.neighbor_city,
      w.neighbor_state,
      ROUND(w.distance_miles, 2) AS distance_miles,
      e.id          AS neighbor_owner_entity_id,
      e.name        AS neighbor_owner_name,
      e.owner_role  AS neighbor_owner_role,
      e.owner_role_confidence AS neighbor_owner_role_confidence,
      cad.id        AS cadence_id,
      cad.phase     AS cadence_phase,
      opp.id        AS bd_opportunity_id,
      opp.is_open   AS bd_opportunity_open
    FROM within_radius w
    LEFT JOIN current_owners co
      ON co.source_domain = w.neighbor_domain
     AND co.source_property_id = w.neighbor_property_id
    LEFT JOIN public.entities e
      ON e.id = co.entity_id
     AND e.merged_into_entity_id IS NULL
    LEFT JOIN LATERAL (
      SELECT c.id, c.phase
      FROM public.touchpoint_cadence c
      WHERE c.entity_id = e.id
      ORDER BY (CASE WHEN c.phase IN ('onboarding','steady_state','prospecting') THEN 0 ELSE 1 END),
               c.updated_at DESC
      LIMIT 1
    ) cad ON true
    LEFT JOIN LATERAL (
      SELECT o.id, o.is_open
      FROM public.bd_opportunities o
      WHERE o.entity_id = e.id AND o.type = 'prospect'
      ORDER BY (CASE WHEN o.is_open THEN 0 ELSE 1 END), o.opened_at DESC
      LIMIT 1
    ) opp ON true
  )
  SELECT
    en.source_domain, en.source_property_id,
    en.neighbor_domain, en.neighbor_property_id,
    en.neighbor_address, en.neighbor_city, en.neighbor_state,
    en.distance_miles,
    en.neighbor_owner_entity_id, en.neighbor_owner_name,
    en.neighbor_owner_role, en.neighbor_owner_role_confidence,
    en.cadence_id, en.cadence_phase,
    en.bd_opportunity_id, en.bd_opportunity_open
  FROM enriched en
  ORDER BY en.distance_miles;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER STABLE;

GRANT EXECUTE ON FUNCTION public.lcc_listing_geographic_neighbors(text, text, numeric, int)
  TO authenticated;

COMMENT ON FUNCTION public.lcc_listing_geographic_neighbors(text, text, numeric, int) IS
  'Topic A10 Lane 3: given a listing property, return up to p_limit other '
  'properties within p_radius_miles (haversine), with their current owner, '
  'cadence state, and opportunity state. Bounding-box pre-filter keeps it '
  'fast; no postgis dependency.';

COMMIT;
