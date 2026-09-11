# C13g-min-lane-mutation — Claude Code (desktop) response, 2026-09-09

Transcribed from `C13g min lane mutation desktop response.docx` (gitignored, kept locally). The echoed prompt is omitted; the build log and summary follow verbatim. Merged as PR #2222 (`ac3c5000`).

Ran 13 commands, read 4 files, edited a file, created 2 files+158-0
Fix mutations for the two "not applied" entries and rewrite the assertions that survived their mutations.
Ran 7 commands, read admin.js
Now fix both surviving assertions: anchor the registry check, and strengthen the ordering test data.
Read 2 files (1 failed), edited a file+8-4
Now fix the registry-anchor assertion:
Edited c13g-min-lane.test.mjs, ran 3 commands+6-2
All 14 pass. Now re-copy backups (since admin.js/ops.js etc. were restored each mutation cycle but let's confirm files are clean) and rerun the full mutation sweep to confirm both fixed assertions now go RED.
Ran 3 commands
There's a duplicate ]. Fix it:
Ran 8 commands
46/46 RED now. Confirm repo clean, run full suite, then measurements for §2.
Rana command
Good — only the test file changed, 14/14 green, and 46/46 mutations RED. Now §2: the two read-only measurements.
Used 6 tools (2 failed)
Now the transaction, using owner_id or person_id for our entity:
Ran 3 commands, used 9 tools (1 failed)
Now append §9g with this unit's results:
Editedowner-role-classification.md+47-0
Now update the backlog row and the STATUS.md entry.
Read and edited PLANNED-BACKLOG.md+1-1
Now add a STATUS.md entry, then run full suite and commit.
Ran 2 commands, edited STATUS.md+14-0
All green. Commit and push.
Committedac3c500
Pushed to claude/vigilant-knuth-itsnm9. Summary:
Mutation pass: test/c13g-min-lane.test.mjs is now 14 tests, 46/46 targeted mutations RED (16 pure-planner behavioral mutations, 18 structural mutations across admin.js/ops.js/dc-lanes.js/review-shared.js, 12 SQL migration mutations — comments stripped before matching). Two assertions survived their first mutation and were rewritten rather than left:
The ordering test's own row names happened to sort identically by name and by rent, masking a deleted rent-desc tiebreak — renamed rows anti-alphabetically to their rent rank.
The registry-membership regex matched an unrelated research_type: 'entity_type_review', literal inside the verdict branch instead of the actual FEDERATED_DECISION_TYPES entry — re-anchored on the sponsor_family_confirm adjacency.
Two new assertions cover the same-day hotfixes as repo-side twins of their DB-side positive controls: the candidate view must read the OWN-T0e cache table (never the slow proposals view), and lcc_retype_entity.p_decision_id must be bigint matching lcc_decisions.id, with the mismatched uuid overload dropped.
The two §9f measurements (rolled back, 0 residue):
v_lcc_entity_role_ambiguity before/after a retype (Foulger Pratt): 0 rows in either state — not every retype moves that view.
Tier 0 bench: gained 10 cards across 3 of the 11 non-tombstoned retyped entities (UIRC 7, Global Net Lease 2, Foulger Pratt 1) that couldn't exist while person-typed — §9f's Gardner/MassMutual-only check was correct for those two but incomplete as a claim about the lane.
Skipped §3 (placeholder guard) — filed as its own backlog row per the prompt's "optional if §1 runs long."
Got it — I'll treat PR #2222 as the tracked PR for this work and reference it going forward rather than opening a new one.
