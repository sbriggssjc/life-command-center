# Claude Code — R64: Decision Center — surface actionable verdict lanes, gate the federated noise (Consumption Layer instance #4)

## Why (live Decision Center audit, 2026-06-23)
First fix written explicitly against the **Producer/Consumer (Consumption Layer) doctrine**
now in CLAUDE.md. The Decision Center splits cleanly into two halves:

- **Auto-supersede lanes — HEALTHY** (consumer keeps pace): `match_disambiguation` 978
  superseded / 30 open; `junk_entity_name` 588 superseded + 1,082 skipped / 198 open. These
  self-drain as data lands — leave them.
- **Verdict lanes — ACCUMULATING, `decided_7d = 0` across every lane**: `confirm_true_owner`
  175 open (1 ever decided), `sf_link_collision` 114 open (all new this week, 0 worked),
  `map_sf_parent_account` 17, `sf_link_conflict` 6. The operator essentially never clicks a
  verdict — and the reason is invariant #3/#5: the **"999+" badge is the federated DQ
  universe** (provenance_conflict + property_merge, ~10k, list-federated/worked-on-demand)
  which **buries the ~290 genuinely-actionable verdicts** under noise. The operator can't find
  "175 high-value owners to confirm" under 999+ of provenance conflicts.

Doctrine application: separate actionable verdicts from the federated universe (honest count),
value-rank + cap them, and auto-resolve the safe mechanical subset so only real judgment calls
remain for the human. Keep ownership confirmation human (risk). Reversible; reuse the existing
`lcc_refresh_decisions` sweep + `lcc_merge_entity` + verdict dispatch — no new machinery.

## Unit 1 — separate actionable verdict lanes from the federated DQ universe (invariants #3, #5)
- The **primary Decision Center surface + nav badge** = the seeded actionable verdict lanes
  (`confirm_true_owner`, `sf_link_collision`, `sf_link_conflict`, `map_sf_parent_account`,
  `confirm_buyer_parent`, `junk_entity_name` remainder). The badge shows the **actionable open
  count (~290)**, not 999+.
- The **federated DQ lanes** (`provenance_conflict`, `property_merge`, and the other
  list-federated source-view lanes, ~10k) move to a clearly-labeled secondary **"Data Quality
  review"** group with their OWN counts — they no longer inflate the primary badge. They stay
  worked-on-demand (that's fine for back-office DQ), just not masquerading as the primary
  worklist.

## Unit 2 — value-rank + cap the verdict lanes (invariant #3)
Order each verdict lane by value (the R7 `rank_value` / owner rollup-rent the lane already
carries) DESC NULLS LAST, and cap the rendered set (top-N, "show all" toggle). So the operator
works the highest-value owners/collisions first — "confirm the $28M owner," not row 1 of 175
arbitrary.

## Unit 3 — auto-resolve the SAFE mechanical subset only (invariant #2)
Extend the `lcc_refresh_decisions` sweep (the auto-supersede model) to auto-resolve the
unambiguous mechanical cases, reversibly, leaving genuine judgment calls open:
- **`sf_link_collision`**: when the colliding identities resolve to the **same entity** (true
  duplicate — same canonical owner, one SF id), auto-merge via the existing `lcc_merge_entity`
  and close the decision. When the collision is between **distinct** entities (a real "which
  owner?" question), leave it open for a human.
- **`map_sf_parent_account`**: when there's exactly one unambiguous SF account match for the
  parent (single high-confidence candidate), auto-map and release the held government_buyer
  sync; multiple/ambiguous candidates stay open.
- **`confirm_true_owner`**: **KEEP HUMAN** — do NOT auto-confirm ownership (too risky); just
  value-rank it (Unit 2) so the high-value ones actually get worked. (This is the deliberate
  exception: invariant #2 auto-resolves only where it's *mechanically* safe.)
- Dry-run first; report the auto-resolvable subset size per lane before applying; reversible
  (the merge + the decision close are both reversible via existing paths).

## Unit 4 — honest badge + counts (invariant #5)
The Decision Center nav badge + lane chips reflect actionable open verdicts (post-auto-resolve,
post-separation). The federated DQ group shows its own honest count separately. No "999+" on
the primary surface.

## Boundaries / verify
Reversible; reuse `lcc_refresh_decisions` / `lcc_merge_entity` / the existing verdict dispatch
+ effect-first/outcome-truthful recording; do NOT auto-confirm ownership; ≤12 api/*.js; the
auto-supersede healthy lanes untouched. Report: before/after primary badge (999+ → ~actionable
count); per-lane auto-resolvable subset sized in the dry-run, then applied with counts;
verdict lanes value-ranked + capped; a same-entity sf_link_collision auto-merges, a
distinct-entity one stays open; `confirm_true_owner` stays human but value-ranked. `node
--check`; suite green. DB sweep applied live after dry-run; JS ships on the Railway redeploy.

## Bottom line
The Decision Center already self-drains its auto-supersede lanes; R64 makes its VERDICT lanes
workable by the doctrine — surface the ~290 actionable verdicts value-ranked (not buried under
999+ of federated DQ), auto-resolve the mechanically-safe collisions/mappings, and keep
ownership confirmation a human call that the operator can now actually find and work
highest-value-first.
