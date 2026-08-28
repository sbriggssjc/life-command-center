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
