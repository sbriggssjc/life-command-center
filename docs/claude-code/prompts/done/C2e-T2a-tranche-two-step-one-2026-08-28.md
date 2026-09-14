# C2e-T2a — tranche two, step one: owner rent ≥ $100k (2,570 properties / 2,300 owners)

> **Read first:** `docs/architecture/connectivity-and-open-threads.md` **§4f–§4i** (canonical chain
> state, Scott's floor decision, and tranche one's measured result),
> `docs/audits/C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md` **§6** (the tranche-two analysis this
> implements), `CLAUDE.md` §"Asset-identity coverage is what gates owner resolution",
> `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Classes 8, 11, 18.
>
> ⚠️ **This WRITES to production.** Dry-run first, batch-tagged, reversible.
> ⚠️ **T2a ONLY. Do not run T2b** (below $100k + rent-unknown) — that is Scott's separate call.

---

## What tranche one established, and what it did not

**Established (C2e):** the eligible-set mint works and its noise cost is structurally near-zero.
2,000 minted → **2,000 resolved an owner, 0 evidence-less**. `v_lcc_merge_candidates` and
`v_lcc_merge_candidates_normalizer_blind` filter **`entity_type='organization'`**, and a minted asset
is **`entity_type='asset'`** — it *cannot* enter either surface. Whole observable cost: **+20
`v_duplicate_candidates` rows (+0.25%)** and +23 Tier 0 cards with **`auto` flat at 9**.

**⚠️ NOT established: that this generalises down the rent curve.** Tranche one's cut landed at
**$543,782 of owner gov rent — entirely ABOVE the old $500k floor.** It tested the safest population
in the system and **exercised none of the low-rent tail the no-floor decision was actually about.**
C2e measured tranche two as mildly worse, not catastrophically: duplicate-group formation
**1.5× the rate** (1.50% vs 1.00%), within-batch name collisions 1.25% vs 0.40%.

## The set to mint

`v_lcc_c2e_asset_mint_plan` holds the remaining **4,811 properties / 4,354 owners** (verified
2026-08-28). T2a is the slice with **`owner_gov_rent >= 100000`**:

| | |
|---|---:|
| properties | **2,570** |
| distinct owners | **2,300** |
| already contactable | **17.2%** — statistically indistinguishable from tranche one's 21.3% |
| public bodies (lower bound) | 2.7% |

**It covers the whole of Scott's stated sweet spot** — $2M–$20M of value is $140k–$1.4M of rent at a
~7% cap.

Use `lcc_mint_gov_asset_entities(p_rows jsonb, p_batch text, p_dry_run boolean DEFAULT true)`.
**It takes a ROW LIST — there is no `--min-rent` inside it.** Batch-tag it (suggest
`c2e_gov_eligible_t2a_20260828`), **identities before entities** (P141), reversible by
`metadata->>'mint_batch'`.

## ⚠️ The step that must not be skipped

**Drive `lcc_ingest_domain_owner_evidence` explicitly after the mint.** Cron 225 caps at **400
rows/run, daily** — left to the schedule, a 2,570-row tranche would sit **evidence-less for most of a
week**, matching the documented retire predicate ("a minted entity with no evidence and no portfolio
fact has no consumer") the eligible-set design exists to prevent. **Verify 0 evidence-less entities
before declaring the tranche done**, exactly as tranche one did.

## Gates — measure before and after, in one session

| surface | expectation |
|---|---|
| **`auto_mergeable`** | **no movement from this mint** — assets cannot enter `v_lcc_merge_candidates` |
| `v_lcc_merge_candidates`, `…_normalizer_blind` | unchanged, same structural reason |
| `v_lcc_canonical_name_drift` | **0** |
| Tier 0 lane `auto` | **unchanged** — the only band that can trigger an unattended write |
| Tier 0 `ask` / parked | may grow; report it |
| `v_duplicate_candidates` | expect ~**+38 groups** (1.50% of 2,570); **predict before measuring, then reconcile** |
| entity count | ~+2,570 on 64,293 (**+4%**) |
| **eligible-set promise** | **minted = resolved, evidence-less = 0** |

### ⚠️ Two attribution traps, both hit in this arc already

1. **`auto_mergeable` has TWO threads moving it.** C2e reported it unchanged at 3,038; a check hours
   later read 3,005 — **64 merges from the other Cowork thread**, not the mint. **Read
   `lcc_entity_merge_log` for the window before attributing any delta to your own change**, and
   timestamp every "unchanged" claim.
2. **Predict the delta, then reconcile it.** A number that moves "about right" is not the same as a
   number that moves for the reason you think (the A2 `on conflict do nothing` lesson).

## Traps already paid for

- **gov ONLY. Do not sweep dia in** — 84% of its un-minted owner slots hold an **OPERATOR** (P113)
  and 73% of its would-resolve population has no rent on file.
- **Honest counts** — minted vs already-present vs the **write delta measured by `count=exact`
  before and after**. A send counter is not a write counter.
- **PostgREST caps responses at 1,000 rows** regardless of `limit`. A round number is a bug signal
  (Class 18). The mint takes a row list, so **build it in SQL, not through a paged REST read.**
- **An implausibly clean result is a bug signal** (Class 11) — point each before/after detector at a
  known positive first, the way C2e proved the drift detector could fire (64,356 against a
  deliberately wrong key).
- ⚠️ **`lcc_looks_like_person` is NOT a private-individual census** — it returns true for
  `CITY OF SALEM` and `BROOME COUNTY` (the A3/P196 two-capitalised-token false positive). Every
  public-body figure is a **lower bound**. **Do not write a second name classifier** — that is the
  normaliser drift this repo has paid for repeatedly.

## Verify by

**Not rows minted.** By: **minted = resolved and evidence-less = 0**; the asset-anchor delta
(7,145 → ~9,700) and `lcc_property_owner` delta (6,065 → ~8,600 rows, 3,743 → ~6,000 owners); every
gate above with `auto_mergeable` movement **attributed** if it moves; and a recommendation on T2b
that says what tranche two's real population looked like versus C2e's prediction.

---

## Not in scope

- **T2b** — below $100k + rent-unknown (2,241 properties / 2,054 owners). ⚠️ **Scott's call, and the
  argument has changed**: C2a said stop to avoid manufacturing noise and **C2e measured that premise
  as largely false**. What remains is a judgement about *prospect quality* — mostly cities,
  counties, DOTs, corporate occupiers and private individuals — against Scott's own *resolve all
  ownership, rank later*. **Report what T2a's outcome implies for it; do not run it.**
- **dia.** **C2f** (the 3,362 gov properties with no `true_owner_id` — a gov-side capture question).
  **C2b** (the Salesforce bridge). The research-task lanes and **B1** — the other Cowork thread.

## Still open elsewhere (do not action)

**👤 Scott:** `canonical_name` as an enforced UNIQUE key (**6,608** violating groups); the fcp/tmg
sponsor entries; **N3c** bank/trustee scope; **N13** test-suite pruning; **C2e-T2b**.
**Carried:** **N19b** (24 husk duplicate pairs + 9 cross-`entity_type` pairs that must never merge) ·
**N3a** · **N16** · **N17** · **C2c** (unmeasured: dia ownership depth, developer/investor/buyer
split, Outlook per contact, **WebEx is not in the schema at all**, broker assignment on 2,302
cadences) · **C2d** (the five-floors doc fix).
