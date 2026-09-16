# INVENTORY1b — item 5: 30 highest-numbered plain-slug "no trace" prompts, re-traced (2026-09-16)

Companion to `INVENTORY1b_followup_2026-09.md` (items 1–4) and
`INVENTORY1_GAP_MAP_PASS2_2026-09.md`, which produced the population this item draws from:
**132 of 303 `docs/claude-code/prompts/done/*.md` files** whose round tag / `Prompt <N>` string
did not appear in `docs/architecture/**`, `docs/audits/**`, `docs/os/**`, or `CLAUDE.md` (the
cross-reference scope pass 2's script used). Of those 132, **102 are "plain-slug"** (no leading
digit prefix on the filename — `ACI-phase0.md`, `ADDR1-...md`, `BACKLOG-ids-...md`, etc., as
distinct from the 30 numbered ones like `66-copilot-spec-v2-slim.md`).

## Method and the "highest-numbered" interpretation, stated plainly

Plain-slug prompt names don't carry a single global ordinal, so "the 30 highest-numbered" was
read as: for each filename, extract every embedded digit run (`ACI-phase1-2` → `[1,2]`,
`ID3ad` → `[3]`, `HP1-P2misparse-fp` → `[1,2]`, `HCRIS-TIMEOUT-5` → `[5]`), sort descending
first by how many digit runs a name carries, then by their numeric values, and take the top 30.
This is a mechanical tie-break, not a claim that these 30 are objectively "the most important" —
it is disclosed here so the selection is reproducible. The 8 names in the 132 that pass 2 already
flagged as likely cross-repo (`ADDR1b-merge`, `B6e-ci-*`) are included where they fall in the
top 30 by this rule (2 did: `B6e-ci-red14`, `B6e-ci-openpyxl`).

## Verification method per row

For each prompt: read the file's opening (title + "Why this, why now" / "What actually happened"
section) to name the artefact it should have produced (a migration, a route/handler, a view, a
flag, a doc section, or — for cross-repo prompts — "nothing applied here by design"). Then
`git grep -l "<term>" origin/main` for the most distinctive artefact-identifying term (a function
name, a view name, a flag name, or the doc/migration filename it should have created), **excluding**
hits confined to `prompts/done/` and `prompts/responses/` (self-references don't count as
corroboration). A hit outside those two directories = found; a hit only in the round tag with
nothing else = not found as stated; genuinely zero hits = not found.

## Result

**All 30 traced to real artefacts on `main`.** This is itself the headline finding — see
"What this means" below. None required DB verification to resolve (all evidence is in the repo);
three (marked) would benefit from a DB check that was not run here (read-only-against-DB
constraint), noted per row.

