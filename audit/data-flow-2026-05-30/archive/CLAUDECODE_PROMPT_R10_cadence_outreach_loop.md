# Claude Code prompt — R10: close the cadence → outreach loop

Paste into Claude Code, run from the **life-command-center** repo. This round
follows a full audit of the outreach side of the BD spine (grounded live
2026-06-07). Headline: **the cadence engine is built but the loop has never
closed once** — 392 cadence rows, 383 overdue, `last_touch_at` NULL on every
row before today's audit probe. Five independent breaks, each verified live.

## Grounded findings (all verified 2026-06-07)

1. **Queue CTA hits the wrong router.** P0/P6/P7's primary CTA "Log touch →"
   (`ops.js pqLogTouch`) POSTs `/api/operations?action=advance_cadence` — but
   `advance_cadence` only exists under the DRAFT sub-router
   (`?_route=draft&action=advance_cadence`). The main action router rejects it
   ("Invalid POST action…"), so **every click since R4-C has 400'd** with
   "Could not log touch". 376 cards' primary action is a guaranteed error.
2. **`advanceCadence(type:'touch')` doesn't reschedule.** Tested live on the
   correct route (Duchene Family Trust, cadence `5d9bf701…`): `last_touch_at`
   set, `current_touch` 0→1, but **`next_touch_due` unchanged** (still
   2026-05-17) — the row stays overdue, the card never leaves the band. The
   7-touch ladder/`lcc_steady_state_interval_days` is not consulted for the
   generic 'touch' type. (My test left that one row touched — fine to keep.)
