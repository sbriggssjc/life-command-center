# Prompt B1 — the $500k floor now gates FREE work. Split it by consumer, then re-open the 1,548.

> **Automation/data-process audit window.**
> **Read first:** `docs/audits/BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md` (this prompt's source),
> `docs/architecture/ownership-history-lane.md` (canonical), and the **Consumption-Layer doctrine**
> in `CLAUDE.md`.
>
> ⚠️ **This changes a value gate. Value gates in this repo exist for good reasons and have been
> measured repeatedly. Read §2 before touching the number.**

---

## 1. The finding

Scott's goal: *a connected history of ownership across our target markets, back to the developer.*

**Today: 149 of 13,835 live gov properties (1.1%) have two or more historical owner links.**

The machinery is built and working — A1/A2/A3/A4/A4b produced **314 completions and 304 ownership
facts** in a day, after 69 days at zero. **It is not short of machinery. It is short of
population**, and the largest single reason is measurable:

**1,548 of 1,766 skips in `establish_ownership_history` are `below_value_floor` at $500,000** (last
applied 2026-07-31) — **five times the 314 the lane has completed.**

## 2. ⚠️ Why the floor was right, and why it is now wrong — do not simply delete it

**The floor is correct for a human queue.** Nobody should hand-research the ownership chain of a
$50k property, and this repo has measured the cost of un-gated producers repeatedly (A5c: 84% of a
6,324-row pool owned zero properties). **$500k is a deliberate, shared knob** — the gov asset-mint
floor, `CADENCE_SIGNAL_MIN_VALUE` and P161's weak-role floor all use it.

**What changed is the consumer.** Since **A2 (2026-08-27)** the `agrees` bucket is applied
**automatically by cron 244** from a deterministic, record-cited draft. **No human sees it. The
marginal cost of a chain is now ~zero.** A floor sized for operator attention is suppressing work
that costs nothing — and suppressing exactly the coverage the goal asks for.

**So the fix is to SPLIT the floor by consumer, not remove it:**

- **automated path** (`agrees` → cron 244): **no floor, or a much lower one.** Justify whichever
  you choose with a measurement, not a guess.
- **human path** (`mismatch`, `all_guarded`, anything surfacing to a person): **keep $500k.**

**That distinction did not exist when the floor was set, because the automated path did not exist.**
Say so in the migration header — the next reader will otherwise assume the floor was simply wrong.

## 3. Build

1. **Measure first: what does the automated path actually cost per chain?** Drafting is
   deterministic SQL + a record reference; applying is an insert. **If it is genuinely ~free, say so
   with numbers** (rows, runtime) rather than asserting it.
2. **Split the floor** in `lcc_generate_chain_research_tasks` (cron 144, currently
   `(2000, 500000)`) so the value floor applies **per downstream consumer**, not to the whole lane.
3. **Re-open the 1,548 `below_value_floor` skips** — they were closed by a rule that no longer
   describes the cost. ⚠️ **Reversibly, batch-tagged**, and **after** the split lands, or they will
   be re-skipped on the next run.
4. **Report the new population and what it implies**: how many additional properties become
   draftable, how many chains that yields, and **how many reach a human** (that last number is the
   one that must stay small).

## 4. Guardrails

- ⚠️ **Do not lower the floor on any HUMAN-facing lane.** If the split cannot cleanly separate
  them, **stop and report** rather than lowering both — an un-gated human queue is the failure this
  repo has spent the whole arc unwinding.
- **Watch the mint volume.** A5c's flood measured 2,586 on one run; this could add more. **Cap the
  first run, report `admitted_head_exhausted`, and say whether the backlog is a floor or a total.**
- **`establish_ownership_history` is fed by `lcc_generate_chain_research_tasks`, NOT by
  `handleGenerateResearchTasks`** (the A5a/A5c producer). Different function, different cron (144
  vs 34/35). **Do not conflate them or apply A5c's gate here.**
- Additive, reversible, dry-run default. Honest counts: **chains applied and tasks completed**,
  never "tasks minted".
- `npm test` locally; branch → PR → both checks green → merge
  (`docs/os/GITHUB-WORKFLOW.md`); expect the Update-branch gate.

## 5. Deliverables

- The cost measurement for the automated path.
- The split floor, with the reasoning in the migration header.
- The 1,548 re-opened, batch-tagged and reversible.
- **The projected and then actual effect on the funnel metric that matters:**
  properties with **2+ historical owner links** (today: **149 gov**).
- `docs/architecture/ownership-history-lane.md` §3/§5 and the funnel audit updated.

## 6. Verify

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
```

**Expect `chain_2plus` for gov to rise from 149.** ⚠️ **It will lag** — the seeder mints, the
drafter runs 06:45, the applier 06:49, so a full cycle is a day. **Do not read same-session
flatness as failure**; report the minted population and the first cron's result separately.
