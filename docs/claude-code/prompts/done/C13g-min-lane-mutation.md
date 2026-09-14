# C13g-min-lane-mutation — mutation-pass the lane guard, and measure the two things the build left unmeasured

**Read first:** `docs/os/BUILD-TURN-PROTOCOL.md` · `docs/architecture/owner-role-classification.md` **§9e–§9f** (and the
two same-day hotfix banners — the view read the 35 s proposals view; the RPC took a uuid decision id against a
bigint) · `docs/claude-code/STATUS.md` 2026-09-09 entries from "C13g-min-lane 502'd" downward · CLAUDE.md on the
mutation discipline (A5c, N18, OCR1c: comments stripped first; a guard that matches a shape is defeated by a
name that legitimately appears elsewhere).

**Nothing here changes behaviour.** The lane is live and has been worked (13 retypes, 3 keep_person, 3 merges,
`unclassified_rival` 1,617 → 1,501). This unit makes the guard a guard and closes two measurements.

## 1. Mutation pass — every assertion, RED count in the response

`test/c13g-min-lane.test.mjs` (16 tests) shipped with ONE assertion spot-checked. For EACH assertion: mutate the
thing it names (delete the registry entry, remove the RPC call, PATCH `entities` directly, drop the tombstone
refusal, drop the live re-read, change the toast condition), confirm RED, restore. Strip comments AND blank string
literals before any source-shape match (OCR1c order: comments first, then literals) — the handler's comments name
`rpc/lcc_retype_entity` and `entities` while explaining the rule. Report `N/N RED`; an assertion that survives its
mutation is rewritten, not deleted. Add two assertions the hotfixes earned: the candidate view's migration text
must reference `lcc_ownt0e_sponsor_family_proposals_cache` and never `v_lcc_ownt0e_sponsor_family_proposals`; and
`lcc_retype_entity`'s `p_decision_id` type must equal `lcc_decisions.id`'s (read both from the migrations; the
apply-time DO block already enforces it in the DB — this is the repo-side twin).

## 2. The two unmeasured deltas (read-only, rolled back)

- `v_lcc_entity_role_ambiguity` before/after a retype — pick one of the 13 already-retyped rows, run
  `lcc_unretype_entity` → read → `lcc_retype_entity` back inside a rolled-back block, and state what moved.
- The Tier 0 `people` bench: confirm none of the 13 retyped entities appear on any Tier 0 card now, and whether any
  did before (the builder measured Gardner/MassMutual only).

## 3. Placeholder guard (small, optional if §1 runs long)

`Research In Progress` (2 current facts) reached the lane; neither verdict is right for a placeholder. Add
`not lcc_is_placeholder_owner_name(name)` (or the A2 anchored-prefix class if that guard misses it — measure which)
to `v_lcc_entity_retype_candidates` as a whole-view restatement, md5-diff the 18-row output before/after (expect
exactly that one row to leave), and route the row to `junk_entity_review` by hand. Backlog `C13g-min-lane-placeholder`.

## 4. Ship + record

Branch `build/c13g-min-lane-mutation`. Tests only unless §3 is taken (then one view migration, live first). STATUS
one entry; backlog rows `C13g-min-lane-mutation` ✅ and `-placeholder`; §9f gains one line. Report: RED count,
the two deltas, and the md5 before/after if §3 ran.
