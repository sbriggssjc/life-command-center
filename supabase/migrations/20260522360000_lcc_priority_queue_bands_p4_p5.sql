-- Topic 18 (audit §11.35): priority queue bands P4 and P5.
--
-- The §11.30 round shipped P1-P3 (lease/term/10yr signals). The
-- §11.28 property attribute sync gave us year_built + year_renovated;
-- the §11.23 portfolio sync gives us ownership_start_date. Two more
-- doctrinal bands are now feasible:
--
--   P4 — recent_acquisition_streak: developer/user_owner/buyer with
--        2+ current properties acquired in the last 18 months.
--        Institutional active-acquisition mode — they're assembling
--        a portfolio NOW, so BD timing is critical.
--
--   P5 — aged_building_value_add: developer/user_owner currently
--        holding a property built >=25 years ago that hasn't been
--        renovated in the last 15 years. Classic refi / value-add /
--        recapitalization window proxy.
--
-- Same append-only column convention as §11.30; both bands emit one
-- row per qualifying entity (P4) or property (P5).

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
gov_owner_props AS (
  SELECT
    eer.entity_id, eer.name, eer.workspace_id,
    eer.effective_owner_role, eer.owner_role_confidence,
    f.source_domain, f.source_property_id,
    a.lease_expiration, a.firm_term_remaining, a.term_remaining
  FROM entity_effective_role eer
  JOIN public.lcc_entity_portfolio_facts f
    ON f.entity_id = eer.entity_id
   AND f.is_current = true AND f.source_domain = 'gov'
  JOIN public.lcc_property_attributes a
    ON a.source_domain = f.source_domain AND a.source_property_id = f.source_property_id
  WHERE eer.effective_owner_role IN ('developer','user_owner')
),
recent_acquirers AS (
  SELECT
    eer.entity_id, eer.name, eer.workspace_id, eer.domain AS vertical,
    eer.effective_owner_role, eer.owner_role_confidence,
    COUNT(*) AS recent_acq_count,
    MIN(f.ownership_start_date) AS earliest_recent_start,
    MAX(f.ownership_start_date) AS latest_recent_start
  FROM entity_effective_role eer
  JOIN public.lcc_entity_portfolio_facts f
    ON f.entity_id = eer.entity_id
   AND f.is_current = true
  WHERE eer.effective_owner_role IN ('developer','user_owner','buyer')
    AND f.ownership_start_date >= CURRENT_DATE - interval '18 months'
  GROUP BY eer.entity_id, eer.name, eer.workspace_id, eer.domain,
           eer.effective_owner_role, eer.owner_role_confidence
  HAVING COUNT(*) >= 2
),
aged_props AS (
  SELECT
    eer.entity_id, eer.name, eer.workspace_id,
    eer.effective_owner_role, eer.owner_role_confidence,
    f.source_domain, f.source_property_id,
    a.year_built, a.year_renovated
  FROM entity_effective_role eer
  JOIN public.lcc_entity_portfolio_facts f
    ON f.entity_id = eer.entity_id
   AND f.is_current = true
  JOIN public.lcc_property_attributes a
    ON a.source_domain = f.source_domain AND a.source_property_id = f.source_property_id
  WHERE eer.effective_owner_role IN ('developer','user_owner')
    AND a.year_built IS NOT NULL
    AND a.year_built > 1800   -- guard against bad-data 0 / NULL-as-0 imports
    AND a.year_built <= (EXTRACT(year FROM CURRENT_DATE)::int - 25)
    AND (a.year_renovated IS NULL
         OR a.year_renovated <= (EXTRACT(year FROM CURRENT_DATE)::int - 15))
)
-- P0
SELECT
  cs.entity_id, eer.name, eer.workspace_id,
  COALESCE(cs.cadence_domain, eer.domain) AS vertical,
  cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id,
  'P0'::text AS priority_band,
  'developer_overdue'::text AS reason,
  cs.next_touch_due,
  EXTRACT(day FROM now() - cs.next_touch_due)::int AS days_overdue,
  cs.last_touch_at, cs.last_touch_type,
  eer.effective_owner_role, eer.owner_role_confidence,
  NULL::text AS source_domain, NULL::text AS source_property_id
FROM cadence_state cs
JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
JOIN open_prospect_opps opp ON opp.entity_id = cs.entity_id
WHERE eer.effective_owner_role = 'developer'
  AND cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now()
UNION ALL
-- P0.5
SELECT
  eer.entity_id, eer.name, eer.workspace_id, eer.domain AS vertical,
  NULL::uuid, NULL::uuid, NULL::uuid,
  'P0.5'::text, 'open_bd_opportunity_needed'::text,
  NULL::timestamptz, NULL::int, NULL::timestamptz, NULL::text,
  eer.effective_owner_role, eer.owner_role_confidence,
  NULL::text, NULL::text
FROM entity_effective_role eer
LEFT JOIN open_prospect_opps opp ON opp.entity_id = eer.entity_id
WHERE eer.effective_owner_role IN ('developer','user_owner')
  AND opp.entity_id IS NULL
