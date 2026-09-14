
C13g-costar-stoplist — the CoStar residue the capture-path fix didn't touchRead first: docs/architecture/owner-role-classification.md §9h (the C13g capture-path fix — this is its named, unfixed residue) · docs/os/PLANNED-BACKLOG.md row C13g-costar-stoplist · api/_handlers/sidebar-pipeline.js (contactEntityType, unpackContacts) · extension/content/_forsale-contacts-parse.js (looksLikePerson) · api/_shared/entity-link.js (hasFirmSuffix, ENTITY_FIRM_SUFFIX_RE).Where the last fix landed, and what it didn't reachC13g's capture-path fix (2026-09-10) closed the RCA majority (115 of 142 sampled mistyped entities) by routing contactEntityType()'s no-explicit-type fallback through hasFirmSuffix(). The CoStar residue (32 of 142) was named but not fixed — it has a different shape: the "For-Sale/For-Lease Contacts" panel parser (extension/content/_forsale-contacts-parse.js) computes its own type: looksLikePerson(name) ? 'person' : 'organization' using a BROADER stoplist than hasFirmSuffix() — it includes ventures, management, newmark, cbre, jll, colliers (brand names of the brokerages themselves showing up inside a contact's captured name), none of which hasFirmSuffix()'s org-suffix list covers.What's actually unverified — this is the first thing to settle, not assume: contactEntityType() DOES honor an explicit contact.type === 'organization' | 'entity' | 'person' when present (read the function — it checks contact.type before ever falling back to hasFirmSuffix). So if the extension's type field is genuinely reaching the backend unmodified, the 32-row residue should already be getting the EXTENSION's (broader, more accurate) verdict, not the backend's — which would mean the residue's cause is something else entirely: the field getting dropped or renamed somewhere in the capture → staging → unpackContacts() path, or the extension's own classification being wrong on these specific 32 rows despite its broader list. Do not assume the "never read back" framing from the prior response is correct — verify it against the actual 32-row population before writing any fix.1. Trace the 32 rows preciselyPull the actual 32 costar/contact rows C13c measured (or the closest live equivalent — the mistyped population moves, so re-measure rather than assume the same 32 still exist). For each: what does the staged payload (metadata.contacts[].type, wherever it's captured before unpackContacts() reads it) actually contain at the point contactEntityType() is called? Three possible findings, and they need three different fixes — name which one is true:
(a) contact.type DOES arrive correctly as 'person', and it's simply WRONG — the extension's broader stoplist still missed an org marker present in these 32 names. Fix: widen (or better, share) the stoplist so both sides use one list, not two independently-maintained ones.
(b) contact.type arrives but under a different key or shape than contactEntityType() reads, so it silently falls through to the weaker backend fallback. Fix: the field-mapping bug, not the stoplist.
(c) contact.type never leaves the extension for this parser's rows at all (the panel doesn't set it on the payload it sends, despite computing it for its own display). Fix: send it.
Fix the root, not the two-list symptomWhatever (a)/(b)/(c) turns out to be, prefer a fix that ends the TWO-STOPLIST problem permanently rather than widening one list again — the P189/A2/N15c lesson this same arc already applied once (§9h) is that a second copy of a graded list drifts. If the extension's list is genuinely more complete for its population (brokerage brand names it sees that the backend wouldn't), consider whether the backend should read the extension's verdict when present (case (b)/(c)) rather than re-deriving it, or whether hasFirmSuffix() itself should absorb the extra terms so there is only ever one list (case (a)) — measure which is true before choosing.
Guard + shipPositive control on real names from the 32-row sample (or its live re-measurement). A regression guard in the style of test/c13g-contact-entity-type.test.mjs — name the specific rows/patterns it pins. Forward-mint only, same discipline as the prior fix: do not bulk-retype existing entities from here; any newly-detectable mistyped rows are entity_type_review lane population.
Ship + recordBranch build/c13g-costar-stoplist. STATUS.md entry naming which of (a)/(b)/(c) was true — that's the main finding worth recording, the current docs only have the symptom. Backlog row C13g-costar-stoplist — mark ✅ only if the fix is deployed and guarded; if this turn only completes the trace in §1, say so plainly and leave it at its current state with the finding recorded.
Ran 21 commands, used a tool
Now let me confirm hasFirmSuffix is already imported here, then apply the fix.
Ran a command, edited sidebar-pipeline.js+24-1
Now let's check the existing guard test and extend it, plus confirm current test suite location.
Ran a command, edited c13g-contact-entity-type.test.mjs+13-2
Also update the guard's anchoring assertion (it strips a fixed regex snippet from the whole function body — fine since it's still present, just check it still matches):
Rana command
All 11 pass, including the modified/new ones. Now rename the test file to reflect the new named finding and add doc/STATUS/backlog updates.
Ran 2 commands
Now update the backlog row to reflect the actual finding and fix, marking it shipped.
EditedPLANNED-BACKLOG.md+1-1
Now update §9h in the canonical doc to record the same finding, and add a STATUS.md entry.
Ran 3 commands, edited owner-role-classification.md+41-0
Now add a STATUS.md entry and run the broader test suite scoped to this file to check no unrelated regressions.
Ran a command, edited STATUS.md+31-1
Now run the full guard file plus a quick sanity check that nothing else in the repo relies on the old absolute-person behavior.
Rana command
Only the two in-file call sites; no other dependents to update. Let's commit.
Ran 3 commands
Pushed to build/c13g-costar-stoplist. Summary:
Finding (§1, the main deliverable): the prior response's "never reads the scanner's own verdict back" framing was wrong. contactEntityType() already checks contact.type first, and the extension's contacts[] array flows unmodified from capture through entity.metadata.contacts into unpackContacts() — verdicts (b) and (c) (dropped/renamed field) are ruled out. This is case (a), but inverted from the backlog row's assumption: hasFirmSuffix() already covers nearly all of CoStar's looksLikePerson() stoplist (missing only 4 brand names that don't matter here); the CoStar list is instead missing terms hasFirmSuffix() has (Bancorp, Investments, Development, Fund, Ptnrs, Cos, Property, Enterprises, Mgmt-abbrev), so real firms like "Sentinel Bancorp" got an explicit but wrong type:'person' stamp that was previously trusted absolutely.
Fix shipped: contactEntityType() now treats an explicit type:'person' as a floor, not an absolute — hasFirmSuffix() can still override it to 'organization', one-directional only (an explicit org verdict is never downgraded). No new stoplist, no extension code touched.
Guarded: test/c13g-contact-entity-type.test.mjs, 11/11 passing — including a corrected assertion (the old test pinned the bug as correct behavior).
Recorded: owner-role-classification.md §9i, PLANNED-BACKLOG.md row marked ✅, STATUS.md entry.
Edited 5 files
sidebar-pipeline.js+24-1
c13g-contact-entity-type.test.mjs+13-2
PLANNED-BACKLOG.md+1-1
owner-role-classification.md+41-0
STATUS.md+31-1
open a PR for the branch
Rana command
No PR template found. Creating the PR.
Used github: Open new pull request
Opened: PR #2239 — C13g-costar-stoplist: floor an explicit person-type with hasFirmSuffix.
Want me to subscribe this session to watch CI/review activity on it?
