# Claude Code queue — STATUS

<!-- =====================================================================     CONVENTION — READ BEFORE PREPENDING AN ENTRY.
     This file is newest-first. New entries go DIRECTLY BELOW this block, never
     above it. The `# Claude Code queue — STATUS` H1 above must remain line 1.
     This is enforced by test/status-header-integrity.test.mjs — CI fails if the
     H1 moves off line 1 or a second copy appears. Five sessions on 2026-09-12
     buried it (lines 25, 29, 57, 83, 212) before the guard existed.
     Line budget: 2,500 (test/status-line-budget.test.mjs). When you approach it,
     archive BEFORE you push, not when CI fails. ⚠️ This file grows on YOUR
     branch AND on main at the same time, so a branch that passes locally can go
     over the budget the moment main is merged in — it has happened twice
     (PR #2383, and the REPO1 sweep at 2,503). Leave 200+ lines of headroom, and
     keep entries tight: the findings belong in PLANNED-BACKLOG.md, which is the
     canonical open-work list; STATUS.md is the narrative, not a second copy.
     move the OLDEST contiguous span verbatim to docs/history/ and extend the
     archive pointer — never reword or drop an entry to make room.
     ============================================================================ -->

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

## 2026-09-12 — Repo sweep done by the filed method; a duplicate SEC row folded; HP1-P1b's hold lifted (Cowork)

Scott asked again for the repo to be cleaned and consolidated by topic so a future chat picks up without
misdirection. Did the **REPO1-root-clutter** sweep using the method filed earlier today — grep every candidate
first, move only the unreferenced, document the rest — rather than a bulk move.

**Moved (12, all verified unreferenced outside `STATUS.md`/`docs/history`)** → `_superseded/scratch-2026-09-12/`,
with a manifest row in the graveyard README: `err.txt` (0 bytes), `draft1/draft2/draftsave.json`, `harvest.json`,
`twin.json`, `seed-apply/seed-dryrun.json`, `acq-dryrun.json`, `fix-allother-pagination.patch`, `_commit.bat`,
`_deploy_hardening.bat`.

**Deliberately NOT moved — and this is the point of the sweep, not a shortfall.** Three groups are referenced by
name from live docs, code comments or a guard test, so moving them converts accurate references into stale ones,
which is worse than an untidy root. Recorded under `_superseded/README.md`'s own *"left in place — documented
instead"* convention:

- **The 15 `flow-*.json`** — cited in `CLAUDE.md`, `.env.example`, `api/_shared/outlook-draft.js`,
  `api/draft-assist.js` and ~10 docs. **Consolidated by TOPIC in documentation instead: new
  `docs/flows/README.md`** names every flow, what it does, and the write-up to read — find the flow there, open
  the JSON at the root.
- **The ~10 loose `.docx`/`.xlsx`** — cited from `audit/ROUND_2_FINDINGS_2026-05-19.md` and several
  `audit/patches/*/COMMIT_MSG.txt`. Historical; nothing live reads them, and none should be cited as current state.
- 🔐 **`wave0-config-values.txt`** — `test/retired-identifiers-guard.test.mjs` allowlists it **BY PATH**, so a move
  breaks that guard. `ACTIVATE_unit4.sql` likewise (cited in `document-capture-ocr-and-deeds.md`).

⛔ **The sweep caught me duplicating an existing row — exactly the misdirection it was meant to find.** I filed
`HP1-P1a-sec` this morning as a new escalation on discovering the committed `LCC_API_KEY`. **`SEC2` had already
recorded precisely that on 2026-08-28**, with a better remediation order than mine (rotate → update Railway →
`git rm --cached` → *only then* consider history) and a warning I did not have: **do not reach for
`filter-branch`** — this repo nearly lost a 475 MB mailbox that way. My row is now a pointer at SEC2, and the one
fact worth keeping moved onto SEC2: the committed value is **byte-identical to the live Bearer token in the
Salesforce flow**, so it is the live key, and a rotation must update every `flow-*.json` header carrying it in the
same change — a flow left on the old key fails silently under an HTTP 200, which is exactly how HP1-P1a hid a
six-week outage. `OPERATOR-ACTIONS.md` already carries SEC2 as ⏸️ DEFERRED, consistent with Scott's decision today.

✅ **HP1-P1b's hold is lifted — a held row whose condition has cleared is stale documentation.** It said *"build
after the feed is restored and P1d is watching it."* Both happened today. Two stale figures inside it corrected
while there: the feared mass auto-retire **did not happen** (six weeks of drift was 10 stage changes, not the
569+37 the row was written on — re-measure live), and **there is no `deal_next_step` table** —
`lcc_generate_deal_next_steps()` writes into `action_items`. Also cross-linked to **HP1-P1a-orphan**: decide the
`sf_absent` rule first, or P1b will ask Scott to confirm deals Salesforce no longer has.
## 2026-09-12 — REPO1 sweep failed CI on the line budget; archived a fourth span (Cowork)

The REPO1 root sweep could not merge: `test/status-line-budget.test.mjs` went red at **2,503 lines**, 3 over.
**My fault, and worth naming precisely** — the branch passed locally at 2,465, then merging `main` brought in
another 74 lines of STATUS entries and pushed it over. **This file grows on the branch and on `main`
simultaneously, so passing locally proves nothing about what happens at merge.** It is the second time today
(PR #2383 hit the identical thing) and my own entries, which have been long, ate the headroom.

Fixed by the documented procedure, not by raising the budget: the **OWN-T0j URL-length → MB-a reconcile** span of
2026-09-11 (5 entries, 175 lines) moved **verbatim** to
`docs/history/STATUS_claude-code_2026-09-11_ownt0j_urllen_to_mba.md` with an archive pointer left in place.
Nothing reworded or dropped; every still-open item in it is already tracked in `PLANNED-BACKLOG.md`. **2,465 →
2,298 locally**, so ~165 lines of headroom survive the merge.

Added the trap to the file's own convention block so the next session does not rediscover it: **archive before you
push, leave 200+ lines of headroom, and keep entries tight** — findings belong in `PLANNED-BACKLOG.md`, which is
canonical; `STATUS.md` is the narrative, not a second copy of it.

⚠️ **Also, a cleanup note that is mine to own:** three stray `asc-manifest.*.tmp.json` files are sitting in
`test/fixtures/healthcare-discovery/`. The healthcare lane tests write them and unlink them — but this bridge
cannot unlink on Scott's machine (the same EPERM that keeps hitting `.git/index.lock`), so a test run from here
leaves them behind. They are untracked and **must not be committed**; `git add -A` would sweep them in. The
commit commands for this change name explicit paths instead.

## 2026-09-12 — `PRI6` response reviewed: three real defects found (not the two-explanation guess from the prompt), the self-reclaim bug explains months of failed daily runs — cross-referenced with a parallel session's own live re-check

`PRI6`'s response (`"PRI6 surface response.docx"`, saved by Scott) read in full and transcribed to
`docs/claude-code/responses/done/PRI6-ingestion-lock-survives-redeploy-and-reclaim-safety-window.response.md`.
**Repo: `Dialysis`.** Stronger than either Section-0 guess in the prompt — neither "different Railway
service" nor "silently reused stale lock" was quite right; the actual mechanism is a self-reclaim bug.

**(a) No real time cap exists — confirmed, not assumed.** `CMS_ORPHAN_RECLAIM_HOURS` (2h) and
`DEFAULT_STALE_HOURS` (6h) both rested on the same "~90 minutes" observation `PRI5` used, but that budget
is env-tunable for catch-up runs and only blocks *launching* the next step, never preempts one in flight —
exactly what this session's own live check proved by finding a genuinely in-flight run at 17.9+ hours.
Fixed with a new `probe_recent_activity()`: corroborates any reclaim (age-based or `force=True`) against a
real recent write to the dataset's own table before touching the row — age alone is no longer sufficient.

**(b) The actual `acquire_ingestion_lock` behavior, and the real root cause — not a guess.** With `force`
resolving true, it unconditionally marks the existing row `failed` and opens a new one — no age check, no
self-exclusion. The mechanism making `force` true on every call: `ingest_medicare_clinics()` calls
`acquire_ingestion_lock(force=force or force_refresh)`, and the **daily production entry point hard-codes
`force_refresh=True` on every single call** — so every day's run force-reclaims its own just-opened row.
Caught live: three `"Reclaimed by ingestion_lock (force)"` events, including one row reclaiming itself
**0.0 hours** after creation.

**(c) Both root causes fixed, and the two Section-0 hypotheses were both wrong.** This was one continuous
process the whole time (started 2026-09-11 19:45:43 UTC, ~18h runtime) — its own startup self-reclaimed its
own row via the `force_refresh` bug, then kept running unaffected by it. Separately,
`facility_patient_counts`'s lock never closes on success because `release_ingestion_lock(status="success")`
sat in an unreachable `else:` clause after a `return` inside a `try` — confirmed live as a completed no-op
(0 new rows in 18h), not a stall.

**This directly explains a much bigger, previously-unconnected problem.** A parallel documentation session
today (`docs(doc-contra)` commit `2346713e`, merged as PR #2394) independently re-verified `cms_ingestion`
live and found it **failing 34 of 36 runs in the last 30 days**, `last_success_at` frozen at **2026-04-04**
— five months — with `medicare_clinics.source_last_seen` stuck at 2026-08-31 (2.9% refreshed) for 12 days,
and every recent failed row reading `"Reclaimed by ingestion_lock (force) after 0.0h in 'started'"`. That is
this exact bug, hitting the daily production schedule for months, not just this one long run. `PRI6`'s fix
is a materially bigger deal than the prompt framed it as — cross-referenced in `B6d-cms-restart`.

**Live-rechecked this session, unchanged as expected**: the two lock rows this arc has been tracking
(`8c9978b3…` `cms_medicare_clinics`, `3093e28a…` `facility_patient_counts`) are still open at ~19 hours old
— correct and expected, since the fix hasn't reached this already-running process (no redeploy has
happened yet) and nothing in this arc's discipline touches live rows without Scott's own trigger.
`properties.estimated_annual_revenue` still shows real recent writes (992 rows in the trailing 15 minutes at
last check) — the run itself remains healthy, unaffected by any of this.

Tests: 12 new (`test_pri6_lock_reclaim_safety.py`), 8/12 independently confirmed red against pre-fix code
(mutation-style, the other 4 are correctly-green positive controls) — a step further than most rounds in
this arc, which usually report post-fix green only. Full suite: **3,131 passed, 0 failed**.

**PR `sbriggssjc/Dialysis#7409` opened this round** — Scott's "This PR is merged" this round most likely
refers to the `life-command-center` documentation PR that filed this review (same recurring ambiguity as
every prior round in this arc) — **the `Dialysis`-side PR #7409's merge status needs Scott's separate
confirmation before this is treated as deployed.** `PLANNED-BACKLOG.md`'s `PRI6` row updated to 🟡 pending
that. Prompt moved to `docs/claude-code/prompts/done/`. Response `.docx` pending archive to `responses/done/`
on Scott's machine.

## 2026-09-12 — HP1-P2misparse: the 117 Inbox rows are the guard saying "I blocked it", not work (Cowork)

Drafted the next prompt — and the measurement changed what it is. **I filed this row yesterday-ish as *"117 rows
with no resolution surface — build one, or decide they're machine-fixable."* That was the wrong question**, and the
prompt says so in §0 rather than quietly building the better thing.

**What they actually are.** The contact guard blocks a suspect contact and then files an Inbox row announcing the
block. A correct block needs no broker judgment — so this is **B6a over-applied**: a skipped step must emit, but to
a counter, not to Scott's homepage. **117 rows carry 294 rejected contacts across only 42 distinct names and ~26
properties**: `View Less` blocked **23 times**, `Equity Funds` **31**, re-notified on every capture.

**Four classes, four different right answers — they are not one problem:**

| class | examples | n | disposition |
|---|---|---|---|
| **A** CoStar UI chrome | `View Less`, `Demographics`, `Public REIT`, `CoStar Property Contact` | ~100 | block and **say nothing** |
| **B** firms parsed as persons | `Marcus & Millichap`, `Colliers`, `Cushman & Wakefield`, `NAI Columbia` | ~60, most **with real emails** | blocking as a *person* is right, **discarding is not** → **BR1** firm registry |
| **C** job titles in the name slot | `Executive Vice Chairman`, `Vice Chair`, `General Mgr \| CEO` | ~25, with emails | a **parser bug** — report it, don't queue it |
| **D** `email_fanout` | `James D. Collins`, `Edward C. Mann`, `Conrad Buhler` | **86 / 15 names / 4 properties** | see below |

🔑 **The one piece of real value hiding in there.** `email_fanout` fires when the scraper staples **one** broker's
email onto **every** name on the page — `jcollins@southpace.com` landed on 5 names (including the firm itself and a
department); `william.collins@cushwake.com` on 3. Blocking the batch is **correct**, 4 of 5 are misattributions.
But the name matching the email's **local part** is the true owner: **jcollins@ ↔ James D. Collins**,
**william.collins@ ↔ William M. Collins**, **jfahner@ ↔ Jacob Fahner**. That contact is real, correctly paired, and
currently discarded with the collateral. The prompt recovers it mechanically under a strict matching rule, mints
nothing on a tie, and leaves every other name in the batch blocked. Expect **~4–8 people** — small, but they are
brokers on properties we track, and we were throwing them away.

**Deliberately no target count in the prompt.** HP1-P2a taught that lesson today: my §5 set a target of 65 that
contradicted my own §3, and CC was right to report 182 instead of forcing my number. This prompt asks for the
after-count and forbids tuning the rules to hit one.

**What it does not do:** it does not weaken the guard — every block measured here is **correct**; it changes what
gets *announced*. It builds no review surface (§0), mints nothing in A/B/C, and leaves `email_alert` (**P2b**) and
the ranking work (**P2c/P2e**) alone.

Prompt: `prompts/HP1-P2misparse-the-guard-notifies-instead-of-disposing.md`.

## 2026-09-12 — HP1-P2a reconciled: shipped and verified live; my own target number was wrong; one gap promoted out of a closed row (Cowork)

PR #2389 merged. Response and prompt filed to `done/`. **Verified independently against the live DB rather than
read from the report** — every claim holds:

| check | reading |
|---|---|
| `inbox_items` at `status='new'` | **1,061** |
| `v_inbox_triage` at `status='new'` (what the Inbox shows) | **182** |
| `new_contact_qualify` excluded | **879**, and **0 leak** into the view |
| `contact_misparse_review` still visible | **117** |
| destination `v_lcc_contact_qualify_worklist` | **868** live rows |
| `mv_work_counts.inbox_new` (the header) | **182** — agrees with the list |

✅ **The honesty gate held, and in the right shape.** `inboxHygienePointer()` reads the excluded population
**straight off `inbox_items` with `countMode:'exact'` and `limit=1`** — never the view, never a page — and returns
`null` on failure rather than a wrong number. Exactly the P159a-safe construction, inside the change meant to make
the surface honest.

⛔ **My own prompt contradicted itself, and CC was right to ignore the wrong half.** §5 set *"Target: the homepage
Inbox shows 65 items"* while §3 of the same prompt instructed leaving `contact_misparse_review` in place if it had
no resolution surface. It has none. The target was unreachable by construction and **182 is correct**. CC reported
it and stopped rather than bending the filter — precisely what the next sentence of §5 asked for. Corrected in the
prompt file in place before filing it: a prompt that argues with itself teaches the wrong lesson to whoever reads
it next.

🔴 **One real filing defect, found and fixed: a gap was recorded inside a row that then closed.** CC correctly
established that `contact_misparse_review` has **zero readers anywhere in the repo** — written at
`sidebar-pipeline.js:2114`, never read — and correctly left it on the Inbox rather than routing it into
invisibility (P131). But it wrote that finding **into the HP1-P2a row**, which is now ✅ SHIPPED. **A gap filed
inside a closed row is a gap that disappears.** Promoted to its own open row, **HP1-P2misparse** — and it matters:
those 117 rows are **64% of the remaining Inbox (117 of 182)**, the single biggest thing still between Scott and
*"a view of the work that needs the broker's attention."* 117 rows written since 2026-08-10 and never once read is
itself evidence about whether they want a review surface or an automated repair.

⚠️ **Minor, filed as HP1-P2a-count:** three numbers a broker meets in two clicks — pointer **881**
(`status IN (new,triaged)`), exclusion **879** (`new` only), destination **868** (11 junk rows dropped by design).
Each defensible alone; clicking a pointer promising 881 and landing on 868 is an unexplained 13-row gap — the same
*rendered ≠ population* confusion one layer out. Not urgent, not a defect in the exclusion.

🛡️ **The H1 burial is now a CI guard, not a convention.** This file's header was buried a **fifth** time today —
including once *after* the prose convention note was added telling sessions not to. A convention nobody is forced
to read is not a convention. `test/status-header-integrity.test.mjs` now fails the build if the H1 leaves line 1,
if a duplicate appears, or if the convention block goes missing, with the repair procedure in the assertion text.

**Net for Scott:** the Inbox went **1,061 → 182**, the header agrees with the list, and nothing was hidden. The
remaining 182 is 117 misparses (P2misparse) + 20 personal alerts (P2b) + 45 genuine broker items — so **P2b and
P2misparse together are what turn 182 into ~45**, and the ranking work (P2c/P2e) still belongs after them.

## 2026-09-12 — MB-b: first user-facing P18 surface built (Lane Briefs email block + homepage tab); flag OFF, not deployed

Built `docs/claude-code/prompts/MBb-lane-briefs-daily-block-and-tab.md` end to end. §0 producer cleanups:
operator identity (§0.1) was already closed by ID2b-caps-2 before this build started (nothing to do, verified
with a new guard `test/market-brief-operator-canonicalization.test.mjs`); the trades fact's date-suffixed
`fact_key` (§0.2, re-minting a fresh zero-fact every day) is fixed — `TRADES_FACT_KEY = 'trades_trailing_7d'`
is now a single stable key, the tick reads a fixed trailing 7-day window, and it retires any old-format live
fact it finds; a `dialysis` RSS stream (§0.3, Renal & Urology News / Nephrology News & Issues / CMS Newsroom)
was added to `briefing-intel-snapshot`'s `RSS_FEEDS`, **not egress-verified from this sandbox** (no outbound
reach). Built: the daily email's "Lane Briefs" block (`renderMarketBriefLanes`, above Sector Watch, which
stays below it), the homepage `#/briefs/<lane>` tab (`GET /api/market-brief-tab`, new page + route), and
shared selection/diff logic (`api/_shared/market-brief-render.js`) so both read the same live facts. Both
ship behind a new flag `MARKET_BRIEF_RENDER` (registered off). Every number in the rendered block traces to
a fact object, asserted by a dedicated tripwire test. New guards: `test/market-brief-render.test.mjs` (14),
`test/market-brief-lane-briefs-email.test.mjs` (11, incl. diff/gap/omitted-empty-lane), `test/market-brief-
operator-canonicalization.test.mjs` (3), plus additions to the existing MB-a suites. **Full repo suite green:
6,114 pass / 0 fail / 6 skipped** across 962 suites (this session had to `npm ci` first — 0 dependencies were
installed at session start, which produced 28 misleading `ERR_MODULE_NOT_FOUND` failures on the first run;
none were real regressions, confirmed by re-running after install).

