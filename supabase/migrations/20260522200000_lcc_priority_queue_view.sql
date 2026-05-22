-- ============================================================================
-- 20260522200000_lcc_priority_queue_view.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 5 (Priority queue, minimal scope)
--
-- The flagship UX surface: replaces "next call from last viewed account"
-- with a deterministically-ranked priority queue across both verticals.
-- Per audit §4, this view produces priority bands P0-P8 with reasons.
--
-- DATA DEPENDENCIES (some still need population):
--   - public.entities.owner_role         — needs sync from dia/gov true_owners
--                                          (mostly 'unknown' on LCC currently)
--   - public.touchpoint_cadence          — actively populated by existing
--                                          touchpoint logging
--   - public.bd_opportunities            — needs SF Opportunity sync (deferred)
--   - public.user_domain_specialties     — seeded with Scott (Topic 8)
--
-- This view recomputes on every read. As syncs come online, the queue
-- populates progressively. Brokers can already see touchpoint-cadence-based
-- priorities (P6, P7) immediately.
--
-- BAND DEFINITIONS (initial scope):
--   P0   — Developer overdue (entity classified as developer/user_owner Tier A
--          AND has open Prospect Opp AND next_touch_due is past)
--   P0.5 — Open BD Opportunity Needed (developer/user_owner Tier A with NO
--          open Prospect Opp — broker needs to open one)
--   P6   — Onboarding sequence step due (touchpoint_cadence.phase='onboarding'
--          AND next_touch_due <= today)
--   P7   — Steady-state cadence due (touchpoint_cadence.next_touch_due <= today
--          for any non-onboarding entity)
--   P8   — Showing-stream task (deferred — needs listing-event fan-out, Topic 10)
--
-- Additional bands (P1 lease event, P2 refi/CMBS, P3 lease milestone, P4
-- user/owner sale-leaseback, P5 seller-flipper, P9 gap-fill research) require
-- additional data and views — deferred to subsequent rounds.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_priority_queue AS
WITH entity_effective_role AS (
  SELECT
    id AS entity_id,
    workspace_id, name, domain,
    COALESCE(behavioral_override, owner_role) AS effective_owner_role,
    owner_role_confidence,
    developer_status_active_until,
    user_owner_tier,
    primary_concern
  FROM public.entities
),
open_prospect_opps AS (
  SELECT entity_id,
         COUNT(*) AS open_count,
         MIN(opened_at) AS oldest_open_at,
         array_agg(owner_user_id) FILTER (WHERE owner_user_id IS NOT NULL) AS owner_user_ids,
         array_agg(vertical) FILTER (WHERE vertical IS NOT NULL) AS verticals
  FROM public.bd_opportunities
  WHERE is_open = TRUE AND type = 'prospect'
  GROUP BY entity_id
),
cadence_state AS (
  SELECT
    entity_id, contact_id, owner_user_id, bd_opportunity_id,
    phase, priority_tier, current_touch,
    last_touch_at, next_touch_due, last_touch_type,
    domain AS cadence_domain
  FROM public.touchpoint_cadence
)
-- P0: Developer/user_owner Tier-A with open Prospect Opp + overdue cadence
SELECT
  cs.entity_id, eer.name, eer.workspace_id,
  COALESCE(cs.cadence_domain, eer.domain) AS vertical,
  cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id,
  'P0' AS priority_band,
  'developer_overdue' AS reason,
  cs.next_touch_due,
  EXTRACT(DAY FROM (NOW() - cs.next_touch_due))::int AS days_overdue,
  cs.last_touch_at, cs.last_touch_type,
  eer.effective_owner_role, eer.owner_role_confidence
FROM cadence_state cs
JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
JOIN open_prospect_opps opp ON opp.entity_id = cs.entity_id
WHERE eer.effective_owner_role = 'developer'
  AND cs.next_touch_due IS NOT NULL
  AND cs.next_touch_due <= NOW()

UNION ALL

-- P0.5: Developer with NO open Prospect Opp (broker needs to open one)
SELECT
  eer.entity_id, eer.name, eer.workspace_id,
  eer.domain AS vertical,
  NULL::uuid AS owner_user_id, NULL::uuid AS contact_id, NULL::uuid AS bd_opportunity_id,
  'P0.5' AS priority_band,
  'open_bd_opportunity_needed' AS reason,
  NULL::timestamptz AS next_touch_due,
  NULL::int AS days_overdue,
  NULL::timestamptz AS last_touch_at, NULL::text AS last_touch_type,
  eer.effective_owner_role, eer.owner_role_confidence
