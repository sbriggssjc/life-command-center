-- Topic A10-MVP (audit §11.27): same-owner listing fan-out.
--
-- When a new listing or sale event lands on a property, the natural BD
-- question is "who else does the current owner own, and where are we
-- with them?" This topic answers that with a single SQL function that
-- walks portfolio_facts and joins to cadence + portfolio rollup.
--
-- This is the smallest atomic slice of Topic A10. It does NOT yet do:
--   - Buyer cohort (recent buyers of similar properties — needs
--     property attribute sync)
--   - Geographic proximity (needs lat/lng sync from dia/gov)
--   - Listing-event watcher cron (the engine that fires per new listing)
--
-- But it does deliver immediate operator value: paste any
-- (source_domain, source_property_id) and get back the natural
-- cohort to talk to next.

BEGIN;

-- ---------------------------------------------------------------------------
-- lcc_listing_same_owner_cohort(p_source_domain, p_source_property_id)
--
-- Returns one row per (current_owner, other_property) edge, where the
-- current owner is whoever currently owns the source property.
--
-- Columns:
--   • owner_entity_id, owner_name, owner_role
--   • source_property_id, source_domain      ← echo back the input
--   • other_property_id, other_domain        ← every other property the
--                                              same owner has
--   • other_is_current
--   • portfolio_total_property_count
--   • portfolio_current_property_count
--   • is_cross_vertical
--   • cadence_id, cadence_phase, current_touch
--   • next_touch_due, days_overdue
--   • bd_opportunity_id, bd_opportunity_open
--
-- If the owner has no other properties (single-asset owner), the
-- function still returns ONE row with other_property_id=NULL so the
-- caller can render "this owner has no other holdings."
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
  -- Identify the current owner of the source property
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
    -- No current owner on file — caller can still get the most recent
    -- former owner via fallback to is_current=false.
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
    RETURN;  -- nothing to surface
  END IF;

  RETURN QUERY
  WITH owner_row AS (
    SELECT id, name, owner_role FROM public.entities WHERE id = v_owner
  ),
  portfolio_summary AS (
    SELECT
      p.entity_id,
      p.total_property_count,
      p.current_property_count,
      p.is_cross_vertical
    FROM public.v_entity_portfolio_all p
    WHERE p.entity_id = v_owner
  ),
  cadence AS (
    SELECT
      c.id,
      c.phase,
      c.current_touch,
      c.next_touch_due,
      c.next_touch_type,
      CASE
        WHEN c.next_touch_due IS NULL THEN 0
        WHEN c.next_touch_due > now() THEN 0
        ELSE EXTRACT(day FROM now() - c.next_touch_due)::int
      END AS days_overdue,
      c.bd_opportunity_id
    FROM public.touchpoint_cadence c
    WHERE c.entity_id = v_owner
    ORDER BY (CASE WHEN c.phase IN ('onboarding','steady_state','prospecting') THEN 0 ELSE 1 END),
             c.updated_at DESC
    LIMIT 1
  ),
  opp AS (
    SELECT id, is_open
    FROM public.bd_opportunities
    WHERE entity_id = v_owner
      AND type = 'prospect'
    ORDER BY (CASE WHEN is_open THEN 0 ELSE 1 END), opened_at DESC
    LIMIT 1
  ),
  other_props AS (
    SELECT
      f.source_property_id   AS other_pid,
      f.source_domain        AS other_dom,
      f.is_current           AS other_is_cur,
      f.ownership_start_date AS other_start,
      f.ownership_end_date   AS other_end,
      f.annual_rent          AS other_rent
    FROM public.lcc_entity_portfolio_facts f
    WHERE f.entity_id = v_owner
      AND NOT (f.source_domain = p_source_domain AND f.source_property_id = p_source_property_id)
  ),
  shaped AS (
    SELECT
      o.id           AS owner_entity_id,
      o.name         AS owner_name,
      o.owner_role   AS owner_role,
      p_source_domain      AS source_domain,
      p_source_property_id AS source_property_id,
      x.other_pid    AS other_property_id,
      x.other_dom    AS other_domain,
      x.other_is_cur AS other_is_current,
      x.other_start  AS other_ownership_start,
      x.other_end    AS other_ownership_end,
      x.other_rent   AS other_annual_rent,
      ps.total_property_count    AS portfolio_total_property_count,
      ps.current_property_count  AS portfolio_current_property_count,
      ps.is_cross_vertical       AS is_cross_vertical,
      c.id             AS cadence_id,
      c.phase          AS cadence_phase,
      c.current_touch  AS current_touch,
      c.next_touch_due AS next_touch_due,
      c.next_touch_type AS next_touch_type,
      c.days_overdue   AS days_overdue,
      op.id            AS bd_opportunity_id,
      op.is_open       AS bd_opportunity_open
    FROM owner_row o
    LEFT JOIN portfolio_summary ps ON ps.entity_id = o.id
    LEFT JOIN cadence c ON true
    LEFT JOIN opp op ON true
    LEFT JOIN other_props x ON true
  )
  SELECT
    s.owner_entity_id, s.owner_name, s.owner_role,
    s.source_domain, s.source_property_id,
    s.other_property_id, s.other_domain, s.other_is_current,
    s.other_ownership_start, s.other_ownership_end, s.other_annual_rent,
    s.portfolio_total_property_count, s.portfolio_current_property_count, s.is_cross_vertical,
    s.cadence_id, s.cadence_phase, s.current_touch,
    s.next_touch_due, s.next_touch_type, s.days_overdue,
    s.bd_opportunity_id, s.bd_opportunity_open
  FROM shaped s
  ORDER BY s.other_is_current DESC NULLS LAST,
           s.other_ownership_start DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER STABLE;

GRANT EXECUTE ON FUNCTION public.lcc_listing_same_owner_cohort(text, text) TO authenticated;

COMMENT ON FUNCTION public.lcc_listing_same_owner_cohort(text, text) IS
  'Smallest-atomic slice of Topic A10 listing-event fan-out: given any '
  '(source_domain, source_property_id), returns the current owner, '
  'every OTHER property they own, portfolio rollup, cadence state, '
  'and bd_opportunity status. Operator paste-in for "we just saw a '
  'listing — who is the owner, what else do they have, and where '
  'are we with them?"';

COMMIT;
