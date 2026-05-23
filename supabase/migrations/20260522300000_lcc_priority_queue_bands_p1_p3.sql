-- Topic 13 (audit §11.30): expand priority queue bands P1-P3.
--
-- The §11.19 priority queue defined four bands (P0 developer overdue,
-- P0.5 no opp yet, P6 onboarding due, P7 steady-state due). With the
-- §11.28 property attribute sync in place, we can light up the next
-- three bands that the doctrine calls for:
--
--   P1 — lease_expiry_24mo:     developer/user_owner with a gov
--                                property whose lease_expiration is
--                                in the next 0-24 months.
--   P2 — firm_term_ending_24mo: same role universe, gov property with
--                                firm_term_remaining < 2 years (the
--                                window where government can let
--                                go-to-market or terminate at-will).
--   P3 — ten_year_window:       gov property with term_remaining
--                                between 8 and 12 years — the classic
--                                long-tail "10 year remaining"
--                                re-engagement signal.
--
-- All three bands include the specific source_property_id that
-- triggered the signal, so the operator can lead the conversation
-- with the right asset. Adds two nullable columns to v_priority_queue
-- (source_domain, source_property_id) — propagated through
-- v_priority_queue_enriched.

BEGIN;

CREATE OR REPLACE VIEW public.v_priority_queue
WITH (security_invoker = true) AS
WITH entity_effective_role AS (
  SELECT
    entities.id AS entity_id,
    entities.workspace_id,
    entities.name,
    entities.domain,
    COALESCE(entities.behavioral_override, entities.owner_role) AS effective_owner_role,
    entities.owner_role_confidence,
    entities.developer_status_active_until,
    entities.user_owner_tier,
    entities.primary_concern
  FROM public.entities
  WHERE entities.merged_into_entity_id IS NULL
),
open_prospect_opps AS (
  SELECT
    bd_opportunities.entity_id,
    COUNT(*) AS open_count,
    MIN(bd_opportunities.opened_at) AS oldest_open_at,
    array_agg(bd_opportunities.owner_user_id) FILTER (WHERE bd_opportunities.owner_user_id IS NOT NULL) AS owner_user_ids,
    array_agg(bd_opportunities.vertical) FILTER (WHERE bd_opportunities.vertical IS NOT NULL) AS verticals
  FROM public.bd_opportunities
  WHERE bd_opportunities.is_open = true
    AND bd_opportunities.type = 'prospect'
  GROUP BY bd_opportunities.entity_id
),
cadence_state AS (
  SELECT
    touchpoint_cadence.entity_id,
    touchpoint_cadence.contact_id,
    touchpoint_cadence.owner_user_id,
    touchpoint_cadence.bd_opportunity_id,
    touchpoint_cadence.phase,
    touchpoint_cadence.priority_tier,
    touchpoint_cadence.current_touch,
    touchpoint_cadence.last_touch_at,
    touchpoint_cadence.next_touch_due,
    touchpoint_cadence.last_touch_type,
    touchpoint_cadence.domain AS cadence_domain
  FROM public.touchpoint_cadence
),
-- P1/P2/P3 candidates: gov properties owned by classified developers /
-- user_owners with lease/term signals.
gov_owner_props AS (
  SELECT
    eer.entity_id,
    eer.name,
    eer.workspace_id,
    eer.effective_owner_role,
    eer.owner_role_confidence,
    f.source_domain,
    f.source_property_id,
    a.lease_expiration,
    a.firm_term_remaining,
    a.term_remaining
  FROM entity_effective_role eer
  JOIN public.lcc_entity_portfolio_facts f
    ON f.entity_id = eer.entity_id
   AND f.is_current = true
   AND f.source_domain = 'gov'
  JOIN public.lcc_property_attributes a
    ON a.source_domain = f.source_domain
   AND a.source_property_id = f.source_property_id
  WHERE eer.effective_owner_role IN ('developer','user_owner')
)
-- P0: developer with open opp + overdue cadence
SELECT cs.entity_id,
  eer.name,
  eer.workspace_id,
  COALESCE(cs.cadence_domain, eer.domain) AS vertical,
  cs.owner_user_id,
  cs.contact_id,
  cs.bd_opportunity_id,
  'P0'::text AS priority_band,
  'developer_overdue'::text AS reason,
  cs.next_touch_due,
  EXTRACT(day FROM now() - cs.next_touch_due)::int AS days_overdue,
  cs.last_touch_at,
  cs.last_touch_type,
  eer.effective_owner_role,
  eer.owner_role_confidence,
  NULL::text AS source_domain,
  NULL::text AS source_property_id
