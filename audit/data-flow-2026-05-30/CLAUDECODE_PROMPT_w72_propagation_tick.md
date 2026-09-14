# Claude Code Prompt — W7.2: The propagation tick (deal comms → summary / milestones / to-dos / dossier)

**Repo: life-command-center.** Wave 7 unit 2 — the heart of the wave
(`docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md` §W7.2). W7.1 is LIVE:
312 deal-stamped `activity_events` (`source_type='lcc:deal_match'` + ingest-stamped
dual-anchor rows), growing hourly, across 15 active deals.

## Grounded state (2026-08-06, live — build on these, don't rebuild)
- `lcc_deal_correspondence_summary` (1 row): entity_id, summary, topics, thread_count,
  latest_activity_at, source, source_activity_ids, is_current, generated_at, metadata —
  is_current versioning already designed in.
- `lcc_deal_milestone` (3 rows, Woodland Hills): milestone_key/occurred_on/status/
  summary/source/detail_ref/sort_order — sources so far 'intake_om'/'dia_sale'.
- **Next-step engine Phase 1 is BUILT and firing on live inbound**
  (`api/_shared/next-step-ai.js::deriveNextStep` → `lcc_advance_todos` +3 AI params,
  deterministic-first intent classifier, AI escalation via `invokeExtractionAI`,
  existence-guard dedupes on coalesced action_type). See
  `docs/architecture/ai-next-step-engine-PHASE1-BUILT.md`.
- Dossier generator (PR #1549): `source_hash` = sha256 of the packet; `generate_dossier`
  reuses-if-fresh on hash match, else regenerates. Deal packets include correspondence.
- `context_packets` + context-broker edge fn (1,799 rows).
- Cron/tick pattern: W5.2 consumers + W7.1 matcher cron (run-log table, deduped
  failure alert, flag-gated). Seam doctrine (W5.2b lesson): the tick owns its OWN
  ops-side ledger — never share another writer's seam.

## Build — one tick, four propagations

**The tick** (`/api/deal-comms-propagate-tick`, GET dry-run / POST apply, hourly pg_cron
offset ~15min after the matcher cron, flag-gated `DEAL_COMMS_PROPAGATE_ENABLED` +
registry row, run-log table `lcc_deal_comms_propagation_run_log` mirroring W7.1's):

Consume NEW deal-stamped comm activity since the last tick — both `lcc:deal_match`
rows and ingest-time deal-stamped dual-anchor rows. Ledger: per-activity consumption
table (`lcc_deal_comm_propagated(activity_event_id pk, entity_id, propagated_at,
actions jsonb)`) — idempotent, re-runs no-op. Group by deal entity; for each deal
with new comms this tick:

### 1. Correspondence summary refresh (LLM, no-fabrication)
Regenerate the deal's `lcc_deal_correspondence_summary` via `invokeExtractionAI`
(GaryBuilt/ollama primary — this becomes the LCC's biggest recurring local-LLM
workload by design). Contract (the dossier standard applies):
- Input = ONLY the deal's stamped comm rows (titles/bodies/dates/senders, both inbound
  AND sent — Team Briggs outbound is first-class signal). Cite `source_activity_ids`.
- Older threads compress to one-liners; the newest ~10 keep detail. Topics array.
- Absent info → omit (never "presumably"/"likely"); AI failure/timeout → keep the
  prior is_current row, count `summary_skipped` in the run log, move on (a dead model
  must not stall the tick — mirror the dossier generator's timeout bounds).
- Versioning: insert new row is_current=true, flip prior to false (never update-in-place).

### 2. Milestone detection (deterministic writes; LLM proposes only)
- **Deterministic cues** (title/body regex, word-boundary, the W3.3 discipline): LOI
  (sent/received/executed), PSA (draft/executed), escrow/EMD, DD start/end, lender
  commitment, closing scheduled/closed, listing/OM launched. A cue hit writes
  `lcc_deal_milestone` directly: source='comms_tick', detail_ref=the activity id,
  status past/upcoming by date evidence, idempotent on (entity_id, milestone_key,
  occurred_on) — add the unique index if absent.
- **LLM-only candidates** (no deterministic cue but the summary pass surfaced a likely
  milestone): NO direct write. Queue a Decision-Center confirm lane
  (`milestone_confirm`, R48 pull shape — subject_ref `mstone:<entity>:<key>:<date>`,
  approve writes the milestone with source='comms_tick_confirmed'). Never-guess.

### 3. Next-step to-dos (reuse Phase 1 — do NOT fork it)
For newly consumed INBOUND comms received within the last 7 days that did NOT already
produce a to-do at ingest (the existence-guard makes this check cheap): run the same
`deriveNextStep` → `lcc_advance_todos` path the live inbound hook uses. Older
attributed mail (the historical backlog) is summary/milestone fuel only — no to-do
spam from month-old threads. Count generated/deduped in the run log.

### 4. Dossier + context-packet freshness
- If the deal packet's inputs include the correspondence summary (verify in
  `buildDealPacket`), the source_hash changes naturally — then simply invoke the
  existing `generate_dossier` action for deals that had new comms AND have at least
  one stored dossier (regenerate-on-change; reuse-if-fresh makes it cheap). If the
  packet does NOT include the summary, add it (that's a packet improvement, in scope).
- Refresh/invalidate `context_packets` for the deal's property + primary contacts
  via the existing context-broker path (check its refresh contract; if packets are
  generated-on-demand with a TTL, bumping/expiring is enough — don't build a new
  generator).

## Doctrine / Do NOT
- LLM summarizes/proposes ONLY — the auditable writes (milestones from cues,
  to-dos via Phase 1's guarded path, ledger rows) are deterministic. No LLM verdict
  ever writes a milestone directly.
- Own seam only (the new ledger table). Do not touch gov/dia tables. Do not re-stamp
  or re-read other consumers' seams.
- Bound per-tick work (e.g. max 10 deals/tick, oldest-first backlog) so the first
  run over the 312-comm backlog is calm; the ledger makes catch-up automatic.
- No-fabrication contract verbatim from the dossier standard for all generated prose.

## Tests
Tick idempotency (re-run = zero new ledger rows/summaries); summary versioning flips
is_current; deterministic milestone cue → write with detail_ref; LLM-candidate path →
confirm-lane row, NO milestone write; recent-inbound-only to-do generation (old comm →
none; already-todo'd → deduped); AI-failure path keeps prior summary and counts skip.
Fetch-level mocks per the W7.1 test posture; contract-test the engine/api seam if any
engine module is reused (the matcher-cron lesson).

## Verify (live, after merge + redeploy + flag)
Dry-run first (report deals/comms it WOULD process). Then live tick over the backlog:
15 deals get is_current summaries citing real activity ids; Woodland Hills (closed,
gold standard) summary matches its known story; deterministic milestones land with
detail_refs; a fresh test email on an active deal → next tick refreshes that deal's
summary + generates the Phase-1 to-do + dossier regenerates on the changed hash.
Record in ROLLOUT_STATUS (W7.2 row + session log) + WAVE7 plan §0.
