# STATUS archive — Claude Code queue, 2026-09-11 (OWN-T0j → BUY0 Phase 0)

Moved **verbatim** out of `docs/claude-code/STATUS.md` on 2026-09-12 to keep that file under its line budget
(`test/status-line-budget.test.mjs`, 2,500 lines). Nothing was reworded, summarised or dropped: this is a
contiguous span lifted whole. Every still-open item named below is tracked in `docs/os/PLANNED-BACKLOG.md`,
which remains the canonical open-work list — read that first, and treat this file as the narrative record of
how those rows came to exist.

Covers 10 entries, from *2026-09-11 — OWN-T0j shipped: gov OWN-T0a disagreement split into `sponsor_family_confirmed` vs `unclassified_rival`* to *2026-09-11 — BUY0 cont.: Geller Phase 0 deliverables shipped; living-engagement design + sourcing audit added to spec*.

---

## 2026-09-11 — OWN-T0j shipped: gov OWN-T0a disagreement split into `sponsor_family_confirmed` vs `unclassified_rival`

Built the cross-database classifier the prompt above asked for. **Node-layer job, not SQL** — gov's
`v_ownership_transitions_portfolio` (project `scknotsqkcheojiaewwh`) and LCC Opps'
`lcc_ownership_sponsor_family` (project `xengecqvemvfknjvbvrq`) are separate Supabase projects; no SQL
join is possible between them.

**Shipped:**
- `api/_shared/ownt0j-sponsor-classifier.js` — pure functions (`normalizeGovNameKey` is a byte-for-byte
  JS port of gov's own key expression from `v_ownership_transitions_portfolio`'s view def, confirmed by
  reading `pg_get_viewdef` live; `classifyDisagreement`/`classifyDisagreementBatch` do the split).