FROM cadence_state cs
JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
JOIN open_prospect_opps opp ON opp.entity_id = cs.entity_id
WHERE eer.effective_owner_role = 'developer'
  AND cs.next_touch_due IS NOT NULL
  AND cs.next_touch_due <= now()

UNION ALL

-- P0.5: developer/user_owner without an open prospect opportunity yet
SELECT eer.entity_id,
  eer.name,
  eer.workspace_id,
  eer.domain AS vertical,
  NULL::uuid AS owner_user_id,
  NULL::uuid AS contact_id,
  NULL::uuid AS bd_opportunity_id,
  'P0.5'::text AS priority_band,
  'open_bd_opportunity_needed'::text AS reason,
  NULL::timestamptz AS next_touch_due,
  NULL::int AS days_overdue,
  NULL::timestamptz AS last_touch_at,
  NULL::text AS last_touch_type,
  eer.effective_owner_role,
  eer.owner_role_confidence,
  NULL::text AS source_domain,
  NULL::text AS source_property_id
FROM entity_effective_role eer
LEFT JOIN open_prospect_opps opp ON opp.entity_id = eer.entity_id
WHERE eer.effective_owner_role IN ('developer','user_owner')
  AND opp.entity_id IS NULL

UNION ALL

-- P1: lease expiry imminent (within 0-24 months)
SELECT gop.entity_id,
  gop.name,
  gop.workspace_id,
  'gov'::text AS vertical,
  NULL::uuid AS owner_user_id,
  NULL::uuid AS contact_id,
  NULL::uuid AS bd_opportunity_id,
  'P1'::text AS priority_band,
  'lease_expiry_24mo'::text AS reason,
  NULL::timestamptz AS next_touch_due,
  EXTRACT(day FROM (gop.lease_expiration::timestamptz - now()))::int AS days_overdue,
  NULL::timestamptz AS last_touch_at,
  NULL::text AS last_touch_type,
  gop.effective_owner_role,
  gop.owner_role_confidence,
  gop.source_domain,
  gop.source_property_id
FROM gov_owner_props gop
WHERE gop.lease_expiration IS NOT NULL
  AND gop.lease_expiration BETWEEN CURRENT_DATE AND (CURRENT_DATE + interval '24 months')::date

UNION ALL

-- P2: firm term ending soon (<24 months remaining)
-- firm_term_remaining is in years
SELECT gop.entity_id,
  gop.name,
  gop.workspace_id,
  'gov'::text AS vertical,
  NULL::uuid AS owner_user_id,
  NULL::uuid AS contact_id,
  NULL::uuid AS bd_opportunity_id,
  'P2'::text AS priority_band,
  'firm_term_ending_24mo'::text AS reason,
  NULL::timestamptz AS next_touch_due,
  NULL::int AS days_overdue,
  NULL::timestamptz AS last_touch_at,
  NULL::text AS last_touch_type,
  gop.effective_owner_role,
  gop.owner_role_confidence,
  gop.source_domain,
  gop.source_property_id
FROM gov_owner_props gop
WHERE gop.firm_term_remaining IS NOT NULL
  AND gop.firm_term_remaining > 0
  AND gop.firm_term_remaining < 2

UNION ALL

-- P3: classic 10-year-remaining re-engagement window (8-12 years out)
SELECT gop.entity_id,
  gop.name,
  gop.workspace_id,
  'gov'::text AS vertical,
  NULL::uuid AS owner_user_id,
  NULL::uuid AS contact_id,
  NULL::uuid AS bd_opportunity_id,
  'P3'::text AS priority_band,
  'ten_year_window'::text AS reason,
  NULL::timestamptz AS next_touch_due,
  NULL::int AS days_overdue,
  NULL::timestamptz AS last_touch_at,
  NULL::text AS last_touch_type,
  gop.effective_owner_role,
  gop.owner_role_confidence,
  gop.source_domain,
  gop.source_property_id
FROM gov_owner_props gop
WHERE gop.term_remaining IS NOT NULL
  AND gop.term_remaining BETWEEN 8 AND 12

UNION ALL

