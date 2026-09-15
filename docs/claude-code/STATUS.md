# Claude Code queue — STATUS

<!-- =====================================================================     CONVENTION — READ BEFORE PREPENDING AN ENTRY.
     This file is newest-first. New entries go DIRECTLY BELOW the Open-threads
     table's `---` that follows this block — NOT directly below this block, and
     never above it. (Prepending right below this block is what buried the
     Open-threads table 1,741 lines deep by 2026-09-14: this comment and the
     table's own header gave contradictory instructions, and the guard that
     would have caught it was never merged. See test/status-line-budget.test.mjs.) The `# Claude Code queue — STATUS` H1 above must remain line 1.
     This is enforced by test/status-header-integrity.test.mjs — CI fails if the
     H1 moves off line 1 or a second copy appears. Five sessions on 2026-09-12
     buried it (lines 25, 29, 57, 83, 212) before the guard existed.
     Line budget: 3,000 (test/status-line-budget.test.mjs), with a soft warning at 80%. When you approach it,
     archive BEFORE you push, not when CI fails. ⚠️ This file grows on YOUR
     branch AND on main at the same time, so a branch that passes locally can go
     over the budget the moment main is merged in — it has happened twice
     (PR #2383, and the REPO1 sweep at 2,503). Leave 200+ lines of headroom, and
     keep entries tight: the findings belong in PLANNED-BACKLOG.md, which is the
     canonical open-work list; STATUS.md is the narrative, not a second copy.
     move the OLDEST contiguous span verbatim to docs/history/ and extend the
     archive pointer — never reword or drop an entry to make room.
     ============================================================================ -->

## Open threads (updated 2026-09-12 — table moved to the TOP of this file by Cowork; new entries go BELOW the `---`)

One-line read on each active multi-round thread. Full narrative for anything older than this file's
current window lives in `docs/history/STATUS_claude-code_*.md`; durable state lives in
`docs/os/PLANNED-BACKLOG.md` and `docs/os/CURRENT-STATE.md`.

| thread | backlog rows | last entry | state (one line) |
|---|---|---|---|
| **Identity / operator canonicalization (ID-series)** | ID0–ID4, ID2a-cleanup, ID2b, ID2b-caps, ID2b-caps-2, ID3a–ID3e, ID3a-d | 2026-09-12 | ID2b-caps-2 shipped + live-verified (3rd comp source fixed at source); ID3a-d retired LCC's stale gov migration copy; ID2b's remaining 45 views/12 modules still group on operator text |
| **Market briefs (MB/EB)** | MB1d, MB2a, MB3, MB4, MB5, MB6, MB7, EB1b, P18 | 2026-09-12 | **LIVE**: `MARKET_BRIEF_PSQL` + `MARKET_BRIEF_RENDER` on; the daily email carries the Lane Briefs block (cap-rate bands, on-market, honest CMS staleness gaps, link to `#/briefs/dialysis`), the tab serves live facts, first `market_brief_issues` row frozen. Next: MB2a (the 3 new dialysis RSS URLs all fail 403/404), MB5 P-WEB (blocked on EB1b Anthropic credit), MB6 weekly long-form, MB7 MCP recall |
| **Operator funnel (OC / HP1)** | HP1, HP1-P1a, HP1-P1a-fix, HP1-P1a-dup | 2026-09-12 | HP1-P1a-fix CLOSED live (608 rows UPDATED, first-ever Salesforce UPDATE to `bd_opportunities`); HP1 P0 (Today 500 badge) fixed+deployed+verified |
| **Ownership (OWN/RO)** | OWN-T0a–T0j, RO3, B1b, AC2/AC3/AC6–AC11 | 2026-09-12 | OWN-T0j verified end-to-end live; RO3 field-mapping design drafted; OWN-T0a/B1b/AC-series propagation work still open |
| **CoStar sidebar / public records (PR5/PRI)** | PR5d, PR-scanner-3, PRI2–PRI6, HCRIS-TIMEOUT, HCRIS-TRACKER-BLIND, HCRIS-QIP-DEFICIENCY-TIMEOUT-PATTERN | 2026-09-15 | PR-scanner-3 shipped (`county_records_needed` action); `PRI6` (the connection-retry/ingestion-lock reliability sweep that started with `PRI1`'s dropped-connection crash) closed ✅ 2026-09-14, both sides confirmed merged — checking on it live is what surfaced `HCRIS-TIMEOUT` (a separate, months-old defect, not a `PRI6` regression). `HCRIS-TIMEOUT` is now three rounds deep: the original fix was correct, the real blocker was the tracker/heartbeat mechanism itself being blind (`HCRIS-TRACKER-BLIND`, fixed same round) — **awaiting live proof from a run Scott triggered 2026-09-15 (post-PR-#7411)**. One flagged, unbuilt follow-up already identified for whenever this closes: `qip_scores_ingestor.py`/`cms_deficiency_ingestor.py` share HCRIS's old bare-timeout bug. |
| **App / UX** | ASC50, HP1, UX-T1a | 2026-09-12 | ASC50 governed review workbench built + locally verified, publication pending |
| **Buyer engagement (BUY0)** | BUY0, BUY1a/1b, BUY-G1–G6 | 2026-09-11 | Phase 0 complete for Geller Round 1 (client deliverable + email draft shipped); build handoff written, BUY1a/1b + BUY-G1..G6 filed as next steps |
| **Broker identity (BR) / BROKER1** | BR1, BR2, BROKER1, BROKER1-sf | 2026-09-11 | BROKER1 prospect-assignment applied live (1,303 assigned) with a real bug found+fixed in production; BROKER1-sf (Salesforce write-back) correctly left unbuilt — no write path exists |
| **gov agency canonicalization (ID3a\*)** | ID3a, ID3a-b, ID3a-c, ID3a-d, ID3e, I14, I16 | 2026-09-12 | ID3a-b/c/d/e all shipped and live-verified; repo-ownership hazard (I16) found and closed — `government-lease` owns the gov DB's migrations, LCC's copy retired |
| **CI / producer health (B6d/B6e)** | B6d-cms-*, B6d-assessor-*, B6d-pri-*, B6e-ci-*, B6e-fred-* | archived 2026-09-11 | Suite is a real merge gate (`Run Tests` unmasked, green once on `main`); `pip-audit`/secrets-grep/ruff still masked; full detail in the 2026-08-29→09-11 archive and `docs/architecture/producer-health-and-ci-enforcement.md` |

> **📦 ARCHIVE (2026-09-08):** entries for **2026-08-31 → 2026-09-01** (the CMS-ingestion restart,
> DOC1–DOC18 document pipeline, C13/C14 entity-role work, and the trailing pointers for two earlier
> cuts) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-08-31_to_2026-09-01.md`](../history/STATUS_claude-code_2026-08-31_to_2026-09-01.md).
> Nothing was dropped; every still-open item was already in `PLANNED-BACKLOG.md` and the canonical pages.

---

## 2026-09-15 — the dia ownership contradiction, measured: both repos write schema (Cowork)

Scott's answer to the 👤 ownership question was the right one to give: *"Nothing in either would have
been written by me directly. It's all written by Claude."* Neither CLAUDE.md line carries human
authority, so re-reading them could never settle it. Measured the live database instead.

**Both repos apply schema to Dialysis_DB today** — proven in both directions. `dia_property_redirects`
(table + view + 3 indexes) is live and its migration exists **only in the `Dialysis` repo**, absent
from LCC's 283-file `dialysis/`. And three of LCC's five newest `dialysis/` migrations are **also
live**. So "ONE REPO OWNS EACH DATABASE'S OBJECTS" was never true of this database.

⭐ **That dissolves the contradiction rather than resolving it.** Neither line is wrong: the doctrine
is aspirational, the inventory line is observational, and they were written in the same register. A CC
round could follow either and look correct — which is exactly what happened.

**Proposal now on the row, awaiting Scott: own by OBJECT FAMILY, boundary drawn at "who queries it."**
A migration lives where its consumer lives, so an endpoint change and the schema it depends on land in
one reviewable commit. The DEED1 objects settle cleanly: `v_owner_source_conflict` is queried from
five LCC files, and the other two exist only to serve it. LCC keeps the BD/analysis layer; the
`Dialysis` repo keeps CMS/NPI ingestion and its own pipeline schema.

Next: **DEED1-reconcile-2** (port the file, close PR #7412) and **GOVDEED1**, still unsent and still
the largest single blocker in the deed set at 3,930 dateless gov deeds.
## 2026-09-15 — C2g re-diagnosed as already-answered: it's the sponsor↔SPE gap, not a new mystery (Cowork)

Was about to write up a fresh diagnosis of the "78 gov owner-orgs, property+asset present, still
unresolved" residue (`PLANNED-BACKLOG.md`'s C2g row, marked ⭐ NEXT) — live-measured a 26%
duplicate-entity / 74% unrelated-name split, then found `C2h_SPONSOR_SPE_NOT_A_FEEDER_DEFECT_2026-08-28.md`
had already answered this exact question three weeks ago at nearly the same proportions (69/8/2),
and `connectivity-and-open-threads.md` §4n already carries it as canonical. C2g's own backlog row
and §4's "next question" paragraph never got updated to point at it — a real staleness gap, not a
new finding.

**What I added, not rebuilt:** a live reconfirmation (`C2h_...md` §6) that the diagnosis still holds
2026-09-15 — `lcc_property_owner` resolving to the title-holding SPE via `supersession` at a flat
0.75 confidence while the Salesforce contact sits at the sponsor, for ~83% of the residue (52 of 70
sampled, `source='supersession'`); ruled out the batch cap (evidence exists on 91 of 95 pairs), the
`lcc_domain_owner_ambiguous` lane (0 of 58), and guards (unchanged from C2h). Cross-checked the
remaining high-name-similarity pairs against decision #2's dedup views: 5 of 8 exact-name pairs
already sit in `v_lcc_merge_candidates`/`v_lcc_canonical_twin_candidates`, no new machinery needed;
1 (`sarita mutscher`) is an exact-name pair neither view flags — a possible dedup-view gap, not
chased further here.

**Updated, not built:** `PLANNED-BACKLOG.md`'s C2g row (demoted from ⭐ NEXT/🔴 "diagnose before
building" to 🟡 "diagnosed, two narrower unsized steps remain") and `connectivity-and-open-threads.md`
§4's two paragraphs that still framed this as open. The two real next steps, neither sized nor
built: (1) feed the sponsor↔SPE pairs into the existing confirm-only surfaces
`lcc_owner_sponsor_domain`/`lcc_ownership_sponsor_family` (8/34 rows, unchanged in scale since
C2h — sizing this is not done); (2) Scott's still-open buyer-vs-true_buyer precedence call in
`supersession-tie-lane-2026-08.md` §4, the same mechanism from the tie-breaking angle. **No ⭐ NEXT
re-crowned** — that's a call for Scott, not mine to make unilaterally; the backlog currently has no
single headline item and should get one from him.

---


## 2026-09-15 — DEED1-reconcile: right work, wrong repository (Cowork)

**The round was done correctly and I verified it live.** The migration was emitted from
`pg_get_functiondef`/`pg_get_viewdef` rather than retyped — which is exactly why I handed it to CC
instead of transcribing it myself — made idempotent, and applied. All **seven checks reproduce
identically**: `auto_fixable` 4 (1 + 3), bad rows 0/4, good rows 4/4, SMFG `true`, unrelated `false`,
alias table 1 row intact. A reconciliation that changed behavior would have been the bug; it did not.

🚨 **But the file was committed to `sbriggssjc/Dialysis` (PR #7412), not here, and does not exist
anywhere in `life-command-center`.** So the drift is not closed — it moved. Rebuilding Dialysis_DB
from this repo still restores the old comparator and drops the alias table.

⭐ **And the cause is ours, not CC's.** This repo's `CLAUDE.md` gives two answers. The ownership
doctrine says Dialysis_DB schema belongs to `life-command-center` and names *aliases* among its
examples; the migration-inventory table lower down says the `Dialysis` repo owns it, tagged 👤 "not
formally confirmed by Scott." `supabase/migrations/dialysis/README.md` sides with the doctrine and is
unambiguous. The two lines are answering **different questions** — where the files sit, versus who
owns the objects — and were written as if they were the same one. → **CANON-OWNERSHIP1**.

⚠️ Leaving PR #7412 open is the dangerous outcome: a dia migration living in a repo that does not own
those objects can be re-applied from there and overwrite a running object — the exact hazard the
`government/` retirement (I16) was created to prevent. → **DEED1-reconcile-2** prompts the port, the
PR closure, and the canon fix, and explicitly leaves the 👤 ownership confirmation to Scott.

---


## 2026-09-15 — Decision #2's review lane already exists — no build needed, it just needs to be worked (Cowork)

Scott's answer on how to review the 2,201 canonical_name duplicate groups: build a Decision Center
review lane. Reviewed the existing machinery first, per this repo's standing discipline, before
writing any code — **and there is nothing to build.** The `merge_duplicate_entities` federated lane
(`api/admin.js` ~line 8886) already reads `v_lcc_canonical_twin_candidates`, a surface-only,
human-verdict-only view over every same-canonical-name org twin, explicitly built to add "the
previously-invisible groups" beyond the `auto_mergeable`/`sf_inheritance` filter. Sampled 200 of the
1,988 groups outside that filter against the twin view: **200 of 200 already present.** The lane
already shows this population today, paginated, with a working verdict path straight to
`lcc_merge_entity` (reversible).

**The real gap is throughput, not machinery** — `lcc_decisions` shows only 13 `merge` + 1 `research`
verdict ever recorded against this lane, the same "built but unworked" shape `[UX-T1c]`'s census
already found on 12 of 28 other federated lanes. Decision #2 stays open until the lane gets worked
down; nothing further to build. Full detail:
`docs/architecture/ownership-truth-pipeline-state.md` decision #2.
## 2026-09-15 — DEED1 shipped and verified; the migration for it was never written (Cowork)

**Verified against the live database rather than the response summary, and every number holds.**
`auto_fixable` **8 → 4**; the SMFG pair now reads as one company; an unrelated pair stays false; the
four bad rows are gone; and **the four good rows are still auto_fixable** — the positive control is
the one that matters, because it proves the guards did not clean up the set by excluding everything.

⭐ **The alias mechanism is better than the response described.** Not a hardcoded regex but a curated
TABLE, `public.dia_owner_name_alias`, whose single row carries its own provenance: *"Human-confirmed
pairing, not inferred."* The financing-instrument regex was widened from the data — all ~44 "leasing
and finance" grantees in the conflict set were enumerated first.

⚠️ **But no migration file exists for any of it.** A new table, a changed function and a changed view
are live in Dialysis_DB and the repo knows about none of them. Rebuilding from `main` restores the old
comparator and regex — silently re-admitting the four rows this round removed — **and drops the alias
table entirely**. That is the **fifth DEPLOY3-unmerged instance**, and the first involving a TABLE.
DEPLOY2's `migration_unapplied` detector cannot see it by construction: it enumerates files and probes
the DB, and here there is no file to enumerate. → **DEED1-reconcile**, prompted. I deliberately did not
transcribe the migration myself — the view's word-boundary regexes have escaping I cannot read back
unambiguously through a tool boundary, and a silently wrong regex changes which rows auto-fix.

**The window widening was measured and correctly NOT shipped** → **DEED2**. Of the rows blocked solely
by the 2-year window (**146** re-measured post-fix; CC's 151 was pre-fix, the difference being the new
financing regex), **13 are legal-form-only restatements** and **3 have deed-parsing boilerplate as the
grantee** — so a bare widening writes ~11% garbage. Declining on that evidence is the same gate that
stopped DEPLOY2-stale.

⭐ **The 13 expose a sixth instance of the recurring class, and the second of a specific sub-shape:
absence of evidence rendered as a verdict.** `dia_owner_share_significant_token` drops short and
stoplisted tokens, then asks `EXISTS (ta JOIN tb)`. When a name reduces to the empty set — `Realty
Income Corp` is entirely stopwords — `EXISTS` is false and every caller reads that as "different
companies". Verified live. The fix is not a bigger stoplist; the function needs a third answer,
`cannot tell`, alongside same and different. → **DEED1-emptycompare**, which blocks DEED2.

---


## 2026-09-15 — Decision #2 measured: canonical_name UNIQUE constraint still not safe, 2,201 groups need Scott's call on review approach (Cowork)

Next step after decision #6 closed: decision #2 (`entities.canonical_name` as an enforced UNIQUE
key), the last of Scott's six ownership-pipeline decisions still gated. Its own "next step" said to
measure how close to unique-clean the population is after #1's merge sweep, then add the constraint.
Measured live — **result: still not safe.**

`v_lcc_merge_candidates` (the same view #1's sweep used): **2,201 groups / 4,738 entities remain, 0
auto_mergeable** — every previously-safe tier was already swept 2026-09-15 by decision #1. Breakdown:
`bridged_unknown_pinned` 1,644g/3,539e, `no_role_or_sf_signal` 340g/688e, `multiple_sf_accounts`
89g/193e, `low_name_similarity` 64g/143e, `normalizer_blind_review_only` 64g/175e.

Read the dominant class further: **1,484 of the 1,644 `bridged_unknown_pinned` groups (3,087
entities) are name-compatible but carry zero Salesforce corroboration** — no signal either way on
whether two same-named entities are really the same company. Checked whether
`entities.normalized_address` could break the tie before concluding review is unavoidable — dead
end, all 1,484 groups have at least one member with a NULL address; this bridged-owner population
never carried address data at all. No other cheap signal exists. The remaining sub-classes
(multi-SF-account groups, low-name-similarity, normalizer-blind) are correctly held for the reasons
already on file — genuinely different firms, not reviewable-for-merge.

Adding the UNIQUE constraint today would either fail outright or force blind-merging 4,738 entities
with no corroborating signal on most of them — against Scott's own "accuracy first" instruction from
decision #1. **2,201 individual judgment calls is a real review workload**, not something to sweep
through alone. Surfaced three options rather than picking one: (a) a Decision Center review lane
(the federated-lane pattern this same doc's item 2 already flags as under-used elsewhere) for Scott
or the team to work through in normal course; (b) a scoped/partial unique constraint that exempts
this reviewed-pending population; (c) something else. Full detail:
`docs/architecture/ownership-truth-pipeline-state.md` decision #2. Awaiting Scott's answer before
building anything.

## 2026-09-16 — DEED1's migration is correct and in the wrong repository (Cowork)

**The SQL is right; only its address is wrong.** CC wrote, applied and verified the DEED1 reconciliation
migration, then committed it to the **`Dialysis`** repo (PR **#7412**) on the strength of *that* repo's
`CLAUDE.md` saying "Dialysis owns `supabase/migrations/*.sql`". Re-verified live, independently of the
response: `dia_owner_name_alias` present with 1 row, the comparator function present, the
financing-instrument regex live, `auto_fixable` = 4. Nothing needs redoing.
⚠️ **But LCC's own `CLAUDE.md` line 375 — Scott's 2026-09-12 ONE REPO OWNS EACH DATABASE'S OBJECTS
decision — assigns Dialysis_DB schema to `life-command-center`**, leaving the Dialysis repo its CMS/NPI
*ingestion* (rows, not schema), and names "aliases" explicitly. An alias table is schema.
💥 **So the drift moved rather than closed.** Rebuilding Dialysis_DB from this repo still restores the old
comparator and regex and still drops the alias table — the exact thing the reconcile existed to prevent.
And **no detector covers it**: `migration_unapplied` enumerates files and probes the DB, so with no file
here there is nothing to enumerate. CC spotted that itself. DEPLOY3-unmerged shape, **fifth occurrence**,
first involving a table.
🟢 **Prompted: `DEED1-RELAND-the-migration-went-to-the-wrong-repo.md`** — re-land under
`supabase/migrations/dialysis/`, **emitted from live objects, never transcribed**: the view body is 4,747
chars carrying `\m`/`\M` word-boundary escapes, and a silently wrong regex changes which rows auto-fix.
✅ **Behaviour is pinned by checksum, not by adjective.** Captured live before any re-land:
`md5(pg_get_viewdef)` = `9fc5aa3f824b125853b3ac8c8a8388f1` (4747), `md5(pg_get_functiondef)` =
`72b48cd949db4de5502812920b2e5dd0` (2183). Both must be unchanged after applying; a differing hash is a
STOP, not a cosmetic difference.
👤 **Root cause is a doctrine conflict, not a mistake** → **DIA-OWNERSHIP-CONFLICT**. The two repos'
`CLAUDE.md` files contradict each other and CC followed one of them correctly. Same class ID3a-d resolved
for government — where `government/` got a README, a marker on every file and a guard test, while
`dialysis/` here has 0 of 282 markers and no README. Both cannot be true. ⛔ Nobody should close PR #7412
or edit the Dialysis repo's CLAUDE.md until Scott decides; Cowork's read is that #7412 closes unmerged.

---

## 2026-09-16 — C1C-SPLIT prompted; and `docs/capital-markets/` is mostly not capital markets (Cowork)

🟢 **`prompts/C1C-SPLIT-retire-the-dia-lane-only.md`** (129 lines). C1c cannot be applied as written:
`lcc_c1c_retire_sf_lanes` has **no lane scoping** — its plan selects `research_type = any(_lcc_c1c_lane_types())`,
a hardcoded two-element array — so it is all-or-nothing, and "all" now includes the ungated gov lane.
✅ **Measured before prompting, and it makes the fix small: lane and domain are 1:1.**
`owner_needs_salesforce` = 1,851 rows, **all** government; `true_owner_needs_salesforce` = 838, **all**
dialysis. So one `p_research_types text[]` parameter is enough, and the prompt **forbids adding a domain
parameter** — two selectors that must agree is a defect waiting to happen.
⚠️ The prompt names the **42725 overload trap** explicitly: a defaulted parameter added with `create or
replace` leaves BOTH signatures live, so it needs an explicit `drop function` first **and an assertion that
exactly one remains** — do not trust the DROP, assert it. An out-of-range lane name must **raise, not
no-op**; a silent zero-row success is this arc's signature failure.
🔍 CC's sandbox has no Supabase egress (measured on DEPLOY2), so it ships and states the live run pending.
**Cowork applies and runs**: DDL → scoping migration → dry run, expect **838 dia / 0 gov** (anything else is
a STOP) → real run → re-read with gov unchanged.

**Consolidation: `docs/capital-markets/` indexed, and the index's headline is that the directory is
misnamed.** Of 156 markdown files, **115 are archived `CLAUDE_CODE_PROMPT_*`** spanning the whole
application; only 41 are capital-markets or adjacent, and only ~4 are the quarterly book itself.
⚠️ **Deliberately not moved.** Those files carry inbound links from this STATUS file, from
`docs/architecture/`, and from several processed DOCMAP/J13a prompts — a mass `git mv` without rewriting
them leaves dead links in the narrative future sessions are told to trust, which is worse than the
mis-filing. Filed as **DOCS-CM-MISFILED** 🟡 with the scoped fix written down; the README now says it at
the top so the trap is at least legible.
🔭 `docs/history/` (111 files) is the last unindexed directory, and it is partly self-describing through the
STATUS archive pointer chain — lowest value of the three.

---

## 2026-09-16 — `docs/architecture/` has an index for the first time (Cowork)

**188 design documents, no entry point.** Every session arrived at that directory and guessed, which is a
standing tax on exactly the "pick up seamlessly" goal. `docs/architecture/README.md` now groups all 188 into
14 topics — ownership/identity (25), copilot & intelligence layer (29), Salesforce/Microsoft/PA (22), deal
spine & dossiers (20), healthcare verticals (19), app surfaces (17), and so on.
✅ **Generated from each file's own H1, never from an assumed summary** — a hand-written index of 188 files
is a fabrication surface, and the point of the directory is to be trustworthy. Section counts are asserted
against the rows beneath them; all 188 files are accounted for, none dropped, none invented.
⚠️ The index carries the warning the directory needs: **a design document is a design document.** Several
describe behaviour that was never built or has since drifted, so the live system is still the check —
`PLANNED-BACKLOG.md` is the open-work list and STATUS is the narrative. Non-markdown assets (dossier HTML
examples, `copilot_action_registry.json`, `signal_table_schema.sql`, the four subdirectories) are named as
out of scope rather than silently omitted.
🔭 Remaining directories without an entry point: `docs/history/` (111 files, though the STATUS archive
pointers already chain through it) and `docs/capital-markets/` (163) — the next two worth doing.

---

## 2026-09-16 — C1c re-diagnosed before applying, and the check found a guard that never guarded (Cowork)

**Recommendation was re-diagnose rather than apply. Doing so changed the answer.** C1c's header says the
retirement is safe *because* C1b makes `gate_pass` permanently false so *"nothing will mint into these two
lanes ever again."* Measured live, that is **true for dia and false for gov**:

| lane | queued | minted since C1b (8 days) | premise |
|---|---|---|---|
| dia `true_owner_needs_salesforce` | 838 | **1** | holds |
| gov `owner_needs_salesforce` | 1,851 | **175** (156 on 09-13 alone) | **fails** |

🚨 **C1b's gov gate is live and gates the WRONG LANE** → **C1B-GOV-GATE**. The government project's
`v_ownership_gaps` carries exactly one `lane_no_consumer` marker and it sits on the **`owner_needs_sos`**
arm; the `owner_needs_salesforce` arm still has the ordinary value/placeholder predicate. The view exists,
the marker string exists, a grep finds it — **only reading which arm carries it shows the gate missing.**
That is XB2-precision's shape again (object present, wrong body) and it is the standing argument for
**DEPLOY2-stale**. The mint path is not at fault: `fetchNbaFeed` applies `gate_pass=is.true` server-side.
✅ **The "no consumer" half was checked separately rather than inherited.** The dia lane shows 298
`completed` rows — but **every one carries a fully NULL `outcome`** (no action, no outcome, no terminal;
last touched 2026-09-02). A bulk status flip, not a human working the lane. "Retire, no consumer" is still
the right verdict for dia.
👤 **Recommendation: apply C1c's dia arm only.** The gov arm waits on a real gate, and that fix belongs to
`government-lease` (ID3a-d) — ⛔ not to re-applying this repo's retired `government/` copy, which is exactly
what that directory's README warns restores known-bad state.

---

## 2026-09-16 — DEPLOY2-coverage verified live: the rule caught a real one, and a stale ✅ fell with it (Cowork)

**CC shipped it and honestly refused to quote a live number** — its sandbox had no Supabase egress and a
shallow clone, which makes `git log --diff-filter=A` report the graft boundary as every file's add date.
Correct call. **The CI run has happened since, so I took the measurement.** Snapshot 33 (`c841e1a6`),
`window_degraded: false` — real add-dates, skew gone. **60 checked of 1,173 available; findings 24 → 43.**

| target | checked | applied | UNAPPLIED | unverifiable |
|---|---|---|---|---|
| LCC Opps | 47 | 42 | **1** | 4 |
| Dialysis_DB | 13 | — | — | **13** (`probe_rpc_http_404`) |

🚨 **First real catch, and it invalidated a backlog row that had read ✅ for eight days.**
`20260908130300_lcc_c1c_retire_sf_lanes.sql` merged 2026-09-08 and **was never applied** — 9 of 9 declared
objects absent. I verified that independently of the rule that raised it, because a new monitor does not get
to be its own witness: `lcc_c1c_retire_log` and `v_lcc_c1c_retired_watch` both null, **0** rows in `pg_proc`
matching `lcc_c1c%`. **C2** claimed *"`true_owner_needs_salesforce` (dia, 837) is now RESOLVED — C1c retired
it"*. Live today: **838 open tasks.** It grew by one. The lane was never retired; the row recorded the merge
as the outcome. C2 **retracted**, → **C1C-UNAPPLIED** 🚨👤.
🚨 **Fourth occurrence of the class, and it is the detector's own migration.** The dia probe RPC merged and
never applied — hence 13 × `probe_rpc_http_404`. ✅ **The fail-closed design is the only reason that is
visible**: it emitted 13 named warns instead of quietly reporting root-only-and-clean. I applied the dia RPC
live (read-only `pg_catalog`, `service_role` + `anon` asserted) and confirmed it round-trips.
✅ **Acceptance #1 answered: OWNERGAP1 is APPLIED** — all 7 probed objects present in Dialysis_DB. The
incident the detector was blind to is now in scope *and* verified clean.
👤 **C1c needs your decision before anything is applied.** It is a retirement with data effects (closes
tasks, writes a retire log), not a read-only probe, so I left it alone: apply it, re-diagnose first, or drop
it. The lane is 8 days older than the diagnosis that justified retiring it.

---

## 2026-09-16 — DEPLOY2-coverage: the `migration_unapplied` window was blind to one of its own three incidents (Claude Code)

`migration_unapplied` shipped 2026-09-16 and its core design is sound (version-anchoring correctly
ruled out, UNVERIFIABLE a first-class verdict, positive control firing, STALE measured and correctly
not shipped). **Its WINDOW had three defects, all measured, and together they meant the rule could
not see OWNERGAP1 — one of the three incidents it was built to catch.** All three closed.

| defect | before | after |
|---|---|---|
| `dialysis/` excluded as "a historical copy" | 889 root files only | **1,171 candidates** (root 889 + dialysis 282); **OWNERGAP1 in scope**, routed to Dialysis_DB |
| window sorted by filename (a synthetic sequence number, not a clock) | floor `20260930121500`; 107 migrations added in 14 days, **64 outside the window, 24 of them root-level** | ordered by **git add-date**, one `git log --diff-filter=A` pass; `MIGRATION_WINDOW_SIZE` held at **60** on purpose |
| "root → LCC Opps" | **31 root files carry a `gov_`/`dia_` prefix** and target another project; 0 in window **by luck** | routed by **target database**, undetermined **fails closed** as UNVERIFIABLE |

- **`dialysis/` is live and owned by THIS repo; only `government/` is retired.** The old header
  generalised the gov retirement to dia without checking: `government/` has a README, the
  `HISTORICAL — DO NOT RE-APPLY` marker on every file and a guard; `dialysis/` had **0 of 282
  markers and no README**. It has one now, written as the deliberate mirror so the two directories
  stop looking alike — `supabase/migrations/dialysis/README.md`.
- **A file with no git add-date sorts NEWEST, never dropped** (P180 — an untracked migration is the
  freshest thing in the repo), and an **unavailable git history EMITS** `window_degraded` with a
  reason on the snapshot rather than silently reverting to filename sort (B6a: a degraded window
  that looks identical to a healthy one is how this defect survived its own review).
- **The dia half is a second PROJECT, not a second directory.** Probe RPC ported to Dialysis_DB
  (`20260916130000_dia_deploy2_migration_probe_rpc.sql`). ⚠️ Its grants **deliberately differ** from
  the LCC copy's — `service_role` **and** `anon`, both asserted — because the credential CI resolves
  is `diaSupabaseKey()`, which falls back to `DIA_SUPABASE_KEY`, **the anon JWT** (#720). A
  service_role-only grant would fail on every run. 🔍 **Consequence, stated not buried: this grants
  schema object-NAME enumeration on Dialysis_DB to anon-key holders**, bounded by #720 Phase 4,
  which is named in the migration as the removal trigger. Credentials go through the resolver, never
  a hardcoded env name, so the rule upgrades itself the day the service key is set.
- **A 401/403 from any probe emits `skipped` WITH the HTTP status**, never "no objects missing"; a
  project with no credentials skips **its own files with a named reason** rather than quietly
  reducing to "root only, all clean".
- **`government/` stays out, and the gap is now attributed rather than absent** —
  `docs/architecture/MIGRATION-COVERAGE-MAP.md` (three projects → owning repo → does a detector
  exist → where). Backlog **GOVDEPLOY1** 👤 owns building one, in `government-lease`.
- Guard: `test/xb1-xb2-build-brief-collector.test.mjs` — **51 tests, 8/8 mutations RED**. Full suite
  **6,298 pass / 0 fail / 6 skipped**.

⚠️ **THE LIVE RE-RUN DID NOT HAPPEN AND NO NUMBERS ARE QUOTED FOR IT.** The sandbox has no Supabase
egress, **and its checkout is shallow** — so `git log --diff-filter=A` reports the graft boundary as
the add date for ~880 files (exactly the trap `CLAUDE.md` documents), which is why a sandbox dry run
skews the window dia 49 / lcc 11. The collector reports that honestly as
`window_degraded: shallow_clone_add_dates_are_graft_boundary`. **CI checks out `fetch-depth: 0`, so
the first workflow run on `main` is the real measurement.** Baseline to compare against: **60 checked
/ 100 objects / 0 UNAPPLIED / 5 UNVERIFIABLE, LCC Opps only.** A rising UNAPPLIED count there is the
rule working. Still unverified from here: whether the `DIA_SUPABASE_*` secrets resolve, and **which**
key the resolver picks — which is what decides whether the `anon` grant is load-bearing today.
## 2026-09-15 — the deed-wins flag was never the decision; two prompts sent instead (Cowork)

Took FLAGDARK1's recommended first decision (**#4, `DECISION_OWNER_DEED_WINS`**) and measured it
before recommending it to Scott. It does not hold. The flag would write **8 rows out of 1,363 live
owner-source conflicts** — **zero in government**, 8 in dialysis — so it is a switch on a population
a guard has already reduced to nothing, not a policy call about whether deeds win.

**And the 8 fail a hand-check.** `Sumitomo Bank Leasing And Finance Inc` → **`SMFG`** twice: the
rebrand guard (`dia_owner_share_significant_token`) compares shared tokens, and an initialism shares
none with the words it abbreviates — structurally blind, not a tuning miss. Separately a
leasing-and-finance entity takes title on rows that read as financing instruments; the grantee
exclusion list covers `mortgage`/`savings bank`/`bancorp` but not `Leasing and Finance`.

**The real blockers are measured, and neither is a decision.** 234 dialysis rows are blocked *solely*
by the 2-year deed-recency window — and an older deed is not a less authoritative one, it is a more
settled one. On the government side, **3,930 of 5,922** grantee-bearing properties have **no deed date
at all** (66.4%) against dialysis's **2 of 1,774** (0.1%): same field, two pipelines, 600x miss rate,
which makes the dialysis path a working reference implementation of what gov is failing at.

Scott's calls: widen the window but prove it first, fold the guard work into the same round, and yes
to chasing the gov date gap. Two prompts written —
`prompts/DEED1-the-autofix-set-is-8-rows-and-half-are-wrong.md` and
`prompts/GOVDEED1-two-thirds-of-gov-deeds-have-no-date.md`. GOVDEED1 flags the repo-ownership
question up front (gov DB objects belong to `government-lease` per ID3a-d/I16, so the deliverable may
be a handoff rather than a migration) and forbids inferring a date from any adjacent field.

⭐ The gov NULL date is the **fifth** instance of one signal carrying two meanings — downstream,
"we have no date" and "the deed is old" are indistinguishable. And the lesson for the triage doc
itself, recorded there: it ranked the five decisions by **cost** without sizing their **effect**.

---


## 2026-09-15 — Decision #6 CLOSED: OWN-T0i ships live, all six of Scott's ownership-pipeline decisions now closed (Cowork)

**The last of Scott's six compiled ownership-pipeline decisions is closed.** Follow-up answer,
verbatim: *"Yes, we want to pursue, in research, until every current and prior owner of a building
leased to one of the operators or agencies in our target swimlanes (dialysis and government-leased)
are known and connected to our LCC app and code processes. The brokers can then make the election on
whether to pursue the account or not individually, with the guidance and coaching of the LCC on the
next best relatively important lead."*

This resolved the one open scope question from the prior research pass (whether "promotion" meant
widening the seller-prospecting population beyond the live queue's lease-timing bands): yes, but as
**connectivity** (role known, broker assigned), not as a forced bulk cadence — brokers still elect
individually, which is why no cadence was seeded.

**One category error caught before building anything**: the OLD scalar `entities.owner_role` /
`behavioral_override` field is a human-manual-override convention, not a system-write target — an
earlier pass in this same research nearly wrote a system-derived "promotion" into it, which would
have been exactly the kind of fabrication this repo's doctrine exists to catch. Checked instead
whether the live deterministic role-SET view (`v_lcc_entity_roles`) already had this right: it does
— **445 of 447** reachable current owners already correctly tagged `investor_owner`, **3,804 of
3,820** prior owners already `former_owner`, computed live, no backfill needed. Role classification
was never a real gap.

**Shipped `lcc_own_t0i_extend_broker_assignment(p_dry_run)`** — reuses BROKER1's exact
vertical-default policy (`gov`->Scott, `dia`->Kelly Largent, Scott catch-all, Nate never assigned,
fill-blanks-only, reversible) over the wider population Scott's follow-up asked for: every reachable
current-OR-prior target-market owner, not just the live priority-queue's lease-timing bands. Does not
touch `lcc_broker1_assign_prospect_brokers` itself. Dry run matched live exactly: **1,044 reachable
owners total** (447 current + 197 prior, minus 5 domain-overlap in the current set already counted —
sized live 2026-09-15), **487 already assigned, 557 newly defaulted** (315 gov->Scott, 238 dia->Kelly,
4 catch-all->Scott). Re-ran the dry run afterward: **0 remaining**, idempotent. Verified Nate
untouched (0 rows). Migration:
`supabase/migrations/20261102200000_lcc_own_t0i_extend_broker_assignment.sql`.

**The real remaining bottleneck, sized but not addressed here**: reachability, not role or broker
mechanics. 86.5% of current owners (2,875 of 3,322) and 94.8% of prior owners (3,623 of 3,820) in the
target market have no usable contact method at all, so they cannot yet be "known and connected" in
any way that matters to a broker. This is a contact-data-sourcing problem, and it already has an open
thread: `FLAGDARK1`'s owner-enrichment-adapters question (address/deed/SOS/websearch/OpenCorporates)
is the actual lever for moving these numbers, not anything in decision #6's scope. Full detail:
`docs/architecture/ownership-truth-pipeline-state.md` decision #6.

**All six of Scott's ownership-pipeline decisions now have a decided rule, and five of the six are
shipped and live** (#1 trailing-"The", #3 OWN-T0g transfer supersession, #4 N15 SF-campaign orphans,
#5 T2b widening, #6 this entry). **#2** (`canonical_name` unique constraint) is the only one still
un-built — its rule was decided same as the others, but it stays gated on reviewing the review-only
merge-sweep tail from #1, which has not been started. That review, or `FLAGDARK1`'s enrichment-adapter
decision (the real lever on the reachability numbers this entry sized), are the two live next steps in
this arc.

## 2026-09-15 — Decision #6 research done: BROKER1 + C6 already cover most of it; one scope question left for Scott (Cowork)

**Decision #6 of Scott's six compiled ownership-pipeline decisions -- the last one open.** Scott's
answer, verbatim: *"If they currently own an asset in our target market, that broker assigned to
working that market should be assigned the prospecting and cadence should match the schedule
planned for (7 touchpoints in the first 6 months, average 4 a year thereafter, but each client
interaction and profile dictates the exact timing and content)."*

Followed the decision's own "review before building" instruction (`docs/architecture/cadence-engine.md`,
`api/_shared/cadence-engine.js`, `docs/architecture/owner-role-classification.md`,
`docs/architecture/bd-ranking-and-priority-queue.md` §7) -- and the review changed the shape of the
work. An initial pass concluded no broker-to-market assignment mechanism exists anywhere; that was
wrong, caught before writing anything to Scott. **`BROKER1`** (shipped + applied live 2026-09-11,
`PLANNED-BACKLOG.md` `C4c`/`BROKER1`) already *is* the broker-to-market rule: vertical default
(`gov`->Scott, `dia`->Kelly Largent, Scott catch-all, Nate never assigned), fill-blanks-only,
already run against the live seller-prospecting queue (1,303 assigned: 870 gov->Scott, 414
dia->Kelly, 19 catch-all->Scott). And **C6** (2026-08-29) already retired the role gate on that same
queue -- eligibility today is *holds a current asset AND is reachable*, no role predicate -- so an
owner sitting at `owner_role = 'unknown'` no longer blocks anything operationally for owners already
inside the queue's bands.

**Sized live (2026-09-15)**: 3,322 distinct entities hold a current target-market asset at
`effective_owner_role = 'unknown'`; the queue's own reachability predicate
(`owner_contact_pivot.active_contact_entity_id IS NOT NULL`) narrows that to **447 reachable** (374
gov, 78 dia, 5 overlap) -- P112-safe by construction. Of those 447: 212 are already in
`lcc_priority_queue_resolved`, 206 of those 212 already have a broker, only **6** are in-queue and
unassigned; **167 of the 447 already have a `touchpoint_cadence` row** -- prospecting is already
running for a real share of this population despite the stale `unknown` label. The label itself was
never written by C6 or BROKER1, so all 447 still literally read `unknown` -- a pure data-integrity
gap with no live gating effect on the 212 already in-queue.

**The one real open question**: Scott's decision text ("if they currently own an asset in our target
market") reads broader than the queue's live lease-expiry/timing bands (`P1`/`P2`/`P3`/`P8`) -- 235
of the 447 reachable owners (159 gov, 73 dia, 3 other) sit outside those bands entirely. Whether
"promotion" means widening the seller-prospecting population itself to all 447 reachable current
owners (buildable today, no new machinery -- BROKER1's default and the cadence engine both already
generalize), versus just fixing the label + the 6-owner broker gap + cadence gap for owners already
inside today's bands, is a scope call, not something to infer -- a prior standing decision
(`bd-ranking-and-priority-queue.md` §7, "do NOT widen the gate to `unknown` alone") was written
specifically to avoid silently widening this population, and while reachability (the missing piece
that refusal cited) is now satisfied, widening *what counts as a prospect* is still Scott's call, not
a default to make quietly. Full detail: `docs/architecture/ownership-truth-pipeline-state.md`
decision #6.

**Next**: awaiting Scott's answer on scope (a) vs (b) above. Once answered, the build is small:
extend/rerun `lcc_broker1_assign_prospect_brokers` (or the population it reads from) to the chosen
set, promote the `owner_role`/`behavioral_override` scalar, and seed `touchpoint_cadence` for anyone
reachable without a row yet. #2 (`canonical_name` unique constraint) remains the only other item
still gated, on reviewing the review-only tail from the OWN-T0c merge sweep -- not started.

## 2026-09-15 — the misparse guard IS blocking real brokers, and it is one rule (Cowork)

Triaged the 44 unreviewed `contact_misparse_review` items (**MISPARSE-BACKLOG1**) by reason, and the
queue splits cleanly. **`person_junk_name` (71 rejections) is ~99% correct** — "Marcus & Millichap"
x16, "Demographics" x7, "Cushman & Wakefield" x5, "View Less" x4, plus "Vice Chairman" / "Public REIT"
/ "CoStar Property Contact" — firms, page furniture and scraped labels, exactly what it is for. One
miss: **"Brian Lane"**, a real person whose surname is also a street word.

⚠️ **`email_fanout` (26 rejections) is the problem.** Roughly half are real, named brokers — Edward C.
Mann (x2), Bradley Lagomarsino, Clifford L. Lamar, Conrad Buhler, Dail Longaker, Debbie Gallimore
CCIM CIPS, Drew A. Flood, Jacob Fahner, James D. Collins, Nancy J. Bouton, Paul J. Collins, William M.
Collins — mixed with genuine junk ("Gross Income", "Vacancy", "PO Box 61381") and firm names. So
**HP1-P2misparse's worry is CONFIRMED and localized to one rule**, not to the guard as a whole.

⭐ **The fourth instance of "one signal, two meanings"** (after XB2-counter, `flag_long_dark`, and
DOC-TABLE2): one email on several contacts means either *a shared/generic inbox behind scraped junk*
or *a listing that legitimately names several brokers at one firm*, and `email_fanout` cannot tell
those apart. Prompt written: `prompts/MISPARSE1-email-fanout-is-blocking-real-brokers.md`, scoped to
`email_fanout` only, explicitly forbidding both weakening `person_junk_name` (it works) and bulk
auto-accepting the blocked contacts.

---


## 2026-09-15 — XB2-counter is live but unmerged; DEPLOY2 is live and in main (Cowork)

**XB2-counter verified against the live DB, not the summary.** `v_build_brief_producer_stall` returns
**0 rows**, `sidebar_contact_guard` is excluded (now 95 runs, still 0 completions — correctly silent),
and `pg_get_viewdef` shows the live body carrying `has_cron_trigger` and the cron predicate. CC also
repaired the duplicate-ID CI failure properly: `main` has **zero** duplicate backlog IDs.
🚨 **New class found — the exact mirror of DEPLOY2-unapplied → DEPLOY3-unmerged.** That migration is
**applied to production but absent from `main`**; it exists only on the still-open PR #2475 branch.
Rebuilding the DB from `main` would silently restore the old view and re-introduce the false positive,
and if the PR is closed or the branch pruned the only copy of that DDL goes with it — the loss BRANCH1
spent a round preventing. ⚠️ **DEPLOY2's brand-new detector is blind to this direction by construction:**
it enumerates `supabase/migrations/*.sql` and probes each declared object, so a change that is in the DB
with no file in the repo presents no file to enumerate. 👤 **Fix is trivial — merge PR #2475.**
**DEPLOY2 itself is genuinely live and in `main`:** snapshot 23 carries 5 `migration_unapplied` findings,
all `warn`/UNVERIFIABLE, 0 UNAPPLIED — matching CC's report exactly.
⚠️ **A flaw in my own guard, found while fixing two malformed rows.** Both had raw `|` inside code spans
(`` `'cron' | 'manual' | 'api'` ``, `` `FUNCTION|VIEW|TABLE|…` ``). GFM requires pipes escaped **even
inside code spans**, so those rows render broken on GitHub — but `backlog-table-shape`'s splitter is
backtick-aware and passes them. **My guard is more permissive than the renderer.** Pipes now escaped;
the guard should treat an unescaped pipe in a code span as a violation → **DOC-TABLE2**.
Brief is at 30 findings (24 + 5 migration_unapplied + 2 orphan prompts − 1 stall fixed); the two orphan
prompts were these two responses awaiting filing, now filed.


## 2026-09-15 — OWN-T0g closed: transfer-evidenced supersession rule shipped, live and forward-fixed (Cowork)

**Decision #3 of Scott's six compiled ownership-pipeline decisions — the riskiest one, a live
cron-critical ingestion path.** Scott's answer, verbatim: *"If there was a deed or a transfer of
ownership in some clear capacity, then the prior ownership has ended. Accuracy first."*

**Background** (`docs/audits/OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md`, STATUS.md 09-14
OWN-T0g sizing): `lcc_finalize_entity_portfolios`'s gov branch computes its supersession window only
across the rows in the current inflight sync payload — a property whose ownership history is split
across two sync calls (pagination) never gets compared across that split, so an old current fact and
a new current fact for the same property can both sit at `ownership_end_date = null` forever. dia has
no supersession logic at all.

**Classified `ownership_source` producers by data, not assumption** (live query against
`lcc_entity_portfolio_facts`): `county_deed`, `gov_ownership_chain`, `sales_transaction`,
`sales_transactions_seller_exit` are genuine recorded transfer instruments. `gsa_lease_diff`,
`gsa_lease_lessor`, `lcc_property_owner`, `county_records`, `costar`/`costar_sidebar`, and null are
lease-record restatements, internal snapshots, or market data — not proof an ownership change
happened. Matched the sizing note's own prediction exactly.

**Sized the live blast radius before writing anything** (per the OWN-T0g note's own recommendation):
against `v_lcc_property_multi_current`'s 735 `multi_current_distinct_parties` population, 72
properties had a transfer-evidenced current fact competing with a stale current fact for a different
party. Of those, 57 were safe to auto-resolve (the stale fact's own last-known start date was on or
before the transfer's date, or unknown) — 15 were a genuine unresolved conflict (the "stale" fact was
itself dated *later* than the transfer, i.e. something claims to be even more current than the
recorded deed) and were deliberately left alone for `v_lcc_portfolio_ownership_conflict` / human
review, never guessed. The known genuine co-ownership case (gov/1708, The Greystone Group vs.
Silverstone Company, both real current owners per OWN-T0d's investigation) was checked explicitly and
correctly excluded — neither of its current facts carries transfer evidence.

**Shipped `lcc_own_t0g_supersede_by_transfer_evidence(p_dry_run, p_batch_tag)`** — for every property
with a transfer-evidenced current fact, ends the losing party's fact at the transfer's start date,
unless that losing fact's own start date is later (left as a genuine conflict). Reversible via
`lcc_own_t0g_revert_supersession(batch_tag)`, fully logged to `lcc_own_t0g_supersession_log`. Dry run
matched live exactly: **65 facts / 61 properties superseded**, 0 failures, batch `own_t0g_2026-09-15`.
Re-running the dry run afterward found **0** remaining — idempotent, self-terminating.
`v_lcc_property_multi_current`'s `multi_current_distinct_parties` count dropped **735 → 678**.
Re-verified gov/1708 unchanged after the live run — both current owners still current, correctly
untouched.

**Wired the forward fix**: `lcc_finalize_entity_portfolios` (live, `SECURITY DEFINER`, cron-driven,
both dia and gov domains) now calls the same supersession function, live, at the very end of every
run — after both domains' upserts, scanning the WHOLE table (cheap, ~14k rows), not just that run's
payload. This is what actually closes the cross-sync-batch gap: a property whose ownership history
arrives split across two separate sync calls now gets compared correctly regardless of which call each
fact came in on. Everything else in the function is byte-for-byte unchanged from the live definition
(verified via `pg_get_functiondef` before editing, diffed line-for-line). Ran the modified live
function (`select * from lcc_finalize_entity_portfolios()`) — no error, no unintended side effect:
`multi_current_distinct_parties` stayed at 678, 0 new log rows (correctly a no-op since nothing was
left to supersede).

**Migrations**: `supabase/migrations/20261102180000_lcc_own_t0g_transfer_supersession.sql` (log table +
`lcc_own_t0g_supersede_by_transfer_evidence` + `lcc_own_t0g_revert_supersession`),
`supabase/migrations/20261102190000_lcc_own_t0g_finalize_calls_supersession.sql` (the forward-fix
wiring into `lcc_finalize_entity_portfolios`, full function body preserved verbatim plus one new
`PERFORM` call). Both applied and run live on `xengecqvemvfknjvbvrq`.

**Next**: one decision remains open from Scott's six — **#6, owner-role promotion + cadence**
(current ownership in the target market promotes out of `unknown`, covering broker assigned, 7
touchpoints in the first 6 months then ~4/year, individualized by client). It's the most
product-shaped of the six and needs its own design pass — reviewing the existing cadence engine
(`UX-T1a-touchcount`, the P112 never-seed-a-cadence-with-no-contact-method doctrine) and the current
broker/market-assignment data before proposing anything. #2 (`canonical_name` unique constraint) stays
gated on reviewing the review-only tail from the OWN-T0c merge sweep.
## 2026-09-16 — Government answered, and a third window defect found on the way (Cowork)

🔴 **"Root → LCC Opps" is not true, and the shipped rule avoids a false critical only by luck.**
**31 root-level migrations carry a `gov_` or `dia_` prefix** and target the other two databases.
Probed live: `20260812120000_gov_credit_classifier_expand_state_federal.sql` declares
`public.gov_credit_buckets_from_text`, which is **absent from LCC Opps (count 0)** — so the moment one
of these enters the window, `migration_unapplied` fires a **false UNAPPLIED at `critical`**: loudest
severity, most trusted rule, for a migration that is correctly applied to the DB it was written for.
**0 of 60 are in window today — that is luck, not design, and DEPLOY2-coverage destroys it**, because a
git-add-date window reshuffles scope and any new root `gov_`/`dia_` file lands in it at once. Prompt now
requires routing by **target database** (directory AND filename prefix) and **failing closed**: an
undetermined target is UNVERIFIABLE with a reason, never defaulted to LCC.
👤 **Scott's decision: no government detector in this repo** → **GOVDEPLOY1** filed, not built.
`GOV_SUPABASE_URL` / `GOV_SUPABASE_KEY` are both in Production, so it is possible — declined because it
would mean this repo auditing a database it handed to `government-lease` on 2026-09-12 (ID3a-d), the
exact ownership confusion that decision ended.
⛔ **And it must not be closed by scanning `supabase/migrations/government/`.** That directory's own
README says re-applying its files *"would silently restore two known-bad mappings"* (`TEXAS DEPARTMENT
OF AGRICULTURE` → `USDA`; `Immigration & Customs Enforcement` → `CBP`) — a detector reading them would
report the **live, correct** government DB as wrong. The stale-copy problem and the coverage problem
look alike and are opposites.
📄 Visibility ships with DEPLOY2-coverage: **`docs/architecture/MIGRATION-COVERAGE-MAP.md`** — three
projects → owning repo → detector status → where it lives, linked from the collector, so the uncovered
database is attributed rather than quietly absent. It records the asymmetry too: a root `_gov_` file
here still targets the government project, so "government is out of scope" and "nothing here touches
the government DB" are different claims and only the first is true.

---

## 2026-09-16 — DEPLOY2-coverage prompted: fix the blind spot before shipping into it (Cowork)

🟢 **`prompts/DEPLOY2-coverage-the-detector-is-blind-to-its-own-incident.md`** (176 lines). Two window
fixes: window by **git add-date** instead of filename sort, and **scan `dialysis/`** — which means
routing those files to **Dialysis_DB `zqzrriwuavgrquhisnoa`** and deploying the probe RPC there too.
`government/` stays excluded; it really is retired and guarded.
**Sequenced ahead of OWNERGAP2 on purpose.** OWNERGAP2 is dialysis owner-matching, so its migration will
almost certainly land in `supabase/migrations/dialysis/` — the one directory the detector does not scan,
on the same arc that produced the incident the blind spot hides. Shipping into the blind spot first is
the avoidable mistake.
✅ Enabling facts confirmed before writing, not assumed: CI already sets `fetch-depth: 0`, so full git
history is available to the collector; and the repo's established second-project secret names are
`DIA_SUPABASE_URL` / `DIA_SUPABASE_SERVICE_KEY` (172 / 70 existing references).
⚠️ Hard requirements in the prompt: **a file with no git add-date sorts NEWEST, never dropped** (P180 —
an untracked migration is the freshest thing in the repo); **absent dia credentials the dia half emits a
`skipped` finding**, never a quiet root-only scan reported as clean (B6a); and OWNERGAP1's verdict is to
be stated even if it comes out UNVERIFIABLE, not massaged into APPLIED.
✅ **AMENDED same day — no secrets need adding, and my first draft was wrong about this.** Scott showed the
live Production secret list: `DIA_SUPABASE_URL` and `DIA_SUPABASE_KEY` are already set;
`DIA_SUPABASE_SERVICE_KEY` is not. ⚠️ Naming either one directly is a trap the repo already documented —
`api/_shared/supabase-keys.js` (issue #720) records that `DIA_SUPABASE_KEY` has *"historically held the anon
JWT ... despite the names suggesting otherwise"*, with a **Phase 4 mass-revoke of anon grants** planned. So the
anon name is scheduled for demolition and the service name does not exist yet. Prompt now requires the existing
resolver **`diaSupabaseKey()`** (prefers service, falls back to anon): works today, upgrades itself when the
service key lands, no second change. Dia probe grants `service_role` AND `anon` (`SECURITY INVOKER` kept —
pg_catalog is world-readable, nothing to escalate) with #720 Phase 4 named in-comment as when the anon grant
comes out. 🔍 Stated, not buried: until that revoke this grants object-name enumeration on Dialysis_DB to
anon-key holders. This is the third time this arc that **reading the existing module beat inventing a new
name** — same lesson as `hasFirmSuffix()` and `localPartMatchRule()`.
🔭 Left open deliberately: the `government` project (`scknotsqkcheojiaewwh`) will have no unapplied-migration
detector at all. Correct by design, but it is a real gap and the prompt asks for it to be surfaced, not solved.

---

## 2026-09-16 — DEPLOY2 reconciled: the detector is real, and it is blind to OWNERGAP1 (Cowork)

**The shipped work is good and I verified it rather than reading the claim.** `lcc_probe_schema_objects`
IS live on LCC Opps. The judgement calls were right: STALE was measured (3-of-12 extractor success, plus
a real FP from pg's `timestamptz` → `timestamp with time zone` rendering) and **correctly not shipped**;
the XB2-precision retrospective was **declared unreconstructible rather than claimed**. Both are the
honest answer, and both are what the prompt asked for.
⚠️ **But the window has two defects, and one of them is severe.** **(a) `dialysis/` was excluded on a
half-true justification.** Root-only was justified as "`dialysis/`/`government/` are historical copies."
That is right for `government/` — README, `HISTORICAL — DO NOT RE-APPLY` marker, its own guard test,
owned by `government-lease`. It is **wrong for `dialysis/`: 0 of 282 files carry the marker and there is
no README.** The gov retirement was generalized without checking. So
`dialysis/20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql` — **OWNERGAP1, one of the three
incidents DEPLOY2 exists to catch** — is outside the scan, and its own header calls itself "the
containment that IS in scope from this repo."
**(b) The window sorts by filename, and filenames are not a clock.** `MIGRATION_WINDOW_SIZE = 60`, floor
`20260930121500` — but timestamps are synthetic sequence numbers, so files land out of order. Measured:
**107 migrations added in the last 14 days, 64 outside the window, 24 of those root-level.** This is the
same class the prompt already killed once: a synthetic timestamp is not recency. Both filed as
**DEPLOY2-coverage** 🔴; fix is bounded (git add-date window + deploy the probe RPC to Dialysis_DB).
🔍 **Live evidence that DEPLOY2-stale is worth building, not just a nice-to-have.** The very next
migration after CC's run — `20261102190000_lcc_own_t0g_finalize_calls_supersession.sql` — `CREATE OR
REPLACE`s `lcc_finalize_entity_portfolios`, which **already existed**, so existence proves nothing. One
body probe settled it in a single query (`pg_get_functiondef` contains `t0g` → the change IS live). That
is the XB2-precision shape reappearing four days later.
✅ **Two older rows closed by the same reconcile.** PR #2475 merged, so **XB2-counter** and the immediate half of **DEPLOY3-unmerged** (applied-but-unmerged) are both closed — `20261102180000_lcc_xb2counter_producer_stall_scheduled_only.sql` is on `origin/main` at `988fd65c`. ⚠️ It arrived carrying a **filename collision**: `20261102180000` is now held by two migrations (xb2counter and own_t0g_transfer_supersession, PRs #2475 and #2477), created the same day by two branches that never saw each other. The 99th collision, and it lands squarely on DEPLOY2's filename-sorted window.
✅ Also verified applied live while reconciling: PR #2477's two own_t0g migrations (`lcc_own_t0g_supersession_log`,
`supersede_by_transfer_evidence`, `revert_supersession`) — all present.

---

## 2026-09-16 — DEPLOY2-unapplied: migration-merged-but-unapplied detector shipped

Third occurrence of the class (HP1-P1a-fix, OWNERGAP1, XB2-precision) got its own audit rule.
`scripts/build-brief-collector.mjs` gained `migration_unapplied`: parses the most recent 60 ROOT
`supabase/migrations/*.sql` files for declared `CREATE [OR REPLACE] FUNCTION|VIEW|TABLE|TRIGGER|
INDEX|TYPE|POLICY` objects and probes each against LCC Opps via a new narrow RPC
(`lcc_probe_schema_objects`, `20260916120100`, SECURITY INVOKER over pg_catalog, revoked from
anon/authenticated). Killed the obvious version-number design first (the prompt's own
pre-measurement showed it flags nearly every recent migration as unapplied, due to synthetic
timestamps). **Live measured: 100 unique objects, 0 UNAPPLIED, 5 UNVERIFIABLE** (genuine
ALTER/COMMENT/INSERT-only migrations, hand-confirmed). N15 stays a false-positive-free negative
control; a fabricated function name fires the positive control at `critical`. **STALE (normalized
`pg_get_functiondef` body diff) evaluated and NOT shipped** — a 12-function extraction sample found
the regex extractor unreliable (3/12 first pass) and, worse, a genuine false positive purely from
Postgres's canonical type rendering (`timestamptz` → `timestamp with time zone`) on an unambiguously
current function. Filed as **DEPLOY2-stale**, needs an AST-based extractor + type-alias-aware
comparator before it is safe. XB2-precision's own history is **not** reconstructible from a
point-in-time DB snapshot that does not exist — stated, not claimed. Full detail:
`docs/os/PLANNED-BACKLOG.md` DEPLOY2-unapplied row. Branch `claude/deploy2-unapplied-migration-audit`,
pushed, not merged.

---

## 2026-09-15 — XB2-counter: the build brief's only producer finding was a false positive (Cowork)

`producer_stall_not_flag_gated` fired on `sidebar_contact_guard` — an event counter written on
every sidebar capture (`trigger_source='sidebar_capture'`), not a scheduled producer; its `0
completions` is the correct steady state once dedupe has already notified a key (already
established under SIDEBARGUARD1/XB2-precision). Fixed structurally: `v_build_brief_producer_stall`
now requires `bool_or(trigger_source = 'cron')` per producer, so any FUTURE event counter is
excluded too, not just this one. Migration
`20261102180000_lcc_xb2counter_producer_stall_scheduled_only.sql`, applied live to LCC Opps.
Verified: `sidebar_contact_guard` excluded (negative control); a synthetic `trigger_source='cron'`
stalled producer, inserted+rolled back in one transaction, still caught (positive control, 0
residue). RPC findings 19 → 18 (`producer_stall_not_flag_gated` 1 → 0); next collector snapshot
should read 24 → 23. See backlog **XB2-counter** for the full writeup and **XB2-counter-eventguard**
(filed, not built — a replacement alert for the guard's own failure mode).

---

## 2026-09-15 — The 15 dark flags are ~5 decisions, and none of them is dead code (Cowork)

`flag_long_dark` is **15 of 24 findings (62%)** of the build brief, so triaged it into something Scott
can act on: `docs/audits/FLAG_LONG_DARK_TRIAGE_2026-09-15.md`.
⚠️ **Corrects my own earlier note.** I wrote that each dark flag is "either work to finish or code to
delete." **Checked all 15: every surface file exists and every flag is still referenced in live code** —
deletion is not on the table for any of them. And for most, "off" means **the env var was never set**:
`return !!process.env.OWNER_ENRICH_ADDRESS_URL`, with `sos-lookup.js` returning `reason: 'unconfigured'`.
These are **unconfigured adapters degrading honestly**, not disabled features.
**15 rows collapse to ~5 decisions:** nine flags are ONE question (stand up owner-enrichment adapters at
all?); two are the Salesforce list import (dark **108 days** — the oldest, and nobody has missed it,
which is itself an answer); one is save-not-send Outlook drafting (touches Northmarq IT constraints);
one is the CM treasury webhook (optional). `ENABLE_OWNERSHIP_RESEARCH_QUEUE` is the `government-lease`
repo's call, not this one's.
⭐ **Recommended first: `DECISION_OWNER_DEED_WINS`** — the only true feature toggle in the set. No
endpoint, no purchase, no IT conversation; just a policy call on whether a recorded deed overrides other
owner sources, and it sits squarely on the OWNERGAP true-owner thread. → **FLAGDARK1**
⭐ **Third instance of one rule-design flaw**, so it is worth naming as a class: after
`producer_stall_not_flag_gated` (event counter vs scheduled producer) and `market_brief_lane_stale`
(one gap vs five), `flag_long_dark` conflates *unconfigured* with *disabled*. The pattern is **a rule
reading one signal that carries two different meanings** — folded into **XB2-counter**.


## 2026-09-15 — T2b shipped: gov ownership resolution's second tranche fully applied (Cowork)

**Decision #5 of Scott's six compiled ownership-pipeline decisions.** Scott's answer, verbatim:
*"Yes, again, the objective is accurate coverage of all properties in our target submarket. We want
to get there as fast and efficiently as possible."*

**Background** (`docs/audits/C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md` §6,
`connectivity-and-open-threads.md` §4k.1): T2a (gov owners with ≥$100k aggregate rent) shipped
2026-08-28. T2b — the remaining below-$100k + rent-unknown tail, 2,241 properties / 2,054 owners —
was sized safe and cheap (predicted duplicate-group growth actually *lower* than T2a's measured
actual) but left unrun: "the decision is purely whether 'resolve all ownership, rank later' should
be applied to a population ~96% un-contactable today... **Not run. No default taken.**"

**Re-measured live before running** (population moves): `v_lcc_c2e_asset_mint_plan` — which
self-excludes anything already minted, so T2b's population is simply whatever remains after T2a —
held at 2,255 properties / 2,068 owners (805 under $50k / 712 at $50–100k / 537 rent-unknown),
essentially unchanged composition from the original 2,241/2,054 sizing three weeks ago.

**Ran the same mechanism T2a used**, no new code needed (per "review existing machinery before
building"): `lcc_mint_gov_asset_entities(p_rows, p_batch, p_dry_run)`. Dry run matched the live run
exactly — **2,255 would-mint → 2,255 minted, 0 skipped**, batch `t2b_gov_2026-09-15`. Drove the
evidence ingest explicitly in the same pass, as the mechanism requires (cron 225 caps at 400/run):
`lcc_ingest_domain_owner_evidence(false, 3000, 't2b_evidence_2026-09-15')` → **evidence_written
2,262, assets_resolved 2,255, ambiguous_logged 1**. The 7-row gap between written and resolved is the
identical guard T2a hit — all 7 residual `eligible` rows are brokerages (`Stan Johnson Co` ×4, `NAI
Pfefferle`, `Bradford Allen Realty Services`, `SVN®`), correctly filtered out by
`lcc_reconcile_property_owner`'s scoring CTE. Working as designed, not a defect.

**Result**: `v_lcc_c2e_asset_mint_plan` now reads **0** — gov asset-anchor resolution across both
tranches is fully applied. gov asset anchors now 10,255 (external_identities, `source_system='gov'`,
`source_type='asset'`); `lcc_property_owner` now 10,906 rows. Checked for a blowup on the two axes
T2a's own audit flagged (duplicate-candidate growth, Tier 0 card growth) — neither spiked; both
stayed in the range the pre-run sizing predicted.

**Next**: decisions #3 (OWN-T0g supersession rule — needs care, live cron ingestion path) and #6
(owner-role promotion + cadence — needs its own design pass) are the two remaining open items from
Scott's six. #2 (`canonical_name` unique constraint) is gated on reviewing the review-only tail from
the OWN-T0c merge sweep earlier today.
## 2026-09-15 — DEPLOY2-unapplied prompted; the obvious design was measured and killed first (Cowork)

**The N15 migration turned out to be APPLIED** — verified live rather than assumed: mint + unmint
functions and `lcc_n15_sf_campaign_hub_mint_log` all present, batch `n15_sf_campaign_2026-09-15`
carrying **1,475 rows**. So the merged-but-unapplied class is **3 of 4, not 4 of 4** — and that
counterexample is load-bearing, because an existence-only check passes N15 correctly *and* passes
XB2-precision incorrectly. Staleness, not existence, is the discriminator.
⚠️ **Pre-measured the obvious design before writing the prompt, and it is a dead end.** LCC Opps holds
**885 migration files** but only **742 unique version prefixes** (98 timestamps collide);
`supabase_migrations.schema_migrations` holds **770 rows**, newest `20260915142114` — **and no file is
named that**. The repo names migrations with *synthetic sequence* timestamps (`...120000`) while
Supabase stamps the *real apply clock*, so **87 file versions are dated after today**, out to
`20261102170000`. A `file_version NOT IN schema_migrations` rule would flag nearly every recent
migration as unapplied — wrong on its whole visible output, the **XB2-counter** failure on a second
rule in the same brief. The prompt forbids it by name.
🟢 **Prompt written: `prompts/DEPLOY2-unapplied-migration-detector.md`** (175 lines). Rule goes in
`scripts/build-brief-collector.mjs`, not the XB2 SQL RPC — that migration's own header sets the split
(filesystem state is not queryable from Postgres) and this rule needs both halves. Hard requirements:
**UNVERIFIABLE is a finding, never folded into APPLIED** (a data-only backfill is the exact shape that
merges and leaves no trace — P131/P180); a **positive control** (Class 11); and a
measure-the-FP-rate-first gate on the `pg_get_functiondef` normalized compare, with explicit
permission to ship UNAPPLIED+UNVERIFIABLE only and file STALE as a row if the noise is bad. ⛔ Report
only — the prompt forbids applying anything it finds, since some of the 87 future-dated files may be
staged deliberately.
🔭 Two things surfaced and deliberately NOT fixed: canon has **no block on migration application at
all**, and the synthetic-timestamp naming is its own 885-file / 98-collision change.

---

## 2026-09-15 — XB2-precision verified; SIDEBARGUARD1 disproved by reading the source it told me to read (Cowork)

**XB2-precision shipped and hit its acceptance target.** Snapshot 13: findings **32 → 24** (predicted
~23), lane findings aggregated **11 → 3**, `branch_debt` present. The collector produced **13 snapshots
in one day**, each tied to a merge commit — it is genuinely self-running now.
⚠️ **SIDEBARGUARD1 was a false positive, and my framing of it was wrong.** I had called it "either dead
code on a schedule or something unguarded for days". Neither. `sidebar_contact_guard` is an **event
counter**, not a scheduled producer — written on every sidebar capture, where `status='ok'` means
*"raised a NEW misparse review item"*. So **0 completions is the correct steady state** once dedupe has
notified a key. Evidence: 73 runs blocked 166 contacts, and **149 review items exist** (2026-08-10 →
09-14) of which a human **dismissed 105**. The surfacing path works; the guard works. I had written
"read the skip_reason's source before assuming either" into the row itself — doing that is what
disproved it, which is the only reason this did not become a wasted CC round.
**The real defect is in XB2's rule** → **XB2-counter**, now the brief's only wrong finding and therefore
load-bearing: a rule whose single visible output is known-wrong is the "monitor nobody trusts" failure
we have paid for three times already.
👤 **One genuine item survived:** **44 misparse reviews still `new`**, oldest 2026-08-10 (~36 days) →
**MISPARSE-BACKLOG1**. Matters because HP1-P2misparse is the thread about this guard rejecting REAL
people, and `person_junk_name` is the dominant rejection reason.
🔭 New shape of the brief: `flag_long_dark` is **15 of 24 findings (62%)**. Not a monitor defect — a real
backlog awaiting Scott's decision (11 dark >60 days, oldest since 2026-05-30).

## 2026-09-15 — `HCRIS-TIMEOUT-3` reviewed: the HCRIS fix itself is genuinely correct — the real culprit was the diagnostic instrument (`ingestion_tracker`) being blind, plus a second, previously-unnamed bug hiding behind it

`HCRIS-TIMEOUT-3`'s response (`"HCRIS TIMEOUT 3 surface response.docx"`, saved by Scott) read in full and
independently re-checked against Dialysis_DB. **Genuinely different shape of finding than the first two
rounds — not "the fix didn't work," but "the fix worked, and the instrument measuring it was broken."**

**(a) Re-read against the actual deployed code, confirmed clean.** `_download_and_extract`'s bounded
(connect, read) timeout and wall-clock deadline, `HCRIS_DOWNLOAD_TOTAL_TIMEOUT_SEC`/`CMS_HCRIS_INGEST_STEP_TIMEOUT_SEC`,
and `hcris_propagation`'s real call to `save_estimates_batch()` (no leftover dead call site to the old
per-row path) — all genuinely wired as designed. `HCRIS-TIMEOUT`'s original fix (PR #7410) is not the
defect.

**(b) The actual reason the symptom persisted: two previously-undiagnosed bugs in the tracker/heartbeat
mechanism itself**, not in HCRIS-specific code at all. `_write_step_heartbeat()` used one unretried
`.execute()` call on a long-lived Supabase client this repo's own code already documents as degrading late
in a run, failures logged at DEBUG — silently blind on nearly every run (this session's own spot-check:
126–129 of the last 140 `ingestion_tracker` rows carry blank `notes`, close to but not exactly matching the
response's own "139 of 140" figure — noted as a minor precision gap, not a substantive one). `finish_run()`
only retried twice versus `start_run()`'s already-hardened 6-attempt budget for the identical
connection-degradation symptom (`PRI3(e)`) — so a run that actually finishes still reads `started`/`NULL`
forever. **This is exactly `HCRIS-TRACKER-BLIND`, filed last round** — folded in and fixed here rather than
treated as separate, since the fix is the same mechanism.

**A genuinely new, materially important finding: `hcris_cost_reports` and `hcris_propagation` are failing
for their own, still-unidentified reason, separate from `run_timeout`.** The `"Failed steps: hcris_cost_reports,
hcris_propagation, run_timeout"` summary this arc has been reading for three rounds was never one failure —
it names two steps that fail on their own plus a budget cutoff that (per this round's live trace) hits a
**different, later, unnamed step**. The real per-step exception text was never captured anywhere before this
fix — `_log_ingestion_row()` now persists a `step_errors` map with the actual exception per failed step, so
the next run will finally say why `hcris_cost_reports` fails, instead of every round re-guessing. **Flagged,
not fixed, out of scope this round**: `qip_scores_ingestor.py` and `cms_deficiency_ingestor.py` — later,
optional steps in the same pipeline — still carry the exact bare `requests.get(timeout=300, stream=True)`
pattern `HCRIS-TIMEOUT`'s first round already root-caused and fixed for HCRIS, a plausible source of the
multi-hour `run_timeout` tail. New candidate backlog item, not yet a prompt.

**(d) Live proof still not obtained — correctly disclosed, not claimed.** No CMS/Railway egress from the
Claude Code sandbox, and the currently-stuck run (`bc5d3867…`, started 07:33:40 UTC, still `run_status='started'`
at DB time 14:21 UTC — 6.8+ hours in, independently re-confirmed) predates this fix and won't demonstrate it
either way. Scott confirmed `Dialysis` PR #7411 (commit `651c630`, branch `claude/lucid-wozniak-z996iw`)
merged. **The real test is the next full run cycle** — this time with `step_errors` actually populated, so
the next review reads the real cause directly instead of cross-referencing four Supabase tables by hand.
`HCRIS-TIMEOUT` stays 🔴 — not closed — pending that. Prompt moved to `docs/claude-code/prompts/done/`.

## 2026-09-15 — XB2-precision reconciled: the code shipped, the migration never did — third time for one class (Cowork)

PR #2460 merged and `main` carries both halves. The **JS half is live** — `branch_debt` fires in every snapshot
from 12:52 onward, so the 1,722-branch number is no longer silent. **The SQL half was never applied.**

Checked rather than assumed: the live `lcc_build_brief_db_audit()` still had **no `GROUP BY`** and was still
emitting `format('%s/%s', lane, section)` — one finding per cell. Snapshots 7 through 11 all read **32 findings
with 11 lane rows**, unchanged, including the newest at 14:16. **The prompt's stated deliverable was a
before/after findings table after applying and redeploying — the "after" never existed**, so what looked like a
shipped precision fix had changed nothing on the DB side.

✅ **Applied it live.** DB-side findings **27 → 19**; the lane rule collapses **11 → 3** (`government`,
`net_lease`, `dialysis`), with every affected section now named inside `measured` instead of restated as its own
row. Flags (15) and the stall rule (1) are untouched, so the next collector run should read **≈24** total against
the prompt's predicted ~23.

🚨 **This is the THIRD time the same class has bitten, and that is the finding worth more than the fix.**
**HP1-P1a-fix**: migration merged, unapplied — the deployed code called an RPC that did not exist and would have
404'd all 608 deals every 30 minutes. **OWNERGAP1**: caught only because a verification step happened to run.
**XB2-precision**: merged, unapplied — and everybody, including the session that shipped it, believed the count
had dropped.

⚠️ **Prose has failed three times.** `CLAUDE.md`'s *"merged is not running"* doctrine covers **code**, and it
works — `/version` against `main` is a real check that this session has used repeatedly. There is **no equivalent
for migrations**, and that is the actual hole.

✅ **Filed as `DEPLOY2-unapplied`, with the fix that fits: make it an XB2 rule.** XB2 already exists to catch
"looks live, does nothing" — having the self-audit system flag a migration on `main` whose object is absent or
structurally stale in the live DB is the right owner for this. ⚠️ And the rule needs a **staleness** test, not an
existence test: existence alone would have passed XB2-precision, because the function existed — it was just the
old body. Hashing the file's `CREATE` block against `pg_get_functiondef` is one option to evaluate.

## 2026-09-15 — N15 closed: 1,475 Salesforce-campaign orphans minted as unified_contacts hub rows (Cowork)

**Decision #4 of Scott's six compiled ownership-pipeline decisions.** Scott's answer, verbatim:
*"These are members of a specific group? Usually means that there is some vested interest in the
space mapped by the name. Some may be brokers, some may be a new fund exploring the space, but the
vast majority will be owners or prior owners and the membership is evidence that some prior research
has concluded that in our team's BD history and just because the LCC doesn't yet have that connection
mapped, does not mean that its not out there undiscovered."*

**Background** (P197, `docs/audits/P197_TIER0_EMPLOYER_RESOLVER_2026-08-27.md` §4): of the live person
entities with an email and no `unified_contacts` hub row, membership in a Salesforce campaign (via
`lcc_sf_list_membership`) was measured as "the only gate that discriminates" among candidate criteria
— 1,475 admitted. P197 explicitly did not mint ("an operator-surface decision with a blast radius")
and filed it for Scott as this backlog row.

**Re-measured live before building anything** (re-measure-before-acting discipline, this population
moves): total email-orphan population grew from 5,193 to **5,672** since P197, but the SF-campaign
gate held at exactly **1,475** — `lcc_sf_list_membership` turns out to be a frozen 2026-07-16→07-21
snapshot, not a live-syncing producer. Worth its own follow-up (the campaign-membership signal itself
is stale for anything captured since July), not fixed in this pass. Sampled the 1,475 before minting:
side distribution seller 1,030 / unknown 416 / buyer 88 — consistent with Scott's "vast majority will
be owners" read; 15 random rows spot-checked, all real BD-relevant names and campaigns (`VCA Animal
Hospital Owners`, `DMR Urgent Care Owners`, `SAB GSA Prospects`, `GSA Buyer`). Checked mint-collision
risk the way P197 did for its own would-be reconcile: 0 of the 1,475 already resolve to a hub row
under `sf_contact_id`.

**Shipped `lcc_n15_mint_sf_campaign_hub_rows(dry_run, batch_tag)`** — one hub row per entity, picking
the best of that entity's campaign-membership rows (domain-confirmed company preferred, else most
recent). **Never fabricates `company_name`** — reuses the exact `lcc_tier0_company_confirms_domain`
gate P197 built after finding that a bare campaign company label is a human/capture field, not an
employer register, and copying it verbatim manufactures employers (city/zip strings, the person's own
name, a different firm, a bank). Dry run matched live exactly: 1,475 would-create → 1,475 created, 0
failures. Only 228 (15%) got a domain-confirmed `company_name` written; the other 1,247 correctly
render with no company rather than a guess — honest "Not on file," per standing doctrine. Fully logged
to `lcc_n15_sf_campaign_hub_mint_log`, batch `n15_sf_campaign_2026-09-15`, reversible via
`lcc_n15_unmint_sf_campaign_hub_rows('n15_sf_campaign_2026-09-15')`. Migration:
`supabase/migrations/20261102170000_lcc_n15_sf_campaign_hub_mint.sql`.

**Scope, stated plainly**: this does not touch the remaining ~4,197 email orphans outside the
SF-campaign gate, and does not itself change Tier 0's `no_employer_on_file` blockage — P197 already
fixed that separately with a read-time resolver (`lcc_tier0_employer_on_file`), and this row's own
audit found minting hub rows would only have helped 4 of 73 blocking people. This is Scott's stated
connectivity-coverage goal ("truth and accuracy... pushed toward 100%"), not a Tier 0 fix.

**Next**: decisions #3 (OWN-T0g supersession rule), #5 (T2b), #6 (owner-role promotion + cadence) are
still open with decided rules, not yet built. #2 (`canonical_name` unique constraint) is gated on
reviewing the remaining canonical-name collision tail from earlier today's OWN-T0c sweep.
## 2026-09-15 — OWNERGAP2 prompt: the first BUILD in the owner arc, deliberately two adapters wide (Cowork)

The sampling has done its job — two measured rates (Philadelphia **68%**, Harris **86%**), three named miss
causes, and a demonstrated free path. Written the build prompt:
`prompts/OWNERGAP2-match-owners-from-free-sources.md`.

✅ **Checked the existing machinery first, and it changes the shape of the build.** `recorded_owners` **already
exists with 7,487 rows** — `name`, `normalized_name`, `normalized_address`, `source`, `entity_type`,
`registered_agent_*`, `filing_*` — and **5,467 of 11,815 properties already carry a `recorded_owner_id`**. The
destination is built and working for 46% of the book; the 4,021 are the hole in it. **So the prompt forbids a new
table** and scopes the work to *adapters plus a provenance contract*.

🚨 **The provenance contract is the whole prompt, and it is written that way because of what this arc already
found.** Every owner written must cite the source row — jurisdiction, that source's own record id, the query.
**No model may produce an owner name**: a name is copied from a fetched record or it does not exist. A local model
may only normalise and match strings already fetched, and even then the value written is the **source's** string,
not the model's rendering of it. A miss stays `recorded_owner_id IS NULL` and gets reported — **never** filled
from the operator, which would be PDR2 undone.

🔑 **One free gift from the measurement, written into the design:** Harris types every account `Personal` or
`Commercial`, so the assessor draws the operator-vs-owner line for us. The matcher keys on that account type
rather than re-deriving it from name text — which is precisely the mistake PDR2 fixed.

**The two cheap miss causes are handled; the third is refused.** Ranges (`4126 Walnut` ↔ `4126-38 WALNUT ST`) and
aliases (Cypress Creek Pkwy = FM 1960, from an explicit evidence-grown list, **never** by loosening the match
until something returns). Multi-parcel sites — `3300 Henry Ave` returns six owning LPs — are left unresolved and
flagged `needs_parcel_discriminator`. **Guessing which LP would be exactly the failure this arc exists to stop.**

⚠️ **Explicit ambiguity rules**, because this is where a wrong owner gets minted: more than one candidate, a
non-exact house-number-and-street match, or a matched name that is itself an operator → **write nothing, flag,
report**. And the gate requires **hand-checking 5 written owners against the live source** — a match rate is not
proof the right name landed on the right property.

Scope is held deliberately small: **two adapters**, no national pipeline, no scheduler, no `county_authorities`,
and no attempt on a CAPTCHA-gated portal. The closing ask is one number: **how many of the 4,021 now have an
owner.**

## 2026-09-15 — ⚠️ `HCRIS-TIMEOUT-2` reviewed, and a prior round's own STATUS/backlog edits never made it to `main` — a real process bug found and worked around

**Two things happened this round.**

**(1) `HCRIS-TIMEOUT-2` reviewed** (this round's response, re-verified live before filing — details below,
since the entry documenting this got lost, see (2)): could not confirm the deployed commit SHA (no Railway
tool access), but independently re-verified three of the response's claims live: zero `public_data_snapshots`
rows ever for HCRIS; the failed run's timing decomposing into 4 URLs × ~4.5h each, matching the OLD
unbounded-timeout bug's signature; and an 8,894-error burst followed by 17h46m of silence. Filed
`HCRIS-TRACKER-BLIND` (below) for a second, unrelated defect found along the way.

**(2) Scott then confirmed Dialysis PR #7410 (the HCRIS fix) is deployed on Railway**, and uploaded a log
snippet claiming the most recent run finished in ~90 minutes. **Checked live rather than accepting that at
face value — the database evidence contradicts it.** The most recent `ingestion_tracker` row (`bc5d3867…`,
started 2026-09-15 07:33:40 UTC) is still `run_status='started'`, `finished_at=NULL` at DB time 13:07:43 UTC
— **5.5+ hours later, not 90 minutes** — and `run_log` has zero entries of any kind after the initial
startup batch at 07:33:37–07:41. `facility_cost_reports` is still frozen at 2026-03-16 (0 rows touched
today), and `public_data_snapshots` still has zero HCRIS rows, ever. **The uploaded log file itself only
covers a 20-second slice at the run's startup (07:34:06–07:34:26 UTC) — it cannot show the run finishing**,
same limitation as the previous log upload in this arc. **With the deploy now confirmed, this squarely
answers `HCRIS-TIMEOUT-2`'s catalog item (a) — the merged fix IS what's running — which means the symptom
persisting is now item (b): a residual bug in the fix's own code, not a stale deploy.** Asked Scott where
the "~90 minutes" observation came from (Railway dashboard/process view), since it doesn't match what
Supabase shows. New follow-up prompt drafted:
`docs/claude-code/prompts/HCRIS-TIMEOUT-3-deploy-confirmed-still-hung-re-diagnose-the-actual-deployed-code.md`.

**A separate, purely mechanical finding, also from this round: this file and `PLANNED-BACKLOG.md`'s prior
`HCRIS-TIMEOUT-2` entries were silently dropped and never reached `main`.** The merged PR
(`docs/hcris-timeout-2-reviewed`, #2462) contains only the new response `.md` file — `git show --stat`
confirms it. Root cause: the recovery pattern this arc has used for the recurring `checkout -b` failure
(`git branch <name> HEAD` → `git reset --hard origin/main` → `git checkout <name>`) captures only committed
history in the `git branch` step; STATUS.md/PLANNED-BACKLOG.md had been written to Scott's working tree via
the file bridge but were still **uncommitted**, so the very next step, `git reset --hard origin/main`,
silently discarded those two files' edits before `git add` ever ran. The new response file survived only
because it was untracked, and `reset --hard` doesn't touch untracked files. **This pattern is retired as of
this round.** New default: `git checkout -b <branch>` with no explicit start-point (branches from current
HEAD in place, carrying uncommitted changes forward, never touches origin/main), used in this round's git
block instead.

## 2026-09-15 — XB2-precision shipped: `branch_debt` rule + per-lane market-brief aggregation (Cowork)

Both gaps from the XB2-precision reconcile below are fixed. (a) New rule `branch_debt`
(`branchDebtFinding`, `scripts/build-brief-collector.mjs`) fires on `total_remote` alone (warn,
threshold 200, growth trend from a prior snapshot when fetchable) — the count was already recorded
in the payload and never surfaced as a finding. (b) `lcc_build_brief_db_audit()`'s
`market_brief_lane_stale_or_missing` rule now emits ONE finding per LANE, not per lane×section,
with `missing_sections`/`stale_sections` named in `measured`. Lane list left untouched (the
retraction below stands — `net_lease` is the MB9 survivor, not a retired lane). 22/22 tests pass.
Not yet re-measured live post-deploy — next step is a fresh collector run against the redeployed
migration and the before/after findings-count table (32 → ~23 predicted).

---

## 2026-09-15 — OWN-T0c trailing-"The" adopted + the general fuzzy-merge sweep it unblocked; N3c/bank-trustee exclusion also merged (Cowork)

**Scott answered all six compiled open decisions at once (2026-09-14 → 2026-09-15).** This entry
closes decision #1 (trailing "The"); items #2–#6 are filed as their own open threads below and in
`docs/architecture/ownership-truth-pipeline-state.md`'s "Open decisions" section, which is being
updated in the same pass.

**Decision #1 — "if they are the same entities, merge... I don't have a preference about the naming
structure."** `lcc_entity_name_tokens` now strips a trailing "The" token, not just a leading one (this
re-applies, with explicit authorization, the exact change built-then-reverted on 2026-09-14 as
`own_t0c_trailing_the_2026-09-14`). 12 confirmed collision groups (16 entities) merged live via
`lcc_merge_entity`. Effect on the property-conflict-scoped `duplicate_entity` class: 1,183 → 1,177
(only -6) — confirmed most of that population is a **separate** collision class, not explained by
trailing-"The" alone.

**Reviewed existing machinery before building anything new (standing doctrine)** and found the real
scope of Scott's decision was already served by `v_lcc_merge_candidates` + the dormant
`lcc_apply_fuzzy_merges(dry_run, [limit])` — a mature, already-built auto-mergeable detector with
role-priority survivor selection, Salesforce-account-aware guards, name-similarity gating, and a
"pinned" protection for bridged unknown-role entities, applying through the same guarded
`lcc_merge_entity` primitive `lcc_repair_tombstone_portfolio_facts` (OWN-T0d) also uses. Full
canonical_name collision population measured first: **6,636 groups / 14,007 entities** (not scoped to
property conflicts — this is the true size of "if they are the same entities, merge"). Dry run showed
3,021 groups / 3,305 entities `auto_mergeable = true`; sampled for false positives (short-code LLC
names, DBA/legal variants — `cbre`→`CBRE Group, Inc.`, 4-letter LLC codes, etc.) — sane. **Ran live**:
`lcc_apply_fuzzy_merges(false)` — 3,021 groups applied, 3,305 entities merged, 0 failures, fully logged
to `lcc_entity_merge_log` (reversible per-row, same snapshot mechanism as every other merge this
session).

**Result**: canonical_name collision population 6,636/14,007 → **3,772/8,005** groups/entities.
`duplicate_entity` class: 1,177 → **930**. Remaining population is the harder, review-gated tail
`v_lcc_merge_candidates` already routes away from auto-merge: `bridged_unknown_pinned` (1,644g/3,538e),
`no_role_or_sf_signal` (337g/682e), `multiple_sf_accounts` (89g/193e), `low_name_similarity`
(64g/143e), `normalizer_blind_review_only` (64g/175e) — **not** swept here; needs its own review pass
since the view's gates exist precisely because same-canonical-name alone isn't proof of same-entity in
these cases.

**JS/SQL parity kept intact.** `test/entity-canonical-key.test.mjs`'s corpus contradicted the newly
adopted rule (`'Penstar Group, The' → 'penstar group the'`) — updated to the live-verified value
(`'penstar group'`), and `api/_shared/entity-link.js`'s `entityNameTokens()` rewritten to mirror the
SQL's exact `ord`/`total` window semantics, **including a real quirk**: a trailing "The" strips only
when it lands exactly at the post-stoplist survivor count, so a legal-form word (Inc./Co./LLC/...)
anywhere before the "The" prevents the strip (`'Edwin Mcintyre Co., Inc., The'` stays
`'edwin mcintyre co the'`, unstripped — confirmed this is the live SQL's actual behavior, not a JS bug,
and documented in both files so a future session doesn't "fix" it without re-running the backfill and
merge sweep). All 8 subtests in `test/entity-canonical-key.test.mjs` pass. Migration:
`supabase/migrations/20261102160000_lcc_own_t0c_trailing_the_and_fuzzy_merge_sweep.sql`.

**Also merged this window** (built and shipped just before the six-decision answer, PR #2456 already
on `main`): OWN-T0/N3c bank-and-CMBS-trustee prospecting exclusion
(`lcc_owner_name_is_bank_or_trustee`, OR'd into the single `lcc_owner_name_is_not_prospected` choke
point) — 11 owner names excluded live, 0 false positives against individual/family trustees or credit
unions. Closes N3c (`tier0-owner-contact-system.md` §6).

**Open-threads table restored to the top of this file** — a concurrent session's 09-15 entry had been
prepended above it (line 47, past the guard's 40-line limit), reproducing the exact failure mode the
table's own header comment warns about. Reordered, no content dropped; `status-header-integrity` and
`status-line-budget` both pass again.

**Next**: decisions #2 (canonical_name unique constraint — gated on this sweep's result, now much
closer), #3 (OWN-T0g supersession rule), #4 (Salesforce-campaign orphans, N15), #5 (T2b), #6
(owner-role promotion + cadence) are still open, each filed as its own thread in
`ownership-truth-pipeline-state.md`.
## 2026-09-15 — XB2-precision scoped, and I retracted a claim I had already merged (Cowork)

⚠️ **Correction first.** The XB reconcile (PR #2458, merged) asserted that `v_market_brief_staleness`
"reports staleness on a retired lane" because MB9 collapsed `net_lease`. **Wrong.** MB9 collapsed
**`broad_net_lease` INTO `net_lease`** — `net_lease` is the survivor, and the view's three lanes match
`KNOWN_LANES` in `api/_shared/market-brief-render.js` exactly. I read a collapse as a retirement and
asserted it without checking the constant, then shipped it. Corrected at the source in both STATUS and
PLANNED-BACKLOG rather than quietly edited, and the prompt carries the retraction so CC does not "fix" a
view that is already correct.
**The aggregation half stands and is what the prompt covers:** `market_brief_lane_stale_or_missing`
emits per lane×section, so one known fact — no producer has ever written a government or net-lease fact
— becomes **11 of 32 findings (34%)**, burying the one genuinely new find in the same snapshot
(`SIDEBARGUARD1`). Fix is one finding per lane with sections as detail.
**Also measured the trend, not just the level:** remote branches **1,718 → 1,722** in a day, ~4/day. The
collector already records `total_remote` and **no rule fires on it** — the biggest number in the repo,
captured and silent, the same shape as `item_count` before MB2b. Prompt notes why `unmerged` reads 0
(a CI clone has no local branches, so local debt is unmeasurable there by construction — 0 is honest,
not a bug) so nobody "fixes" it into a rule that reads 0 forever and looks healthy.
Acceptance target given to CC: findings **32 → ~23**, with `branch_debt` newly present.



## 2026-09-15 — Harris measured at 86%; two jurisdictions now, and the county hands us PDR2's distinction for free (Cowork)

Second match-rate test, sampled the way a person would do it — HCAD's public search, seven owner-unknown
properties, address by address. **6 of 7 = 86%**, against Philadelphia's 68%.

**Owners recovered:** `CRENSHAW MOB LLC` (FKC Pasadena-Crenshaw) · `BEAMER SCARSDALE LP` (DaVita Sagemeadow) ·
`ROY AND VEVA MORRISON RANCH CORPORATION` (DaVita Garden Oaks) · `US INVESTMENTS` (DaVita Inwood) ·
`AALS PROPERTIES LLC` (FKC Atascocita) · `FULTON SHOPPING CENTER INC` (FMC Moody Park).

🔑 **The most useful finding is structural, not the rate.** Every Harris hit returned two or three accounts at the
same address, **typed by the county itself as `Personal` or `Commercial`** — the tenant's equipment account
(`PIKE DIALYSIS LLC`, `HOLDREGE DIALYSIS LLC`, `BIO-MEDICAL APPLICATIONS OF TEXAS INC`) versus the real property
owner. **That is PDR2's operator-vs-owner distinction, drawn for us, for free, by the assessor.** A matcher should
key on that account type rather than re-deriving operator-vs-owner from name text — which is what LCC was doing
wrong in the first place.

⚠️ **The single miss is a THIRD failure mode.** `4427 Cypress Creek Pkwy` returned Cypress Grove Ln, Cypress Pond
Ct and W Cypress Villas — wrong street entirely, because Cypress Creek Parkway is Houston's renamed **FM 1960**
and HCAD indexes the name it holds. A **street alias**, not a formatting difference, and the one cause a string
normaliser **cannot** fix from our data alone.

**Three miss causes now identified, all cheap, none needing paid data:** address **ranges** (Philadelphia,
`4126-38 WALNUT ST`) · street **aliases** (Harris, FM 1960) · **multi-parcel** sites (3300 Henry Ave → six owning
LPs, needs a parcel discriminator).

⚠️ **Miami-Dade was NOT sampled**, and that is stated rather than implied — two rates of 68% and 86% would not
have been changed by a third, and the sampling has done its job.

👤 **Recommendation, unchanged in direction and far better evidenced:** build nothing yet. The next unit of real
work is a **matcher against free sources**, scoped by those three miss causes, starting with jurisdictions that
publish bulk files or open APIs. A paid provider stays relevant only for **LA-shaped** counties that publish no
owner at all — now demonstrably a small fraction of the 4,021 rather than the whole of it. Audit doc §9.

## 2026-09-15 — ⚠️ `HCRIS-TIMEOUT`'s merged fix did NOT resolve the symptom — live-verified, re-opened as `HCRIS-TIMEOUT-2`

Scott confirmed the `Dialysis` PR (`claude/hcris-timeout-fix-01BWJTdN`) merged and triggered a fresh run to
prove it live. **Checked the actual result rather than accepting "the run finished successfully" — it did
not fix anything.**

The post-merge run (`ingestion_tracker` row `84e215c3…`, started 2026-09-14 13:35:03 UTC, genuinely after
the merge) ran for **17.98 hours** — longer than any pre-fix cycle (13.6h/14.9h) — and its `run_log`
summary reads the **identical** `"Failed steps: hcris_cost_reports, hcris_propagation, run_timeout"`
signature as before. `facility_cost_reports` remains frozen at 2026-03-16 (now 183 days), zero writes in
the trailing 24 hours. Not a smaller regression — the run took longer and produced the exact same failure,
the opposite of what a working fix should do.

**Two live hypotheses, not yet determined**: either the Railway redeploy never actually picked up the
merged commit (checking the deployed commit SHA against the merge SHA is the first thing the follow-up
prompt asks for, before any further code diagnosis), or the fix as coded has a residual bug that didn't
show up in the test suite. `PLANNED-BACKLOG.md`'s `HCRIS-TIMEOUT` row reopened to 🔴 with the live evidence
recorded plainly, not closed as done. New prompt drafted:
`docs/claude-code/prompts/HCRIS-TIMEOUT-2-fix-did-not-resolve-symptom-first-check-if-the-merged-commit-is-actually-deployed.md`
— deliberately ordered to confirm deployment before re-diagnosing code that may not even be running.




## 2026-09-15 — XB1/XB2 live, and the build brief is already running itself (Cowork)

**The third of Scott's three original P18 asks is now live.** PR #2456 merged;
`build_brief_snapshots` holds 2 rows — and snapshot 2 carries `commit_sha 3f391fb1`, generated
**11:42 UTC by the GitHub Action on the merge itself**, not by a human. The collector looks without
being asked, which was the whole point.
✅ **The rule refinement holds structurally, not just in prose.** `producer_stall_not_flag_gated` fires
on exactly one subject and stays silent on `p_rss`, because the SQL excludes `^flag \S+ is off$` rather
than trusting a future reader to remember the distinction. The orphan-prompt false positive is fixed too.
⭐ **First genuinely new find: `sidebar_contact_guard` has run 69 times and completed zero times, ever**
(31 runs on 09-14, so still accruing). Every run skips for an *operational* reason. Either it is dead code
on a schedule, or whatever it guards has been unguarded for days. Nobody was watching producer completion
before this. → **SIDEBARGUARD1**
🔴 **Two precision gaps, both the failure XB2 was scoped to avoid → XB2-precision.** (a) The biggest
number is **measured and silent**: `branches.total_remote = 1,722` sits in the payload with no rule
firing on it — the same "recorded but not surfaced" shape as `item_count` before MB2b. And
`branches.unmerged` reads 0 because a CI clone has no local branches, so **local branch debt is
unmeasurable from CI by construction**; only the remote count works there. (b) `market_brief_lane_stale`
emits per lane×section, turning one known gap into **10 of 32 findings (31%)** . ⚠️ **I also claimed it reports on `net_lease`, "a lane MB9 collapsed" — that was wrong and is retracted:
MB9 collapsed `broad_net_lease` INTO `net_lease`, so `net_lease` is the survivor and the view's lanes match
`KNOWN_LANES` exactly.** I read a collapse as a retirement without checking the constant. The aggregation half
stands. A brief where a third of the findings restate one known fact is on
its way to being a brief nobody reads.


## 2026-09-14 — XB1+XB2 shipped: the build-brief collector, live-verified against the hand run (Cowork)

`scripts/build-brief-collector.mjs` (branch debt, orphaned prompts, doc sizes, GENERATED-file
changes) + `public.lcc_build_brief_db_audit()` (flag-long-dark, producer-stall-not-flag-gated,
market-brief lane staleness) write one `build_brief_snapshots` row via
`.github/workflows/build-brief-collector.yml` (push to `main` + nightly), read via
`GET /api/admin?_route=build-brief-latest`. **No dashboard** — `#/exec` is XB3, unbuilt. First live
snapshot **id=1, 32 findings**, reproducing the hand-run's numbers (15 flags off >3wk, 1 producer
stall — `sidebar_contact_guard`, `p_rss` correctly silent). Orphan-prompt false positive fixed
(substring match on leading ID token, recursive across `responses/`). Doc contradictions / dated
re-measure age / flags-no-consumer deliberately deferred (`XB2-followup`) — too fuzzy for v1
without false positives. Guard `test/xb1-xb2-build-brief-collector.test.mjs` (19/19 green), full
suite 6266/0. Detail: `docs/os/PLANNED-BACKLOG.md` XB1/XB2.

---

## 2026-09-14 — CONSOLIDATE3 was never actually shipped, and STATUS had buried its own index (Cowork)

Extracting the test file from the rescued branch `docs/consolidate3-headroom-and-table-fix-2026-09-12`
turned up a **false ✅**: `PLANNED-BACKLOG` has claimed since 2026-09-12 that CONSOLIDATE3 shipped
"budget raised to 3,000 with an 80%-mark soft warning" and a table-placement guard. **`main` had
`LINE_BUDGET = 2500`, no warning, and no guard** — all of it lived only on that unmerged branch. Third
"claimed shipped, actually isn't" of the day, after the undeployed edge function and the unregistered
flag row; precisely the doc-contradiction rule **XB2** is meant to catch without a human looking.
**The guard, once applied, immediately failed against `main` — correctly.** `## Open threads` sat at
line **1,781**, not the first 40. Cause: **this file gave two contradictory instructions.** The
convention block said *"new entries go DIRECTLY BELOW this block"*, while the table's own header said
*"new entries go BELOW the `---`"*. The header won, so every session prepending above the table pushed
it down — **Cowork's own ~8 entries today are the bulk of that drift.**
Fixed: table moved back to the top (now line 25), the convention block rewritten to point at the
table's `---` so the two no longer disagree, and the stale "Line budget: 2,500" text corrected to 3,000
with the 80% warning. Guards: 10/10 green. ⚠️ PRs **#2448** and **#2452** should be **closed unmerged** —
#2448 carries a 2-day-old STATUS snapshot that would overwrite this, and #2452 would revert a
2026-06-20 brand-font fix in the lease-comps template. Both branches stay on origin (BRANCH1).


## 2026-09-14 — N3c decided and shipped: banks/CMBS trustees excluded; full open-decisions list compiled (Cowork)

Scott's call on N3c: banks and CMBS trustees are their own excluded category, same as public bodies
and universities, "for now" -- explicitly revisitable if lender prospecting via Northmarq debt-side
coordination comes up later.

Reviewed existing machinery first: `lcc_owner_name_is_not_prospected` is already the single choke
point excluding public bodies/universities from prospecting, feeding 7 views (Tier 0 lane, seller
prospect universe, loan maturity worklist, etc.). Added `lcc_owner_name_is_bank_or_trustee` and wired
it into that same function rather than building a new mechanism. Sized the regex against live data
before shipping: 11 owner names match today (10 national banks + 1 JPMorgan CMBS trust), 0 false
positives against individual/family trustees (e.g. "Tony Martin, Trustee" correctly stays
prospectable), 0 credit unions swept in (deliberately -- member-owned, can be legitimate
owner-occupant prospects, a different category from a bank/CMBS trustee holding title incidentally).
Verified live: Wells Fargo Bank NA and the JPMorgan CMBS trust are now gone from
`v_lcc_tier0_owner_contact_lane_open`. Migration:
`supabase/migrations/20261102150000_lcc_own_t0_bank_cmbs_trustee_exclusion.sql`.

Also found fcp/tmg's sponsor-domain proposals (the other N3-adjacent open item) have gone stale --
zero live rows in `v_lcc_tier0_sponsor_map_proposals` today, re-checked live. Not re-raising a
decision with no population behind it.

Per Scott's request, compiled every remaining genuine open decision across the whole ownership→contact
chain into one place: `ownership-truth-pipeline-state.md`'s new "Open decisions — needs Scott" section.
Six items: trailing-"The" canonical key (`OWN-T0b/c`), `entities.canonical_name` unique-key enforcement
(`N15c`, blocked by the first), `lcc_finalize_entity_portfolios`'s supersession rule (`OWN-T0g`), 1,475
Salesforce-campaign orphans (`N15`), whether to widen ownership resolution to the remaining 2,241
properties (`T2b`, safe/cheap but low-value -- only 3.7% contactable), and what evidence promotes an
owner out of `unknown` role (doctrine question from `connectivity-and-open-threads.md` §4o). Also added
a "Where we are toward 100%" snapshot table with every load-bearing metric measured this session and
the sessions before it, and an honest read: the mechanisms keep getting fixed (auto-attach now writes,
tombstones cleared, bank/trustee category closed) but the headline 13% owner-to-person linkage number
has barely moved (13.5% now) because the entity-dedup residue upstream is the real blocker.
## 2026-09-14 — Match rate measured: Philadelphia returns ~68%, and it found a two-property owner on the first pass (Cowork)

§7 said download one free file and measure the **match rate**, because coverage is not a hit rate. Done, live,
against Philadelphia's free public open-data endpoint (`phl.carto.com/api/v2/sql`, `opa_properties_public`) — no
scraping, no login, no vendor.

**Pass 1, exact address: 9 of 22 distinct addresses. Pass 2, house-number prefix + street: 6 more. ≈ 68%.**

🔑 **Every pass-1 miss had one cause, and it is trivial:** Philadelphia stores address **ranges**; LCC stores the
lead number. `4126 Walnut St` ↔ `4126-38 WALNUT ST`. `1300 W. Lehigh Ave` ↔ `1300-24 W LEHIGH AVE`.
`1172 S Broad` ↔ `1172-74 S BROAD ST`. That is an **address-normalisation** problem — exactly the lane
`OWNERGAP1-ollama` reserves for a local model — **not** a data-availability one.

**Fifteen real, callable owners came back**, including `UNIV CITY ASSOCIATES` (DaVita 42nd St), `SIX G'S L P`
(DaVita Memphis St), `HASBROOK ASSOCIATES L P` (Fkc Fox Chase), `UMBRIA VENTURES LLC` (Fkc Roxborough) and
`EPISCOPAL HOSPITAL` (Fkc Episcopal).

🚨 **And the first prospecting signal fell out on the first pass, unprompted:** **`FILIPPONE EDWARD J TR`** owns
109 Dickinson St and **`FILIPPONE-NEWMAN LLC`** owns 1172-74 S Broad St — **the same family behind two of Team
Briggs' dialysis properties.** A portfolio seller prospect LCC could not see yesterday, because both properties
read "owner unknown". That is the point of the whole exercise, arriving earlier than expected.

⚠️ **Two honest limits, both recorded rather than smoothed over.** **One jurisdiction is not a rate** —
Philadelphia is a well-run open-data city, so re-measure on a Texas CAD and a Florida county before projecting 68%
onto the 4,021. And **the real hard case is multi-parcel sites**: `3300 Henry Ave` returns **six** owning entities
(the Falls Center LPs) for a single street address; that needs a unit or parcel discriminator, and no amount of
address matching resolves it.

**Next: repeat the identical test on Harris TX (50) and Miami-Dade FL (29)** — two more measurements, still no
build, and the coverage question is then answered with three real rates instead of one projection. Full detail in
the audit doc §8.

## 2026-09-14 — Second county sweep: the question was wrong again, and the free path covers ~20% before we start (Cowork)

Scott ruled out a paid provider and asked whether a local Ollama model could do this. Sampled six more
jurisdictions. **The framing changed a second time, in his favour.**

**The useful question is not *"can we search this county's portal"* but *"does this jurisdiction publish a FREE
BULK FILE that already contains the owner"*** — and several of the largest do:

| jurisdiction | props | owner published? | how |
|---|---:|---|---|
| **Harris, TX** | 50 | **yes** | portal + CSV/XLS/PDF export |
| **Dallas, TX** | 25 | **yes** | owner-name search + COMMERCIAL filter, no CAPTCHA |
| **Miami-Dade, FL** | 29 | **yes** | dedicated **OWNER NAME** search tab |
| **Philadelphia, PA** | 25 | **yes** | address→owner, full grantee/grantor sales history, **+ free bulk dataset download** |
| **NYC (Queens + 4)** | 56 | **yes** | **PLUTO**, free, tax-lot level, **monthly** (26v2, Aug 2026) |
| **Cook, IL** | 73 | gated | CAPTCHA every search — human-only |
| **Los Angeles, CA** | 54 | **no** | not published at all |

Philadelphia's own property page ends *"You can download the property assessment dataset in bulk"*, and its detail
view carries the **grantee/grantor chain** — free. **None of this is scraping.** It is open data, downloaded once
and matched offline.

**Measured coverage of the obvious free-bulk targets: TX 432 + FL 302 + Philadelphia 25 + NYC 56 = 815 of 4,020
(20.3%)** with no portal automation, no CAPTCHAs and no vendor — before checking the other open-data states.

⚠️ **That is COVERAGE, not a hit rate**, and the distinction is the whole risk. A bulk file covering a
jurisdiction does not mean our property matches a row in it — matching is **by address**, and these rows carry
almost no APNs (Cook 0/73, Harris 0/50, LA 1/54). **Measure the match rate on one downloaded file before building
anything.** Philadelphia is the cheapest test: 25 properties, documented bulk download.

🚨 **On Ollama, recorded as `OWNERGAP1-ollama` because Scott asked and the line is sharp.** A local model may
**never** be used to recall an owner. Asked *"who owns 5040 Crenshaw Rd"*, any LLM returns a plausible LLC name —
**exactly the defect we quarantined this week**, since the `ABC`/`XYZ Dialysis Centers` rows came from a `gpt-4o`
call asked to recall a public record. Running that locally makes it free and unlimited, **which is worse, not
better.** ✅ Where it genuinely helps: **matching and normalising text we already fetched** — our address strings
against a downloaded file's (`5040 Crenshaw Rd` ↔ `5040 CRENSHAW RD`, suite noise, abbreviations) and entity names
(`CRENSHAW MOB LLC` ↔ `Crenshaw MOB, L.L.C.`). Transformation of retrieved data, never recall, every output
checkable against its source row. That is the step that turns a free download into matched owners.

**Revised recommendation:** download **one** file (Philadelphia), measure the match rate, and let that number —
not a vendor quote — decide everything downstream. Cook-shaped counties stay manual; LA-shaped are unreachable
from the county at any price, and the vendor conversation can stay deferred indefinitely against a residual that
will be far smaller than 4,021. Appended to the decision doc as §7.

## 2026-09-14 — XB scoped by running the audit by hand first; it found real debt (Cowork)

Two of Scott's three original P18 asks are now live and self-monitoring (market briefs, operator funnel).
**XB — the CDO/CTO build brief — is the third and was never started.** Rather than describe it, ran the
XB2 rules by hand so the prompt carries a measured acceptance target:
**618 local branches** (14 unmerged); **68 flags — 37 on / 29 off, 15 off >3 weeks, 11 off >60 days**,
oldest dark since **2026-05-30**; `sidebar_contact_guard` **31 runs / 31 skipped / 0 completions ever**;
4 of 8 prompts without a matching response; STATUS 2,257 / 2,500 and BACKLOG 1,178 (both guarded).
⭐ **The run produced a rule refinement.** `p_rss` also reads "skipped, never completed" — but its
`skip_reason` is `flag MARKET_BRIEF_PRSS is off`, which is the system working and must stay silent.
`sidebar_contact_guard`'s reason is operational, 31 runs running — a stall wearing a skip's clothes. So
the rule is **not** "no completions" but "skips that are NOT flag-gated, N runs running". Same
dead-vs-silent distinction FEED2 and MB2e each paid for separately; it now has a third instance.
⚠️ The orphan-prompt rule threw a **false positive** (`MB2bc-…` vs `MB2b desktop response.docx`) — the
prompt↔response naming convention is unenforced, so that rule needs a real key before shipping.
Scoped **XB1+XB2 only — no dashboard**: a surface with nothing behind it is exactly how three "looks
live, does nothing" defects happened this week. → `prompts/XB1-XB2-build-brief-collector-and-audit-rules.md`

## 2026-09-14 — County pilot run live: Harris works, Cook is human-only, LA publishes no owner at all (Cowork)

Ran OWNERGAP1's recommended pilot in the browser rather than handing Scott an hour of clicking. It took minutes,
and **it refutes the single-number framing of the question it was meant to answer.**

⚠️ **A constraint the decision doc did not weight:** these properties carry essentially **no APNs** — Cook
**0/73**, Harris **0/50**, LA **1/54** — so every lookup has to work from a **street address alone**. That is what
the pilot actually tested.

**The three counties resolved three different ways:**

| county | props | verdict |
|---|---:|---|
| **Harris, TX** | 50 | ✅ free, address search, **returns the owner**, CSV/XLS/PDF export — looks automatable |
| **Cook, IL** | 73 | ⚠️ free address search exists but **every search is CAPTCHA-gated** — human-only |
| **Los Angeles, CA** | 54 | ⛔ free, no CAPTCHA, **but owner names are not published at all** |

**Harris is a direct hit, and the county draws exactly PDR2's distinction.** `5040 Crenshaw` → three accounts:
`FRESENIUS MEDICAL CARE GREATER SOUTHEAST HOUSTON LLC` and `FUSA MARKETING` as **Personal** property, and
**`CRENSHAW MOB LLC`** (16,915 SF, $1,903,507) as **Commercial** — the real owner, a single-asset LLC, on a
property LCC reports as "owner unknown" today.

**LA is a hard no, established by reading rather than assuming.** Parcel detail for AIN 2350012065 carries situs
address, use code, building characteristics, a 25-row assessment history, and an ownership *events* table with
recording dates, doc numbers and sale prices — **and no owner name anywhere.** Not a scraping difficulty; the
datum is not published.

👤 **What it changes for Scott:** **there is no single "Option A yield."** Behind the 4,021 sit **1,266 distinct
(state, county) combinations**, and the three largest split one-automatable / one-manual / one-impossible. A
national county build would be sized against the worst case while delivering only the Harris-shaped subset.
Revised to three options on **OWNERGAP1-decision**: build for Harris-shaped counties only (**sample 5–10 more
first** — three proves the shapes differ, not how they split); a paid bulk provider, which is the only path that
reaches LA-shaped counties because it does not depend on what a county chooses to publish; or accept "owner
unknown" and rank those properties last — now a measured choice rather than a default.

**The cheapest informative next step is more sampling, not a build** — the same logic that made this pilot worth
running. Appended to `docs/audits/OWNERGAP1_FABRICATED_OWNER_AND_UNRECOVERABLE_GAP_2026-09-14.md` §6 rather than
filed separately, so the decision and its evidence live in one place.

## 2026-09-14 — Tier 0 auto-attach fix VERIFIED live; owner-to-person linkage re-measured at 13.5% (Cowork)

Scoped Stage 4's contact-linkage gap per my own recommendation, starting with review before building.
`tier0-owner-contact-system.md` explicitly flagged an unverified claim: a 2026-09-12 fix to
`TIER0_AUTO_ATTACH` (a call-site arity bug had silently kept it off for 16 straight days) was never
actually confirmed to write anything in production.

Verified it directly against `lcc_tier0_auto_attach_run_log` and `lcc_tier0_confirm_log`: 09-12 06:55
still shows `attached=0` (fix landed mid-day, after that run); **09-13 06:55 shows `attached=9`** -- the
first non-zero `attached` in the log's history, independently confirmed by 9 new `lcc_tier0_confirm_log`
rows with `actor` NULL (system) and `verdict='attach'`, all dated 09-13, none before. 09-14 06:55 shows
`auto_candidates=0`, which is the expected steady state (pool cleared) rather than a regression. The fix
genuinely works.

Re-measured the "13% owner-to-person linkage" headline figure the same way the 08-27 audit did: **13.5%
(1,377 of 10,187)** today vs. 13% (847/6,480) then. Both the linked count and the universe grew (universe
growth is partly the still-open OWN-T0b/c duplicate-entity residue inflating the owner count with
un-merged duplicates) -- the ratio barely moved. Honest read: the mechanism now works, but 9 links/day
against a gap this size won't move the headline number on its own.

Documented both findings in `tier0-owner-contact-system.md` (§2 headline table + §6) and
`ownership-truth-pipeline-state.md` (`[UX-T1a-reach]`).

Did not build anything further this pass -- Stage 4 is a large, 13-audit-round subsystem with several
genuinely open decisions already sitting there for Scott (fcp/tmg sponsor domain confirmation, N3c
bank/trustee scope, N15 Salesforce-campaign orphans, N15c's canonical_name unique-key call), any of
which is a smaller, well-scoped next step than trying to move the 13% number directly. Flagged back to
Scott rather than picking one unilaterally.

Housekeeping: `docs/claude-code/responses/` had OC-v2 and OWNERGAP1 desktop responses queued; left
untouched -- another concurrent session had the shared checkout mid-edit on exactly those topics
(uncommitted changes across api/, docs/audits/, docs/os/, supabase/migrations/, test/) when checked, so
reconciling them was that session's in-flight work, not mine to touch.
## 2026-09-14 — OC-v2 taken live: the operator funnel now triages, routes, and watches itself (Cowork)

**Applied the migration CC could not** (`20261102140000`): flag row registered, `v_operator_notes_stale_open`,
`lcc_check_operator_notes_stale`, crons `lcc-operator-triage` 07:25 UTC and `lcc-operator-notes-stale-check`
07:30 UTC — **both slots verified free against live `cron.job` first**, which the migration's own comment
explicitly asked an operator to do. Confirmed the deployed build carries the fix (`87042eb63878`,
`merge-base` proves it contains PR #2438) before grading anything — merged is not running.
**Re-graded with the model actually invoked: `scanned 3, triaged 3, routed 2, unclassified 0`** (was
1 / 1 / 2). The dialysis bug note that previously failed now grades `bug` / `lane: dialysis` / `medium`
→ `app/briefing` via `onprem_ollama`; the comps idea now carries `lane: government`.
**`OPERATOR_NOTE_TRIAGE` flipped ON** against that evidence — the gate the migration documented. A POST
run wrote the classifications; all three fixtures were then closed through the normal disposition path,
so that path is exercised too. Stale monitor reads 0 open notes, 0 alerts.
⚠️ **Correction to my own earlier diagnosis, which was wrong.** I reported the model as "declining" on the
bug note. CC found the truth: a plain GET **never called Ollama at all** — `model_declined` meant *never
asked*. That is why the fix was a code path, not a prompt. Worth keeping: a verdict string named the
wrong cause, and I repeated it as measurement.
👤 Residual: the meta note graded `bug` (over-classification) with `routed_to: null`. Triaged-but-unrouted
correctly stays `open` and would age into an alert — the monitor working as designed.

## 2026-09-14 — OWNERGAP1 reconciled: containment verified both ways, CC corrected my premise, one residual gap found (Cowork)

PR #2437 merged. Responses and prompt filed to `done/`. **CC's pass was better than the prompt that asked for it,
in four separate ways, and each is worth naming.**

**1. It corrected my premise.** I named `sidebar-pipeline.js` as the producer. It is not — the fabricated names
come from **`Dialysis/src/public_record_ingest.py`'s `gpt-4o` recall call**, in a *different repo*, asking a model
to "extract" `mailing_owner` from a prompt **seeded with the property's own owner and no county fetch**. That is
fabrication **by construction**, the same class as PR1/PR1a/PR1b. Filed honestly as `OWNERGAP1-producer` 🔴 with
read-only access disclosed rather than claimed as fixed.

**2. The fabrication was bigger than I measured.** I found 228 rows in `tax_records`. CC ran the same detector
across every table that can carry a model-sourced owner string and found **221 more in
`entity_registry_records.entity_name`, 12 in `recorded_owners.name`, and 10 in `true_owners.name`** — the last two
being the **curated** tables `properties.recorded_owner_id`/`true_owner_id` point at. A fabricated row there is a
live landmine for any future name-match reconciler, not a staging-table curiosity.

**3. It caught its own near-miss during verification and corrected it in place.** The single `recorded_owners` row
literally named `"Unknown"` **is referenced by 23 real properties today** — a genuine in-use sentinel from some
other producer, not gpt-4o fabrication. Nulling that FK would have been an undisclosed side effect of a migration
about stopping fabrication. It narrowed the properties-link guard to fire only on `fabricated_placeholder`, proved
it with a rolled-back positive **and** negative control, and documented the correction in the migration header.

**4. Its recommendation is the right one, and it is a decision rather than a build.** The concentration analysis
kills the "narrow path" hope I was hoping for: **top-15 counties = 13.7% of the gap, 1,266 distinct
(state, county) combinations, 640 properties with no county at all.** So instead of committing to a county-portal
build or a vendor contract, it proposes a **bounded one-hour manual pilot** on Cook IL / Los Angeles CA /
Harris TX (177 properties) to learn whether Option A's yield is nearer 40% or 5% **before** anyone spends money.

✅ **What I verified independently rather than reading:** `trg_dia_ownergap1_*_guard` is live and **enabled on all
four tables**; **370 rows quarantined** (228 + 142), rows intact, reasons distinct. I re-ran the control myself in
a rolled-back transaction: `XYZ Dialysis Centers LLC` → nulled + `fabricated_placeholder`; `Unknown` → nulled +
`unstated_placeholder`; **and a real owner, `Decarion Family Trust`, passed through untouched.** Both sides hold.

⚠️ **One residual, filed as `OWNERGAP1-payload`:** the guard protects the **column**, not `raw_payload`. A row
whose fabricated name sits only in `raw_payload->>'mailing_owner'` is **not** flagged (probe `PROBE-RB-4`), and the
228 already-quarantined rows **still carry the invented string in their payload** — which is exactly how I found
them. So *"catches every one going forward"* is true of the column and not of the payload. **Not urgent** (no live
consumer reads that key, and leaving a raw source record unedited is arguably correct) — the likely right answer is
to make the quarantine flag readable beside the payload rather than scrub it. Written down so the next reader of
that payload is not misled.

## 2026-09-14 — OWN-T0f reviewed (no action needed), OWN-T0g sized and deferred pending a decision (Cowork)

Continued the OWN-T0 residue after OWN-T0d shipped. Reviewed existing machinery before building, per the
OWN-T0c lesson.

**OWN-T0f (closed, no build)**: the per-row UUID on `county_deed:<uuid>`/`gov_ownership_chain:<uuid>` in
`ownership_source` looked like producer noise in the audit, but reading `lcc_a2_apply_ownership_chains`
showed it is deliberate citation back to the specific source chain-link record. The one live consumer that
groups on it, `v_lcc_property_ownership_reconciled` via `lcc_ownership_evidence_level()`, already
prefix-matches both patterns correctly -- verified live, `evidence_level` grouping has 0 rows in `other`
across all 27,421 rows. Nothing to build; would have been solving an already-solved problem.

**OWN-T0g (sized, not shipped)**: `lcc_finalize_entity_portfolios` is live, `SECURITY DEFINER`, cron-driven,
and runs both domains' portfolio syncs -- a different risk class from OWN-T0d's one-time data cleanup.
Confirmed by reading its body: gov's supersession window is computed only across the current inflight
request's rows, so a property whose owner history is split across sync calls never gets end-dated across
that split; dia has no supersession logic at all. Real, confirmed gap. Did not build a fix -- the correct
repair needs a decision first (should supersession compare against all historical facts, not just the
current payload; is "new current owner supersedes old" even a safe assumption here, given gov/1708 has two
genuinely-current co-owners from OWN-T0d's investigation). Recommend sizing the live blast radius against
the 747 `multi_current_distinct_parties` population before writing anything.

Both findings documented in `PLANNED-BACKLOG.md`'s OWN-T0b/c/d/f/g row and
`docs/architecture/ownership-truth-pipeline-state.md`.

Housekeeping: MB2e desktop response reconciled (already-merged PR #2433, moved to responses/done/).
## 2026-09-14 — OC-v2 shipped: lane detection + GET-never-calls-the-model bug fixed, flag registered, cron scheduled

Root-caused the two triage findings from the measurement pass below. `lane: null` was structural —
`classifyDeterministic` never set `lane`, only `note_type`/`severity`; added `detectLane` (domain
keyword map: dialysis/government/comps/market-brief/buyer-engagement/automation/data-coherence/canon)
and attached it to every deterministic verdict. `triage_source: null` / "model declined" was a
misread — a plain `GET` dry run never called Ollama at all (only `POST` or `?generate=1` did), so the
bug note was never actually offered to the model. Removed that gate (`?skip_model=1` opts out).
Migration `20261102140000` registers `OPERATOR_NOTE_TRIAGE` (still **off** — the row never existed,
so nothing could flip it), schedules `lcc-operator-triage` (07:25 UTC, not flag-gated), and adds a
distinct stale-note monitor (`v_operator_notes_stale_open` / `lcc_check_operator_notes_stale`,
`operator_note_stale_open` alert ≥3d, cron 07:30). **Not applied live** (no DB access this session) —
flag stays off until a live re-grade. `test/operator-notes.test.mjs` + `test/operator-triage-tick.test.mjs`
+ `test/sql-definer-privilege-stanza.test.mjs` all green.
## 2026-09-14 — OWNERGAP1 Unit 1 shipped: reversible SQL-side quarantine on Dialysis_DB; producer is `Dialysis/src/public_record_ingest.py`, not this repo (Cowork)

Followed up on the entry below (the 228 fabricated `ABC`/`XYZ` owner names + 142 `"Unknown"` placeholders in
`tax_records.raw_payload->>'mailing_owner'`). Attached the `Dialysis` repo read-only and traced the real
producer: **not** `sidebar-pipeline.js` as the originating prompt named — that file never writes
`mailing_owner` (grep: zero hits). It is `Dialysis/src/public_record_ingest.py::write_tax_record`, calling
`gpt-4o` with the property's own recorded/true owner in the prompt and no county fetch anywhere in the module
— the same mechanism PR1/PR1a/PR1b already documented on `assessed_value`/`tax_amount`/`tax_delinquent`,
recurring on a field (`mailing_owner`) those rounds never touched. Corrected in place above.

**Contamination is wider than the prompt described** — measured across all four tables the producer touches,
not just `tax_records`: `entity_registry_records.entity_name` carries the same `ABC`/`XYZ` pattern, and
`recorded_owners.name` / `true_owners.name` carry it too (the curated identity tables `properties` FKs
point at). Migration `20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql` (applied live to
Dialysis_DB `zqzrriwuavgrquhisnoa` via three sequential statements — the base migration plus two live
corrections, both folded into the committed file):

- **One detector, `dia_is_fabricated_placeholder_owner(text)`** — case-insensitive `^(XYZ|ABC)\s` plus
  exact (trimmed, case-insensitive) `= 'unknown'`. Never a `contains` rule (P158a) — a real firm like
  `"AZ Business Trust LLC"` or `"Unknown Holdings of Dallas LLC"` must not flag.
- **`dia_ownergap1_fabrication_quarantine`** — append-only log, idempotent (`ON CONFLICT ... WHERE
  restored_at IS NULL DO NOTHING`), records the pre-quarantine value for every flag.
- **`tax_records.mailing_owner`** — the field the investigation named — is NULLED (the field is not an
  identity column; blank is the honest state) + flagged; guard trigger stops future writes the same way.
- **`entity_registry_records`/`recorded_owners`/`true_owners`** — **flag-only, name preserved.** These are
  identity columns other rows FK to; nulling `name` would either FK-violate or silently rename a real party.
  Each has its own `BEFORE INSERT OR UPDATE` guard trigger.
- **The loophole this closes: `properties.recorded_owner_id`/`true_owner_id`.** A property could still point
  at a fabricated-and-flagged owner row even after the row itself is flagged. `trg_dia_ownergap1_property_owner_link_guard`
  nulls the FK on write — **scoped to `fabrication_quarantine_reason = 'fabricated_placeholder'` only, never
  `'unstated_placeholder'`.** ⚠️ That scoping was corrected live, mid-build: the first version tested
  `fabrication_quarantined_at IS NOT NULL` generically, and a live `recorded_owners` row literally named
  `"Unknown"` is referenced by **23 real properties** — the generic guard would have silently severed those
  on the next write to that row. Caught by testing both directions against production before shipping
  (rolled back, no residue), not by reading the code.
- **`dia_ownergap1_restore_quarantine(batch_tag)`** — full reversal, restores `mailing_owner` from the log
  and clears every flag column for a batch.

**Before/after (live, `zqzrriwuavgrquhisnoa`):** `tax_records.mailing_owner` fabricated 228 → **0** (nulled +
logged), `"Unknown"` literal 142 → **0** (nulled + logged, `unstated_placeholder`); `entity_registry_records` /
`recorded_owners` / `true_owners` fabricated names flagged, names preserved. **Confirmed: 0 properties'
`recorded_owner_id`/`true_owner_id` reference a `fabricated_placeholder`-flagged row** (the link guard's
positive control), and **no property owner FIELD was written by any of this** — only flags, nulls on the
non-identity `mailing_owner` field, and reversible FK-nulls on the loophole.

**Unit 2 (re-measurement) — all four of the prompt's own figures reproduced, live, this session**, beside
the originating measurement: 25,331 `mailing_owner` keys / 24,365 null-or-empty (matches exactly); of the
4,021 owner-unknown properties, 3,048 join tax records and exactly 1 has a non-blank `mailing_owner`
(`"Unknown"`, matches exactly); `deed_records` **204** total / 0 overlap (the prompt said 203 — a genuine
+1 landed in the hours between the two measurements, not a methodology disagreement, called out rather than
silently reconciled); 56 of 4,021 carry a `parcel_number`, 0 of those join a `parcel_records.owner_name`
(matches exactly). **No source the prompt missed was found.** The finding stands as written: the 4,021-
property owner gap is not recoverable from any table LCC or Dialysis_DB holds.

**Unit 3 (costed decision doc):** `docs/audits/OWNERGAP1_FABRICATED_OWNER_AND_UNRECOVERABLE_GAP_2026-09-14.md`
— county-recorder path (`handleRecorderPortal` is gov-only; `county_authorities` does not exist on
Dialysis_DB at all — verified via `information_schema`, so the prompt's premise there needed correcting too;
the dia-capable path is the manual `handlePublicRecordsCapture` writeback only) vs a paid bulk vendor
(`Dialysis/src/regrid_client.py` — a complete, unused Regrid Parcels client gated on unset `REGRID_API_KEY`)
vs doing nothing; state/county concentration (top 15 = 549/4,021, 13.7%; 640/4,021 carry no county at all;
1,266 distinct state/county combinations — the population is NOT geographically narrow, so a county-by-county
manual pilot does not obviously beat a national paid feed); recommendation to Scott: a small 3-county pilot
before committing to either paid path, given the population's dispersion.

**Guard:** `test/ownergap1-fabricated-owner-quarantine.test.mjs`, 40 tests — positive control on all 12
known fabricated names + `"Unknown"` variants (case/whitespace), negative control on 10 real names
(`"AZ Business Trust LLC"`, `"X Y Z Dialysis Consulting LLC"` as the deliberately adversarial edge cases),
plus structural assertions against the migration's own source (detector, quarantine table, all four+one
guard triggers, the `fabricated_placeholder`-only scoping on the property-link guard, the restore function,
`NOTIFY pgrst`). Full suite: **6,231 passed / 0 failed / 6 skipped** (pre-existing skips, unrelated).

**No Railway redeploy needed or possible for this change** — nothing in `api/`/JS shipped; the entire fix is
a Dialysis_DB migration (live immediately, per this repo's own "Supabase migration changes are live
immediately" rule) plus a test file and two docs. The actual Python producer fix (stop `gpt-4o` emitting
`ABC`/`XYZ` template-shaped names) is filed as **`OWNERGAP1-producer`**, cross-repo, not shippable from this
session's read-only `Dialysis` access.

## 2026-09-14 — OC-v2 de-risked by measuring triage before sending it (Cowork)

Rather than send OC-v2 blind, forced a triage dry run against the deployed handler
(`tranquil-delight` `cf04ae04ae52`, which reports `skipped: flag_off` / `registry_state: null` honestly
and offers `?force=1`). Filed **two realistic notes** first, because the only queued note was meta
("confirming the funnel accepts notes") and a meta note is a bad test of a classifier.
**Result — `scanned 3, triaged 1, routed 1, unclassified 2, errors 0`:** an unambiguous **dialysis bug
report** naming a route, a lane and a mechanism came back `unclassified`
(`no_deterministic_rule_matched_and_model_declined`); the one success was a comps idea routed
`deterministic`ally but with **`lane: null`**, despite "government deals" and "GSA lease".
**So: only keyword rules fire, they lack market-brief/dialysis vocabulary, lane is never populated, and
the model arm declines** (`triage_source: null` on both misses). ⚠️ **Flipping the flag as-is would route
about one note in three and lose the rest silently** — the funnel would look alive while still dropping
most of what Scott puts in it. MB-a measured Ollama reachable from Railway in the RSS path, so OC-v2 must
check whether the TRIAGE path reaches the model at all: unreachable is a wiring bug, conservative is a
prompt question, and they have different fixes. Both test notes left in the queue as fixtures.

## 2026-09-14 — OWN-T0d shipped: 11 tombstone-duplicate-current properties cleaned up (Cowork)

Continuing the ownership-truth-pipeline work after OWN-T0c's revert, picked up OWN-T0d next (my own
recommendation, approved). Re-measured `v_lcc_property_multi_current` on LCC Opps: `tombstone_duplicate_current`
unchanged at 11 properties from the 2026-09-02 audit (unlike OWN-T0c's population, which had nearly tripled).

Reviewed existing machinery *before* building anything (the lesson from OWN-T0c) and found the fix already
built and deployed: `lcc_repair_tombstone_portfolio_facts(p_dry_run, p_batch)` (P175) on `lcc_entity_portfolio_facts`
-- finds current-fact rows still sitting under a tombstoned (`entities.merged_into_entity_id is not null`)
entity_id where the survivor already holds an equal-or-better current row for the same property, and
dedup-deletes the ghost row (or repoints it if the survivor lacks the property). It explicitly leaves alone
any case where the ghost claims current and the survivor claims ended -- a genuine conflicting claim, not a
duplicate -- for `v_lcc_portfolio_ownership_conflict` to surface separately, so it never over-corrects.

Dry run found **12** ghost fact rows (not 11 properties -- one extra, gov/1708, was bucketed under the
*other* defect class `multi_current_distinct_parties` by the view because it also carries a genuine second
rival owner; the repair function operates at the fact-row level so it caught it anyway). Ran live, batch tag
`own_t0d_2026-09-14`, fully logged to `lcc_p175_portfolio_repair_log` (old-row snapshot per fact) and
reversible via `lcc_unrepair_tombstone_portfolio_facts('own_t0d_2026-09-14')`.

Re-measured after: `tombstone_duplicate_current` **0** (was 11/12). `multi_current_distinct_parties` unchanged
at 747/\$876,981,134, confirming no genuine rival-party conflict was touched. gov/1708 now correctly shows
exactly its 2 real current owners (The Greystone Group vs. the Silverstone Company survivor) with only the
duplicate Silverstone ghost row gone. No migration needed -- the repair function pre-existed; this was a
live-data operation only, documented in `PLANNED-BACKLOG.md`'s OWN-T0b/c/d/f/g row and
`docs/architecture/ownership-truth-pipeline-state.md`.

Housekeeping: checked `docs/claude-code/responses/` -- empty, nothing to reconcile.

Next recommendation: Stage 4's contact-linkage gap (13% owner-to-person linkage), or the smaller
mechanical OWN-T0f (`ownership_source` per-row UUID noise) / OWN-T0g (`lcc_finalize_entity_portfolios`
supersession-window gap) follow-ons. OWN-T0b/c (1,183 `duplicate_entity` merges) stay blocked on the
trailing-"The" human decision from the prior entry.
## 2026-09-14 — MB2e verified live; then found the operator funnel has no consumer (Cowork)

**MB2e confirmed independently.** All **13 feeds now contribute ≥1** — Federal Register (GSA) 6→**4**
after cutoff, Tax Foundation 15→**5** — **zero feeds at zero**, zero open alerts of either kind, and the
11:15 UTC cron genuinely calls **both** monitors (checked the cron command, not the claim). The feed
thread is complete and self-monitoring. No doc entry was needed for the confirmation itself.
**Closed a stale blocker:** `MB2a` still read `⛔ blocked on edge-function deploy` two days after that
deploy landed (v21 → v25 since). Now ✅ — and it is exactly the stale-dated-blocker class **XB2** exists
to catch automatically.
🚨 **The operator funnel accepts notes and nothing processes them.** OC-v's blocker #1 IS resolved —
the standalone MCP redeploy happened, `log_operator_note`/`get_operator_inbox` are live, intake works
end to end. But: `operator_notes` holds **1** note, filed 2026-09-12, still `open` / `note_type=null` /
`routed_to=null`; the **`OPERATOR_NOTE_TRIAGE` registry row does not exist at all** (OC2 shipped the
handler and never registered the flag, so it cannot be turned on); and there is **no triage cron**.
This is worse than not having the funnel — Scott was told it is live, so a note filed there looks
captured, is captured, and is then silently ignored. Same class as a dead feed reporting healthy.
→ **OC-v2** (`prompts/OC-v2-notes-go-in-and-nothing-happens.md`).

## 2026-09-14 — MB2e: two more feeds green + contributing nothing (Federal Register GSA, Tax Foundation)

MB2b's `items_after_cutoff` column found its next two customers on day one. Same class as FEED2
(a fixed window vs. a slower producer cadence, worst on Monday): `maxAgeHours` set 24*7 on both
`government/Federal Register (GSA)` and `tax_policy/Tax Foundation` (measured: newest item 82h/92h
old, 5 items each land inside 7d, 0 inside 72h). Deployed to LCC Opps (v24 → v25), body re-read to
confirm. Forced live: both feeds went from `items_after_cutoff: 0` to **4** and **5** respectively
on the same day's real feed. Monitor half also shipped (migration `20260914130000`):
`v_market_brief_feed_health_no_contribution` + `lcc_check_market_brief_feed_no_contribution` — a
DISTINCT alert_kind from `market_brief_feed_stale`, counting consecutive checks (never calendar
days, FEED2's fix applied from the start) that parsed items but contributed 0; rides the same
11:15 UTC cron. Guard `test/mb2e-feed-cutoff-window.test.mjs`. Full suite green (6,212 tests).
Backlog **MB2e** ✅; canonical lesson filed in `docs/architecture/data-coherence-invariants.md` I11
section (fixed-window-vs-cadence is a class, not a one-off).

## 2026-09-14 🚨 — The tax feed has written 228 fabricated owner names into production, and the owner gap is NOT recoverable (Cowork)

Set out to size the recoverable half of **PDR2-noowner** (the 4,021 dia properties — **34% of the book** — that
render "owner unknown" now that the operator no longer stands in). **Both halves of what I found are worth more
than the sizing was.**

🚨 **1. `tax_records` contains 228 invented owner names, and the producer is still writing them.**
`raw_payload->>'mailing_owner'` holds **12 distinct `ABC`/`XYZ` names** — `XYZ Dialysis Centers Inc./LLC`,
`XYZ Healthcare Trust`, `ABC Properties LLC` and siblings — across **228 rows and 119 counties**, first seen
**2026-05-20**, last **2026-08-24**. **Of the 824 non-placeholder `mailing_owner` values in that table, 228
(28%) are fabricated.** ✅ None are linked to a property, so nothing displays them today — **but they are in the
table ownership answers come from.** A further **142 rows hold the literal `"Unknown"`**, a placeholder written as
though it were a fact (**P180**). This is the *never fabricate* rule failing in the data layer rather than in
prose, which is the harder place to notice it.

⚠️ **CORRECTED 2026-09-14 (OWNERGAP1 containment) — the writer named above was wrong.** `sidebar-pipeline.js`
in *this* repo never writes `mailing_owner` (verified by grep — zero hits). The real producer is
**`src/public_record_ingest.py` in the sibling `Dialysis` repo**, and it is the SAME class already recorded
twice elsewhere in this file: no county HTTP call at all, one call to `gpt-4o` seeded with the property's own
address/owner and asked to "extract" parcel facts — a generator, not a source. See PR1/PR1a/PR1b above; this
is the fourth instance of the identical mechanism, on a field (`mailing_owner`) those rounds did not touch.
Unit 1 (SQL-side containment: detector, reversible quarantine, write-time guard) is now shipped on Dialysis_DB
— see the OWNERGAP1 entry below. The Python producer fix is a separate, cross-repo follow-up
(`OWNERGAP1-producer`, filed, not built here — this session has read-only access to `Dialysis`).

✅ **2. The owner is NOT recoverable from anything we hold — and establishing that is the point.** The tempting
conclusion was *"the data is in the payload, we just never parsed it."* **Tested, and false:**

- **25,331** tax rows carry a `mailing_owner` key; **24,365 are null or empty.** The source returned nothing —
  **not an extraction gap.**
- Of the 4,021 owner-unknown properties, **3,048 join tax records and exactly ONE has a `mailing_owner`** — value
  `"Unknown"`.
- `deed_records`: **203 rows total, zero overlap** with the 4,021.
- Only **56** of the 4,021 carry a `parcel_number`, and **0** join a `parcel_records` row with an `owner_name`.

That is **B4/B5 applied in the direction it is usually skipped** — *"we must acquire the data" is the most
expensive conclusion available, so enumerate every table first.* I enumerated them, and this time the expensive
conclusion is the correct one. Writing it down stops the repo re-asking, and stops someone building a parser for
data that is not there.

**Prompt written:** `prompts/OWNERGAP1-a-third-of-the-book-has-no-owner-and-the-tax-feed-invents-some.md`.
Unit 1 is containment (find where the fabricated values enter — CoStar payload, a fixture, or our own fallback,
**say which** — stop the write, quarantine reversibly, never guess a real owner in their place). Units 2–3 are
measurement whose output is 👤 **a costed decision for Scott** — county-recorder path vs a paid bulk provider vs
accepting "owner unknown" and ranking those properties last — with the 4,021 broken down by state and county,
**because if a few counties hold most of them the cheapest path is narrow, not national.** It explicitly forbids
starting the acquisition build.

⚠️ It also tells CC to re-measure all four of my numbers and to say so loudly if it finds a source I missed —
that would be the most valuable outcome available here.

## 2026-09-14 — PDR2 reconciled: live positive control PASSES on the deployed endpoint; two items promoted out of the closed row (Cowork)

PR #2429 merged and **running** — `/version` = `953b7a00` == `main`, and `api/_shared/true-owner-operator-guard.js`
is on main. Response and prompt filed to `done/`.

✅ **The live positive control the prompt required — run against the DEPLOYED endpoint, not a code trace.** CC
reported *"live trace confirmed against 4 real dia rows — matches the new code's logic exactly"*, which is a trace
of the logic, not a call. Called `get_property_context(property_id=39874, domain='dia')` for real:

```
ownership: { recorded_owner_name: "Living Trust & Gina M Decarion Living Tr",
             true_owner_name: null, true_owner_is_operator: true,
             operator_name: "DaVita Kidney Care" }
```

**And it is independently corroborated inside the same packet:** that property's transaction history shows the
2019-02-01 sale, **buyer *Phil Decarion*, seller *Davita*** — so the Decarion trust genuinely is the owner and
DaVita genuinely is not. The packet now answers the question a net-lease broker actually asks. Before the fix it
named the tenant.

🟠 **Promoted out of the closed row: `PDR2-denorm`.** CC documented a remaining leak **inside the PDR2 row**,
which is now ✅ — **the same "a gap filed inside a closed row disappears" defect caught on `HP1-P2misparse`**, and
worth naming as a recurring pattern rather than a one-off. The leak is real: `entities-handler.js` §1.6 re-queries
**`properties.true_owner_name`**, a **denormalized column `sidebar-pipeline.js` populates unguarded**. Sized live:
populated on **830** properties, **134 of which hold an operator's name**. CC was right not to repoint it inline —
the write path has to be audited first or the dossier silently regresses. Fix the **writer** first.

🔵 **And the honest consequence, filed as `PDR2-noowner`:** with the operator no longer standing in as the owner,
**4,021 dia properties now render "owner unknown"** — operator-flagged `true_owner_id`, no `recorded_owner_id` to
fall back to. That is **34% of the 11,815 dia properties**. The fix did not create this gap; **it stopped a wrong
answer from concealing it.** 👤 This is the actionable half for Scott: a third of the dialysis book is property
LCC cannot tell him who to call about — and that is now visible instead of masked by a confident wrong name.
Sizing the recoverable subset (county deed grantee, tax mailing owner, SOS filings, several already ingested) is
its own measured unit and is plausibly the highest-value BD work left in the backlog.

**Queue:** 6 open prompts — `BR1`, `HCRIS-TIMEOUT`, `HP1-P2misparse-fp`, `ID3b`, `ID3d`, `MB2bc`.
## 2026-09-14 — OWN-T0c: shipped a canonical-key change, found it contradicted a tested contract, reverted fully (Cowork)

Continuing the ownership-connectivity work after ID3b, picked up `OWN-T0c` (417 `duplicate_entity`
conflicts, audit-dated 2026-09-02) as the next entity-dedup slice. Re-measured live first, per
doctrine: population is now **1,183**, not 417 — re-measure again before trusting either number.

Reviewed the existing merge machinery (`lcc_merge_entity` — mature, snapshot-backed, fully
reversible, no extension needed) and traced the audit's named root cause: `lcc_entity_name_tokens`
strips a LEADING "the" but not a TRAILING one, so `"XYZ Company"` and `"XYZ Company, The"` get
different canonical keys and are invisible to each other as duplicates. Measured the fix's real
blast radius before touching anything (43 live entities affected, ~6 that would newly collide)
and shipped it live to LCC Opps (`xengecqvemvfknjvbvrq`): fixed the tokenizer, then ran the
**existing** `lcc_n15c_backfill_canonical_names` (dry-run first, then live) to resync the stored
`entities.canonical_name` column — 25 rows rewritten, 18 correctly held stale by its own guard.

**Then found the contradiction, before updating any doc or committing anything to git**:
`test/entity-canonical-key.test.mjs`, dated 2026-08-27 (a week *before* the OWN-T0c audit), carries
a deliberate SQL-verified corpus that explicitly keeps a trailing "The" as part of the canonical
key — `'Penstar Group, The' → 'penstar group the'`, commented "leading article only; a trailing
'The' is part of the name." Two tested, considered positions disagree on what "the same owner"
means for this exact shape. That is a decision for Scott, not something to resolve unilaterally
mid-build by picking whichever doc I read most recently.

**Reverted fully, live, same session**: `lcc_entity_name_tokens` restored to its original body
(exact function definition, not a patch); all 25 `entities.canonical_name` rows restored to their
logged prior values via `lcc_n15c_canonical_backfill_log` (batch `own_t0c_trailing_the_2026-09-14`
— the fix's own audit log is what made an exact revert possible, not a guess). Parity re-verified:
67,234/67,234 live entities' stored `canonical_name` matches what the function now computes.
`test/entity-canonical-key.test.mjs` re-run green (8/8). No entity was ever merged; only the
canonical-key computation was touched, briefly, and undone before it reached git. `PLANNED-BACKLOG.md`
`OWN-T0b/c/d/f/g` row updated with the re-measured count and this open question, flagged for a
human call rather than closed.

No migration shipped, nothing to redeploy. Docs housekeeping: moved `MB2a`/`MB2b` desktop response
files to `docs/claude-code/responses/done/` — both confirmed already merged (PR #2418, #2426) by
other sessions before I reached them, no new work needed.


## 2026-09-14 — PDR2: closed the operator-as-owner read-path gap in `assemblePropertyPacket` (systemic, 7,937 dia properties)

Re-measured the blast radius live (do not requote the 2026-09-11 figures) — **7,937 dia
properties** resolve `true_owner_id` to a `true_owners` row with `is_operator_not_owner=true`;
**4,022** of those also have `recorded_owner_id IS NULL`, so even a correctly-guarded reader
falling back to `recorded_owner_name` has nothing to fall back to. Top offenders: Fresenius
Medical Care 3,077 · DaVita Inc. 2,625 · DaVita Kidney Care 1,182 · U.S. Renal Care 343 ·
Dialysis Clinic Inc 256 · American Renal Associates 221 — every major operator, not one bad
placeholder row. **gov's `true_owners` has NO `is_operator_not_owner`/`owner_type` column at
all** (confirmed live) — only `owner_role`, and 0 gov properties currently key `owner_role=
'operator'`, so gov's contribution to this defect is 0 today but the guard must not 400 there.

Fix (read-path only, no domain-DB writes): extracted one shared predicate,
`api/_shared/true-owner-operator-guard.js::isTrueOwnerOperator` (ORs `is_operator_not_owner` /
`owner_type='operator'` / `owner_role='operator'`, mirroring the two pre-existing correct copies
in `entities-handler.js` §1.6 and `sf-link-reconcile.js::isOperator()`) plus
`trueOwnerOperatorSelectFields(domain)` so the `true_owners?select=` never asks gov for a column
it doesn't have. `api/operations.js::assemblePropertyPacket`'s ownership block now selects those
signals alongside `name`, and when the true owner is an operator: `ownership.true_owner_name`
stays `null` (never the tenant), `ownership.true_owner_is_operator: true`,
`ownership.operator_name: '<tenant name>'`; `recorded_owner_name` is untouched either way; when
both are null/operator-only the honest answer is "owner unknown" — no backfill from the operator
name. Both `ownership = {...}` initializer sites (domain-linked and no-domain-linkage) carry the
new fields so every packet shape is consistent.

**§3 audit of the other true-owner readers, per the task list:**
- `api/_handlers/entities-handler.js` §1.6 — already correctly guarded (re-queries
  `is_operator_not_owner` itself). **NOT repointed at the packet's verdict** — it also falls back
  to `prop.true_owner_name`/`prop.recorded_owner_name` (denormalized columns on `properties` that
  `sidebar-pipeline.js` populates from `true_owners.name` **unguarded**, line ~10140), so if the
  packet's `true_owner_name` reads null on an operator, that fallback could still surface the
  operator name — repointing needs that write path audited/fixed first (filed, not this unit's
  scope: the denormalized `properties.true_owner_name` column is a separate, real leak worth its
  own prompt).
- `api/admin.js` `harvestResolveOwnersWithoutContacts` (~line 5567, the W9.4 create-contact
  target resolver) — **fixed**. It fetched `true_owners.name` for entities lacking a domain
  contact and fed it to a `create_contact` proposal keyed on `true_owner_id`; an operator-flagged
  true_owner would have let the harvest propose minting a contact under the tenant's
  `true_owner_id`. Now selects the operator signals per-domain and skips any operator-flagged row
  before building the target map.
- `api/_handlers/intake-promoter.js` `resolveOwnerLinksDia` (~2027) and its gov analogue
  (~2198) — **left as-is, different root cause.** These resolve/link `true_owner_id` from a
  deal-extracted `seller_name` via fuzzy match; `result.true_owner.resolved_name` feeds
  `sf_sync_flags` (an SF-match-status telemetry array), not a display of "the owner" to a
  user/agent. The matched party is whatever the OM stated as seller, not a domain-flag lookup —
  a different defect class if the OM itself named the operator, out of scope here.
- `api/operations.js` ~562 (`ownerName` in a Teams "Ownership Research Complete" alert) —
  **left as-is.** Sourced from caller-supplied `entity_fields`/`metadata`, not a `true_owners`
  read; guarding it would need threading the operator flag through the research-closure payload,
  a separate, smaller unit.
- `api/operations.js` `bridgeCreateLead` (~2280–2360) — **already correct**, an input contract:
  the caller passes `true_owner_is_operator` and the function anchors the lead on the recorded
  owner when it's set. No change needed.
- `sidebar-pipeline.js` true-owner lookups — several are WRITERS (create/match `true_owner_id`,
  or denormalize `true_owner_name` onto `properties`), not READERS presenting an owner to a
  human; the one write-path leak found (line ~10140, unguarded denormalization) is noted above,
  filed as a follow-up rather than fixed in this read-path-only unit.

**Live positive control** (Supabase MCP, Dialysis_DB, read-only): traced the new logic by hand
against 4 real rows — `property_id=39874` (Donna, TX; `true_owner=DaVita Kidney Care`,
`is_operator_not_owner=true`, `recorded_owner=Living Trust & Gina M Decarion Living Tr`) →
under the fix: `true_owner_name=null`, `true_owner_is_operator=true`,
`operator_name='DaVita Kidney Care'`, `recorded_owner_name` unchanged. `21924` (Anderson, IN;
Fresenius operator, recorded owner present) → same shape. `21893` (Waipahu, HI; U.S. Renal Care
operator, `recorded_owner_id IS NULL`) → `recorded_owner_name=null`, `true_owner_name=null`,
`operator_name='U.S. Renal Care'` — honest "owner unknown", never backfilled. `21867` (Mobile,
AL; `PMG Leasing, L.L.C.` non-operator control, `is_operator_not_owner=false`) →
`true_owner_name='PMG Leasing, L.L.C.'` unchanged, flag false. All four match the shipped code's
behaviour exactly (encoded as the corresponding test cases).

**Files:** `api/_shared/true-owner-operator-guard.js` (new), `api/operations.js`,
`api/admin.js`, `test/pdr2-operator-owner-guard.test.mjs` (new, 11 tests, all green).
`npm run check:boot` green. `docs/os/PLANNED-BACKLOG.md` PDR2 row updated ✅ shipped.

Not touched, per the task's exclusions: PDR12 (Rock Hill planner), PDR14/14b machinery, the 167
`needs_human` entities, any domain-DB write, any `GENERATED`-headed or canon/surface file.
## 2026-09-14 — MB2b/MB2c/FEED2 landed; the new column immediately found two more silent feeds (Cowork)

**Verified live after CC's PR #2426 (v23 → v24).** `items_after_cutoff` column present, PRSS correctly
**off**, zero open feed alerts, ESRD now contributes (1 of 1) under its `maxAgeHours = 30d`. CC's PRSS
judgment stands and is the right call — the Google News **query** is the blocker, not the plumbing.
🚨 **On its first day the new column exposed two feeds that are green and contribute nothing:**
**Federal Register (GSA)** 6 items → **0 after cutoff**, and **Tax Foundation** 15 → **0**. MB2b set
`maxAgeHours` on ESRD only. Measured both directly: FR GSA newest item **82h** old, Tax Foundation
**92h** — so 0 within 72h, but **5 each within 7 days**. Live consequence: `government` contributes from
ONE feed (FEED1 only half-fixed it) and **`tax_policy` is empty in the daily email** while reading green.
⭐ **This is FEED2's twin.** FEED2 was a monitor counting calendar days against a weekday producer; this
is a cutoff counting calendar hours against feeds that publish a few times a week. A fixed calendar
window aimed at a slower-cadence source is empty by construction on some days, and **Monday is worst —
72h on a Monday excludes everything before Friday morning.** Today is Monday. The 72h default is a NEWS
window and we keep pointing it at non-news sources. → **MB2e** (`maxAgeHours = 7d` on both, then a
distinct `no_contribution` alert arm so the monitor catches this class itself).

## 2026-09-14 — MB2b/MB2c/FEED2: fixed the instrumentation, then judged PRSS off (Claude Code)

**Shipped + deployed + live-verified, all three.** MB2c: `splitGoogleNewsTitle()`'s publisher regex
widened `[^-–—]+`→`.+` (one char) — a hyphenated outlet ("Honolulu Star-Advertiser") used to fail
the whole match, leaving `publisher: null` and the raw suffix stuck on the headline. MB2b: Federal
Register (ESRD) got its own `maxAgeHours` (30d, not the global 72h) plus a new additive
`market_brief_feed_health.items_after_cutoff` column, so "parsed 3, contributed 0" is now a visible
number instead of a green `ok=true` row. FEED2: added the missing test
(`test/feed2-streak-checks-not-days.test.mjs`) over the streak-counting migration's four cases +
structural guards on the SQL. Deployed `briefing-intel-snapshot` v23→v24 to LCC Opps, deployed body
re-read and confirmed byte-identical; migration `20260914120000` applied live. Forced a POST →
confirmed `Honolulu Star-Advertiser` now parses and Federal Register (ESRD) reads
`item_count:1, items_after_cutoff:1` on the real feed.

**Then judged `MARKET_BRIEF_PRSS`, per the task's own instruction — flag stays OFF.** Forced the RSS
tick dry-run against `stream=dialysis` (5 articles, real on-box Ollama): 4/5 "relevant", 4 would-write
facts, **0 of the 4 a broker could cite** — a capital-markets headline restated with no numbers, a
market-research report title, local EMS coverage. The one genuinely on-topic item (a Federal Register
ESRD document) was marked not relevant. Reproduces Cowork's 2026-09-12 finding even with the pipeline
fixed: the defect is the broad Google News query, not the instrumentation. Filed as a follow-up
(tighten to `cap rate`/`clinic`/`acquisition`/`when:7d`, re-measure) rather than guessed at blind.

Full suite: 6,180 pass / 0 fail / 6 skipped.
## 2026-09-14 — `HCRIS-TIMEOUT` response reviewed: both timeout root causes found and fixed, plus an unprompted finding much bigger than scoped — the same silent budget cutoff has likely been dropping several downstream steps for months

`HCRIS-TIMEOUT`'s response (`"HCRIS TIMEOUT surface response.docx"`, saved by Scott) read in full and
transcribed to
`docs/claude-code/responses/done/HCRIS-TIMEOUT-cost-report-ingestion-times-out-every-run-facility-cost-reports-stale-182-days.response.md`.
**Repo: `Dialysis`.** All four catalog items answered with real root causes, not guesses.

**(a) Two distinct bugs, not one.** `hcris_cost_reports`'s download used a bare `requests.get(timeout=300)`
— a single float timeout only bounds each socket read, so a trickling connection never trips it (the exact
bug class this repo already fixed elsewhere via `_safe_get`, just never applied here). `hcris_propagation`
called `save_estimate()` once per CCN with 2–3 sequential round trips each — an unbatched N+1 over the full
national HCRIS population, the same anti-pattern already fixed in `patient_count_ingestor.py` but never
ported to this module.

**(b) Fixed**: bounded connect/read timeouts plus an explicit wall-clock deadline on the download; a new
`save_estimates_batch()` (prefetch + chunked bulk writes, exact business rule preserved, other callers
untouched); sized per-step timeout overrides matching what `medicare_ingestion` already has.

**(c) The unprompted finding — bigger than the prompt scoped.** `run_timeout` isn't a third failed step —
it's the overall 90-minute budget check run before each step; once exceeded, the loop just breaks and
**every remaining step is silently skipped, no exception, no log line**, swept into "Failed steps" so it
reads like an ordinary failure. Since HCRIS sits 9th/10th of 15+ steps, its hang routinely burned the whole
budget — meaning `financial_estimates`, `property_financials`, `trend_detection`, `target_flagging`, and
other downstream steps have likely frequently never run at all, for months, invisibly. Fixed to name every
dropped step, not just the one it happened to be checking.

**(d) Confirmed**: `hcris_cost_report_ingestor.py`'s `.upsert()` is the sole writer of
`facility_cost_reports` anywhere in the repo — this timeout fully explains the 182-day staleness.

Tests: 26 new, full suite 3,262 passed / 9 skipped / 1 xfailed (1 pre-existing unrelated failure disclosed).
**Live re-check performed before filing**: the currently-running cycle predates this fix and is still on old
code — `facility_cost_reports` remains frozen at 2026-03-16 as expected; the next full cycle after this
deploys is the real proof point.

PR opened on branch `claude/hcris-timeout-fix-01BWJTdN` — **merge status unconfirmed**, asked Scott directly.
`PLANNED-BACKLOG.md`'s `HCRIS-TIMEOUT` row updated to 🟡. Prompt moved to `docs/claude-code/prompts/done/`.
Response `.docx` pending archive to `responses/done/` on Scott's machine.

## 2026-09-12 — ID3b shipped: gov owner fuzzy-variant merge (Cowork)

Continued the "ownership connectivity" redirect (Scott: audit property→recorded-owner→developer
chain→true-owner→contact discovery/enrichment across LCC/Outlook/WebEx/Salesforce) by executing
**ID3b**, the highest-leverage concrete step per `docs/architecture/ownership-truth-pipeline-state.md`'s
own finding that entity-dedup fixed once upstream benefits multiple stages at once, and per Scott's
own "THIRD by Scott 2026-09-12" sequencing.

Re-measured live before building (RO2a's numbers were a day old): gov `recorded_owners` fuzzy-variant
population unchanged at 1,380 groups / 2,870 rows; gov `true_owners` at 227 groups / 461 rows (down
from the prior day's 237/483 as other identity work kept chipping at it). Confirmed the existing merge
machinery (`apply_owner_merge`, `apply_true_owner_merge`) needs no extension — both already accept
arbitrary caller-supplied survivor/loser pairs. Confirmed no reusable SQL guard exists for bank/lender
exclusion (`lenderNamePasses` in `sidebar-pipeline.js` was checked and rejected — it deliberately does
NOT exclude banks, wrong model for "bank captured as owner should route to review").

Shipped two new tick functions, `gov_owner_variant_merge_tick(p_dry_run)` and
`gov_true_owner_variant_merge_tick(p_dry_run)`: group by `gov_owner_strict_core` (core ≥4 chars),
survivor = highest-property-count member, guard every group through `gov_owner_name_is_brokerage`,
`is_generic_gov_owner`, and a new bank/lender/lienholder regex — any hit routes the WHOLE group to
`entity_match_candidates`/`gov_owner_merge_review_log`, never auto-merged. Dry-run matched the live run
exactly on both tables.

**Live results:** `recorded_owners` 1,380 groups seen, 1,466 merged, 24 routed to review (22 groups —
hand-checked: correctly caught `CBRE`, four `U.S. Bank National Association` casings, JPMorgan Chase,
TD Bank, Umpqua, SunTrust, World Bank, a title/land-trust company, and three brokerage names —
Colliers, Northmarq, Marcus & Millichap — riding inside one JV description string). `true_owners` 227
groups seen, 232 merged, 2 routed to review (TD Bank / U.S. Bank). **Parity confirmed bit-for-bit**:
`total_properties` (20,509), `properties_with_recorded_owner` (9,327), `properties_with_true_owner`
(9,848) were unchanged before/after both live runs — only unmerged-owner-row counts dropped by exactly
the merged-loser counts. No property silently moved to a different real owner. dia confirmed untouched
(already zero exact AND fuzzy dups, no build needed).

Migration: committed in `government-lease` (`sql/20261013_gov_id3b_owner_variant_merge.sql`) --
the owning repo per ID3a-d, not life-command-center. **Correction, 2026-09-14:** this file was
first committed to life-command-center's now-retired `supabase/migrations/government/` directory
by mistake; PR #2420's CI caught it (`test/gov-migrations-directory-retired.test.mjs` -- the exact
regression guard ID3a-d built for this exact mistake). Moved to `government-lease` where it
belongs; the live database change itself was correct and unaffected throughout. `PLANNED-BACKLOG.md`
ID3b and RO2a rows marked executed with the live numbers. `ownership-truth-pipeline-state.md`
Stage 3 refreshed to note the entity-dedup residue this closes.

No Railway redeploy needed (DB-only, no application consumer changed). Left for a human: the 26
review-lane rows (`gov_owner_merge_review_log`); Stage 3's remaining `OWN-T0b/c/d/f/g` (417
`duplicate_entity` merges) and Stage 4's contact-linkage gaps are the next candidates in this pipeline,
not yet started.
## 2026-09-14 — Prompt-queue audit: two prompts existed in BOTH `prompts/` and `prompts/done/`; PDR2's blast radius is ~2× what it says (Cowork)

Before adding a fourth prompt to Scott's queue, checked whether the queue is accurate — an earlier XB2 pass found
shipped prompts still sitting in `prompts/`, and the failure mode is worse than untidiness: a future chat re-runs
finished work.

**Found and fixed:**
- ⛔ **`PRI4` and `PRI5` were in `prompts/` AND `prompts/done/` — byte-identical (md5 verified).** Both are shipped
  and deployed (PRI5 confirmed by Scott 2026-09-11; PRI4 merged via PR #2293/#2297). A file in two places is worse
  than a stale one: a reader cannot tell which is canonical. Active-queue copies moved to
  `_superseded/prompt-queue-audit-2026-09-14/` with a manifest row — not deleted, and `prompts/done/` keeps the
  canonical copy.
- **`MB2a` was ✅ BUILT with a response already filed, but its prompt was still in the active queue** → `done/`.
  (Its follow-on `MB2a-deploy` stays 🚨 open — a separate row, correctly.)
- Two new prompts arrived from parallel Claude Code work (`HCRIS-TIMEOUT`, `MB2bc`). **Queue is now 7, all
  genuinely open**: `BR1`, `HCRIS-TIMEOUT`, `HP1-P2misparse-fp`, `ID3b`, `ID3d`, `MB2bc`, `PDR2`.

🔴 **And the audit turned up the thing that should be built next — PDR2, whose own headline understates it by
about half.** The prompt says *"~4,026 properties"*; that is the **no-fallback subset**. Re-measured live in
Dialysis_DB: **7,937** properties point `true_owner_id` at an `is_operator_not_owner=true` row, and **4,022** of
those also have `recorded_owner_id IS NULL` — so even the readers that guard correctly have **nothing to fall back
to**. Top offenders: **Fresenius 3,077 · DaVita Inc. 2,625 · DaVita Kidney Care 1,182 · U.S. Renal Care 343 ·
Dialysis Clinic Inc 256 · American Renal 221** — **every major operator, not one bad DaVita placeholder.**

**Why it outranks the rest of the queue:** for a net-lease broker the entire job is identifying and calling the
**owner**. `get_property_context` — the MCP tool and the property packet Scott actually reads — currently answers
*"the owner is DaVita"* when DaVita is the **tenant**. And two other readers in this same repo already guard it
correctly (`assemblePropertyDossier` §1.6, `sf-link-reconcile.js::isOperator()`), so it is a **one-file
inconsistency, not a data problem** — cheap to fix, expensive to leave.

Corrected the figure in the prompt header and on the backlog row rather than leaving a dated number to be quoted
again (*"re-measure a dated blocker before quoting it"*). §1 of the prompt still requires CC to re-measure rather
than inherit even these.

## 2026-09-14 — HP1-P2misparse-fp prompt: the guard blocks real people, and a shape fix cannot repair it (Cowork)

Sized the last 🔴 under HP1 before writing anything, and the sizing changed the shape of the fix.

**Root cause, exact:** `STREET_SUFFIX_RE` at **`api/_shared/tm-misparse.js:42`** matches a street-suffix token at
the **end** of a name. A person whose **surname is a street word** therefore flags as a misparsed address.
**`Brian Lane <blane@northmarq.com>` — a Northmarq colleague, Scott's own firm — fires under *two* reasons**
(`misparse_name` and `person_junk_name`), and every CoStar capture of him has been silently discarded for as long
as the arm has been live. Live sizing: **3 rejections / 2 distinct people**, both person-shaped, both carrying an
email, and **zero** street-suffix blocks in that lane start with a house number.

⛔ **The obvious fix is wrong, and the prompt says so up front.** "Only flag if it doesn't look like *First
Last*" **fails against this file's own fixtures**: `Hinckle Walk` and `Jack Kerouac Aly SE` are real TrafficMetrix
street captures that are **exactly as person-shaped as `Brian Lane`**. Any shape rule admitting one admits the
other. Checking that before drafting is what stopped this being a prompt that shipped a regression.

✅ **The discriminator is the corroborating email local part** — a street capture has no personal mailbox; a real
person has one that matches the name (`blane@` ↔ **B**rian **Lane**). And **the matcher already exists**:
`localPartMatchRule()` (`api/_shared/misparse-disposition.js:150`), shipped by HP1-P2misparse for the fan-out
recovery. Reuse, not a second copy — a second matching shape is the drift that produced `inbox_items.domain`'s
four spellings.

⚠️ **Honest scope, stated in the prompt rather than discovered later:** this rescues Brian Lane. It does **not**
rescue `Jim Street <mgreencre@gmail.com>`, whose generic mailbox corroborates nothing — nothing in the data
distinguishes him from a street capture, so he stays blocked and is filed as a residual. **A fix that rescues one
real person and says so beats one that rescues two and cannot prove the second.**

⚠️ **And a false comment to correct in the same change:** `tm-misparse.js` asserts *"real people must NOT flag —
the never-flag-clean-'First Last' guarantee is preserved."* True for `sentence_fragment`, `doc_label` and
`bare_title`; **false for `street_suffix`**, and the comment does not say so. A comment claiming a guarantee the
code no longer keeps is a defect in its own right.

**Gate is two-sided (Class 11)**, because a guard change can fail in both directions: every one of the 22 fixtures
must still return `street_suffix`, **and** the real people must mint, **and** a name that is *only* a street must
stay blocked even with a corroborating-looking email. If no rule separates them, the prompt says **report and
stop** — a documented open false positive is a legitimate outcome; widening the guard until the fixtures pass by
luck is not.

## 2026-09-14 — HP1-P2f-urgent shipped AND running; HP1 closed out with a topic page (Cowork)

PR #2419 merged. Response and prompt filed to `done/`. **CC's own caveat resolved by measurement, not assumption:**
it closed saying *"this takes effect after the next Railway redeploy."* Checked — `/version` on `tranquil-delight`
reports **`ba22b8abac78`**, which **is** `main`. Merged **and** running. (The repo's own "merged is not running"
rule, applied to the sentence that raised it.)

**Live, today:** Significant **518** · Important **46** · **Urgent 59** · Inbox **92**. Urgent was ≈**1,664**; the
**1,603** `contact_writeback` rows now sit behind a pointer linking to the BD worklist's pre-existing
**"Push to CRM"** chip — a destination this change did not touch, and verified reachable before it. ⚠️ That
population **moves** (1,664 → 1,730 → 1,669 → 1,603 across four reads in a day) — quote it at read time.

📘 **The consolidation Scott has been asking for, made concrete: `docs/architecture/HOMEPAGE-ATTENTION-SURFACE.md`.**
Until now the entire HP1 arc existed only as **17 open backlog rows, ~20 STATUS entries (most already archived),
and a dozen files in `prompts/done/`** — a future chat would have had to reconstruct it from fragments, which is
exactly the misdirection this cleanup exists to prevent. The page is the **one door**: what each of the three
symptoms turned out to be (vs what it looked like), what Today and the Inbox contain now with live numbers, where
the code lives, which guards protect it, and what is still open — with an explicit instruction to re-read the live
rows rather than trust its own list. `PLANNED-BACKLOG.md`'s HP1 section header and `CURRENT-STATE.md` now point at
it, and it states plainly that the **backlog remains the canonical open-work list; the page is the map, not a
second backlog** (a second copy of the open work is how `MB3`×4 happened).

**The five rules the arc produced, now written down in one place** rather than scattered across the entries that
earned them: check the destination before routing anything off a surface · never verify on an HTTP 200 · a monitor
must be producer-keyed, not table-keyed · a detector that has never fired is not a detector · a skipped step must
emit to a counter, not to the broker.

**What HP1 was, in one line:** three symptoms that looked like UI problems and were not — an unhandled abort
killing three lanes at once, a six-week silent write failure hiding under an HTTP 200, and two lanes of machine
output rendered as broker decisions. **What remains under `HP1-` is follow-on work, not the original report.**

## 2026-09-14 — FEED2 held through a real weekend; MB2b/MB2c/FEED2-test bundled and measured (Cowork)

**FEED2 verified in production, not just at apply time.** The health cron has run twice since the fix
(Sun 09-13, Mon 09-14): **zero alerts, max streak 1**, today 13 feeds all returning items. Sunday is
precisely the run the old `9999`-sentinel logic would have turned into **16 false alerts**.
**MB2c measured on the live feed — it is one character.** `([^-–—]+)$` → `(.+)$`; the greedy `(.*)`
already anchors to the last separator. Across **101 real titles** with a separator: old parsed 98, new
parses **101**, **0 previously-correct parses changed**. Fixes `Honolulu Star-Advertiser` and two
`ad-hoc-news.de` items. Regression corpus named in the prompt, since hyphens *before* the separator are
what make a naive rewrite dangerous.
**Sharper MB2b diagnosis, correcting my own earlier note:** the ESRD feed's problem is its narrow
query's low volume, **not** Federal Register — the FR GSA-agency feed on the same service publishes
daily. So: per-feed `maxAgeHours` (default 72), not a blanket "policy feed" exemption, and not a global
widening of the 72h window.
All three bundled into `prompts/MB2bc-fix-the-instrumentation-then-judge-PRSS.md` — they are one theme
(our instrumentation is wrong, not the sources) and together they decide whether PRSS can flip.
## 2026-09-14 — `PRI6` confirmed merged both sides; the "stuck for 2+ days" run turned out to be four run cycles chained back-to-back, all hitting a separate, months-old timeout defect (`HCRIS-TIMEOUT`), not a hang

Scott confirmed `Dialysis` PR `#7409` merged — `PRI6` closed to ✅ in `PLANNED-BACKLOG.md`, both sides now
confirmed.

Scott then reported a CMS ingestion run as running "more than 2 days" and asked whether to keep it going.
**Checked live rather than trusting the log excerpt alone (again a short, healthy-looking snippet) — this
is not one continuous run.** `ingestion_tracker` shows **four separate run cycles chained back-to-back**
since 2026-09-12, each roughly 10–16 hours, a new cycle starting the instant the previous one ends. The
core `cms_medicare_clinics` fetch is correctly a no-op every cycle (already-confirmed benign, near-annual
CMS cadence) — **not the problem**.

**The real, previously-unflagged defect, found by reading `run_log` payloads in full rather than just the
uploaded excerpt**: every recent cycle's summary reads `"Failed steps: hcris_cost_reports, hcris_propagation,
run_timeout"`. This is not new — the identical signature appears in `run_log` going back to **2026-06-25**,
predating this entire `PRI` arc. **Confirmed live**: `facility_cost_reports` (what `hcris_propagation`
presumably writes) hasn't been touched in **182 days**, `max(updated_at)` = 2026-03-16. Each cycle burns
most of its 10–16 hour runtime on this one step (`elapsed_seconds` 48,921s / 53,660s on the two most recent)
before timing out.

**Net read for Scott**: not a hang, genuinely fine to keep running — the currently-active cycle (started
06:03 UTC 9/14) is alive and writing real data elsewhere (`properties.estimated_annual_revenue` updating in
real time, matching "now"). But it will very likely follow the same pattern and time out on the same two
steps again, same as the last several cycles — worth fixing rather than continuing to silently eat most of
every run's wall-clock time. Filed as a new, separate backlog item — `HCRIS-TIMEOUT` — distinct from
`B6d-cms-restart`'s already-fixed 30-day-skip throttle bug and from `PRI6`'s self-reclaim bug; this is a
third, still-open failure mode in the same pipeline.

`PLANNED-BACKLOG.md`'s `PRI6` row closed to ✅; new `HCRIS-TIMEOUT` row filed at 🔴. Prompt drafted:
`docs/claude-code/prompts/HCRIS-TIMEOUT-cost-report-ingestion-times-out-every-run-facility-cost-reports-stale-182-days.md`.


## 2026-09-12 — HP1-P2f-urgent: `contact_writeback` moved off Today's Urgent lane, not hidden (Claude Code)

**Shipped.** Urgent's ranked union (`buildUrgentSection`, `api/_shared/today-sections.js`) no longer
admits `v_lcc_bd_worklist`'s `contact_writeback` rows — CRM plumbing (push an already-resolved contact
to Salesforce), measured at 96% of the lane's HP1-badge population against 66 real `action_items` of
deal correspondence. `owner_source_conflict` and `action_items` are untouched. `getTodaySections`
(`api/operations.js`) drops the signal from `urgentTrueCount`'s sum (now three producers, not four) and
threads the SAME exact `v_lcc_bd_worklist` count probe it already ran into a new `urgent.pointer` field
— `{source_type, count, label, surface}`, `null` (never `0`, P180) on a failed probe — mirroring
HP1-P2a's `inboxHygienePointer`. `app.js::_renderUrgentHygienePointer` renders it as a persistent row
below Urgent's items, linking to `renderBdWorklist('contact_writeback')` — the BD worklist's own
pre-existing "Push to CRM" chip (`ops.js:3785/3803`) and handler (`api/_handlers/contact-writeback.js`),
**neither of which was touched** — the destination was reachable before this change and is reachable
identically after it.

**Live population, re-measured via Supabase MCP at ship time** (`select count(*) from
v_lcc_bd_worklist where signal_type='contact_writeback'`): **1,603** — it moves (1,664 → 1,730 → 1,669
→ 1,603 across four reads inside one day; quoted at read time, never a stale prior figure).

**Gate:** (1) `test/uxt1a-today.test.mjs` proves `contact_writeback` rows never reach `items` or
`total_open` regardless of `rank_value`, that `pointer` carries a distinct true count, `null` when
unsupplied, and a genuine `0` (never conflated with "unknown"); (2) `test/hp1-badge-today-total-open.test.mjs`
proves the handler sums only the three remaining producers into `total_open` (excluding the stubbed
1,598 contact_writeback rows) and passes that same 1,598 through as `pointer.count`; (3) a failed
count-probe path (existing coverage) still renders `null`, never `0`; (4) Significant/Important and
their `total_open` are byte-identical — untouched code paths. Full suite: **6,167 pass / 0 fail / 6
skipped.**

⚠️ **Not yet observed end-to-end on the deployed app.** `main` is protected (branch → PR → CI green →
merge → Railway redeploy); this sandbox has Supabase MCP access (used for the population read above)
but no route to the live Railway app. The DB-side count and the pure-function/handler-test behaviour
are verified; the rendered Today page is confirmed only after the next redeploy.

**Docs:** `PLANNED-BACKLOG.md` (`HP1-P2f-urgent` → ✅), `CURRENT-STATE.md` (new HP1-P2f-urgent row + the
BD-ranking paragraph's stale "filed, not routed off yet" corrected).

## 2026-09-12 — FEED1 landed; reconciling it found the feed monitor itself was broken (Cowork)

**FEED1 verified live.** CC re-fetched every URL itself rather than trusting Cowork's table (its sandbox
has no egress), swapped the three dead feeds, deployed **v22 → v23**, and re-read the deployed body.
Confirmed independently: all three dead URLs are gone from `RSS_FEEDS`, and today's health rows show
`government` on 2 feeds (Federal Register GSA 14 + GovExec 15), `healthcare` 4, `net_lease` 4.
🚨 **Then the monitor turned out to be broken — caught before its cron had ever fired.** Every feed read
`zero_item_streak_days = 9999`, including ones that had just returned 15 items. Two bugs in one
expression: (1) it measured **calendar days**, but `lcc-briefing-intel-snapshot` runs `0 10 * * 1-5`
(weekdays) while the check runs `15 11 * * *` (daily) — so **Monday − Friday = 3** tripped the threshold
on healthy feeds; (2) a **9999 sentinel** stood in for "no history", so the FIRST run alerted on all 16.
Proven by simulation: a feed returning 15 items on EVERY check alerts on run 1 and every Monday. The
monitor blamed feeds for days nobody looked — an **I11 inversion**, now written up in the invariants.
**Fixed and applied live** (`20260912190000`, FEED2): the measure counts **checks, not days**
(`zero_item_streak_checks`). After the fix: 13 healthy feeds **0**, the 3 retired feeds **1**,
`lcc_check_market_brief_feed_health(3)` returns **0 opened / 0 resolved**. Both positive controls pass —
a truly dead feed (3 zero-item checks) alerts, a healthy feed spanning a weekend stays silent. Tomorrow's
11:15 UTC run would otherwise have opened **16 false alerts**.
⚠️ This entry was written twice: the first copy was lost when a parallel session's STATUS archive
rewrote the file while it sat uncommitted in the shared checkout. The rest of the FEED2 work (migration,
backlog rows, invariants note) was swept into that session's commit `ba9da224`.

## 2026-09-12 — HP1-badge + HP1-P2misparse reconciled: both verified live, CC's own corrections held, one new finding (Cowork)

PRs #2414 and #2415 merged. Three responses filed to `done/` (badge, P2misparse, FEED1). **Verified against the
live DB and the shipped code rather than read from the reports** — and this time the verification mostly *confirms*:

**HP1-badge — correct, and built the way the prompt hoped.** `total_open` now comes from `resolveTotalOpen(opts,
all)`: a present `trueTotalOpen` key wins **even carrying `null`** (= "the count probe failed"), and only an
entirely absent key falls back to `all.length` — which is only ever the module's own uncapped unit fixtures. The
counts are **separate, parallel, single-column `limit=1` `count=exact` probes** in the same `Promise.allSettled`
batch as the row fetches, never reattached to the row-fetch request — which is exactly the ~750 ms/request cost
HP1-P0 measured and removed. Both dead ends the prompt named were avoided, and **P180 is honoured**: a failed
probe renders *unknown*, never `0`, never the page length.

**HP1-P2misparse — shipped, and CC's live re-measurement beat the brief.** Measured here: misparse rows
**130 → 25** (CC) / **31 open now** (re-measured hours later — the feed keeps adding), **105 disposed**; the whole
Inbox **196 → 91**, header agreeing. ✅ **CC found things the prompt missed and filed rather than patched:** a real
false positive — **Brian Lane `<blane@northmarq.com>`, a Northmarq colleague**, blocked because the guard treats
"Lane" as street chrome (I confirmed: 5 rows, under **two** different reasons, and a **second** case, `Jim Street`);
class C's root cause is in the **Chrome extension's** `costar.js` person-boundary logic, not the ops-side guard;
and **BR1 does not exist yet**, so class B was left visible with a handoff filed instead of a second firm path
being built. Every one of those is now its own open row.

✅ **CC's own numbers, checked:** it reported 4 recovered fan-out contacts; **3 are on the graph** (Dail Longaker,
Jacob Fahner, William M. Collins) and **James D. Collins is not** — which is precisely what its own
`HP1-P2misparse-jcollins` row already says ("3 already exist, 1 has nowhere to land"). The report's headline was
looser than its filing; the filing was right.

🟠 **One finding that is mine and is NOT covered by `-fanout-legacy`** (that row is about the wrong *email* on a
real person): **12 junk-chrome entities are live on the graph**, minted before the guard existed — `Equity Funds`
**×3 as `entity_type='person'`**, `General Partner` (person + organization), `View Less`, `Demographics`,
`Vice Chair`, `Vice Chairman`, `Executive Vice Chairman`, `Public REIT`, `CoStar Property Contact`. The guard now
**blocks every one of those strings**, so the live blocks and the stored entities disagree about the same name.
Filed as **HP1-P2misparse-junkents**, pairing with `-fanout-legacy` as one reversible identity-cleanup unit —
⚠️ a write to curated identity, so relationships get checked first and the guard's own vocabulary gets reused
rather than a second hand-written list.

✅ **And the gate `HP1-P2f-urgent` was waiting on is now answered with evidence:** unlike `contact_misparse_review`
(zero readers), **`contact_writeback` has a working home** — `api/_handlers/contact-writeback.js`, rendered at
`ops.js:3785` as **"Push to CRM"** with its own chip filter at `ops.js:3803`. Routing it off Today **moves** it
rather than hiding it. Prompt written: `prompts/HP1-P2f-urgent-route-crm-plumbing-off-today.md` — the last
structural piece of HP1, with P2a's pointer gate carried forward and, deliberately, **no target count**.

**Where Today stands:** Significant 516 · Important 46 · Urgent ~1,664 of which **1,598 is CRM plumbing** — so
P2f-urgent is what turns Urgent into the ~66 rows of real deal correspondence.

## FEED1 — three more dead RSS feeds (outside dialysis) replaced + deployed (2026-09-12)

MB2a's `market_brief_feed_health` monitor found three more dead feeds nobody was checking:
`government` (GSA News, 404), `healthcare` (Health Affairs, 410 Gone — retired), `net_lease`
(GlobeSt, 403). Sandbox had zero egress (same policy denial as MB2a); re-verified all six
URLs via `net.http_get` from LCC Opps instead of trusting Cowork's prior fetch — all 200,
counts matched. `RSS_FEEDS` updated, deployed to LCC Opps (`v22 → v23`), deployed body
re-read to confirm, then triggered a live `dry_run=1` and read `market_brief_feed_health`
for today: all six new feeds wrote `ok=true` with real item counts. No `market_brief_feed_stale`
alert had opened for the three dead ones, so nothing to resolve. See `PLANNED-BACKLOG.md` FEED1.

## 2026-09-12 — HP1-P2misparse: the Inbox's 130 misparse rows were success notifications (Inbox 196 → 91)

**Shipped.** `contact_misparse_review` `status='new'` **130 → 25**; the whole Inbox **196 → 91**;
`mv_work_counts.inbox_new` **91** (list and header still agree — HP1-P2a's invariant, held);
`entities` **69,764 → 69,764**, so **not one guard decision moved**. Migrations `20261102120000`
(disposition, reversible via `lcc_hp1p2misparse_disposition_log` batch `hp1p2misparse_20260912`) and
`20261102130000` (`v_lcc_contact_guard_blocks`), both applied live. JS:
`api/_shared/misparse-disposition.js` + `api/_handlers/sidebar-pipeline.js`. Guard
`test/hp1-p2misparse-guard-disposition.test.mjs` (17 tests). Full suite **6,161 pass / 0 fail**.

⚠️ **I had filed this row as "117 rows with no resolution surface — give the lane a review surface."
That was the wrong question and the prompt superseded it.** These were never work awaiting a
decision — they are the contact guard announcing, one Inbox row at a time, that it successfully
blocked something. **B6a over-applied:** a skipped step must emit, but to a counter, not to the
broker's homepage. Re-measured before building: **130 rows, not 117** (still growing), carrying
**307 rejections across only 42 distinct (name, reason) pairs / ~26 properties** — `Equity Funds`
blocked 31×, `View Less` 29×, `Marcus & Millichap` 26×.

Two **notification-only** rules, neither touching mint-vs-block: class-A CoStar page furniture is
counted not notified (**EXACT match, never substring** — P158a: `Demographics Research Group LLC`
must survive); and one notification per **(property, name, reason)**, which alone removed 90 of the
105. Split: `all_chrome` 15 · `chrome_and_duplicate` 39 · `all_duplicate` 51.

**Class D recovered 4 real people with 0 false positives on the live batches** — James D. Collins ←
`jcollins@southpace.com`, William M. Collins ← `william.collins@cushwake.com`, Dail Longaker, Jacob
Fahner. `Paul J. Collins` and `Drew A. Flood` sit on the *same* mailbox and were correctly refused.
⚠️ **3 of the 4 already exist in `entities`**, so the historical recovery is nearly a no-op; only
James D. Collins is absent, and he was **not** hand-minted in SQL (minting is `ensureEntityLink`'s
job — `HP1-P2misparse-jcollins`).

⚠️ **`v_lcc_contact_guard_blocks` reads 0 runs today.** That is the Railway deploy gap — *merged is
not running* — not a quiet guard. **P180: 0 runs means NOT MEASURED.** Re-read it after the deploy
and the next sidebar capture.

**Four things the measurement contradicted, all filed:** the prompt's *"every block measured here is
correct"* is **false** — `Brian Lane` (**`blane@northmarq.com`, our own colleague**) and `Jim Street`
are real people caught by the street-suffix arm (`HP1-P2misparse-fp`, with the free corroboration:
the mailbox's local part names them); the class-C cause is an **extension** vocabulary gap
(`isTitleLine` knows no `chair`/`chairman`/`mgr`), not an ops-guard gap, and is contained — reported,
not fixed, because widening it changes person boundaries (`HP1-P2misparse-titleparse`); **BR1 does
not exist yet**, so class B's ~60 firm rows stay deduped-and-visible rather than getting a second
firm path (`BR1-misparse-handoff`); and the pre-guard fan-out damage is **live in `entities`** —
`Drew A. Flood` and `Paul J. Collins` both carry William Collins's mailbox
(`HP1-P2misparse-fanout-legacy`).
## 2026-09-12 — BACKLOG-ids reconciled: 0 duplicates, guard positive-controlled, and the race behind it now a doctrine (Cowork)

PR #2410 merged. Response and prompt filed to `done/`. **Verified independently rather than read from the report:**
a fresh scan of `PLANNED-BACKLOG.md` finds **0 duplicate IDs across 551 rows**, and I re-ran the new guard's
positive control myself — seeding a duplicate `HP1-badge` row makes `test/backlog-id-uniqueness.test.mjs` fail
(*"PLANNED-BACKLOG.md row IDs are unique"*), restoring the file makes it pass 6/6. It is a real detector, not a
green run.

**CC's pass was better than the prompt that asked for it, and said so.** It re-measured from scratch instead of
inheriting my 26 and found **27** — my parser had missed `COPILOT-OPEN` (its ID carries a trailing
`(was COPILOT-CHAT-OPEN)` annotation) and `ID3e`. **13 collisions renamed** (`SEC1-4`→`SEC9-12`,
`A5d/A5e`→`A5i/A5j`, `D1/D3/D4/D5`→`D1-monitor`/`D3-digest`/`D4-recall`/`D5-dealname`, `R1/R2/R3`→`R1b/R2b/R3b`),
keeping each ID where the citations already pointed — checked, and none needed updating, including
`OPERATOR-ACTIONS.md`'s `SEC2`. **14 restatements collapsed**, ten of which I had not enumerated. ✅ **And it did
the thing the prompt cared most about:** the two `ID3a-d` copies **disagree** on whether `ID3a-d-dia` is closed —
both readings kept with the conflict stated, not silently resolved.

🚨 **The real finding is the race CC hit while fixing it, and it is now a CLAUDE.md doctrine.** Its correct fix
was reintroduced as duplication by a *concurrent* PR adding `MB2a`/`MB3`/`MB4` rows: **git's 3-way merge sees two
pure insertions at different offsets, finds no textual conflict, and keeps both.** Nobody is warned. That is the
same mechanism that broke `STATUS.md`'s line budget twice today (passed locally at 2,465, failed CI at 2,503 after
a merge from `main`). Filed under *"TWO BRANCHES THAT BOTH ADD TO A SHARED DOC MERGE CLEANLY AND SILENTLY
DUPLICATE IT"* with four rules: a shared append-mostly doc needs a **guard, not a convention** (prose failed five
times in one day on a single rule); **a green local run proves nothing about the merge** — re-run the doc guards
after merging `main`, and archive before pushing; **never resolve a doc duplicate by deleting** — classify
collision vs restatement first, and report disagreements; **edit the row, don't restate it** — every one of the 14
restatement groups began as a session appending instead of amending.

Four live doc guards now: `backlog-id-uniqueness`, `backlog-table-shape`, `status-header-integrity`,
`status-line-budget`.

⚠️ **Fixed a stale note of my own**: `HP1-P1a-sec` still warned *"there are TWO rows numbered SEC2"*. There
aren't, as of this PR — rewritten to say the §P9 one is now `SEC10`. A caution that has been resolved is
misdirection with a longer half-life than the defect it described.

## 2026-09-12 — BACKLOG-ids: the 27 duplicate row IDs, measured and repaired (Claude Code)

Executed `docs/claude-code/prompts/BACKLOG-ids-collisions-and-restatements.md`. Re-measured from
scratch rather than trusting the prompt's counts: **27 duplicate IDs**, not 26 — the prompt's own
scan missed `COPILOT-OPEN` (a trailing `(was COPILOT-CHAT-OPEN)` annotation broke a naive regex)
and `ID3e` (paired deliberately with `ID3e (original measurement)`).

**Class A collisions renamed (13), citations checked, none needed updating** (every real external
citation for SEC1-4/A5d/A5e/D1/D3/D4/D5/R1-R3 pointed at the KEPT row; verified via targeted grep
per ID, not assumed):
- `SEC1`/`SEC2`/`SEC3`/`SEC4` — §P0s (security-definer audit / wave0-config-values.txt exposure)
  kept all four; §P9's versions renamed **SEC9/SEC10/SEC11/SEC12**. `docs/os/OPERATOR-ACTIONS.md`'s
  SEC2 citation already pointed at §P0s — no fix needed there. §P0s `SEC2`'s ⏸️ deferral content
  (Scott 2026-09-12) carried across byte-identical, untouched.
- `A5d`/`A5e` — the A5-family block (~line 444, cited by `CURRENT-STATE.md`, the A5 audit doc,
  C1/C2a/C2e) kept both; the isolated pair near N15/N20 (~line 74) renamed **A5i/A5j**.
- `D1`/`D3`/`D4`/`D5` — the P0d data-coherence I-series (cited by `CLAUDE.md` "Campaign P0d / D1–D5")
  kept all four; the P5 "Deal-intelligence spine" series renamed **D1-monitor/D3-digest/
  D4-recall/D5-dealname**.
- `R1`/`R2`/`R3` — the P6 cross-cutting series (cited by `BUILD-BACKLOG.md`, `cross-cutting-design.md`)
  kept all three; the DOC-TABLE1 R1-R14 series (only 1 external cite, a STATUS.md history span)
  renamed **R1b/R2b/R3b**, leaving R4-R14 untouched.

**Class B restatements merged (14), no content dropped** — `AC2`, `AC3`, `B6d-cms-escalation`,
`B6d-cms-restart` (3 copies → 1, chronology from 2026-08-29 through 09-12 folded together),
`B6d-cms-step` (2, includes the "premise refuted" correction), `B6e-fred`, `B6e-fred-cm-exposure`,
`B6e-fred-verify`, `COPILOT-OPEN`, `ID3a-d` (2 — **genuine disagreement found and reported, not
silently picked**: one copy says Scott closed `ID3a-d-dia` by deciding LCC owns Dialysis_DB, the
other still files `ID3a-d-dia` as open pending confirmation — both readings kept, flagged
explicitly in the merged row), `MB3` (4 → 1), `MB4` (4 → 1), `PR1d` (2). In every case the LATEST
occurrence was already a superset of the earlier ones (verified by diff, not assumed), except
`B6d-cms-escalation`/`B6d-cms-step`/`ID3a-d`/`PR1d`/`AC2`/`AC3`/`B6e-fred-verify` where a distinct
earlier fact was folded in explicitly.

**`ID3e` / `ID3e (original measurement)`** — not a true duplicate (the file already disambiguated
these as a shipped-result + preserved-original pairing); renamed the latter's row ID to
**`ID3e-orig`** for mechanical uniqueness only, content untouched.

Row count `docs/os/PLANNED-BACKLOG.md` **1172 → 1154 lines** (18 rows collapsed away; every
collapsed row's distinct facts survive inside its merged sibling — verified by re-reading each
merged row against all its source rows).

**Guard shipped:** `test/backlog-id-uniqueness.test.mjs`, modeled on
`test/status-header-integrity.test.mjs`. Parses only cells at split-position 1 of a `|`-leading
line (never a prose mention elsewhere in a row's body) as a row-defining ID; positive-controlled
both ways (a seeded prose cross-reference does NOT count as a duplicate; a seeded real duplicate
DOES fail, with a message naming the repair procedure). Live-tested against the real file: seeded
a duplicate `SEC9` row, confirmed the test fails with a useful message, reverted, confirmed green.
`DUPLICATE_ALLOWLIST` is empty (every 2026-09-12 duplicate was resolved in this change, not
deferred) but wired with the same by-ID / reason / re-measure-date / stale-entry-fails convention
as `test/retired-identifiers-guard.test.mjs`.

Full suite: **6,140 pass / 0 fail / 6 skipped** (unchanged from before this change — pure
documentation + one new test file).

Closed `BACKLOG-ids` in `docs/os/PLANNED-BACKLOG.md` §P0d (added as a done row, since the item
existed only as the standalone prompt file, not a backlog row).
## 2026-09-12 — FEED1 scoped: five replacement feeds fetched live for the three dead ones (Cowork)

Verified via pg_net, with newest-pubDate recorded per feed because MB2a proved 200-with-items is not the
same as contributing: `government` → Federal Register GSA-agency feed (**200, 14**, newest 09-11);
`healthcare` → STAT News (**200, 20**, 09-12) + Healthcare Dive (**200, 10**, 09-11); `net_lease` →
Connect CRE (**200, 10**) + REBusinessOnline (**200, 20**), both 09-11. Measured and rejected: Modern
Healthcare **403**, The Real Deal **403**. Government Executive re-verified (**200, 23**) — the only
reason that lane is not at zero. **All five publish daily, so all five clear the 72h cutoff as-is**,
which keeps FEED1 a clean URL swap and leaves MB2b out of it. Sharper read on the ESRD feed while here:
its problem is a narrow query returning 3 items spanning weeks, **not** Federal Register — the GSA
agency feed on the same service is high-volume and behaves normally. Prompt carries the deploy step
explicitly (`--project-ref` required; merged is not running).

## 2026-09-12 — MB2a deployed: the dialysis stream is live, and its first run found 3 OTHER dead feeds (Cowork)

Scott deployed `briefing-intel-snapshot` (CLI, `--project-ref xengecqvemvfknjvbvrq`). Verified live via
pg_net dry-run: **`sector_news.dialysis` = 6 items**, where the key did not exist at all before.
🚨 **The monitor's first run found three long-silent dead feeds in OTHER streams**, each confirmed
independently: **GSA News 404**, **Health Affairs 410 Gone**, **GlobeSt 403**. The government lane is
running on ONE feed, net_lease on two of three, healthcare on two of three — and the daily email's
Sector Watch has been quietly built on that. → **FEED1**.
**PRSS stays OFF, now on evidence:** of the 6 dialysis items, **0 are market signal** — local EMS
coverage, a Canadian wildfire item, a $4,100 clinic refund, a PFAS suit, a supplier award, and a DaVita
one-day stock move we already read straight off the DVA ticker. → **MB2b**.
**Federal Register is healthy and contributes nothing:** 3 items parsed, 0 survive the shared **72h
cutoff** — its documents are weeks old by design, which is exactly what the policy section wants. So
`item_count` measures PARSING, not CONTRIBUTION, and a feed can look green while adding zero.
**Publisher parser bug:** the suffix regex forbids hyphens in the outlet name, so
"… - Honolulu Star-Advertiser" yields `publisher=null` AND leaves the suffix in the headline.

## 2026-09-12 — MB2a reconciled live: feeds confirmed, migration applied, and the code is NOT DEPLOYED (Cowork)

**Both replacement feeds re-verified independently** via pg_net (the check CC's sandbox could not run —
zero egress): Federal Register ESRD **200, 3 items**; Google News operator query **200, 100 items**.
**Migration applied live to LCC Opps** — `market_brief_feed_health`, `v_market_brief_feed_health_stale`,
`lcc_check_market_brief_feed_health` (runs clean, 0 opened / 0 resolved), both `market_brief_facts`
citation columns, cron `lcc-market-brief-feed-health` at 11:15 UTC.
🚨 **The blocker is a deploy, not the feeds.** Deployed `briefing-intel-snapshot` is **v21 and has NO
`dialysis` stream at all** — MB-b's three dead URLs were never deployed either, so nothing MB-b or MB2a
wrote to `RSS_FEEDS` has ever run. **This repo has no workflow that deploys edge functions** (checked
`.github/workflows/`), so merging one changes nothing by itself. New **I16** instance; DRIFT1's census
called this function "committed, not in scope" on 2026-09-07 — true then, stale now. → **MB2a-deploy**.
`MARKET_BRIEF_PRSS` stays OFF, correctly: relevance survival cannot be measured until the deploy lands.
Verified separately that CC handled the bucket hazard — `fetchSectorNews()` derives its result keys from
`RSS_FEEDS` in both the initializer and the catch fallback, so a new stream cannot throw.

## 2026-09-12 — MB2a: dead dialysis RSS feeds replaced, feed-health monitor added, PRSS stays off

`RSS_FEEDS.dialysis` now points at Federal Register (ESRD) + Google News (operator query) in place of
the three dead URLs (403/404/404). No third feed added — this sandbox has zero verified egress and a
spoofed UA was refused, per the task. Handled Google News's redirect-URL + broad-noise caveats
(`source_publisher`/`source_url_is_redirect` columns; a title-suffix parser). Shipped
`scripts/verify-rss-feeds.mjs` (opt-in, parses feeds from source so it can't drift) and
`market_brief_feed_health` + `lcc_check_market_brief_feed_health` (I11: alerts on 3+ zero-item days,
auto-resolves on a real item). `MARKET_BRIEF_PRSS` left OFF — no live egress this session to confirm
facts actually flow; Cowork's prior fetch predates this code. Suite 6,130/0/6-skipped. Backlog
`docs/os/PLANNED-BACKLOG.md` §P18 MB2a; spec addendum in `EXEC-BRIEFS-SPEC.md`.

## 2026-09-12 — MB9: collapsed the redundant net-lease lane, redesigned the homepage Market Briefs widget (Cowork)

Scott, after seeing the live Market Briefs tab for the first time (3 screenshots): the homepage widget
looked wrong ("two dialysis briefs" with no government brief), asked for a short-snapshot-then-detail
redesign, and called `net_lease`/`broad_net_lease` redundant — one lane is enough.

**Verified before touching anything:** `select lane, count(*) from market_brief_facts group by lane` and
the same for `market_brief_issues` — both returned only `dialysis` (31 facts, 1 issue). Zero rows existed
under `net_lease` or `broad_net_lease`, so the collapse is a pure schema/UI narrowing, no data migration.

**What "two dialysis briefs, no government brief" actually was:** not a bug — `renderMarketBriefsWidget()`
only ever fetched the `dialysis` lane and printed its top-2 raw fact bullets with no lane label, which reads
like two unrelated blurbs. Government/net-lease show nothing because **no producer has ever written a fact
for them** — MB1/MB2's P-SQL/P-RSS producers are dialysis-only by original scope (spec §3: "no new gov/NL
lanes here"). That gap is real and unscoped — filed as part of MB9 in `PLANNED-BACKLOG.md`, not silently
built here.

**Changed:**
- `api/_shared/market-brief-render.js` — `KNOWN_LANES`/`LANE_LABELS` narrowed to `dialysis`/`government`/`net_lease`.
- `app.js` — new shared `MARKET_BRIEF_LANES`/`MARKET_BRIEF_LANE_LABELS` consts (replacing the old inline
  `laneTabs`/`laneLabels` literals in `renderMarketBriefsPage`, so frontend/backend can't drift again).
  `renderMarketBriefsWidget()` rewritten: one snapshot line per lane with the flag on (`<Lane> — N live
  facts`, the single freshest claim, "Open full brief →"), plus a muted "no live facts yet (producer not
  built)" line for an enabled-but-empty lane instead of silent omission.
- `index.html` — dropped the widget's static "Open Dialysis brief →" header link (now redundant with each
  lane's own link inside the widget body).
- `docs/architecture/EXEC-BRIEFS-SPEC.md` — §0 swimlane row + weekly-email lane count updated to 3.
- New migration `supabase/migrations/20261101200000_lcc_mbb2_lane_collapse_net_lease.sql` — narrows
  `chk_mbf_lane`/`chk_mbi_lane`/`v_market_brief_staleness`'s lane set to 3. **Applied live** to project
  `xengecqvemvfknjvbvrq`, verified via `pg_get_constraintdef`.
- `docs/os/PLANNED-BACKLOG.md` — MB8 marked superseded, new MB9 row, EB0 corrected in place.

**Guards:** new `test/mbb2-lane-collapse.test.mjs` (4 tests, comment-stripped-SQL structural guard
mirroring `eb1-market-brief-foundation.test.mjs`'s own pattern), `test/market-brief-render.test.mjs` +
`test/market-brief-tick-handlers.test.mjs` updated to assert 3 lanes. Targeted suite: 53/53 pass, 0 fail.
**Full 423-file suite not run to completion this session** — the device shell's per-call timeout can't
cover it and a backgrounded run didn't survive between calls; every `KNOWN_LANES`/`broad_net_lease` call
site was grepped repo-wide first and confirmed covered by the targeted tests instead. Stated plainly
rather than claiming a full-suite number I didn't actually observe.

**Not done, deliberately:** no government or net-lease producer built (a real, separate, unscoped decision
— GSA lease-event source for gov, the general-NL on-market store gap shared with BUY0/UX-T4 for net-lease);
`docs/claude-code/prompts/done/EB1-exec-briefs-foundation.md`'s historical 4-lane note left untouched (it
accurately describes what that original migration did, not current state).

## 2026-09-12 🚨 — 26 backlog IDs are used twice, and `SEC2` is two different issues. One of them bit me today. (Cowork)

Two prompts are already queued for CC (**HP1-P2misparse**, **HP1-badge**), so rather than deepen the queue I took
stock of the HP1 block — and found the misdirection Scott has been asking me to remove, partly of my own making.

**`PLANNED-BACKLOG.md` has 26 IDs appearing on more than one row**, and they split into two classes needing
**opposite** fixes:

**Class A — COLLISION, one ID on two unrelated issues.** **`SEC2` is `wave0-config-values.txt` is tracked in git**
(§P0s, line 263) **and** **rotate the Supabase `service_role` key** (§P9, line 624). Same shape on `SEC1`/`SEC3`/
`SEC4`, `A5d`/`A5e`, `D1`. 🚨 **This already misfired: I folded `HP1-P1a-sec` into "the pre-existing SEC2" without
knowing there were two.** The reference is now pinned to §P0s by hand, but it was ambiguous when written, and
anything else citing SEC2 — `OPERATOR-ACTIONS.md` does — still is.

**Class B — RESTATEMENT, the same issue written repeatedly:** `MB3`×4, `MB4`×4, `MB2a`×3, `B6d-cms-restart`×3 and
others, accumulated exactly the way `PR5c-enforce`'s four copies did before today's consolidation — sessions
restating a row instead of editing it.

**Fixed in place now, because all three were provably mine:** three **byte-identical** `HP1-P1a-sec` rows → one;
two `HP1-P1a-fix` rows → the richer (the shorter predated the parallel-session note); and `| HP1-P1b |✅`'s missing
pipe space, which had been hiding the row from ID greps entirely. 28 → 26.

**The remaining 26 are NOT a bulk edit and I did not treat them as one.** A collision that gets "collapsed"
destroys one of two real issues; a restatement that gets "renamed" mints a second ID for one problem. Classifying
each pair is judgment against citation counts. Written up as **`prompts/BACKLOG-ids-collisions-and-restatements.md`**,
which requires: rename collisions (keeping the ID on whichever row more citations already point at, counted not
guessed) with a pointer left on the renamed row so old references still resolve — the never-delete rule applied to
an identifier; collapse restatements keeping **every** distinct fact, and **report rather than silently pick**
where two copies disagree on a number.

✅ **And the durable fix: a CI guard.** A duplicate ID should fail the build, the way
`test/status-header-integrity.test.mjs` now catches a STATUS H1 burial — written today after a prose convention
note failed five times to stop the same mistake. The prompt specifies the two things that guard must get right or
it will be disabled by the first person it annoys: deliberate cross-references are not duplicates, and an
unresolvable duplicate is allowlisted **by ID with a reason and a re-measure date**, with a stale entry itself a
failure.

⚠️ Flagged explicitly in the prompt: §P0s `SEC2` carries Scott's ⏸️ deferral decision and its trigger condition —
**carry it across intact, do not restate it.**

## 2026-09-12 — HP1-badge prompt: the count lies, and fixing it honestly exposes that Urgent is 96% hygiene (Cowork)

REPO1 sweep confirmed in `main` (`docs/flows/README.md` present, root `err.txt` gone). Drafted the next prompt and
re-measured all three Today lanes live first.

**The defect:** `total_open: all.length` (`today-sections.js` 79/103/182) is the **capped page length**, not the
population — while the module header promises *"the full population"* and cites **P159a**. The honest-counts rule
failing inside the module written to enforce it.

| lane | badge | true | |
|---|---|---|---|
| Significant | **200** | **516** | −61% |
| Important | 46 | **46** | ✅ correct — only because it sits under the cap |
| Urgent | **≤200** | **1,664** | −88% |

Ranking is unaffected — `order by` precedes the cap, so the rendered eight really are the top eight. Only the
count lies.

⚠️ **Two dead ends measured, so CC does not walk into either.** Re-enabling `count=exact` is precisely what
**HP1-P0** removed — ~750 ms on the seller view alone, on the endpoint that was 500ing all three lanes; fixing a
badge by reintroducing the outage is not a trade worth making. And `countMode:'estimated'` **cannot work here at
all**: `reltuples` on `v_lcc_seller_prospect_queue` is **-1** — a view, never analyzed — so PostgREST has no
estimate to hand back. The current setting is not a slightly-wrong number; for these lanes it is **no number**.
✅ The answer is likely the pattern HP1-P2a already shipped: `inboxHygienePointer()` — exact probe, `limit=1`,
read off the base table never the capped view, `null` on failure. **P180** made explicit: a failed count renders
*unknown*, never `0`.

🚨 **The part that matters more than the badge.** Fixing the count honestly makes Urgent read **1,664** — and
**1,598 of those (96%) are `contact_writeback`**, CRM plumbing, against just **66** `action_items` of real deal
correspondence. **That is the same class HP1-P2a removed from the Inbox, sitting in the Urgent lane of Today.** The
prompt fixes the count and **files** the population as **HP1-P2f-urgent** rather than folding them together —
leaving the cap in place to keep the number comfortable would be choosing a pretty lie, which is the exact failure
the row exists to correct. And it carries P2a's expensively-learned caution forward: **establish where
`contact_writeback` is actually worked before routing it anywhere** — `contact_misparse_review` had zero readers,
and routing it off would have deleted the only place it was visible.

Prompt also warns about the line-budget trap that cost two PRs today: **archive before you push, 200+ lines of
headroom**, because STATUS.md grows on `main` while a branch is open.

> **📦 ARCHIVE (2026-09-16, fifteenth span):** the next-oldest run of 2026-09-12 entries (the REPO1 repo
> sweep through the CONSOLIDATE2 contradiction) was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail7.md`](../history/STATUS_claude-code_2026-09-12_tail7.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-16, fourteenth span):** the oldest remaining run of 2026-09-12 entries (MB2a through
> the HP1-P1a-fix reconcile) was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail6.md`](../history/STATUS_claude-code_2026-09-12_tail6.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-15, thirteenth span):** a further run of 2026-09-12 entries was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail5.md`](../history/STATUS_claude-code_2026-09-12_tail5.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.
