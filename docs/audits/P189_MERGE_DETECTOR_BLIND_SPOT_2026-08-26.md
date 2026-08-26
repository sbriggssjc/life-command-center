# P189 — the duplicate-entity detector that could not see 1,089 organisations

**Date:** 2026-08-26 · **Project:** LCC Opps (`xengecqvemvfknjvbvrq`) · **Status:** step 2 shipped, live

Step 1 (`20260827020000_..._normalizer_blind.sql`) made the blind spot visible.
Step 2 (`20260827080000_..._fallback_key.sql`, this writeup) closes it inside the detector itself.

---

## 1. The defect

`v_lcc_merge_candidates` — the repo's duplicate-organisation surface — filters
`WHERE norm_name IS NOT NULL`. `lcc_normalize_entity_name()` strips
`group|partners|capital|holdings|company|trust` **on top of** legal forms, so an
acronym-named firm has nothing left and normalizes to **NULL**.

Measured live: **1,089 live organisations carrying $185.1M of current annual rent** are in that
state. They were never in the view at all — not ranked low, not flagged, *absent*.

| owner | rent | `lcc_normalize_entity_name` |
|---|---|---|
| RMR Group | $16.4M | **NULL** |
| AVG Partners | $8.9M | **NULL** |
| GI Partners | $8.6M | **NULL** |
| NGP Capital | $8.5M | **NULL** |

Playbook **Class 11**: a detector that cannot fire reports a clean bill of health, and the zero
is the instrument rather than a finding. CLAUDE.md already recorded this reduce-to-nothing hazard
for `dup-pair-planner.ownerCore` ("Realty Income Corporation" → the empty string) and for
`lcc_owner_strict_core`. **It was never checked on the normalizer the merge detector actually
uses.** The durable lesson: *when a hazard is documented for one function, grep every sibling that
does the same job — the hazard travels with the technique, not the name.*

## 2. The fix, and why it cannot disturb the destructive path

A namespaced `dc:<lcc_owner_domain_core>` fallback key for exactly that population.

The safety argument is **measured, not asserted**: the blind population is **1,089 rows, all of
them `norm_name IS NULL` and zero of them the empty string**. They are therefore precisely the set
the old filter excluded, and are **disjoint** from every existing group. No existing group can
gain or lose a member, so no key, winner or `auto_mergeable` value can move.

Seven gates, run against a pre-migration snapshot of all 5,222 rows:

| gate | result | meaning |
|---|---|---|
| pre-existing groups missing after | **0** | every prior group survived byte-identical |
| normalized groups not in snapshot | **0** | nothing invented on the normalized key |
| `auto_mergeable` total | **3,053** | **unchanged** — applier set untouched |
| fallback rows that are `auto_mergeable` | **0** | can never reach `lcc_apply_fuzzy_merges` |
| key collisions (norm vs fallback) | **0** | the `dc:` prefix cannot collide |
| new fallback groups | **121** | matches the step-1 blind view exactly |
| total rows | **5,343** | 5,222 + 121 |

**⚠️ Fallback groups are forced `auto_mergeable = false`, always.** `lcc_apply_fuzzy_merges()`
loops `WHERE auto_mergeable = true` and calls `lcc_merge_entity()` on every loser. Admitting an
ungraded grouping key to a destructive path would be indefensible. `lcc_owner_domain_core` is a
**grouping** key here, never an **identity** key.

## 3. What is now visible

| | |
|---|---|
| newly visible groups | **121** |
| entities covered | **300** |
| combined annual rent | **$136.5M** |
| groups whose names are **byte-identical** | **60** ($102.4M) |
| groups containing a resolved property owner | **31** |

`dc:ngpcapital` = "NGP Capital" ×5. `dc:rmrgroup` = "RMR Group" + "The RMR Group" ×4.
`dc:avgpartners` ×4, `dc:cimgroup` ×4, `dc:gipartners` ×3.

## 4. ⚠️ The prompt's recommendation for the SECOND blind spot was measured and REJECTED

A wording difference defeats the normalizer even when it returns a value: Easterly's two live
entities give `easterly gov reit` and `easterly government` and never group. Prompt 189 proposed
grouping on the **shared Tier 0 bench email domain** instead, calling it "far better evidence than
any name comparison" and suggesting we "consider grouping on that first."

