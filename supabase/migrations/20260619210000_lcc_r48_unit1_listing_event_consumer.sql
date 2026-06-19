-- ============================================================================
-- R48 Unit 1 — close the listing→sale ACTION loop: wire the consumer
-- ============================================================================
-- The listing→sale DATA loop is healthy, but the ACTION loop is open:
-- lcc_listing_events accumulates sale events (65 unprocessed, 0 EVER processed)
-- and two SYNC crons populate it, but NOTHING consumes it.
--
-- R21 Unit 4 (20260615132000) RETIRED the R5 fan-out machinery
-- (v_lcc_listing_event_queue + the three cohort functions +
-- lcc_mark_listing_event_processed) as a "dead path" — dead precisely because
-- it had no consumer. R48 builds the consumer (a value-ranked, human-gated
-- Decision Center lane), so per R21's OWN reasoning the machinery is no longer
-- dead and is recreated here (R21 explicitly noted: "re-applying the original
-- R5 migrations re-creates these objects"). This migration recreates them
-- (verbatim bodies from 20260522270000/280100/290000/330000) AND extends:
--   • lcc_listing_events gains processed_reason (audit: WHY processed)
--   • v_lcc_listing_event_queue gains is_sale_leaseback + rank_value (sale $)
--   • lcc_mark_listing_event_processed records a reason
--   • lcc_listing_event_auto_dismiss() — the process cron's safety valve:
--     marks processed only STALE, definitively non-actionable events so the
--     queue stays bounded; everything actionable stays for the human lane.
--   • cron lcc-listing-event-process (hourly :50, offset from the :25/:30 sync)
--
-- Reversible / additive: the recreated objects mirror the R5 originals; the new
-- column is additive; the auto-dismiss only sets processed_at (clear it to undo)
-- and is conservative (stale + no resolvable LCC party). LCC-Opps only; auth
-- schema untouched.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- processed_reason: WHY an event left the queue (human verdict or auto-dismiss)
-- ---------------------------------------------------------------------------
ALTER TABLE public.lcc_listing_events
  ADD COLUMN IF NOT EXISTS processed_reason text;

COMMENT ON COLUMN public.lcc_listing_events.processed_reason IS
  'R48: verdict that processed this event (nurture_seller / new_buyer_relationship '
  '/ pursue_cohort / flag_sale_leaseback / dismiss) or an auto-dismiss reason '
  '(stale_no_party). NULL while unprocessed.';

-- ---------------------------------------------------------------------------
-- Fan-out Lane 1: same-owner cohort (recreated verbatim from 20260522270000)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_listing_same_owner_cohort(
  p_source_domain text,
  p_source_property_id text
) RETURNS TABLE (
  owner_entity_id uuid,
  owner_name text,
  owner_role text,
  source_domain text,
  source_property_id text,
  other_property_id text,
  other_domain text,
  other_is_current boolean,
  other_ownership_start date,
  other_ownership_end date,
  other_annual_rent numeric,
  portfolio_total_property_count bigint,
  portfolio_current_property_count bigint,
  is_cross_vertical boolean,
  cadence_id uuid,
  cadence_phase text,
  current_touch int,
  next_touch_due timestamptz,
  next_touch_type text,
  days_overdue int,
  bd_opportunity_id uuid,
  bd_opportunity_open boolean
) AS $$
#variable_conflict use_column
DECLARE
  v_owner uuid;
BEGIN
  SELECT f.entity_id INTO v_owner
  FROM public.lcc_entity_portfolio_facts f
  JOIN public.entities e
    ON e.id = f.entity_id
   AND e.merged_into_entity_id IS NULL
  WHERE f.source_domain = p_source_domain
    AND f.source_property_id = p_source_property_id
    AND f.is_current = true
  ORDER BY f.ownership_start_date DESC NULLS LAST
  LIMIT 1;

  IF v_owner IS NULL THEN
    SELECT f.entity_id INTO v_owner
    FROM public.lcc_entity_portfolio_facts f
    JOIN public.entities e
      ON e.id = f.entity_id
     AND e.merged_into_entity_id IS NULL
    WHERE f.source_domain = p_source_domain
      AND f.source_property_id = p_source_property_id
    ORDER BY f.ownership_start_date DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_owner IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH owner_row AS (
    SELECT id, name, owner_role FROM public.entities WHERE id = v_owner
  ),
  portfolio_summary AS (
    SELECT p.entity_id, p.total_property_count, p.current_property_count, p.is_cross_vertical
    FROM public.v_entity_portfolio_all p WHERE p.entity_id = v_owner
  ),
  cadence AS (
    SELECT c.id, c.phase, c.current_touch, c.next_touch_due, c.next_touch_type,
      CASE WHEN c.next_touch_due IS NULL THEN 0
           WHEN c.next_touch_due > now() THEN 0
           ELSE EXTRACT(day FROM now() - c.next_touch_due)::int END AS days_overdue,
      c.bd_opportunity_id
    FROM public.touchpoint_cadence c WHERE c.entity_id = v_owner
    ORDER BY (CASE WHEN c.phase IN ('onboarding','steady_state','prospecting') THEN 0 ELSE 1 END),
             c.updated_at DESC
    LIMIT 1
  ),
  opp AS (
    SELECT id, is_open FROM public.bd_opportunities
    WHERE entity_id = v_owner AND type = 'prospect'
    ORDER BY (CASE WHEN is_open THEN 0 ELSE 1 END), opened_at DESC LIMIT 1
  ),
  other_props AS (
    SELECT f.source_property_id AS other_pid, f.source_domain AS other_dom,
      f.is_current AS other_is_cur, f.ownership_start_date AS other_start,
      f.ownership_end_date AS other_end, f.annual_rent AS other_rent
    FROM public.lcc_entity_portfolio_facts f
    WHERE f.entity_id = v_owner
      AND NOT (f.source_domain = p_source_domain AND f.source_property_id = p_source_property_id)
  ),
  shaped AS (
    SELECT o.id AS owner_entity_id, o.name AS owner_name, o.owner_role AS owner_role,
      p_source_domain AS source_domain, p_source_property_id AS source_property_id,
      x.other_pid AS other_property_id, x.other_dom AS other_domain,
      x.other_is_cur AS other_is_current, x.other_start AS other_ownership_start,
      x.other_end AS other_ownership_end, x.other_rent AS other_annual_rent,
      ps.total_property_count AS portfolio_total_property_count,
      ps.current_property_count AS portfolio_current_property_count,
      ps.is_cross_vertical AS is_cross_vertical,
      c.id AS cadence_id, c.phase AS cadence_phase, c.current_touch AS current_touch,
      c.next_touch_due AS next_touch_due, c.next_touch_type AS next_touch_type,
      c.days_overdue AS days_overdue, op.id AS bd_opportunity_id, op.is_open AS bd_opportunity_open
    FROM owner_row o
    LEFT JOIN portfolio_summary ps ON ps.entity_id = o.id
    LEFT JOIN cadence c ON true
    LEFT JOIN opp op ON true
    LEFT JOIN other_props x ON true
  )
  SELECT s.owner_entity_id, s.owner_name, s.owner_role, s.source_domain, s.source_property_id,
    s.other_property_id, s.other_domain, s.other_is_current, s.other_ownership_start,
    s.other_ownership_end, s.other_annual_rent, s.portfolio_total_property_count,
    s.portfolio_current_property_count, s.is_cross_vertical, s.cadence_id, s.cadence_phase,
    s.current_touch, s.next_touch_due, s.next_touch_type, s.days_overdue,
    s.bd_opportunity_id, s.bd_opportunity_open
  FROM shaped s
  ORDER BY s.other_is_current DESC NULLS LAST, s.other_ownership_start DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER STABLE;
GRANT EXECUTE ON FUNCTION public.lcc_listing_same_owner_cohort(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Fan-out Lane 2: buyer cohort (recreated verbatim from 20260522290000)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_listing_buyer_cohort(
  p_source_domain text, p_source_property_id text,
  p_size_tolerance_pct numeric DEFAULT 30, p_lookback_months int DEFAULT 24, p_limit int DEFAULT 30
) RETURNS TABLE (
  source_domain text, source_property_id text, buyer_entity_id uuid, buyer_name text,
  buyer_role text, buyer_role_confidence numeric, buyer_portfolio_total_property_count bigint,
  buyer_portfolio_current_property_count bigint, acquired_domain text, acquired_property_id text,
  acquired_address text, acquired_city text, acquired_state text,
  acquired_building_size_sqft numeric, acquired_at date, size_ratio numeric,
  cadence_id uuid, cadence_phase text, bd_opportunity_id uuid, bd_opportunity_open boolean
) AS $$
#variable_conflict use_column
DECLARE
  v_source_state text; v_source_size numeric; v_cutoff_date date;
BEGIN
  SELECT a.state, a.building_size_sqft INTO v_source_state, v_source_size
  FROM public.lcc_property_attributes a
  WHERE a.source_domain = p_source_domain AND a.source_property_id = p_source_property_id;
  IF v_source_state IS NULL THEN RETURN; END IF;
  v_cutoff_date := (now() - (p_lookback_months || ' months')::interval)::date;
  RETURN QUERY
  WITH candidate_props AS (
    SELECT a.source_domain, a.source_property_id, a.address, a.city, a.state, a.building_size_sqft
    FROM public.lcc_property_attributes a
    WHERE a.source_domain = p_source_domain AND a.state = v_source_state
      AND NOT (a.source_domain = p_source_domain AND a.source_property_id = p_source_property_id)
      AND (v_source_size IS NULL OR a.building_size_sqft IS NULL
        OR (a.building_size_sqft BETWEEN v_source_size * (1 - p_size_tolerance_pct / 100.0)
                                     AND v_source_size * (1 + p_size_tolerance_pct / 100.0)))
  ),
  recent_acquisitions AS (
    SELECT DISTINCT ON (f.source_domain, f.source_property_id)
      f.entity_id, f.source_domain AS acquired_domain, f.source_property_id AS acquired_property_id,
      f.ownership_start_date AS acquired_at
    FROM public.lcc_entity_portfolio_facts f
    JOIN candidate_props c ON c.source_domain = f.source_domain AND c.source_property_id = f.source_property_id
    WHERE f.is_current = true AND f.ownership_start_date IS NOT NULL AND f.ownership_start_date >= v_cutoff_date
    ORDER BY f.source_domain, f.source_property_id, f.ownership_start_date DESC
  ),
  per_buyer_best AS (
    SELECT DISTINCT ON (r.entity_id) r.entity_id, r.acquired_domain, r.acquired_property_id, r.acquired_at
    FROM recent_acquisitions r ORDER BY r.entity_id, r.acquired_at DESC
  ),
  enriched AS (
    SELECT p_source_domain AS source_domain, p_source_property_id AS source_property_id,
      e.id AS buyer_entity_id, e.name AS buyer_name, e.owner_role AS buyer_role,
      e.owner_role_confidence AS buyer_role_confidence,
      port.total_property_count AS buyer_portfolio_total_property_count,
      port.current_property_count AS buyer_portfolio_current_property_count,
      b.acquired_domain, b.acquired_property_id, ca.address AS acquired_address,
      ca.city AS acquired_city, ca.state AS acquired_state,
      ca.building_size_sqft AS acquired_building_size_sqft, b.acquired_at,
      CASE WHEN v_source_size IS NULL OR v_source_size = 0 OR ca.building_size_sqft IS NULL THEN NULL
        ELSE ROUND((ca.building_size_sqft / v_source_size)::numeric, 2) END AS size_ratio,
      cad.id AS cadence_id, cad.phase AS cadence_phase, opp.id AS bd_opportunity_id, opp.is_open AS bd_opportunity_open
    FROM per_buyer_best b
    JOIN public.entities e ON e.id = b.entity_id AND e.merged_into_entity_id IS NULL
      AND COALESCE(e.owner_role, 'unknown') <> 'unknown'
    LEFT JOIN public.lcc_property_attributes ca ON ca.source_domain = b.acquired_domain AND ca.source_property_id = b.acquired_property_id
    LEFT JOIN public.v_entity_portfolio_all port ON port.entity_id = e.id
    LEFT JOIN LATERAL (
      SELECT c.id, c.phase FROM public.touchpoint_cadence c WHERE c.entity_id = e.id
      ORDER BY (CASE WHEN c.phase IN ('onboarding','steady_state','prospecting') THEN 0 ELSE 1 END), c.updated_at DESC LIMIT 1
    ) cad ON true
    LEFT JOIN LATERAL (
      SELECT o.id, o.is_open FROM public.bd_opportunities o WHERE o.entity_id = e.id AND o.type = 'prospect'
      ORDER BY (CASE WHEN o.is_open THEN 0 ELSE 1 END), o.opened_at DESC LIMIT 1
    ) opp ON true
  )
  SELECT en.source_domain, en.source_property_id, en.buyer_entity_id, en.buyer_name, en.buyer_role,
    en.buyer_role_confidence, en.buyer_portfolio_total_property_count, en.buyer_portfolio_current_property_count,
    en.acquired_domain, en.acquired_property_id, en.acquired_address, en.acquired_city, en.acquired_state,
    en.acquired_building_size_sqft, en.acquired_at, en.size_ratio, en.cadence_id, en.cadence_phase,
    en.bd_opportunity_id, en.bd_opportunity_open
  FROM enriched en
  ORDER BY en.acquired_at DESC NULLS LAST,
    (CASE en.buyer_role WHEN 'developer' THEN 1 WHEN 'user_owner' THEN 2 WHEN 'buyer' THEN 3 WHEN 'operator' THEN 4 ELSE 9 END)
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER STABLE;
GRANT EXECUTE ON FUNCTION public.lcc_listing_buyer_cohort(text, text, numeric, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- Fan-out Lane 3: geographic neighbors (recreated verbatim from 20260522280100)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_listing_geographic_neighbors(
  p_source_domain text, p_source_property_id text, p_radius_miles numeric DEFAULT 5, p_limit int DEFAULT 50
) RETURNS TABLE (
  source_domain text, source_property_id text, neighbor_domain text, neighbor_property_id text,
  neighbor_address text, neighbor_city text, neighbor_state text, distance_miles numeric,
  neighbor_owner_entity_id uuid, neighbor_owner_name text, neighbor_owner_role text,
  neighbor_owner_role_confidence numeric, cadence_id uuid, cadence_phase text,
  bd_opportunity_id uuid, bd_opportunity_open boolean
) AS $$
#variable_conflict use_column
DECLARE
  v_lat numeric; v_lng numeric;
BEGIN
  SELECT a.latitude, a.longitude INTO v_lat, v_lng
  FROM public.lcc_property_attributes a
  WHERE a.source_domain = p_source_domain AND a.source_property_id = p_source_property_id;
  IF v_lat IS NULL OR v_lng IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT a.source_domain AS neighbor_domain, a.source_property_id AS neighbor_property_id,
      a.address AS neighbor_address, a.city AS neighbor_city, a.state AS neighbor_state,
      3959.0 * acos(LEAST(1.0, cos(radians(v_lat)) * cos(radians(a.latitude))
        * cos(radians(a.longitude) - radians(v_lng)) + sin(radians(v_lat)) * sin(radians(a.latitude))))::numeric AS distance_miles
    FROM public.lcc_property_attributes a
    WHERE a.latitude IS NOT NULL AND a.longitude IS NOT NULL
      AND NOT (a.source_domain = p_source_domain AND a.source_property_id = p_source_property_id)
      AND a.latitude BETWEEN v_lat - (p_radius_miles / 69.0) - 0.01 AND v_lat + (p_radius_miles / 69.0) + 0.01
      AND a.longitude BETWEEN v_lng - (p_radius_miles / 50.0) - 0.01 AND v_lng + (p_radius_miles / 50.0) + 0.01
  ),
  within_radius AS (
    SELECT c.* FROM candidates c WHERE c.distance_miles <= p_radius_miles ORDER BY c.distance_miles LIMIT p_limit
  ),
  current_owners AS (
    SELECT DISTINCT ON (f.source_domain, f.source_property_id) f.source_domain, f.source_property_id, f.entity_id
    FROM public.lcc_entity_portfolio_facts f
    JOIN within_radius w ON w.neighbor_domain = f.source_domain AND w.neighbor_property_id = f.source_property_id
    WHERE f.is_current = true ORDER BY f.source_domain, f.source_property_id, f.ownership_start_date DESC NULLS LAST
  ),
  enriched AS (
    SELECT p_source_domain AS source_domain, p_source_property_id AS source_property_id,
      w.neighbor_domain, w.neighbor_property_id, w.neighbor_address, w.neighbor_city, w.neighbor_state,
      ROUND(w.distance_miles, 2) AS distance_miles, e.id AS neighbor_owner_entity_id, e.name AS neighbor_owner_name,
      e.owner_role AS neighbor_owner_role, e.owner_role_confidence AS neighbor_owner_role_confidence,
      cad.id AS cadence_id, cad.phase AS cadence_phase, opp.id AS bd_opportunity_id, opp.is_open AS bd_opportunity_open
    FROM within_radius w
    LEFT JOIN current_owners co ON co.source_domain = w.neighbor_domain AND co.source_property_id = w.neighbor_property_id
    LEFT JOIN public.entities e ON e.id = co.entity_id AND e.merged_into_entity_id IS NULL
    LEFT JOIN LATERAL (
      SELECT c.id, c.phase FROM public.touchpoint_cadence c WHERE c.entity_id = e.id
      ORDER BY (CASE WHEN c.phase IN ('onboarding','steady_state','prospecting') THEN 0 ELSE 1 END), c.updated_at DESC LIMIT 1
    ) cad ON true
    LEFT JOIN LATERAL (
      SELECT o.id, o.is_open FROM public.bd_opportunities o WHERE o.entity_id = e.id AND o.type = 'prospect'
      ORDER BY (CASE WHEN o.is_open THEN 0 ELSE 1 END), o.opened_at DESC LIMIT 1
    ) opp ON true
  )
  SELECT en.source_domain, en.source_property_id, en.neighbor_domain, en.neighbor_property_id,
    en.neighbor_address, en.neighbor_city, en.neighbor_state, en.distance_miles,
    en.neighbor_owner_entity_id, en.neighbor_owner_name, en.neighbor_owner_role, en.neighbor_owner_role_confidence,
    en.cadence_id, en.cadence_phase, en.bd_opportunity_id, en.bd_opportunity_open
  FROM enriched en ORDER BY en.distance_miles;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER STABLE;
GRANT EXECUTE ON FUNCTION public.lcc_listing_geographic_neighbors(text, text, numeric, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- v_lcc_listing_event_queue — recreated + is_sale_leaseback + rank_value
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_listing_event_queue
WITH (security_invoker = true) AS
SELECT
  e.event_id, e.source_domain, e.source_property_id, e.source_event_id, e.event_date,
  e.sale_price, e.buyer_name, e.seller_name, e.cap_rate, e.data_source,
  e.detected_at, e.processed_at, e.processed_reason,
  EXTRACT(day FROM now() - e.detected_at)::int AS days_since_detected,
  pa.address AS property_address, pa.city AS property_city, pa.state AS property_state,
  pa.building_size_sqft, pa.year_built, pa.latitude, pa.longitude,
  seller.id AS seller_entity_id, seller.name AS seller_entity_name, seller.owner_role AS seller_owner_role,
  buyer.id AS buyer_entity_id, buyer.name AS buyer_entity_name, buyer.owner_role AS buyer_owner_role,
  -- value rank: the sale price drives the lane order (highest-value deal first)
  COALESCE(e.sale_price, 0) AS rank_value,
  -- sale-leaseback HINT (human-confirmed in the lane): the seller name and buyer
  -- name share a normalized leading core token, i.e. a parent buying back from /
  -- selling to its own affiliate, or the seller remaining tied to the asset.
  -- Conservative heuristic only — the operator confirms via flag_sale_leaseback.
  (e.buyer_name IS NOT NULL AND e.seller_name IS NOT NULL
   AND length(regexp_replace(lower(e.seller_name), '[^a-z0-9]', '', 'g')) >= 6
   AND left(regexp_replace(lower(e.seller_name), '[^a-z0-9]', '', 'g'), 8)
     = left(regexp_replace(lower(e.buyer_name), '[^a-z0-9]', '', 'g'), 8)
  ) AS is_sale_leaseback
FROM public.lcc_listing_events e
LEFT JOIN public.lcc_property_attributes pa
  ON pa.source_domain = e.source_domain AND pa.source_property_id = e.source_property_id
LEFT JOIN LATERAL (
  SELECT en.id, en.name, en.owner_role
  FROM public.lcc_entity_portfolio_facts f
  JOIN public.entities en ON en.id = f.entity_id AND en.merged_into_entity_id IS NULL
  WHERE f.source_domain = e.source_domain AND f.source_property_id = e.source_property_id
    AND f.ownership_end_date IS NOT NULL
  ORDER BY f.ownership_end_date DESC LIMIT 1
) seller ON true
LEFT JOIN LATERAL (
  SELECT en.id, en.name, en.owner_role
  FROM public.lcc_entity_portfolio_facts f
  JOIN public.entities en ON en.id = f.entity_id AND en.merged_into_entity_id IS NULL
  WHERE f.source_domain = e.source_domain AND f.source_property_id = e.source_property_id
    AND f.is_current = true
  ORDER BY f.ownership_start_date DESC NULLS LAST LIMIT 1
) buyer ON true;
GRANT SELECT ON public.v_lcc_listing_event_queue TO authenticated;

COMMENT ON VIEW public.v_lcc_listing_event_queue IS
  'R48: per-listing-event view (lcc_listing_events + property attributes + '
  'resolved seller/buyer entities + rank_value [sale price] + is_sale_leaseback '
  'hint). Drives the Decision Center listing_event_action lane.';

-- ---------------------------------------------------------------------------
-- lcc_mark_listing_event_processed(event_id, reason?, processed_at?)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lcc_mark_listing_event_processed(uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.lcc_mark_listing_event_processed(
  p_event_id uuid, p_reason text DEFAULT NULL, p_processed_at timestamptz DEFAULT now()
) RETURNS boolean AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.lcc_listing_events
  SET processed_at = p_processed_at, processed_reason = COALESCE(p_reason, processed_reason)
  WHERE event_id = p_event_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_mark_listing_event_processed(uuid, text, timestamptz) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- lcc_listing_event_auto_dismiss(limit) — the process cron's safety valve.
-- Conservative: only auto-dismisses STALE events (event_date > 365d old) that
-- have NO resolvable LCC buyer entity AND NO resolvable LCC seller entity AND
-- no property-attributes row — i.e. historical backfill noise with no party and
-- no asset to act on. Everything actionable (any resolvable party, any property
-- in the mirror, anything recent) stays for the human lane. Keeps the queue
-- bounded without ever auto-deciding a real BD opportunity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_listing_event_auto_dismiss(p_limit int DEFAULT 200)
RETURNS int AS $$
DECLARE v_count int;
BEGIN
  WITH stale AS (
    SELECT q.event_id
    FROM public.v_lcc_listing_event_queue q
    WHERE q.processed_at IS NULL
      AND q.event_date IS NOT NULL
      AND q.event_date < (CURRENT_DATE - 365)
      AND q.buyer_entity_id IS NULL
      AND q.seller_entity_id IS NULL
      AND q.property_address IS NULL
    ORDER BY q.event_date ASC
    LIMIT p_limit
  ), upd AS (
    UPDATE public.lcc_listing_events e
    SET processed_at = now(), processed_reason = 'auto_dismiss_stale_no_party'
    FROM stale s WHERE e.event_id = s.event_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_listing_event_auto_dismiss(int) FROM PUBLIC;

COMMIT;

-- ---------------------------------------------------------------------------
-- Process cron: hourly :50, offset from the :25/:30 listing-event SYNC crons.
-- Pure-DB safety valve (the human lane is the real consumer); only drains stale
-- no-party backfill noise so the queue stays bounded.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-listing-event-process')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-listing-event-process');
    PERFORM cron.schedule(
      'lcc-listing-event-process', '50 * * * *',
      $job$SELECT public.lcc_listing_event_auto_dismiss(200);$job$
    );
  END IF;
END;
$cron$;
