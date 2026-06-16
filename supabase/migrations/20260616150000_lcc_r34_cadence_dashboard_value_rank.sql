-- ============================================================================
-- R34 — cadence dashboard value-rank + fanout-proof + light staleness guard
-- ----------------------------------------------------------------------------
-- Three right-sized fixes to v_bd_cadence_dashboard (the cadence operator
-- surface). The cadence table is HEALTHY (437 active cadences, 0 entities with
-- duplicate active cadences); this is hygiene + presentation, NOT a cleanup.
--
-- Unit 1 — FANOUT-PROOF. The audit saw a contact render twice on the dashboard
--   even though 0 entities carry >1 active cadence — a VIEW fanout, not dup
--   rows. All current joins are 1:≤1 (v_entity_portfolio_all is GROUP BY e.id;
--   the contact + entity joins are on the PK), so the raw view is already one
--   row per cadence. To make that an INVARIANT — and to protect the new value
--   join below — the SELECT is now DISTINCT ON (c.id). count(*) ==
--   count(distinct cadence_id) holds by construction, regardless of any future
--   join target that isn't unique-per-entity (e.g. v_priority_queue_enriched,
--   which carries 153 duplicate entity_ids and must NEVER be joined naively).
--
-- Unit 2 — VALUE RANK. The view had no value column, so the operator couldn't
--   sort by relationship value — low-value contacts surfaced at the top of the
--   "ready to send" list. New append-only columns:
--     rank_value          = COALESCE(NULLIF(portfolio_rollup,0), connected_value)
--     rank_property_count = the property count behind whichever value won
--   This reuses the SAME value sources that feed the priority queue's
--   rank_annual_rent: the portfolio rollup (v_entity_portfolio_all, tier 2) and
--   the R17 connected-property value (lcc_entity_connected_value, PK per entity
--   — fanout-safe). It deliberately AVOIDS v_priority_queue_enriched (not
--   unique per entity). High-value owner relationships lead; brokers / small
--   contacts fall below — no exclusion, just honest ranking. NULLS LAST keeps
--   genuinely value-less cadences at the bottom (no faked rank). The cadence
--   dashboard API/UI orders by rank_value DESC NULLS LAST, then days_overdue.
--
-- Unit 3 — LIGHT STALENESS GUARD. New append-only `review_flag` boolean marks
--   any active (onboarding/steady_state/prospecting/buy_side/maintenance)
--   cadence that has silently sat > 90 days overdue, so the UI can surface a
--   "review / expire" flag and a future 1,314-day row never accumulates
--   unnoticed. Conservative — it SURFACES, it does not auto-expire. (The single
--   live 1,314-day abandoned row is paused below, reversibly.)
--
-- Append-only (CREATE OR REPLACE VIEW): the three new columns go at the END;
-- every existing column keeps its position/order. security_invoker preserved.
-- Additive + cache-or-live safe. Apply on LCC Opps.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_bd_cadence_dashboard
WITH (security_invoker = true) AS
SELECT DISTINCT ON (c.id)
  c.id                                                AS cadence_id,
  c.entity_id,
  e.name                                              AS entity_name,
  e.owner_role,
  e.workspace_id,
  c.domain,
  c.phase,
  c.priority_tier,
  c.current_touch,
  c.next_touch_due,
  c.next_touch_type,
  c.next_touch_template,
  CASE
    WHEN c.next_touch_due IS NULL THEN NULL
    WHEN c.next_touch_due > now()
      THEN EXTRACT(day FROM c.next_touch_due - now())::int
    ELSE -EXTRACT(day FROM now() - c.next_touch_due)::int
  END                                                 AS days_until_next,
  CASE
    WHEN c.next_touch_due IS NULL THEN 0
    WHEN c.next_touch_due > now() THEN 0
    ELSE EXTRACT(day FROM now() - c.next_touch_due)::int
  END                                                 AS days_overdue,
  c.last_touch_at,
  c.last_touch_type,
  c.last_touch_template,
  c.emails_sent,
  c.emails_opened,
  c.emails_replied,
  c.calls_made,
  c.calls_connected,
  c.meetings_scheduled,
  c.consecutive_unopened,
  c.unsubscribe_status,
  c.bd_opportunity_id,
  c.owner_user_id,
  -- Portfolio context from the §11.23 enriched view
  p.total_property_count,
  p.current_property_count,
  p.is_cross_vertical,
  -- R20: cadence contact + resolved recipient email for the draft mailto:
  c.contact_id,
  ce.email                                            AS contact_email,
  -- R34 Unit 2: relationship value (same sources as the priority queue's
  -- rank_annual_rent — portfolio rollup, then R17 connected-property value).
  COALESCE(NULLIF(p.current_annual_rent_total, 0::numeric),
           ecv.connected_property_value)              AS rank_value,
  CASE
    WHEN COALESCE(p.current_annual_rent_total, 0::numeric) > 0
      THEN p.current_property_count
    ELSE ecv.connected_property_count
  END                                                 AS rank_property_count,
  -- R34 Unit 3: light staleness guard — an active cadence silently > 90 days
  -- overdue. Surfaces a "review / expire" flag; does NOT auto-expire.
  (c.phase = ANY (ARRAY['onboarding','steady_state','prospecting','buy_side','maintenance'])
    AND c.next_touch_due IS NOT NULL
    AND c.next_touch_due < now() - interval '90 days') AS review_flag
FROM public.touchpoint_cadence c
JOIN public.entities e
  ON e.id = c.entity_id
 AND e.merged_into_entity_id IS NULL
LEFT JOIN public.v_entity_portfolio_all p
  ON p.entity_id = c.entity_id
LEFT JOIN public.entities ce
  ON ce.id = c.contact_id
LEFT JOIN public.lcc_entity_connected_value ecv
  ON ecv.entity_id = c.entity_id
ORDER BY c.id;

GRANT SELECT ON public.v_bd_cadence_dashboard TO authenticated;

COMMENT ON VIEW public.v_bd_cadence_dashboard IS
  'Per-cadence operator dashboard: phase, step, days_until_next, days_overdue, '
  'counters, portfolio context, recipient email, rank_value (relationship '
  'value, same sources as priority-queue rank_annual_rent), rank_property_count, '
  'and review_flag (>90d-overdue staleness guard). DISTINCT ON (cadence_id) — '
  'exactly one row per active cadence.';

-- ----------------------------------------------------------------------------
-- Unit 3 (one-time, reversible): pause the single >180d-overdue abandoned
-- onboarding cadence (Steve Gonzalez — next_touch_due 2022-11-10, 1,314 days
-- overdue, last touched 2022-10-13; clearly historical-import dead air). Move
-- it to the parked 'paused' phase so it leaves the active dashboard set. The
-- prior phase is stashed in metadata for a clean revert — NOT a hard delete.
-- Guarded + idempotent: a no-op if the row is gone or already paused, and a
-- no-op on any rebuilt DB where this UUID doesn't exist.
-- ----------------------------------------------------------------------------
UPDATE public.touchpoint_cadence
SET phase = 'paused',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'paused_at',         now(),
      'paused_from_phase', phase,
      'paused_reason',     'r34_unit3_stale_>180d_overdue_abandoned'),
    updated_at = now()
WHERE id = 'd725bf51-aa3a-4aa6-aa4a-58fc1c169b81'
  AND phase <> 'paused'
  AND next_touch_due < now() - interval '180 days';
