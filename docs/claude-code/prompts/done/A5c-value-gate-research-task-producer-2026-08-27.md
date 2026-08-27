# Prompt A5c — value-gate the research-task producer. Two crons are PAUSED waiting on this.

> **Automation/data-process audit window.**
> **Read first:** `docs/audits/A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md`, the A5a writeup, and
> the **Consumption-Layer doctrine** in `CLAUDE.md` (*no new producer ships without a value gate*).
>
> ⚠️ **Crons 34 and 35 are DISABLED as of 2026-08-27 ~20:07 UTC.** They are waiting on this prompt.
> **Re-enabling them is part of the deliverable** — `cron.alter_job(34, active := true)` and the
> same for 35. Do not leave them off.

---

## 1. Why they are paused

A5a fixed the truncated-feed auto-close and is **live and verified**: a dry run on the production
host returned `membership_complete: true` (7 chunks) and **`would_close: 0` on both domains.**

It also revealed what a *correct* producer emits: **`would_insert` = 1,000 gov + 1,586 dia = 2,586**
on a single `limit=2000` run — and cron 35 fires **every 30 minutes**, so the backlog would mint in
hours and keep going into the **5,509 gaps that have never had a task.**

**That is a producer with no value gate**, and the population is known to be mostly worthless:

- **5,338 of 6,324 (84%) own ZERO properties.**
- Operators and literal placeholders carry **5,227 of 6,442 properties (81% of the apparent value)** —
  `DaVita Inc.` 2,626, `DaVita Kidney Care` 1,183, `Independent` 754, `U.S. Renal Care` 342,
  `Other` 110. This is the documented **P113 tenant-in-the-owner-slot** trap at scale.
- **963 are real prospectable owners**, holding 1,215 properties.

**Minting 6,324 items so an operator can find the 963 is the badge-that-is-noise failure**, and it
would bury the lanes this arc just cleaned.

## 2. What to build

**A value gate on the producer**, so it emits the actionable population and not the pool.

**The floor is not yours to invent — this repo already has one.** `$500k` of annual rent is the
existing shared knob (the gov asset-mint floor, `CADENCE_SIGNAL_MIN_VALUE`, and P161's weak-role
floor all use it). **Reuse it unless measurement says otherwise, and if you deviate, say why.**

**Non-negotiables:**

1. **Exclude operators and placeholders — using the EXISTING flag, not a new name test.**
   `dia.true_owners.is_operator_not_owner` exists and is surfaced on
   `v_property_owner_facts_portfolio.true_owner_is_operator`. **P113 is explicit: never write a
   second name-based operator test**, or the two definitions drift and the panel and the feeder
   disagree. Placeholders (`Independent`, `Other`) need an anchored predicate — check
   `lcc_is_placeholder_owner_name` first rather than writing another.
2. **⚠️ UNKNOWN IS NOT SMALL.** P161 measured this exact trade and gated *unknown-rent* owners
   rather than admitting them. State which way you go and why — **do not let a null rent silently
   pass the floor.**
3. **Value is per OWNER, never per task.** Multiple properties per owner inflate any per-task sum;
   this repo has measured 2× and 4.65× overstatements from exactly that.
4. **The gate belongs in the PRODUCER's selection**, not in a downstream surface filter. A filter
   still pays to mint and still lets the count lie.
5. **Report the gate's effect honestly**: pool → admitted, with the excluded population broken out
   by reason (operator / placeholder / below floor / unknown rent). **"6,324 → 963" is the claim to
   verify, not to assume** — re-measure it yourself.

## 3. ⚠️ This producer serves MORE than one lane

A5a established it feeds several dia+gov lanes. **A gate applied bluntly will starve lanes that are
working.**

- **Enumerate every lane this producer emits**, with each one's current open count and 30-day real
  completion rate (`outcome NOT ILIKE '%gap_resolved%'` — the auto-close is not throughput).
- **`establish_ownership_history` must not be starved** — it is the one lane in the system with
  genuine completions (314, 0% auto-closed) and it is still draining.
- **Per-lane floors may be necessary.** If one gate does not fit all lanes, say so and scope it
  rather than forcing a single number.

## 4. Also decide, and state it

**`owner_needs_sos` has 24,077 rows and is unreachable today.** A5a's writeup flags that a corrected
producer gives gov `owner_needs_salesforce` its first 430 tasks while that lane stays invisible.
**Say whether the gate changes that, and if it does not, file it** rather than leaving it implied.

## 5. Deliverables

- The value gate, in the producer, with the floor sourced from the existing knob.
- The measured effect: pool → admitted, exclusions by reason, **per lane**.
- **Crons 34 and 35 re-enabled**, with the first live run's `inserted` reported.
- A backlog row for anything deferred (`owner_needs_sos`, per-lane floors).
- `npm test` locally; branch → PR → both checks green → merge
  (`docs/os/GITHUB-WORKFLOW.md`); expect the Update-branch gate.

## 6. Verify

```sql
-- after re-enabling, the first run should mint the ACTIONABLE population, not the pool
select research_type, count(*) filter (where created_at > now()-interval '1 hour') minted_1h,
       count(*) filter (where status in ('queued','in_progress')) open_
from research_tasks group by 1 order by minted_1h desc;
```

**Expect hundreds, not thousands.** ⚠️ **And do not read a small mint as the gate failing** — a
gate that admits 963 of 6,324 is working exactly as intended. The failure mode to watch for is the
opposite: a mint in the thousands means the gate is not in the selection path.

**Then confirm `gap_resolved`-per-day stays at ~0** — A5a's fix must not regress while this lands.