-- P6: onboarding step overdue
SELECT cs.entity_id,
  eer.name,
  eer.workspace_id,
  COALESCE(cs.cadence_domain, eer.domain) AS vertical,
  cs.owner_user_id,
  cs.contact_id,
  cs.bd_opportunity_id,
  'P6'::text AS priority_band,
  ('onboarding_step_due_' || COALESCE(cs.current_touch::text, '0'))::text AS reason,
  cs.next_touch_due,
  EXTRACT(day FROM now() - cs.next_touch_due)::int AS days_overdue,
  cs.last_touch_at,
  cs.last_touch_type,
  eer.effective_owner_role,
  eer.owner_role_confidence,
  NULL::text AS source_domain,
  NULL::text AS source_property_id
FROM cadence_state cs
JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
WHERE cs.phase = 'onboarding'
  AND cs.next_touch_due IS NOT NULL
  AND cs.next_touch_due <= now()

UNION ALL

-- P7: steady-state cadence due (anything not in onboarding, not in P0)
SELECT cs.entity_id,
  eer.name,
  eer.workspace_id,
  COALESCE(cs.cadence_domain, eer.domain) AS vertical,
  cs.owner_user_id,
  cs.contact_id,
  cs.bd_opportunity_id,
  'P7'::text AS priority_band,
  'steady_state_cadence_due'::text AS reason,
  cs.next_touch_due,
  EXTRACT(day FROM now() - cs.next_touch_due)::int AS days_overdue,
  cs.last_touch_at,
  cs.last_touch_type,
  eer.effective_owner_role,
  eer.owner_role_confidence,
  NULL::text AS source_domain,
  NULL::text AS source_property_id
FROM cadence_state cs
JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
WHERE COALESCE(cs.phase, 'steady_state') <> 'onboarding'
  AND cs.next_touch_due IS NOT NULL
  AND cs.next_touch_due <= now()
  AND NOT EXISTS (
    SELECT 1 FROM open_prospect_opps opp
    WHERE opp.entity_id = cs.entity_id
      AND eer.effective_owner_role = 'developer'
  );

-- ---------------------------------------------------------------------------
-- Propagate new columns through v_priority_queue_enriched.
--
-- NOTE: CREATE OR REPLACE VIEW can only ADD columns at the end; if you try
-- to insert new columns in the middle of the existing column list, Postgres
-- treats it as a rename and rejects (42P16). So the new property-context
-- columns are appended after the existing portfolio rollup columns even
-- though logically they "belong" alongside the source_domain/property_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_priority_queue_enriched
WITH (security_invoker = true) AS
SELECT
  q.entity_id,
  q.name,
  q.workspace_id,
  q.vertical,
  q.owner_user_id,
  q.contact_id,
  q.bd_opportunity_id,
  q.priority_band,
  q.reason,
  q.next_touch_due,
  q.days_overdue,
  q.last_touch_at,
  q.last_touch_type,
  q.effective_owner_role,
  q.owner_role_confidence,
  COALESCE(p.total_property_count, 0)      AS total_property_count,
  COALESCE(p.current_property_count, 0)    AS current_property_count,
  COALESCE(p.dia_property_count, 0)        AS dia_property_count,
  COALESCE(p.gov_property_count, 0)        AS gov_property_count,
  COALESCE(p.is_cross_vertical, false)     AS is_cross_vertical,
  p.earliest_acquisition_date,
  p.latest_acquisition_date,
  p.latest_disposition_date,
  COALESCE(p.current_annual_rent_total, 0) AS current_annual_rent_total,
  p.avg_cap_rate,
  -- New columns appended for P1-P3 property context
  q.source_domain,
  q.source_property_id,
  pa.address              AS source_property_address,
  pa.city                 AS source_property_city,
  pa.state                AS source_property_state,
  pa.lease_expiration     AS source_property_lease_expiration,
  pa.firm_term_remaining  AS source_property_firm_term_remaining,
  pa.term_remaining       AS source_property_term_remaining
FROM public.v_priority_queue q
LEFT JOIN public.v_entity_portfolio_all p
  ON p.entity_id = q.entity_id
LEFT JOIN public.lcc_property_attributes pa
  ON pa.source_domain = q.source_domain
 AND pa.source_property_id = q.source_property_id;

GRANT SELECT ON public.v_priority_queue          TO authenticated;
GRANT SELECT ON public.v_priority_queue_enriched TO authenticated;

COMMIT;
