-- Topic A10 Lane 2 (audit §11.29): buyer cohort fan-out.
--
-- With Lane 1 (same-owner, §11.27) and Lane 3 (geographic neighbors,
-- §11.28) shipped, this round adds the third lane: given a listing,
-- find classified entities who recently bought similar properties in
-- the same market. These are natural "buyer pool" candidates for
-- listing outreach.
--
-- "Similar" = same source_domain (asset class is implicit per vertical),
-- same state, building_size within ±size_tolerance_pct, acquired
-- within the last p_lookback_months.

BEGIN;

CREATE OR REPLACE FUNCTION public.lcc_listing_buyer_cohort(
  p_source_domain      text,
  p_source_property_id text,
  p_size_tolerance_pct numeric DEFAULT 30,
  p_lookback_months    int     DEFAULT 24,
  p_limit              int     DEFAULT 30
) RETURNS TABLE (
  source_domain text,
  source_property_id text,
  buyer_entity_id uuid,
  buyer_name text,
  buyer_role text,
  buyer_role_confidence numeric,
  buyer_portfolio_total_property_count bigint,
  buyer_portfolio_current_property_count bigint,
  acquired_domain text,
  acquired_property_id text,
  acquired_address text,
  acquired_city text,
  acquired_state text,
  acquired_building_size_sqft numeric,
  acquired_at date,
  size_ratio numeric,
  cadence_id uuid,
  cadence_phase text,
  bd_opportunity_id uuid,
  bd_opportunity_open boolean
) AS $$
#variable_conflict use_column
DECLARE
  v_source_state text;
  v_source_size  numeric;
  v_cutoff_date  date;
BEGIN
  SELECT a.state, a.building_size_sqft INTO v_source_state, v_source_size
  FROM public.lcc_property_attributes a
  WHERE a.source_domain = p_source_domain
    AND a.source_property_id = p_source_property_id;

  IF v_source_state IS NULL THEN
    RETURN;  -- can't filter without at least the state
  END IF;

  v_cutoff_date := (now() - (p_lookback_months || ' months')::interval)::date;

  RETURN QUERY
  WITH candidate_props AS (
    -- Properties in same vertical + state, with size within tolerance
    -- (or any size if source size is unknown).
    SELECT
      a.source_domain, a.source_property_id,
      a.address, a.city, a.state, a.building_size_sqft
    FROM public.lcc_property_attributes a
    WHERE a.source_domain = p_source_domain
      AND a.state = v_source_state
      AND NOT (a.source_domain = p_source_domain AND a.source_property_id = p_source_property_id)
      AND (
        v_source_size IS NULL
        OR a.building_size_sqft IS NULL
        OR (
          a.building_size_sqft BETWEEN v_source_size * (1 - p_size_tolerance_pct / 100.0)
                                   AND v_source_size * (1 + p_size_tolerance_pct / 100.0)
        )
      )
  ),
  recent_acquisitions AS (
    -- Most recent ownership edge per candidate property where
    -- acquired in the lookback window and currently held.
    SELECT DISTINCT ON (f.source_domain, f.source_property_id)
      f.entity_id,
      f.source_domain     AS acquired_domain,
      f.source_property_id AS acquired_property_id,
      f.ownership_start_date AS acquired_at
    FROM public.lcc_entity_portfolio_facts f
    JOIN candidate_props c
      ON c.source_domain = f.source_domain
     AND c.source_property_id = f.source_property_id
    WHERE f.is_current = true
      AND f.ownership_start_date IS NOT NULL
      AND f.ownership_start_date >= v_cutoff_date
    ORDER BY f.source_domain, f.source_property_id, f.ownership_start_date DESC
  ),
  per_buyer_best AS (
    -- One row per buyer entity — pick their most recent qualifying
    -- acquisition (operator only needs one "anchor" example per buyer).
    SELECT DISTINCT ON (r.entity_id)
      r.entity_id,
      r.acquired_domain,
      r.acquired_property_id,
      r.acquired_at
    FROM recent_acquisitions r
    ORDER BY r.entity_id, r.acquired_at DESC
  ),
  enriched AS (
    SELECT
      p_source_domain      AS source_domain,
      p_source_property_id AS source_property_id,
      e.id              AS buyer_entity_id,
      e.name            AS buyer_name,
      e.owner_role      AS buyer_role,
      e.owner_role_confidence AS buyer_role_confidence,
      port.total_property_count   AS buyer_portfolio_total_property_count,
      port.current_property_count AS buyer_portfolio_current_property_count,
      b.acquired_domain,
      b.acquired_property_id,
      ca.address       AS acquired_address,
      ca.city          AS acquired_city,
      ca.state         AS acquired_state,
      ca.building_size_sqft AS acquired_building_size_sqft,
      b.acquired_at,
      CASE
        WHEN v_source_size IS NULL OR v_source_size = 0 OR ca.building_size_sqft IS NULL
          THEN NULL
        ELSE ROUND((ca.building_size_sqft / v_source_size)::numeric, 2)
      END AS size_ratio,
      cad.id     AS cadence_id,
      cad.phase  AS cadence_phase,
      opp.id     AS bd_opportunity_id,
      opp.is_open AS bd_opportunity_open
    FROM per_buyer_best b
    JOIN public.entities e
      ON e.id = b.entity_id
     AND e.merged_into_entity_id IS NULL
     -- Prefer classified roles — unknown entries are noisy
     AND COALESCE(e.owner_role, 'unknown') <> 'unknown'
    LEFT JOIN public.lcc_property_attributes ca
      ON ca.source_domain = b.acquired_domain
     AND ca.source_property_id = b.acquired_property_id
    LEFT JOIN public.v_entity_portfolio_all port
      ON port.entity_id = e.id
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
    en.buyer_entity_id, en.buyer_name, en.buyer_role, en.buyer_role_confidence,
    en.buyer_portfolio_total_property_count, en.buyer_portfolio_current_property_count,
    en.acquired_domain, en.acquired_property_id,
    en.acquired_address, en.acquired_city, en.acquired_state,
    en.acquired_building_size_sqft, en.acquired_at, en.size_ratio,
    en.cadence_id, en.cadence_phase,
    en.bd_opportunity_id, en.bd_opportunity_open
  FROM enriched en
  ORDER BY en.acquired_at DESC NULLS LAST,
           -- prefer classified developers over plain buyers when tied
           (CASE en.buyer_role
              WHEN 'developer' THEN 1
              WHEN 'user_owner' THEN 2
              WHEN 'buyer' THEN 3
              WHEN 'operator' THEN 4
              ELSE 9
            END)
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER STABLE;

GRANT EXECUTE ON FUNCTION public.lcc_listing_buyer_cohort(text, text, numeric, int, int)
  TO authenticated;

COMMENT ON FUNCTION public.lcc_listing_buyer_cohort(text, text, numeric, int, int) IS
  'Topic A10 Lane 2: given a listing property, return classified '
  'entities who bought a similar property (same vertical, same state, '
  'size within ±tolerance_pct) in the last lookback_months. One row '
  'per buyer with their most recent qualifying acquisition as anchor.';

COMMIT;