**Nothing here is deployed or live-verified** — no Railway/Supabase write access this session. Two new
migrations are committed, unapplied: `20260912120000_lcc_mbb_rss_dialysis_stream_cron.sql` and
`20260912121500_lcc_mbb_market_brief_render_flag.sql`. `MARKET_BRIEF_RENDER` stays off. Operator sequence
(spec §5): apply both migrations, redeploy Railway (both services), run the P-SQL tick once via POST with
the flag forced on and confirm the trades supersede chain clears the old date-suffixed fragments, preview
the email block and load `#/briefs/dialysis`, verify each new RSS feed URL parses, THEN flip
`MARKET_BRIEF_RENDER`. Full detail: `docs/architecture/EXEC-BRIEFS-SPEC.md` §9 "MB-b" addendum;
`docs/os/CURRENT-STATE.md` §2 "MB-b" subsection; `docs/os/PLANNED-BACKLOG.md` §P18 MB1e/MB3/MB4.


## 2026-09-12 — HP1-P2a prompt: 94% of the homepage Inbox is data hygiene, and the destination already exists (Cowork)

With the 500 fixed (P0), the deal backbone fixed and watched (P1a-fix, P1d), this is Scott's **third and last
untouched symptom** — *"data and emails and notices that should be automated and not the top of our inbox's
homepage."*

