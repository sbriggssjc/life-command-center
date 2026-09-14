-- ============================================================================
-- C11 — the call sheet names a person; the view must say WHY they are the contact
-- ----------------------------------------------------------------------------
-- WHY (audit: docs/audits/C11_CALL_SHEET_CONTACT_BASIS_2026-08-31.md; found as
-- C10b in docs/audits/C10_PROSPECTING_BRIEF_COLUMN_MAPPING_2026-08-31.md §8)
--
-- C10 made the operator call sheet legible — real owner names, real portfolio
-- values. It did NOT make the CONTACT justified. The sheet prints a name and a
-- dollar figure and no basis for either, and now that it is legible it will
-- confidently name a person at the wrong firm.
--
-- The basis is already recorded and simply never read. Measured live 2026-08-31
-- over the 126 eligible rows: 121 carry an `entity_relationships` edge from the
-- OWNER to the CADENCE CONTACT whose role is on file —
--   prospecting_contact 58 · institution_decision_maker 35 · manager 15 ·
--   works_at 12 · decision_maker 1 — and 5 carry no edge at all.
--
-- ⚠️ `works_at` is the SALESFORCE ORG EDGE P161 MEASURED AND DISQUALIFIED as
-- evidence of control (8,506 of them, created in one 2026-07/08 window). It
-- proves association, never authority. It must not render like `decision_maker`,
-- and 3 of the current top 10 by portfolio value carry it (USAA Real Estate
-- $62.0M, Gba Associates $27.2M, Beacon Capital Partners $23.8M) — so the label
-- is not a corner case, it is the head of the sheet.
--
-- WHAT THIS MIGRATION DOES — nothing but expose two facts the handler cannot
-- otherwise express, exactly as C8 did for `is_resolved_owner`/`is_brokerage`.
-- The POLICY (how a role is rendered, what is flagged) stays in JS.
--
--   contact_owner_role            — the role recorded on the owner->contact edge
--   contact_domain_confirms_owner — P197's employer-corroboration signal, as an
--                                   ADDITIVE positive only (see below)
--
-- ⚠️ THE CORROBORATION FLAG IS A PLUS, NEVER A MINUS, AND THIS IS NOT A STYLE
-- CHOICE. P188 established the asymmetry on named rows: a real employee can use
-- a personal address. Easterly's own confirmed contact sits on `@centurytel.net`.
-- A false here means "we hold no corroboration", NEVER "wrong person". Anything
-- that filters, ranks or demotes on this column re-creates the Class 24 mistake
-- C8 has just finished undoing on this very surface.
--
-- ⚠️ AND THE CORROBORATION COUNT IN THE C10b WRITE-UP WAS AN ARGUMENT-SHAPE
-- ARTIFACT — IT IS 22 OF 113, NOT 16. `lcc_tier0_company_confirms_domain(company,
-- p_sldn)` does BIDIRECTIONAL substring containment between
-- `lcc_owner_domain_core(company)` and `p_sldn`; `p_sldn` is the SECOND-LEVEL
-- LABEL, not the whole domain. Passing `beaconcapital.com` where the function
-- wants `beaconcapital` silently kills the reverse arm (an owner core never
-- contains a `.com`), so the domain-abbreviates-the-owner case is lost. Six rows,
-- all genuine, all read correct on named rows: `truist.com` for Truist Bank,
-- `brookfield.com` for Brookfield Asset Management, `highwoods.com` for Highwoods
-- Properties, `beaconcapital.com` for Beacon Capital Partners,
-- `acquestdevelopment.com` for Acquest Development LLC, and `tiaa-cref.org` for
-- TIAA CREF (the hyphen — recovered only by the alphanumeric strip). This view
-- REUSES the Tier 0 candidate view's own `sldn` expression verbatim rather than
-- inventing a second one; a JS or ad-hoc copy of a normaliser is the drift this
-- codebase keeps paying for. Note `lower()` runs BEFORE the `[^a-z0-9]` strip —
-- the other order deletes every uppercase character.
--
-- ⚠️ APPEND-ONLY. `CREATE OR REPLACE VIEW` cannot insert a column mid-list
-- (42P16), so both go at the END, positions 38 and 39. Columns 1..37 keep their
-- name, type and position; the two other consumers of this view (app.js
-- pursued-prospect cards, ops.js cadence dashboard) are unaffected.
--
-- ⚠️ THE WHOLE VIEW BODY IS RESTATED, DELIBERATELY (P194). C8's own header
-- explains why: the newest committed body BY FILENAME is 20260719124500, which
-- does not carry `rank_value`. Verified before writing this: the live view has
-- exactly the 37 columns C8's committed body produces, in order, so C8 IS the
-- live body and this restates it faithfully.
--
-- ⚠️ WHY A LATERAL AND NOT A PRE-AGGREGATED HASH JOIN — MEASURED, NOT ASSUMED.
-- The C8 precedent pre-aggregates (`SELECT DISTINCT owner_entity_id FROM
-- lcc_property_owner`) precisely to avoid a correlated probe, so that was the
-- obvious shape. It is the wrong one here: `entity_relationships` holds 115,726
-- rows against `lcc_property_owner`'s 8,636, and a `DISTINCT ON (from, to)`
-- pre-aggregate materialises the whole table on every read. Measured on the
-- handler's REAL query shape (its filters + `order=rank_value.desc.nullslast,
-- days_overdue.desc.nullslast&limit=10`), same session:
--
--   baseline (no basis columns)   275-282 ms   99,528 buffers
--   LATERAL, this migration       253-259 ms  106,126 buffers   (+6.6% buffers)
--   pre-aggregated DISTINCT ON    649 ms      184,857 buffers   (2.6x slower)
--
-- The LATERAL is an index probe (`idx_relationships_from` + `idx_relationships_to`
-- BitmapAnd) at loops=2304, ~8,613 buffers. Raw timing is session-variable, so
-- the durable evidence is the buffer count and the plan shape, not the clock.
--
-- ⚠️ FAN-OUT: `entity_relationships` has NO unique constraint on
-- (from, to, type) — P177 says so explicitly — so a plain LEFT JOIN could
-- multiply rows. Measured today: 753 of 1,702 cadence pairs carry an edge,
-- max_edges = 1, and 0 rows carry conflicting roles. The `LIMIT 1` makes that
-- structural rather than lucky, and the ORDER BY makes the pick DETERMINISTIC
-- (a still-effective edge beats an ended one, then newest, then id) instead of
-- whatever the plan happened to emit.
--
-- ⚠️ DIRECTION IS OWNER -> CONTACT ONLY, and that is a measurement: across all
-- 1,702 cadence pairs there are 753 forward edges and ZERO reverse-only ones.
-- Probing both directions would double the cost for a population of 0. If a
-- reverse edge is ever written this column reads NULL and the sheet says "no
-- relationship on file" — it fails toward UNDER-claiming, never toward inventing
-- an authority we do not hold.
--
-- ⚠️ THE `relationship_type` FALLBACK IS INERT TODAY AND KEPT ANYWAY: all 753
-- edges carry `metadata->>'role'`, and `relationship_type` is `associated_with`
-- on all 753 — a token that states an edge exists without stating a role. If the
-- fallback ever fires the sheet prints it verbatim, which is honest. The role
-- vocabulary is NOT closed (`MGR`, `broker_of_record`, `economic_owner_contact`
-- each appear once or twice fleet-wide), so no consumer may assume a fixed set.
--
-- Discipline: additive · append-only · no data mutated · no gate, order or limit
-- touched · reversible (re-apply the C8 body to drop both columns).
--
-- REVERSAL: re-run supabase/migrations/20260831120000_lcc_c8_cadence_dashboard_owner_resolution_flags.sql
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
  lcc_owner_name_is_brokerage(e.name)                 AS is_brokerage,
  -- ---- C11 (append-only) ---------------------------------------------------
  -- C11: WHY is this person the contact for this owner? The role recorded on the
  -- owner->contact edge. NULL means "no relationship on file", which is a
  -- different fact from a weak role and must be rendered as such (P180) — never
  -- as an empty string, which reads as "no role".
  cr.contact_owner_role,
  -- C11: P197's employer corroboration — does the contact's own mailbox domain
  -- agree with the owner's name? ADDITIVE POSITIVE ONLY. NULL where there is no
  -- email to test; FALSE means "no corroboration on file", NEVER "wrong person"
  -- (P188). 22 of the 113 eligible rows carrying an email read true.
  --
  -- ⚠️ Computed HERE and not inside the role LATERAL, deliberately. The two
  -- facts are independent: corroboration is a property of (owner name, contact
  -- mailbox) and does not need an edge to exist. Folding it into the LATERAL
  -- would make it NULL for every edge-less row — and all 5 such rows in the
  -- eligible population DO carry an email, so "no relationship on file" would
  -- have silently swallowed a computable signal.
  CASE
    WHEN ce.email IS NULL OR ce.email NOT LIKE '%@%' THEN NULL
    ELSE public.lcc_tier0_company_confirms_domain(
           e.name,
           -- verbatim from v_lcc_tier0_owner_contact_candidates' own `sldn`
           regexp_replace(lower(split_part(split_part(ce.email, '@', 2), '.', 1)),
                          '[^a-z0-9]', '', 'g'))
  END                                                 AS contact_domain_confirms_owner
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
LEFT JOIN LATERAL (
  SELECT COALESCE(NULLIF(btrim(r.metadata->>'role'), ''), r.relationship_type) AS contact_owner_role
  FROM public.entity_relationships r
  WHERE r.from_entity_id = c.entity_id
    AND r.to_entity_id   = c.contact_id
  ORDER BY (r.effective_to IS NULL) DESC, r.created_at DESC, r.id
  LIMIT 1
) cr ON true
ORDER BY c.id;

GRANT SELECT ON public.v_bd_cadence_dashboard TO authenticated;

COMMENT ON VIEW public.v_bd_cadence_dashboard IS
  'Per-cadence operator dashboard: phase, step, days_until_next, days_overdue, '
  'counters, portfolio context, recipient email, rank_value (relationship '
  'value, same sources as priority-queue rank_annual_rent), rank_property_count, '
  'review_flag (>90d-overdue staleness guard), the C8 BD-target facts '
  'is_resolved_owner (owns an asset in lcc_property_owner) + is_brokerage '
  '(lcc_owner_name_is_brokerage), and the C11 contact-basis facts '
  'contact_owner_role (the role on the owner->contact entity_relationships edge; '
  'NULL = no relationship on file) + contact_domain_confirms_owner (P197 '
  'employer corroboration — an ADDITIVE POSITIVE; false means no corroboration '
  'on file, never "wrong person"). DISTINCT ON (cadence_id) — exactly one row '
  'per active cadence. The BD-target POLICY lives in the handler, not here: '
  'this view states facts, api/operations.js::handleProspectingBrief composes '
  'them with BD_OWNER_ROLES.';