FROM entity_effective_role eer
LEFT JOIN open_prospect_opps opp ON opp.entity_id = eer.entity_id
WHERE eer.effective_owner_role IN ('developer', 'user_owner')
  AND opp.entity_id IS NULL  -- no open opp

UNION ALL

-- P6: Onboarding sequence step due
SELECT
  cs.entity_id, eer.name, eer.workspace_id,
  COALESCE(cs.cadence_domain, eer.domain) AS vertical,
  cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id,
  'P6' AS priority_band,
  'onboarding_step_due_' || COALESCE(cs.current_touch::text, '0') AS reason,
  cs.next_touch_due,
  EXTRACT(DAY FROM (NOW() - cs.next_touch_due))::int AS days_overdue,
  cs.last_touch_at, cs.last_touch_type,
  eer.effective_owner_role, eer.owner_role_confidence
FROM cadence_state cs
JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
WHERE cs.phase = 'onboarding'
  AND cs.next_touch_due IS NOT NULL
  AND cs.next_touch_due <= NOW()

UNION ALL

-- P7: Steady-state cadence due (non-onboarding, non-developer; default cadence)
SELECT
  cs.entity_id, eer.name, eer.workspace_id,
  COALESCE(cs.cadence_domain, eer.domain) AS vertical,
  cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id,
  'P7' AS priority_band,
  'steady_state_cadence_due' AS reason,
  cs.next_touch_due,
  EXTRACT(DAY FROM (NOW() - cs.next_touch_due))::int AS days_overdue,
  cs.last_touch_at, cs.last_touch_type,
  eer.effective_owner_role, eer.owner_role_confidence
FROM cadence_state cs
JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
WHERE COALESCE(cs.phase, 'steady_state') != 'onboarding'
  AND cs.next_touch_due IS NOT NULL
  AND cs.next_touch_due <= NOW()
  AND NOT EXISTS (
    -- Don't duplicate P0 entries
    SELECT 1 FROM open_prospect_opps opp
    WHERE opp.entity_id = cs.entity_id
      AND eer.effective_owner_role = 'developer'
  )
;

ALTER VIEW public.v_priority_queue SET (security_invoker = true);

COMMENT ON VIEW public.v_priority_queue IS
  'DEVELOPER_BD_AUDIT_v3 §4 + §7.1 A5 Topic 5 (initial scope). The flagship '
  'BD console surface. Replaces "next call from last viewed account" with '
  'deterministically-ranked priority bands. Per-user filtering via the '
  'companion v_priority_queue_for_user(user_id) function. Reads from '
  'entities, touchpoint_cadence, bd_opportunities. Populates as data '
  'syncs from dia/gov + Salesforce come online.';

-- Per-user filtered view (honors user_domain_specialties)
CREATE OR REPLACE FUNCTION public.v_priority_queue_for_user(p_user_id UUID)
RETURNS SETOF public.v_priority_queue
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT pq.*
  FROM public.v_priority_queue pq
  WHERE
    -- Show items in the user's specialty verticals
    pq.vertical IS NULL
    OR pq.vertical = ANY (
      SELECT domain FROM public.user_domain_specialties
      WHERE user_id = p_user_id AND active = TRUE AND role IN ('primary', 'secondary')
    )
    -- And/or items assigned to this user via cadence/opp
    OR pq.owner_user_id = p_user_id
  ORDER BY
    -- Sort by priority band, then by days overdue (most overdue first)
    pq.priority_band,
    COALESCE(pq.days_overdue, 0) DESC NULLS LAST,
    pq.next_touch_due DESC NULLS LAST;
$$;

COMMENT ON FUNCTION public.v_priority_queue_for_user IS
  'DEVELOPER_BD_AUDIT_v3 §4 Topic 5. Per-user filtered priority queue. '
  'Returns priority-banded BD work items for the given user, filtered by '
  'their user_domain_specialties and direct assignment. Ordered by '
  'priority band ascending, days overdue descending.';
