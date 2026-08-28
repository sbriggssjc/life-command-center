# B1 — the $500k floor was gating FREE work. Split it by consumer.

**2026-08-28 · LCC Opps · migration `20260828120000_lcc_b1_split_chain_value_floor.sql` (applied live).**
Source: `docs/audits/BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md` Lock 1.
Canonical subsystem doc: [`docs/architecture/ownership-history-lane.md`](../architecture/ownership-history-lane.md).

> **One line:** the floor was right for a human queue and wrong for a cron. It now applies
> **per consumer** — none on the automated path, unchanged at $500k on anything reaching a person.

---

## 1. The finding, and the correction to it

**1,548 of 1,766 skips** in `establish_ownership_history` were `below_value_floor` at $500,000 —
five times the 314 the lane had completed. The floor (R60, `20260622120000`) was **correct when
set**: the lane was a human research queue whose instruction reads *"pull the county deed history
via the county-recorder portal"*, and $500k is a deliberately shared knob (the gov asset-mint
floor, `CADENCE_SIGNAL_MIN_VALUE`, P161's weak-role floor).

**What changed is the consumer, not the judgement.** Since A2 (2026-08-27, cron 244) the `agrees`
bucket is applied automatically from a deterministic, record-cited P131 draft, and A4 (cron 245)
auto-retires `no_records`. No human sees either.

⚠️ **Two corrections to the audit's framing, both measured:**

1. **"1,548" is not one population.** It is `establish_ownership_history` across **both** domains:
   **gov 1,501 + dia 47**. And `trace_ownership_to_developer` carries a *further* 983 below-floor
   skips (gov 514, dia 469) that the audit did not mention at all. Only the gov
   `establish_ownership_history` slice has an automated consumer.
2. **The re-openable set is 1,414, not 1,501.** 86 of the 1,501 are no longer suggested by
   `v_ownership_chain_worklist` (the gap resolved or the suggestion changed) and one already has an
   open task. Re-opening those would have them swept straight back as
   `chain_gap_resolved_or_changed` the next morning — churn that reads like a working producer.

## 2. ⚠️ The floor stays everywhere the automation does not reach — and that boundary was measured

The automated path exists for exactly **one** `(domain, research_type)` pair, and the reason is
structural rather than a policy choice:

