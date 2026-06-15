# Claude Code — R21: fix the research-task duplication root cause + reconnect the silos

## Why (grounded live 2026-06-15)
The cross-component disconnection audit found one headline silo (the ownership
gap-tracker) and one piece of dead weight (a vestigial R5 listing path). The
headline turned out to have a contained ROOT CAUSE, not the data regression it first
looked like:

- `research_tasks` shows **7,961 queued `property_missing_recorded_owner`** — but
  only **1,534 distinct properties** (`source_record_id`). **Avg 5.2 tasks per
  property; worst case 140 tasks for ONE property; 562 properties carry 3+.** The
  generator (`generate-research-tasks` daily + `generate-research-tasks-inc` every
  30 min, reading `v_next_best_research`) INSERTs a task per source row **with no
  dedupe against an existing open task** for the same `(source_record_id,
  research_type, domain)`. So every tick re-creates tasks for the same ~1,534
  unresolved gaps → 5× (and growing) duplication. The apparent "completion stall"
  (6/08: 4,394 created / 29 resolved) was the dupe explosion, not a real influx.
- `entity_id` is NULL on all of them (a property with no recorded owner has no owner
  entity), so they're structurally invisible to the entity-grained queue / Decision
  Center — they live only in `research_tasks`.

Fix in four units. Unit 1 is the root cause; do it first.

## Unit 1 — STOP the duplicate generation (the root cause) + clean up
1. **Dedupe at the generator.** In the research-task generator (the function/handler
   behind `generate-research-tasks` / `-inc` that reads `v_next_best_research`), only
   create a task when **no open task already exists** for the same
   `(source_table, source_record_id, research_type, domain)`. Implement via a
   **partial UNIQUE index** on those columns `WHERE status='queued'` (or
   `status IN ('queued','in_progress')`) + `INSERT ... ON CONFLICT DO NOTHING`, OR a
   `NOT EXISTS` guard in the generator query. Apply to ALL research_types (the same
   dupe risk hits `true_owner_needs_salesforce` 1,597, `property_missing_true_owner`
   444, `trace_ownership_to_developer` 113).
2. **Collapse the existing dupes.** Keep the OLDEST queued task per
   `(source_record_id, research_type)`; mark the rest `superseded` (don't hard-delete
   — append-only audit + the ledger is on disk-sensitive LCC Opps, a 6k-row DELETE
   adds bloat; `UPDATE ... SET status='superseded'` and let the 90d/ retention prune
   them, or add one if none exists). Result: `property_missing_recorded_owner` open
   drops 7,961 → ~1,534; the tracker count finally reflects real distinct gaps.
3. **Retention on terminal tasks.** Confirm/ add a prune for `completed`/`superseded`
   research_tasks (e.g. 60–90 d) so the table stays bounded (same retention
   discipline as the other big tables).

## Unit 2 — connect the 1,534 REAL gaps to resolution + guidance
After dedupe, ~1,534 distinct properties genuinely lack a recorded owner. They're
property-level (no entity), so the entity queue can't show them — connect them via:
1. **Value-rank them.** Join the property's value (gov `gross_rent`/dia projected
   rent via `lcc_property_attributes` / the domain) so the gaps sort by dollars at
   stake — don't treat 1,534 as a flat list.
2. **Surface the top as property-grained research work.** A Decision Center lane
   (or a research surface) keyed by `(source_table, source_record_id)` showing the
   highest-value missing-owner properties, so the operator works the ones that
   matter. Use the existing decision/research UI patterns; don't dump all 1,534.
3. **Automated fill where a source exists (the durable path).** `recorded_owner`
   is filled by county/deed data. GovernmentProject has `county_scraper`; wire the
   gov gaps to an automated recorded-owner lookup that PATCHes `recorded_owner`
   (which auto-completes the task via the existing `gap_resolved` path). dia has no
   county path today — note it as a follow-on; surface dia gaps to the human
   research lane meanwhile. (If building the county worker is too big for this
   round, ship Units 1+2.1+2.2 and scope the lookup separately — the dedupe alone
   makes the tracker honest and the value-ranked surface makes it actionable.)
4. **`true_owner_needs_salesforce` (1,597)** — confirm these route to the existing
   SF-mapping / Decision Center path (they likely DO map to entities, unlike the
   recorded-owner gaps); if so they just need the Unit-1 dedupe, not a new surface.

## Unit 3 — bound + alert (stop silent accumulation)
A gap-tracker that only grows is a broken signal (the disabled-cron / stall lesson).
Add a health check: if open `research_tasks` for any `research_type` exceeds a
threshold OR generation outpaces completion for N consecutive days, open a
`research_backlog_growth` alert in `lcc_health_alerts` (fold into the existing
`lcc-cron-health-check` tick, not a new watcher). With Unit 1's dedupe the count
should be stable; this catches a future regression early.

## Unit 4 — reconcile the vestigial R5 listing-event path
`lcc_listing_events` (R5 sale-event cohort fan-out: `v_lcc_listing_event_queue` +
`lcc_listing_same_owner_cohort` / `_buyer_cohort` / `_geographic_neighbors`) has 61
events, **0 ever processed**, stale since 5/22 — while the live CoStar/availability
listing→BD path (`listing_bd_runs`, 1,080 runs/14d) is active. Decide and act:
- If the R5 cohort fan-out (contact the seller's same-owner cohort / the buyer's
  other holdings / geographic neighbors on a sale) adds BD value beyond
  `listing_bd_runs` → **wire its consumer** (process `v_lcc_listing_event_queue` →
  create the cohort opportunities/cadences) + a gentle cron.
- If it's superseded → **retire it** (drop `lcc_listing_events` +
  `lcc_listing_events_retract_backup_*` + the queue view + the three cohort
  functions) so it's not a confusing dead path.
Grep for any caller of the cohort functions / the queue view first to confirm
nothing live depends on them. Recommend retire unless the cohort outreach is a
wanted feature — it's dead weight today.

## Boundaries / house rules
- dia/gov pipelines untouched except the (optional, Unit 2.3) recorded-owner PATCH
  via the existing domain-write path with provenance `source='county_lookup'`.
- No hard-deletes on `research_tasks` (supersede + prune) — LCC Opps disk
  sensitivity.
- Additive migrations (partial unique index, ON CONFLICT, health-check fold-in).
  ≤12 `api/*.js`; `node --check`; full suite green.
- Acceptance: `property_missing_recorded_owner` queued = distinct-property count
  (~1,534, no dupes); a re-run of the generator creates 0 new dupes; the value-
  ranked high-value gaps are visible to the operator; the vestigial listing path is
  wired or retired (no 0-processed stale silo); the backlog-growth alert is live.

## Sequencing
Unit 1 (dedupe + cleanup) is the root-cause fix and unblocks the honest count —
ship it first and standalone if splitting. Units 2–4 build on a deduped tracker.
