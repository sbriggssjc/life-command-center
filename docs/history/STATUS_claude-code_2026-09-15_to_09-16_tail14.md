# STATUS archive — Claude Code queue, 2026-09-15 → 2026-09-16 (twenty-second span)

Moved **verbatim** from `docs/claude-code/STATUS.md` on 2026-09-18 (Cowork round 32) to keep that file under
its 3,000-line budget (it stood at 2,760 before this cut). Nothing was reworded or dropped; every still-open
item named here is tracked in `docs/os/PLANNED-BACKLOG.md`. The span covers the 2026-09-15/16 run: C2g
read-through and re-diagnosis, GOVDEED1/GOVDEED2, DEED1 (shipped, reconciled, its migration found in the wrong
repository), Decision #2 and #6 closed, the deed-wins flag decision, OWN-T0g, XB2-counter, the misparse guard,
the parallel-session duplicate, C1C-SPLIT prompted, `docs/architecture/` indexed, DEPLOY2 (reconciled,
-unapplied, -coverage prompted and verified live), Government answered and the third window defect, and the
trailing archive pointers for the thirteenth span and tail13.

---
## 2026-09-15 — C2g read-through: 43 of 111 pairs are SOS-attested, and the blocker is a gate, not a feeder (Cowork)

Scott took my recommendation (the 58-pair read before the beneficial-owner decision). Read all
**111 pairs / 92 orgs** — reconstructed from scratch, 78 stays the tracked number — against gov's
registry fields instead of names: `docs/audits/C2g_58_PAIR_READ_2026-09-15.md`.