3. **The organic advance trigger never fires.** `activity_event_advance_cadence`
   listens for `category IN ('email','call','meeting')`. Live distribution of
   ALL 14,323 activity_events ever: system 7,987 / copilot_action 5,822 / note
   494 / status_change 12 / research 8 — **zero rows in the trigger's
   categories, ever**. Compounding it: the one writer that does use
   `category:'call'` (`bridgeLogCall`, fed by the detail page's Log Activity)
   resolves its entity via `ensureEntityLink(sourceType:'asset', property_id)`
   — the ASSET entity — while cadences live on person/org entities (386
   person + 3 org + 2 asset). Even when used, the trigger looks up a cadence
   on the asset and no-ops. Also: `outbound_activities` newest row is
   2026-03-23 — the log surface predates the BD engine and isn't part of
   anyone's loop today.
4. **The cadence universe is unactionable seed stock.** 381 'prospecting'
   cadences were pre-seeded May 17–22 with `next_touch_due` = seed time (born
   overdue), all `next_touch_type='email'`, on entities that are: firm names
   mistyped as persons (Prologis, Acquest Development, Cohen Cos, family
   trusts — the pre-R7-2.5 typing bug), with **no sf_contact_id, no SF
   identity, no email address**, and rent $0 / props 0 in the queue payload
   (so P7 isn't even value-ranked). P7=370 cards say "email this entity" with
   no person to email and no address to send to.
5. **The outreach mechanisms have no surface.** The entire drafts engine
   (`?_route=draft`: templates incl. T-001 referenced by `next_touch_template`,
   generate, batch, record_send with opened/replied tracking, listing_bd,
   smart_reschedule) is exposed ONLY as Copilot agent actions — zero frontend
   callers. `v_bd_cadence_dashboard` has zero consumers anywhere. The R7-2.4
   buy-side phase has ZERO rows — the Boyd contact step was never completed,
   so no buy-side cadence ever started.

What IS healthy: phase machinery, the 7-touch ladder, steady-state interval
function, escalation flags (new_award_flag, lease_expiry_flag), the trigger's
match-type logic, template tables. The engine exists; every road into it is
broken or missing.

## Doctrine (Scott — carried from R7-2.4)

"Most often, we tie opportunities to a specific CONTACT associated with the
company that we will be prospecting." A cadence without a reachable contact
is not a next action — it's research waiting to happen. The priority queue is
a ranked hierarchy of NEXT BEST ACTIONS: a P7 card must be executable.

## Unit 1 — fix the advance path (small, surgical, ships first)

1. `pqLogTouch` → correct route (`?_route=draft&action=advance_cadence`) OR
   (better) add `advance_cadence` to the main action router as an alias —
   one dispatch line; pick whichever keeps the Copilot registry consistent.
2. `advanceCadence` for a generic/manual touch MUST reschedule: compute the
   next due via the 7-touch ladder when phase='prospecting'/'onboarding'
   (advance `current_touch`, set `next_touch_due`/`next_touch_type` from the
   ladder) and via `lcc_steady_state_interval_days` when steady_state.
   A touch that doesn't reschedule is the #2 break — add a regression test:
   advance → `next_touch_due > now()`.
3. Every successful advance writes an `activity_events` row with the REAL
   category ('call'/'email'/'meeting' — derive from the logged type; generic
   'touch' → 'call' is acceptable) and the CADENCE's entity_id, so history
   renders and downstream consumers see touches. Guard against the trigger
   double-advancing (the trigger fires on that insert — either insert with a
   metadata flag the trigger skips, or let the trigger be the single advance
   path and have the endpoint only insert the activity; pick ONE owner of the
   advance and document it in CLAUDE.md).
4. Queue refresh hook: a successful advance calls
   `lcc_refresh_priority_queue_resolved()` (the Slice-1 staleness contract)
   so the card leaves the band immediately.

## Unit 2 — close the organic loop (entity targeting + writer categories)

1. **Asset→owner hop in the trigger** (or in the writers): when an activity
   lands on an ASSET entity, the advance should find the cadence via the
   asset's owner/related org or the property linkage
   (`touchpoint_cadence.property_id`, `lcc_entity_portfolio_facts`) — a call
   logged from a property detail page is a touch on that property's owner
   cadence. Implement at the trigger level (one place) rather than per-writer.
2. **Writers emit real categories**: sweep every activity writer that
   represents an actual human touch — `bridgeLogCall` ('call' ✓ but verify
   the entity hop), the SF activity log path (app.js ~5410), any email-send
   recording — and make sure they write 'email'/'call'/'meeting' with the
   right entity. The R10 rule: `category` describes WHAT HAPPENED, not which
   surface logged it.
3. Verify end-to-end live: log a call from a property detail page whose owner
   has a cadence → cadence advances, next_touch_due moves, queue card clears
   on refresh. This is the acceptance test for the whole unit.

## Unit 3 — cadence universe hygiene (the 381 contactless rows)

1. **Park, don't render.** Cadences whose entity has NO reachable contact
   (no sf_contact_id, no person-contact relationship, no email/phone) move to
   a holding state — reuse `phase='dormant'` with
   `metadata/flag awaiting_contact=true`, or a dedicated phase if the CHECK
   allows widening (widening only). They leave P0/P6/P7 (gate the queue
   bands on contact-reachability) and surface instead as a **"Select
   prospecting contact →"** step — the R7-2.4 buyer-contact picker pattern,
   generalized beyond P-BUYER. The card's question becomes the TRUE next
   action: find the person, not "email a trust with no email".
2. Fix the typing while you're there: the 386 person-typed firm entities are
   the pre-R7-2.5 bug class — retype to organization where
   `isImplausiblePersonName`/firm-suffix says so (soft, reversible, report
   count), since the contact picker keys person-vs-org.
3. P7 ranking: once gated, surviving cadence cards rank by the entity's
   portfolio rent (join the rollup the enriched view already carries), not $0.
4. Report the post-gate band counts: P7 should collapse from 370 to roughly
   the reachable set (likely near zero today — that's HONEST; the queue then
   shows contact-resolution work instead, which is the real state of the book).

## Unit 4 — minimum outreach surface (draft → send → record)

The smallest loop that lets Scott actually work a touch from the queue:

1. P0/P6/P7 card (and the cadence section of entity detail): **"Draft email →"**
   calls `?_route=draft&action=generate` for the cadence's
   `next_touch_template` + entity context; render the draft inline
   (copy-to-clipboard + open-in-mail-client `mailto:` is enough — do NOT
   build a sending integration this round); a **"Mark sent"** button calls
   `record_send` → which must advance the cadence (verify record_send calls
   the same single advance path from Unit 1).
2. For 'call' touches: "Log call →" opens the existing Log Activity form
   (detail page machinery) pre-targeted at the cadence entity — and that path
   now advances via Unit 2.
3. `v_bd_cadence_dashboard`: either render it as the cadence tab's data source
   (it was built for exactly this) or delete it — zero consumers is dead
   weight. Recommend render: per-cadence row with phase, touch N/7, due,
   last outcome, next action button.
4. Buy-side: surface the P-BUYER contact step's outcome — when Scott selects
   a Boyd contact, verify the buy_side cadence row seeds and renders in the
   dashboard (the R7-2.4 machinery is live but has never produced a row).

## Verify + ship
- Unit 1: "Log touch" on a P7 card succeeds live, next_touch_due moves to the
  future, card leaves the band on refresh, one activity_event with a real
  category exists. No double-advance.
- Unit 2: detail-page call log on a cadence-bearing owner advances the cadence
  (the end-to-end acceptance test). Report which writers were swept.
- Unit 3: post-gate band counts + retype count; spot-check 5 parked cadences
  and 2 surviving ones.
- Unit 4: draft generated from a real cadence template live; record_send
  advances; dashboard renders (or view dropped with rationale).
- House rules: `node --check`; 12 functions; migrations idempotent; crons
  after routes; effect-first/outcome-truthful; zero hard-deletes; ANALYZE
  after bulk updates; report per-unit status. DB-side changes that are
  cache-or-live safe may apply immediately; JS ships on the Railway redeploy.
- Slice discipline: Unit 1 is independently shippable and highest-value —
  ship + verify before 2-4 if anything gets tight.
