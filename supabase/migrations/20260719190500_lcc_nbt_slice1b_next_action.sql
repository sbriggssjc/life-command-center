-- ============================================================================
-- NEXT-BEST-TOUCHPOINT #1 — Slice 1b: state-aware next_action routing
-- ----------------------------------------------------------------------------
-- Grounded live 2026-06-19: of the 670 valued accounts in v_next_best_touchpoint
-- only ~2 carry a person contact; 12 are buyer parents; ~656 are CONTACTLESS
-- orgs. So "the next best touchpoint" for almost the whole book is ACQUIRE THE
-- RIGHT CONTACT, not send an email. Per Scott's direction the engine must be
-- state-aware and route — never blindly seed a dead cadence on a contactless org.
--
-- Appends ONE column (CREATE OR REPLACE VIEW append rule — every prior column
-- keeps its position; next_action is last) routing each account by state:
--   * buyer parent (lcc_buyer_parents.parent_entity_id)  -> 'open_buy_side'
--       The existing P-BUYER buy-side contact-pick path; never a prospect
--       cadence (the R5 gate enforces that anyway).
--   * has a reachable person contact                     -> 'cadence_touch'
--       Active cadence carrying a contact_id/sf_contact_id, OR a relationship to
--       a person entity, OR (self-contactable person). The only seedable state.
--   * otherwise (contactless org)                        -> 'acquire_contact'
--       Route to contact-acquisition / P-CONTACT; do NOT mint a dead cadence.
--
-- Read-only, additive, security_invoker, cache-or-live safe. LCC Opps only.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_next_best_touchpoint
WITH (security_invoker = true) AS
WITH sf_account AS (
  SELECT DISTINCT ON (entity_id)
         entity_id,
         external_id AS sf_account_id
  FROM public.external_identities
  WHERE source_system = 'salesforce'
    AND source_type   = 'Account'
  ORDER BY entity_id, created_at DESC NULLS LAST, id DESC
),
seed AS (
  SELECT sa.entity_id, sa.sf_account_id
  FROM sf_account sa
  WHERE EXISTS (
    SELECT 1 FROM public.external_identities b
    WHERE b.entity_id = sa.entity_id
      AND b.source_type = 'true_owner'
  )
  UNION
  SELECT bo.entity_id, sa.sf_account_id
  FROM public.bd_opportunities bo
  LEFT JOIN sf_account sa ON sa.entity_id = bo.entity_id
  WHERE bo.closed_at IS NULL
    AND bo.entity_id IS NOT NULL
),
seed1 AS (
  SELECT entity_id, max(sf_account_id) AS sf_account_id
  FROM seed
  GROUP BY entity_id
),
open_opp AS (
  SELECT DISTINCT entity_id
  FROM public.bd_opportunities
  WHERE closed_at IS NULL AND entity_id IS NOT NULL
),
buyer_parent AS (
  SELECT DISTINCT parent_entity_id AS entity_id
  FROM public.lcc_buyer_parents
),
reachable AS (
  -- a person contact exists: active cadence with a contact, OR a related person,
  -- OR the account is itself a self-contactable person
  SELECT s.entity_id
  FROM seed1 s
  WHERE EXISTS (SELECT 1 FROM public.touchpoint_cadence c
                WHERE c.entity_id = s.entity_id
                  AND c.phase NOT IN ('paused','unsubscribed')
                  AND (c.contact_id IS NOT NULL
                       OR nullif(trim(c.sf_contact_id), '') IS NOT NULL))
     OR EXISTS (SELECT 1 FROM public.entity_relationships er
                JOIN public.entities pe ON pe.id = er.to_entity_id
                WHERE er.from_entity_id = s.entity_id
                  AND pe.entity_type = 'person'
                  AND pe.merged_into_entity_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.entity_relationships er
                JOIN public.entities pe ON pe.id = er.from_entity_id
                WHERE er.to_entity_id = s.entity_id
                  AND pe.entity_type = 'person'
                  AND pe.merged_into_entity_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.entities e
                WHERE e.id = s.entity_id
                  AND e.entity_type = 'person'
                  AND (nullif(trim(e.email), '') IS NOT NULL
                       OR nullif(trim(e.phone), '') IS NOT NULL))
),
pq AS (
  SELECT DISTINCT ON (entity_id) entity_id, priority_band
  FROM public.lcc_priority_queue_resolved
  ORDER BY entity_id, priority_band
),
lt AS (
  SELECT s.entity_id,
         COALESCE(
           (SELECT max(c.last_touch_at)
              FROM public.touchpoint_cadence c
             WHERE c.entity_id = s.entity_id),
           (SELECT max(a.occurred_at)
              FROM public.activity_events a
             WHERE a.entity_id = s.entity_id
               AND a.source_type = 'salesforce')
         ) AS last_touch_at
  FROM seed1 s
)
SELECT
  e.id                                              AS entity_id,
  e.name,
  e.entity_type,
  e.workspace_id,
  s.sf_account_id,
  COALESCE(NULLIF(pa.current_annual_rent_total, 0::numeric),
           cv.connected_property_value)             AS rank_value,
  CASE
    WHEN COALESCE(pa.current_annual_rent_total, 0::numeric) > 0
      THEN pa.current_property_count
    ELSE cv.connected_property_count
  END                                               AS rank_property_count,
  lt.last_touch_at,
  CASE
    WHEN lt.last_touch_at IS NULL THEN NULL
    ELSE EXTRACT(day FROM now() - lt.last_touch_at)::int
  END                                               AS days_since_touch,
  (oo.entity_id IS NOT NULL)                        AS has_open_opportunity,
  pq.priority_band,
  -- Slice 1b: state-aware routing (buyer parent > reachable > acquire contact)
  CASE
    WHEN bp.entity_id IS NOT NULL THEN 'open_buy_side'
    WHEN r.entity_id  IS NOT NULL THEN 'cadence_touch'
    ELSE 'acquire_contact'
  END                                               AS next_action
FROM seed1 s
JOIN public.entities e
  ON e.id = s.entity_id
 AND e.merged_into_entity_id IS NULL
LEFT JOIN public.v_entity_portfolio_all pa ON pa.entity_id = e.id
LEFT JOIN public.lcc_entity_connected_value cv ON cv.entity_id = e.id
LEFT JOIN lt ON lt.entity_id = e.id
LEFT JOIN open_opp oo ON oo.entity_id = e.id
LEFT JOIN pq ON pq.entity_id = e.id
LEFT JOIN buyer_parent bp ON bp.entity_id = e.id
LEFT JOIN reachable r ON r.entity_id = e.id
ORDER BY rank_value DESC NULLS LAST, lt.last_touch_at ASC NULLS FIRST;

GRANT SELECT ON public.v_next_best_touchpoint TO authenticated;

COMMENT ON VIEW public.v_next_best_touchpoint IS
  'NBT Slice 1b: one row per Scott-relevant account (SF-linked owners union open '
  'BD-opportunity accounts), value-ranked by rank_value (R34/priority-queue '
  'chain). next_action routes each account: open_buy_side (buyer parent), '
  'cadence_touch (has a person contact), or acquire_contact (contactless org). '
  'Read-only.';
