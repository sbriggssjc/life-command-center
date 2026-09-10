# C13g-OWN-T0e close-out — placeholder routing + the sponsor-is-the-duplicate affordance

**Read first:** `docs/architecture/owner-role-classification.md` §9b–§9g · `docs/os/PLANNED-BACKLOG.md`
rows `C13g-min-lane-placeholder` and `OWN-T0e-c` · `docs/audits/OWN_T0e_SPONSOR_FAMILY_LANE_DESIGN_2026-09-08.md`
§6–§9 · `api/_shared/entity-retype-planner.js` · `api/_shared/sponsor-family-planner.js` (read the
`merge_now` branch, ~line 140–175) · CLAUDE.md mutation discipline (comments stripped first).

Two small, independent fixes closing out the C13g / OWN-T0e arc. Do them as two units in one branch;
each ships its own migration/guard so either can be reverted alone.

## 1. Route placeholder entities off the retype lane, onto `junk_entity_review`

`v_lcc_entity_retype_candidates` currently surfaces `Research In Progress` — a placeholder ENTITY (2
current portfolio facts), not a real party. Neither retype verdict is right for it (`Retype to
organization` asserts a firm; `Keep as person` asserts a person). Add
`not lcc_is_placeholder_owner_name(name)` (or whichever placeholder guard actually matches this name —
measure which one fires, do not assume) to the view as a whole-view `CREATE OR REPLACE`, md5-diff the
candidate set before/after (expect exactly this one row to leave, current live population is ~5 rows —
re-read live before assuming the count), and have the removed row land on `junk_entity_review` the same
way the existing deterministic-dismiss sweeps do (`api/admin.js` ~2640–2790 is the precedent — reuse
that insert shape, `on_conflict=subject_ref`, do not invent a second writer). Reversible: deleting the
`junk_entity_review` row and reverting the view restores the old behaviour.

Guard: extend `test/c13g-min-lane.test.mjs` (or a sibling file) with an assertion that the view excludes
placeholder names and that a placeholder-named entity is written to `junk_entity_review`, not
`lcc_entity_retype_log`.

## 2. A merge-candidate card whose SPONSOR is itself the duplicate

Backlog `OWN-T0e-c`, live case already worked by hand (NGP Group → NGP Capital, `lcc_merge_entity`
called directly because no card existed for it). The gap: `sponsor-family-planner.js`'s `merge_now`
branch can only merge a **member of the current sponsor's own group** into that sponsor
(`duplicate_entity_id` must be one of the card's listed SPEs). It has no path for the case where the
**sponsor entity itself** is a recognized duplicate of a *different* sponsor's canonical entity — the
shape that made NGP Group's `same_party` verdict route to a merge lane with no card for it at all
(P189 NULL normalizer: `NGP Group` doesn't key to anything in `v_lcc_merge_candidates`).

Build the missing direction: when the OWN-T0e cache (or a cheap live check) shows a sponsor entity is
itself a `duplicate_entity_suspect` of another sponsor's canonical entity, the card should offer
"merge this sponsor into `<canonical sponsor>`" — a `lcc_merge_entity(p_loser := this_sponsor_id,
p_winner := canonical_sponsor_id)` call, same guards as `OWN-T0e-b` (live members, not tombstoned, same
recorded `entity_type` — refuse and say so if the types differ, exactly like the existing merge_now
branch). Reversible via `lcc_unmerge_entity`, decision-logged the same way as every other verdict here —
**do not add a second merge path**; this is a new caller of the existing `lcc_merge_entity`, nothing
else may write a merge.

Read the 13 `duplicate_entity_suspect` groups (design doc §6) before deciding how a sponsor-is-duplicate
pair gets identified — do not invent a new detector if the existing grouping already carries this
signal; state which field you keyed on. If nothing in the existing cache identifies this shape reliably,
say so and propose the smallest addition rather than building speculative machinery — this affordance
has had exactly ONE live instance to date.

Guard: mutation-pass the new branch same as OWN-T0e-b's (13/13 style) — type mismatch refused, wrong
loser/winner order refused, tombstoned entity refused, rolled-back positive control on a real pair if
one still exists live (re-measure; NGP's own case is already resolved).

## 3. Ship + record

Branch `build/c13g-ownt0e-closeout`. Two migrations if §1 and §2 both touch SQL; JS changes ship on the
next Railway redeploy as usual. STATUS one entry; backlog rows `C13g-min-lane-placeholder` ✅ and
`OWN-T0e-c` ✅ (only strike the "affordance itself is still unbuilt" line if §2 actually ships — if only
§1 lands this session, say so plainly and leave `OWN-T0e-c` open). Report: which placeholder guard
fired, the md5 before/after, the field §2 keyed on to detect a sponsor-is-duplicate pair, and the
mutation RED count for the new branch.