**Re-measured live before drafting.** `inbox_items WHERE status='new'` = **1,052**:

| source_type | n | broker judgment? |
|---|---|---|
| `new_contact_qualify` | **876** | no |
| `contact_misparse_review` | **111** | no |
| `email_om` / `sidebar_om` / `folder_feed_om` | 33 | **yes** |
| `email_alert` (`domain='personal'`) | 20 | no (P2b) |
| `flagged_email` | 12 | **yes** |

**987 of 1,052 — 93.8% — is hygiene. 65 rows are actual broker work.**

✅ **This is a routing change, not a build, and the prompt says so in the first line.**
`v_lcc_contact_qualify_worklist` already exists as a junk-filtered, value-ranked worklist over exactly these rows
(**865 live**, i.e. 876 minus the 11 it already drops), with `bridgeQualifyContact` per-item and
`bridgeQualifyContactsBulk` for the high-confidence subset. ⚠️ And it is **not a classifier problem**: 13,496 rows
already sit in a non-`new` status — the machine disposes at scale. These 987 are correctly classified and rendered
on the wrong surface.

🚨 **The gate is that excluding ≠ hiding.** The homepage must render a persistent pointer row — *"Data hygiene —
987 items (876 contacts to qualify · 111 misparses) →"* — carrying the **true population**, not a capped page
length. Filtering 987 rows out of view without emitting anything is the B6a skipped-step failure, and a capped
count there would repeat **HP1-badge** inside the very change meant to make the surface honest. The prompt says:
if you cannot render the pointer, do not ship the exclusion.

⚠️ **One real risk flagged, not waved through:** `new_contact_qualify` has a proven surface;
**`contact_misparse_review` (111 rows) may not.** It is written at `sidebar-pipeline.js:2114` — if nothing reads
and resolves it, routing it off the homepage deletes the only place it is visible. The prompt requires verifying
that first, routing only `new_contact_qualify` if not, and filing the gap (P131) rather than building a new
misparse surface in the same turn.

⚠️ **Found in passing, filed not absorbed:** `inbox_items.domain` carries **four spellings for two domains** —
`government` 505 / `gov` 8, `dialysis` 314 / `dia` 1, plus 48+ NULL. A domain-keyed rule strands 57 rows, so the
prompt keys on `source_type` (clean) and files the drift as **HP1-P2-domain**.

**Sequencing recorded on P2c and P2e:** both rank the Inbox, and ranking a list that is 94% noise ranks noise.
They come after this, not beside it.

Prompt: `prompts/HP1-P2a-route-data-hygiene-off-the-homepage-inbox.md`.

## 2026-09-12 — HP1-P1d reconciled: monitor verified independently, my own row arithmetic corrected, two SF ghosts found (Cowork)

PR #2383 merged. Response and prompt filed to `done/`. **CC's work holds up under independent measurement** — re-ran
the gate from this side rather than reading the report:

- `lcc_check_sf_opportunity_freshness(p_stale_hours DEFAULT 3)` **exists live**; cron
  `lcc-sf-opportunity-freshness-check` is **active, hourly at :20**, 1 run, succeeded.
- **Live now → green:** `{stale:false, age_hours:0.2, sf_linked_rows:612, max_last_synced_at:13:30:44Z}`.
- ✅ **The B6a trap test passes — the one that mattered.** In a rolled-back transaction, back-dating every SF-linked
  `last_synced_at` by 30 days **and** writing `now()` to the non-SF rows still returns
  `{stale:true, age_hours:720.2, alerts_opened:1}`. The assertion is genuinely producer-scoped, not table-keyed in
  disguise. CC chose `producer_runs` over a `feed_freshness_registry` row for exactly that reason, and made
  `ingestBatch` write its run row on a **3-arg** `opsQuery` call so the P1a-fix Prefer-mangling class cannot recur.
- CC's disclosed limitation — the historical replay fires on **13 of 16** checkpoints, the 3 misses being windows
  where fresh INSERTs briefly kept a MAX-based predicate clean while UPDATEs were 100% broken — is real and **is
  already written into `PLANNED-BACKLOG.md` and `STATUS.md`**, not left in the response. Checked, because a disclosed
  limitation that lives only in a chat transcript is an undisclosed one.

⚠️ **My own arithmetic was wrong and is corrected in place.** I wrote *"619 rows against the feed's 608 — 11 rows a
second producer mints"* into the prompt, the backlog and CURRENT-STATE. The real split is **612 SF-linked / 7
non-SF**. The 7 are the second producer (all `last_synced_at IS NULL`, `metadata->>'source'='priority_queue'`) — CC
measured this correctly and I did not. P1d's conclusion is unchanged; the number behind it was mine and it was sloppy.

🚨 **The 612-vs-608 gap turned out to be a real finding — filed as HP1-P1a-orphan.** Two rows carry an `sf_opp_id`,
are **still open at `stage='qualified_lead'`**, and the feed **stopped sending them**:

- **`Action Behavior Centers — Duncanville — TX`** (`006Vs00000fQ1nFIAS`), last synced **2026-08-04**. A *second, live*
  Duncanville opportunity correctly moved `loi_executed → in_escrow` on the first good run — so this is a
  **superseded duplicate** stranded at a stage that has been false for five weeks.
- **`Test Property SN 05032024`** (`006Vs00000gT8mnIAC`), last synced **2026-08-20** — a **Salesforce test record**
  sitting in the production deal backbone as an open deal.

**Both render in the Important lane right now.** This is Scott's original *"My Work is well behind where the actual
status of each deal is"* complaint — still live after P1a-fix, because fixing the feed fixes rows the feed *sends*
and says nothing about rows it has **stopped** sending. ⚠️ **Do not just delete them:** on a full-refresh feed,
"absent from the payload" is indistinguishable from "deleted in Salesforce", so the rule comes first (mark
`sf_absent` after N consecutive full payloads — surfaced, never silently dropped), and test records should be excluded
at ingest. 👤 Cheaper first move: confirm in Salesforce whether the Duncanville duplicate and the test record should
simply be deleted there.
## 2026-09-12 — Live-checked the "still running, redeploy interrupted it" run: pipeline is genuinely alive, but `PRI5`'s reclaim mechanism has a real gap this run exposes; `PRI6` drafted

Scott reported the CMS ingestion run as ~10 hours in, interrupted by a `Dialysis` redeploy, and the
resumed run now ~7 hours in on its own — asking whether it's on track. Checked live against Supabase
rather than trusting the uploaded log excerpts (both uploads this round were 19–22 second snippets of the
same healthy repetitive pattern, not proof of overall health on their own — same method used for the prior
"8 hours in" check).

**Good news, confirmed live: the pipeline is genuinely alive and writing right now, not hung.**
`properties.estimated_annual_revenue` shows a newest `updated_at` of essentially "now" (0.4 seconds old at
query time) with **1,923 rows updated in the preceding 15 minutes**. This is real, ongoing, healthy write
throughput — the strongest possible signal against a hang, independent of anything in the log excerpt.

**Also good, confirmed live: `PRI5`'s reclaim mechanism is working.** The exact orphaned `ingestion_tracker`
rows this arc flagged in `PRI4` (`c6975255…`) and `PRI5` (`c817274e…`) are now both closed out
(`run_status='failed'`, `finished_at` populated) — consistent with `reclaim_stale_started_runs()` running
and sweeping them once they crossed the 2-hour safety window.

**A real gap, not previously seen, found by this live check — recommend a `PRI6` prompt:** two
`ingestion_lock` rows (`cms_medicare_clinics` and `facility_patient_counts`) are still open
(`run_status='started'`, `finished_at=null`) at **17.9 hours old** — both acquired at
2026-09-11 19:45:55 UTC, right after the last batch of tracker rows got reclaimed. That is nearly 10× past
the "well past the pipeline's own 90-minute wall-clock cap" assumption `PRI5`'s response used to justify
its 2-hour reclaim safety window, and this run is real evidence that assumption doesn't hold — a run can
legitimately still be in flight at 17.9+ hours. No `ingestion_tracker` or `run_log` row of any kind has
been created since that same timestamp (19:45:55 UTC on 9/11), despite Scott's redeploy — meaning either
(a) the redeploy restarted a different Railway service than the one holding this lock, or (b) the resumed
process reused the pre-existing lock/row instead of re-acquiring it and re-logging, which would itself be
worth knowing. **The arithmetic lines up with Scott's own report**: 10h (first stretch) + 7h+ (post-redeploy
stretch) ≈ 17h, close to the lock's actual 17.9h age — consistent with one continuous lock held since
before the redeploy, never released, rather than two genuinely separate runs.

**Net read for Scott, stated plainly**: the run is not hung and is producing real output right now — no
action needed there. But two back-to-back very-long stretches (10h, then 7h+) on top of a lock that's been
open for 17.9 hours without a fresh tracker/lock/log row is worth a real look, not just individual
reassurance each time it's asked about — both because the reclaim window's safety assumption needs
revisiting given a real run now exceeds it by an order of magnitude, and because it's not yet established
whether a redeploy is supposed to release and re-acquire this lock or not.

`PRI6` prompt drafted: `docs/claude-code/prompts/PRI6-ingestion-lock-survives-redeploy-and-reclaim-safety-window.md`.
No `STATUS`/`PLANNED-BACKLOG` closure yet — pending Scott's read on whether to send this to `Dialysis` now
or let the current run finish first.

## 2026-09-12 — CONSOLIDATE2's first flagged contradiction resolved: the stale "FINAL STATE" box defused (Cowork)

