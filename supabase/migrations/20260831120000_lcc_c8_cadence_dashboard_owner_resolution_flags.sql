-- ============================================================================
-- C8 — the prospecting brief must admit RESOLVED OWNERS, not just labelled ones
-- ----------------------------------------------------------------------------
-- WHY (audit: docs/audits/C8_PROSPECTING_BRIEF_EXCLUDES_THE_BOOK_2026-08-29.md)
--
-- `handleProspectingBrief` (api/operations.js) — the operator call sheet — gates
-- on `owner_role IN (developer,user_owner,buyer,seller_flipper,operator)`. Its
-- comment states the intent correctly ("brokers and unclassified intermediaries
-- must be excluded") and `owner_role` is the WRONG INSTRUMENT for it: `unknown`
-- covers 93.9% of entities and is not in the vocabulary at all. Measured live
-- over the 311 eligible rows of this view: the gate shows 80 ($442.8M) and
-- excludes 231, of which 47 are RESOLVED PROPERTY OWNERS carrying $515.2M —
-- more rank value than everything it shows — against only 3 brokerages.
-- Easterly Gov Properties ($114.9M / 85 properties), NGP Capital, USAA Real
-- Estate, US Fed Properties Trust, Trammell Crow are all excluded.
--
-- This is C6's rule on a second surface: admit on the PER-ASSET FACT the system
-- already holds, not on the party-level label (Dead-End playbook Class 24).
--
-- WHAT THIS MIGRATION DOES — nothing but expose two facts the handler cannot
-- otherwise express. The POLICY stays in JS (`BD_OWNER_ROLES` + the composed
-- PostgREST filter); this view supplies only the two booleans PostgREST has no
-- way to compute:
--
--   is_resolved_owner  — the entity owns at least one asset in lcc_property_owner
--   is_brokerage       — lcc_owner_name_is_brokerage(entity_name)
--
-- The gate then lives in the SELECTION (a PostgREST WHERE pushed into the view),
-- so `order=rank_value.desc&limit=N` stays server-side. Filtering in JS after
-- the read would leave the ranked head full of rows nobody can work — the A5c
-- "the gate is in the SELECTION, never a surface filter" failure.
--
-- ⚠️ APPEND-ONLY. `CREATE OR REPLACE VIEW` cannot insert a column mid-list
-- (42P16), so both booleans go at the END. Every existing column keeps its
-- name, type and position; the two other consumers of this view (app.js
-- pursued-prospect cards, ops.js cadence dashboard) are unaffected.
--
-- ⚠️ THE WHOLE VIEW BODY IS RESTATED, DELIBERATELY (P194). The newest committed
-- body BY FILENAME is 20260719124500 (R20 contact_email), which does NOT carry
-- `rank_value` / `rank_property_count` / `review_flag` / `DISTINCT ON (c.id)` —
-- those live in 20260616150000 (R34), an EARLIER filename that is actually the
-- later change. R34 matches live byte-for-byte; a rebuild in filename order
-- would silently drop `rank_value`, which is the column this very handler
-- orders by. Restating the whole body here resolves that ordering ambiguity
-- permanently. A second copy that is correct beats no copy at all.
--
-- ⚠️ `is_resolved_owner` does NOT hop through `lcc_entity_survivor()`, and that
-- is a measurement, not an oversight: 0 of 8,636 `lcc_property_owner` rows point
-- at a tombstone (P160's merge-path repoint is holding). Positive-controlled —
-- the same join shape finds 326 tombstone references on
-- `lcc_decisions.subject_entity_id`, so the zero is real rather than a detector
-- that cannot fire (Class 11). If that ever regresses the flag UNDER-reports,
-- i.e. a resolved owner is excluded — it fails CLOSED, never toward admitting a
-- broker.
--
-- Discipline: additive · append-only · no data mutated · reversible (re-apply
-- the R34 body from 20260616150000 to drop both columns).
--
-- REVERSAL: re-run supabase/migrations/20260616150000_lcc_r34_cadence_dashboard_value_rank.sql
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
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
    AND c.next_touch_due < now() - interval '90 days') AS review_flag,
  -- ---- C8 (append-only) ----------------------------------------------------
  -- C8: the entity is a RESOLVED PROPERTY OWNER — it owns at least one asset in
  -- lcc_property_owner. This is the per-asset FACT that `owner_role` was being
  -- used as a (bad) proxy for. Pre-aggregated to DISTINCT so the join cannot
  -- fan out and the planner gets one hash join rather than 2,304 correlated
  -- probes (P118).
  (ro.owner_entity_id IS NOT NULL)                    AS is_resolved_owner,
  -- C8: the brokerage guard, made EXPLICIT rather than an accident of the role
  -- label. Never NULL (the function coalesces its input), so a PostgREST
  -- `is_brokerage=is.false` filter is total.
  -- ⚠️ Documented false positive (P116): the pattern matches bare \mmarcus\M /
  -- \mnai\M / \mmatthews\M, so a person or trust carrying one of those as a
  -- SURNAME trips it. Measured on this population: 4 rows match, 3 are genuine
  -- (Coldwell Banker Commercial Realty, Stan Johnson Co, Northmarq Support) and
  -- 1 is that false positive ("Clark Matthews"). The guard changes the outcome
  -- for exactly ONE of the four — Stan Johnson Co, a real brokerage — because
  -- the other three fail the owner arm anyway.
  lcc_owner_name_is_brokerage(e.name)                 AS is_brokerage
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
LEFT JOIN (
  SELECT DISTINCT owner_entity_id
  FROM public.lcc_property_owner
  WHERE owner_entity_id IS NOT NULL
) ro
  ON ro.owner_entity_id = c.entity_id
ORDER BY c.id;

GRANT SELECT ON public.v_bd_cadence_dashboard TO authenticated;

COMMENT ON VIEW public.v_bd_cadence_dashboard IS
  'Per-cadence operator dashboard: phase, step, days_until_next, days_overdue, '
  'counters, portfolio context, recipient email, rank_value (relationship '
  'value, same sources as priority-queue rank_annual_rent), rank_property_count, '
  'review_flag (>90d-overdue staleness guard), and the C8 BD-target facts '
  'is_resolved_owner (owns an asset in lcc_property_owner) + is_brokerage '
  '(lcc_owner_name_is_brokerage). DISTINCT ON (cadence_id) — exactly one row '
  'per active cadence. The BD-target POLICY lives in the handler, not here: '
  'this view states facts, api/operations.js::handleProspectingBrief composes '
  'them with BD_OWNER_ROLES.';
