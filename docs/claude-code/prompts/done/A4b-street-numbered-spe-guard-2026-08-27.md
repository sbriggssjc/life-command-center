# Prompt A4b — a P138 guard rejects any SPE named after a street number. Size it, then fix it.

> **Automation/data-process audit window.**
> **Read first:** `docs/architecture/ownership-history-lane.md` (canonical), the A4 writeup,
> and the P138 guard section of the **government-lease** repo.
>
> ⚠️ **The defect is WIDER than the 18 tasks that surfaced it. Size the whole blast radius before
> changing a predicate.**

---

## 1. What A4 found

A4 measured all 27 rejected transitions behind the 18 `all_guarded` tasks and computed **which arm
fires per name** rather than eyeballing:

| arm | rows | tasks | rent |
|---|---:|---:|---:|
| `prior_owner_unclean` | 15 | 8 | $23.2M |
| `new_owner_unclean` | 8 | 6 | $4.7M |
| `self_transition` | 3 | 3 | $4.9M |
| `name_variant` | 1 | 1 | $0.7M |
| **`is_oscillating_pair`** | **0** | **0** | — |

**Zero oscillating pairs** — the hypothesis this bucket was written on is refuted.

**The real defect: `\m[0-9]{5}\M` in the gov `*_is_clean` predicate rejects any SPE named after a
street number ≥ 10000.** Live casualties: `EGP 17101 BROOMFIELD LLC`, `DE 10990 Wilshire, LLC`.
These are ordinary, legitimate SPEs.

**And there is a clean discriminator, already measured:** the junk the guard **correctly** catches
has **no legal form** (`Houston, Harris County, Texas 77007`); every real SPE carries one
(`LLC`, `LP`, `Inc`, `Trust`, …).

**10 of 18 tasks would be unblocked** by a correction.

## 2. Before you touch the predicate — size the blast radius

The guard runs on **every** gov ownership transition, not just these 18. A4 noted it also drops
links **inside chains that did draft** — so the visible 18 are a lower bound.

**Measure and report, fleet-wide:**
1. How many `gov.ownership_history` transitions does the 5-digit arm currently reject?
2. Of those, how many carry a legal form (→ likely genuine) vs none (→ likely junk)?
3. How many additional chains would become draftable or gain links?
4. **What does the corrected predicate let through that the current one blocks — by name.** Read
   the actual strings. A rate is not a review.

**⚠️ Point the detector at a known positive before trusting any zero** (P182). Confirm your query
reproduces the two named casualties above.

## 3. The fix

Narrow the 5-digit arm so it only rejects when there is **no legal form present** — or whatever the
measurement shows is the true discriminator. **Do not simply delete the arm**: it is catching real
junk, and removing it wholesale trades one silent error for another.

**Non-negotiables:**

- **This predicate lives in the `government-lease` domain.** Change it where it is defined; do not
  fork a copy into LCC. A second definition is the normaliser drift this repo has paid for
  repeatedly.
- **Fill-blanks / additive.** Unblocking a chain must not overwrite an existing fact.
- **The downstream consumer already exists** — cron 244 applies newly-draftable chains the same
  night. **Do not write a second applier.**
- **Verify by the drain, not the predicate.** `all_guarded` should fall and `agrees` rise; report
  `facts_inserted` / `tasks_completed` after cron 244, never "transitions unblocked".

## 4. ⚠️ Two other arms are dropping rows and were NOT diagnosed

`prior_owner_unclean` (15 rows) and `new_owner_unclean` (8) are the two largest. A4 identified the
5-digit arm inside them; **it did not establish that the 5-digit arm explains all 23 rows.**
**Split them: how many are the street-number case, and what are the rest?** If another sub-arm is
also misfiring, say so and size it separately rather than folding it into this fix.

`self_transition` (3 rows) is likely correct — a party transferring to itself is the `gsa_lease_diff`
flicker, and A2b owns that. **Leave it.**

## Guardrails

- **No model.** Structured, deterministic.
- **Do not touch** `mismatch` (49), `sponsor_spe` (25) or the blocked `agrees` residue — A3/A2a/A2b
  own those.
- Dry-run default; reversible; honest counts.
- `npm test` locally; branch → PR → both checks green → merge
  (`docs/os/GITHUB-WORKFLOW.md`), and expect the Update-branch gate.

## Deliverables

- The fleet-wide size of the defect **before** and the drain **after**.
- The corrected predicate, in its home repo, with the discriminator stated.
- The named rows the correction admits — read, not just counted.
- The `prior_owner_unclean` / `new_owner_unclean` split, with anything else misfiring sized
  separately.
- `docs/architecture/ownership-history-lane.md` §3 and §5 updated with the new counts.

## Verify

```sql
select action, count(*) from v_lcc_ownership_history_lane_split group by 1 order by 2 desc;
```

**Expect `all_guarded` 18 → ~8 and `agrees` to rise.** `mismatch` and `sponsor_spe` must not move.