⚠️ **Corrects this morning's C2h §7.** "Only 10 of 58 show any sponsor↔SPE link" was a *name* check
presented as the available evidence. It wasn't. **43 of 111: the SPE's SOS-registered manager IS
the Salesforce-linked org or its contact** (`llc_research_source='sos_registry'`, 40 `exact`).
23 wording-variant duplicates (decision #2's lane), 9 gov-internal conflicts, 6 LCC-contradicts-gov,
**2 LCC-resolved-to-the-seller** (`supersession` picked the deed grantor), 1 real sale where the CRM
contact is stale and LCC is right, 8 name-only, **16 "Not on file"**. Nothing written anywhere.

⭐ **The real finding:** `v_lcc_domain_owner_candidates` proposes the domain `true_owner` (weight
5.0, the feeder's highest) **only for assets with no resolved owner**. Once `supersession` placed the
SPE at 0.75, domain truth never entered as evidence — 0 `domain_true_owner` rows on the 92 assets.
R6's "domain truth OUTRANKS name patterns" is implemented as a gap-filler. **Lifting the gate
touches 936 gov + 100 dia resolved assets** — the `supersession-tie-lane-2026-08.md` §4 decision,
re-sized from 63 to 1,036. → **C2k**, 👤 Scott. ⛔ The token-keyed `lcc_ownership_sponsor_family`
cannot hold these (`300 Fifth Avenue LLC` ← Martin Selig has no token) — bulk-writing it would be the
third detector in a confirm table's clothes.

Side-findings, sized not chased: `latest_deed_date='2023-10-01'` on **130** gov properties (a
sentinel read as a date); 2 seller-resolutions worth one query. C2h §8, `connectivity` §4n-b,
tie-lane §6 updated. Archived the sixteenth 2026-09-12 span first (headroom was under 200).

---

## 2026-09-15 — GOVDEED2 shipped; the round refused one of my instructions and was right (Cowork)

**The manufacturing has stopped.** Verified from the live `pg_get_functiondef`: step 1's `bridged` CTE
now carries `AND d.recording_date IS NOT NULL` and `LIMIT p_limit`, matching step 2. Committed to
`government-lease` (PR #400) — **the first time that function has existed in any repository**, having
run twice hourly against production while source-controlled nowhere.

⛔ **The round refused my recommendation #3, and I retract it.** I told it to guard `consideration`
with `_positive_or_none`. It declined, citing `government-lease`'s CLAUDE.md §13d: a **$0 deed price
is a real recorded fact** (quitclaims, intra-sponsor transfers), deliberately unguarded, with a test
that fails if someone "fixes" it. Declining a handoff instruction because it contradicts documented
doctrine in the owning repo is exactly the behavior these prompts should produce. (Stated plainly:
`government-lease` is not connected here, so I could not read §13d directly and am taking the round's
report of it at face value.)

⭐ **But the defect is real — I aimed at the wrong target.** Of the 4,908 dateless rows, **4,854 have
`consideration = 0` and ZERO have `consideration > 0`**; **4,881** have a placeholder grantor. So the
$0 quitclaim §13d protects **does not occur in this population at all** — doctrine and defect were
never in conflict. `consideration = 0` is the **seventh** instance of one signal carrying two meanings:
*a genuine $0 transfer* and *the model had nothing*. → **GOVDEED3** retargets the fix at the accept
gate: reject a payload that is placeholder **as a whole** (no date, no document number, placeholder
grantor), never the value.

⚠️ **Two consequences I want on the record before they are forgotten.** (a) **"No backfill" did not
leave the 3,930 as NULL — it froze them as the manufactured value.** The guard removes those
properties from `bridged` entirely, so the producer can never revisit them: they are not awaiting
correction, nothing will correct them. Still exactly 3,930; the 478 conflicts remain; gov
`auto_fixable` is still 0. → **GOVDEED-478**, which is now the real remaining work. (b) `LIMIT
p_limit` in step 1 truncates *after* an unordered window function and could drop `rn=1` rows — latent
only (729 rows / 178 properties, far under 5,000) and consistent with step 2, but worth a comment.

---


## 2026-09-15 — GOVDEED1: one missing predicate is manufacturing half the gov conflict set (Cowork)

CC found the root cause and localized it correctly. Verified live, with two corrections that both
make it **stronger**, and one connection CC did not draw.

**The producer is running now:** `cron.job` 20, `35,5 * * * *` — twice an hour, not hourly — active,
calling `propagate_deed_to_property(5000)`.

⚠️ **Correction 1.** CC reported "no `recording_date IS NOT NULL` guard." The function contains that
exact predicate, **fifteen lines below the block that needs it**. There are two CTEs both named
`bridged`: step 1 writes `properties.latest_deed_*` with no date guard and no `LIMIT`; step 2 writes
`ownership_history` with both. **The author already knew** — they wrote the guard for one block and
not the other. That makes the fix an internal-consistency repair with the correct predicate already in
the file, not a design decision.

🚨 **The connection CC did not make.** **478 of the 941 government owner-source conflicts (50.8%)
trace to a dateless, document-number-less deed row — 478 of 478, a perfect match.** The missing date
does not merely block the autofix: **more than half the gov owner-conflict population is manufactured**
by this producer. And **4,143 of 4,928** linked dateless deeds have a grantee byte-identical to the
property's own `recorded_owners.name` — 84.1%, meaning the "deed" is an echo of the prompt's own
context, not evidence. Those rows assert that real properties changed hands on no evidence at all.

⛔ **Correction 2 — retracting my own prompt.** GOVDEED1 (which I wrote) claimed the dialysis pipeline
is "a working reference implementation of what the government one is failing at." **Wrong.** dia's
function is a different implementation entirely — and carries the identical unguarded write. Its
2-of-1,774 is a smaller upstream population, not a safer downstream. So the fix must be authored per
database, and dia cannot copy a guard from its own step 2 because dia has no step 2. →
**DEED-DIA-LATENT**.

👤 The fix belongs to **`government-lease`** → **GOVDEED2** handoff written, with no-backfill stated
plainly. ⚠️ The function is **in no repository at all** — running twice hourly, source-controlled
nowhere.
## 2026-09-15 — C2g's sponsor↔SPE explanation checked for precision before proposing anything to write (Cowork)

Follow-on to the same-day C2g reconfirmation (previous entry): before proposing candidate rows for
the `lcc_owner_sponsor_domain`/`lcc_ownership_sponsor_family` confirm surfaces, checked whether the
58 "unrelated name" pairs actually carry a textual sponsor↔SPE signature (shared initials or a
shared significant word) the way C2h's own named examples did. **Only 10 of 58 (17%) do.** The
other 48 — `praveen gupta`→`cary st ssa`, `murray hills`→`ten`, and 46 more — have no discoverable
naming link at all between the Salesforce-linked owner and the resolved title-holder.

**This sharpens, not overturns, the same-day finding**: the resolution mechanism
(`lcc_property_owner` picking the title-holding SPE via `supersession` at a flat 0.75 confidence) is
still structurally correct, not a feeder bug. But calling the *reason* for the name mismatch
"sponsor↔SPE" for the whole 58 was overstated — that held up on C2h's hand-picked examples, not on
the full population. Corrected the same-day doc changes (`C2h_...md` gets a new §7,
`connectivity-and-open-threads.md` and `PLANNED-BACKLOG.md`'s C2g row both re-worded) rather than
letting an overclaim stand.

**Recommendation, not built:** don't bulk-feed the 48 into the confirm surfaces — that repeats the
~25%-precision lexical-detector mistake this repo already paid for (A3/P196). The right-sized next
step is a manual read of 58 rows (one sitting), not new matching machinery. No rows written to
either confirm table.

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

## 2026-09-16 — I duplicated a parallel session, and my version was the wrong one (Cowork)

**Retracting my own work from earlier today.** A parallel Cowork session filed **CANON-OWNERSHIP1** and
**DEED1-reconcile-2** for the same findings I filed as **DIA-OWNERSHIP-CONFLICT** and **DEED1-RELAND**,
hours apart. Both merged. That is precisely the failure this repo's own doctrine names — *two branches
that both add to a shared doc merge cleanly and silently duplicate it* — and I wrote that line.
⚠️ **And my argument was wrong, not just redundant.** I argued from `CLAUDE.md` line 375 that ownership
was already settled. **Scott has since said neither CLAUDE.md line was written by him** — *"Nothing in
either would have been written by me directly. It's all written by Claude"* — so neither carries human
authority and no amount of re-reading them could have settled it. The other session measured the live
database instead: **both repos apply schema to Dialysis_DB today** (`dia_property_redirects` is live from
a migration that exists only in the `Dialysis` repo; three of LCC's five newest `dialysis/` migrations are
also live). "One repo owns each database's objects" was **never true of this database**. That dissolves
the contradiction instead of resolving it, and it is the better finding.
✅ **Nothing lost.** The destination is identical — port the file here, close PR #7412 — and
**DEED1-reconcile-2** tracks it, with a check mine lacked (whether the `Dialysis` repo also carries an
older copy of `v_owner_source_conflict`). My one unique contribution, the **md5 behaviour pin**
(`pg_get_viewdef` = `9fc5aa3f824b125853b3ac8c8a8388f1`/4747, `pg_get_functiondef` =
`72b48cd949db4de5502812920b2e5dd0`/2183, plus the `\m`-escape transcription hazard), was folded into that
prompt before retiring the duplicate to `_superseded/duplicate-prompts-2026-09-16/` with a manifest.
🔭 **The guard gap is real and worth naming:** `backlog-id-uniqueness` catches a repeated ID, not two IDs
describing one finding — and nothing at all catches two prompts for one job. With parallel sessions now
routine, the cheap mitigation is to read the queue and the newest backlog rows before filing, which I did
not do this turn.

---

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

> **📦 ARCHIVE (2026-09-16, twenty-first span):** the 2026-09-15 run from XB1/XB2 live through HCRIS-TIMEOUT-2/-3,
> Harris 86%, XB2-precision, OWN-T0c, the OWNERGAP2 prompt, N15, T2b, the dark flags and XB2-counter was moved
> **verbatim** to [`docs/history/STATUS_claude-code_2026-09-15_tail13.md`](../history/STATUS_claude-code_2026-09-15_tail13.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-16, twentieth span):** the 2026-09-14 XB1+XB2 → county pilot → OC-v2 → OWNERGAP1 → MB2e run
> was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-14_tail12.md`](../history/STATUS_claude-code_2026-09-14_tail12.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-16, nineteenth span):** the 2026-09-14 tax-feed → PDR2 → OWN-T0c → MB2b/MB2c/FEED2 →
> `HCRIS-TIMEOUT` run was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-14_tail11.md`](../history/STATUS_claude-code_2026-09-14_tail11.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-16, eighteenth span):** the ID3b-shipped → 2026-09-14 queue-audit/HP1/FEED2/PRI6 →
> 2026-09-12 HP1-P2f-urgent → BACKLOG-ids run was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_to_09-14_tail10.md`](../history/STATUS_claude-code_2026-09-12_to_09-14_tail10.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-15, seventeenth span):** the FEED1-scoped → MB2a → MB9 run of 2026-09-12 entries
> was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail9.md`](../history/STATUS_claude-code_2026-09-12_tail9.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

> **📦 ARCHIVE (2026-09-15, sixteenth span):** the last two 2026-09-12 entries (the BACKLOG-ids duplicate-ID
> finding and the HP1-badge prompt) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail8.md`](../history/STATUS_claude-code_2026-09-12_tail8.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.

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