Graded live over every same-domain owner pair, gated on `NOT lcc_is_spe_shell_name` plus
strict-core containment or a shared 8-character opening:

| class | pairs |
|---|---|
| **net-new, genuine duplicate** | **1** — Easterly Gov Properties (REIT) ↔ Easterly Government Properties |
| net-new, sponsor↔SPE or SPE↔SPE | 3 — Woodbranch Management ↔ Woodbranch Lafayette VA LLC; CENTENNIAL CAMPUS PROPERTY ↔ Centennial Bay; UIRC-GSA V Douglas ↔ V VAN HORN |
| half-blind, all NGP sponsor↔SPE | 13 — NGP ↔ NGP VI PHOENIX AZ LLC, … |
| already visible to the detector | 4 — Cambridge, Cunningham, Gray Harbor, Procacci |

**25% precision on the net-new set; ~6% counting the half-blind NGP pairs.** A domain-keyed
duplicate view would be a noise generator — the Consumption-Layer failure this repo names
explicitly (*a badge that is mostly noise trains the operator to ignore the surface*).

**The domain IS shared — because an SPE family shares its sponsor's domain.** That is the
P190/P193 sponsor→SPE relationship, already modelled. It is real evidence answering a **different
question**, which is exactly the P188 "Gary George" shape: Salesforce membership attests *this
person is real*, never *this person works for THIS owner*.

So the one true positive is a **single named pair** and belongs in the lane as one proposal, not
behind a view. No domain-keyed view was built.

Three further false-positive classes the grading surfaced, worth keeping:
- **shared professional domain** — `jameshowardcpa.com` groups "James Broadhead Corporation" with
  "JAMES FALASCHI LIVING TRUST" (a shared CPA); `madisonpartners.net` groups two unrelated
  buildings; `healthcarerea.com` groups two different REITs through a broker.
- **`lcc_is_spe_shell_name` under-detects place-named SPEs** — it returns false for
  "Woodbranch Lafayette VA LLC" and "NGP VI PHOENIX AZ LLC". Not patched here (a second SPE
  detector is the normaliser drift this repo keeps hitting); recorded as a stated gap.
- **`Easterly Partners` is a different firm from `Easterly Government Properties`** — the P188
  containment/shared-opening arm already separates them, and a looser name test would not.

## 5. A measurement defect caught mid-audit (worth more than the number it fixed)

The first classification query bucketed pairs with
`case when na is not distinct from nb then 'already_in_detector'`. **`IS NOT DISTINCT FROM` treats
NULL–NULL as equal**, so every pair in the blind population — both sides NULL — was labelled
"already in the detector," the exact opposite of the truth. It reported 8 already-visible and 17
net-new; corrected, it is 4 / 13 / 4 / 4 across four classes.

Same family as the P157 `reloptions` trap and the P182 `pg_views.definition` deparse trap: a
predicate that is *structurally unable* to express the question returns a plausible number.
**Three-valued logic is a measurement hazard in any audit that buckets on equality.**

## 6. Verify by

- `select count(*) from v_lcc_merge_candidates where norm_name = 'dc:rmrgroup'` → **1** (was 0 by
  any key; the §4 target of the prompt).
- `select count(*) from v_lcc_merge_candidates where auto_mergeable` → **3,053**, unchanged.
- `test/merge-candidates-fallback-key.test.mjs` — 6 tests, verified RED when the
  `NOT via_fallback` guard is removed.
- **Re-run in a day (P176: a verified result has a shelf life).** The producers that mint these
  entities — the CoStar sidebar and SF sync — are live, so the 121 is a floor.

## 7. NOT done here (deliberately)

- **No entity was merged.** Every one of the 121 groups is proposal-only and human-confirmed, and
  the merge must go through `lcc_merge_entity` (P160 backref repoints, P153 cycle guard,
  tombstone-survivor resolution) — never by hand.
- **`v_lcc_merge_candidates_normalizer_blind` is retained**, not dropped: it is the control that
  proves the fallback covers the population it claims to.
- **Boyd Watterson's 7 zero-rent siblings were not proposed.** Per the prompt's own warning,
  several are JV vehicles ("Boyd Watterson JV UBP") and one is a brokerage artifact
  ("Boyd Watterson by Stan Johnson Co").
- **The §5 decisions remain Scott's** — public universities, the six sponsor→domain entries.
