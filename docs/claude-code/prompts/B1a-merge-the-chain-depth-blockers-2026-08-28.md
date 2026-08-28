# Prompt B1a — duplicate entities are now the binding constraint on chain DEPTH. Merge them.

> **Automation/data-process audit window.**
> **Read first:** `docs/architecture/ownership-history-lane.md` (canonical),
> `docs/audits/A2a_AMBIGUOUS_ENTITY_MERGE_2026-08-27.md` (**the machinery already exists — reuse
> it**), `B1_CHAIN_VALUE_FLOOR_SPLIT_2026-08-28.md`, and the `lcc_merge_entity` / P195 / P196
> sections of `CLAUDE.md`.
>
> ⚠️ **This writes to production through a shared merge path. §3 is not optional.**

---

## 1. Why this is now the top item

B1 split the value floor and the lane went **336 → 1,237 completions**. gov properties with **any**
ownership history rose **1,272 → 2,173 (+901)** — but properties with a **chain (2+ historical
links)** rose only **149 → 177 (+28)**.

**That gap is the population, not a shortfall:** only 210 of the 1,501 below-floor properties carry
≥2 guard-passing transitions. **So the floor is no longer what limits DEPTH.** Measured
2026-08-28, the blocked residue is:

| blocked reason | links | properties | **distinct parties** |
|---|---:|---:|---:|
| **`ambiguous_entity`** | **126** | **123** | **111** |
| `no_entity` | 49 | 47 | 36 |
| **`placeholder`** | **44** | **31** | **5** |
| `repeat_transfer_unrepresentable` | 2 | 1 | 1 |

**`ambiguous_entity` is the largest and it needs no new code** — the grantor name resolves to more
than one live LCC entity, so A2 correctly refuses. **Merge the duplicates and cron 244 applies those
chains the same night.**

**⭐ And `placeholder` is 5 distinct parties across 31 properties** — five decisions, thirty-one
properties unblocked. Almost certainly the cheapest win on the board. **Look at it in the same pass**
(it is likely `Unknown`/`Previous Owner`-class strings that belong in the anchored placeholder
predicate, not a merge).

## 2. Reuse A2a — do not build a third merge driver

A2a already shipped this exact pattern: `v_lcc_a2a_ambiguity_merge_plan`, `lcc_a2a_merge_log`,
`lcc_a2a_unmerge(batch)`. It merged 28 losers across 26 groups, **held 17 with reasons named**, and
**proved the round trip on the highest-stakes group before the batch** (153 rows before, 153 after,
0 lost / 0 new / 0 changed).

**Reuse that machinery.** `lcc_merge_entity` is reversible since P196 (`lcc_merge_snapshot_loser`,
`lcc_merge_fold_pivot`, `lcc_unmerge_entity`). A separate driver is the second-writer defect this
repo has paid for repeatedly.

## 3. Non-negotiables — each earned by a live failure

1. **Prove the round trip on THIS cohort before the batch.** P195's reversal failed its first live
   attempt (`428C9`, a `GENERATED ALWAYS` column) and P196's failed on a BEFORE-INSERT trigger
   silently defeating `ON CONFLICT DO UPDATE`. **A reversal path not exercised on this data is a
   claim, not a capability.**
2. **⚠️ Identity must be EARNED, not inferred from the name** — `ambiguous_entity` means the name is
   ambiguous, which is the whole problem. **Byte-identical-after-case is the safe core.** Anything
   beyond it needs corroboration (shared `external_identities`, shared assets, overlapping portfolio
   facts). **Do NOT use `lcc_owner_strict_core`** (A2 measured and rejected it here — it collapses
   `BAMMF (8) LLC` onto `BAMMF (3) LLC`) or `lcc_normalize_entity_name` (banned for identity).
3. **A2a's own gate: read the RECORDED `entity_type`, not a name regex.** `lcc_looks_like_person`
   returns true for `Hokanson Companies`, `Matan Companies`, `USAA Real Estate` — six real
   organisations on A2a's population, one of them the largest group in the batch.
4. **Where a pair is not provably the same party, leave it blocked and say so.** A wrong merge
   writes a false ownership fact; an unapplied chain costs nothing. **Report merged / held /
   unprovable separately, with held reasons named.**
5. **Winner rule is ownership-first** (P195): the entity that actually owns assets — not the longer
   name, not the older id.
6. **Expect rows to move BETWEEN blocked reasons, not only out.** A2a saw two tasks go
   `ambiguous_entity` → `repeat_transfer_unrepresentable`; a guard fix carries a chain only as far
   as the next blocker. **Count the destinations.**

## 4. Verify by the DRAIN, and know which metric moves

```sql
-- the goal metric
with per_prop as (
  select source_domain, source_property_id,
         count(*) filter (where not is_current) historical_links
  from lcc_entity_portfolio_facts group by 1,2
)
select source_domain,
       count(*) filter (where historical_links >= 1) any_history,
       count(*) filter (where historical_links >= 2) chain_2plus
from per_prop group by 1;

-- and the blocker this prompt targets
select blocked_reason, count(*) links, count(distinct source_property_id) properties
from v_lcc_ownership_chain_apply_blocked group by 1 order by links desc;
```

**Expect `ambiguous_entity` to fall by the merged pairs, and gov `chain_2plus` to rise from 177.**
⚠️ **It lags by a cycle** — merge, then cron 244 applies at 06:49. **Do not read same-session
flatness as failure**; report merges performed and the first cron's `facts_inserted` separately.

⚠️ **Merges performed is an INPUT, not an outcome.** A run that merges 111 parties and drains no
chains has done nothing this prompt exists for.

## Guardrails

- **No model.** Identity by evidence.
- **Do not touch** `no_entity` (47 — that is the entity-coverage gap, backlog **B2**) or the human
  buckets (`mismatch` 48 + 72 below floor, `all_guarded` 7 + 51 below floor).
- Dry-run default; batch-tagged; reversible; honest counts.
- `npm test` locally; branch → PR → both checks green → merge
  (`docs/os/GITHUB-WORKFLOW.md`); expect the Update-branch gate.

## Deliverables

- The merge pass, the proven round trip, and the drain measured after cron 244.
- Merged / held / unprovable, with held reasons named.
- **The `placeholder` 5-party finding**: what the 5 strings are, and whether they belong in the
  anchored placeholder predicate rather than a merge.
- `docs/architecture/ownership-history-lane.md` §3 and the funnel audit updated with the new
  `chain_2plus`.