UNION ALL
-- P1
SELECT
  gop.entity_id, gop.name, gop.workspace_id, 'gov'::text,
  NULL::uuid, NULL::uuid, NULL::uuid,
  'P1'::text, 'lease_expiry_24mo'::text,
  NULL::timestamptz,
  EXTRACT(day FROM (gop.lease_expiration::timestamptz - now()))::int,
  NULL::timestamptz, NULL::text,
  gop.effective_owner_role, gop.owner_role_confidence,
  gop.source_domain, gop.source_property_id
FROM gov_owner_props gop
WHERE gop.lease_expiration IS NOT NULL
  AND gop.lease_expiration BETWEEN CURRENT_DATE AND (CURRENT_DATE + interval '24 months')::date
UNION ALL
-- P2
SELECT
  gop.entity_id, gop.name, gop.workspace_id, 'gov'::text,
  NULL::uuid, NULL::uuid, NULL::uuid,
  'P2'::text, 'firm_term_ending_24mo'::text,
  NULL::timestamptz, NULL::int, NULL::timestamptz, NULL::text,
  gop.effective_owner_role, gop.owner_role_confidence,
  gop.source_domain, gop.source_property_id
FROM gov_owner_props gop
WHERE gop.firm_term_remaining IS NOT NULL
  AND gop.firm_term_remaining > 0
  AND gop.firm_term_remaining < 2
UNION ALL
-- P3
SELECT
  gop.entity_id, gop.name, gop.workspace_id, 'gov'::text,
  NULL::uuid, NULL::uuid, NULL::uuid,
  'P3'::text, 'ten_year_window'::text,
  NULL::timestamptz, NULL::int, NULL::timestamptz, NULL::text,
  gop.effective_owner_role, gop.owner_role_confidence,
  gop.source_domain, gop.source_property_id
FROM gov_owner_props gop
WHERE gop.term_remaining IS NOT NULL
  AND gop.term_remaining BETWEEN 8 AND 12
UNION ALL
-- P4: recent acquisition streak (≥2 in last 18 months). Entity-level
-- band — no specific property to focus on, so source_domain/property
-- stay NULL. days_overdue is repurposed to convey the streak count
-- so the operator console can render "active mode: 3 recent acquisitions".
SELECT
  ra.entity_id, ra.name, ra.workspace_id, ra.vertical,
  NULL::uuid, NULL::uuid, NULL::uuid,
  'P4'::text,
  ('recent_acquisition_streak:' || ra.recent_acq_count)::text AS reason,
  NULL::timestamptz,
  ra.recent_acq_count::int AS days_overdue,  -- streak count
  ra.latest_recent_start::timestamptz AS last_touch_at,
  'acquisition'::text AS last_touch_type,
  ra.effective_owner_role, ra.owner_role_confidence,
  NULL::text, NULL::text
FROM recent_acquirers ra
UNION ALL
-- P5: aged-building value-add / refi window. Property-level band, one
-- row per qualifying property. days_overdue is repurposed to convey
-- the building's age in years.
SELECT
  ap.entity_id, ap.name, ap.workspace_id,
  ap.source_domain AS vertical,
  NULL::uuid, NULL::uuid, NULL::uuid,
  'P5'::text,
  ('aged_building_value_add:built_' || ap.year_built::text)::text AS reason,
  NULL::timestamptz,
  (EXTRACT(year FROM CURRENT_DATE)::int - ap.year_built) AS days_overdue,  -- building age in years
  NULL::timestamptz, NULL::text,
  ap.effective_owner_role, ap.owner_role_confidence,
  ap.source_domain, ap.source_property_id
FROM aged_props ap
UNION ALL
-- P6
SELECT
  cs.entity_id, eer.name, eer.workspace_id,
  COALESCE(cs.cadence_domain, eer.domain),
  cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id,
  'P6'::text,
  ('onboarding_step_due_' || COALESCE(cs.current_touch::text, '0'))::text,
  cs.next_touch_due,
  EXTRACT(day FROM now() - cs.next_touch_due)::int,
  cs.last_touch_at, cs.last_touch_type,
  eer.effective_owner_role, eer.owner_role_confidence,
  NULL::text, NULL::text
FROM cadence_state cs
JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
WHERE cs.phase = 'onboarding'
  AND cs.next_touch_due IS NOT NULL
  AND cs.next_touch_due <= now()
UNION ALL
-- P7
SELECT
  cs.entity_id, eer.name, eer.workspace_id,
  COALESCE(cs.cadence_domain, eer.domain),
  cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id,
  'P7'::text, 'steady_state_cadence_due'::text,
  cs.next_touch_due,
  EXTRACT(day FROM now() - cs.next_touch_due)::int,
  cs.last_touch_at, cs.last_touch_type,
  eer.effective_owner_role, eer.owner_role_confidence,
  NULL::text, NULL::text
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

COMMIT;