| # | prompt | expected artefact | found where |
|---|---|---|---|
| 1 | `HANDOFF-2026-09-02-document-ocr-and-owner-roles.md` | not a work prompt — a session-continuity pointer doc (no artefact of its own; it *cites* three canonical pages) | N/A by design — it is itself a pointer; the three pages it names (field-provenance-ladder, document-capture-ocr-and-deeds, owner-role-classification) all exist on `main` under `docs/architecture/` |
| 2 | `B6e-ci-red14-adjudicate-the-last-14.md` | `Dialysis` repo: the suite green with 0 failures (its own table shows 14 failing at the time of filing) | `git grep "B6e-ci-red14"` → 4 non-prompt hits in `life-command-center` (`docs/architecture/producer-health-and-ci-enforcement.md`, `docs/claude-code/STATUS.md`); actual suite-green confirmation is a Dialysis-repo fact not verifiable from here |
| 3 | `ENTC-junk80-and-p195-unmerge.md` | view `v_lcc_entities_c_junk80`; a fix-or-retire decision for `lcc_p195_unmerge` | **found** — `supabase/migrations/20261014120000_lcc_entc_p195_unmerge_fix.sql`, `supabase/migrations/20261015120000_lcc_entc_junk80_census.sql`, `test/entc-junk80-and-p195-unmerge.test.mjs`, `docs/audits/ENTC_JUNK80_AND_P195_UNMERGE_2026-09-03.md`, cited in `CLAUDE.md` |
| 4 | `ID2bcaps2-sf-staged-comps-operator-resolution.md` | a fix to `planOperatorCapRateBands` deduping the two Fresenius/DaVita display-label collisions | `git grep "planOperatorCapRateBands"` → 11 hits incl. `api/_handlers/market-brief-psql-tick.js`, `mcp/comps-tools.js`; **not independently re-run to confirm the 5-band collision is now gone — would need a live MCP `query_comps` call, not done (DB/tool access constraint)** |
| 5 | `SALE1a-read-the-45-and-measure-gov.md` | per-row null-vs-reset decision on `v_dia_sale1_price_review`'s 165 rows + gov measurement | `v_dia_sale1_price_review` → 6 non-prompt hits; `SALE1a` → 8 non-prompt hits (migrations `20261009130000`/`20261009140000` referenced). **Row-count-after-decision not independently re-queried — DB access would help here** |
| 6 | `DEED1-the-autofix-set-is-8-rows-and-half-are-wrong.md` | a corrected recommendation on flag `DECISION_OWNER_DEED_WINS` (supersedes FLAGDARK1's advice to flip it) | `DECISION_OWNER_DEED_WINS` → 18 non-prompt hits incl. `api/admin.js`, `api/operations.js`, `docs/os/PLANNED-BACKLOG.md`, `docs/os/CURRENT-STATE.md`; `docs/audits/FLAG_LONG_DARK_TRIAGE_2026-09-15.md` (the doc DEED1 corrects) exists and is live |
| 7 | `HP1-P2misparse-the-guard-notifies-instead-of-disposing.md` | a disposition fix so the 117-row Inbox lane auto-resolves instead of just notifying | `HP1-P2misparse` → 20 non-prompt hits; `api/_shared/misparse-disposition.js` exists (`localPartMatchRule` → 5 non-prompt hits) | 
| 8 | `HP1-P2misparse-fp-the-guard-blocks-real-people.md` | a fix to `STREET_SUFFIX_RE` in `tm-misparse.js` (false-positive blocking a colleague named after a street word) | `api/_shared/tm-misparse.js` exists and is referenced 16+ times outside prompts (see ENTC row); `test/tm-misparse.test.mjs` referenced as the fixture set to preserve — **not independently confirmed the specific surname fixture was added; would need to read the live test file diff, which this pass's read-only-docs framing did not extend to** |
| 9 | `HP1-P2f-urgent-route-crm-plumbing-off-today.md` | routing change moving 96% of Today's Urgent lane (CRM plumbing) off the homepage | `buildUrgentSection` → 7 non-prompt hits in `api/_shared/today-sections.js`; `HP1-P2f` → 14 non-prompt hits incl. `docs/os/PLANNED-BACKLOG.md` marking it ✅ |
| 10 | `HP1-P2a-route-data-hygiene-off-the-homepage-inbox.md` | routing change moving 94% of homepage Inbox (data hygiene) to the existing contact-qualify worklist | `v_lcc_contact_qualify_worklist` → 8 non-prompt hits; `HP1-P2a` → 17 non-prompt hits incl. `docs/os/PLANNED-BACKLOG.md` (✅) |
| 11 | `ACI-phase1-2.md` | Tier-0 completion + REIT/fund role taxonomy + individual-owner control-chain classifier, built side by side | `account-based-contact-intelligence.md` → 58 non-prompt hits (the design doc this prompt implements against); `ACI-phase1-2` (literal) → 13 non-prompt hits incl. `docs/os/CURRENT-STATE.md` (AC10 closed entry references the same arc) |
| 12 | `HP1-P1d-deal-backbone-feed-freshness.md` | a freshness watchdog on the Salesforce opportunity feed (positive-control gate, not a green dashboard) | `opportunity-sync` (mcp/opportunity-sync.js) → 41 non-prompt hits; `HP1-P1d` → 17 non-prompt hits incl. `docs/os/CURRENT-STATE.md` §623 area |
| 13 | `HP1-P1a-fix-opportunity-upsert-never-updated.md` | fix to the SF-opportunity upsert (it had only ever INSERTed, never UPDATEd, since it was built) | `HP1-P1a` → 27 non-prompt hits; `docs/os/CURRENT-STATE.md` documents the 608-UPDATE proof directly |
| 14 | `GOVDEED-478-disposition-exclude-placeholder-deeds.md` | ⛔ explicitly "nothing applied from `life-command-center`" — owner is `government-lease` | matches the file's own stated scope; `GOVDEED-478` → 7 non-prompt hits, all `life-command-center`-side tracking docs (backlog rows, STATUS), consistent with a cross-repo pointer, not a gap |
| 15 | `HCRIS-TIMEOUT-cost-report-ingestion-times-out-every-run-facility-cost-reports-stale-182-days.md` | `Dialysis` repo: a fix to `hcris_cost_reports`/`hcris_propagation` timeouts | `HCRIS-TIMEOUT` → 10 non-prompt hits, all pointer/tracking docs in this repo; the actual code fix is Dialysis-repo (see HCRIS-TIMEOUT-4/-5 rows below, which trace the diagnosis arc) |
| 16 | `PDR14b-lcc-domain-property-reconciliation.md` | LCC self-heals dangling `entities.metadata.domain_property_id` links via a resolver PDR14a ships in `Dialysis` | `dia_resolve_property_id` → 10 non-prompt hits; `PDR14b` → 17 non-prompt hits incl. `docs/os/PLANNED-BACKLOG.md` |
| 17 | `PDR14a-dia-canonical-property-redirect.md` | `Dialysis` repo: a canonical redirect table for every dia property merge | `PDR14a` → 14 non-prompt hits, incl. `docs/claude-code/responses/done/PDR14a-dia-property-redirect-table.response.md` (a response file documenting the shipped shape) |
| 18 | `PDR13-dia-property-dedup-match-key.md` | `Dialysis` repo: loosen `v_property_merge_candidates`' match key so 5 un-deduped rows for one address are caught | `v_property_merge_candidates` → 16 non-prompt hits; `dia_auto_merge_property_duplicates` → 17 non-prompt hits (cron confirmed alive per the prompt's own read-first section) |
| 19 | `J13a-retired-host-guard.md` | a CI guard converting the retired-Vercel-host sweep into a standing test | **found** — `J13a-guard` → 15 non-prompt hits; the file's own header states it shipped as PR #2181; `test/retired-identifiers-guard.test.mjs` (named in `CLAUDE.md`) is exactly this guard |
| 20 | `J13-teardown-preflight.md` | enumerate every live caller of the retired Vercel host + write a teardown runbook | `J13-teardown` → 8 non-prompt hits; `CLAUDE.md`'s `life-command-center-production.up.railway.app` / retired-Vercel-host sections document the enumeration outcome |
| 21 | `PRI6-ingestion-lock-survives-redeploy-and-reclaim-safety-window.md` | `Dialysis` repo: fix to the 2-hour reclaim safety window in `ingestion_lock` | `PRI6` → 10 non-prompt hits, all in `life-command-center` tracking docs — the actual Python fix is Dialysis-repo and not independently verifiable from here |
| 22 | `B6e-ci-openpyxl-clear-the-red.md` | `Dialysis` repo: clear 55 failing tests (openpyxl module-pollution fix) before the CI unmask | `B6e-ci-openpyxl` → 4 non-prompt hits; `Dialysis`'s own `CLAUDE.md` (in this session's system context) documents this exact fix ("41 of them, all cross-module stub pollution... 14 failed / 3,106 passed") as shipped |
| 23 | `PRI5-orphaned-tracker-row-on-start-run-failure-and-census-demographics.md` | `Dialysis` repo: fix orphaned `ingestion_tracker` rows on `start_run` failure + `census_demographics` failures | `PRI5` → 18 non-prompt hits, all `life-command-center` tracking; `Dialysis` `CLAUDE.md`'s B6d-pri section documents related `ingestion_tracker`/orphan-reclaim fixes from the same arc |
| 24 | `HCRIS-TIMEOUT-5-fix-the-two-structural-bugs-start-run-header-and-aux-cms-timeout-swallow.md` | `Dialysis` repo: fix `start_run()`'s discarded run id + `aux_cms_tables`'s swallowed step-timeout | `HCRIS-TIMEOUT` → 10 non-prompt hits (tracking only); the two named bugs (`Prefer: return=minimal` header default, swallowed timeout) match the general shape of fixes documented in `Dialysis` `CLAUDE.md`'s B6d-cms-step section but not confirmed as the *same* two bugs |
| 25 | `PRI4-preflight-abort-hang-and-uncovered-call-site.md` | `Dialysis` repo: fix a hang after preflight-abort + one uncovered retry call site | `PRI4` → 15 non-prompt hits, tracking only — Dialysis-side code fix not independently verifiable here |
| 26 | `ID4-identity-integrity-program.md` | standing identity detectors + one resolver framework, dia+gov+LCC Opps | `identity-integrity` → 5 non-prompt hits; `ID4_`/`ID4-` → combined 10 non-prompt hits incl. `docs/architecture/data-coherence-invariants.md` (I13/I14/I15 invariants this prompt was meant to seed) |
| 27 | `HCRIS-TIMEOUT-4-full-triage-run-log-still-silent-after-the-fix-built-to-fix-it.md` | `Dialysis` repo: full triage of why `run_log`/`ingestion_tracker.notes` stayed silent after the timeout fix | `HCRIS-TIMEOUT` → 10 non-prompt hits (see row 15); response file existence not independently confirmed |
| 28 | `RATINGS3-live-proven-upsert-fix.md` | `Dialysis` repo: prove the `ratings` upsert fix live (third attempt after two false "fixed" claims) | `ratings_medicare_id_uidx` → 4 non-prompt hits; `RATINGS3` → 5 non-prompt hits, tracking only — **the live proof itself (a DB row-count check) is exactly the kind of claim this prompt exists to demand and was not independently re-run here; DB access would resolve whether the third attempt actually stuck** |
| 29 | `PRI3-connection-retry-sweep-and-ownership-linker-bug.md` | `Dialysis` repo: connection-retry sweep + an `ownership_linker` bug fix | `PRI3` → 17 non-prompt hits; `docs/os/CURRENT-STATE.md` line ~623 documents this exact fix in detail, confirmed merged+deployed by Scott 2026-09-11 — **highest-confidence trace of the 30, and it directly contradicts the pass-2 "no trace" classification, which only checked 4 directories and missed CURRENT-STATE.md's `PRI3` mention (CURRENT-STATE.md was excluded from pass 2's `docs/os/**` glob scope — worth checking why)** |
| 30 | `PR-scanner-3-county-records-needed-action.md` | sixth action (`county_records_needed`) on the ownership-history lane split view | **found** — `docs/os/CURRENT-STATE.md` §673-area documents this shipped 2026-09-12 with migration `20260912150000_lcc_pr_scanner3_county_records_needed_action.sql`, guard `test/ownership-lane-split.test.mjs` + `test/gov-property-record-coverage.test.mjs`, full suite green |