- `api/_handlers/ownt0j-sponsor-classify-tick.js` — GET dry-run (reads both sides, classifies, no
  writes), POST writes the cache (paged at 1000/PostgREST's hard cap on both the gov and ops reads).
  Wired in `api/admin.js` (`case 'ownt0j-sponsor-classify-tick'`) and `server.js`
  (`/api/ownt0j-sponsor-classify-tick`).
- Migration `supabase/migrations/20260911190000_lcc_own_t0j_sponsor_disagreement_classifier.sql`,
  **applied live to LCC Opps** — cache table `lcc_ownt0j_sponsor_disagreement_cache` (default grants
  revoked from `public`/`anon`/`authenticated` per the B6d/OCR2 lesson, verified with
  `has_table_privilege`), reporting view `v_lcc_ownt0j_sponsor_disagreement_report` (plain view, no
  SECURITY DEFINER function — nothing here needed elevated privilege, so the definer-privilege stanza
  rule doesn't apply), and cron `lcc-ownt0j-sponsor-classify-refresh` at `39 */4 * * *` (OWN-T0e's own
  4-hourly cadence, offset 12 minutes to avoid two ~5,000-row cross-source jobs landing in the same
  minute).
- Test `test/own-t0j-sponsor-disagreement-classifier.test.mjs` — 11 tests, spot-checked against two
  mutations (both went RED: removing the `confirmed_at` guard, removing the substring-match line).

**Real measured counts (live, both projects, 2026-09-11):**
- Reproduced the OWN-T0a comparison exactly as specified: **5,133 comparable / 2,462 disagree**
  (drift from the brief's 2,510 is normal re-measurement noise, not a defect — population definition
  identical). Restricted to `gsa_lease_diff`/`acquisition`: 3,523 comparable / 1,641 disagree (brief:
  3,523 / 1,648 — matches almost exactly).
- LCC Opps `lcc_ownership_sponsor_family` currently holds **21 confirmed rows / 18 distinct tokens**
  (agree, arc, boyd, briarcliff, east, elliott, gip, gov, greenleaf, highwoods, jlb, kilroy, ngp,
  rainier, rxr, sunflower, uirc, wmc).
- Classified against the full 2,462-row disagreement population: **`sponsor_family_confirmed` = 482
  (19.6%)**, **`unclassified_rival` = 1,980 (80.4%)**. Both counts reported, not just the residual.
- **Positive control — Boyd Watterson:** all 192 gov properties whose disagreeing true_owner name-key
  contains the confirmed token `boyd` classify **entirely** `sponsor_family_confirmed` (0 leak into
  `unclassified_rival`, as required — the match is by construction). Restricted to
  `gsa_lease_diff`/`acquisition` alone: 115 (close to the OWN-T0e investigation's quoted "~111";
  the small gap is a population-definition detail, not a defect).
- ⚠️ **Precision caveat, stated honestly, not swept under the 19.6%:** the confirmed token `gov` (2
  entities: "gov san antonio", "gov ft myers") is a 3-character substring that will match ANY
  true_owner name containing "gov" anywhere — a real precision risk for a token this generic, distinct
  from the Boyd/UIRC/NGP/Highwoods cases where the token is a genuine surname/brand fragment. Not
  fixed here (matches spec: port the classification rule as designed, report what it does — this is
  new information for whoever curates future sponsor-family confirms, not a defect in this build).

**What this is NOT:** it does not touch gov's `properties.true_owner_id` or `ownership_history`, does
not build a second sponsor/SPE confirm mechanism (reads `lcc_ownership_sponsor_family`, routes
genuinely-unclassified pairs conceptually to OWN-T0e's existing `sponsor_family_confirm` lane rather
than duplicating it), and does not re-implement gov's name normalizer independently.

**Deviations from the prompt, stated:** (1) The gov side is fetched via `domainQuery('government', ...)`
against `v_ownership_transitions_portfolio` + `properties` + `true_owners` directly rather than reading
a single pre-joined view, because no such view exists — this matches the two-step read the prompt's own
Step 1 SQL performs. (2) No dedicated "reporting UI" was built beyond the plain SQL view + the cache
table itself, per the "simple reporting view or query a human can run" instruction — no Decision Center
lane, consistent with the explicit prohibition. (3) The live cache table is currently EMPTY — the tick
has not run in production yet because it ships on the next Railway deploy of merged `main` ("merged is
not running" — this repo's own doctrine); the counts above come from a direct one-off measurement run
against both live projects during this session, not from the tick itself, and are reported as such.

Branch: `claude/own-t0j-sponsor-classifier`, pushed to origin (not merged, no PR opened per instructions).

## 2026-09-11 — Not actually a crash: `ownership_linker`'s fix confirmed working live for the first time; one new orphaned-tracker-row gap found, `census_demographics` still failing — filed as `PRI5`

Scott reported the latest CMS ingestion run as "crashed" and sent logs. **It wasn't a crash** — no
traceback, no hang; the process ran its full course and printed a complete, orderly summary. Two pieces
of real good news:

- **`PRI3`'s `ownership_linker` fix is confirmed working live for the first time**: `Properties →
  true_owners: {'from_recorded_chain': 1, 'from_tenant_match': 0, 'from_cms_chain': 6570}` and `Contacts
  → Salesforce: {..., 'by_company': 19}` — real, non-zero linkage counts, versus the original crash where
  all 9 sub-steps failed with every counter at `0`. This is the live-fix proof this arc has been waiting
  on since `PRI3` first shipped.
- The process did **not** hang this time, consistent with (though not proof of) `PRI4`'s daemon-thread +
  `os._exit(2)` mitigation.

**One real, distinct new gap found and filed as `PRI5`**: `ingestion_tracker.start_run` failed after
retries again (same persistent connection instability — expected per `PRI3`'s Section 2 conclusion), but
this time **the pipeline continued anyway and completed successfully**, leaving that run's
`ingestion_tracker` row permanently orphaned (`run_status='started'`, `finished_at=null`, 30+ minutes
later — confirmed live). A live count shows this isn't isolated: **5 of `cms_medicare_clinics`'s
`ingestion_tracker` rows are stuck at `started` forever, out of 118 `success`** — every stuck one traces
to this arc's problem runs. This is a distinct code path from `PRI4`'s catalog (which covered the
*preflight-abort* exit only) — this is the *pipeline proceeds and finishes normally after `start_run`
itself failed* path, never revisited to close its own tracker row.

Also filed in `PRI5`: `census_demographics` failed again (`PRI3`'s still-unresolved catalog item (g),
recurring rather than a one-off), and the same all-zero-counters + "not recorded" warning `PRI3` called
"two conflated but benign phenomena" — asked the next round to re-confirm that conclusion against this
specific run rather than re-assert it, since it keeps recurring in the identical shape.

Prompt: `docs/claude-code/prompts/PRI5-orphaned-tracker-row-on-start-run-failure-and-census-demographics.md`.
Not urgent — the pipeline is genuinely producing real writes now — but worth closing since this arc has
leaned on `ingestion_tracker` for run-timing correlation throughout, and orphaned rows undermine that.

## 2026-09-11 -- all three recommended next steps done: OWN-T0j prompt drafted, OWN-T0e confirm-lane gap found (not forced), AC11 re-measured (still 0, now explained)

Scott: "let's do it all in the order you recommend" (build the gov-side classifier; prioritize OWN-T0e confirms
on the big sponsors; re-measure AC11). Did all three.

**1. OWN-T0j prompt drafted and sent to CC** (`docs/claude-code/prompts/OWN-T0j-gov-side-reconciled-classifier.md`).
Scoped from the 2026-09-11 OWN-T0a re-measurement directly -- reuses the exact comparison query, points at
OWN-T0e's cache-table shape as the architecture template, and is explicit that this has to be a cross-database
Node job (the sponsor registry lives in LCC Opps, the comparison population lives in gov -- no SQL join is
possible). Explicit "do not build a sweep that forces agreement" guardrail, citing OWN-T0/RO2's prior refusals
of the identical shape.

**2. OWN-T0e confirm-lane prioritization -- investigated before forcing anything, and the investigation is the
finding.** Checked whether the 22 gov-side sponsors with >=5 disagreeing properties (from the 2026-09-11
measurement) are even reachable through OWN-T0e's existing confirm lane before confirming any of them. Only 4
of 22 appear in `lcc_ownt0e_sponsor_family_proposals_cache` at all, each at a small fraction of their gov-side
count (Gardner Tanenbaum: 32 gov-side properties vs 1 in the LCC cache) -- live, concrete confirmation of the
already-filed `OWN-T0b` gap (no LCC mirror of the domain's transition chain): the two populations barely
overlap, so confirming through this lane, however many sponsors get confirmed, cannot move OWN-T0a's number.
That alone is why `OWN-T0j` (a build that reads gov's population directly) is the right next step, not more
confirms. Of the 4 that do exist as candidates, none were blind-confirmed -- each had a specific reason not to:
`Realty Income Corporation` is a flagged generic token, `Elman Investors`'s only SPE name IS itself a hedge
phrase (`OWN-T0i` material), `Gardner Tanenbaum Holdings`'s SPE name looks like a same-party name variant (a
merge question, not a family confirm), and `USAA Real Estate` is a single property, immaterial either way. All
four left for a human on OWN-T0e's own lane.

**3. AC11 re-measured -- still zero, and now the finding is specific.** `entity_relationships` carries 0 rows
of type `llc_member`/`llc_manager`, fleet-wide, nine days after `PR-scanner-2` shipped the writer. This is not
the producer being broken -- it's a forward capture-path fix that only fires when someone actually scans an
SOS/bizfile page through the extension, and nobody has done that yet since it shipped. So the population is
correctly zero today; it isn't evidence the fix doesn't work, and re-checking on a calendar basis again won't
change that -- the next real re-measurement should follow the first live SOS scan, not another date.

**Docs**: `PLANNED-BACKLOG.md` -- new `OWN-T0j` row, `AC11` row appended with the re-measurement. **⚠️ Branch
note**: local `main` in this session's clone is stale (git fetch/pull fails here, the standing proxy
limitation) -- `docs/own-t0a-reinvestigate`'s local ref shows "behind origin by 6 commits," meaning more has
landed on that branch name upstream than this session can see. This entry's new commit is built on this
session's last-known-good local tip of that branch; reconcile against the real origin state before merging,
not assumed clean.

**Next step.** `OWN-T0j` needs a Claude Code build session to pick it up. `AC11` stays filed, waiting on real
SOS-scan usage rather than a rebuild. `B1b` (developer chain, gated behind `B5`) remains the one entirely
untouched item on the ownership/contact-propagation thread.
## 2026-09-11 — MB-a: MB1/MB2 market-brief producers built (dialysis lane), flags OFF, NOT live-verified

Branch `claude/sweet-gates-83wyu7` → PR (see docs). Built `MB1` (P-SQL, `api/_handlers/market-brief-psql-tick.js`)
and `MB2` (P-RSS, `api/_handlers/market-brief-rss-tick.js`) per `prompts/MBa-market-brief-producers-dialysis.md`,
producers only — no rendering, no email, no UI, no cloud-model calls. Migration
`20260911180000_lcc_mba_market_brief_producers.sql` adds `market_brief_facts.fact_key` (+ a partial unique index
scoped to `status='live'`, the identity a source-url-less SQL derivation needs — EB1's own
`uq_mbf_source_identity` only fires when `source_url`+`source_date` are both present), registers
`MARKET_BRIEF_PSQL`/`MARKET_BRIEF_PRSS` in `feature_flags_registry` (both `off`), and schedules both crons
(guarded `NOT EXISTS`, not flag-gated — the P138 pattern: an unscheduled job is invisible even when its flag is
off). New shared modules `api/_shared/market-brief-facts.js` (fact builders + the pure `decideFactWrite`
supersede/skip/conflict decision + the RSS verbatim-number check) and `api/_shared/market-brief-rss.js`
(extraction prompt/parse/verbatim-filter, fails closed with no cloud fallback — mirrors the OC2/Analyst's-Take
on-box pattern). 74 new tests (`market-brief-facts.test.mjs`, `market-brief-rss.test.mjs`,
`market-brief-tick-handlers.test.mjs`), all fixture-based, no network. Full suite 5,890/0/6-skipped.

**Measured (repo-only, no live Supabase/Railway reach this session):** dia sources wired are
`sales_transactions` (TTM cap-rate band, per-operator with a 5-comp floor, and trades-since-last-run),
`v_dia_on_market` (on-market count + median ask cap), `medicare_clinics` (top-8 operator counts + net-change vs.
prior run). **NOT wired:** `cortex_market_intel` (writer still unlocated across two sessions — new row **MB1a**)
and gov GSA lease events (dialysis-first per the prompt). CMS "closures" are a count net-change, not a real
open/close event feed — no termination/status column could be confirmed from the repo (new row **MB1b**).
PLANNED-BACKLOG §P18 rows MB1/MB2 updated with the full source list, gaps, and the exact live-verify steps.

**What could NOT be done here, per this repo's own doctrine (dry-run-first, verify-live-then-flip):** running
either tick against live Supabase/Railway, confirming `v_dia_on_market`'s actual column names (the GET dry run's
`gaps[]` array is designed to surface a 400 there before any POST), the before/after `v_market_brief_staleness`
snapshot for the dialysis lane, and sampling 5 real facts with citations. **Next: an operator/session with live
reach runs the GET dry run for both ticks, reads `gaps[]`, runs one POST with the flag forced on, reports the
five things above, then flips both flags and confirms the cron minutes (`7:15`/`10:10` UTC, picked without
reach to `cron.job` — check for a collision before relying on them).**

## 2026-09-11 — OC-a reconciled (PR #2298 merged): funnel built, NOT yet a live loop; MB-a prompt drafted

Processed `responses/OC-a desktop response.docx` → `done/`; prompt → `prompts/done/`. OC-a shipped EB1a (applied
live: 16 facts, staleness view 20 cells) + OC1 (endpoint, in-app Note button, MCP `log_operator_note`, Outlook
`LCC-Note` — regex bug that silently dropped the category fixed), OC2 (triage tick, deterministic + Ollama, flag
OFF), OC3 (OPERATOR-INBOX render + `get_operator_inbox` + session-start hook). 62 new tests, 5,839/0.
**Live measurement (Cowork, read-only):** `operator_notes` = 0 rows; `OPERATOR_NOTE_TRIAGE` **absent** from
`feature_flags_registry` (flag-flip step must insert it); no pg_cron job for the tick; the connected LCC MCP
exposes neither new tool after refresh → **standalone MCP not redeployed**. Fixed `CURRENT-STATE.md` (claimed
the hook was not wired — it is). New backlog row **OC-v** collects the six operator steps; `OPERATOR-ACTIONS.md`
OCa rows annotated. **Next:** Scott redeploys both Railway services + runs OC-v; Claude Code gets
`prompts/MBa-market-brief-producers-dialysis.md` (does not depend on OC-v or EB1b).

## 2026-09-11 — BUY0 cont.: Geller Round 1 sourcing — 1,683 exported rows → 213 in-metro industrial → Focused 24

Cowork. Scott's CoStar / CREXi ×5 / Salesforce Comps exports normalized, metro-assigned on OMB county lists,
de-duped and screened; preliminary Derived leg scores; delivered `Jordan Geller - Buyer Showing - Sep 26 (Round 1
draft).xlsx` (Focused = top 8 per DFW / Austin / Charlotte). Spec §4.6 records the import pipeline + per-source quirks;
seed scripts saved to the client Data folder. Austin supply is thin (11 industrial) → re-pull requested.
## 2026-09-11 — OC-a: operator funnel v1 shipped — EB1a applied live, intake + triage + inbox built

`prompts/OCa-operator-funnel-v1.md` executed end to end on branch `claude/oca-operator-funnel-v1`.

**EB1a — applied live to LCC Opps** (was not applied per the 2026-09-11 reconcile note): all 5 tables +
2 views verified present via Supabase MCP; the dialysis exemplar's 16 facts inserted (11 `[UNVERIFIED]`
items correctly excluded); `v_market_brief_staleness` returns 20 (lane, section) cells, 5 populated /
15 `is_missing` (only the `dialysis` lane has facts yet — expected, MB producers are unbuilt). Re-run is
idempotent (the migration's own `uq_mbf_source_identity` unique index — not re-verified by a second
insert in this session, but the constraint is live).

**OC1 — intake v1, three of four channels built:**
- **In-app Note button** (`operator-note-client.js`, mounted in `index.html`): floating button + one-
  textbox modal on every page, auto-captures `route` (hash), open entity id/type (best-effort off
  `_detailStack`), and the last 10 client-side errors (a small ring buffer added to `index.html`'s
  existing global error handler). POSTs to `POST /api/operator-notes`.
- **MCP `log_operator_note`** (`mcp/server.js`), sibling of `log_memory`, same auth/session shape.
  Write tool, no HTTP route (matches `log_memory`'s Claude/MCP-only convention).
- **Outlook** (`intake-tagged-comm.js`) — **dormancy diagnosed and fixed, not just diagnosed.** The
  pre-existing `LCC`/`LCC:<hint>` category gate (`parseLccCategoryHint`, regex `^lcc$` / `^lcc[:=](.+)$`)
  structurally could never match a category literally named `LCC-Note` (the hyphen fails both patterns)
  — every note tagged that way has always silently fallen through to `no_lcc_category` and been dropped.
  This is a DIFFERENT, narrower defect than the broader "6 rows ever / dormant since 2026-08-07" finding
  the 2026-09-11 reconcile recorded for the whole tagged-Outlook flow — that finding is about whether the
  PA category-assigned trigger itself still fires at all, which this fix does not by itself prove (needs
  a live post through the flow — see OPERATOR-ACTIONS.md). Added a second arm: a plain reply (`Re:`) to a
  recognizable briefing subject with no LCC tag at all, per the contract's `outlook_reply` channel.
- **Teams**: endpoint-ready only (`/api/operator-notes` accepts `channel:'teams'` authenticated via the
  existing `PA_WEBHOOK_SECRET` pattern, mirroring `intake-tagged-comm.js`'s `authenticateWebhook()`
  exactly) — the PA flow itself is an operator step (OPERATOR-ACTIONS.md), no bot built.

**OC2 — triage tick built and flag-gated OFF** (`OPERATOR_NOTE_TRIAGE`, `/api/operator-triage-tick`,
GET=dry-run/POST=apply). Deterministic rules first (error signatures → bug, "stuck loading" →
not-connecting, "missing/no data" → data-gap, "would be nice"/idea language → idea, "confusing"/"hard to
find" → ux, trailing `?` → question); on a miss, falls to on-box Ollama (`invokeOnPremGeneration` — fails
closed, no cloud fallback, matching `briefing-analyst-take-tick.js`'s pattern) for type/lane/severity/
title. Dedupes against prior open notes (Jaccard token overlap ≥0.5) AND a generated PLANNED-BACKLOG
index (`scripts/generate-operator-note-backlog-index.mjs` → `docs/os/operator-note-backlog-index.json`,
181 rows parsed). Routes via `docs/os/operator-note-routing.json` (7 threads seeded from the spec's own
list). Logs to `producer_runs` (`producer='operator_triage'`) on the P123 open-before-work lifecycle.
An unclassified note stays `open` with a named reason — never guessed at.

**OC3 — the one to-do list built.** `scripts/render-operator-inbox.mjs --write` renders
`docs/os/OPERATOR-INBOX.md` (GENERATED header) from `operator_notes`, grouped by `routed_to` thread
(severity-sorted within a thread, unrouted last). MCP `get_operator_inbox` read tool (+ `/api/operator-
inbox` HTTP route for ChatGPT/Copilot) reads the identical query, so every surface sees the same list.
Not yet wired into `.claude/hooks/session-start.sh` or `NEW-CHAT-KICKOFF.md` — filed as a follow-up
(the render script itself is done and tested; the hook wiring is a one-line addition once a live
Railway deploy exists to read from).

**What was NOT done, per the spec's own scope fence:** no market-brief producers/rendering/email
changes; no cloud-model calls anywhere in triage; no canon edits; PLANNED-BACKLOG promotion from an
inbox item stays a manual session-loop step. **Also deferred, stated plainly:** the live multi-channel
verification (§6 — post one note through each channel, run the tick with the flag on, confirm a fresh
inbox) could not be completed in this session — it needs a live Railway deploy of this branch's merged
`main`, which has not happened yet. `OPERATOR_NOTE_TRIAGE` therefore stays off in
`feature_flags_registry` until that live verify runs.

**Tests:** 62 new (`test/operator-notes.test.mjs` 34, `test/operator-triage-tick.test.mjs` 6,
`test/operator-inbox-render.test.mjs` 8, `test/operator-note-outlook-channel.test.mjs` 8, plus fixing
one pre-existing guard — `mcp/server.js`'s `READ_ONLY_HTTP_TOOLS` allowlist needed `get_operator_inbox`
added, caught immediately by `test/chatgpt-curated-spec.test.mjs`). Full suite: **5,839 pass / 0 fail /
6 skipped** (pre-existing skips, unrelated).

PR opened: branch `claude/oca-operator-funnel-v1` → `main`. Not merged (CI + Scott's call).
## 2026-09-11 — PRI4 merged and deployed live; no new prompt needed — next step is another live test run

Scott confirmed `Dialysis` PR `#7407` merged and the redeploy live. `PLANNED-BACKLOG.md`'s `PRI4` row
moved to ✅. **Not yet independently re-verified** — this fix hasn't been proven against a real run yet,
same discipline as every other round in this arc (a green PR is not the same as a proven fix).

**No new prompt is warranted right now.** Everything currently open in this arc — `PRI3`'s original
live-fix proof (never exercised because every run so far died before reaching those call sites) and
`PRI4`'s own open questions (the (b) tracker-close discrepancy, (c)'s unconfirmed root cause) — is best
answered by **triggering another CMS ingestion run and watching what actually happens**, not by more
code-reading. Recommended to Scott: trigger the run now. On the next report-back, verify directly against
Dialysis_DB: does `facility_patient_counts`'s preflight step now succeed or retry-and-recover instead of
failing outright; does the run get **past** preflight this time (the first real test of `PRI3`'s fixed
call sites); if it still hits trouble, does the process now exit promptly via the new `os._exit(2)` path
instead of hanging; and does whichever `ingestion_tracker` row this run creates actually close out
(`finished_at` set, `run_status` not stuck at 'started') — directly answering the (b) discrepancy this
round couldn't resolve from the code alone.

## 2026-09-11 -- OWN-T0a re-investigated: the finding changed shape, nothing built, a real decision surfaced for Scott

Picked OWN-T0a (gov's own 43.4% recorded-transition-grantee vs true_owner_id disagreement) as the next lever
per the ownership/contact-propagation thread. Read the source audit first (OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md,
per this repo's own citation doctrine), then re-measured live against scknotsqkcheojiaewwh rather than re-quoting
the 2026-09-02 number.

**Re-measured, still real and if anything slightly larger**: plainest replication reads 48.9% (5,133 comparable /
2,510 disagree) today vs 43.4% nine days ago -- consistent with population growth from ongoing ingestion, not a
regression. The gsa_lease_diff/acquisition-restricted population (3,523 comparable) lands closest to the original
3,474 and disagrees at 46.8%.

**Read the actual disagreeing rows -- same sponsor<->SPE shape OWN-T0's own audit already named** (e.g. property 180:
"GOVERNMENT PROPERTIES INCOME TRUST LLC" the SPE/transition-grantee vs "RMR" the sponsor/true_owner -- both true).
Ruled out the boring explanations: only 3.3% tombstoned true_owner rows, only 2.2% hedge-phrase owner names
(OWN-T0i's class). The sponsor population is a long tail -- 1,163 distinct sponsor names, only 22 with >=5
properties each (21.4% of the disagreement) -- not concentrated the way OWN-T0e's boyd-family case was.

**The real finding: OWN-T0e's sponsor-family confirms do not move this metric, even for big already-confirmed
names.** Boyd Watterson (confirmed 2026-08-27), UIRC (2026-09-09/10), NGP (2026-09-09), Highwoods (2026-08-27) are
all live rows in lcc_ownership_sponsor_family -- and still read 111, 24, 14, and 5 disagreeing gov properties
respectively today. The confirm only changes how the LCC-facing reconciled view classifies the conflict; it never
touches gov's properties.true_owner_id or the transition grantee, which is what OWN-T0a's raw comparison reads.
So OWN-T0a as defined can never reach zero, and a fix that forced the two sides to agree would be wrong -- the
same conclusion OWN-T0 (LCC side) and RO2 (gov's own v_ownership_resolution vs true_owner, an adjacent store)
already reached on this identical shape.

**Nothing built.** The correctly-scoped fix is a measurement fix, not a sweep: a domain-side reconciled view
(gov mirror of v_lcc_property_ownership_reconciled's conflict_class logic, reading the existing
lcc_ownership_sponsor_family registry) that would split the flat 43-49% into "sponsor_family_confirmed" (expected,
not a problem) vs a genuinely unclassified residual -- turning an alarming-looking number into an honest, much
smaller one. That's real scope, so it's surfaced to Scott as a decision rather than assumed or built blind.

**Docs**: PLANNED-BACKLOG.md OWN-T0a row rewritten with the re-measurement, the root-cause read, and the OWN-T0e
non-effect finding; cross-referenced to OWN-T0e, OWN-T0i, and RO2.

**Next step.** Waiting on Scott: build the gov-side reconciled classifier, prioritize OWN-T0e confirms on the 22
big-population sponsors even though it won't move this specific metric (it does fix what brokers actually see in
the LCC panel), or move on to AC11's population re-measurement instead.

## 2026-09-11 — BUY0 cont.: Geller Phase 0 deliverables shipped; living-engagement design + sourcing audit added to spec

Cowork session (Jordan Geller 2026 industrial search). Delivered to the client folder: `Jordan Geller - Industrial
MSA Ranking - Sep 26 (Draft v2).xlsx` (75 MSAs × 15 public factors — Census PEP V2025, ACS 2024, BLS QCEW 2019/2024,
Tax Foundation 2026, CNBC Top States 2026; editable weights) and `Jordan Geller - Buyer Showing - Sep 26.xlsx`
(lightweight client file on the Team Briggs Buyer Showing Template: static Market Ranking tab 1 + Focused / Broad
Market / Passed with Credit / Lease / Real Estate leg scoring). Both restyled to BDPS (`bov_constants.py` palette,
Calibri, role heights). Spec `BUYER-ENGAGEMENT-MODULE-SPEC-v0.1.md` gained §4.4 (living engagement = reuse deal
spine + W7 matcher/propagation + Ollama proposals, no parallel pipeline), §4.5 (sourcing audit: email alerts lack
location → **BUY-G1**; no SF path for industrial `Comp__c` → **BUY-G2**), §6a (Scott's answers: files-in-folder,
query-on-demand, three-leg scoring, rent evidence hierarchy) and §7a (egress: census/bls/bea blocked from sandbox
and local shell). **Next:** top-3 markets (DFW, Austin, Charlotte) sourcing — Scott exports CoStar/LoopNet/RCA + an
SF report; Claude normalizes into Broad Market. No build authorized yet.
