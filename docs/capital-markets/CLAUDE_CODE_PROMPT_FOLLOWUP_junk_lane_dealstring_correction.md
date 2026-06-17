# Claude Code prompt — AMENDMENT to the junk-lane rescope: correct the 47 deal-string retypes

> Quick amendment to PR #1227 (junk-lane rescope). The independent gate verified the rescope
> is sound — lane 758 → 178, 541 person→org retypes all reversible, ~494 genuine clean orgs
> recovered. But **47 of the 541 carry deal-string capture artifacts** in their names that
> the Unit-1 retype should have excluded — the EXACT class Unit-2's new `DEAL_STRING_RE`
> rejects going forward. Unit-1 just didn't apply that same exclusion before flipping them to
> "clean" orgs. Fix the inconsistency. Receipts-first; gated; reversible; no hard-delete.

## The 47 (measured live, retyped set = `metadata.retype_source ~ 'junk'` + `retyped_from`)
- **46 broker-attribution / alias** — `<Real Org> by <net-lease broker>` (overwhelmingly
  "… by Stan Johnson Co / CBRE / Newmark Knight Frank / Cassidy & Pinkard Colliers / Sperry
  Van Ness / Calkain Cos / Kidder Mathews"), plus a few `… via <fund>` and `… AKA <alias>`
  and one `… c/o <people>`. Examples: "NGP Capital by Stan Johnson Co", "Boyd Watterson by
  Stan Johnson Co", "BlackRock Realty by Cassidy & Pinkard Colliers", "Government Props
  Income Trust AKA Office Props Income Trust", "Prime Property Fund via Morgan Stanley Prime
  Property Fund". The entity IS a real org (type flip was right); the NAME is contaminated,
  and several (NGP Capital, Boyd Watterson) already exist as CLEAN registered entities → so
  these are dirty-named DUPLICATES.
- **1 pure sentence fragment** — "The property is currently 100% occupied by DaVita
  Dialysis" — not an entity at all; wrongly retyped.

## Unit A — correct the 47 (gated)
Select: retyped set where `name` matches `DEAL_STRING_RE` (the same regex Unit-2 added:
` by [A-Z]…`, ` via `, ` c/o `, ` aka `, sentence markers `occupied|is currently|the
property|square feet|%`).
- **The pure sentence fragment** → revert the retype (it's not an org) and quarantine it as
  true junk (`junk_name_reviewed=true` / `junk_confirmed`, reversible — like the Unit-3
  residue). It is NOT an organization.
- **The 46 broker-attribution/alias** → **clean the name** (strip the trailing ` by <…>` /
  ` via <…>` / ` AKA <…>` / ` c/o <…>` artifact; stash the original in
  `metadata.name_before_dealstring_clean`, reversible), set `normalized_name`, keep
  `entity_type='organization'` (that part was correct). Then route them to the **merge lane**
  (they're dirty-named dups of clean orgs): if a clean entity with the same canonical name
  already exists, surface the pair as a merge candidate; the human (or the existing
  high-confidence dedup) merges the dirty dup into the clean twin via `lcc_merge_entity`.
  Do NOT auto-merge blindly — surface for review (Tier-2 doctrine).
- Reversible throughout (original name + prior state in metadata); no hard-delete.

## Unit B — make Unit-1's retype consistent (stop re-accrual)
Apply the **`DEAL_STRING_RE` exclusion to the Unit-1 retype** itself: a junk-flagged
firm-suffixed person whose name ALSO matches a deal-string artifact must NOT be retyped to a
clean org — it routes to the same name-clean+merge path (or quarantine for the pure
fragments). So a future retype run can't re-introduce dirty-named orgs. (Unit-2's
`ensureEntityLink` guard already does the right thing at inference; this aligns the bulk
retype pass with it.)

## My gate (read-only)
- The 47 are corrected: the sentence fragment is quarantined (not an org); the 46 have
  cleaned names (artifact stripped, original stashed), are surfaced as merge candidates
  (not auto-merged), and a spot-sample shows clean canonical names (NGP Capital, Boyd
  Watterson…).
- Re-running the retype selection no longer flips a deal-string name to a clean org.
- Everything reversible; the other ~494 clean retypes untouched.

## Guardrails
- Receipts-first; gated; reversible (metadata stash); no hard-delete; no blind auto-merge.
- Reuse `DEAL_STRING_RE` (already added in Unit 2), `lcc_normalize_entity_name`, the merge
  lane / `lcc_merge_entity`. Don't fork. ≤12 api/*.js.
- Net: the junk-lane rescope is now internally consistent — the clean-org recovery stands
  (~494), the 47 contaminated names are cleaned+routed or quarantined, and the retype can't
  re-accrue dirty orgs.