Continuing the doc-consolidation work after CONSOLIDATE2 (round 2) flagged three canonical-doc
contradictions without resolving them. Picked off the first, most directly actionable one:
`docs/architecture/document-capture-and-ocr-status.md` already carried an accurate redirect banner
at the very top pointing to `document-capture-ocr-and-deeds.md` as canonical — but immediately below
it sat a large `✅ FINAL STATE 2026-08-12 — THE WHOLE OCR LOOP IS CLOSED AND LIVE. READ THIS, DON'T
REBUILD.` box whose present-tense imperative wording could override the redirect on a skim-read,
exactly as CONSOLIDATE2 warned ("a reader following the first alone would miss DOC17/DOC18").

**Fix, not a rewrite:** retitled the box `⚠️ HISTORICAL — FINAL STATE AS OF 2026-08-12 ONLY`, named
the newer canonical doc and its DOC17/DOC18 currency explicitly inside the box itself (not just in
the banner above it), and reworded "the durable operating state" to "the operating state AS OF
2026-08-12" so the numbers that follow read as a dated snapshot rather than a standing claim.
**Nothing below the box was touched** — same historical narrative, same numbers, per REGISTRY.md's
never-delete rule. This is a framing fix, not a fact correction: everything in the box was true on
2026-08-12 and still is, as history.

The other two CONSOLIDATE2 contradictions (`tier0-owner-contact-system.md` not re-verified against
its own P197/P198 corrections; scattered "LIVE"/"SHIPPED" language predating a same-day correction,
e.g. the FRED/CMS verdict) remain open — left for a follow-up pass, same as CONSOLIDATE2 left them.

Also filed: `responses/consolidate 2 desktop response.docx` moved to `responses/done/` (matches the
already-merged CONSOLIDATE2 commit `9364ec1e`).

Docs updated: `docs/architecture/document-capture-and-ocr-status.md` (FINAL STATE box retitled).
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
| **CoStar sidebar / public records (PR5/PRI)** | PR5d, PR-scanner-3, PRI2–PRI5 | 2026-09-12 | PR-scanner-3 shipped (`county_records_needed` action); PRI5 merged+deployed, awaiting another live CMS ingestion test run to confirm the hang is actually cleared |
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

## 2026-09-12 — MB2a scoped with feeds fetched live: 3 dead URLs replaced by 2 verified ones + a feed-health guard

Cowork tested MB-b's three dialysis feeds and six candidates live. Dead: `renalandurologynews.com/feed/` **403**,
`nephrologynews.com/feed/` **404** (and `/rss/`), `cms.gov/newsroom/rss` **404** (the `rss-feeds` page is an HTML
listing, not a feed); also dead: `fiercehealthcare.com/rss/xml` **403**, `kidney.org/rss.xml` **404**. Working and
parsed: **Federal Register ESRD query feed** (200, 3 items, real CMS documents — the authoritative ESRD-rule source)
and **Google News operator query** (200, ~100 items). Two caveats recorded in the prompt rather than glossed: Google
News links are redirect URLs with the publisher only in the title suffix, and the feed is broad enough that today's
first item was local EMS news — so the Ollama relevance filter's survival rate gets measured before `MARKET_BRIEF_PRSS`
is flipped. The real deliverable is the guard: a test that fetches every `RSS_FEEDS` URL and fails on non-200/zero
items, plus per-stream feed health so an empty stream is a **named gap** (I11), not silence.
Prompt: `prompts/MB2a-dialysis-feeds-that-actually-respond.md`.
## 2026-09-12 — MB-b is fully LIVE: migrations applied, and the full flip-and-verify sequence actually ran (Cowork/Scott)

Applied both pending MB-b migrations (the RSS-cron repoint and the `MARKET_BRIEF_RENDER` flag
registration) after confirming both were additive, idempotent, and default-off. The flag insert's
`ON CONFLICT DO UPDATE` found the row already existed with `state='on'` — Scott (or an operator
session) had run the real live-verify sequence in parallel: `MARKET_BRIEF_PSQL` flipped on at 14:48
UTC, the tick wrote **31 live facts**, the render froze a `market_brief_issues` row for
`dialysis`/`daily`/2026-09-12 at 14:49, and `MARKET_BRIEF_RENDER` was flipped on. My migration
correctly left that live `on` state untouched rather than clobbering it back to the file's own
default `off`.

**MB-b (Lane Briefs email block + homepage Market Briefs tab) is now genuinely live**, not just
deployed-in-code. `MARKET_BRIEF_PRSS` stays off (no dialysis RSS content yet — unrelated to this).
Updated `MB3`/`MB4` in `PLANNED-BACKLOG.md` to `✅ live`. This closes the loop that started with
"the redeploy already happened, just never reported" a few hours ago — the whole remaining sequence
happened live today.


## 2026-09-12 — MB-b reconciled and TURNED ON: the market brief is live in the daily email and on the homepage tab

Cowork applied MB-b's two unapplied migrations (`MARKET_BRIEF_RENDER` registration, `lcc-market-brief-rss` cron),
flipped `MARKET_BRIEF_PSQL` on, ran the producer once (**15 facts written, run `completed`**, 31 live facts), then
flipped `MARKET_BRIEF_RENDER` on and verified both surfaces on deployed `6b28835f28ac`: `GET /api/market-brief-tab`
returns `enabled:true, has_facts:true` with sourced facts, and `/api/briefing-email` (117 KB) now contains the **Lane
Briefs block** — cap-rate band, on-market count, the CMS staleness gap rendered honestly, and the link to
`#/briefs/dialysis` — with the first `market_brief_issues` row frozen. Three clean operator bands (DaVita, Fresenius
Medical Care, US Renal Care), no duplicates. **One defect found:** MB-b's three new dialysis RSS URLs all fail —
Renal & Urology News **403**, Nephrology News **404**, CMS Newsroom **404** — so `MARKET_BRIEF_PRSS` stays **off** and
the stream would yield nothing; filed as **MB2a**. MB-b's own note said the URLs were never egress-verified.
⚠️ Concurrency note: this entry was written twice — a parallel session's REPO1 root sweep (`68de2540`) discarded the
first copy while it sat uncommitted in the shared checkout. Commit doc edits immediately in this repo.

## 2026-09-12 — MB-b's "needs a Railway redeploy" blocker is already cleared; two small migrations are the real remaining gap (Cowork)

