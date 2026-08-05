# Claude Code Prompt — W5.2: Signal → task automation (state lease / agency risk / NPI)

## Context (read first)
- `docs/audits/LCC_Audit_Rollout_Plan.md` §W5.2 (line ~544) + audit §3.4.1 (orphaned signal streams).
- `docs/audits/ROLLOUT_STATUS.md` — session-36 log entry (grounding measured 2026-08-05).
- **Doctrine (hard):** deterministic rank thresholds ONLY — NO LLM anywhere in the value
  gates. Every producer needs a consumer + gate. Task payloads are STRUCTURED (entity ids
  + deep link), never prose instructions telling a human to run SQL.
- **Model it on the working R48 listing_event consumer:** migration
  `20260619210000_lcc_r48_unit1_listing_event_consumer.sql` +
  `api/admin.js` (queue builder ~line 1689 `listing_event_action` reading
  `v_lcc_listing_event_queue?processed_at=is.null`, ranked items shaped
  `{subject_ref, subject_domain, rank_value, context}`; decision resolver ~line 3094
  writing `lcc_decisions` decision_type `listing_event_action`, don't-re-ask via
  `subject_ref` key `listevt:<event_id>`).

## GROUNDING — live state measured 2026-08-05 (differs from the audit's premise)

1. **`state_lease_events` (gov): 577 rows, ALL processed_at = 2026-06-23, and
   max(created_at) = 2026-06-23.** The seam was burned by a one-shot backfill stamp,
   not by a real consumer — AND the producer itself has been silent for 6+ weeks
   (the state-lease snapshot diff should be recurring). Event mix: renewed 273,
   lessor_change 114, removed 68, new_lease 57, relocated 31, footprint_reduction 28,
   agency_change 6. Two consequences for the build:
   a. The consumer tick treats `processed_at` as its seam GOING FORWARD (do not
      re-stamp or reinterpret the 2026-06-23 backfill rows — they are consumed).
   b. Add a producer-staleness alarm: if `max(created_at)` ages past 45 days, open a
      deduped `lcc_health_alerts` row (`state_lease_producer_stale`). A consumer with
      a dead producer is silent theater — this is the loud-never-silent rule.
2. **`agency_risk_signals` (gov): 15,299 rows (audit said 13,888 — it accrues,
   3,508 in the last 30 days, latest 2026-08-05). NO processed/consumed seam column
   exists, and every row is `signal_type='composite'`.** Distribution by risk_level:
   low 6,792 (avg score 0) / moderate 5,368 (avg 1.4) / elevated 3,124 (avg 3.0) /
   high 15 (avg 5.9, latest 2026-06-05). The unit must ADD a seam (nullable
   `processed_at` + partial index, mirroring state_lease_events) via gov migration.
3. **`mv_npi_inventory_signals` (dia): 1,452 rows.** It is a MATERIALIZED VIEW —
   no seam column is possible on it. Consumption must be ledgered on the ops side
   keyed by a stable signal identity (propose `md5(npi || signal_type || coalesce(
   cluster_winner_medicare_id,''))`; confirm stability against the mv definition).
   Mix: missing_inventory_npi/unresolved 504, duplicate_inventory_npi
   auto_resolvable 462 + data_quality 253 + data_error 216, new_npi 17.
   Columns include severity, signal_priority, signal_reason, clinic_id, operator_name.
4. **Consumer surface exists:** `research_tasks` on LCC Opps (18,863 rows; columns
   incl. research_type, entity_id, domain, priority, source_table, source_record_id,
   metadata jsonb, status) and the Decision Center queue framework in `api/admin.js`.
   `lcc_decisions` = 3,730 rows. Use BOTH as designed below.

## Build (three consumer ticks, one shared shape)

For each stream: a deterministic tick (edge-fn or admin-invoked, follow the existing
scheduling pattern used by R48) that (a) filters to high-value events by FIXED
thresholds, (b) creates the work item with a structured payload, (c) marks consumed
(seam or ledger), (d) don't-re-asks via `lcc_decisions` subject_ref.

**Proposed thresholds (from the measured data — Claude Code: validate against live
distributions before hardcoding, and record the validation query output in the PR):**
- `state_lease_events`: event_type IN (removed, footprint_reduction, relocated,
  agency_change) → always task (133 total historically; these are the BD-actionable
  distress/movement signals). `lessor_change` → task ONLY when the property links to
  a tracked entity (ownership interest). `renewed`/`new_lease` → no task (informational;
  they flow to the briefing digest count only).
- `agency_risk_signals`: risk_level='high' → always task (15 ever — cheap).
  risk_level='elevated' AND affected_locations linking to ≥1 tracked gov property →
  task; unlinked elevated → digest count only. low/moderate → never.
- `mv_npi_inventory_signals`: signal_type='missing_inventory_npi' (504, unresolved) →
  research_task (research_type='npi_missing_inventory'). duplicate_inventory_npi
  severity='data_error' (216) → Decision Center queue (human pick). auto_resolvable
  (462) → do NOT auto-resolve in this unit; queue a Decision Center batch-approve
  lane (deterministic proposed action in the payload, human approves). new_npi (17)
  → research_task.
- Route to `research_tasks` when the work is RESEARCH (find/verify something);
  route to a Decision Center queue when the work is a DECISION between options.
  Payloads carry: domain, entity/property/clinic ids, the signal row's key fields,
  and a deep link (`#/property/<id>` / clinic route — match existing app link shapes
  in admin.js contexts). NO prose instructions.

## Deliverables
- gov migration: `agency_risk_signals.processed_at` + partial index (unprocessed).
- ops migration: NPI consumption ledger table + any new Decision Center queue
  registrations, modeled on 20260619210000.
- The three tick functions + queue builders/resolvers in admin.js following the
  R48 shapes exactly (subject_ref conventions: `slease:<id>`, `arisk:<signal_id>`,
  `npi:<hash>`).
- Producer-staleness alarm for state_lease_events (and consider the same for the
  other two producers — cheap, same helper).
- Tests: threshold filters (fixture rows per level/type), seam idempotency
  (re-run creates zero duplicate tasks), don't-re-ask (lcc_decisions hit skips),
  payload shape (ids + deep link present, no prose-instruction field).
- Docs: ROLLOUT_STATUS W5.2 row + session log; note the state-lease producer
  staleness finding explicitly.

## Do NOT
- Put any LLM call anywhere in these paths (W5.3's optional review-lane annotations
  are a separate, gated unit — not this).
- Auto-resolve the `auto_resolvable` NPI duplicates without the human batch-approve
  lane (fill-blanks/never-guess doctrine applies to destructive dedup too).
- Re-process the 2026-06-23 backfill-stamped state_lease_events rows.
- Create tasks with prose instructions ("run this SQL…") — structured payload only.