| | gov | dia |
|---|---|---|
| `v_ownership_transitions_portfolio` (the drafter's only source) | **9,595 transitions / 4,698 properties** | **DOES NOT EXIST** — zero objects matching `%ownership_transition%` on `zqzrriwuavgrquhisnoa` |
| consumed by A2 (cron 244) / A4 (cron 245) | `establish_ownership_history` only | — |

So a **dia** task can never be drafted, never auto-applied, and lands on a person; and
`trace_ownership_to_developer` has a different consumer path (cron 145's
`developer-chain-resolve-tick`) that has **not** been graded. Lowering the floor for either would
mint work no automation can touch — the Consumption-Layer failure this repo has spent the whole arc
unwinding.

**Held by design, and reported as such** by `lcc_b1_reopen_below_floor`:
dia `establish_ownership_history` 47 · dia `trace_ownership_to_developer` 469 ·
gov `trace_ownership_to_developer` 514.

`lcc_chain_lane_has_auto_consumer(domain, research_type)` is the **single owner** of that boundary,
called by both the seeder and the re-open sweep so the two cannot drift about which rows the low
floor applies to.

## 3. The cost of the automated path — measured, not asserted

| stage | measured 2026-08-28 | how it scales |
|---|---|---|
| drafter gov read | **508 ms per 60-property chunk**, 14,524 buffers | **per CHUNK, not per chain** |
| drafter write | 200 proposals in **29 s** end to end (HTTP 200) | linear in proposals |
| A2 apply | **450 ms** for the whole open lane (dry run) | per run, not per task |
| operator minutes | **zero** | — |

⚠️ **The gov read is almost entirely FIXED cost.** `v_ownership_transitions_portfolio` materialises
its whole `norm` CTE (9,595 rows) **plus an oscillating-pair self-join** on every request; only
**71 of 9,595** rows survived the 60-id filter. Admitting the entire below-floor gov population
(1,257 draftable) is ~21 chunks ≈ **10.7 s of gov DB time, once** — about **8 ms per chain**.

That is the number the floor was being asked to protect. It is not a number worth protecting.

## 4. Two gates, two directions — the asymmetry is deliberate

The automated floor and the human floor answer different questions, so they treat an **unknown**
value in opposite directions and both are correct:

- **automated path — unknown value is ADMITTED.** Drafting is ~free; refusing a free chain because
  we cannot price it buys nothing.
- **human surface — unknown value is GATED.** *"We cannot size it"* is not evidence it is worth an
  operator's time (P180: NULL is not zero; A5c gates `value_unknown`).

⚠️ **The human gate is NOT at the seeder, and it cannot be.** The seeder mints *before* the drafter
runs, and it is the **draft** that decides whether a task is `agrees` (automation) or `mismatch` (a
person). The human floor therefore lives on
`v_lcc_ownership_history_lane_split.human_actionable` — the single owner of *"does a person need to
look at this"*, which `v_lcc_research_lane_summary.human_actionable_tasks` already reads.

`human_gate` names the four states rather than collapsing them into the boolean —
`actionable` · `below_value_floor` · `not_human` · `awaiting_draft`. A card held back by the floor
is a different fact from one that was never a human's job, and from one the drafter has not reached
yet (P181: one label covering two facts is what makes a population invisible).

## 5. What shipped

| object | role |
|---|---|
| `lcc_chain_lane_has_auto_consumer(domain, research_type)` | the SINGLE owner of the automated/human boundary; called by the seeder AND the re-open sweep so they cannot drift |
| `lcc_chain_human_value_floor()` | the $500k knob for anything reaching a person |
| `lcc_generate_chain_research_tasks(limit, min_value, auto_min_value)` | per-consumer floor in **both** the skip sweep and the mint |
| `v_lcc_ownership_history_lane_split` | `human_actionable` gated on the floor; `lane_value` / `human_value_floor` / `below_human_floor` / `human_gate` appended |
| `lcc_b1_reopen_below_floor` / `lcc_b1_unreopen` + `lcc_b1_reopen_log` | reversible, batch-tagged re-open |
| `lcc_b1_chain_seed_preview` | `admitted_head_exhausted` without minting |
| cron 144 | now `lcc_generate_chain_research_tasks(2000, 500000, 0)` — same jobid, same schedule |

⚠️ **The old 2-arg signature was DROPPED before the 3-arg was created.** A defaulted overload makes
every 2-arg call *"function is not unique"* (42725) — the N15d/N15e trap.

## 6. Verification

**Positive control first — the view change moves nothing on today's population.** All 131 open tasks
were ≥$500k, so `agrees` 51 / `all_guarded` 7 / `mismatch` 48 / `sponsor_spe` 25 and
`human_actionable` **55** were identical before and after.

⚠️ **A gate that never fires is indistinguishable from a broken one** (P182). Proven with a
self-rolling-back probe: setting one `mismatch` task's `rank_value` to 499,999 moved
`human_actionable` **55 → 54**, moved the lane-summary badge **55 → 54**, and gave that task
`human_gate = 'below_value_floor'` — then rolled back.

**The reversal was RUN, not claimed** (P195). A 5-row batch was re-opened and un-re-opened:
**5 of 5 restored, status and outcome byte-identical**, selection value-first
($536,938 → $497,356).

### Re-open

`1,414 re-opened / admitted_head_exhausted: true` — **100% gov, 100%
`establish_ownership_history`, zero non-gov rows**, so the consumer predicate held in practice.
`held_by_design` reported dia `establish` 47 · dia `trace` 469 · gov `trace` 514.

### The drain (drafter cron 239 → applier cron 244, driven manually through the production path)

| | before | after |
|---|---:|---:|
| lane completed ever | 336 | **1,237** |
| gov properties with **any** ownership history | 1,272 | **2,173** |
| gov properties with a **chain (2+ historical links)** | **149** | **177** |
| `human_actionable` badge | **55** | **55** |

**89% of the newly-drafted population routes to automation.** Of the first 200 drafted:
145 `agrees` (A2 applies) · 25 `no_records` (A4 retires) · 8 `sponsor_spe` (terminal) ·
**22 human-shaped — every one below the floor and held.** At the end: `mismatch` +72 and
`all_guarded` +51 all sit at `human_gate = 'below_value_floor'`, and **the operator's badge never
moved off 55.** That is the whole design working.

⚠️ **`any_history` moved 7× harder than `chain_2plus`, and that is a property of the POPULATION,
not a shortfall.** Measured before shipping: only **210 of 1,501** below-floor properties have ≥2
guard-passing transitions. A single recorded prior owner is real ownership history and is what most
of this population carries. **Do not read +28 as the ceiling** — the remaining chain depth is gated
by the A2-blocked residue, not by the floor: `ambiguous_entity` **126 links / 123 properties**
(the A2a duplicate-entity class), `no_entity` 49/47, `placeholder` 44/31. **Those are now the
binding constraint on `chain_2plus`.**

⚠️ **The backlog is a FLOOR, not a total, and the cap lives downstream.** The drafter clamps
`limit` to 500 and scans a **600-row** lane window (`lane_scan_capped: true` says so honestly), so
each run drafts what that window exposes and the lane advances only as A2 **completes** tasks and
they leave the open lane. 53 tasks were still `awaiting_draft` at the end of the session; cron 239
(06:45) → cron 244 (06:49) drains them without further intervention. **Read `written_draftable` and
`facts_inserted`, never `already_drafted` or `links_already_present`** (P159a).

## 7. Not done, and named

- **`trace_ownership_to_developer` keeps the $500k floor** — 983 below-floor skips. Its consumer
  (cron 145 `developer-chain-resolve-tick`) has not been graded the way A2 has. Grading it is the
  next decision, not an assumption.
- **dia keeps the floor and cannot be lifted by a flag** — it needs a
  `v_ownership_transitions_portfolio` equivalent built on the dia side first. 516 rows held.
- **The A2-blocked residue is the new binding constraint** on chain depth (above). `ambiguous_entity`
  is the A2a merge class and applies unaided once merged.
- **⚠️ Observability gap, surfaced not fixed:** `lcc_ownership_chain_draft_run_log` rows are opened
  (`status='started'`) and several never close — today's 06:45 cron run included — even though the
  handler returns HTTP 200 and writes its proposals. The work is fine; the close path is not. Read
  the pg_net response body or the proposal delta, not the run log, until that is fixed.
