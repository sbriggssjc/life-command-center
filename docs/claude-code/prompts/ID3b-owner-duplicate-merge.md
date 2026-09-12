# ID3b — Owner entity duplicates: execute RO2a's already-sized merge, don't re-audit

**Repo: `life-command-center`.** Scott's #3 identity class (2026-09-12, ranking: ID3a → ID3e → **ID3b** → ID3d →
ID3c-last). Government DB + Dialysis_DB. **This row's original ID0-era numbers are STALE and its scope has
shrunk on live measurement — read this whole section before doing anything.**

## Why this, why now — and why it's smaller than it looks

ID3b was filed from the ID0 probe's counts: gov `true_owners` "1,278 collapsible names / 81 identical
`canonical_name` groups," `recorded_owners` "1,241 / 115"; dia `recorded_owners` 390, `true_owners` 208. **Measured
live 2026-09-12 (Cowork), those exact-duplicate numbers are gone:**

- gov `true_owners` (16,274 rows, 1,213 already `merged_into_true_owner_id`): **live unmerged rows carry only 33
  duplicate-`canonical_name` groups (66 rows)** — down from 81/1,278.
- gov `recorded_owners` (17,258 rows, 116 merged): **live unmerged rows carry ZERO duplicate-`canonical_name`
  groups.**
- dia `true_owners` (7,168 rows, 132 merged) and `recorded_owners` (7,284 rows, 240 merged): **ZERO
  duplicate-`normalized_name`/`canonical_name` groups on either table.**

**Why:** this repo already runs live owner-merge machinery on gov — `apply_owner_merge`, `apply_true_owner_merge`,
`owner_merge_tick`, `unify_owners_tick`, `canon_owner_key`, `gov_owner_set_canonical_name` (functions, confirmed
live) — which has been steadily collapsing exact/canonical-key duplicates since ID0's snapshot. **Review existing
machinery before building, per doctrine: this machinery already does most of what ID3b originally asked for.**
Don't re-derive an identity audit ID0 already ran and this machinery has since mostly resolved.

**The real remaining gap, in two pieces, both already characterized:**

1. **gov `recorded_owners` fuzzy-variant merge — already fully sized by `RO2a` (2026-09-11, one day old,
   `docs/os/PLANNED-BACKLOG.md` RO2a row), NOT built.** `gov_owner_strict_core` fleet-wide (core length ≥4) found
   **311 exact-duplicate-name groups (628 rows)** and **1,069 true variant groups (2,242 rows, 1,218 properties)**
   — `Baker Properties Limited Partnership` / `Baker-Properties, Ltd.` shape. RO2a's own audit flags the hazard:
   **`CBRE`/`CBRE, Inc.` and bank/lienholder variants are the same risk class `RO2b` just fixed** (a brokerage or
   lender captured as grantee is not a real owner) — **every group must be checked against `gov_owner_name_is_brokerage`,
   `is_generic_gov_owner`, and a bank/lender pattern (RO2b's `granteePassesOwnerGuards` guards, already live in
   `api/_handlers/sidebar-pipeline.js`) before merging, never blind-merged.** This is the build — follow RO2a's own
   recommendation ("big enough to be its own build") rather than re-sizing it.
2. **gov `true_owners` fuzzy-variant residual — newly measured, not previously sized.** Same `gov_owner_strict_core`
   method on live unmerged `true_owners`: **237 variant groups / 483 rows / 468 distinct name variants** — smaller
   than `recorded_owners`' because `unify_owners_tick` already runs against this table. Apply the identical guard
   discipline as RO2a before merging (a true_owner is more consequential to get wrong — it drives the CM by-owner
   rollups and prospecting).
3. **dia is clean on both tables — no build needed there.** Confirm this stays true after any gov work (dia's
   crons are separate) rather than assuming it forever.

## 1. Measure before merging (repeat live — RO2a's numbers are a day old, mine are from today)

Re-run RO2a's `gov_owner_strict_core` grouping on live unmerged `recorded_owners` AND `true_owners` (both, not just
recorded_owners as RO2a scoped it). For every group, run it through `gov_owner_name_is_brokerage`,
`is_generic_gov_owner`, `gov_owner_name_has_legal_form`, and a bank/lender name check — **route any hit to human
review, never auto-merge it**, exactly RO2a's own caveat. Spot-check the largest few groups and the short-core
(4–6 char) end by hand before trusting the bulk.

## 2. Merge it

- Use the existing `apply_owner_merge` / `apply_true_owner_merge` functions (already live, already used by
  `owner_merge_tick`/`unify_owners_tick`) — do not write a second merge mechanism. If they can't take a
  caller-supplied pair (built only for their tick's own candidate source), extend them minimally rather than
  forking.
- Every merge moves `properties.recorded_owner_id`/`true_owner_id` and any deed/lease FK refs, sets
  `merged_into_recorded_owner_id`/`merged_into_true_owner_id` (retire, never delete — this repo's standing rule),
  and is logged reversibly (the `lcc_merge_entity`-style pattern already used elsewhere in this repo).
- Dry-run first, report the auto/review split, apply only after the guard-filtered auto set is confirmed clean on
  a sample.
- Parity: property counts per owner before/after — the only movement should be variants merging into one owner,
  never a property changing to a DIFFERENT real owner.

## 3. What NOT to do

No new identity audit — RO2a already did this for `recorded_owners`; this build executes it. No agency/guarantor/
broker work (ID3a shipped, ID3d/ID3c later in the ranking). No touching `true_owners.is_operator_not_owner`/OWN4's
395 operator-in-owner-slot rows — that's a documented, separate doctrine decision, not a merge. No work on dia —
it's already clean; note that finding, don't build against it.

## Guard + ship

Tests: the guard rejection (brokerage/generic/legal-form/lender names never auto-merge), a positive control merge
rolled back, parity counts. Full suite green. Branch → PR → CI → merge (no Railway redeploy needed unless a
consumer view changes).

## Ship + record

Report: groups found today (recheck against RO2a's day-old numbers and mine), guard-rejected count, auto-merged
count with parity table, review-lane population left for a human. Update `PLANNED-BACKLOG.md` (ID3b, RO2a — mark
executed), `STATUS.md`, `CURRENT-STATE.md`.