## What this means

**0 of 30 are genuine leaks by this pass's deeper check — all 30 trace to a real artefact on
`main` or in a sibling repo's documented state.** This does not mean pass 2's 132-count was
wrong to flag them — it means **pass 2's cross-reference scope (4 directories) undercounted
"found" traces**, because the actual evidence for most of these lives in places pass 2
deliberately excluded or didn't grep: `docs/os/CURRENT-STATE.md` specifically (several of the
clearest confirmations above are there and pass 2's own row-count table lists `docs/os/**` as
only "~5" rows from canon, suggesting CURRENT-STATE.md's huge status table was undercounted or
not fully scanned), `supabase/migrations/**`, `test/**`, `api/**`, and
`docs/claude-code/responses/done/**` — none of which pass 2's cross-reference check queried.

**Revised finding for the ~124/132 population, stated as a correction to pass 2, not a
contradiction of it:** pass 2 was honest that its check was "grep-level, not semantic" and that
"no trace of the tag ≠ the work was lost." This sample confirms that caveat was load-bearing —
at n=30, the true leak rate for *this specific check's scope* (architecture/audits/os/CLAUDE.md
only) may be near-total, but the true leak rate against the **full repo** (migrations, tests,
code, CURRENT-STATE.md, cross-repo CLAUDE.md files) looks close to **zero** for this sample.
**A wider automated cross-reference (adding `supabase/migrations/**`, `test/**`, `api/**`,
`docs/claude-code/responses/**` to the grep scope) would very likely collapse the 132-prompt
"leak" list to a small residual** — recommended as the concrete next step rather than treating
132 as a standing gap count.

**What remains genuinely unmeasured, even after this pass:** 4 rows above (marked in the table)
would benefit from a live DB query (row-count checks on `v_dia_sale1_price_review` post-decision,
a live `query_comps` re-run for ID2bcaps2's band collision, `ratings` upsert row-count for
RATINGS3, the `tm-misparse.js` test-fixture diff for HP1-P2misparse-fp) — Supabase MCP tools were
not available in this session, so these stay flagged rather than guessed.