Continuing planned-vs-completed-vs-gaps. `MB3`/`MB4` (MB-b's Lane Briefs email block + homepage tab)
were filed as "not deployed/live-verified — no Railway/Supabase write access" the day they were built.
Checked live via `net.http_get` from Supabase (the same pg_net technique earlier Cowork dry-runs used):
`tranquil-delight-production`'s `/version` reads **`54ca77699efe`**, confirmed **10 commits past the
MB-b merge** (`git merge-base --is-ancestor 94a08eca 54ca7769` → true). **The redeploy already
happened** — just never reported back into the backlog rows that were still waiting on it.

**What's actually still missing:** the two MB-b migrations were never applied — `feature_flags_registry`
has no `MARKET_BRIEF_RENDER` row yet, confirmed live. Both migrations
(`...mbb_rss_dialysis_stream_cron.sql`, `...mbb_market_brief_render_flag.sql`) are additive, idempotent,
default-off, and carry reversal runbooks — low-risk once applied. The remaining live-verify call
(`POST /api/market-brief-psql-tick`) 401s from this session — needs an operator's `X-LCC-Key`, which
this session doesn't hold.

Updated `MB3`/`MB4` in `PLANNED-BACKLOG.md` to reflect the narrowed gap rather than leave the stale
"needs a redeploy" framing standing. Did not apply the migrations myself this pass — flagging the
exact remaining steps rather than acting past what this documentation-focused turn asked for.


## 2026-09-12 — Continuing planned-vs-completed-vs-gaps: re-verified the "CMS ingestion repaired" claim live and it does not hold (Cowork)

Following the FRED/CMS thread `CONSOLIDATE3` left open, re-measured both live rather than trusting the
2026-09-01/02 doc claims. **FRED is genuinely fine** — `economic_indicators` max observation date is
2026-09-10, writing daily, no action needed. **CMS ingestion is not.** `v_dia_producer_health` self-reports
`cms_ingestion` as `status='failing'`: 34 of 36 runs failed in the last 30 days, `last_success_at`
2026-04-04 (five months, not the 67 days the "repaired" narrative was about). `medicare_clinics
.source_last_seen` has been frozen at 2026-08-31 — 249 of 8,547 rows (2.9%) — for 12 days, exactly the
stall-at-249 risk `B6d-cms-step` flagged on 2026-09-01 as "the only thing left on this thread." No run
fired at all today against the `0 6 * * *` schedule.

**The failure signature has also changed** since the doc was last touched: no longer silent
`abandoned`/NULL-error kills, but `"Reclaimed by ingestion_lock (force) after 0.0h in 'started'"` and
`"Reclaimed by reclaim_stale_started_runs…"` — `PRI5`'s own reclaim mechanism (shipped 2026-09-11) is now
the thing terminating most of these runs, several within the same second they start. Whether PRI5 is
correctly killing something already broken, or itself killing runs that would otherwise finish, is not
determined from this session — flagged as further evidence for the already-open `PRI6` thread (the two
17.9-hour locks on this same producer), not a new defect.

Corrected `DATA-PROCESS-AUDIT-HANDOFF.md`'s "CMS ingestion repaired" line to point at the backlog row
instead of asserting current state; appended the live finding to `B6d-cms-restart` (never deleted its
prior text). Needs Railway deploy logs no agent here can reach — same blocker the row already named.


## 2026-09-12 — DOC-CONTRA #2 found a live bug, not just a stale doc: TIER0_AUTO_ATTACH silently off for 16 days (Cowork)

Re-verifying `tier0-owner-contact-system.md` against reality (CONSOLIDATE2's 2nd flagged
contradiction) found the flag's 2026-08-28 "RESOLVED" note was never actually verified: the tick's
run log shows `flag_off` on all 17 runs since, because `tier0-auto-attach-tick.js:208` called the
shared `flagEnabled()` helper with one argument instead of two — every other of 7 callers in the
repo got it right. Fixed the call, added a source-guard test, corrected the doc's live-state table
and history (kept the wrong 08-28 note verbatim, marked corrected). New backlog row
`TIER0-flag-arity`. DOC-CONTRA now 2 of 3; FRED/CMS scattered verdict still open.

## 2026-09-12 — CONSOLIDATE2 reconciled: STATUS 10,742 → 2,461 lines; two structural fixes + next cadence filed

Verified live: archive `docs/history/STATUS_claude-code_2026-08-29_to_2026-09-11.md` written verbatim; 78 ✅ backlog rows
folded into `CURRENT-STATE.md` §2a (1,233 → 1,155); `test/status-line-budget.test.mjs` guards 2,500 lines;
`docs/audits/README.md` appended, DOCMAP2 rule intact. **Two fixes by Cowork:** (1) the Open-threads table had ended up
**below 2,300 lines of entries** — moved to the top, where a new session actually reads it, with new entries below the
`---`; (2) **headroom is 39 lines** against the 2,500 budget, so the next one or two entries fail the suite — archive
cadence and an entry-length convention filed as **CONSOLIDATE3**. CONSOLIDATE2 also flagged three canonical-doc
contradictions (document-capture OCR pages, tier0-owner-contact vs its P197/P198 corrections, architecture docs quoting a
pre-correction verdict) — carried as DOC-CONTRA, not silently fixed.

---

## 2026-09-12 — CONSOLIDATE2 (round 2) SHIPPED: STATUS archived again, backlog folded, topic index extended

**PR (this branch), documentation-only.** `docs/claude-code/STATUS.md` **10,742 → 2,351 lines**
(before this entry) — lines 2226–10644 (dated 2026-08-29 → 2026-09-11: the B6d/B6e CI-and-producer-
health arc tail, PRI2–PRI5, BROKER1, the P18/BUY0 design opens, the AC-series contact/address work,
and a long ID-series/C13-C14 run) moved **verbatim** to
[`docs/history/STATUS_claude-code_2026-08-29_to_2026-09-11.md`](../history/STATUS_claude-code_2026-08-29_to_2026-09-11.md).
An "Open threads" table was added at the top of the trimmed file, and a
`test/status-line-budget.test.mjs` guard now fails the suite if STATUS.md exceeds 2,500 lines
again, naming this archive procedure in its own failure message.

`docs/os/PLANNED-BACKLOG.md` **1,233 → 1,155 lines**: 78 rows whose State column read exactly `✅`
moved **verbatim** into `docs/os/CURRENT-STATE.md` new §2a ("Shipped rows folded from
PLANNED-BACKLOG.md"), deleted from the backlog per its own "How to keep this file honest" rule.
No 🔴/🟡/🟢/👤 row was touched. `docs/audits/README.md`'s DOCMAP2 topic index was **appended to,
not regenerated** — a new "CONSOLIDATE2 (round 2)" section records the archive + fold and flags
three canonical-doc/reality contradictions found along the way (document-capture-and-ocr-status.md
vs the newer document-capture-ocr-and-deeds.md; tier0-owner-contact-system.md not re-verified
against its own P197/P198 corrections; several architecture docs quoting a pre-correction verdict)
for a follow-up pass, not resolved here.

**Nothing was reworded, deleted, or reordered inside a moved block** — every archived STATUS entry
and every folded backlog row is byte-identical to its pre-move text.
## 2026-09-12 — DOC2-DOC6 re-measured live: mostly still open, one materially bigger than filed (Cowork)

Continuing the doc-cleanup pass: `DOC2`-`DOC6` (gov-side document-capture defects B2-B6) were flagged
in the P1a retitle as a genuinely still-open 🔴 cluster hiding under a stale "top priority" header.
Rather than trust the 2026-08-31/09-01 numbers on file, re-measured each live against
`scknotsqkcheojiaewwh` and this repo's own code.

- **DOC2 (B2 — gov crons/docs said stale):** NOT independently re-verifiable from this session. The
  claim is about `GovernmentProject` repo's own docs/crons, cross-repo by the row's own admission —
  this session has no access to that repo or its scheduler. Left as filed, unchanged.
- **DOC3 (B3 — firm-term queue expects an unwired chain):** `v_gov_firm_term_reextract_queue` is
  **90 rows today** (was 99) — essentially unchanged, still real. **New: broke it down by
  `document_type`** — 32 `brochure` / 31 `om` / 27 `lease`, all `needs_ocr`. Only the 27 leases are
  actually B3's "wire `runLeaseExtraction`" gap; the other 63 (70%) are DOC6's population, not DOC3's.
- **DOC4 (B4 — no cron on `doc-bytes-backfill`):** reconfirmed live and essentially unchanged —
  **87 url-only** (was 85), **125 with neither bytes nor text** (was 120), both drifted up slightly
  rather than down. No `doc-bytes-backfill`-named job exists anywhere in the gov project's `cron.job`
  table (44 jobs total, checked by name). Still real, still nobody's.
- **DOC5 (B5 — silent per-profile extension reload):** the extension manifest is now **1.0.53** (was
  1.0.45 when B5 was filed, floor named was ≥1.0.39) — the version-floor half of this row is stale
  and cleared. ⚠️ But the actual defect named — reload is silent, per-profile, no telemetry on which
  profile is on which version — is a behavioral claim this session found no code addressing (no
  version-telemetry columns/fields anywhere in `extension/` or `api/`). Still open on the real
  complaint, just not on the version number quoted.
- **DOC6 (B6 — brochures excluded from byte capture):** reconfirmed unchanged at the code level —
  `api/_handlers/sidebar-pipeline.js:3160` still skips `is_offering_material`/`marketing_brochure`
  docs, now with a comment explaining it's deliberate (they route client-side through
  `STAGE_OM_VIA_TAB` instead). **The bigger news is DOC3's breakdown above:** the firm-term queue's
  32 brochures + 31 OMs (63 of 90, 70%) are exactly this excluded population — more than double B6's
  original "25" estimate, and it means whatever the OM-via-tab path does, it is not the thing draining
  this particular queue. DOC3 and DOC6 are the same defect looked at from two ends, not two.

**Not fixed here — these are cross-cutting pipeline-wiring decisions (does OM-via-tab need to also
write into this queue's expected shape, or does the queue need to stop expecting brochures/OMs at
all), a real build decision, not a measurement.** Docs updated: `PLANNED-BACKLOG.md` (DOC3-DOC6 rows
re-measured with the live numbers and the DOC3/DOC6 link made explicit; DOC2 left as-is).

## 2026-09-12 — HP1-P1a-fix reconciled: code is merged, but live production is NOT confirmed running it (Cowork)

## 2026-09-12 ✅ — HP1-P1d SHIPPED: the SF opportunity feed now has a real freshness assertion (Claude Code)

Investigation claims 1–4 all confirmed live before coding: `feed_freshness_registry` = 2 active rows
(`om_intake`, `salesforce_sync`); `salesforce_sync` watches `sf_sync_log`, a different pipe, untouched;
`bd_opportunities` = 619 rows / 612 sf-linked / 7 non-SF (`metadata->>'source' IN ('priority_queue', NULL)`,
`last_synced_at IS NULL`); `producer_runs` exists, producer-keyed, held 2 EB1 rows.

**Home: extended `producer_runs`**, not a table-keyed `feed_freshness_registry` row (no WHERE-filter column —
would go green on the `priority_queue` producer's writes over a dead SF pipe). `ingestBatch` now writes ONE
`producer_runs` row/batch (`facts_written` = the RPC's own inserted+updated tally, never `succeeded`), fire-
and-forget, on a **3-arg** `opsQuery` call only (never the 4th-arg-options shape that mangled `Prefer` in P1a).

Freshness CHECK: `lcc_check_sf_opportunity_freshness(p_stale_hours numeric DEFAULT 3)` (migration
`20261101180000`), on `max(last_synced_at) FILTER (WHERE sf_opp_id IS NOT NULL)` — never bare `last_synced_at`
or `updated_at` — into `lcc_health_alerts(alert_kind='sf_opportunity_feed_stale')`, the existing
`v_lcc_health_alerts_open`/Teams-push surface, no new dashboard. 3h threshold = 6× the measured 30-min cadence.
Cron `lcc-sf-opportunity-freshness-check` hourly, pure SQL. **Reconciles with P1a-fix Unit 3** (non-2xx on
`succeeded===0`): that catches a run that fails; this catches a run that never happens — neither covers the
other.

**Four required positive controls, live + rolled back:** (1) green now — `stale:false`, age 0.3h, real
12:47 UTC sync. (2) all sf-linked rows back-dated 10d → `stale:true`, age 240.0h, text captured, 0 residue
after rollback. (3) historical replay, read-only (zero UPDATEs ever pre-fix ⇒ `last_synced_at==created_at`
throughout) — **13 of 16 checkpoints across 2026-08-04→09-12 would have fired**; the 3 green ones are the
few-hour windows after each of six sporadic new-deal inserts (08-04, 08-20, 09-03, 09-07×2, 09-09) — a stated,
measured limitation (a brand-new `sf_opp_id` INSERTs cleanly with no conflict even while every UPDATE 502s),
documented in the migration header rather than hidden. (4) back-dated all sf rows AND touched one
`sf_opp_id IS NULL` row to `now()` in the same rolled-back txn → still `stale:true, age 240h` — the non-SF
write never cleared it. All four pinned as automated tests too (`test/hp1-p1d-sf-feed-freshness.test.mjs`, a
pure-JS shadow model of the SQL predicate against the same numbers), plus `ingestBatch` wiring + migration
source guards. Full suite 6,077 pass / 0 fail / 6 skipped (pre-existing).

**Not done, per the prompt:** `salesforce_sync` row untouched; no table-keyed registry row; no
`bd_opportunities` backfill; HP1-P1a-nullsf (the `priority_queue` writer) left open — its existence is why the
predicate excludes `sf_opp_id IS NULL`. Docs: `PLANNED-BACKLOG.md` (HP1-P1d → ✅), `CURRENT-STATE.md`,
`B6a_FOLLOWUP_FRESHNESS_MONITOR_2026-08-28.md` (§11, sharpest real instance).

**Next:** HP1-P1a-nullsf, then HP1-badge or HP1-P2a.

## 2026-09-12 🚨 — The monitor named `salesforce_sync` was green every day of the outage, watching a different pipe (Cowork)

Scott deferred the `LCC_API_KEY` rotation until the build is complete and real users are added — recorded on
**HP1-P1a-sec** with the one caveat the single-user rationale does not cover (the exposure is **repository** access,
not app users; re-open at a second person with repo access or a visibility change, whichever comes first). Moved on
to **HP1-P1d**, the last open item of HP1's Finding 2: *why did nothing notice for 36 days?*

**The answer is not "the table wasn't registered."** Measured live:

- `feed_freshness_registry` has exactly **two active rows** — `om_intake` and `salesforce_sync`. That is the entire
  watched surface.
- 🚨 **`salesforce_sync` watches a different Salesforce pipe entirely.** It reads `sf_sync_log.created_at`, and
  `sf_sync_log` logged **220,845 rows across all 39 days** of the outage (`object_intake` 195,552 ok / 28,493
  skipped / 16 error; `crawl_run` 949 ok). **The opportunity ingest writes nothing to `sf_sync_log`.** The monitor
  was not silent — it answered "is the Salesforce feed healthy?" with a confident **yes**, daily, from a row whose
  name says Salesforce and whose contents are a different producer. That row is *correct for what it watches*; it
  must not be touched or "extended".
- The registry's shape **cannot express** the assertion: it keys on `(src_table, ts_column)` and asks whether a
  timestamp moved on a table. `bd_opportunities` has at least two producers — **619 rows against the feed's 608** —
  so a table-keyed row would go green on an LCC-side write over a dead Salesforce pipe. Exactly the B6a trap.

✅ **The machinery to use probably already exists:** `producer_runs` is **producer-keyed** and already carries
`facts_written` and `skip_reason` — the precise two columns this defect needed — but holds **2 rows** and is
effectively unused outside exec-briefs. Reviewing it before building anything is the prompt's first unit.

Prompt written: `prompts/HP1-P1d-deal-backbone-feed-freshness.md`. Its predicate is
`max(last_synced_at) FILTER (WHERE sf_opp_id IS NOT NULL)` — never bare `last_synced_at`, never `updated_at`. Its
**deliverable is a positive control, not a green dashboard** (Class 11): green now · fires against a rolled-back
back-dated feed · would have fired across the real 2026-08-04→09-12 window · and is **not cleared by touching an
`sf_opp_id IS NULL` row**. If that last one fails, the assertion is table-keyed in disguise and the prompt says to
stop rather than adjust the expectation.

It also asks CC to reconcile rather than duplicate: Unit 3 already made `ingestBatch` return non-2xx when
`total > 0 && succeeded === 0`. That catches **a run that fails**; this catches **a run that never happens**;
neither covers the other, and the 36-day outage would have been caught by the HTTP one only if someone were reading
Power Automate run bodies — nobody was, and the flow history was green throughout.

⚠️ **Housekeeping, worth naming:** a parallel session reconciled the same two responses at 12:59 and prepended its
entry **above** this file's H1, creating a duplicate `HP1-P1a-fix` backlog row and a now-false headline. Both
corrected in place (row collapsed, entry re-titled and banner-corrected, H1 restored to the top). This is the third
time today a session has buried the H1 by prepending — if it happens again, the fix is a convention note at the top
of the file, not another manual repair.

## 2026-09-12 — HP1-P1a-fix reconciled: code merged, live run not yet confirmed — ⚠️ SUPERSEDED 12 MINUTES LATER (Cowork, parallel session)

⚠️ **Superseded, and kept for the record rather than rewritten.** This entry was filed at 12:59 UTC by a parallel session on an honest reading — *zero rows synced since 2026-09-09* — which was true when taken. The **12:47 UTC Power Automate run had in fact already landed**, and a second session verified it at 12:50: `updated_not_inserted = 608`, `brand_new_rows = 0`. See the ✅ entry above. Two things below are now false and are corrected here rather than deleted: (1) *"there is no live evidence it is actually deployed"* — there is: `tranquil-delight`'s `/version` reports `c91d5dabe932`, matching `main`; (2) the implied conclusion that the fix was not working — it was not working, but for a reason this reading could not see: **the migration had never been applied, and the function as written raised 42702 on its first call.** Both were found and fixed at ~12:41. The 🟡 backlog row this entry created has been collapsed into the ✅ one.


Reconciling two Claude Code desktop responses sitting in `docs/claude-code/responses/` against git
history. Both `HP1-P1a-fix-opportunity-upsert-never-updated.response.md` (Units 2-5: the RPC-first
upsert, the batch-endpoint honesty fix, the `closed_at` preservation, and the test guards) and
`ID2b caps 2 desktop response.docx` match already-merged commits on `origin/main`
(`4530a341`/`3f0edc24` for HP1-P1a-fix + the HP1-P1a-dup finding; `a8fc2eb2` for ID2b-caps-2, which
`STATUS.md` already had a full entry for). Both response files moved to `responses/done/`.

**ID2b-caps-2:** already ✅ in `PLANNED-BACKLOG.md`, nothing to change.

**HP1-P1a-fix:** the backlog row was still sitting at 🔴 despite the code being merged, so ran the
response's own asked-for verification live rather than trusting the merge alone —
`select date_trunc('day', last_synced_at), count(*) from bd_opportunities group by 1` on
`xengecqvemvfknjvbvrq`. Result: **zero rows have synced since 2026-09-09** — three days *before*
today's fix even shipped. The fix is merged into `main`; there is no live evidence it is actually
deployed and running against the real Salesforce feed yet (Railway redeploy status is outside what
this session can see). Marked the row 🟡 (code shipped, deploy/live-run unconfirmed) rather than ✅ —
per this repo's own standing rule, a merged PR is not itself proof of a working system. **Next
verification step, once Railway is redeployed:** wait for the next PA sync cycle, then re-run the
`UPDATED_not_inserted`-style check the original prompt specified before closing this row.

Docs updated: `PLANNED-BACKLOG.md` (HP1-P1a-fix row corrected from 🔴 to 🟡 with live measurement);
2 response files moved to `responses/done/`.

## 2026-09-12 ✅ — HP1-P1a-fix CLOSED: 608 UPDATED, not inserted — the Salesforce feed writes for the first time (Cowork)

The 12:47 UTC Power Automate run landed against the corrected RPC. **`updated_not_inserted = 608`,
`brand_new_rows = 0`, `max(last_synced_at)` 2026-09-09 20:30 → 2026-09-12 12:47.** Closed on the measurement the
prompt named, not on a 200. **The deal backbone has never taken an UPDATE from Salesforce before today.**

**What six weeks of drift actually turned out to be — far less than feared.** Diffed against
`_hp1_p1a_bd_opportunities_pre_fix_backup` (the snapshot the migration takes before the first correct run):
**10 stage changes, 6 expected-close-date changes, 4 newly closed, 0 amount changes, 0 new rows.** Every one is a
recognisable live deal:

- **Newly closed (4):** *DaVita Succasunna NJ* `non_refundable` → **closed / won** (close date pulled in to 09-09)
  · *DaVita Succasunna NJ* (a second, earlier opp on the same asset) `listing_signed` → **terminated** ·
  *DaVita Portfolio 3 — Realty Income — Aug 2026* `in_escrow` → **terminated** ·
  *DaVita Portfolio 4 — Realty Income — May 2026* `loi_executed` → **terminated**.
- **Advanced (5):** *Banning CA*, *Omaha NE*, *Queens NY* all `listing_signed` → `non_refundable` (Omaha and Queens
  also pulled their close dates from a 2027-01-01 placeholder to 09-25) · *Action Behavior Centers — Duncanville TX*
  and *DaVita Zapata TX* both `loi_executed` → `in_escrow`.
- **Slipped (1):** *DaVita The Villages FL* close date 08-21 → 09-30, stage unchanged.
- ⚠️ **One backward move:** *Essentia Health — Hinckley MN* `loi_executed` → **`listing_signed`**. Worth Scott's eye:
  either a genuine re-trade back to listing, or Salesforce hygiene. LCC now mirrors Salesforce faithfully — which
  means Salesforce's own errors now arrive too, the tradeoff this fix always implied.

**✅ Unit 4 held.** `closed_at` changed on exactly the **4** rows that genuinely transitioned into closed; the 569
already-closed rows kept their original timestamps. The RPC's `COALESCE(t.closed_at, EXCLUDED.closed_at)` absorbed
the fact that `processDeal` still sends `new Date().toISOString()` on every sync, so no real close date was
re-stamped.

⚠️ **The prompt's repeated mass-auto-retire warning was misdirected.** There is **no `deal_next_step` table** in
LCC Opps — `lcc_generate_deal_next_steps()` exists and writes into **`action_items`**. With only 10 stage changes
there was no mass retire to brace for, but the warning as written sent a reader to a table that does not exist.
Corrected here rather than left to mislead the next turn.

⚠️ **Still open, and it should be looked at before HP1-P1d registers a freshness assertion:** `bd_opportunities`
holds **619** rows against the feed's **608** — 11 rows the Salesforce feed does not touch, some with
`sf_opp_id IS NULL`. A second producer keeping `last_synced_at` fresh over a dead Salesforce pipe is exactly the
B6a trap P1d warns about, so P1d must register **the feed**, not the table. Filed as **HP1-P1a-nullsf**.

## 2026-09-12 🚨 — The live `LCC_API_KEY` is committed to this repository (found during the root-clutter sweep) (Cowork)

Scott asked for the repo files and folders to be cleaned and consolidated. Surveying the root turned up
`wave0-config-values.txt` — **tracked**, first committed 2026-04-06 in `d76e00e8` — carrying
`LCC_API_KEY=<64-char value>`. Its prefix matches the `Authorization: Bearer` token in the
`SF Deal → LCC Opportunity Sync` Power Automate flow **exactly**. It is the same live key, and it is the key
`mcp/server.js::authenticate` accepts on every `/api/pipeline/*` and `/api/sf/*` route — so repo read access is
write access to the deal backbone. SEC1 flagged this key as exposed on 2026-08-03 on the strength of the flow
header alone; the repository copy was never noticed, and the key was never rotated.

**Rotation alone no longer closes it** — the value is in git history permanently. Escalated on **HP1-P1a-sec**
with the four steps (rotate · update the flow header in the same change · replace the literal with a
`<from Railway env>` placeholder · decide purge-history vs accept-burned). 👤 **Scott's call, and it should come
before the next PA verification run rather than after.** The rest of that file (Teams/tenant/channel IDs, a dead
Vercel host) is not secret.

**Sweep otherwise deliberately NOT taken.** ~12 scratch artifacts sit at the root beside the served front-end JS
(`draft1/draft2/draftsave.json`, `harvest.json`, `twin.json`, `seed-*.json`, `acq-dryrun.json`,
`fix-allother-pagination.patch`, `ACTIVATE_unit4.sql`, two `.bat` files, ~10 loose `.docx` specs). Several are
referenced by name from `docs/` **and from `test/retired-identifiers-guard.test.mjs`**, so moving them in bulk is
a silent test/doc breakage dressed as tidying. Filed as **REPO1-root-clutter** with the method (grep each name,
move only the unreferenced ones into the existing `_superseded/` with a manifest line, fix the rest of the
references, file the loose `.docx` under `docs/` by topic). Consistent with the repo's own never-delete rule —
and `err.txt` (0 bytes) could not be removed anyway: this bridge cannot delete on Scott's machine without an
explicit grant.

**What WAS consolidated this pass:** `docs/claude-code/STATUS.md` had **two stray duplicate `# Claude Code queue
— STATUS` H1s buried mid-file** (lines 83 and 212) from sessions prepending entries above the header — removed
both, one H1 now sits at the top where a reader lands. `responses/` is back to empty-but-README: the ID2b-caps-2
docx and the HP1-P1a-fix response filed to `responses/done/`, the ID2b-caps-2 prompt to `prompts/done/`.
`prompts/` now holds 9 genuinely open items. `HP1-P1a-fix` stays **active on purpose** — its round trip is not
proven yet.

## 2026-09-12 — ID2b-caps-2 GATE PASSED live (three clean bands); the operator-note funnel is ALIVE end to end; audits indexed by topic

Filed `responses/ID2b caps 2 desktop response.docx` → `done/`. **ID2b-caps-2 (PR #2374, merged, deployed `c91d5dabe932`)
closed the defect that opened the identity thread on 2026-09-11.** It took the source-of-record path — a first-class
`sf_comp_staging.operator_id` resolved through `dia_operator_aliases` (fill-blanks, non-raising trigger, deliberately
lighter than the hard guard on `properties`/`leases` because an external Salesforce sync feeds that table) — predicted a
406/400/6 backfill in dry run and applied exactly that. **Cowork live dry run confirms the gate:** `:5` Fresenius Medical
Care **n=72**, `:4` DaVita **n=78**, `:73` US Renal Care **n=8** — three id-keyed bands, **no text-keyed fragments, no
duplicate labels**, whole-market **n=169 unmoved**, candidates 17 → 15. The counts differ from the 75/78 predicted on
09-11 because the TTM window rolled and the SF-staged arm now contributes (SF TTM: DaVita Dialysis 13 · Fresenius Medical
Care 10 · US Renal Care 2) — arithmetic, not drift. **Declared deviation kept:** the duplicate-label guard is scoped to
two different resolved operator ids sharing a label, not the blanket rule requested, because the blanket version broke an
intentionally-tested fallback.

**OC-v items 1–2 done and verified.** The standalone MCP redeploy is live: `/health` lists `log_operator_note` and
`get_operator_inbox`, and `/api/operator-inbox` is a read route. Cowork POSTed a real note to `/api/operator-notes` →
`{id, disposition:'open'}`, now row 1 of `operator_notes`. **What's left to make it a loop:** the `OPERATOR_NOTE_TRIAGE`
flag row still doesn't exist (`registry_state: null`) and no cron posts the tick; a forced dry run scanned the note and
returned **unclassified** (`no_deterministic_rule_matched_and_model_declined`) — correct fail-closed behavior, but
routing stays unproven until a real bug/idea note goes through.

**Repo hygiene (Scott's standing ask):** added `docs/audits/README.md` — 118 audits indexed by topic (identity,
ownership, comps/capital markets, feeds & monitors, CoStar sidebar, Power Automate, UX, security, one-offs) with the
standing reminder that an audit is a dated measurement, and a pointer to CURRENT-STATE / PLANNED-BACKLOG / STATUS for the
live picture. Next consolidation step drafted as `prompts/CONSOLIDATE2-status-archive-and-topic-folders.md`: STATUS.md is
**10,582 lines / 281 entries** and PLANNED-BACKLOG.md **1,227 lines**, both past the size where a new session can read
them whole.

## 2026-09-12 — HP1-P1a-fix: migration was NEVER applied, and as written it could never have run — both fixed, upsert proven live (Cowork)

PR #2371 merged and both Railway services redeployed, so `mcp/opportunity-sync.js` now POSTs
`rpc/lcc_upsert_bd_opportunities`. Checked the live DB before writing any "fixed" line, per the prompt's own
rule (**verify on `UPDATED_not_inserted`, never on a 200**). Two defects, both silent, both caught before a
live run:

**1. The migration had not been applied.** `20261101170000_lcc_hp1p1a_opportunity_upsert_rpc.sql` was merged
into the repo but never run against LCC Opps — `pg_proc` had no `lcc_upsert_bd_opportunities` at all. The
deployed code was therefore calling an RPC that did not exist, which would have 404'd on all 608 deals of
every 30-minute run. **The redeploy made the feed worse, not better**, and nothing would have said so:
`ingestBatch` still returns HTTP 200. Applied the migration live (it adds a function plus the one-time
`_hp1_p1a_bd_opportunities_pre_fix_backup` snapshot; it changes no data).

**2. The function as written raises `42702` on its first call.** It declares OUT parameters `sf_opp_id` and
`entity_id`; both collide with columns of the same name on `bd_opportunities`. A plpgsql body is not parsed at
`CREATE` time, so the migration applies cleanly and then fails on **every** execution with
`column reference "sf_opp_id" is ambiguous`. That is a second total-failure of exactly the shape HP1-P1a-fix
exists to eliminate, and an HTTP 200 would have hidden it again. Renamed the OUT params `out_sf_opp_id` /
`out_entity_id` and aliased the INSERT target `AS t` so Unit 4's `COALESCE(t.closed_at, EXCLUDED.closed_at)`
and `RETURNING t.id` resolve. **No JS change needed** — `processDeal` reads only `outcome`, `reason` and
`bd_opportunity_id`. Filed as `supabase/migrations/20261101170100_lcc_hp1p1a_upsert_rpc_fix_out_param_ambiguity.sql`
and the superseded function in `...170000_...` is annotated so nobody copies it forward.

**Live proof (rolled back, `sf_opp_id` `00TVs00001J3iCfMAJ`):** `outcome='updated'`, stage `identified` →
`PROBE_ROLLED_BACK`, `closed_at` NULL → set, `closed_won` NULL → true, `last_synced_at` advanced; a payload
with no ids returns `outcome='skipped'`. **This is the first time this path has ever produced an UPDATE.**

**Still NOT verified end to end.** `max(last_synced_at)` on `bd_opportunities` is **2026-09-09 20:30 UTC** and
`updated_not_inserted` over the last 6 h is **0** — no Power Automate run has landed since the migration went
in. The round trip is unproven until a run does. The pass/fail test is `UPDATED_not_inserted ≈ 600` after the
next run, not a 200 and not a green flow-run history (the flow history has been green through six weeks of
100% write failure).

**Incidental finding:** `bd_opportunities` holds rows with `sf_opp_id IS NULL` (the row with the newest
`last_synced_at` is one). They are not Salesforce-sourced, and the RPC correctly returns `skipped` for that
shape rather than inventing a key. Worth confirming which LCC-side writer mints them before P1d registers a
freshness assertion on this table — a second producer is exactly the B6a trap P1d already warns about.

**Root cause of the original defect confirmed** (PR #2373): `mountLccMcp(app)` at `server.js:176` with
`apiPrefix=''` registers `/api/pipeline/ingest-opportunit{y,ies}` **193 lines ahead of** the duplicate
registration at `server.js:368-369`, so the live handler is built from `mcp/server.js`'s positional-`prefer`
`opsQuery` and the correct `api/_shared/ops-db.js` one never runs. Filed as **HP1-P1a-dup**.

Docs updated: `PLANNED-BACKLOG.md` (HP1-P1a-fix → ⚠️ partially shipped + new HP1-P1a-rpc row),
`CURRENT-STATE.md` (§546 P1-blocked line corrected — it was never a Salesforce-hygiene question),
`supabase/migrations/` (+1 corrective migration, original annotated). Repo hygiene: removed two stray duplicate
`# Claude Code queue — STATUS` H1s that prepending sessions had left mid-file (lines 83 and 212); the file now
carries exactly one, at the top.

## 2026-09-12 — ID2b-caps-2 reconciled: SF-arm resolution verified live, band-list gate NOT pasted (Cowork)

PR #2374 merged (`c91d5dab`) and `tranquil-delight`'s `/version` reports `c91d5dabe932` — **deployed and live**,
which closes CC's own "not merged, not deployed" caveat. Response and prompt filed to `done/`.

**Verified live in Dialysis_DB, matches CC's report exactly:** `sf_comp_staging` now carries a first-class
`operator_id` column; **430 rows, 400 resolved, 6 unresolved-with-tenant** — the exact 406/400/6 CC predicted and
reported. The remaining 24 rows carry no tenant text at all, so there is nothing to resolve them from. CC chose
option **(b)** (own column at the source) over (a) (query-time resolution), which is the answer the prompt itself
pointed at.

⚠️ **The prompt's stated deliverable was not delivered, and this is filed rather than waved through.** §3 required
the full band list pasted from a live dry run, with named numbers: one **Fresenius Medical Care** band at
63+12=**75**, one **DaVita** at 68+10=**78**, **US Renal Care** at **6**, whole-market **n≈169 unmoved**, and no
`cap_rate_ttm_band:<text>` keys for operators that have an id — with an explicit instruction to *report and stop*
if any number differed. CC reported "exactly three clean per-operator bands (DaVita, Fresenius Medical Care,
US Renal Care) — no duplicate-labeled leftover" but **pasted none of the counts**. The shape of the gate is
asserted; the arithmetic is not evidenced. Not re-run here (it needs the tick's own dry run against the deployed
build, not a SQL approximation, and approximating it would be exactly the fabrication the standing rules forbid).
→ filed as **ID2b-caps-2-gate** — one dry run, paste the list, close or reopen on the numbers.

⚠️ **Two deliberate deviations CC disclosed, both accepted as reasonable, both now on file** so they are not
rediscovered as surprises: (1) the alias-resolution trigger on `sf_comp_staging` is **fill-blanks-only and
non-raising**, deliberately lighter than the hard-block write guard on `properties`/`leases`, because this table is
fed by an external Salesforce sync — so a bad tenant string here degrades to "unresolved", it does not fail the
sync; (2) the duplicate-label invariant shipped **scoped** to "two different resolved operator IDs sharing a
label" rather than §2's blanket "no two live facts in a lane/section share a label", because the blanket rule broke
an existing intentionally-tested fallback. The blanket invariant §2 actually asked for therefore does **not**
exist — a future fallback that re-mints a canonical-looking label for an *unresolved* operator would still ship
silently.

**Also checked:** the standalone MCP service (`life-command-center-production`) has **no `/version` route** —
`Cannot GET /version` — so "merged is not running" cannot be verified on that service the way it can on
`tranquil-delight`. Worth noting that the Salesforce ingest path does **not** traverse that service at all: it is
served by `tranquil-delight`, which mounts the MCP in-process via `mountLccMcp(app)` (HP1-P1a-dup). Filed as
**DEPLOY1-mcp-version**.

## 2026-09-12 — P1a/C2g dual-top-priority contradiction resolved by measurement, not judgment call (Cowork)

The XB2 audit pass earlier today flagged that `PLANNED-BACKLOG.md` had two rows independently claiming
to be THE top priority: `C2g` (⭐ NEXT, 2026-09-11) and the `P1a` section header (⭐ THE TOP PRIORITY,
2026-08-27). Rather than asking Scott to arbitrate, tallied every sub-item under P1a (C1-C19, DOC1-DOC18,
OCR1-OCR6, EXT1-EXT2a, BROKER1/BROKER1-sf) against its own status markers: the overwhelming majority are
already ✅ shipped, ⛔ refuted/superseded, or 👤 awaiting Scott's decision on file. This makes it a factual
staleness fix, not a subjective priority call — retitled the P1a header to drop its "top priority" claim,
named `C2g` as the current top priority, and explicitly listed the handful of genuinely still-open
sub-items so they aren't lost in the retitle: `C4d`, `C9b`, `C13h`, `DOC2`-`DOC6`, `C15` (the last
deliberately left open by design). Nothing under P1a was deleted or re-parented — REGISTRY.md's
never-delete/keep-canonical rule applied to a section header, not just a file.

Docs updated: `PLANNED-BACKLOG.md` (P1a header retitled + reconciliation note added).

## 2026-09-12 — First real run of XB2's audit rules (manual, not the automated system) — four findings, one fixed live (Cowork)

Scott asked for the repo's docs/files to be cleaned and consolidated by topic so future threads aren't
misdirected by conflicting or stale files. `docs/architecture/EXEC-BRIEFS-SPEC.md` §5 already specs an
automated system for exactly this (XB1 collector + XB2 audit rules + XB3 dashboard + XB4 narrative) —
all four rows in `PLANNED-BACKLOG.md` are still 🔴, unbuilt. Building that system is its own project
(a GitHub Action, an on-box Ollama synthesis tick, a new dashboard route) and out of scope for this
turn. Instead, ran XB2's own audit-rules checklist manually, once, across the categories the spec
names, using three read-only sub-passes.

**1. Orphaned prompts** — none found. All 13 active files in `docs/claude-code/prompts/` are ≤1 day
old and referenced in `PLANNED-BACKLOG.md`/`STATUS.md`. Adjacent finding: three prompts marked ✅
SHIPPED in the backlog were still sitting in `prompts/` instead of `prompts/done/` (filing lag, not
abandonment) — moved in this same change: `OWN-T0j-gov-side-reconciled-classifier.md`,
`ID3e-county-city-vocabulary-fold.md`, `PR-scanner-3-county-records-needed-action.md`.

**2. GENERATED hand-edits** — none found. All five `docs/os/surfaces/*.canon.md` files and
`docs/os/OPERATOR-INBOX.md` show their last edits coming from genuine `render-surfaces.mjs`/canon-bump
commits, not hand edits.

**3. Dead producers** — pg_cron itself is healthy across a ~20-job sample; no job is silently disabled
or failing. The real pattern is jobs that run green but produce nothing useful, and the docs already
self-report both known cases: cron 219 (`comms-owner-attribution-tick`, green daily, zero new proposals
since 2026-08-20) and cron 104 (`r9_chain_connect`, green, 4,943 of 5,207 minted entities orphaned/no
consumer). Nothing new to file — flagging for whoever picks either one up next.

**4. Flags ON with no consumer** — two real findings. `OCR_CLOUD_DOCAI` and `W51_PARTY_EXTRACT` are
both marked `on` in `docs/os/CURRENT-STATE.md`'s feature-flags registry with **zero code path anywhere
that reads either flag name** — both domains are actually gated by differently-named env vars/flags
instead (OCR: `OCR_CLOUD_ESCALATION`/`OCR_CLOUD_PROVIDER`/`OCR_CLOUD_OCR_URL`; W51: its own migration
comments it as a deliberately inert registry row, real control is `W51_ALLOW_CLOUD`/CLI args). Cosmetic
registry drift, not a live risk — filed here, not fixed (deciding whether to retire the flag names or
wire real reads to them is a judgment call, not this pass's job).

**5. Doc contradictions** — two real findings, one fixed live this pass:
- **Fixed:** `PLANNED-BACKLOG.md` carried **four near-duplicate copies of the `PR5c-enforce` row**
  (accumulated 2026-08/09, pre-CONTACT1a, saying the same thing with slightly different wording).
  Consolidated into one row and re-measured live while at it: `field_provenance` on `entities`
  (email/phone) has grown from the 2026-09-03 blocked baseline (4 rows / 1 source / all `write`) to
  **130 rows / 3 sources** — CONTACT1's numeric unblock condition (>~50 rows, ≥2 sources) is now
  cleared. ⚠️ Not a clean green light: all 130 rows are `decision='write'` — zero `skip`/`conflict`
  ever recorded, so the ladder has volume but has never been tested on a case where it would actually
  need to protect a value or arbitrate a conflict. Flagged 🟢 unblocked-for-grading, not shipped —
  flipping `enforce_mode` to `warn` is a build decision, not something this pass took.
- **Not fixed, flagged for Scott:** `PLANNED-BACKLOG.md` has two rows independently claiming to be
  THE single top priority in overlapping sections — `C2g` ("⭐ NEXT", dated 2026-09-11) and the `P1a`
  section header ("⭐ THE TOP PRIORITY", dated 2026-08-27, now over two weeks stale) — with nothing in
  the document reconciling which is actually first. Also: the spec's own worked example of a
  contradiction (backlog's `C2g` ⭐NEXT vs. the live queue's `PDR2`, both noted 2026-09-11 in the
  original XB2 finding) is **still unresolved today**, unchanged since the day it was found.

**6. Stale dated blockers** — one flagged, not resolved: `B6d-cms-restart` has stood since 2026-08-31
blocked on "Railway deploy logs no agent can reach," but three PRs since (PRI1/PRI3/PRI4, all
2026-09-11, in the same ingestion pipeline) fixed a connection-drop crash and a broken
timeout/shutdown path that PRI4 itself flags as "plausibly the same mechanism" behind unexplained
hangs elsewhere in this arc. Nobody has gone back to check whether B6d-cms-restart's mystery is now
explained. Left for whoever owns that pipeline next — this session didn't have the Railway log access
the row's own blocker names.

**Not built:** the XB1/XB3/XB4 automated system remains entirely unbuilt (all still 🔴). This was a
one-time manual pass, not a standing process — if Scott wants this repeated automatically, that's the
actual XB1/XB2 build, sized at a GitHub Action + on-box Ollama tick + dashboard route, a real project
on its own.

Docs updated: `PLANNED-BACKLOG.md` (`PR5c-enforce` deduped + re-measured), 3 prompts moved to
`prompts/done/`.


## 2026-09-12 — ID2b-caps reconciled: passthrough works, but the gate FAILED — two bands now share one display name; root cause is our own SF-staged comps

Filed `responses/ID2b caps desktop response.docx` → `done/`; prompt → `prompts/done/`. ID2b-caps (PR #2366) did the
additive work correctly: `rpc_query_comps` returns `operator_id`/`operator_canonical` on the sale and listing arms with
every pre-existing field byte-identical (so `operatorTier()` comp selection is structurally unchanged), the tick groups
on the id, and it caught a real retire-logic bug in testing before touching the live DB. 12 new tests, suite 6,044/0.
**But the prompt's gate did not hold.** Cowork's dry run against deployed `c5fc261f` returns five per-operator bands,
two pairs sharing a display name: `:5` **Fresenius Medical Care n=63** beside `:fresenius_medical_care` **n=12**, and
`:4` **DaVita n=68** beside `:davita_dialysis` **n=10**. Expected one band each (74 / 76). **That is worse than the
original defect** — before, two bands had different labels; now two bands claim the same operator with different
numbers. **Root cause (measured):** the passthrough covers the sale and listing arms, which read dia `properties` where
coverage is fine (every TTM DaVita/Fresenius sale resolves). The leftovers come from a **third source —
`sf_comp_staging`, our own Salesforce-staged closed deals** — which has no property link and no `operator_id`, and
carries **196 `DaVita Dialysis` + 179 `Fresenius Medical Care`** rows spelled exactly as `dia_operator_aliases` already
maps them. The tick's text fallback never consults that alias table. New row **ID2b-caps-2** with prompt
`prompts/ID2bcaps2-sf-staged-comps-operator-resolution.md`: resolve the SF-staged arm through the aliases (or give it a
guarded `operator_id`), plus the invariant this class needs — **no two live band facts may share a display label** — as
a test. Audit doc `ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md` has an addendum recording the failed gate; its
original claim was left intact.


> **📦 ARCHIVE (2026-09-14, twelfth span):** a further run of 2026-09-12 entries was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail4.md`](../history/STATUS_claude-code_2026-09-12_tail4.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.
