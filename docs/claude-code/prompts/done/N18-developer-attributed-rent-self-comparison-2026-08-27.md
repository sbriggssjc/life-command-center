# N18 — `attributed_rent` is a one-character self-comparison, so every developer candidate shows the same number

> **Read first:** `docs/audits/N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md` §6 (where this was
> surfaced and deliberately NOT fixed), `CLAUDE.md` on **P118 correlated subplans**
> (`loops=` equal to the output row count means no index can fix it — hoist and LEFT JOIN once),
> `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Classes 11 and 18.
>
> ⚠️ **This changes a number an operator classifies on.** It is a small fix with a real decision
> attached: the corrected ranking has never been graded. **Fix it, then grade what moved.**

---

## The defect

`v_lcc_developer_classification_candidates.attributed_rent` correlates the rent subquery on

```sql
pof.source_property_id = pof.source_property_id     -- a column against ITSELF
```

so it sums **every current portfolio fact in the domain** rather than the candidate's. The intended
predicate is `pf.source_property_id = pof.source_property_id`.

**Measured live 2026-08-27 20:20 UTC — confirmed still broken:**

| | |
|---|---:|
| rows in the view | **6** |
| **distinct `attributed_rent` values** | **1** |
| that one value | **$34,920,892** — the gov-wide sum |

**A single distinct value across every row is the Class 11 signal**: not a plausible state of the
world, and it is what makes this findable at all.

It is also **~1,509 ms of the view's 1,666 ms** — a textbook P118 correlated subplan at
`loops=385`. Fixing the predicate should fix both the number and most of the runtime, but **measure
both before and after in ONE session** (raw DB timing is session-variable; the durable evidence is
the structural fact — the subplan gone, buffer count down).

## What to do

1. **Fix the predicate.** One character. Confirm from the plan that the correlated subplan is gone
   (`loops=` no longer equals the row count), not merely that the number changed.
2. **Grade what moved, on named rows.** This is the part that matters. For each candidate, print
   the developer name, the old (fabricated) rent, the new rent, and the resulting rank. **State the
   expected answer before you look.** If the corrected ranking reorders the list, say so plainly —
   an operator has been classifying against a constant.
3. **Check the row count is genuinely 6, and say WHY.** 269 of 277 candidates already sit in
   `lcc_developer_classification_log`, so the view is small by construction, not because the
   population is small. ⚠️ **N15b's "222 of 274" does not reproduce off this view** — that figure
   came from the underlying candidate set. Do not quote the two interchangeably.
4. **Re-verify the N15c repoint held.** N15c repointed this view to compute
   `lcc_normalize_entity_name(e.name)` rather than read `e.canonical_name` (222 → 267 of 277; it
   would have *regressed* to 196 if left alone). Confirm that arm is intact and that your change
   does not disturb it.

## Traps

- **⚠️ A `count(*)` over a scalar subquery optimizes the subquery away.** Time it with
  `count(<the column>)` or you will measure nothing (P118 corollary, already in `CLAUDE.md`).
- **`CREATE OR REPLACE VIEW` is append-only for columns** — Postgres errors `42P16` if you insert a
  column mid-list. Any new column goes at the END.
- **Profile with the handler's REAL query shape**, filters and `ORDER BY` included. `LIMIT 5`
  without the `ORDER BY` lies, by a factor this repo has measured at 95×.
- **A view is live the moment it is applied** — no redeploy — so the equivalence check is your only
  gate. Diff the full row set both directions before and after, and read the one-row deltas rather
  than accepting them (P188: a live Outlook sync once changed a row mid-diff and looked like a
  regression).

## Verify by

The **ranking an operator sees**, not the view compiling: `attributed_rent` must have **more than
one distinct value**, each row's figure must reconcile to that candidate's own portfolio facts on a
named row, and the correlated subplan must be gone from the plan. Report the runtime before/after
from one session.

---

## Not in scope

The **537 held `canonical_name` rows** and the **Class-8 recurrence check** are prompt
**N15d/N15e** — a separate, sequential piece of work on the same subsystem. **A5 / A5a and the
`gap_resolved` auto-close class (playbook Class 18)** belong to the other Cowork thread; do not
touch `handleGenerateResearchTasks` or the research lanes.

## Still open elsewhere (do not action)

**⏳ Dated:** `TIER0_AUTO_ATTACH` — cron 241 at 06:55 UTC is the first honest test; expect
`active_source='tier0_auto'` 0 → 9.
**👤 Scott:** whether `canonical_name` becomes an enforced UNIQUE key (3,930 groups violate it);
`fcp→fcpdc.com` / `tmg→tmgdc.com`; **N3c** bank/trustee scope; **N15** the 1,475 SF-campaign
orphans; **N13** test-suite pruning.
**Carried:** **N3a** (wording-difference duplicates); **N10** (now partly unblocked — N15c rescued
`Partners Group` from the empty key, so that group is finally visible to the detector); **N12**;
**N16**; **N17** (fractional ownership, unsized).
