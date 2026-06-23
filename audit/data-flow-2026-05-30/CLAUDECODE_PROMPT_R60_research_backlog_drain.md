# Claude Code — R60: stop the research-task backlog runaway (gate producers + auto-close + drain the resolvable)

## Why (live Today-page audit, 2026-06-22)
Team Pulse shows **5,447 queued research_tasks** and it's growing ~16× faster than it's worked
(+4,061 in 7d vs 254 completed). Grounded composition (LCC Opps `research_tasks`):

| research_type | queued | completed | note |
|---|---|---|---|
| `establish_ownership_history` (gov 2,145 + dia 47) | **2,192** | **0** | no consumer; all created in 7d |
| `trace_ownership_to_developer` (gov 764 + dia 488) | **1,252** | **0** | consumer exists but clears only ~5% |
| `property_missing_recorded_owner` (gov+dia) | 1,268 | 2,044 | HEALTHY — has a consumer, being worked |
| `true_owner_needs_salesforce` (dia) | 734 | 997 | HEALTHY — being worked |

Two producers (3,444 tasks, 63%) fire into a void. The chain-resolve dry-run
(`?_route=developer-chain-resolve-tick`) proves WHY: of 250 sampled gov
`trace_ownership_to_developer`, only **12 are resolvable** from internal data; the rest are
`ambiguous_generic_org` (197), `origin_is_person` (15), `origin_equals_current` (10),
`origin_not_developer` (13), `no_chain` (3) — structurally **not resolvable without external
research**, so they queue forever. `establish_ownership_history` has no consumer at all — but
**R59 now creates `ownership_history` from deeds**, so most should auto-close when that lands.

Doctrine: a research task is only worklist if it is ACTIONABLE. The Today "RESEARCH" number
must reflect actionable research, not raw producer output. Fix in three units, reusing the
Decision-Center auto-supersede pattern (`lcc_refresh_decisions`) + the value-ranking +
research-task-dedup machinery already in place. Additive / reversible / idempotent;
≤12 api/*.js.

## Unit 1 — drain the resolvable, then keep it drained
- Run the EXISTING `developer-chain-resolve` consumer (`?_route=developer-chain-resolve-tick`,
  POST) to completion for the resolvable buckets (`resolved_bts_origin`,
  `resolved_developer_keyword`) — gov now, and **add the dia leg** (488 dia
  `trace_ownership_to_developer` have no consumer path today; mirror the gov handler).
- Wire a **gentle cron** (`*/…`, low cadence — these are slow-moving) so newly-resolvable
  tasks drain automatically instead of waiting for a manual run. This is the
  consumer-without-a-cron gap that let 0 ever complete.

## Unit 2 — auto-close sweep for the non-actionable / already-satisfied  *(the big win)*
Add a refresh/sweep (cron, mirrors `lcc_refresh_decisions` auto-supersede) that closes tasks
whose premise no longer holds — moving them to `status='skipped'` (or `completed` where truly
satisfied) with a reason, so they leave the queue and stop re-surfacing:
- **`establish_ownership_history`** → close when the property now HAS an `ownership_history`
  row (R59 deed propagation creates these; the property_missing_recorded_owner consumer +
  county sync also fill ownership). This alone should clear a large share of the 2,192.
- **`trace_ownership_to_developer`** → close the structurally-unresolvable buckets the
  dry-run already classifies: `origin_is_person`, `origin_equals_current`, `origin_not_developer`,
  `no_chain`, and `ambiguous_generic_org` that carries no developer signal AND no external
  research is configured. Reuse the handler's existing bucket logic so the sweep and the
  consumer agree. (Keep them as `skipped` with the bucket reason — not deleted — so they're
  auditable and can be revived if an external research source lands.)
- Idempotent; only touches `queued` rows; records the close reason.

## Unit 3 — value-gate the producers so the worklist is actionable high-value
The producers (R6/R46 chain + ownership-history generators) currently emit one task per
property regardless of value or resolvability, which is what floods the queue. Gate them:
- Only generate `trace_ownership_to_developer` / `establish_ownership_history` for properties
  above a value floor (rank by `lcc_property_attributes` rent / the existing value-rank the
  queue uses) AND where the task is plausibly actionable (skip the `origin_is_person` /
  `origin_equals_current` shapes at PRODUCE time, not just sweep time). So a freshly-generated
  worklist is the high-value, resolvable set — what the operator should actually work.
- Keep the dedup guard (`uq_research_tasks_open_source`, R21) so re-runs don't re-create.

## Verify (report back)
- Unit 1: chain-resolve POST completes the resolvable gov + dia tasks (count moves
  queued→completed); cron registered.
- Unit 2: the sweep closes the establish_ownership_history rows whose property now has
  ownership_history (incl. R59-created), and the unresolvable trace buckets → skipped;
  re-run is idempotent; `queued` count drops from 5,447 toward the actionable remainder.
- Unit 3: a producer dry-run generates only above-floor, plausibly-actionable tasks (no flood);
  dedup holds.
- Report the before/after queued count by type. `node --check`; ≤12 api/*.js; suite green.

## Bottom line
The system is GOOD at prompting for research and BAD at closing it — two producers dumped
3,444 mostly-unresolvable tasks with zero consumer/sweep. R60 drains the resolvable, auto-
closes the non-actionable (R59's deed-sourced ownership_history now satisfies most
`establish_ownership_history`), and value-gates the producers so "RESEARCH" on Today means
actionable high-value work, not noise.
