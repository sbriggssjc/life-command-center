# Claude Code Prompt — W7.2c: Propagation refinements (milestone collapse · briefing delta · incremental summaries · reply-SLA)

**Repo: life-command-center.** Four small refinements from W7.2's first live batch
(ROLLOUT_STATUS session 36m; WAVE7 plan §W7.2 refinement note). The tick is LIVE
(`DEAL_COMMS_PROPAGATE_CRON` on, hourly :32) — all changes must be backward-safe
against a running consumer and its existing ledger/run-log.

## 1. Milestone same-key collapse (the Banning finding)
Live state: repeat deterministic cues write one milestone PER occurrence date —
Banning carries 6+ `loi` rows spanning months of LOI negotiation (all
source='comms_tick', each with detail_ref). New semantics:
- Per (entity_id, milestone_key): the FIRST occurrence is THE milestone row. A later
  re-occurrence UPDATES that row's metadata: `occurrence_count`, `last_seen_on`,
  `last_detail_ref` (and appends to a bounded `occurrences` array ≤20) — no new row.
- A re-occurrence AFTER a `closed`/terminal milestone of the same key MAY open a new
  row (a second LOI round after a fell-through deal is a genuinely new milestone) —
  key on: new row only if the prior same-key row is >90 days stale AND the deal stage
  regressed; otherwise metadata roll-up. Keep it deterministic and documented.
- Migration: collapse EXISTING comms_tick duplicates per the same rule (keep earliest,
  roll the rest into metadata, delete the collapsed rows — they're all evidence-linked
  and reversible; record the collapse in the migration header).
- The dossier milestones panel gains the count ("LOI — first 2025-02-20, discussed ×6,
  last 2026-03-31") — that repetition IS signal.

## 2. Briefing "what changed on your deals" delta
The propagation ledger (`lcc_deal_comm_propagated.actions`) + run logs record exactly
what moved. Add a briefing section (existing daily briefing surface — find the current
section builders and mirror one): per deal touched in the last 24h — new comms count,
summary refreshed?, milestones written/updated (with key + count), to-dos generated,
dossier regenerated. One line per deal, deep-linked. Deterministic query only — NO LLM.
Empty state: omit the section entirely (no "nothing changed" noise).

## 3. Incremental summary compression (latency + token control)
Today each tick re-summarizes the deal's FULL corpus. As threads grow this scales
badly (GaryBuilt latency + context length). Change: persist the compressed-history
block in the summary row's metadata (`compressed_through_activity_id`, `compressed_block`
text). Next regeneration feeds: compressed_block + only activities newer than the
watermark, and produces both the new summary AND an updated compressed_block. The
no-fabrication contract applies to the compression too (it may only restate what the
prior cited summary/comms contain). Fallback: if metadata is absent (first run per
deal), full-corpus as today.

## 4. Reply-SLA to-dos (deterministic, the highest-ROI generator)
Per open in-scope deal: if the latest deal-stamped comm is INBOUND and there has been
no outbound on that deal for >3 business days, generate a Phase-1-style to-do via the
existing `lcc_advance_todos` guarded path (action_type `reply_overdue`, title
"Reply overdue — <deal>: last inbound <date> from <sender>"), deduped by the existing
existence-guard + only one open reply_overdue per deal. Runs inside the tick (cheap
query over the ledgered comms). Config: threshold days in one constant; skip deals
with a `paused`/`on_hold` stage if such a stage exists (check bd_opportunities stages).

## Doctrine / Do NOT
- No LLM in #1/#2/#4 (deterministic only). #3's compression runs under the
  no-fabrication contract with the same timeout/skip posture as summaries.
- Don't break the running tick: ledger/run-log schemas are additive-only; the collapse
  migration must be safe against a concurrent tick (advisory lock or run it in the
  same transaction pattern the tick's writer uses).
- Tests: collapse rule (incl. the stale+regressed new-row case), briefing delta line
  shape, incremental-summary watermark round-trip, reply-SLA dedupe + threshold.

## Verify (live)
Post-merge: Banning shows ONE loi milestone with ×N metadata; briefing (force-run)
shows the delta section for tick-touched deals; a tick after a new comm only feeds
the incremental slice (log the input sizes); reply-SLA dry-count reported before the
first live generation (how many deals currently trip it — Scott sanity-checks).
Record in ROLLOUT_STATUS + WAVE7 plan.
