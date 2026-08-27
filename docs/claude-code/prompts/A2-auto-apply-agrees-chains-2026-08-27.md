# Prompt A2 — Apply the 380 "agrees" ownership chains. Make this lane complete a task.

> **Automation/data-process audit window** (lettered prompts; the app window owns the numeric
> series). **Read first:** `docs/audits/A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md`,
> `docs/audits/DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md`, `PLANNED-BACKLOG.md` P1b,
> and `CLAUDE.md` → data-write discipline + Consumption-Layer doctrine.

---

## Where this stands

A1 shipped `v_lcc_ownership_history_lane_split`. The lane's four actions are now measured and
separable:

| action | tasks | owners | links | rent | who consumes it |
|---|---:|---:|---:|---:|---|
| **`agrees`** | **380** | 360 | **450** | $714.7M | **this prompt** |
| `mismatch` | 73 | 45 | 120 | $401.2M | A3 (a data-integrity lane) |
| `no_records` | 74 | 62 | 0 | $278.5M | A4 (auto-retire) |
| `all_guarded` | 18 | 18 | 0 | $33.5M | A4b (adjudicate per guard) |

**`establish_ownership_history` has completed 0 tasks in 69 days.** A1 split it; **A2 is the first
thing that can actually drain it.** That is the acceptance test — not rows written, not a view
existing: `research_tasks … research_type='establish_ownership_history' AND status='completed'`
going above zero for the first time.

## What `agrees` means, precisely

The drafted chain's last recorded grantee **is** the owner we already hold
(`terminates_at_current_owner = true`). The chain therefore **corroborates** current state rather
than contradicting it — which is exactly why it is safe to apply without a human, and why it is
NOT a question worth putting on a screen.

Each link carries a **record reference** citation (`gov.ownership_history` row id + `data_source`),
not prose. **These cannot be hallucinated — no model was involved in producing them** (P131 built
them deterministically). Do not add one now.

## Build

**Apply the 380 chains' 450 links into `lcc_entity_portfolio_facts` as historical ownership**, then
complete their research tasks.

The lane exists precisely because `owner_links <= 1` there — the P138–P141 feeder only ever fed
`is_latest_for_property` (the CURRENT owner), so the HISTORY was never populated. This is that gap.

**Non-negotiables, each earned by a documented incident:**

1. **Read the bucket from the view.** `action='agrees'` off `v_lcc_ownership_history_lane_split`.
   **Never re-derive it** — a JS mirror of a SQL classifier is the normaliser drift `CLAUDE.md`
   warns about repeatedly (P134 re-derived a view's GROUP BY and got 150 members for a 2-member
   group).
2. **Go through the existing merge/provenance path.** Register a `field_source_priority` row for
   the new source if one does not exist, and resolve every entity through
   `lcc_entity_survivor()` with `merged_into_entity_id IS NULL` — **existence is not liveness**
   (P175: a tombstone still exists, and a nightly producer re-created 198 facts worth $71.8M).
   Resolve **before** any GROUP BY or you hit *"ON CONFLICT DO UPDATE cannot affect row a second
   time."*
3. **Fill-blanks, never clobber.** A historical link that already exists is a no-op. If an existing
   fact **contradicts** the chain, that is a **conflict to surface, not to resolve** — cf.
   `v_lcc_portfolio_ownership_conflict`, where deleting the ghost would have resolved toward the
   stale side and dropped $1.7M of live rent.
4. **Dry-run by default; `apply=true` writes.** Reversible by `batch_tag`. Report the dry-run's
   **already-present vs genuinely-new** split, or a re-run looks like it did nothing when it did
   everything (P141a).
5. **Honest counts.** Report **links written** and **tasks completed** — never chains scanned.
   `already_applied` is a re-discovery tally that reads exactly like throughput (P159a).
6. **Complete the task, and say what completion means.** Write the outcome onto `research_tasks`
   (`status='completed'`, `outcome` naming what was applied) so the lane's own metric moves. **A
   run that writes 450 links and leaves 380 tasks open has not consumed anything.**

**Guardrails:**

- **`agrees` ONLY.** Do not touch the other three buckets; A3/A4/A4b own them and each needs a
  different decision.
- **No model anywhere in this path.** P131 lens category (a) — already on-box and structured.
- **Schedule it after the hand-run** (the P133 pattern): a lane that re-mints nightly needs a sweep,
  or the one-shot repair becomes a chore repeated silently forever (P176). Seed predicate first —
  **grep what re-creates these tasks** before assuming a completed task stays completed.
- `npm test` before pushing; `main` is protected — branch → PR → both checks green → merge
  (`docs/os/GITHUB-WORKFLOW.md`). The gate is Node 24 and currently green.

## Deliverables

- The applier (dry-run + apply), its migration if any, and the schedule.
- The measured result: links written, tasks completed, already-present, conflicts surfaced.
- A test anchored on the **view's `action` column and the structured booleans**, never on `reason`
  prose or a sliced source region.
- `PLANNED-BACKLOG.md` A2 → done; confirm A3/A4/A4b still unblocked and untouched.
- A `CLAUDE.md` note **only if** something generalises beyond this lane.

## Verify

```sql
-- the ONLY thing that counts as success
select count(*) filter (where status='completed') completed_ever,
       count(*) filter (where status in ('queued','in_progress')) still_open
from research_tasks where research_type='establish_ownership_history';

-- and the enrichment it was for
select count(*) from lcc_entity_portfolio_facts where <batch_tag = this run>;
```

**Expect `completed_ever` to go from 0 to ~380.** If links land and `completed_ever` stays 0, the
producer ran and nothing was consumed — which is the exact failure this whole arc exists to close.
