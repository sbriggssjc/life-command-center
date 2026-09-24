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
| **Identity / operator canonicalization (ID-series)** | ID0–ID4, ID2a-cleanup, ID2b, ID2b-caps, ID2b-caps-2, ID3a–ID3e, ID3a-d, ID3d-reconcile, ID3d-b, RECON1 | 2026-09-17 | ID2b-caps-2 + ID3a–e live; ID3d live and its record in this repo (#2539); ID3d-b filed; **property identity now has a concrete §P10a case: RECON1 (one clinic, three rows) + the 27 Harris situs-gap properties** |
| **Market briefs (MB/EB)** | MB1d, MB2a, MB3, MB4, MB5, MB6, MB7, EB1b, P18 | 2026-09-12 | **LIVE**: `MARKET_BRIEF_PSQL` + `MARKET_BRIEF_RENDER` on; the daily email carries the Lane Briefs block (cap-rate bands, on-market, honest CMS staleness gaps, link to `#/briefs/dialysis`), the tab serves live facts, first `market_brief_issues` row frozen. Next: MB2a (the 3 new dialysis RSS URLs all fail 403/404), MB5 P-WEB (blocked on EB1b Anthropic credit), MB6 weekly long-form, MB7 MCP recall |
| **Operator funnel (OC / HP1)** | HP1, HP1-P1a, HP1-P1a-fix, HP1-P1a-dup | 2026-09-12 | HP1-P1a-fix CLOSED live (608 rows UPDATED, first-ever Salesforce UPDATE to `bd_opportunities`); HP1 P0 (Today 500 badge) fixed+deployed+verified |
| **Ownership (OWN/RO)** | OWN-T0a–T0j, RO3, B1b, AC2/AC3/AC6–AC11 | 2026-09-12 | OWN-T0j verified end-to-end live; RO3 field-mapping design drafted; OWN-T0a/B1b/AC-series propagation work still open |
| **CoStar sidebar / public records (PR5/PRI)** | PR5d, PR-scanner-3, PRI2–PRI6, HCRIS-TIMEOUT, HCRIS-TRACKER-BLIND, HCRIS-QIP-DEFICIENCY-TIMEOUT-PATTERN | 2026-09-16 | PR-scanner-3 shipped (`county_records_needed` action); `PRI6` closed ✅ 2026-09-14, both sides confirmed merged — checking on it live is what surfaced `HCRIS-TIMEOUT` (a separate, months-old defect, not a `PRI6` regression). `HCRIS-TIMEOUT` is now **six rounds deep**: root cause isolated 2026-09-16 (`HCRIS-TIMEOUT-4`, two structural bugs, neither HCRIS-specific), both **fixed and pushed same day** (`HCRIS-TIMEOUT-5`, `Dialysis` PR #7413, commit `226f7e3` — confirmed merged and redeployed by Scott). **A fresh post-fix run was triggered and, live-monitored to its actual stop, turned out not to be a hang at all**: `cms-ingestion` spent its full ~4h18m runtime doing real, continuous work — 6,879 properties written via a slow, unbatched `propagate_financials()`→`properties` step — then stopped within a minute of finishing that step, without ever reaching `hcris_cost_reports` or `finish_run()`. (An earlier same-day read of this as a "genuine hang" was wrong, corrected same-day.) **`HCRIS-TIMEOUT-6` (also same day) confirmed the mechanism against the deployed code**: `propagate_financials()` had the identical swallowed-`StepTimeout` bug as `aux_cms_tables` (now closed ✅, confirmed genuinely fixed by this very evidence) plus a real N+1 pattern; fixed, pushed, `Dialysis` PR #7417 — **merge status not yet confirmed by Scott**. `HCRIS-TIMEOUT` stays 🔴, six-plus rounds in. **👤 2026-09-17 update: that fast/cheap live test ran overnight, and the fix didn't work** — the scheduled 06:00 UTC run confirmed via Railway deploy timestamp to be running PR #7417's code still shows no `StepTimeout` after 6h13m and counting (final tally: 9h20m, 10,243 properties, zero `StepTimeout` rows ever). **`HCRIS-TIMEOUT-7` (also 2026-09-17) found the real gap**: round 6's re-raise guards sat on the SELECT-only call sites, but the per-row *write* path (`update_row()`→`safe_execute()`×2 layers) had three of its own bare `except Exception` swallows underneath them, plus a `ThreadPoolExecutor` blocking-shutdown bug that defeated even the inner 30s timeout. Fixed, tested (340 regression tests + 2 new cheap unit-level proofs that don't require a multi-hour run), `Dialysis` PR #7418 — **Scott reports merged; confirmed via Supabase that no new scheduled run has occurred since (next one ~06:00 UTC tomorrow), so live proof is still pending**. `HCRIS-TIMEOUT` stays 🔴, seven rounds in. **Note: the round-7 prompt's parts (b) and (c) — reconciling Railway's "Stopping Container at 7:34:18" event, and confirming the round-6 batching read — were not addressed in CC's response; still open for round 8 if the round-7 fix also doesn't hold.** **👤 2026-09-18 update: round 7's fix also did not hold.** Scott manually triggered a fresh run 2026-09-17 19:07:07 UTC (confirmed running PR #7418's code); it ran **15h38m, wrote 9,986 properties, and was still actively writing when a second scheduled run started 2026-09-18 11:04:55 UTC and cut it off** — same startup burst (17 min, `ratings`/`clinic_quality_metrics`), then **zero errors of any kind, zero `StepTimeout`, for the entire 15h+ run**; `facility_cost_reports` still frozen at 2026-03-16. Scott's own read of the uploaded log tail ("that run finished") does not hold up — the tail shows active `properties` writes continuing to the last second of the slice, not a clean stop; see the dated entry below. `HCRIS-TIMEOUT` stays 🔴, eight rounds in. **👤 2026-09-18 update, same day: `HCRIS-TIMEOUT-8` found the real bug, and it's genuinely different this time.** `propagate_financials_to_properties()` (`src/propagate_property_financials.py`) **was** correctly wrapped in the pipeline's `run_with_timeout()`/`SIGALRM` mechanism all along — that was never broken, settling the question rounds 6–7 left open. The actual defect: the function's own read/write loops (mostly the per-row `properties` write loop, where nearly all wall-clock time goes) catch errors with a bare `except Exception`, which also catches `StepTimeout` — the exact same defect class `HCRIS-TIMEOUT-7` already fixed in `safe_execute()`, just never fixed here because this function bypasses `safe_execute()` entirely and does its own error handling. `TimeoutError: raise` guards added at all 4 sites (clinics fetch, HCRIS cost-reports fetch, batched properties read, per-row write loop). 9 new tests + 49 related + 186 broader sweep, all passing. `Dialysis` PR #7419 (branch `claude/hcris-timeout-8-32203`, commit `c063a94`) — Scott reports merged. **Live proof still pending**: independently checked Supabase — the run in progress as of this write-up (`c8116399…`, started 11:04:55 UTC) started before the merge, so it predates the fix; the next run is the real test. Items (c)/(e)/(f) from round 7/8's carried-over questions (the Railway "7:34:18" event, the batching-read confirmation, the tracker-reclaim wrinkle) were explicitly deprioritized this round in favor of the actual bug — still open, not forgotten. `HCRIS-TIMEOUT` stays 🔴, nine rounds queued pending the next live test. **👤 2026-09-21 update: PR #7419's fix also did not hold, confirmed across four full run cycles now.** Scott triggered a fresh run 2026-09-18 13:07:00 UTC to test the fix live; it ran **16h58m before being reclaimed by the next scheduled run — zero `StepTimeout` rows the entire time**. Three more scheduled runs have completed since (09-19 through 09-21, each 16–24h), and across the combined ~4-day span since the fix landed, **zero timeout errors of any kind have ever appeared in `ingestion_run_errors`** (independently queried, not estimated); `facility_cost_reports` is still frozen at 2026-03-16. A ninth run is in progress now (started 09-21 06:04:50 UTC). `HCRIS-TIMEOUT` stays 🔴, ten rounds queued; see the dated entry below. ⚠️ Separately: a parallel Cowork session's merge (`8cda70b9`, "round8" STATUS/PLANNED-BACKLOG archive) silently reverted this section's `HCRIS-TIMEOUT-5` update back to its round-4 state — restored here; see the dated entry below for the recovery note. One flagged, unbuilt follow-up still queued: `qip_scores_ingestor.py`/`cms_deficiency_ingestor.py` share HCRIS's old bare-timeout bug, still correctly out of scope until the pipeline actually reaches that far. **👤 2026-09-21 (Round 47, Cowork): root cause found and DIA-PROPAGATOR1 overlap resolved (not the same writer)** — both of `cms-ingestion`'s write paths (`ingest_medicare_clinics.py`'s `properties` upserts and `propagate_financials_to_properties()`) have zero compare-before-write logic, so every daily run genuinely rewrites the full dataset in 16–24h; that's why ten rounds of exception-handling fixes never stopped it. See the 2026-09-21 Round 47 entry below and `HCRIS-TIMEOUT`'s row in `PLANNED-BACKLOG.md`. **👤 2026-09-22: the answered `HCRIS-TIMEOUT-9` response (this session's own, sent before round 47's finding reached it) fixed a real but different, already-resolved problem — day-of-week evidence (pattern on all 7 days) confirms round 47's diagnosis; `HCRIS-TIMEOUT-10` (compare-before-write, round 47's prompt, renumbered) is the real next step. See the dated entry below.** **👤 2026-09-22, same day: `HCRIS-TIMEOUT-10` merged (PR #7423) — compare-before-write now wired into both of this arc's own write paths, tests pass, merge confirmed directly by CC's own GitHub tooling. Live proof still pending — the two runs in progress right now started before the merge. **👤 2026-09-22, same-day follow-up: full error/block catalog run, at Scott's request, to fully unblock the pipeline rather than just chase this one arc.** The post-merge run (`0c7f36de…`/`8173f93e…`, started 14:10-14:11 UTC) ran past the 2-hour `reclaim_stale_started_runs` window without finishing OR being reclaimed — a state never seen in ten prior rounds — while `properties` kept climbing steadily (6,227 of 11,840 fleet touched by 2h07m, still writing); this is genuinely new and not yet understood, flagged rather than assumed benign. **Separately, and much bigger: a previously uncatalogued, 3-month-old blocking defect found on `ratings`/`clinic_quality_metrics`** — every run trips a circuit breaker within ~13-17 minutes of start (root trigger: `23505 duplicate key` violations on `ratings_medicare_id_uidx`/`clinic_quality_metrics_medicare_snapshot_uidx`) and then silently drops **every** subsequent write to those two tables for the rest of that run, every run, going back to 2026-06-24 (`ratings`) and 2026-09-12 (`clinic_quality_metrics`). 248,913 `ingestion_run_errors` rows total, **all still `review_status='new'`, never triaged** — this has been visible in nearly every HCRIS-TIMEOUT round's evidence as the "usual startup burst" but never itself root-caused or fixed. `ratings` sits stuck at 7,013 rows / `clinic_quality_metrics` at 7,555, both frozen at their last pre-circuit-break write. New backlog row filed: `RATINGS-CQM-CIRCUIT-BREAKER`. **👤 2026-09-22, same day: answered — `clinic_quality_metrics` half fixed (PR #7424, Scott reports merged, live proof pending), `ratings` half reopened at 🔴 after this session found CC's "already fixed by RATINGS2" reasoning doesn't hold against live evidence (`ratings` still erroring daily through today, `RATINGS-INSERT-COLLISION`'s fix never durably held). **👤 2026-09-22, round 2 answered: `ratings`' real root cause found and fixed (PR #7425, Scott reports merged) — a client-wide `Prefer: return=minimal` header was silently defeating every UPDATE-response check, not a capped prefetch or partial-index issue. September's "8-hour clean window" was also re-explained: no pipeline run occurred in that window at all, not a fix holding temporarily.** `ratings` closed to 🟡 pending two consecutive clean daily runs (not one). Live proof still owed on all three PRs (`HCRIS-TIMEOUT-10`/#7423, CQM/#7424, `ratings`/#7425) — no run has started on any of their merges yet. See the dated entry below.** **👤 2026-09-23: first post-merge run is a split verdict.** `ratings` is genuinely clean for the first time in this entire saga (0 errors, all 7,013 rows fresh). `clinic_quality_metrics` is still completely broken — same symptom, new mechanism: PR #7424's own `.upsert()` call throws a real `23505` on the very first row it processes, every run, zero writes landing at all. `HCRIS-TIMEOUT-10` also looks good so far (`properties` ~90% of fleet). Separately, `ingestion_tracker` rows are not reliably closing even when Railway shows a run "completed" — a new run started before the prior one's rows ever got a `finish_run()`. See the dated entry below. **👤 2026-09-23, round 3 answered: CQM's real root cause found — same defect class as `ratings`' round-2 fix (a client-wide header silently defeating the upsert).** Fix pushed, PR #7426, Scott reports merged; live proof still pending (the run in progress predates the merge). Two new follow-up items filed: the same header bug likely affects 133 other `.upsert()` call sites repo-wide, and the tracker-never-closes gap has its own filing now. **👤 2026-09-24: `CMS-PIPELINE-STAGE-STARVATION` answered — same header-defect family found a fourth time (on `ingestion_tracker.start_run()`'s own INSERT this time), which turns out to be the real cause of `RATINGS-CQM-CB3-tracker-close` too (the "hard kill" theory filed for that item was wrong, now corrected). Separately, my own prior read of `properties` "decelerating" was also wrong — CC found the write rate was flat all along; the real long pole is `backfill_financials` unconditionally rewriting all 189,851 `facility_patient_counts` rows every run (~9h) and swallowing its own step timeout, starving everything scheduled after it. Fix pushed, PR #7427, Scott reports merged; no live run has tested it yet — see the dated entry below and `PLANNED-BACKLOG.md`'s `CMS-PIPELINE-STAGE-STARVATION` and `RATINGS-CQM-CB3-tracker-close` rows. **👤 2026-09-24, same day: live test confirms #7427 works — first self-closing run ever (1h14m vs. 15-24h), `facility_deficiencies`/`qip_scores` both writing fresh for the first time since 2026-05-16.** Five gaps found in that same run (staged-intake queue not draining, `clinic_financial_estimates` zero writes, `medicare_ingestion` still frozen, run closed `partial` not `success`, tracker `notes` possibly cross-contaminated between rows) plus a new table (`investment_targets`) hit by the CB3 circuit-breaker class — filed as `CMS-PIPELINE-STAGE-STARVATION-2`. See the dated entry below. |
| **Deed / owner-conflict (DEED/GOVDEED)** | DEED1, DEED1-reconcile-2, DEED1-emptycompare, DEED2, GOVDEED1–5, GOVDEED5b, GOVDEED-478, DEED-DIA-LATENT, CANON-OWNERSHIP1 | 2026-09-16 | Arc complete through GOVDEED3 (gov #406); **the gov deed writer runs from GitHub Actions (weekly Mon 06:00 UTC) — verify 09-21 dateless = 0**; CANON-OWNERSHIP1 👤 confirmation open; sale-party conflicts 1,290 a review queue |
| **C2g / sponsor↔SPE gate (C2k)** | C2g, C2h, C2i, C2k | 2026-09-16 | **C2k LIVE** (LCC PR #2506): 218 attested supersessions, 40/43 pairs to sponsor, 16/16 controls untouched, reversible; sponsor-as-edge = future work |
| **Research lanes / owner gap (C1B/C1C/OWNERGAP)** | C1B-GOV-GATE, C1C-SPLIT, OWNERGAP1, OWNERGAP2, OWNERGAP2-harris, -harris-b/-c/-d, -ledger-order, MCP1 | 2026-09-17 | **41 assessor-sourced owners live** (Philadelphia 20, Harris 21 of 50); Harris is done except the 27 situs-gap properties → §P10a is the lane's next unit; next free-bulk jurisdiction after that |
| **App feedback intake (SBN)** | FLOWS1, FLOWS1-artifact, FLOWS-consolidate, FLOWS-consolidate-lcc, FLOWS1-path, HOME1, HOME2, PRI1, PRI2, PRI2-on, DIA1, DIA1b, DIA1c, ID3a-drift, RECON1, RECON1-b, RECON2, RECON2-b, RECON2-render, RECON3, RECON3-b, SIDEBAR3, SIDEBAR3-b, SIDEBAR3-c, SIDEBAR3-d, EXT-HOST-2, SIDEBAR4, LEASEJUNK1, PERF-SPQ2, HOME2-fix, HOME2-b, HOME2-c, HOME2-d, HOME2-e, PERF-SPQ1, PERF-SPQ1-b, PERF-SPQ1-c, RECON2-c, RECON2-d, RECON2-d-reconcile, RECON2-d-render, RESOLVER1, SIDEBAR-LEASE1, SIDEBAR2, DIA-PROPAGATOR1, VERCEL-LIVE1, GOV-AVAIL1, GOV-UX1, SIDEBAR4-b, SIDEBAR4-c, RECON2-render-spa, RECON2-render-dossier, SIDEBAR3-d-orient, GOV-UX1-D1, GOV-UX1-D2, GOV-UX1-D3, GOV-UX1-D4, GOV-UX1-D5, GOV-UX1-D4-sftype, GOV-UX1-D5-gate, GOV-AVAIL1-postoak, GOV-AVAIL1-agency-tail, GOV-AVAIL1-twins, GOV-AVAIL1-govtype, GOV-AVAIL1-civic-drift, RECON2-render-views, HOME-MB-BOOT, SIDEBAR4-d, INTAKE-RESTAGE1, GOV-UX1-D1-registry, SF-BRIDGE1, SIDEBAR5, GOV-COMPS-CAP, GOV-UX1-D5-gate-bank, GOV-UX1-D5-gate-buyerspe, GOV-UX1-D5-gate-sponsor, SF-BRIDGE1-flow, GOV-CLASSIFY1, GOV-CU1, GOV-AVAIL2, SF-BRIDGE1-suppress, GOV-COMPS-SCOPE-reason, SIDEBAR5-residue, GOV-CLASSIFY1-rerun, GOV-CLASSIFY1-saginaw-twin, GOV-CLASSIFY1-costar-identity, GOV-CU1-home, GOV-CU1-edge-deploy, GOV-CU1-default-gov, GOV-CU1-fca, GOV-CU1-prefix, GOV-AVAIL2-state-registry, GOV-AVAIL2-multi-agency, GOV-AVAIL2-exposure-grouping, SF-BRIDGE1-opened-at, GOV-CLASSIFY1-diag-race, CONSOLIDATE-REVERSIBLE, SIDEBAR-AGENCY-OVERWRITE, CONTACTS-GOV-WRITER, SIDEBAR-AGENCY-OVERWRITE-hhsc, GOV-REGISTRY2, CONTACTS-GOV-REVIEW-LANE, CONTACTS-GOV-GUARD-REFUSE, MERGELOG-GAP, GOV-REGISTRY2-tail, GOV-REGISTRY2-promoter-schedule, GOV-REGISTRY2-agency-id-stale, MERGELOG-GAP-candidates, MERGELOG-GAP-broken-chains, MERGELOG-GAP-gov-archived, MERGELOG-GAP-unmerge-chain, DIA-REDIRECTS-ANON-WRITE, SEC7 | 2026-09-24 | **Current (round 77, 2026-09-24):** `tranquil-delight` live on `d68b2c0b`; MCP redeployed; SF edge v36/v32 (pre-REGISTRY2); extension 1.0.58. **Closed/live:** GOV-REGISTRY2 (state/county/city agencies named per jurisdiction; Available unresolved State 59→22, Municipal 14→3; TX HHSC ≠ HHS), MERGELOG-GAP (dangling dia links 48→35 all flagged/queued, gov 5→0; redirect + unmerge passes live; daily guard), SIDEBAR-AGENCY-OVERWRITE, CONTACTS-GOV-WRITER (0 gov writes at +3.6 h), CONSOLIDATE-REVERSIBLE, GOV-CLASSIFY1 arc, GOV-CU1, GOV-AVAIL2, SF-BRIDGE1, plus rounds 63–76. **Prompted, waiting on CC:** `GOV-REGISTRY2-FOLLOWTHROUGH` (SF edge redeploy, promoter schedule, `agency_id` recompute on write), `SEC7-LEDGERS` (anon can write the redirect/merge-backup/alias tables; RLS inventory 60/50/124). **Waiting on Scott:** Q51/Q55 (lane cards; 1.0.58 Contacts-tab Save; comps pill), Q59 (optional Consolidate click), Q60 (eyeball Gov Available agencies). **Cowork next round:** CONTACTS-GOV-WRITER +24 h; first MERGELOG guard tick (2026-09-25 06:55 UTC). **Filed, not prompted:** GOV-REGISTRY2-tail, MERGELOG-GAP-candidates/-gov-archived/-unmerge-chain, CONTACTS-GOV-REVIEW-LANE, CONTACTS-GOV-GUARD-REFUSE (after 2026-10-01), CONSOLIDATE-REVERSIBLE-unmerge-ui/-dia-restore-triggers, MERGE-BARE-DB-CALLERS, GOV-CU1-default-gov/-prefix, GOV-AVAIL2-multi-agency/-exposure-grouping, GOV-CLASSIFY1-costar-identity, SF-BRIDGE1-suppress, SIDEBAR5-residue, GOV-COMPS-SCOPE-reason, SIDEBAR5-twin-lane-consumer, GOV-UX1-D1-registry, RECON2-render-views, SIDEBAR4-b, SIDEBAR3-b, SIDEBAR3-d-orient, FLOWS1 SF Listing spike. Older narrative: [`docs/history/STATUS_open-threads_SBN-row_to_2026-09-22.md`](../history/STATUS_open-threads_SBN-row_to_2026-09-22.md) + dated entries below. |
| **Process / consolidation (CONSOLIDATE, INVENTORY)** | CONSOLIDATE1–5, INVENTORY1, INVENTORY1b, INVENTORY2, INVENTORY-process, REMEDIATION-2026-05, REPO1, ROADMAP, PROCESS-CC-DOCS, PROCESS-MERGE-CLOBBER, GUARD-CLOBBER1, PROCESS-ROW-CELLS, PROCESS-PARKING-LOT, DEPLOY2-coverage, DEPLOY2-stale-body, DOCMAP3, DOCMAP3, DOCMAP3-shareinbox, DOCMAP3-sftask, DOCMAP3-govlinkpick, DOCMAP3-residue, BRIDGES-DORMANT, DOCS-CM-MISFILED | 2026-09-24 | **DOCMAP3 shipped + verified 2026-09-24 (round 74):** shipped backlog rows now move verbatim to `docs/history/PLANNED-BACKLOG_shipped_<date>.md` (guard-exempt; 101 + 2 + 4 + 5 + 4 archived so far). `docs/` root 50 → 0 tracked files, root `.md` 10 → 6, `docs/cm`/`docs/claude`/`docs/runbooks`/`docs/round68a` collapsed, 62 moves as renames. Backlog 1,050 KB → 819 KB. Start-here index: `DOCUMENTATION-MAP.md` §0. **Open:** DOCS-CM-MISFILED (115 archived prompts in `docs/capital-markets/`), BRIDGES-DORMANT (👤), DOCMAP3-shareinbox/-sftask/-govlinkpick/-residue. History: PR #2563 clobber restored round 26 → `GUARD-CLOBBER1` live (#2566); GUARD-CLOBBER1-buffer fixed round 73; DEPLOY2 live + CI; EDGE-GATES1 live. STATUS tail17 archived round 77 (2,204 → ~855 lines). |
| **App / UX** | ASC50, HP1, UX-T1a | 2026-09-12 | ASC50 governed review workbench built + locally verified, publication pending |
| **Buyer engagement (BUY0)** | BUY0, BUY1a/1b, BUY-G1–G6 | 2026-09-11 | Phase 0 complete for Geller Round 1 (client deliverable + email draft shipped); build handoff written, BUY1a/1b + BUY-G1..G6 filed as next steps |
| **Broker identity (BR) / BROKER1** | BR1, BR2, BR3, BR4, BR4-b, BR5, BR1-misparse-handoff, BROKER1, BROKER1-sf | 2026-09-17 | **BR4 live**: 3 true duplicates merged, 52 firms minted with evidence, `broker_company_id` 14.4% → **25.0%** (641/2,566); residue → BR4-b (123 firm-shaped broker rows, 468 review); BR5 display next |
| **gov agency canonicalization (ID3a\*)** | ID3a, ID3a-b, ID3a-c, ID3a-d, ID3e, I14, I16 | 2026-09-12 | ID3a-b/c/d/e all shipped and live-verified; repo-ownership hazard (I16) found and closed — `government-lease` owns the gov DB's migrations, LCC's copy retired |
| **CI / producer health (B6d/B6e)** | B6d-cms-*, B6d-assessor-*, B6d-pri-*, B6e-ci-*, B6e-fred-* | archived 2026-09-11 | Suite is a real merge gate (`Run Tests` unmasked, green once on `main`); `pip-audit`/secrets-grep/ruff still masked; full detail in the 2026-08-29→09-11 archive and `docs/architecture/producer-health-and-ci-enforcement.md` |

> **📦 ARCHIVE (2026-09-08):** entries for **2026-08-31 → 2026-09-01** (the CMS-ingestion restart,
> DOC1–DOC18 document pipeline, C13/C14 entity-role work, and the trailing pointers for two earlier
> cuts) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-08-31_to_2026-09-01.md`](../history/STATUS_claude-code_2026-08-31_to_2026-09-01.md).
> Nothing was dropped; every still-open item was already in `PLANNED-BACKLOG.md` and the canonical pages.

---

## 2026-09-24 — Round 77 (Cowork): GOV-REGISTRY2 + MERGELOG-GAP reconciled live; TX HHSC restored on 33519; `GOV-REGISTRY2-FOLLOWTHROUGH` + `SEC7-LEDGERS` prompted

**Deploy.** `verify:deploy`: `tranquil-delight` is on `d68b2c0b` (#2670 MERGELOG-GAP, #2671 GOV-REGISTRY2, #2672 another session's CMS docs). On `main`, `test/mergelog-gap.test.mjs` passes 14/14 and `test/sf-deal-promotion.test.mjs` passes 27/27.

**GOV-REGISTRY2, live.**
- Available listings by type:

| type | listings | with no `agency_id` |
|---|---|---|
| State | 79 | 22 |
| Municipal | 15 | 3 |
| Federal | 335 | 41 |
| NULL | 39 | 39 (CC: 16 blank agency, 23 commercial tenants; none guessed) |

- Named rows: 16297 → `MI-SAGINAW-CMH` "Saginaw Co. CMH"; 16334 → `TN-DHS`; the resolver returns `TX-HHSC` for HHSC in TX.
- **Cowork repair on 33519:**
  - The agency text was "State of Texas", an unrecorded overwrite after the last `field_provenance` write ("Health & Human Services Commission", 2026-06-26 18:59:43).
  - Restored the text to HHSC under SIDEBAR-AGENCY-OVERWRITE's rule: the prior value now resolves.
  - `agency_id` did **not** follow the text change, so it was set to `TX-HHSC` by hand.
  - The prior values were "State of Texas" / `TX-GOV`.
  - The missing recompute is filed as `GOV-REGISTRY2-agency-id-stale`.
- NCUA/FCA routing isn't live until the SF edge functions are redeployed (still v36/v32).

**MERGELOG-GAP, live.**
- The redirect pass is running: 600 of 1,284 `dia_property_redirects` stamped by 15:26 UTC, 200 per tick.
- The daily dangling-link guard (crons 266/267) first fires 2026-09-25 06:50/06:55 UTC.
- CC's result: dia 48 → 35 dangling (the 35 are 14 queued research + 21 "Not on file" flags), gov 5 → 0. Dia's `v_property_id_census` had been invisible to anon, so the R22 orphan cleanup had read nothing. CC fixed that.

**Security finding, sized live.** RLS is **off** and anon can INSERT/UPDATE/DELETE on:
- `dia_property_redirects` and `dia_property_merge_backup` (dia);
- `gov_property_merge_backup` and `gov_agency_aliases` (gov).

These are the tables the resolver and reconcile trust. Across the three databases, tables with RLS off and anon-writable number 60 (dia), 50 (gov) and 124 (LCC Opps). The old SEC7 row said 34. Phase 1 (lock the four, inventory the rest) is prompted as `SEC7-LEDGERS`.

**CONTACTS-GOV-WRITER interim (+3.6 h):** 0 gov writes, guard total 0. The +24 h check is next round.

**Consolidation.**
- Four final rows archived verbatim, with CURRENT-STATE §2b pointers: SIDEBAR-AGENCY-OVERWRITE, -hhsc, GOV-CU1-fca, GOV-AVAIL2-state-registry.
- Q60 added (eyeball the Available agencies).
- **STATUS archived:** the 1,353 lines dated 2026-09-17 → 2026-09-22 (Round 30 through GOV-AVAIL1) moved verbatim to `docs/history/STATUS_claude-code_2026-09-17_to_09-22_tail17.md`. This file went from 2,204 to ~855 lines, so it now holds only the 2026-09-23/24 arc.
- The GOV-REGISTRY2 prompt moved to done/ (MERGELOG-GAP's was already moved by CC).
- Left alone: `CMS-PIPELINE-STAGE-STARVATION-2` in prompts/ belongs to another session.

**Next.**
- CC: `GOV-REGISTRY2-FOLLOWTHROUGH` and `SEC7-LEDGERS`. They touch different objects, so they can run in parallel.


## 2026-09-24 — CMS-PIPELINE-STAGE-STARVATION, PR #7427 live test: first self-closing run ever, real progress, five new gaps filed as round 2

**Scott confirmed PR #7427 deployed and triggered a fresh `cms-ingestion` run at 13:55 UTC.** Independently verified end-to-end against live Supabase (not accepted at Scott's or CC's word):

- **The run closed itself via `finish_run()` at 15:08:49 UTC — 1h14m total.** Every prior run in this entire multi-week saga has taken 15-24h and only ever closed via the next day's `reclaim_stale_started_runs` sweep. This is the first genuinely self-closing run ever observed, and it directly confirms the `start_run()` header-defect fix is holding in production.
- **`facility_deficiencies` (+25,837 rows, 437,221 → 463,058) and `qip_scores` (existing rows updated) both wrote fresh for the first time since 2026-05-16.** Both held through the run's finish, not just mid-run.
- **`ratings`/`clinic_quality_metrics` stayed clean the whole run** — no regression from the earlier fixes.

**Five gaps found in this same run's own evidence, filed as `CMS-PIPELINE-STAGE-STARVATION-2` (prompt: `CMS-PIPELINE-STAGE-STARVATION-2-post-fix-live-run-gaps.md`):**

1. `facility_patient_counts`'s staged-intake queue (`994 queued`, `2 promoted`) did not move at all across the run — identical before and after. The lock is fixed; whatever promotes staged rows into the real table isn't running or isn't reaching far enough.
2. `clinic_financial_estimates` had zero writes the entire run. Could be a correct compare-before-write result (the prior broken run had just finished an unconditional full rewrite hours earlier) or a silent no-op — not yet distinguished, flagged rather than assumed either way.
3. `medicare_clinics.source_last_seen` is still frozen at 2026-08-31 — `medicare_ingestion` is still skipping, exactly the item CC's first response flagged and explicitly did not fix.
4. The run closed `run_status='partial'`, not `'success'` — no explanation yet for what tripped that.
5. The `facility_patient_counts` and `cms_medicare_clinics` tracker rows for this run both showed the *identical* `staged_intake_status_counts` JSON in their `notes` columns — possible cross-row contamination in how `notes` gets written, not yet confirmed.

**Also found, filed in the same prompt**: `investment_targets` tripped the same CB3 circuit-breaker class (542 `circuit_open:('upsert', 'investment_targets')` errors in a single ~12ms burst at 14:31:34 UTC) — a seventh table hit by the defect this arc already fixed on six others, live confirmation of the risk `RATINGS-CQM-CB3-upsert-class` (133 call sites repo-wide, still unaddressed as a class) was filed for. Two small, likely-unrelated errors (`bd_flags`→`alerts_unified` null-constraint violation, `recorded_owners` duplicate-key collision) also appeared mid-run on tables outside this CMS arc — flagged for CC to confirm whether they even belong to this pipeline before spending time on them.

`PLANNED-BACKLOG.md`'s `CMS-PIPELINE-STAGE-STARVATION` row updated with this live-test outcome; prompt filed for round 2.

---
## 2026-09-24 — MERGELOG-GAP (CC): dangling asset → property links dia 48 → 35, gov 5 → 0; the reconcile now reads `dia_property_redirects` and follows unmerges; a daily guard counts the rest

- **Re-measured first:** 47 dia ids / 48 entities (the prompt said 46). 1 is in `property_merge_log`; its own keep id 35601 is also gone. 0 are in the merge backup. **6 came from the still-running geospatial cron (jobid 16, 2026-09-14 to 09-22).** It writes only `dia_property_redirects`, the one ledger the reconcile never read. `dia_merge_property` writes that table on every merge (1,284 rows).
- **Reconcile** (`api/_shared/merge-log-reconcile.js`, extracted from `admin.js`, same cron 18):
  - It gains the redirect source, read through `v_dia_property_redirect_resolved.final_survivor_id` (chain-resolved).
  - It gains an unmerge pass: `lcc_unrepoint_entity_property_id` moves back only entities whose `_round_76ee_prev_property_id` is the restored id.
  - Proven by a rolled-back round trip on LCC Opps: repoint 1, unrepoint 1, and a bystander on the kept id did not move.
- **One-shot map**, rule `classifyDanglingLink` (a ledger, or two independent signals):
  - **18 mapped** (13 dia + 5 gov) and repointed;
  - **14 candidates** sent to `research_tasks` `asset_property_link_review`;
  - **20 unknowable ids / 21 entities** flagged `metadata.domain_property_missing`. The panel now shows "Domain Property: Not on file".
  - Ledger: `lcc_asset_property_link_resolution`, batch `mergelog_gap_20260924`.
  - The test replays the classifier on the exact evidence and checks that the migration's verdicts match.
- **Guard:** `lcc_asset_link_census_fetch` 06:50 / `lcc_check_dangling_asset_links` 06:55. It alerts `dangling_asset_property_links` when the count rises over a complete census. Live positive control: 48 → 51 opened an alert, then rolled back.
- ⚠️ **The guard's first run found dia `v_property_id_census` returning anon `200 []`** (`security_invoker=on`, P157). Only the new 1,000-id floor refused it. R22's dia mirror-orphan reconcile had been reading the same empty census.
  - Flipped `security_invoker` off, with anon/authenticated writes revoked in the same migration. The view is auto-updatable, so running as owner with the old `arwdDxt` grant would have let anon delete through it.
- **Filed:**
  - `DIA-REDIRECTS-ANON-WRITE` 🔴: the ledger the resolver trusts is anon-writable.
  - `MERGELOG-GAP-candidates` (no capture path), `-broken-chains` (15), `-gov-archived` (3), `-unmerge-chain`.
- Tests: `test/mergelog-gap.test.mjs` 14 tests, 8/8 mutations red; `npm test` 7,268 pass / 0 fail.
- Deploy: DB live on all three projects. The JS redirect and unmerge passes need the Railway redeploy of **both** services. First cron tick after deploy scans ~1,269 redirect rows at 200/tick.
- **Next:** after the redeploy, confirm `by_source.redirects.stamped > 0` on the cron 18 response. Confirm the 06:55 check logs `complete=true` for both domains with dia ≤ 35.

---

## 2026-09-24 — GOV-REGISTRY2 (CC): state, county and city agencies get a jurisdiction in the ID3a registry

**Model.** A registry row is an identity in a jurisdiction: `government_agencies` gains `jurisdiction_level`
(`federal|state|county|city|type`), `jurisdiction_state/name`, `agency_type_code`, `short_name`. One row per
state/local agency (an `agency_id` must name one counterparty); the generic `ST-*`/`MUN-*` rows become `type` and
can never resolve or be written. Aliases carry `jurisdiction_state` and a `type_gate`. One resolver:
`gov_resolve_agency(text, state, government_type)`; the 1-arg form wraps it with no state (federal only).
government-lease `sql/20260924_gov_registry2_jurisdiction_model.sql`, applied live as `gov_registry2_a..h`; guard
`tests/unit/test_gov_registry2_jurisdiction_model.py` (22 tests, 12/12 mutations RED).

**Contamination found and repaired:** federal HHS held `Health & Human Services Commission` (+3 variants, **212 TX
properties**), `Calaveras County Health & Human Services`, `DE/HHS`; DOT held `NY State Department of
Transportation`; DOJ/DOL/DHS/DOS held state compounds (`DOJ/SBI`, `DOL/DNR`, `DHS/PSS`, bare `State`). 6 re-pointed,
7 deleted, 21 ambiguous federal names gated off State/Municipal rows (`DHS` on 10 State rows was the state DHS).

**Live:** 95 registry rows (80 state / 11 county / 2 city / FCA + NCUA), 180 aliases. Sweep 849 writes (375 properties,
474 property_agencies; HHS→TX-HHSC 212, ST-DFPS→TX-DFPS 123, 25 cleared to review). Backfill 1,197 properties +
8,309 property_agencies (47 + 7,818 federal of those were a standing backlog of existing aliases — the promoter is
unscheduled). `government_type` filled on 625 NULL rows. Available: State no-id 59→22, Municipal 14→3, NULL-typed
61→39 (16 no agency, 23 commercial strings — not typed, no guess), Federal 51→41. Active unresolved: State
859→329, Municipal 74→61. Restore round trip proven in a rolled-back transaction (849/849).

**LCC:** `GOV_SIGNALS` (shared + files router) gain `national credit union administration` / `farm credit
administration`; `test/sf-deal-promotion.test.mjs` +3 (2/2 mutations RED). ⚠️ Edge functions `intake-salesforce`
and `intake-salesforce-files` are **not redeployed** — the routing change is not live until they are. No SPA JS
changed (gov.js already shows `agency_display` with the full name on hover), so no cache bump and no Railway deploy
is needed for the display. **Open:** 33519 reads "State of TX" because its current string is "State of Texas" (the
sidebar overwrite); the earlier HHSC value is more specific — not restored here.

## 2026-09-24 — CMS-PIPELINE-STAGE-STARVATION answered (CC): the real cause of both `facility_patient_counts` inertness and pipeline starvation, plus a correction of this session's own prior "properties deceleration" reading

**Prompted 2026-09-24 after a full CMS-ingestion table-health sweep (Cowork) found `facility_patient_counts` untouched since 2026-08-31, `facility_cost_reports` frozen since 2026-03-16, `facility_deficiencies`/`qip_scores` frozen since 2026-05-16, and `facility_payer_mix` at zero rows ever. CC's response overturns two of this session's own prior working theories — documented here explicitly rather than silently corrected.**

**Problem 1 — `facility_patient_counts` isn't slow, it never runs, and it's the same root cause as `RATINGS-CQM-CB3-tracker-close`.** `ingestion_tracker.start_run()`'s own INSERT has been returning `None` on every production call — the shared client's `Prefer: return=minimal` header (the same CB2/CB3 defect family already found on `ratings`' UPDATE and `clinic_quality_metrics`' upsert, this time on an INSERT) overrides the insert's own `return=representation` request, so the row lands but no caller ever gets its id back. The ingestion lock then reads as "another run is active," so `facility_patient_counts` — and, CC found while tracing it, `medicare_ingestion`/the CMS facility listing ingest too — skips itself every day. The daily `run_status='started'` row is an orphaned lock, not work in progress. Onset dated to **2026-08-31**, the last day any lock row closed with a real success, matching both `facility_patient_counts`'s last write and `medicare_clinics.source_last_seen` going stale the same day. **CC states plainly this is the same root cause `RATINGS-CQM-CB3-tracker-close` was filed under a "hard kill or something else, unconfirmed" theory — that theory was wrong, corrected in place in `Dialysis`'s `CLAUDE.md` and here in `PLANNED-BACKLOG.md`.** Fixed via a new `src/postgrest_prefer.py` helper that sets the header where `postgrest` 2.31 actually reads it (`builder.request.headers`), applied to `start_run()` only; confirmed on the wire the insert now returns its id.

**Problem 2 — `properties` was never decelerating; that reading (mine, in this file and `PLANNED-BACKLOG.md`) was wrong.** CC's own words: "The write rate was flat." What this session read as a real slowdown (~1,500 rows/hour down to ~30-55/hour, tracked across many hours of live monitoring on 2026-09-23) was an artifact of the metric itself: each property gets rewritten once per patient-count snapshot (~20 per clinic), so *distinct properties touched since start* naturally plateaus even while the underlying write rate holds steady — with the side effect that each property ends up carrying financials from an arbitrary snapshot rather than the latest one. **This correction is recorded here explicitly, not silently folded in** — every prior STATUS.md/PLANNED-BACKLOG.md entry describing "properties decelerating" through 2026-09-23 was a misread of the curve. The real long pole is `backfill_financials` (writes `clinic_financial_estimates`, keyed off `facility_patient_counts`'s 189,851 rows): it ignores its own "missing" check and `force_recalculate` flag, unconditionally rewrites every row (6-7 round trips each), running at a flat ~21k rows/hour — about 9 hours per run — even though only 67 of the first 112k rows checked actually changed a value. Its per-row `except Exception` also swallowed the step's own timeout alarm, so the 90-minute whole-run cap trips at the next step boundary, skipping `cms_deficiencies`/`esrd_qip_scores`/everything scheduled after it, every run. Fixed: the step now compares against values it already fetches, skips unchanged rows, honors `force_recalculate`, and lets `StepTimeout` propagate — CC estimates this cuts the step from ~9 hours to minutes.

**Also fixed this round, same CB3 plain-INSERT-on-conflict shape:** four more bare `.upsert(on_conflict=...)` calls — `qip_scores`, `facility_deficiencies`, `facility_cost_reports`, `facility_economics`. **Also found, not fixed:** `facility_cost_reports`'s freeze is explicitly *not* explained by starvation — its step runs early and never reaches its own upsert; the real cause is inside that step (probably the CMS download), "only visible in Railway logs." `facility_payer_mix` is confirmed dead code in practice — wired up, but its CMS source file has none of the payer-mix columns it looks for; real payer mix lives on `medicare_clinics` via HCRIS; no data source exists to fix it with. `medicare_ingestion` has also been silently skipping since ~2026-09-12, same lock defect, filed not fixed. **Proposal, not built:** give `qip_scores`/`facility_deficiencies`/HCRIS their own Railway cron so a slow main run can't starve them.

**Tests:** 14 new (`tests/test_cms_pipeline_stage_starvation.py`), 10 fail against pre-fix code; full suite 3,377 passed / 2 failed, same 2 pre-existing failures reproduced on unmodified `main`.

**Delivery, flagged not accepted at face value:** CC's own transcript is internally inconsistent — it first states "It's merged nowhere and hasn't run in production yet. No PR opened," then later states "Noted: PR `sbriggssjc/Dialysis#7427` now tracks this branch" (branch `claude/great-hawking-8yu0q2`). Scott reports #7427 merged; this session has no direct read access to the `Dialysis` repo (only `life-command-center` is connected here) to independently confirm the merge.

**Independently re-verified live Supabase state before writing this up, per standing discipline:** the run open at check time (`318baf19…`/`35bb3368…`, started 06:02:53-06:02:59 UTC 2026-09-24) was still active 7h24m+ in — meaning it started before any merge of #7427 could take effect and is running the pre-fix code. `facility_patient_counts`/`qip_scores`/`facility_deficiencies`/`facility_cost_reports` were all still frozen at the exact same stale timestamps (2026-08-31 / 2026-05-16 / 2026-05-16 / 2026-03-16, unchanged from the pre-prompt sweep), and `clinic_financial_estimates` was still being actively written minutes before the check — consistent with `backfill_financials` still grinding on the old unconditional-rewrite code, not the fixed one. **No live proof yet that PR #7427's fixes hold** — the next full run after a genuine merge is the real test: watch for the patient-counts lock row closing `success`, `financial_estimates` finishing in minutes rather than hours, and `qip_scores`/`facility_deficiencies` finally getting new `created_at` values. `PLANNED-BACKLOG.md`'s `CMS-PIPELINE-STAGE-STARVATION` row closes to 🟡 (fix pushed, not yet proven live); `RATINGS-CQM-CB3-tracker-close` also closes to 🟡 with its theory corrected in place. Full write-up: `docs/claude-code/responses/done/CMS-PIPELINE-STAGE-STARVATION.response.md`.

---
## 2026-09-24 — Round 76 (Cowork): SIDEBAR-AGENCY-OVERWRITE proven live on Saginaw; CONTACTS-GOV-WRITER verified (0 gov writes, hub tick running); `GOV-REGISTRY2` + `MERGELOG-GAP` prompted

**Deploy.** `verify:deploy`: `tranquil-delight` is on `c0996a50` (#2666 SIDEBAR-AGENCY-OVERWRITE, #2667 CONTACTS-GOV-WRITER). The new test files pass 19/19 on `main`.

**SIDEBAR-AGENCY-OVERWRITE: proven, not just deployed.**
- Cowork force-re-ran the Saginaw entity (`6c85fe57…`, 13:26 UTC), the same Save that broke 16297 in round 75.
- The entity: `success`, `_pipeline_last_error` cleared, linked to 16297.
- Gov 16297 kept `1040 N Towerline Rd`, `Saginaw County Community Mental Health Authority`, Municipal, and `latest_deed_date` 2016-06-16. Ownership rows stay at 2, and no property was minted.
- CC's correction stands: SCCMHA never resolved in the registry, so the fix keys on "the new string must resolve to replace an unresolved agency", not on "a resolved agency exists". That gap is the `GOV-REGISTRY2` prompt.
- Data repaired by CC, logged and reversible:
  - 8 fake capture-date "transfers" (4 duplicates deleted, 4 sole rows had the date blanked);
  - 3 agencies restored (MSHA / VA / GSA);
  - TX HHSC was held back as a resolver bug.

**CONTACTS-GOV-WRITER: verified at 13:26 UTC** (about 1.5 h after cutover; the 24 h re-measure is next round).
- `v_gov_retired_contacts_writes`: writes_24h 0, total 0 (log mode).
- Gov `unified_contacts` was last written at 11:53, cron 17's final run, and cron 17 is gone.
- Hub crons 263/264/265 have each run 3 times, all succeeded.
- The reconcile moved 655 hub rows to the surviving owner and created 580 contacts. It sent 728 to review and logged 53 Conflicts, and neither queue has a consumer (`CONTACTS-GOV-REVIEW-LANE`, filed).

**Consolidation.**
- Five final rows archived verbatim, with CURRENT-STATE §2b pointers: CONSOLIDATE-REVERSIBLE, GOV-CLASSIFY1, -diag-race, -saginaw-twin, GOV-CU1-home.
- Three scattered registry rows (GOV-AVAIL2-state-registry, SIDEBAR-AGENCY-OVERWRITE-hhsc, GOV-CU1-fca) now point at one topic row, `GOV-REGISTRY2`.
- Q58 archived. The CONTACTS-GOV-WRITER prompt moved to done/.

**Next.**
- CC: `GOV-REGISTRY2` and `MERGELOG-GAP`. They touch different code, so they can run in parallel.
- Cowork: the contacts +24 h re-measure.


## 2026-09-24 — CONTACTS-GOV-WRITER (CC): the retired gov contacts copy had two in-DB writers; both retired, the owner tick ported to the hub

**Writers (measured).** There were no REST writers: `edge_logs` showed only 50 GETs (UA `node`) on gov `unified_contacts` in 24h. (1) gov **cron 17 `unify-owners-incremental` → `unify_owners_tick(200)`** created 215 contacts and linked 98 since the cutover, and had no hub counterpart. (2) gov **`apply_owner_merge`** repointed `recorded_owner_id` on the gov copy only, which accounts for the 708-row single statement on 2026-09-12 (ID3b).

**Fix (Scott: port to LCC Opps, and follow merges on the hub).** Gov `v_gov_recorded_owner_identity` (anon; the positive control confirmed 17,593/17,593 visible) feeds hub `lcc_gov_recorded_owner_mirror` (crons 263/264), which feeds `lcc_unify_gov_owners_tick` (cron 265, :23/:53). The tick does merge-follow first. **Reconcile** (dry-run → rolled-back probe → live, batch `contacts_gov_writer_reconcile_20260924`): 655 repointed, **53 Conflict** (left as-is and logged), 51 linked, 580 created (hub 34,369 → 34,949), 728 to review. The re-run does 0. **Gov cutover:** cron 17 unscheduled, and the `apply_owner_merge` UPDATE removed (md5 proves it was the only change). A statement-level guard on 3 tables logs any write and alerts via the hub pull (`retired_contacts_copy_written`). Mode is `log`; `refuse` has been probed.

**Deploy.** DB-only, live now. No `api/` change, so no Railway redeploy is needed. **Baseline** 13:04 UTC: last gov write 11:53, guard log 0.
**Next:** Cowork re-measures new gov writes at +24h (`select * from v_gov_retired_contacts_writes` on gov, and `max(updated_at)` on gov `unified_contacts`). Flip the guard to `refuse` after a quiet week. The review lane and the 53 conflicts have no consumer yet.


## 2026-09-24 — SIDEBAR-AGENCY-OVERWRITE (CC): a sidebar Save no longer downgrades an existing gov property's agency, address or deed date; 13 live rows repaired

**Code (`api/_handlers/sidebar-pipeline.js`), both UPDATE paths of `upsertDomainProperty`:**
- **Agency.** `guardExistingPropertyIdentity` reads the existing row and applies `decideGovAgencyWrite`. The CoStar tenant string fills a blank agency, or replaces an unresolved one when the capture resolves in `gov_resolve_agency`. Otherwise the existing agency stays, and so does its `government_type` (the derived type is dropped with the rejected string). ⚠️ **The prompt's premise was false:** "Saginaw County Community Mental Health Authority" does **not** resolve in the registry, and 16297 has no `agency_id`/`agency_canonical`. A guard keyed on "registry-resolved" would not have protected the row that found this. The tenant string stays on the LCC entity (`tenant_name`/`tenants`); gov has no tenant column and none was added. An unreadable existing row → the agency is not written.
- **Address.** The stored display text is kept when it normalizes to the same key (`shouldKeepExistingAddress`). Applies to dia too.
- **Capture date ≠ transfer.** The live cause was a bare `{sale_date: "Sep 21, 2026"}` row in `sales_history` (CoStar's "updated on" line). `saleHistoryRowIsTransfer` requires a price, a party, a recording fact or a CoStar comp field. ⚠️ `sale_type`/`cap_rate` are **not** evidence: 3 of 8 stubs carried a stat-card `sale_type` beside the capture date. Applied at all five "most recent sale" picks: gov `latest_deed_date` mirror, its provenance twin, the `upsertDomainOwners` fallback (the writer of the 13 rows), `stageGovCompForSalesforce` (would have staged a fake comp), and the loan-date fallback.
- **Stale error.** `clearStalePipelineErrorOnSuccess` removes `_pipeline_last_error*` on a successful run (metadata is PATCHed whole). The failure stays in `_pipeline_run_log`.
- Guard `test/sidebar-agency-overwrite.test.mjs`: 13 tests. It drives the real `upsertDomainProperty` over a stubbed gov DB holding 16297's pre-run row. **11/11 mutations RED.** `npm test` 7,252 / 0 fail.

**Data (gov, applied live; `government-lease` `sql/20260924_gov_sidebar_agency_overwrite_repair.sql`, batch `sidebar_agency_overwrite_20260924`, restore `gov_sidebar_overwrite_repair_restore(batch)`; rolled-back round trip restored 13/13):**
- **13 same-shape ownership rows, each read against its capture.** 8 were stubs. 4 duplicated an existing row for the same owner and were deleted (1302, 16297, 38317, 41092). 4 were the owner's only row and got `transfer_date` NULL, row kept (5316, 16278, 16298, 16338). All 8 name the current owner, so only the date was wrong. **5 are real and untouched:** 23601, 16254, 35547 (priced + deed/comp), 13019 ($79.3M), and 6905 (CoStar comp "In Progress", price undisclosed).
- **`latest_deed_date`:** 16297 2026-09-21 → 2016-06-16; 41092 → 2021-12-22 (each property's latest real deed row). The prior value was never recorded.
- **The 307 → 304 unresolved `costar_sidebar` agencies**, read against LCC `field_provenance`:
  - 234 hold a CoStar value with no different earlier value recorded;
  - **31 have no provenance at all (unknowable);**
  - 22 hold a value that did not come from a CoStar write (6 of those are long values I placeholdered in the query, so read 22 as "≤22");
  - 17 have a different earlier value, mostly junk ("Saffell Plumbing & Heating", "Dollar General").
  - Restored only where the earlier value resolves and the current one doesn't: **15742 → MSHA, 16397 → VA, 40643 → GSA.**
  - ⚠️ **33519 excluded:** its earlier "Health & Human Services Commission" (Texas) resolves to **federal HHS**, a resolver false positive on a state agency → `SIDEBAR-AGENCY-OVERWRITE-hhsc`.
  - `provenance_event_log` does not record `agency` at all. The ID3a backups hold `agency_canonical`/`agency_full`, not the overwritten columns.

**Owed:** redeploy BOTH Railway services. Then Scott re-saves Saginaw once; Cowork checks 16297 still reads the Authority, keeps `1040 N Towerline Rd`, `latest_deed_date` stays 2016-06-16, no new `costar_sidebar` ownership row, and `_pipeline_last_error` is gone.

## 2026-09-24 — Round 75 (Cowork): CONSOLIDATE-REVERSIBLE + diag-race reconciled live; Saginaw merged into gov 16297 (Scott's call); lenders stay archived; `SIDEBAR-AGENCY-OVERWRITE` + `CONTACTS-GOV-WRITER` prompted

**Deploy.** `verify:deploy`: `tranquil-delight` is on `a0fe34ab` (#2663 diag-race, #2664 CONSOLIDATE-REVERSIBLE). The MCP doesn't import `admin.js`. `test/consolidate-reversible.test.mjs` and `test/gov-classify1-diag-race.test.mjs` pass 16/16 on `main`.

**Saginaw (Scott: "merge and consolidate into the most accurate source of truth").**
- **Survivor: gov 16297.** It scores completeness 52 vs 18, has the full agency name, the lease economics (14,519 SF, $107,772 gross), and the active listing.
- **The merge:** `gov_merge_property_reversible(16297, 31111, 'cowork_r75_saginaw_twin_20260924')` → **backup 7**.
  - 31111's 2016-05-26 $965,000 sale and its ownership row moved to 16297.
  - 1 re-derivable `investment_scores` row was dropped.
  - Undo: `gov_unmerge_property(7)`.
  - The `lcc-merge-log-reconcile` cron marked backup 7 reconciled at 10:10:58 UTC with 0 entities to repoint (none pointed at 31111), so the reconcile now sees reversible merges.
  - `gov_property_twin_review` id 2 → `merged`, with the full decision note.
- **The LCC link:** Cowork force-re-ran LCC `6c85fe57…` (`lcc_cron_post` → `/api/entities?action=process_sidebar_extraction`, run `6455bbd9…`). It linked to **16297**, and its stored diag now describes Saginaw rather than 910 4th Ave, so the diag-race fix is proven live.
- **New defect (`SIDEBAR-AGENCY-OVERWRITE`, prompted).** That same Save:
  - replaced the resolved agency (SCCMHA) with the CoStar tenant program "Max System Of Care";
  - lowercased the stored address;
  - wrote CoStar's "updated on" date (2026-09-21) as an ownership transfer and `latest_deed_date`;
  - left `_pipeline_last_error=no_domain` set after a successful run.
- Cowork restored 16297's agency and address to the values measured before the run (logged in the twin note).

**Credit unions (Scott): stay archived** until a lender lane is opened on purpose. There are 702 lender rows, all with `government_type` null and none on Available; the GOV-CU1 insert guard stops new ones. `GOV-CU1-home` is closed.

**Consolidation.**
- Four final rows archived verbatim, with CURRENT-STATE §2b pointers: `GOV-CU1`, `GOV-AVAIL2`, `SF-BRIDGE1-opened-at`, `DOCMAP3`.
- `GOV-CLASSIFY1` and its children, and `CONSOLIDATE-REVERSIBLE`, are final ✅. They get archived next round.
- Checklist: Q56/Q57 archived, Q58 answered, Q59 added (optional).
- The CONSOLIDATE-REVERSIBLE prompt was moved to done/.

**Next (CC).** `SIDEBAR-AGENCY-OVERWRITE` and `CONTACTS-GOV-WRITER`. They touch different code, so they can run in parallel.


## 2026-09-24 — CONSOLIDATE-REVERSIBLE (CC): every property merge is reversible; gov unmerge and the merge-log reconcile fixed on the way

- **Done.** The Consolidate button, the Decision Center `property_merge` verdict and `scripts/dup-review-adjudicate.mjs` now all merge through `<dom>_merge_property_reversible`, via one helper (`api/_shared/property-merge-reversible.js`). Each returns `backup_id`, and undo is `<dom>_unmerge_property(backup_id)`. The Consolidate POST now authenticates.
- **Found and fixed:** `gov_unmerge_property` raised 428C9 on every call (it did `INSERT … SELECT *`, and gov `properties` has generated columns). The merge-log reconcile could not see any merge since 2026-05-17 (nothing writes `property_merge_log`), and it matched 0 entities (it filtered on `dialysis`, but entities carry `dia`). All fixed; 5 migrations applied live (dia ×2, gov ×2, LCC Opps ×1).
- **Proof:** round trips on both DBs inside transactions that rolled themselves back. Numbers in the backlog row.
- **Filed:** `CONSOLIDATE-REVERSIBLE-unmerge-ui`, `-dia-restore-triggers`, `-reconcile-unmerge`, `MERGELOG-GAP` (46 orphaned dia entity refs), `MERGE-BARE-DB-CALLERS`.
- **Deploy:** redeploy `tranquil-delight` (it serves `api/admin.js`). The MCP service does not import `admin.js`, so it needs no redeploy for this change. Then check with `npm run verify:deploy`.
- **Next:** Scott clicks Consolidate on a known twin, then unmerges it with the `backup_id` from the toast.
## 2026-09-24 — GOV-CLASSIFY1-diag-race (CC): per-run classifier diag + upsert error, no module globals

`_lastClassifierDiag` and a second instance found by the sweep, `_lastDomainPropertyError`, are gone from `api/_handlers/sidebar-pipeline.js`. The diag is returned by `classifyDomainWithDiag` → `classifyAndUpdateDomain` and threaded to the stored summary, the alert gate and `domain_mismatch_warning`; `upsertDomainProperty` takes an optional caller-owned `errSink`. Guard `test/gov-classify1-diag-race.test.mjs` interleaves two real pipeline runs (both orders); a mutation that reintroduces a shared diag turns both RED. `npm test` 7,222 / 0 fail. **Owed:** redeploy BOTH Railway services, then force re-run Saginaw `6c85fe57` (must stay `no_domain`; stored diag must describe Saginaw). Detail in the backlog row.

## 2026-09-24 — Round 74 (Cowork): POSTSHIP-R73 + DOCMAP3 reconciled live; `opened_at` filled 610/612; Q56/Q57 done; `CONSOLIDATE-REVERSIBLE` + `GOV-CLASSIFY1-diag-race` prompted

**Deploy state.** `verify:deploy`: `tranquil-delight` on `4fd92810` (#2659, #2660, #2661). Scott redeployed the MCP. Edge functions `intake-salesforce` v36 / `intake-salesforce-files` v32. Two CC windows each deployed the same code; CC read both back byte-identical to `main`. Harmless, but it's a reminder that one prompt should run in one window.

**Live checks (not trusting the summaries).**
- **SF deals:** the first sync after the deploy (02:30 UTC) set `opened_at` on **610 of 612** SF deals, with 0 null among the 608 synced. The 2 still blank are SF ids the flow no longer returns. Open deals with an address still read **29 of 43**. `test/sf-bridge1-opened-at.test.mjs` passes.
- **GOV-CLASSIFY1:** both entities read `domain=gov` (Scott's 1.0.58 re-saves: Jellico → 16334, Tulelake → 16268). The gov property count (20,533) and max id (41,097) are unchanged, so nothing was minted. Saginaw's twin pair is pending in `gov_property_twin_review` id 2 → Q58.
- **Gov Available** reads 470 with 0 lenders. Scott accepted the view (Q57).
- **CONSOLIDATE-REVERSIBLE is real.** The live `gov_merge_property` is a retired RAISE stub, and `api/admin.js` ~12444 (Decision Center merge) and ~13969 (Consolidate button) still call it and `dia_merge_property`, which hard-deletes. Prompted first.

**DOCMAP3, verified on `main`:**
- The `docs/` root holds only the git-ignored setup `.docx`.
- 6 `.md` files remain at the repo root; each is required there.
- The backlog is 1,315 lines / 819 KB.
- Doc guards 32/32. The shipped-row rule and the guard now agree.

**Consolidation this round, under the new rule:**
- `GOV-CU1-edge-deploy` and `GOV-CLASSIFY1-rerun` were archived verbatim to `PLANNED-BACKLOG_shipped_2026-09-24.md`, with CURRENT-STATE §2b pointers.
- `GOV-CU1`, `GOV-AVAIL2` and `SF-BRIDGE1-opened-at` are now final ✅. They get archived next round, because the guard needs the base text verbatim.
- The DOCMAP3 row's missing cell space was fixed.
- Checklist: Q54 archived; Q56/Q57 struck; Q58 added (the Saginaw survivor, and where the 33 lender properties live).
- The SBN and Process Open-threads rows were rewritten to current state.

**Next.**
- CC: `CONSOLIDATE-REVERSIBLE` and `GOV-CLASSIFY1-diag-race`. They touch different files, so they can run in parallel.
- Then `CONTACTS-GOV-WRITER` (a split-brain producer; not yet prompted).


## 2026-09-24 — POSTSHIP-R73 (CC): both SF edge functions deployed and verified; GOV-CLASSIFY1 re-runs done (0 minted); Saginaw queued for twin review; SF `opened_at` mapped fill-forward

**Edge deploy (GOV-CU1-edge-deploy ✅, deployed twice).** A parallel window deployed both first (`intake-salesforce` v36, `intake-salesforce-files` v32; its record is on the backlog row). I found out only when merging `main`. So this deploy was redundant: same content, not a rollback. Before deploying, I diffed the live bodies against the repo. They were the pre-GOV-CU1 source, differing only in CRLF line endings, so redeploying from `main` could not roll anything back.
- `intake-salesforce`: dashboard label 37.
- `intake-salesforce-files`: 33.
- Both keep `verify_jwt=false`.

Re-read with `get_edge_function` and diffed: **10/10 and 7/7 files byte-identical.** Smoke test via `net.http_*` from LCC Opps: no-secret `?action=requeue` → **401**, `intake-salesforce?action=retry` → **401**, info GETs → 200.

**GOV-CLASSIFY1-rerun ✅.** Scott re-saved **both** Jellico (→ gov 16334) and Tulelake (→ gov 16268) on 1.0.58 before this ran. CC force-re-ran the other six through `lcc_cron_post`:
- `ea3002f6` → gov 5400
- `34195100` → gov 16527
- `8324a3b0` → dia 31231
- `e45ef618` → dia 27681
- `2a4d08f9` → dia 31277
- Saginaw `6c85fe57` → `no_domain` (as required)

**0 properties minted:** gov max id 41097, dia max id 4203595, both unchanged.

⚠️ **New: GOV-CLASSIFY1-diag-race.** `_lastClassifierDiag` is a process global. Saginaw's stored diagnostics belong to a concurrent 910 4th Ave save. The decision is unaffected, but the no_domain alert gate reads that global too.

**GOV-CLASSIFY1-saginaw-twin.** Queued as `gov_property_twin_review` id 2 (16297 + 31111, identical geocode). Not merged: 👤 decide which row survives. Record: government-lease `sql/20260924_gov_classify1_saginaw_twin_review.sql`.

**SF-BRIDGE1-opened-at (built).**
- `normalizeDeal` maps `CreatedDate` → `opened_at`.
- `ingestBatch` unwraps `{deals:{records}}`.
- Migration `20261102300000` is live and makes `opened_at` fill-forward. Rolled-back positive control passed.
- Guard `test/sf-bridge1-opened-at.test.mjs`: 10 tests, 6/6 mutations RED.
- 👤 **Redeploy BOTH Railway services.** `server.js` (tranquil-delight, where the PA flow posts) and `mcp/server.js` both import `mcp/opportunity-sync.js`.
- Verify: after the next 30-min sync, `opened_at` is NULL on 0 SF deals (610 / 612 today).

## 2026-09-24 — DOCMAP3 (Claude Code): shipped-row policy settled, loose docs filed by topic, four folders collapsed

**Docs only. No code or behaviour change, no Railway deploy, no canon change.** Branch `claude/admiring-lamport-chb78p`.

- **A. Shipped-row rule.** `DOCUMENTATION-MAP.md` §3 said "delete a shipped row"; `doc-clobber-guard` failed any
  deleted id. Both now say the same thing: a shipped row moves verbatim to
  `docs/history/PLANNED-BACKLOG_shipped_<date>.md` in the same commit. The guard accepts a removed id only if its
  whole line is in such an archive. A positive control proves it: an edited copy goes red. First pass: **101** rows
  archived. 9 ✅ rows with an owed step stayed (HCRIS-TRACKER-BLIND, SIDEBAR5, GOV-CU1, GOV-AVAIL2,
  GOV-UX1-D5-gate-buyerspe/-sponsor, C1C-UNAPPLIED, OWNERGAP2, OWNERGAP2-harris-c). CURRENT-STATE §2b has one-line
  pointers for the 66 it did not already describe. Backlog **1,400 → 1,314 lines; 811 → 718 row ids**, counted by
  the guard's parser after the new rows were added.
- **B–D. Filing.** Four read-only agents read every file in full first. Then **62 `git mv`** moves; git sees all
  62 as renames. `docs/` root: **50 → 0** files (the prompt's 51 counted `Life-Command-Center-Setup-Guide.docx`, which `*.docx` in `.gitignore` keeps untracked; its text is already in `docs/history/root-reports/`).
  Repo-root `.md`: **10 → 6**. The kept six each have a reason in map §3: `BRIGGS-WRITING-VOICE.md` is read by path
  by `api/`, `WRITE_SURFACE_POLICY.md` is bound in canon, and `SALESFORCE_LCC_INGESTION_PLAN.md` is in a runtime
  error string. `docs/cm` went into `docs/capital-markets`. `docs/claude` was a set of legacy surface
  instructions that called themselves authoritative, so it moved to
  `docs/history/claude-surface-instructions-legacy/` with a not-authoritative banner. `docs/runbooks` went into
  `docs/setup`, and `docs/round68a` into `docs/history/round68a`. 81 path references were fixed across 40 files:
  code comments, migration comments, `.gitignore`, `CLAUDE.md` and docs. Every stale claim the agents named got a
  dated banner. The move table is in `docs/history/INDEX.md` under "DOCMAP3".
- **Not rewritten, on purpose.** Edge-function source comments were left alone: editing them without a deploy is
  repo-vs-deployed drift. The dated `docs/audits/INVENTORY1_intent_2026-09.csv` was left alone too; it is evidence.
- **E.** `DOCUMENTATION-MAP.md` §0 "Where to start" was added, and `NEW-CHAT-KICKOFF.md` now points at it. The
  kickoff is ASC-specific and named the dated `BUILD-BACKLOG.md`.
- **Found while reading, measured and filed:**
  - The gov `unified_contacts` copy is **not frozen**. It has 165 rows created and 877 updated since the
    cutover; the newest was created 2026-09-24 01:53 UTC. The `CLAUDE.md` sentence was corrected in place;
    backlog `CONTACTS-GOV-WRITER`.
  - The **gov Consolidate button calls `gov_merge_property`, which now RAISEs**, and dia hard-deletes (backlog
    `CONSOLIDATE-REVERSIBLE`).
  - The connector-bridge layer is almost entirely unseeded (`BRIDGES-DORMANT`).
  - The SJC broker contact flow was never built (`SJC-BROKER-SYNC`).
  - Staged iOS shares have no consumer (`DOCMAP3-shareinbox`).
  - `FLOW-REGISTRY.yaml` pointed the live briefing-v2 flow at a deleted flow's page. It is repointed, and both
    old briefing flow pages are bannered "deleted 2026-06-05".
  - PA3, K7, SEC8 and UX-T1c-caprate-rerun carry dated corrections. The small leftovers are in `DOCMAP3-residue`.
- **ID note.** A different, finished DOCMAP3 (the 2026-09-08 deep-read, PR #2178) sits in CURRENT-STATE §2a. The
  two prompt filenames disambiguate them.
- **Next:** decide `CONSOLIDATE-REVERSIBLE` first (a live broken button), then `CONTACTS-GOV-WRITER`.
  `DOCS-CM-MISFILED` (115 archived prompts in `docs/capital-markets/`) is still open and unchanged by this round.


## 2026-09-23 — Round 73 (Cowork): GOV-CLASSIFY1, GOV-CU1, GOV-AVAIL2 reconciled live on `9d8bb05e`; SF Deal sync flow green (Q54 closed); `POSTSHIP-R73` prompted

**Round 72 (no separate entry):** flow test #2 returned 400 because the HTTP body sent the SOQL envelope (`deals.totalSize = 608`), not `body/records`. The fix went into `docs/setup/SF-DEAL-SYNC-FLOW-EDIT-2026-09-23.md` step 3 (branch `docs/round72-…`, folded into this round's PR).

**SF Deal sync (Q54 ✅).** Scott's retest #3 succeeded. Live LCC Opps:
- 608 SF deals synced in the last 2 h.
- Open deals with an address: **12 → 29 of 43**; 521 closed deals are filled as well. All carry `metadata.address_source = sf_payload`.
- The 8 open SF deals still blank have no `Property2__c` in Salesforce, which is data, not a flow defect. The other 6 open deals are not SF.
- **`opened_at` is NULL on all 610 SF deals:** `normalizeDeal()` never maps `CreatedDate`. Filed as `SF-BRIDGE1-opened-at`.

**Verified on `main` / live.**
- `verify:deploy`: `tranquil-delight` is on `9d8bb05e`, which contains #2654, #2655 and #2656.
- Tests: the three new test files pass 158/158, and the SIDEBAR3-c + GOV-AVAIL1 guards they touched pass 42/42. The diff is 16 non-doc files (+1,060/−81).
- Gov live:
  - `v_available_listings` has **473** rows and **0** lender rows;
  - the credit-union properties still typed Federal are **6**, all NCUA (correct);
  - `v_sales_comps` answers 4,859 rows (the ~15-minute GOV-AVAIL2 outage is over).
- **Not yet done:**
  - GOV-CLASSIFY1's two entities still read `domain = null`: no re-run yet.
  - `intake-salesforce` v34 / `intake-salesforce-files` v31 were not redeployed for GOV-CU1.

**CC's honest catches, worth keeping:**
- NCUA is a real agency: ID3a-c had wrongly flagged it, and CC cleared that.
- "AOC/Federal Bankruptcy Court" nearly matched a loose "federal bank" rule; the rule now matches whole words.
- The OM intake defaults every non-dialysis tenant to gov (`GOV-CU1-default-gov`).
- The resolver was never case-sensitive.
- Two merge-duplicated backlog rows were fixed by CC, plus one more found here: the duplicated SBN Open-threads row (the stale round-69 copy) is removed.

**Guard fix (`GUARD-CLOBBER1-buffer`).** `PLANNED-BACKLOG.md` passed 1 MiB, which was Node's default `execFileSync` buffer in `doc-clobber-guard`. Any backlog growth turned the guard red with a misleading "not found at HEAD". It now uses a 64 MiB buffer. DOCMAP3's shipped-row archive is the real cure for the size.

**Next.**
- CC: `POSTSHIP-R73` (edge deploy, re-runs + Saginaw twin, `opened_at`), then `DOCMAP3`. Sequenced so the doc moves don't collide with backlog edits.
- Scott: Q56 (re-save Tulelake/Jellico) and Q57 (re-check Available; MCP redeploy after POSTSHIP-R73 merges).


## 2026-09-23 — GOV-AVAIL2 (CC): one display normalization for gov Available, Sales Comps and Leases

**DB live on gov (`scknotsqkcheojiaewwh`); the JS ships on the next Railway redeploy.** Record: government-lease `sql/20260923_gov_avail2_display_normalization.sql`.

- **The resolver was never case-sensitive.** `gov_agency_alias_key` uppercases (now committed; it had been live-only). The screenshot's `GENERAL SERVICES ADMINI…` was `properties.agency_full_name` on 2 listings with no agency, shown raw. The views now resolve it as the last fallback.
- **Agency tail:** 26 reviewed single-agency spellings promoted through the ID3a path (only where `canonicalize_agency` agrees and the spelling is still unresolved), and MSHA + NARA registered. Available **271 → 294 matched, 206 → 168 unresolved**; Sales Comps **3,410 → 3,476 matched**. Left unresolved on purpose: state agencies (`GOV-AVAIL2-state-registry`: the `ST-*` rows carry no state), multi-agency strings (`GOV-AVAIL2-multi-agency`), generic "US Government", and non-government tenants (GOV-CU1).
- **Display:** ALL CAPS on Available went from **address 60 → 5** (route-only, correct), **city 40 → 0** and **agency 16 → 0**. Stored values are untouched. Readers touched: gov.js Available and Sales Comps (`renderGovSales`), and both Leases tables (`buildGovLeasesHTML`). Leases paging was also fixed: a 2,000 stride stopped at page one under PostgREST's 1,000 cap.
- ⚠️ **A display function took `v_sales_comps` down for ~15 minutes.** The first cut built regex patterns inside loops, so Postgres recompiled ~150 patterns on every call: 23 ms a row, and the view could not answer inside 60 s. Rewritten word by word with static patterns: 1.3 s for all 4,859 comps. There is now a guard for it. **Time a view over its full population before and after adding a per-row function.**
- ⚠️ **`initcap()` depends on the locale provider.** Production is ICU en-US (`'u.s.'` → `U.s.`); a libc test cluster gives `U.S.`. The test cluster is built with ICU, or the dotted-initials rule is untestable.
- Guards: government-lease `tests/unit/test_gov_avail2_display_normalization.py` (18 tests, 10 mutations red) and `test/gov-avail2-display.test.mjs` (10 tests, 10 mutations red). GOV-AVAIL1's two text pins ("Comps keep raw cells") were retired on purpose.
- **Next:** redeploy both Railway services, run `verify:deploy`, then Scott re-checks Gov › Deals › Sales › Available.

## 2026-09-23 — GOV-CU1 (Claude Code): private "federal" lenders out of the gov universe

- **Shipped.** One strip rule (JS + Deno mirror + gov SQL) removes private federally-chartered lender names before any gov classifier reads "federal". Wired into the sidebar classifier, credit-tier resolver, SF deal classifier, both SF routers, and the OM create path. The OM path had been sending every non-dialysis tenant to gov by default.
- **Gov DB (live, reversible):** Available **490 → 473**; 33 lender properties archived; 702 lost a false `Federal`; the insert guard refuses new lender-only rows.
- **Caught on the way:** the 6 NCUA properties (a real agency, carrying all 8 leases and 8 sales) had been tagged "private company" by ID3a-c; that tag is now cleared. "AOC/Federal Bankruptcy Court" nearly matched `federal bank`.
- **Next:** edge functions DEPLOYED 2026-09-24 (`intake-salesforce` v36, `intake-salesforce-files` v32, byte-verified against `origin/main`, both answer 200). JS goes live on the Railway redeploy. `GOV-CU1-home` needs Scott's decision. Backlog: GOV-CU1 updated; five follow-ups added.

## 2026-09-23 — GOV-CLASSIFY1: existing-record-first sidebar classification + numbered-route equivalence

- **Existing record first.** `findExistingDomainPropertiesForCapture` asks dia and gov whether the captured address already is a property (same state/city, exact civic number, `addressesIdentityEquivalent`). The domains that hold it ARE the domain set (`resolveDomainsWithExistingRecords`); a pattern hit for a domain with no record does not add it. Needs exactly one candidate per domain, otherwise it is ambiguous and contributes nothing. It fails open.
- **Route equivalence** (`api/_shared/route-address-equivalence.js`): `CA-139`/`Ca 139`/`State Highway 139`/`State Hwy 139`/`SR-139`/`Hwy 139` and `US-2`/`US Highway 2`/`U.S. 2` compare by system + number. It is also a new `upsertDomainProperty` fallback, so the Tulelake save attaches to gov 16268 instead of minting a twin, and the stored address is kept.
- **Patterns:** ranger station/district, BLM, USFWS, national park/refuge/grassland, National Archives, `<state> DHS`. Offering-document titles (`document_links[].label`, OM/flyer/brochure only) join the search text.
- **Measured over the 15 `no_domain` failures in the last 30 days:** 8 now classify (gov 16268, 16334, 5400, 16527; dia 31231, 27681, 31277). Saginaw is held as ambiguous because gov has twin rows 31111/16297 for 1040 N Towerline. Jasper, Sweeny and Oviedo differ from their DB rows by spelling or unit and stay unclassified. That is the conservative outcome, not fixed here. Parcel and CoStar-id tiers are not possible: neither property has a `parcel_records` row, gov has no CoStar id column, and the two entities' `costar/property` identities hold a URL and an APN, not the CoStar id.
- **Tests:** `test/gov-classify1-existing-record-first.test.mjs` (137 tests). Mutation pass: 14 of 16 go red. The 2 survivors are equivalent mutants. `npm test` is green apart from a stale SIDEBAR3-c source grep, which was updated.
- **Not yet done:** re-running the 2 named entities and the other 6, which needs the Railway redeploy (both services), then Scott re-saves one page on extension 1.0.58.
## 2026-09-23 — Round 71 (Cowork): the SF Deal sync flow test failed on a pasted "sql" tag (guide fixed); retracted-runbook trap bannered; `DOCMAP3` prompted

**Q54 retest owed.** Scott saved the flow edit. The test failed in `Get_deals_soql` with `unexpected token: 'sql'`: `queryParameters/query` began "sql SELECT…" because the code-fence language tag was pasted into the SOQL box. That is not a field or permission error. `docs/setup/SF-DEAL-SYNC-FLOW-EDIT-2026-09-23.md` now shows the query as one plain-text line with a warning. Checklist Q54 carries the one-step fix.

**Misdirection trap removed.** `docs/history/RUNBOOK_sf_opportunity_inbound_flow.md` is headed "RETRACTED — there is no Salesforce Opportunity object". That is true for **BD opportunities** (Tasks with NM Type "Opportunity"), but the Opportunity object does exist and holds Team Briggs **deals**, which the live flow reads. A clarification banner now sits above the retraction and points at the setup guide.

**Consolidation by topic (Scott's standing ask) → `DOCMAP3`.** Measured:
- 51 loose `docs/` root files;
- duplicate folders (`docs/runbooks`/`docs/setup`, `docs/claude`/`docs/claude-code`, `docs/cm`/`docs/capital-markets`, `docs/round68a`);
- 10 repo-root `.md`;
- a live policy contradiction: `DOCUMENTATION-MAP.md` says delete shipped backlog rows, `doc-clobber-guard` fails any removed row id, and the backlog is 817 rows / 145 done.

Prompted as a docs-only CC round: first a verbatim shipped-row archive with a guard exemption, then `git mv` by topic with link fixes and a "where to start" index.

**In flight with CC:** GOV-CLASSIFY1, GOV-CU1. (GOV-AVAIL2 built 2026-09-23, see below.) Next up for CC: DOCMAP3, sent after those three merge so the doc moves don't collide with their backlog edits.


## 2026-09-23 — Round 70 (Cowork): SIDEBAR5, GOV-COMPS-CAP and D5-gate-2 reconciled live; Q52 closed; SF Deal sync flow read and edit written; SBN-26–29 → `GOV-CLASSIFY1`, `GOV-CU1`, `GOV-AVAIL2`

**Deploy and verification:**
- `verify:deploy` shows `tranquil-delight` on **`9c994171`** (#2649, #2650, #2651), and government-lease #410 is merged.
- The 59 new tests pass on `main`. `data-query` **v46** is confirmed live, with `count-mode.ts` present.
- **Q52 ✅:** after Scott's MCP redeploy, Findlay's opportunity reads `1717 Medical Blvd, Findlay, OH 45840` (source `dia.sf_deal_staging`, 20:00 UTC sync). 12 of 43 open deals have an address.

**Live checks:**
- Gov 41083 is now `2600 Central Fwy N`.
- `gov_property_twin_review` holds `sidebar5_2600_central_fwy` (41083/31048/31796), pending with 3 open questions.
- Extension 1.0.58 and the gov comps pill still need Scott's check → **Q55**. D5 lane now 15 cards, ready to grade → **Q51**.

**Q53 → flow read.**
- Scott can't delete Salesforce records without approval, so an LCC-side suppression list is filed as **`SF-BRIDGE1-suppress`**.
- Scott's export (flow `eb1181ba…`): Recurrence 30 min → **Get records** (Opportunity, 6 RecordTypeIds, `$select` without Property or CreatedDate) → HTTP POST `/api/pipeline/ingest-opportunities`.
- The exact edit is in `docs/setup/SF-DEAL-SYNC-FLOW-EDIT-2026-09-23.md`: swap to **Execute a SOQL query** with `Property2__r.*` + `CreatedDate` + `RecordType.Name`, and point the body at `body/records` → **Q54**. LCC's `normalizeDeal` doesn't map `CreatedDate` yet (noted on the row).
- The export carries the ingest bearer token, so it was moved to the gitignored `private/power-automate/exports-2026-09-23/`.

**New intake from Scott's screenshots (SBN-26…29):**
- **Credit unions filed as federal government (`GOV-CU1`).** 705 gov properties have a credit-union agency, all typed `Federal` (669 were already junk-archived in June but still carry the type). **15 are on the live Available list via OM intake.** A federal credit union is a private cooperative, not a government tenant.
- **`no_domain` on gov properties that already exist (`GOV-CLASSIFY1`).** Jellico TN (TN DHS, gov 16334) and Tulelake CA ("Us Ranger Station", gov 16268 `49870 Ca-139`). The classifier matched no pattern and never checks whether the address is already a domain property. Document titles like "OM_State of TN DHS" are ignored, and `Ca-139` ≠ `State Highway 139`.
- **Display still mixed (`GOV-AVAIL2`).** 53 ALL-CAPS addresses and 50 ALL-CAPS agencies out of 490. Unresolved agencies show raw, including `GENERAL SERVICES ADMINI…`, which points at a case-sensitive resolver path. Bundled with `GOV-AVAIL1-agency-tail`.

**Docs:**
- Backlog: SIDEBAR5, GOV-COMPS-CAP, SF-BRIDGE1 and SF-BRIDGE1-flow updated; `SF-BRIDGE1-suppress`, `GOV-CLASSIFY1`, `GOV-CU1` and `GOV-AVAIL2` added.
- TRIAGE: SBN-26…29.
- Checklist: Q52 and Q53 archived; Q51 set to ready; Q54 and Q55 added.
- 1 prompt and 4 responses moved to `done/`.


## 2026-09-23 — SIDEBAR5: CoStar Contacts-tab address, stuck "still processing", header tenants (CC)

- **Address.** CoStar #1014478 was saved from its Contacts tab and captured the Primary Leasing Company office
  (`4005 Call Field Rd, Suite 100`) as the property. Two defects: `Fwy` was not a street type (so the header
  failed in the `<h1>` and the title), and the body-wide line walk ran before the title. The subject address
  now comes from headings → title → lines above the first contact section, with no fallback; nothing found
  blocks Save with a re-scan prompt. Server: `upsertDomainProperty` refuses a capture whose street differs from
  its `_page_title`, and consults the GOV-AVAIL1 DB office registry.
- **Stuck status.** The poll backs off to ~180 s and ends only on a run stamped after the action; a stored
  terminal run newer than the memo overrides it. An Update's previous summary is no longer read as success.
- **Tenants.** The extension filters LEASEJUNK1's header list, lock-step with the server (drift test).
- **Residue (live):** entity `2f90e232…` → `2600 Central Fwy N` (logged on the row); gov 41083 corrected in
  place (7 values logged, restore proven in a rolled-back round trip); 41083/31048/31796 in
  `gov_property_twin_review`, nothing merged. 30-day census: 5 confirmed same-class captures of 363
  (SIDEBAR5-residue), a floor.
- Tests: `sidebar5-subject-address-and-header-tenants` (19), `sidebar5-pipeline-status` (11); full suite
  7,022 pass / 0 fail. Manifest 1.0.58. **Next:** merge both PRs, redeploy both Railway services, Scott reloads
  the extension, Cowork re-verifies with a Save from a Contacts tab.

## 2026-09-23 — GOV-UX1-D5-gate-2 (CC): bank rule, buyer-SPE note, one card per decision-maker — lane 20 → 15 cards, projected 50% → 67%

- **bank ✅ live:** `lcc_owner_name_is_plain_bank` OR-ed into `lcc_owner_name_is_bank_or_trustee`. Seller queue 502 → 498. The only rows removed are Truist Bank's 4 ($27.6M). Graded 32/42 bank-ish names; SPEs named for a bank building (`BANK BUILDING INVESTORS, LIMITED`, `Bank of America Plaza`) and `Food Bank of Delaware` stay out. Universe −48, top-seller −26, Tier 0 −16; the other four consumers are unchanged.
- **buyerspe ✅ view live:** `dm_people[].shared_buyer_parent`. PASADENA SSA → UIRC, Opi Wf Owner → RMR Group. Both stay in the lane with a note and are off the auto path.
- **sponsor ✅ CHECK live:** the 5 ARC SPEs (Karen Massey) → 1 card; sibling rows use `decided_via='cluster'`, which the meter does not count.
- **Re-grade:** 216 candidates → 19 owners → **15 cards**, projected **10/15 = 67%**. The residual rejects are other classes (FD Stonewater own-name, GH Westerville lender contact, Homestead tenant), so auto-create stays locked.
- Migration `20261102280000` (applied). Guard `test/gov-ux1-d5-gate-2.test.mjs`: 11 tests, 17/17 mutations RED. Suite 7,003/0.
- **Next:** redeploy both Railway services + `npm run verify:deploy` (busters `2026092303`), then Q51 (Scott grades). Response: `responses/GOV-UX1-D5-gate-2.response.md`.
## 2026-09-23 — GOV-COMPS-CAP (CC): the Sales Comps list stopped at 2,000 because a planner count is a range bound

- **Cause (measured, gov `edge_logs`):** every load sent `offset=2000` and got **416**. `data-query` asked for `count=planned` on `v_sales_comps`; the planner estimates 1,817 rows (real: 4,849) and PostgREST refuses offsets past its own estimate. `govQuery` swallowed the 416 as `[]`; the loop treated the short page as the end.
- **Fix:** edge `data-query` **v46** deployed to Dialysis_DB (no implicit count after page 0; 416 → one retry without count). Verified live via `pg_net` from LCC Opps: offsets 2000/3000/4000 → 1,000/1,000/849 rows; `count=exact` → 4,849. `gov.js`: shared `govLoadSalesComps()` (exact count on page 0, pages to it) + pill from `govSalesCompsCountLabel` (exact total, "N of M" if partial). Cache busters `2026092302` → `2026092303` (22 tags).
- **Deploy state:** edge live now (so even the old client already loads all rows); the exact-count pill ships on the Railway redeploy of **both** services. 👤 Scott: Gov › Sales pill should read **4,849**.
- **Why 4,849 ≠ 15,177:** `v_sales_comps` = `transaction_state='live' AND exclude_from_market_metrics IS NOT TRUE`. The rest: 5,211 `duplicate_superseded` twins, 3,313 `ownership_stub` (ownership changes, 17 priced), 919 `needs_review` (0 priced), 886 live but excluded — 741 with a DQ reason, **145 with none** → filed `GOV-COMPS-SCOPE-reason`.
- **Guard:** `test/gov-comps-cap.test.mjs` (18 tests; 5 mutations against the shipped files all RED). Suite 7,010 pass / 0 fail.


## 2026-09-23 — Round 69 (Cowork): D5 gate + SF-BRIDGE1 reconciled; the Findlay listing is live end to end; `SIDEBAR5`, `GOV-COMPS-CAP` and `GOV-UX1-D5-gate-2` prompted

**Deploy:** `verify:deploy` shows `tranquil-delight` on **`ec1d81df`** (#2646 + #2647). The 56 new tests pass on `main`. SF-BRIDGE1's opportunity sync lives in `mcp/opportunity-sync.js`, so the standalone MCP service must be redeployed too → **Q52**. Findlay's deal is already `type=listing`, but `property_address` was still null after the 19:00 UTC sync.

**GOV-UX1-D5-gate ✅ (live, flag OFF).**
- Gate candidates view: 217 pre-gate rows. Precision view: 0 decisions, threshold 0.9 over 25. Cron `lcc-seller-lead-autocreate` (weekdays 13:10 UTC) is active.
- CC graded the 20 gated owners and found **10 real**. The rejects are 3 fixable classes (5 ARC GS REIT SPEs sharing one AR Global contact, Truist Bank, a UIRC SPE sibling).
- Cowork's recommendation: close those classes **before** Scott grades, otherwise the meter pins near 50% for code reasons. Prompted `GOV-UX1-D5-gate-2`, and Q51 is paused until then.

**SF-BRIDGE1 ✅, Findlay verified live.**
- Requeued `sf_files` 1747. The 19:15 UTC drain produced intake `3605ee76…` **finalized, matched, dialysis 51194**, and created dia `available_listings` **15286**: active, `is_northmarq=true`, listing date 2026-09-23, **price null (nothing fabricated)**.
- Open deals are now typed: listing 19, bov 7, sf_deal 9, prospect 4, government_buyer 4.
- Residue: 21 open deals have no address until the Power Automate flow sends the property fields (`SF-BRIDGE1-flow`, flow export → **Q53**). The test and duplicate deals must be removed in Salesforce (**Q53**). Minor: `sf_files.process_notes` keeps an interim "extract:processing" note.

**New from Scott's screenshots (Wichita Falls, CoStar #1014478):**
- **`SIDEBAR5`: the wrong address was captured.** The page is **2600 Central Fwy N – Wichita Falls Shopping Center**. Saved from the **Contacts** tab, the capture took the Primary Leasing Company block (Truity Capital, 4005 Call Field Rd, Suite 100) as the property, and minted gov **41083** under the wrong address. Gov already has 2600 Central twins 31048/31796.
- **The panel never reported success.** The run finished in 55 s, but `pollPipelineStatus` gives up at 35.5 s, and SIDEBAR4-d's 10-min memo outranks the stored `success`. The answer to Scott: once the Save is acknowledged, it's safe to navigate away (the server finishes regardless). The display fix is in SIDEBAR5.
- The capture still sends "Office/Ret Avail" / "Total Avail" as tenants: the LEASEJUNK1 extension residue, also in SIDEBAR5.
- **`GOV-COMPS-CAP`: the Sales Comps list stops at 2,000.** Live `v_sales_comps` = **4,844**. The loaders page to a short page, so the cap is upstream, and the pill counts loaded rows, not the true total.

**Checklist:** Q50 answered and archived. Q51 paused behind gate-2. Q52 (MCP redeploy) and Q53 (Salesforce cleanups + flow export) added.

**Docs:** backlog rows updated or added (D5-gate + 3 gap rows, SF-BRIDGE1, SIDEBAR5, GOV-COMPS-CAP). 2 prompts and 3 responses moved to `done/`.


## 2026-09-23 — SF-BRIDGE1 (CC): Salesforce deals get a type + address; seeded OMs follow their deal; panel stops offering "Create the lead" on our listings

- **Measured first:** 610 SF-synced `bd_opportunities` had `type IS NULL` (35 open) and **0 of 610 had an address**. The writer (`mcp/opportunity-sync.js` → `lcc_upsert_bd_opportunities`) never sent a type, and the RPC had no type column.
- **Migration `20261102270000` applied live** (renumbered from `…260000`, which collided with GOV-UX1-D5-gate's file of the same timestamp). It extends the CHECK (`listing/bov/buy_side/sf_deal`), makes the RPC write `type` (an LCC-owned type is never overwritten), makes `property_address` fill-forward, and logs a backfill of 610 rows. Open deals are now listing 19 / bov 7 / sf_deal 9, with 0 NULL. A rolled-back RPC probe on Findlay proved the address survives an address-less payload and that `prospect` survives an incoming `listing`.
- **Address:** Salesforce has it in dia/gov `sf_deal_staging`, and Findlay's is `1717 Medical Blvd, Findlay, OH 45840`. The sync reads it now. 12 of the 35 open deals have one; the other 21 are not staged anywhere and wait on `SF-BRIDGE1-flow`. `docs/flows/README.md` was wrong about which file is this flow, and is corrected.
- **Seeded OM match:** `api/_shared/sf-seed-match.js` is wired into `matchIntakeToProperty` via `opts.seedData`. It covers no-address/agree/conflict/cross-vertical/multi-property, and a Decision Center disambiguation card is deferred while a seed resolves. The promoter sets `is_northmarq` only from a resolved seed on our listing.
- **Panel:** `/api/priority-band` returns `open_deal`; the property and entity banners read "Our listing is live".
- Guard `test/sf-bridge1.test.mjs`: 30 tests, 15/15 mutations RED.
- **Deploy:** the migration is live now. JS needs a Railway redeploy of **both** services (`server.js` and the standalone MCP `mcp/server.js` both mount the opportunity sync). No edge function changed. Then `npm run verify:deploy`.
- **Next (Cowork):** after the redeploy and one 30-min sync, check that Findlay `bd_opportunities.property_address` is filled. Then requeue `sf_files` 1747 (`?action=requeue`). Expect `matched` dia 51194 (reason `sf_seed_listing_*`) and a dia `available_listings` row with `is_northmarq=true`. Open the 51194 panel and expect "Our listing is live".

## 2026-09-23 — GOV-UX1-D5-gate (CC): tight seller-lead gate, review lane on the Priority tab, precision-gated auto-create (flag OFF)

- **Migration `20261102260000` (applied live on LCC Opps):** `lcc_is_seller_lead_decision_role`, `lcc_seller_lead_gate_decision` (one live decision per owner), `v_lcc_seller_lead_gate_candidates`, `v_lcc_seller_lead_gate_precision`, flag `SELLER_LEAD_AUTOCREATE` = off, cron `lcc-seller-lead-autocreate` (weekdays 13:10 UTC; a named skip while locked).
- **Live funnel:** 217 candidates → **20 qualify**. The decision-maker role cuts 191; repeat buyers cut 6 more. Graded all 20: **10 keep / 10 reject**, so the first page is ~50%. Auto-create stays locked by design. Details and gaps are in `responses/GOV-UX1-D5-gate.response.md`, and the gaps are filed as `GOV-UX1-D5-gate-bank/-buyerspe/-sponsor`.
- **JS (needs the Railway redeploy of both services + `npm run verify:deploy`):** `api/_shared/seller-lead-gate.js`, `api/_handlers/seller-lead-gate.js` (`/api/seller-lead-gate`, `/api/seller-lead-autocreate-tick`), the Priority-tab lane in `ops.js`, `bridgeCreateLead` exported (still the only lead writer), and cache busters `2026092301 → 2026092302`.
- **Tests:** `test/gov-ux1-d5-gate.test.mjs` 26 tests, 19/19 mutations RED; full suite 6,962 pass / 0 fail.
- **Next:** Scott works the lane (checklist **Q51**) and flips the flag when the meter reads eligible.

## 2026-09-23 — Round 68 (Cowork): 1.0.57 Save verified (one run); Q49 edge function verified; Findlay linked to dia 51194; Q48 → hybrid gate prompted; `SF-BRIDGE1` prompted; STATUS archived

**SIDEBAR4-c/-d ✅ closed (live).**
- Scott reloaded 1.0.57 and saved a Wichita Falls VA property. Its run log (entity `2f90e232…`) shows **exactly one** `entities.post` run, `client: lcc-extension/1.0.57`, success in 55 s, with no follow-up PATCH or Re-run. The SIDEBAR4-d panel blocks re-clicks while it processes.
- Earlier same-day Saves without `client` still showed the old PATCH + coalesced-Re-run pairs, so the reload is what fixed it.
- Answer to Scott: the pipeline runs server-side as fire-and-forget (`entities-handler.js` ~2976/3021), so navigating away once the Save is acknowledged doesn't interrupt it.

**HOME-MB-BOOT ✅ closed.** Scott's hard refresh shows Market Briefs (Dialysis, 23 live facts).

**Q49 ✅.** `intake-salesforce-files` is **v31** on Dialysis_DB. GET info reports `sf-files-2026-09-v8`, `requeue` is in the action list, and an unauthenticated `?action=requeue` returns 401. INTAKE-RESTAGE1 is closed.

**Q45 ✅ (Findlay).**
- Scott: 1717 Medical Blvd, Findlay, OH 45840.
- Dia **51194** is the 13,975 SF building (1998). **28037** is suite C (5,966 SF, the US Renal lease): a separate record, not a twin.
- Cowork set the orphan Salesforce asset `084897cc…` address and linked it `external_identities (dia, asset, 51194)`, noted in its metadata.
- No dia listing row exists yet, and the OM can't match through the Salesforce seed → **`SF-BRIDGE1`** (with GOV-UX1-D4-sftype).

**Q48 answered.** Scott: *"automate as much as possible … the overall objective is getting to accuracy and action."* Cowork's recommendation is a hybrid: the tight gate (decision-maker role, clean owner name, no repeat buyers, point-person owner) feeds a one-click review lane on the Priority tab and/or the Home BD lane, and each accept or reject records precision. A flag auto-creates once precision is ≥ 90% over ≥ 25 decisions. Prompted as `GOV-UX1-D5-gate-tightened-review-lane-then-auto.md`.

**Wichita Falls (new, → Q50).**
- The capture was CoStar #1014478, **4005 Call Field Rd, Suite 100**: a multi-tenant retail center with a VA clinic tenant. It was minted as gov **41083** (`agency_canonical=VA`, `government_type` null, 0 leases).
- Scott said "2600 Central Fwy N". The VA clinic at **2600 Central E Fwy** exists twice in gov (31048 / 31796), and that pair was appended to `GOV-AVAIL1-twins`.

**STATUS archived:** the oldest 820 lines (Round 29 back through the 2026-09-16 Harris entry, all 09-16/17) moved verbatim to `docs/history/STATUS_claude-code_2026-09-16_to_09-17_tail16.md`. The file went from 2,435 to ~1,650 lines.

**Checklist:** Q45, Q47, Q48 and Q49 archived; Q50 added.

## 2026-09-23 — RATINGS-CQM-CIRCUIT-BREAKER-3 (Cowork): clinic_quality_metrics's `.upsert()` was never really an upsert on the wire — the same client-header bug that broke `ratings` in round 2, now found in round 3

**What CC found.** `get_supabase_client()`'s client-wide `Prefer: return=minimal` header overwrites the `Prefer: ...,resolution=merge-duplicates` that `postgrest` 2.31's own `.upsert()` builds internally, so every `clinic_quality_metrics` upsert request actually goes out as `Prefer: return=minimal` only. PostgREST ignores the `?on_conflict=medicare_id,snapshot_date` query param without a resolution preference telling it what to do on conflict, so it silently runs a plain `INSERT` — which 23505s on every one of the table's existing rows (all created 2026-03-11/03-12, i.e. the entire table). `safe_execute()`'s attempt to restore the upsert-specific header looks for it on `builder.headers`, but `.upsert()`'s returned object actually keeps it on `builder.request.headers` — so the repair silently never fired. Confirmed with a mock transport at the wire level.

**Fix**: a new `_ensure_merge_duplicates_prefer` helper puts `resolution=merge-duplicates` back on `builder.request.headers` after `.upsert()` builds the request — called only on the `clinic_quality_metrics` REST write path. `ratings` and `properties`/`facility_patient_counts` untouched. Round 1's comment claiming this path "can never raise 23505" corrected.

**Tests**: 5 new (`tests/test_ratings_cqm_circuit_breaker_3.py`) using the real `postgrest` client + `safe_execute()` against a fake server returning `409`/`23505` for an existing key sent without `resolution=merge-duplicates` — removing the fix reproduces the exact production log line. Full suite 3,363 passed / 2 failed, the same 2 pre-existing failures reproduced on unmodified `main` too. **Why round 1's 22 tests missed this entirely**: they stubbed both `safe_execute` and the client and only checked the call was *named* "upsert" — the header merge and PostgREST's actual handling of the request were never exercised.

**Delivery**: `Dialysis` branch `claude/jolly-galileo-2a31j3`, **PR `sbriggssjc/Dialysis#7426`** — Scott reports merged.

**Independent verification performed by this session.** Queried `ingestion_tracker` live: the run in progress at the time of this check (`04153e0c…`, `cms_medicare_clinics`, started 2026-09-23 15:40:06 UTC) started before this PR could have merged, so **it predates the fix — no live proof exists yet.** `clinic_quality_metrics.updated_at` is still frozen at 2026-09-22 14:24:22, unchanged. `CQM` closes to 🟡 pending live proof, same bar every round in this saga has had to clear.

**Two new items CC filed as their own rounds, not fixed this round, both promoted to their own `PLANNED-BACKLOG.md` rows:**

- **`RATINGS-CQM-CB3-upsert-class`**: the same client-header-overwrite bug likely affects all **133 `.upsert(` call sites across 63 files** in `src/` that go through `get_supabase_client()`/`safe_execute()` without setting their own `Prefer` header — including `_ingest_payer_mix`/`_ingest_ownership_history`, the two write paths round 1 called "already-proven" and used as the fix template. They show no `23505`s in the last 3 days, but CC is explicit that only means they haven't yet collided with an existing key, not that they're immune. Root fix candidate (making `safe_execute()` write to `builder.request.headers`) changes every upsert in the repo at once, so scoped out rather than done inline.
- **`RATINGS-CQM-CB3-tracker-close`**: every `cms_ingestion` tracker row since 09-22 has only ever closed via the *next* run's reclaim, never via its own `finish_run()`; every one has an empty `error_log` and `notes='{}'`. **Independently confirmed live, not accepted at face value**: the 06:03 pair's tracker rows (`a0353e28…`/`f8acb450…`) are still `run_status='started'`, `finished_at=null` as of this check, now 11h45m old — genuinely not reclaimed by the 15:40 run despite being 9.6h old against the reclaim logic's 2h threshold, matching CC's claim exactly. This is the same gap named "Railway 'completed' ≠ Supabase `finish_run()` called" in the prior dated entry.

**Separately noticed while verifying, not yet understood or claimed as related to either fix**: the in-progress 15:40 run has no paired `facility_patient_counts` tracker row (every prior trigger produced two rows seconds apart) and, over 2h08m, has touched only 3 of 11,844 `properties` rows and logged zero errors of any kind. Flagged as a live anomaly worth watching on its own — not folded into either fix's evaluation.

**Docs:** `PLANNED-BACKLOG.md`'s `RATINGS-CQM-CIRCUIT-BREAKER` row updated with the round-3 outcome; two new rows added (`RATINGS-CQM-CB3-upsert-class`, `RATINGS-CQM-CB3-tracker-close`), both 🔴 not started, not yet prompted. Response filed to `responses/done/`, prompt moved to `prompts/done/`.

---

## 2026-09-23 — Round 67 (Cowork): Q46 builds reconciled (D1–D3 live, D4 closed, D5 held → Q48); SIDEBAR4-d merged; INTAKE-RESTAGE1 live-verified on the Findlay file

**Deploy:** `verify:deploy` shows `tranquil-delight` on **`2967920a`** (= `main`, with #2638–#2642). government-lease #409 is merged. The `intake-salesforce-files` edge function is still **v30** on Dialysis_DB, so `?action=requeue` is not live → **Q49**.

**GOV-UX1-D1–D3 ✅, live-verified on the gov DB:**
- `v_gap_agency_drift` = 625 rows / 534 props `agency_disagreement` + 2 null. It was 1,481 / 1,239 before D1.
- Ledger `gov_ux1_agency_write_log` holds batch `gov_ux1_20260923`: 46 field writes (21 D2 + 4 D3). Cron job 52 (`gov-ux1-agency-autoresolve`, 04:40 UTC) is active.
- `v_next_best_action` is back to **2.29 s** (EXPLAIN ANALYZE). CC's first view version had pushed it to 45 s for about 5 min.
- D2 hit 21, not the audit's ~272. The audit counted superseded and expired leases. Scott's Omaha example is one of those: its DHS lease was superseded, and the current lease names a GSA field office, so it stays human.
- Residue → `GOV-UX1-D1-registry`: 571 unrecognised strings, mostly GSA field-office names. How to treat them is Scott's rule call, filed but not yet on the checklist.

**GOV-UX1-D4 closed, D5 held.**
- CC re-measured and built nothing, correctly. The 35 "open opps with no cadence" are our own Salesforce listing and escrow deals (type NULL → `GOV-UX1-D4-sftype`), and every real prospect already gets a cadence from `bd_opportunity_auto_seed_cadence`.
- The D5 gate is 54 owners. 28 of them qualify only through a `works_at` link, and the first page includes an address filed as the owner, a bank, REIT SPEs and repeat buyers.
- Scott's decision → **Q48**: (a) tighten the gate, then automate (~25 owners), or (b) a review lane.

**SIDEBAR4-d ✅ merged (#2638).** Extension-only; manifest 1.0.57. 19/19 tests pass on `main`. It goes live when Scott reloads the extension → **Q47**.

**INTAKE-RESTAGE1 ✅ stage-om half, live-verified.**
- `sf_files` 1747 (Findlay) was requeued by SQL, and the 17:30 UTC cron drained it to `extracted` on the **same** intake `3605ee76…`: 1 staged row, 2 extraction rows, no new card, no failure. The card shows `archived`.
- 12/12 tests pass.

**Q45 (Findlay):** Salesforce has no address either. Opportunity `006Vs00000hhYfCIAU` has `property_address` null, and its LCC asset `084897cc…` is orphan-flagged with city only. The address has to come from Scott.

**Other session's work, noted and not touched:** the HCRIS lane merged #2641. `prompts/RATINGS-CQM-CIRCUIT-BREAKER-3-cqm-upsert-still-23505s.md` is that lane's open prompt.

**Docs:**
- Backlog: INTAKE-RESTAGE1, SIDEBAR4-d and GOV-UX1-D1..D3 annotated.
- Checklist: Q45 extended, Q49 added.
- 3 prompts and 4 responses moved to `done/`.
- SBN Open-threads row rewritten to current state.


## 2026-09-23 — GOV-UX1-D1/D2/D3: agency-drift detector fixed; GSA occupant + blank agency auto-resolved (government-lease)

- **D1 live:** `v_gap_agency_drift` now reads the current lease only and compares canonical occupying agencies. `agency_disagreement` 1,481 rows / 1,239 props → **646 / 555**; the null kind 46 / 45 → **6 / 6**. Same columns and kinds, so no LCC change. ⚠️ The first version called `canonicalize_agency()` per row and made `v_next_best_action` take 45 s for ~5 min; it was replaced with the stored columns (2.3 s), and a guard now forbids the call.
- **D2/D3 live, batch `gov_ux1_20260923`:** 21 GSA properties got an occupying agency (`using_agency_canonical`) and 4 blank properties got `agency`. Everything is ledgered and restorable (a rolled-back round trip was exact), and cron 52 keeps it true daily at 04:40 UTC. The brief's ~272 / ~45 counted superseded and expired leases. The Omaha GSA-vs-DHS case is one: its DHS lease was superseded, and it stays human.
- Residue (571 of the 646) is mostly GSA field-office strings in `leases.tenant_agency` → **GOV-UX1-D1-registry**. Tests: 14 behavioural on a throwaway Postgres, 8/8 mutations RED, gov suite 1,072 passed. No Railway deploy (no LCC code).


## 2026-09-23 — RATINGS-CQM-CIRCUIT-BREAKER / HCRIS-TIMEOUT-10: first post-merge run is a split verdict — `ratings` clean for the first time ever, `clinic_quality_metrics` still fully broken via a new `.upsert()`-based failure; `ingestion_tracker` rows not reliably closing even when Railway shows "completed" (Cowork)

**Background:** all three merges from this saga (`HCRIS-TIMEOUT-10` #7423, `RATINGS-CQM-CIRCUIT-BREAKER` #7424, `RATINGS-CQM-CIRCUIT-BREAKER-2` #7425) were in place before this run started — the first genuine live test of all three together.

**The 09-22 14:10/14:11 UTC run never finished or was reclaimed cleanly.** It ran 15h52m before `reclaim_stale_started_runs` swept it at the next day's 06:00 UTC cron (06:03:32 UTC 09-23) — the message: *"Reclaimed by reclaim_stale_started_runs: no finish recorded within 2.0h of start."* This is the run flagged in the prior entry as "past the 2-hour window and not yet understood" — now resolved as a reclaim, not a hang that self-corrected.

**The next run (`ingestion_tracker` rows started 06:03:32/06:03:42 UTC 09-23) is the first real post-merge test, and it's a split verdict:**

- **`ratings` — genuinely clean, first time in this entire multi-week saga.** Independently queried `ingestion_run_errors` for this run: **zero** `ratings` errors of any kind. All 7,013 rows show fresh `updated_at` timestamps from this run. PR #7425's fix (decide insert-vs-update via a dedicated SELECT, never trust the UPDATE response body) holds on its first live test.
- **`properties`/`HCRIS-TIMEOUT-10` — looking good so far.** ~90% of the fleet touched by the time of this check, consistent with the compare-before-write fix from PR #7423 working as intended (not yet a full clean-run confirmation — see below on why the tracker rows never closed to confirm completion).
- **`clinic_quality_metrics` — still completely broken, new failure signature.** 955 errors in this run, **all in the first 13 minutes** (06:03:46–06:16:29 UTC): 897 `circuit_open:('upsert', 'clinic_quality_metrics')` (note: `'upsert'`, not `'insert'` — confirms PR #7424's new code is the code actually running) + 58 `23505 duplicate key … "clinic_quality_metrics_medicare_snapshot_uidx"`. The very first row processed (`medicare_id=012501`, `snapshot_date=2023-12-31`, first error at 06:03:46 UTC) throws a real `23505` **through the new `.upsert()` call itself** — not the old capped-prefetch bug PR #7424 fixed, a different one. `clinic_quality_metrics.updated_at` has not moved at all since 09-22 14:24:22 — **zero writes landed in this entire run.** An upsert with a correct `on_conflict` target should not duplicate-key error on a fresh row; possible causes not yet investigated: wrong `on_conflict` column list at runtime, a race/retry issuing the same row twice, the direct-DB path being used instead of the native upsert fallback (and hitting a stale index), or something else in `_direct_upsert_record`/the native fallback. This needs its own round — filed as `RATINGS-CQM-CIRCUIT-BREAKER-3` prompt, see below.

**New structural finding, not previously named: Railway "completed" ≠ Supabase `finish_run()` called.** Scott reported this run showing "completed" on Railway. Independently checked: the `ingestion_tracker` rows for it (`run_status='started'`, `finished_at=null`) had **still not closed**, and a third run had already started (15:40:06 UTC) before the second run's rows were ever closed. This is consistent with the Railway container/process exiting without the application code ever reaching its `finish_run()` call — the same defect class already flagged earlier in this saga (dropped-connection acks, the PRI5 comment in `start_run()`) but not previously named as its own gap. Flagged as a candidate follow-up item, not yet its own prompt — folded into the round-3 prompt as a secondary ask rather than a separate round, since it doesn't block reading the CQM evidence.

**Docs:** `PLANNED-BACKLOG.md`'s `RATINGS-CQM-CIRCUIT-BREAKER` row updated with this split verdict. New prompt drafted: `docs/claude-code/prompts/RATINGS-CQM-CIRCUIT-BREAKER-3-cqm-upsert-still-23505s.md`. No response file this round — this is Cowork's own investigation, not a reconciliation of a CC response.
## 2026-09-23 — INTAKE-RESTAGE1 (CC): a stored file can be re-staged; one card per file; `?action=requeue`

- **Cause, measured live:** the only unique index on `inbox_items` is the partial `(workspace_id, external_id) WHERE external_id IS NOT NULL`. PostgREST's `on_conflict` cannot name a partial index (42P10), so the `merge-duplicates` insert arbitrated on the PK and every re-stage raised 23505.
- **Fix (`api/_shared/intake-om-pipeline.js`):** `resolveOmInboxCard` = lookup → insert → on 23505 re-lookup and attach (a 23503 stays an error). `planOmRestage` → `restage` (atomic conditional claim back to `queued`, artifact reused by sha256, `forceReextract`) / `in_flight` (return the same card, write nothing) / `resume`. A reused card is never rolled back or re-statused.
- **Re-run path:** `intake-salesforce-files?action=requeue` (webhook-secret gated, `stage_now` optional), documented in `om_intake_pipeline.md`.
- **Tests:** `test/intake-restage1.test.mjs` 12/12, 12/12 mutations RED (one survived at first: the FK test could not tell a 23503 from a 23505 until its second lookup returned a row). Suite 6,923 / 0 fail.
- **Next:** redeploy Railway + deploy `intake-salesforce-files` to Dialysis_DB, then Cowork requeues one extracted file (backlog row has the check).

## 2026-09-23 — GOV-UX1-D4/D5 (CC): re-measured before building; both premises failed, nothing built

- **D4 closed, no population.** The 35 open opportunities without a cadence are `type IS NULL` Salesforce-synced listing/escrow deals, not prospects. All 4 open `type=prospect` opps already have a cadence (trigger `bd_opportunity_auto_seed_cadence`). Follow-up `GOV-UX1-D4-sftype`: the SF sync leaves `type` NULL, so a listed property's panel may offer "Create the lead".
- **D5 held.** Gate = 54 owners / 100 rows (not 98). 28 of 54 qualify only via a `works_at` edge (P161's weak association); named rows include an address, a bank, a pharmacy, REIT SPEs and 6 repeat buyers. Scott to choose (a) tighten then automate, or (b) review lane → `GOV-UX1-D5-gate`, logged as checklist **Q48** for review.
- No code, migration, cadence or lead written. Measurements: audit `GOV_UX1_NAVIGATION_OWNER_VERIFICATION_2026-09-22.md` §D "D4 / D5 re-measured". No deploy needed.

## 2026-09-23 — SIDEBAR4-d (CC): the post-Save panel now says it is saved and up to date (extension 1.0.57)

**Why:** after Save the panel re-rendered into the matched state with the same "Update LCC with CoStar Data" + "Re-run Pipeline" buttons a months-old record shows, so Scott clicked both — two extra pipeline runs per Save (the real cause behind SIDEBAR4-c's PATCH → process pairs).

**Shipped (extension-only; no server or DB change, so no Railway redeploy is needed):**
- `extension/shared/capture-state.js` (new, loaded before `sidepanel.js`). Save and Update stamp `metadata._capture_field_hashes` + `_capture_saved_at` (per-field FNV-1a over what they send; volatile `extracted_at`/`source_url` and `_` keys excluded). The matched render compares the live page to it: unchanged → **"Up to date in LCC ✓"** (disabled); changed → **"Update LCC (N fields changed)"**; no fingerprint (saved before 1.0.57) → the old label, enabled, with a tooltip saying why.
- A status block above the buttons: saved-at, pipeline ✓/failed with time and error, nothing-new / N-differ.
- Re-run is primary only when the last run failed or none ever ran; otherwise it is behind **⋯**.
- A 10-minute in-memory memo keeps "Saved ✓ / Pipeline ✓" through the 1.5 s re-render and `pageContext` re-renders. Update now re-renders into the same state.
- SIDEBAR4-c's guard and the server coalescer are unchanged.

**Verified:** `test/sidebar4d-capture-state.test.mjs` 19/19 (real `sidepanel.js` functions extracted by AST, fake clock; 4 mutations red). Full `npm test` 6,924 pass / 0 fail.

**Next:** merge → Scott reloads the extension (1.0.57) and Saves one property (Q47) → Cowork reads that entity's `_pipeline_run_log`: exactly one run, `client: lcc-extension/1.0.57`, and no later `entities.patch` while the page is unchanged. Records saved before 1.0.57 get a fingerprint on their next Update.

## 2026-09-23 — Round 66 (Cowork): SIDEBAR4-c + HOME-MB-BOOT reconciled live; Scott's real Save behaviour → `SIDEBAR4-d`; Findlay OM re-run from storage (→ `INTAKE-RESTAGE1`); Q46 approved, D1–D5 prompted

**Deploy:** `verify:deploy` shows `tranquil-delight` on **`15de8524`** (= `main`, with #2635 HOME-MB-BOOT and #2636 SIDEBAR4-c). Both new test files pass on `main` (21/21), and the manifest reads 1.0.56.

**SIDEBAR4-c ✅ shipped.**
- Scott described what he actually does: after **Save**, the panel re-renders with "Update LCC with CoStar Data" + "Re-run Pipeline" and looks unsaved, so he clicks both.
- In code: Save success → `pollPipelineStatus` → `setTimeout(loadPropertyTab(...), 1500)` lands in the plain matched render, with no saved/pipeline-✓/unchanged indicator. Update already runs the pipeline, so the Re-run is redundant.
- The 1.0.56 guard stops overlap. It can't stop a deliberate second click the UI invites, so the root fix is filed and prompted as **`SIDEBAR4-d`**.
- Live proof of 1.0.56 is still owed. The latest run logs (11:34, 11:38, 13:53 UTC) have no `client` field, so they predate the reload → **Q47**.

**HOME-MB-BOOT ✅ shipped.** `bootApp` renders the widget when Home is active. Scott's hard-refresh check is owed → **Q47**.

**Findlay OM (Q45) — re-run by Cowork, no Salesforce action needed.**
- The file *was* kept: dia `sf_files` 1747 is `stored` in the `salesforce-files` bucket with its sha256. The re-trigger is `extraction_status='queued'`, which cron `sf-files-stage-queued-15m` drains.
- Requeue #1 failed with `inbox_item_insert_failed`: the old card holds `om_sha256:<sha>` under a partial unique index, and the insert's `merge-duplicates` has no `on_conflict`. Filed and prompted as **`INTAKE-RESTAGE1`**.
- Workaround: the old card's `external_id` got a `:superseded-20260923-gov-avail1` suffix, noted in its metadata. Requeue #2 then produced intake `3605ee76…`, `review_required`, `match_status=no_data`.
- The model returned no address this time, and nothing was promoted, so no gov contamination.
- Placement needs the street address from Scott. Dialysis_DB has Findlay pairs 51194/28037 (1717 Medical Blvd) and 22621/39404 (Patriot Dr) that look like twins and aren't in a lane yet.

**Q46 answered: build all five, in the recommended order.**
- `GOV-UX1-D1-D3-agency-drift-detector-and-gsa-occupant-writer.md` runs in the government-lease repo: detector first, then the GSA → occupant writer + blank-fill (ledgered, reversible).
- `GOV-UX1-D4-D5-auto-cadence-and-gated-auto-lead.md` runs in LCC, in parallel: auto-cadence through `cadenceSeedDecision`, then a gated auto-lead through `bridgeCreateLead` only.

**Docs:**
- Backlog: SIDEBAR4-c, HOME-MB-BOOT, GOV-UX1-D1…D5 and GOV-AVAIL1 updated, and `SIDEBAR4-d` + `INTAKE-RESTAGE1` added.
- Checklist: Q46 archived, Q45 rewritten (address only), Q47 added.
- 2 prompts and 2 responses moved to `done/`.


## 2026-09-23 — SIDEBAR4-c (CC): the side panel's second click is guarded; every LCC request is stamped with a build tag (extension 1.0.56)

**Hypothesis confirmed from the code, and the timing narrows the gesture.** In `loadPropertyTab` the Update button and the Re-run button sit inline, left to right, in `#propertyActions`. The Update handler's first line changes its label from "Update LCC with CoStar Data" to "Updating..." (27 → 11 characters). The button shrinks, and Re-run slides left under the cursor. Every toast was also `prepend`ed above the buttons, which pushed the row down mid-action. The run log's ordering (PATCH first, process 0.5–1.0 s later) points to a deliberate "did it take?" click rather than a sub-200 ms double-click. The Re-run handler awaits less before it fetches than Update does, so a true double-click would usually have reached the server first. Both gestures are closed by the same fix.

**Shipped:**
- New `extension/shared/action-guard.js` (classic script, loaded before `sidepanel.js` and imported by `background.js`). One action group per render of `#propertyActions`.
  - Update, Save, Re-run, Verify and Mark-off-market are all wrapped by `actionGroup.wrap`. While one is in flight, every sibling button is disabled, and a click that still arrives is swallowed. Siblings go back to their prior state afterwards, so a Re-run that was disabled for "nothing extracted" stays disabled.
  - Every button's width is frozen (`min-width`) before the clicked label changes.
  - Toasts and pipeline-poll lines now go into a `.property-action-status` slot *below* the buttons.
  - Update and Save now `await` their pipeline poll, so the group stays locked until the run they started has reported.
- `lccRequestHeaders()` is the single owner of the LCC request headers. `apiCall`, the pipeline-status poll and the background `callLCCApi` proxy all use it. Each request carries `X-LCC-Request-Id` (a UUID, with a `getRandomValues` v4 fallback) and a new `X-LCC-Client: lcc-extension/<manifest version>`. Server side, the CORS allowlists (`server.js`, `auth.js`) accept the new header, and `entities-handler.js` passes it through, so each `metadata._pipeline_run_log` entry now records `client`.
- The server's SIDEBAR4 single-flight (`serializeSidebarRun`) and the unique index are untouched.
- Manifest version 1.0.55 → **1.0.56**.

**The non-UUID `2727 Washington Ave` save (`entities.post`, request `TqW_wvnlQ7eZ-8sCCYBc-A`): not found in this repo, and not explained.**
- The entity carries `metadata.source='crexi'`, which only the side panel's Save sets (via `buildMetadata`), and Save goes through `apiCall`.
- A census of every `fetch(` in `extension/` found no other writer to `/api/entities`. The only other call is the read-only pipeline poll (GET `?id=&fields=metadata`), and it never triggers a run. `rca.js`'s comment refers to the side panel path. The background `LCC_API_CALL` proxy has no sender in the extension.
- The most likely source is a client not on 1.0.55 (another Chrome profile or machine, or a side panel opened before the reload). That cannot be proven from the DB.
- From 1.0.56 on it becomes provable. A run with a UUID and `client: lcc-extension/1.0.56` came from the current build. A run with a Railway edge id and no `client` came from an older build or something else.

**Guard:** `test/sidebar4c-action-guard.test.mjs` (16 tests), all positive-controlled:
- A layout model reproduces the misclick without the guard.
- With the guard, the second click never reaches Re-run, and a later deliberate Re-run still fires.
- An AST check confirms all five buttons are wrapped.
- An AST census of extension `fetch` calls that can reach `/api/entities` (by the path literal or a generic `endpoint` proxy) requires `lccRequestHeaders`.

Mutating each of these on disk turns the file red: remove the in-flight check, unwrap Re-run, revert `callLCCApi`'s headers, revert the poll's headers, or remove the width freeze. Full suite: 6,906 tests, 6,900 pass, 0 fail.

**Next (👤):**
1. Merge, then redeploy both Railway services.
2. Reload the unpacked extension. `chrome://extensions` should show 1.0.56.
3. Do one Update on a matched property.
4. Read `metadata._pipeline_run_log` on that entity. Expect exactly one new entry: `trigger: entities.patch`, a UUID `request_id`, `client: lcc-extension/1.0.56`, and no `action.process_sidebar_extraction` entry 0.5–1.0 s later.

---

## 2026-09-23 — Round 65 (Cowork): GOV-AVAIL1, GOV-UX1 and RECON2-render-spa reconciled live; Q43/Q44 closed; `SIDEBAR4-c` narrowed to the side panel; `HOME-MB-BOOT` found

**Deploy state (verified):**
- `npm run verify:deploy` shows `tranquil-delight` live on **`06faa4f3`** (= `main`, which includes #2631, #2632 and #2633).
- Scott reports the standalone MCP service is on #2630 code. No `mcp/` file changed between #2630 and `06faa4f3`, so the MCP is current.
- government-lease #408 is merged (local clone at `ee72fcc`).

**Closed operator items:**
- **Q44:** the MCP half is above. Scott's cold hard refresh of Home painted Today and every lane (screenshots), so `PERF-SPQ2` and `RECON2-render` are closed.
- **Q43:** Scott reloaded the extension to 1.0.55 and sent captures. 9 persons have been created since the SIDEBAR4 index cutoff, with 0 twin groups.

**SIDEBAR4-c, narrowed.**
- Post-reload run logs show both requests of each pair carry the extension's own UUID request id. Example, Lewistown MT: PATCH `8a6e001c…`, then `process_sidebar_extraction` `79acf84d…` 0.7 s later, coalesced.
- So the second run comes from the side panel's only call site, the Re-run click handler. A deliberate Re-run (Yucca Valley, 10 min later, not coalesced) looks different.
- Leading hypothesis: the Update button's label shrinks to "Updating…", the Re-run button slides under the cursor, and a double-click's second click lands on it.
- One capture (St. Louis `entities.post`) carried a non-UUID id, so there is a second writer outside `apiCall`.
- Prompted: `SIDEBAR4-c-rerun-button-layout-shift-second-click.md`.

**HOME-MB-BOOT (new, from Scott's screenshots).**
- The Market Briefs widget is filled only from `handlePageLoad('pageHome')`.
- On a cold load, Home is already active, so the router never calls `handlePageLoad`, and `bootApp()` doesn't render the widget. It spins forever.
- This is pre-existing since MB-b (`71fccd05`), not a GOV-UX1 regression.
- Prompted: `HOME-MB-BOOT-market-briefs-widget-cold-load.md`.

**GOV-AVAIL1 ✅ (LCC #2633 + gov #408), verified live:**
- Both office listings (`c04dc749…` Tulsa, `6cdda883…` Post Oak) are `off_market` and absent from `v_available_listings` (495 rows today).
- The quarantine log exists, and the view carries `address_display` / `address_locality_conflict` / `agency_code` / `agency_canonical_full` / `agency_resolution`.
- LCC entity `658c4713…` is renamed to `5110 South Yale Ave` (logged), and the `lcc_brokerage_office_address` registry is present.
- 19-test guard file passes. My mutation (`civicNumbersAgree` → always true) turned 2 red.
- Five follow-up rows were filed by CC (postoak, agency-tail, twins, govtype, civic-drift). The Findlay OM needs a Salesforce re-send → **Q45**.

**GOV-UX1 ✅ A–C (#2632):**
- 22-test file passes, and `listing-verification.js` is served (verify:deploy script check).
- §D was only described inside the GOV-UX1 row, so it is split into rows `GOV-UX1-D1`…`D5` for prompting. The decision is Scott's → **Q46**.
- Cross-check: `v_gap_agency_drift` today = 1,239 disagreement + 45 null-agency rows. CC's 1,481 came from a broader query, so D1 must state its denominator.

**RECON2-render-spa + -dossier ✅ (#2631).** 12-test file passes, and the active-lease selectors are pinned unchanged. `RECON2-render-views` (two views lack the column) is open.

**Noted, not a defect:** CC's GOV-AVAIL1 session kept an hourly "watch PR #2633" check-in running after the merge. Scott can end that session.

**Docs:**
- Backlog states updated for 8 rows, plus new rows `GOV-UX1-D1`…`D5` and `HOME-MB-BOOT`.
- TRIAGE SBN-21…25 outcomes filled.
- Checklist: Q43–Q44 archived verbatim, Q45–Q46 added.
- 3 prompts and 3 responses moved to `done/`.
- The SBN Open-threads row is rewritten to current state.


> **Older entries archived 2026-09-24 (round 77):** the span from "2026-09-22 — GOV-AVAIL1 (Claude Code)" through "2026-09-17 — Round 30 (Cowork)" (1353 lines, 2026-09-17 → 2026-09-22) moved verbatim to
> [`docs/history/STATUS_claude-code_2026-09-17_to_09-22_tail17.md`](../history/STATUS_claude-code_2026-09-17_to_09-22_tail17.md).


> **Older entries archived 2026-09-23 (round 68):** the span from "2026-09-17 — Round 29 (Cowork): **the app Scott uses every day is a stale Vercel build …" through "2026-09-16 — Harris owners applied (19) via HCAD bulk PDATA; backlog regrouped by categ…" (20 entries, all dated 2026-09-16/17) moved verbatim to
> [`docs/history/STATUS_claude-code_2026-09-16_to_09-17_tail16.md`](../history/STATUS_claude-code_2026-09-16_to_09-17_tail16.md).



> **Older entries archived 2026-09-22 (round 54):** the span from "FLOWS1-artifact live" through
> "C1C-SPLIT: `lcc_c1c_retire_sf_lanes` gains lane scoping" (all dated 2026-09-16) moved verbatim to
> [`docs/history/STATUS_claude-code_2026-09-16_flows1artifact_to_c1csplit_tail15.md`](../history/STATUS_claude-code_2026-09-16_flows1artifact_to_c1csplit_tail15.md)
> per `test/status-line-budget.test.mjs`'s archive procedure. Every backlog ID in that span is tracked
> in `docs/os/PLANNED-BACKLOG.md`.
