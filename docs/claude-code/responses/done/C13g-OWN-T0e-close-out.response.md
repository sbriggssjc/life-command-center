# C13g-OWN-T0e-close-out — Claude Code response (transcribed)


Editedown-t0e-sponsor-family-lane.test.mjs+15-0

Now update the "registered in all four registries" test to also assert the dc-lanes handler is wired:

Editedown-t0e-sponsor-family-lane.test.mjs+4-0

Now let's run the whole test file to check correctness.

Ran 2 commands, edited own-t0e-sponsor-family-lane.test.mjs+1-1

Also check the other failing test (there were 2 failures reported).

Ran 4 commands, edited own-t0e-sponsor-family-lane.test.mjs+0-1

All 23 pass. Now let's spot-check mutation resistance on a few key new assertions manually.

Rana command

Good — caught. Now test the "never trust payload" mutation:

Ran 3 commands, edited admin.js+57-6

Now redo the placeholder seed handler and route registration:

Editedadmin.js+56-0

Now run the guard test suite again plus a broader syntax check.

Rana command

All 23 pass. Let's re-run the two mutation checks non-destructively (using cp/restore instead of git checkout) to confirm the admin.js guards still catch mutations:

Rana command

Good — caught, and properly restored this time. One more mutation: remove the merge_into_sponsor execution branch entirely to confirm the "TWO merge writers" test catches it.

Rana command

Good. Now let's run the broader test suite scoped to relevant files to make sure nothing else broke (full suite is huge; run a targeted subset plus a syntax/lint pass on dc-lanes.js).

Rana command

All green. Let's also run the operations-subroutes guard and the frontend-duplicate-definitions guard since we touched routing/admin dispatch and dc-lanes.js:

Ran 2 commands

Good. Now let's check current branch and create a proper feature branch, then commit.

Ran 3 commands

Now add a new entry at the top of STATUS.md and update the two backlog rows and the design doc §10.

EditedSTATUS.md+39-0

Now update the backlog rows:

Ran a command, edited PLANNED-BACKLOG.md+2-2

Now update the canonical design doc (§9) with a short §9h/close-out note, and owner-role-classification.md is unrelated (skip). Let's append to the OWN-T0e design doc.

Ran 2 commands

Now let's do a final full check: run the full relevant test files plus a broad syntax check across touched JS files, then commit.

Rana command

All green. Let's also quickly re-verify the live DB state one more time before committing (sanity re-check, per doctrine — re-measure before concluding).

Used Supabase: Execute SQL

Confirmed stable. Now commit and push.

Ran 3 commands

Pushed to claude/clever-tesla-m409ru. No PR requested, so I'll stop here.

Summary

§1 — placeholder routing (done, live end-to-end):

Measured which guards fire on "Research In Progress": none of the three existing ones does (lcc_is_placeholder_owner_name, lcc_p131_is_document_row_label, lcc_a2_is_placeholder_party — all false).

Widened lcc_is_placeholder_owner_name's exact-match list with that one literal after checking blast radius (2 entities fleet-wide, both genuine placeholders).

v_lcc_entity_retype_candidates restated to exclude it: candidates went 4 → 3 live on LCC Opps, matching the prediction exactly.

New v_lcc_entity_retype_placeholder_excluded view + api/admin.js?action=entity-retype-placeholder-seed route it to junk_entity_review — seeded live (review_id 386, dismiss, records it held 2 current portfolio facts).

§2 — sponsor-is-duplicate affordance (built, unit-tested, no live instance to close):

Field keyed on: the existing spe_ids + spe_props_max >= 2 signal already computed by the OWN-T0e cache — no new detector.

New verdict merge_into_sponsor, reusing the exact lcc_merge_entity writer/refresh/reversal OWN-T0e-b already uses; the target is re-derived live at verdict time from the cache, never accepted from the client (P188).

Checked the live cache for a current instance of this shape: zero rows — the one historical case (NGP Group → NGP Capital) was already merged by hand on 2026-09-09, so I could not exercise this end-to-end against production data. Said so plainly in STATUS, the backlog, and the design doc rather than claiming a verification that didn't happen.

Guard: test/own-t0e-sponsor-family-lane.test.mjs grew from 13 → 23 tests, all green; three new assertions spot-mutation-verified RED. Full suite for touched files green; node -c clean on all edited JS.

Edited 7 files

sponsor-family-planner.js+84-2

admin.js+257-43

dc-lanes.js+25-1

20261101150000_lcc_c13g_min_lane_placeholder.sql+160-0

own-t0e-sponsor-family-lane.test.mjs+123-12

Show 2 more

