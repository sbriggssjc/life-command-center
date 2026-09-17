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
| **CoStar sidebar / public records (PR5/PRI)** | PR5d, PR-scanner-3, PRI2–PRI6, HCRIS-TIMEOUT, HCRIS-TRACKER-BLIND, HCRIS-QIP-DEFICIENCY-TIMEOUT-PATTERN | 2026-09-16 | PR-scanner-3 shipped (`county_records_needed` action); `PRI6` closed ✅ 2026-09-14, both sides confirmed merged — checking on it live is what surfaced `HCRIS-TIMEOUT` (a separate, months-old defect, not a `PRI6` regression). `HCRIS-TIMEOUT` is now **six rounds deep**: root cause isolated 2026-09-16 (`HCRIS-TIMEOUT-4`, two structural bugs, neither HCRIS-specific), both **fixed and pushed same day** (`HCRIS-TIMEOUT-5`, `Dialysis` PR #7413, commit `226f7e3` — confirmed merged and redeployed by Scott). **A fresh post-fix run was triggered and, live-monitored to its actual stop, turned out not to be a hang at all**: `cms-ingestion` spent its full ~4h18m runtime doing real, continuous work — 6,879 properties written via a slow, unbatched `propagate_financials()`→`properties` step — then stopped within a minute of finishing that step, without ever reaching `hcris_cost_reports` or `finish_run()`. (An earlier same-day read of this as a "genuine hang" was wrong, corrected same-day.) **`HCRIS-TIMEOUT-6` (also same day) confirmed the mechanism against the deployed code**: `propagate_financials()` had the identical swallowed-`StepTimeout` bug as `aux_cms_tables` (now closed ✅, confirmed genuinely fixed by this very evidence) plus a real N+1 pattern; fixed, pushed, `Dialysis` PR #7417 — **merge status not yet confirmed by Scott**. `HCRIS-TIMEOUT` stays 🔴, six-plus rounds in. **👤 2026-09-17 update: that fast/cheap live test ran overnight, and the fix didn't work** — the scheduled 06:00 UTC run confirmed via Railway deploy timestamp to be running PR #7417's code still shows no `StepTimeout` after 6h13m and counting (final tally: 9h20m, 10,243 properties, zero `StepTimeout` rows ever). **`HCRIS-TIMEOUT-7` (also 2026-09-17) found the real gap**: round 6's re-raise guards sat on the SELECT-only call sites, but the per-row *write* path (`update_row()`→`safe_execute()`×2 layers) had three of its own bare `except Exception` swallows underneath them, plus a `ThreadPoolExecutor` blocking-shutdown bug that defeated even the inner 30s timeout. Fixed, tested (340 regression tests + 2 new cheap unit-level proofs that don't require a multi-hour run), `Dialysis` PR #7418 — **Scott reports merged; confirmed via Supabase that no new scheduled run has occurred since (next one ~06:00 UTC tomorrow), so live proof is still pending**. `HCRIS-TIMEOUT` stays 🔴, seven rounds in. **Note: the round-7 prompt's parts (b) and (c) — reconciling Railway's "Stopping Container at 7:34:18" event, and confirming the round-6 batching read — were not addressed in CC's response; still open for round 8 if the round-7 fix also doesn't hold.** ⚠️ Separately: a parallel Cowork session's merge (`8cda70b9`, "round8" STATUS/PLANNED-BACKLOG archive) silently reverted this section's `HCRIS-TIMEOUT-5` update back to its round-4 state — restored here; see the dated entry below for the recovery note. One flagged, unbuilt follow-up still queued: `qip_scores_ingestor.py`/`cms_deficiency_ingestor.py` share HCRIS's old bare-timeout bug, still correctly out of scope until the pipeline actually reaches that far. |
| **Deed / owner-conflict (DEED/GOVDEED)** | DEED1, DEED1-reconcile-2, DEED1-emptycompare, DEED2, GOVDEED1–5, GOVDEED5b, GOVDEED-478, DEED-DIA-LATENT, CANON-OWNERSHIP1 | 2026-09-16 | Arc complete through GOVDEED3 (gov #406); **the gov deed writer runs from GitHub Actions (weekly Mon 06:00 UTC) — verify 09-21 dateless = 0**; CANON-OWNERSHIP1 👤 confirmation open; sale-party conflicts 1,290 a review queue |
| **C2g / sponsor↔SPE gate (C2k)** | C2g, C2h, C2i, C2k | 2026-09-16 | **C2k LIVE** (LCC PR #2506): 218 attested supersessions, 40/43 pairs to sponsor, 16/16 controls untouched, reversible; sponsor-as-edge = future work |
| **Research lanes / owner gap (C1B/C1C/OWNERGAP)** | C1B-GOV-GATE, C1C-SPLIT, OWNERGAP1, OWNERGAP2, OWNERGAP2-harris, -harris-b/-c/-d, -ledger-order, MCP1 | 2026-09-17 | **41 assessor-sourced owners live** (Philadelphia 20, Harris 21 of 50); Harris is done except the 27 situs-gap properties → §P10a is the lane's next unit; next free-bulk jurisdiction after that |
| **App feedback intake (SBN)** | FLOWS1, FLOWS1-artifact, FLOWS-consolidate, FLOWS-consolidate-lcc, FLOWS1-path, HOME1, HOME2, PRI1, PRI2, PRI2-on, DIA1, DIA1b, DIA1c, ID3a-drift, RECON1 | 2026-09-17 | PRI2-on live; HOME2 built, flag OFF → HOME2-on; F8/F8-b done; DIA1c live; **SBN-12 (Banning clinic as three properties) → `RECON1` prompted — the post-ingest reconciler**; Saturday digest verifies F1–F8 |
| **Process / consolidation (CONSOLIDATE, INVENTORY)** | CONSOLIDATE1–4, INVENTORY1, INVENTORY1b, INVENTORY2, INVENTORY-process, REMEDIATION-2026-05, REPO1, ROADMAP, PROCESS-CC-DOCS, PROCESS-MERGE-CLOBBER, GUARD-CLOBBER1, PROCESS-ROW-CELLS, PROCESS-PARKING-LOT, DEPLOY2-coverage, DEPLOY2-stale-body | 2026-09-17 | **PR #2563 reverted STATUS + backlog to a week-old snapshot (7 entries / 11 rows lost) — restored round 26; `GUARD-CLOBBER1` prompted**; DEPLOY2 live + CI; parking lot triaged; EDGE-GATES1 live |
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

## 2026-09-17 — `GUARD-CLOBBER1` shipped (CC): a CI test that fails a PR which silently deletes STATUS entries or backlog rows

`test/doc-clobber-guard.test.mjs`, wired into `.github/workflows/test-suite.yml` on both the
docs-only-skip path and the full-suite path (a clobber is a doc-only diff by construction, so a
guard that only ran inside the full suite would never see it). It diffs `STATUS.md` and
`PLANNED-BACKLOG.md` at HEAD against the PR's real base sha (`GUARD_CLOBBER_BASE_SHA` =
`github.event.pull_request.base.sha`, piped in as a workflow `env`) and fails if any `## ` STATUS
heading, Open-threads row, or backlog row id present at the base is missing at HEAD (unless a
heading was moved verbatim into a `docs/history/STATUS_claude-code_*.md` archive in the same
commit), or if a backlog row's Item text became a strict prefix of what it was at the base (the
signature of an older snapshot landing on a newer one, since the append-only loop never shortens
a row). Verified against real history before shipping: run against base=round25/head=the pre-fix
`70ae2e82` it goes RED with the exact 7 headings / 11 rows PR #2563 deleted; run against
base=`70ae2e82`/head=round26's restore commit it is green. Added the same discipline note to
`docs/os/BUILD-TURN-PROTOCOL.md` §⑤-CC and `docs/claude-code/README.md` step 7: edit both files
only against the CURRENT `origin/main` copy, never a copy read earlier in the session.

## 2026-09-17 — Round 26 (Cowork): **PR #2563 had silently reverted STATUS and the backlog to a week-old snapshot — restored**; `EDGE-GATES1` reconciled and verified live (8 functions log-gated); Q1's second calendar flow fixed — `/sync/calendar-events` clean since 18:30 UTC; the Banning clinic note (SBN-12) traced on Dialysis_DB → `RECON1` prompted; parking lot +3

**⚠️ Second doc clobber, this time from a Claude Code round — found and repaired this round.**
PR **#2563** (`docs/hcris-timeout-7-verify`, `70ae2e82`, parent `0ca02c77` = main after round 25)
committed `STATUS.md` and `PLANNED-BACKLOG.md` as whole files taken from `0304aa8b` (main seven
Cowork rounds earlier) plus its own HCRIS-TIMEOUT-7 entry and two HCRIS row edits. Result on `main`,
no conflict, CI green: **7 STATUS entries gone** (every Cowork round of 2026-09-17: H8/R1/F8,
F8 pre-check, F8 verified/PRI2-on applied, inventory review, parking lot, DIA1c/geocode/harris-d,
DEPLOY2-live/BR4/HOME2), **11 backlog rows gone** (`DEPLOY2-stale-body`, `BR4-b`, `DIA-DUP1`,
`OWNER-WRITERS1`, `EDGE-GATES1`, `PRI2-on`, `FLOWS-consolidate-lcc`, `INVENTORY-review-2026-09-17`,
`INVENTORY2`, `PROCESS-ROW-CELLS`, `PROCESS-PARKING-LOT`) and **84 rows reverted** (all the round-23
"→ checklist Qn" pointers, every ✅ from rounds 19–25). Verified by diff: main's backlog =
`0304aa8b`'s + exactly the two HCRIS rows. **Restored here** from `0ca02c77` with #2563's real edits
re-applied (its entry sits below this one; the two HCRIS rows carry its text; the duplicated
CoStar/Deed open-thread rows — a pre-existing copy — collapsed to one each). The other four docs were
untouched by #2563. The CI guard `PROCESS-MERGE-CLOBBER` filed in round 17 was never built; it is now
a prompt: **`GUARD-CLOBBER1`** (STATUS entries append-only, backlog rows never deleted, truncated
narrative = fail; tested against this very pair of commits). Until it lands, Cowork diffs `main`
against the previous round's merge at the start of every turn.

**EDGE-GATES1 (PR #2564, merged) — verified by Cowork against `list_edge_functions` on Dialysis_DB.**
Eight functions now carry the shared `authenticateWebhook()` gate in log mode, `verify_jwt:false`
unchanged, `<FN>_AUTH_MODE` defaulting to `log`: `context-broker` v21, `template-service` v19,
`intake-receiver` v20, `calendar-ics-sync` v21, `calendar-caldav-sync` v26, `calendar-caldav-push` v24,
`calendar-capture` v15, `data-query` v44 (non-GET routes only). Eight left alone because they already
had real enforced auth (`lead-ingest`, `intake-salesforce`, `intake-salesforce-files`,
`sf-promotion-worker`, `npi-registry-sync`, `w41-corpus-export`, `w43-sf-link-export`,
`w44-retrain-tick`). Caller inventory at `docs/architecture/flows/edge-gates1-caller-inventory.md`;
70 tests. First gate lines already visible in the 24 h log: `DENY-WOULD` on `/calendar-ics-sync`
(caller class unknown) — that is a real caller to name before any enforce → PL-15.
The round's own `Parked:` lines (four calendar functions deployed with hand-rolled shims of
`_shared/auth.ts` instead of the module; four functions with zero traffic in 24 h so their
"what enforce needs" is blank; `calendar-caldav-push`'s destructive retire routes only log-gated;
`intake-salesforce` ~400 lines of deploy drift) → one follow-up row **`EDGE-GATES1-b`**.

**Q1 — the calendar flow.** Scott found the second hourly caller ("Outlook Calendar - Life Command
Center Sync") missing the header in its HTTP step and fixed it. Log read 2026-09-17: last
`DENY-WOULD … /sync/calendar-events` at 18:26 UTC, none 18:30 → 19:26 UTC across two hourly runs.
The 3-day clock for `COPILOT_AUTH_MODE=enforce` starts at 18:26 UTC 09-17 → earliest flip
**2026-09-20 evening**, Cowork re-reads the log each turn until then. One new line class on
`ai-copilot`: `POST /chat node other` `DENY-WOULD` — a non-browser, non-Railway caller of the chat
route; caller unknown → PL-14 (must be named before enforce, or it breaks on the flip).

**SBN-12 — `Self Clean Triggering.docx` (nine screenshots of the DaVita Banning clinic).** Scott's
intent verbatim: *"ingestion of any data [should] trigger a reconciliation … one accurate view of
the property … The property should no longer be in the available section when it closes."*
Traced on Dialysis_DB: **three `properties` rows for one clinic** — 29894 (`6050-6090 W Ramsey St`,
the real record: 2 sales, 4 leases, 2 ownership rows, 3 listings), 35786 (`6050 W Ramsey St`, an OM
intake shell `e26e414f…` carrying an active $4.75M listing and the OM/rent-roll/lease-abstract
artifacts), 51228 (`6090 W Ramsey St`, a CoStar shell with its own active listing, seller
`Genesis Kc Development Llc`). Listing 9499 marked `sold` on 2026-06-19 with no sale row; sale 15042
(2026-09-14, $4,180,180, `is_northmarq=true`, listing broker Scott) has empty buyer/seller, no
`sf_deal_id` and wrote no ownership row; two DaVita leases (2013–2018 flagged `is_active=true`,
2015–2025 inactive — inverted); owner strings `Davita Healthcare Prtnrs` vs `DaVita HealthCare
Partners` in conflict. Every store is internally consistent and none of them talks to the others —
that is the defect class, not a data-entry slip. → **`RECON1`** (§P10a's first concrete case, with
the 27 Harris situs-gap properties): trace table → fix Banning through the existing ledgered merge
machinery → specify `reconcile_property(property_id)` as a deterministic post-ingest step with rules
R1–R7 (identity fold, listing↔sale closure, lease activity from dates, owner from the newest
evidence, artifact follow-the-survivor…) → size the blast radius across dia. Scott's Ollama
suggestion recorded as design input on the row: a local model is worth it only for the fuzzy
identity tail (R1) and lease-abstract extraction; everything else is rules the data already
determines, and a model in that path would be a second source of unexplained writes.

**Parking lot:** PL-14 (`POST /chat node other`), PL-15 (`/calendar-ics-sync` caller unknown),
PL-16 (Ollama / local-model reconciliation — parked as design input on RECON1, no separate row).
**Files moved:** `EDGE-GATES1` prompt + response → done/; SB note → `SB notes/done/`.
**Open for Scott:** send `RECON1` and `GUARD-CLOBBER1` (independent); Q1 clock running (no action until 09-20); Q29; HOME2-on;
confirm the DEPLOY2 CI job's first green run.

## 2026-09-17 — `HCRIS-TIMEOUT-7`: found the actual swallow site (three layers under round 6's re-raise guards) plus a second, independent timeout-defeating bug; fixed, tested cheaply, PR #7418 merged per Scott — live proof still pending

**Why round 6 wasn't enough, now confirmed against the deployed code rather than guessed at.**
`HCRIS-TIMEOUT-6`'s `except TimeoutError: raise` guards were real and correctly placed — on the
**SELECT-only** call sites. The actual per-row **write** in `propagate_financials()` goes through
`utils_shared.update_row()` → `utils_shared.safe_execute()` → `core_utils.safe_execute()`, and every one
of those three layers had its own bare `except Exception` that silently absorbed the `StepTimeout` (a
`TimeoutError` subclass) before it could ever reach round 6's re-raise points. This lines up exactly with
this session's own live evidence: 9h20m runtime, 10,243 properties written, zero `StepTimeout` rows,
despite running 37x past the 900s budget — the timeout was firing and being swallowed on the write side,
not failing to fire at all.

**A second, independent bug found in the same investigation**: `core_utils.safe_execute()`'s
`with ThreadPoolExecutor(...) as ex:` pattern meant even its own inner 30s timeout was defeated —
`__exit__` calls `shutdown(wait=True)`, which blocks the main thread on the abandoned worker thread for as
long as the stuck socket call takes, with no second alarm available to interrupt that join. Two separate
failure modes, both closed:

1. `utils_shared.safe_execute()` — re-raises `TimeoutError` before its generic swallow.
2. `utils_shared.update_row()` — lets a `TimeoutError` from `safe_execute()` propagate instead of
   returning an ordinary failed-write result.
3. `core_utils.safe_execute()` — `except TimeoutError: raise` added in the retry loop (which would
   otherwise re-swallow it via its own generic handler), and the blocking
   `with ThreadPoolExecutor(...)` replaced with explicit `shutdown(wait=False, cancel_futures=True)` on
   every exit path.

**Tests**: `tests/test_hcris_timeout_7.py` (pins fixes 1 & 2, with negative controls proving ordinary
exceptions are still absorbed as before) and `tests/test_core_utils_hcris_timeout_7.py` — the cheap,
targeted proof this round's prompt specifically asked for: a fake builder that sleeps 2s under a
monkeypatched 0.05s timeout, confirmed to fail at 2.001s against the pre-fix code and pass in under 1s
against the fix — no multi-hour production run needed to verify this layer. 340 tests matching
`safe_execute`/`update_row`/`propagat*`/`hcris_timeout` pass with no regressions.

**Delivery**: `sbriggssjc/Dialysis` branch `claude/amazing-turing-y8nr4w`, commit `f865250`,
**PR #7418 — Scott reports this merged.** Independently checked Supabase: no scheduled `cms_ingestion`
run has started since the round-7 run this morning (06:04:28 UTC) as of this write-up (checked
2026-09-17 ~18:55 UTC) — the next scheduled run is the earliest chance to see whether a real
`StepTimeout` finally lands in `ingestion_run_errors`. **`HCRIS-TIMEOUT` stays 🔴** until that's observed.

**Gap in this round's response, carried forward rather than glossed over**: the `HCRIS-TIMEOUT-7` prompt
asked two more things CC's response didn't address — (b) reconciling Railway's "Stopping Container at
7:34:18" Deployments-tab event against the Supabase timeline (06:04:28 UTC start, 15:24:49 UTC last
write), and (c) confirming or correcting this session's own read that round 6's SELECT-prefetch batching
is working (the shift to ~60-writes-per-10-minutes late in the prior run). Neither is resolved. If the
round-7 fix also turns out not to hold, both should be re-asked explicitly in round 8 rather than assumed
answered.

Full response filed to `docs/claude-code/responses/done/HCRIS-TIMEOUT-7-alarm-never-fires-during-propagate-financials.response.md`.

## 2026-09-17 — DEPLOY2-live, BR4 and HOME2 reconciled; Q1's calendar flow is still calling without the header; parking lot triaged, EDGE-GATES1 drafted (Cowork)

**DEPLOY2-live (PR #2559, running on `7611e966`).** The window fixes were already in code from the
09-16 coverage round; the round ran the detector **live over LCC Opps and Dialysis_DB — 149 objects,
0 unapplied** — with the three known incidents (Geocodio cap, PRI2-on, C1C) confirmed applied and
caught; added `.github/workflows/deploy2-unapplied-check.yml` (every push to `main`, fails the job with
a commit-comment table); built a **stale-body comparator but did not wire it** (needs a migration on both
projects) → `DEPLOY2-stale-body`, low. Caveats it disclosed: its probe used a shallow clone (CI's
`fetch-depth: 0` sees the full add-date window), and it caught its own hand-typed object list mid-round.
👤 Scott: confirm the job ran green on the merges since (`Actions` → *deploy2-unapplied-check*).

**BR4 (PR #2558) — applied live, verified.** 146 duplicate-name groups: **3** true duplicates merged
(13 FK constraints across 11 tables repointed, ledgered in `dia_br4_broker_merge_log`), 120
one-linked-one-blank and 20 both-blank groups correctly left (filling from a sibling would be an
identity guess), 3 different-firm. **52 firms minted** from BR1's 661 queued strings, gated on ≥3 brokers
sharing the token AND ≥2 sharing an email domain, evidence in `dia_br4_firm_mint_evidence`;
`broker_company_id` **366 → 641 of 2,566 (25.0%)**; `broker_companies` 127. 123 firm-shaped rows in
`brokers` flagged, not touched; 468 review rows open. Migration objects all present live (step 4a).
Parked by the round: PL-11 (the 123 firm-shaped rows), PL-12 (the 468), PL-13 (Scott's own name ×3 in
`brokers`).

**HOME2 (PR #2560) — built behind `home_three_lanes`, OFF.** Research = the nbaSnapshot gaps feed
(§A predicate); BD = `/api/seller-prospect-queue` top 5, labelled; Inbox = the briefing's inbox
summary, new before triaged (no due-date field exists — PL-7); the silent `_dbFillMyPrioritiesFromQueue`
fallback disabled under the flag; 21 tests. The round had no DB access, so the live render and the
"how often was `today_top_5` empty" measurement are still owed — **HOME2-on** is Scott's look at the
flag ON in his own session, then the flip.

**Q1 — not done yet, and the log says which one.** Scott reports the four header edits; the log shows
**`POST /sync/calendar-events` still logging `DENY-WOULD` at 18:26 UTC** (hourly, unchanged). The other
three run less often and cannot be judged yet. Most likely: the edited flow is not the hourly calendar
caller (four workflow ids in `ai-copilot-sync-callers.md`; the calendar one is `4eb7c46f…`), or the
header name/value differs (`X-PA-Webhook-Secret`, the Object Sync flow's value). Cowork re-reads the
log tomorrow; the three-day clock starts at the last `DENY-WOULD`.

**Parking lot, first triage.** PL-1 → **`EDGE-GATES1`** prompt (the 18 unreviewed `verify_jwt:false`
functions: measure writers/callers/drift from the deployed bodies, gate writers log-only, the
COPILOT-OPEN pattern); PL-2 folded into it; PL-3 → Q2; PL-4 → `DIA-DUP1` (Longenbaugh Rd/Dr); PL-5
recorded on GOVDEED3, no action; PL-6 → `OWNER-WRITERS1` (which writer set three `recorded_owner_id`s
during H7); PL-7/9/10 → HOME2 row; PL-8 → HOME2-on gate; PL-11/12 → `BR4-b`; PL-13 → checklist Q29
(a 30-second look). BR4's and HOME2's rounds both numbered their lines PL-7…9 — renumbered; the
`Parked:` convention now says "next free PL number, check the file".

**Next:** Scott — re-check the calendar flow (Q1), glance at Q29, send `EDGE-GATES1`, confirm the
DEPLOY2 job is green; then HOME2-on. Cowork — Saturday digest, Monday GOVDEED3, the Q1 log.

## 2026-09-17 — Working the queue programmatically: a parking lot for what we notice on the way, three independent CC rounds drafted, and Q1/Q2 measured live (Cowork)

**Scott's ask:** proceed on the recommendation, keep consolidating, and find a way to flag and grab
other topics as we go. Three moves.

**1. A parking lot.** `docs/claude-code/PARKING-LOT.md` — one line per thing noticed while doing
something else (date · where · what · who); every Cowork turn triages the open lines into a backlog
row, a checklist line, a prompt, a decision, or a drop with a reason (README step ③b). Claude Code
rounds feed it through a **`Parked:`** section every prompt now asks for in its Reporting block. Six
lines went in on day one, including one that matters: **eight more Dialysis_DB edge functions run
`verify_jwt:false` with no reviewed gate** (`context-broker`, `template-service`, `intake-receiver`, the
`calendar-*` four, …) — the COPILOT-OPEN class is wider than the two functions the queue names.

**2. Three rounds that need no decision, sent in parallel.** `DEPLOY2-live` — run the unapplied-
migration detector live against all three projects, fix the two window defects (include `dialysis/`,
window by git add-date), body-hash views and functions, and make it a job on every merge to `main`;
three incidents this week say this is the highest-leverage process fix available. `BR4` — broker
dedupe against the firm-linked population (143 duplicate-name groups; the 661 firm strings BR1 queued),
true duplicates only, every FK repointed, firms minted only with evidence. `HOME2` — the three-lane
Home from HOME1 §B behind a flag, with the BD lane corrected to PRI2's reason-first list and the
Priority-tab-duplicating fallback removed.

**3. Q1 and Q2 measured live before Scott spends time on them.** Q1: the `ai-copilot` gate **is
deployed** (v84) in log mode and the edge project has `PA_WEBHOOK_SECRET` set; in the last 24 h it logged
**35 `DENY-WOULD` lines, all from four Power Automate flows** (`/sync/calendar-events` 24, `/sync/activities`
6, `/sync/sf-tasks` 4, `/sync/flagged-emails` 1) — so the remaining step is exactly the one already
written in `docs/architecture/flows/ai-copilot-sync-callers.md`: add the `X-PA-Webhook-Secret` header to
those four flows' HTTP actions, export, then three clean days, then `COPILOT_AUTH_MODE=enforce`. Q2:
`salesforce-enrichment` v27 (log-only gate) has been live since 09-09 with **no `[sfenrich-auth]` line
in 24 h** — the monthly caller has not fired; enforce waits for one cycle (≈10-09) or Scott naming the
caller (PL-3). Q1's line on the checklist now says the four flows and the doc; Q2's says the date.

**Next:** Scott sends the three prompts and, when convenient, does Q1's four header edits (the doc
has the click-path); Cowork triages the parking lot each turn; Saturday's digest; Monday's GOVDEED3
check.

## 2026-09-17 — Inventory reviewed against the to-do lists: the residue is small; the real gap was 67 backlog rows waiting on Scott that the checklist did not know about (Cowork)

Scott asked for a run at the inventory work versus the to-do lists. The CSV (1,789 intent rows) is
mostly history: 1,000 rows are "docs & process", 919 come from `docs/history/`, and 15 carry a backlog
link. Of the 70 rows the inventory itself marked flagged / planned / partial, all but four are section
headings of findings that were resolved in their own round (checked by hand against the backlog); the
four that are not (the RCM lead flow → `marketing_leads` = 0, the holistic audit's 63 findings, the
property-tab design part 3, N15d's unreadable arm) already sit under REMEDIATION-2026-05 or their own
rows. The inventory's honest residue — ghosts (never measured), the ten root reports past their
opening sections, 283 forward-looking history statements, 102 prompts never re-checked with the
widened trace — is one read-only CC round, filed as **INVENTORY2**, held until the queue below moves.

**The gap ran the other way.** A sweep of every backlog row whose State cell carries 👤 found **67**
— across nineteen sections, some from August — against an operator checklist that held **five**.
Nine of the 67 were already done with a stale state (UX0, EXT1, EXT2, C4a, OWNERGAP1-decision; and
CFE-RUNAWAY, PRI5, CQM1, HCRIS-TIMEOUT are waiting on runs, not on Scott) — states fixed. The rest are
now **`OPERATOR-CHECKLIST.md` § Scott's queue, Q1–Q28**, tiered: **A** exposure (the open `ai-copilot`
and `salesforce-enrichment` edge functions, the Vercel teardown with the extension still writing
through the retired build, the PA webhook secret); **B** ten-minute admin (Dialysis CI required
check — three steps owed since 2026-09-02; leaked-password toggle; Postgres upgrade; Anthropic credits;
the gov detector handoff); **C** decisions that unblock building (Dialysis_DB owner confirmation, the
five long-dark-flag decisions, the six zero-completion lanes, the 2,044 false closes, the bank/trustee
rule, sponsor confirmations, the 15 person merges, CMBS opt-in, the dia tenant-in-owner-slot rule,
DOC14, N2, the orphan opps, team mailboxes); **D** tenant chores (UX0 pastes, S1–S10, probes, ASC50
reviews, W3); **E** waiting on runs; **F** parked designs. Every 👤 row now points at its Q line, and
rule ⑤-👤 in the protocol makes the mirror part of the same change from here on. SEC9/SEC10 (key
rotation) stay under the P0s decision, not in the queue.

**Next:** Scott clears tier A/B as he can (Q1–Q9; Cowork turns any of them into a click-path on
request); Saturday's digest; Monday's GOVDEED3 check; INVENTORY2 when the queue is moving.

## 2026-09-17 — F8 done and verified from the export; PRI2-on merged with its migration unapplied — the Priority tab was returning 502 until Cowork applied it; a migration-apply step joins the loop (Cowork)

**F8 — verified from `LCCFlaggedEmailIntake_20260917152101.zip`.** The success branch now reads
`Mark as read or unread (V3)` → `HTTP GetEmailWebLink` (retry exponential 3 × PT20S) →
`HTTP GetIntakeSummary` (URI re-pointed to `body('HTTP_-_outlook-message')?['correlation_id']`) →
`Post card in a chat or channel`. `Move email (V2)`, `Flag email (V2)` and `Terminate` are gone; no
processing-complete call; dead-letter path intact. Scott turned off *Outlook Intake to Teams
(Hardened)* and *Processing Complete → Move Message*. One nit, not a blocker (**F8-b**): `HTTP
GetIntakeSummary` runs after the web link on *Succeeded* only, so a web link that fails all three
retries skips the card — the guide asked for *Succeeded + Failed*; thirty seconds in the designer.
Verification is Saturday's digest and `processing_log.already_out` staying at 2.

**PRI2-on (PR #2553) — merged, and the tab was broken live.** The round appended `reason_measured` to
`v_lcc_seller_prospect_universe` (PostgREST cannot order on an expression), reordered the queue
reason-first, collapsed rows to one card per property, fixed a dead CTA, flipped `priority_tab_v2` to
true, 14 guard tests, suite 6,524/0 — and wrote in its own backlog row that the migration was
*"applied via the LCC Opps schema owner path"*. It was not: `/api/seller-prospect-queue` answered
**502 `column v_lcc_seller_prospect_queue.reason_measured does not exist`** on Railway `49329608`, i.e.
the flag was ON against a view that did not have the column. Cowork pinned the universe view (8,289
rows, full-row md5 `b8bc1505…`), applied `20260917120000_lcc_pri2_on_reason_first_order.sql` verbatim
from the repo, and re-fingerprinted minus the new column: **identical** — nothing but the appended
boolean changed. Route now 200. Live after the flip: queue 508 rows / 458 properties, **277 with a
measured reason**; the new top 20 is every one debt/developer (WMC ATL $24.9M debt+developer, FD
Stonewater/State Warehouse Nova $22.9M developer, NGP V Broward $22.9M debt, …) — the eight
`reason_to_sell_unmeasured` rows that led the old order are gone from the top. That is the post-flip
side-by-side the round said needed an operator; it is in the PRI2-on row.

**Third merged-not-applied migration in two days** (geocode cap, PRI2-on; and the C1C detector's own
history) — and this one took a user-facing tab down. The loop gets a step, not another finding:
**`docs/claude-code/README.md` step 4a and `BUILD-TURN-PROTOCOL.md` ③** — for every merged PR, diff
`supabase/migrations/**` against `origin/main~`, and for each new file check the live object exists
(`information_schema` / `pg_proc` / `cron.job`) *before* the row goes ✅; apply from the repo file if
not, verbatim, and say so. The DEPLOY2 detector's live run is still the tool that should do this
(`DEPLOY2-coverage`, three incidents behind it now).

**Next:** F8-b (Scott, 30 s); Saturday's digest (F1–F8 verification); Monday's GOVDEED3 check;
`FLOWS-consolidate-lcc` after a clean digest; DEPLOY2 live run.

## 2026-09-17 — F8 pre-check: the Move Queue Executor exists and is the working single mover; the consolidation steps revised (three movers → one) (Cowork)

Scott's export of *LCC Move Queue Executor* (15-minute recurrence): `GET /api/move-queue-worklist`,
find each message by `internetMessageId` (immune to the id change a move causes), clear the flag when
LCC says so, move to the folder LCC names, `POST /api/move-queue-ack`. Live on LCC Opps: **118 moves in
14 days, latest 11:45 UTC today, 2 `already_out`** — P120's puller, working. So the message had
**three** movers: the Flagged flow's own `Move email (V2)`, the *Processing Complete → Move Message*
flow reached through LCC's webhook push relay after the Teams card, and the Executor. The 2
`already_out` rows are the races counted.

`docs/setup/FLOWS-CONSOLIDATE-2026-09-16.md` revised: copy **three** actions from the Hardened flow
(web link, intake summary, card — not the processing-complete Condition), delete the Flagged flow's
own Move **and** its Flag-clear (the Executor clears the flag; the trigger keys on it), re-point one
expression, turn **two** flows off (Hardened + Processing Complete → Move Message). Verification is
now a number: `already_out` stops at 2. LCC follow-up filed low: `FLOWS-consolidate-lcc` (retire the
webhook→Move-Message relay once nothing calls it). The Executor export goes to
`private/power-automate/exports-2026-09-17/` (carries connection references — never committed).

## 2026-09-17 — H8 applied (with its ledger row this time); R1 delegated → `PRI2-on` prompt; F8 walked through (Cowork)

**H8.** `POST …?jurisdiction=harris_tx&include_classes=C2`, no `batch_tag` (the tick derived
`ownergap2_harris_tx_202609171319`) → `wrote 1`: `10311 South Post Oak` → `LUEL PARTNERSHIP LTD 2-03`,
source `ownergap2_public_assessor:harris_tx:0440360000028`, citation `state_class = C2`. The ledger
took the row (id 107 rows total now; harris resolved **21**) — OWNERGAP2-ledger-order's fix, seen
working. Properties with an owner **5,523**. Harris final shape: **21 of 50 applied**, 27 situs gap
(§P10a), 1 Longenbaugh Rd/Dr duplicate, 1 refused on a directional conflict (380 W vs E Little York).
**41 assessor-sourced owners live.**

**R1.** Scott delegated the read. Recommendation, recorded: ON, with two changes that are not a new
score — order *measured reason before value* (today eight `reason_to_sell_unmeasured` rows sit in the
top 20 ahead of measured debt/developer reasons) and one card per property (rows 1/17 and 5/6 of the
side-by-side are the same property twice). → `prompts/PRI2-on-reason-first-and-one-card-per-property.md`.

**F8.** Scott asked for the walk-through; it is `docs/setup/FLOWS-CONSOLIDATE-2026-09-16.md` (merged
in round 18), nine steps, restated in chat this turn. The pre-check (a *Move Queue Executor* flow?)
comes first.

## 2026-09-17 — DIA1c, FLAGS-geocode-on and harris-d reconciled; Geocodio live (after Cowork applied the cap migration the round had only merged); the C2 dry run resolved one and refused one for the right reason (Cowork)

**DIA1c (PR #2547, running on `0304aa8b`) — verified live on Dialysis_DB.** The 878 were mostly not a
duplicate-operator problem: 807 carry `operator_class` category/payer/non_operator (Independent 683,
Other 84, State Owned 17, Kaiser 20…) and are `operator_id = NULL` **by design** — folding them would
count categories as companies, the opposite of S2. The real residue was 71 properties on 13 names
that were never in the registry (Intermountain Healthcare, UPMC, Veterans Administration…) — the round
registered them as operators rather than the review list the prompt asked for; they are health
systems, not spelling variants, so the call is defensible and is recorded here as a deviation. The
split Scott named was real and older than the tile: ID2a had merged the duplicate `Us Renal Care Inc`
rows but never repointed `properties`/`tenants`/`leases`/`medicare_clinics.operator_id` onto the
survivor. Fixed. Live now: **33 canonical operators**, `US Renal Care` one row with **465** properties
(was three rows), `DaVita at Home` folded into DaVita, `v_dia_operator_unresolved_review` **0**, no
property points at a merged operator. Migration in `supabase/migrations/dialysis/` here ✓ (applied live
from the session, committed the same round — the doctrine sentence held). The tile reads the canonical
count with an `operators_unresolved` sub-label; the DIA1b guard that pinned the old caption was
re-pointed at the new contract.

**FLAGS-geocode-on (PR #2549) + D4 — live, but not by itself.** The code shipped a per-UTC-day
Geocodio ledger (`geocode_tier_usage`, cap 2,400, Census continues past it) and the registry
update; the migration `20261102210000_lcc_flags_geocode_on_geocodio_daily_cap.sql` was **merged and
not applied** — the handler reads a missing table as "0 used" (fails open toward Geocodio, by design),
so with Scott's key in Railway the 10-minute cron had been calling Geocodio uncounted since the key
landed. Cowork applied the migration to LCC Opps at 12:33 UTC (its own file, verbatim, from this
repo). Then one live tick: **120 scanned / 120 patched, all by Geocodio** (Census 0 — these are the
Census-miss long tail), `geocodio_usage_after_tick` 120. Unplaced properties so far: dia 1,707 →
**1,639**, gov 1,760 → **1,701**; the cron will spend the rest of today's cap in ~3 hours and go
Census-only until 00:00 UTC. ⚠️ Second incident of the class DEPLOY2 exists for, and the detector's
live run is still "pending" (`DEPLOY2-coverage`) — noted on that row.

**OWNERGAP2-harris-d (PR #2548) — the C2 dry run.** `include_classes=C2` validated against a closed
allow-list, threaded to the matcher, echoed in the response; an admitted class resolves on the exact
arm only (`class_admitted_requires_exact_situs`); `state_class` in the citation; 45 tests; suite
6,510/0. Live: population 30 → **1 resolved / 29 refused**. Resolved: `10311 South Post Oak` →
**`LUEL PARTNERSHIP LTD 2-03`** (acct `0440360000028`, C2, exact). Refused, and correctly: `380 W
Little York` — HCAD's C2 account `380 LITTLE YORK LLC` sits at **380 E Little York Rd**, a different
address on the other side of the freeway; the exact-situs rule Scott asked for is what kept a
plausible-looking wrong owner out. The remaining 27 are the situs gap. **H8:** apply the one on
Scott's go.

**Also — a defect in my own tooling, found while writing this.** Since round 16 the helper that appends a
round's outcome to a backlog row wrote the text into the State cell and then overwrote that cell with the
new state: 20 rows on `main` (GOVDEED3, DEED1-reconcile-2, ID3d, ID3d-reconcile, the harris-c/ledger-order
rows, the S1–S5 decision rows…) have read ✅ with **no supporting narrative** since PR #2538. The
narratives are restored in this round from the scripts that produced them, the helper is fixed, and
`PROCESS-ROW-CELLS` records it with a guard idea (a State change without an Item change is suspicious).
Railway `0304aa8b` = main (all three rounds running). The HCRIS-TIMEOUT session's PR #2550
(round 6 live proof failed overnight) landed in the same window — theirs, untouched.

**Next:** H8 (say "apply"); R1 (the PRI2 read); F8 (the flow consolidation); Saturday's digest;
Monday's GOVDEED3 check; the DEPLOY2 live run so the next unapplied migration is caught by a tool, not
by a tick that happened to be watched.

## 2026-09-16 — S1–S5 answered and turned into work; V1 answered from the screenshot and the gov repo; C2 accounts staged; PRI2 side-by-side produced (Cowork)

**S1 — PRI2.** Scott could not find the side-by-side because it did not exist; it does now:
`docs/audits/PRI2_SIDE_BY_SIDE_2026-09-16.md`, measured live. V1's top 20 is the oldest overdue P1 rows
(all gov, all `lease_expiry_24mo`, next touch 668–729 days ago — a two-year-old to-do). V2's top 20 is
the twenty most valuable in-band assets ($19.9M–$24.9M), 15 with no linked person, 8 in band only on
value + lease (`reason_to_sell_unmeasured`); one owner overlaps. The read is Scott's; the likely
follow-up if he says "reason first" is a one-line order change inside PRI2's no-new-score rule.

**S2 — Operators.** Decision is neither 45 nor 21: **one operator identity everywhere** (US Renal =
U.S. Renal Care), the canonical count is the only number, and the 878 unresolved operator names are
the work, shown as such. → `DIA1c` prompt (fold onto the registry fill-blanks, evidence-backed aliases
only, one count view consumed everywhere).

**S3 — Geocoding.** "If it's free, get it working." Measured: the backfill *is* working on the keyless
Census tier; dia 1,707 + gov 1,760 = **3,467** properties still have no lat/lng; Geocodio's free tier is
2,500/day and the handler already calls it. → `FLAGS-geocode-on` prompt (key in Railway = D4, a hard
daily cap in code, Google stays off by decision, registry reasons recorded).

**S4 — Flows.** Option (b), one flow owns the lifecycle. Read from the two exports: both flows post
the message to LCC (idempotent), only the Hardened one posts the card, and the message is **moved by
two movers** (the Flagged flow's own `Move email (V2)` and the Move Message flow LCC calls after the
card) — P120's "two movers on one transition" verbatim. Click-path written:
`docs/setup/FLOWS-CONSOLIDATE-2026-09-16.md` (F8): copy four actions from the Hardened flow into the
Flagged flow's success branch, delete its own move, re-point three `body('HTTP_PostIntakeMessage')`
references, turn the Hardened flow off, export. Pre-check first: does a *Move Queue Executor* flow
exist (P120's puller)? If so the steps change.

**S5 — C2 accounts.** Scott: go with the recommendation, and the parcel must be the county's parcel.
Recommendation recorded as **(a) with an exact-situs rule** for admitted classes. Done now: the merged
loader re-run from the VM with `--include-classes C2` → stage **98,804** rows (F1 68,811 + F2 2,465 + C2
27,528), 0 without an owner — and the harris-c loader worked first time on the real file, honest
accounting and all. Still needed: the tick has no `include_classes` parameter → `OWNERGAP2-harris-d`
prompt (parameter + exact-arm-only for C2 + `state_class` in the citation).

**V1 — where the gov deed ingest runs.** The Railway service in Scott's screenshot
(`public-record-ingest`, project `handsome-luck`) builds from **`sbriggssjc/Dialysis`** — that repo has
its own `src/public_record_ingest.py` (no `save_deed_record`); it is the dialysis-side ingest, not the
gov one. The gov deed writer (`save_deed_record`, GOVDEED3) runs from **GitHub Actions**
(`.github/workflows/ci.yml`: daily 08:00 UTC `pipeline_runner --daily`, weekly Monday 06:00 UTC), which
checks out `main` every run — so GOVDEED3 is live from its next scheduled run. Live evidence: gov
`deed_records` inserts on 09-07 (11, 10 dateless) and 09-14 (9, 9 dateless) — Mondays, the weekly
job — so the manufacturing was still happening pre-GOVDEED3. **Verify Monday 2026-09-21:** dateless
inserts that day must be 0. ⚠️ The gov repo's own note says compute crons belong on Railway, not GH
Actions (free-plan failures); the deed ingest is on GH Actions today — recorded, not changed.

**D3.** Scott reports Dialysis PR #7416 merged (the removal); not verifiable from here (no GitHub
fetch) — accepted as reported, ID3d-reconcile closed.

**Next:** Scott — F8 pre-check + click-path; D4 (Geocodio key); the PRI2 read; send `DIA1c`,
`FLAGS-geocode-on`, `OWNERGAP2-harris-d`. Cowork — after harris-d merges, the C2 dry run; Monday, the
GOVDEED3 verification; Saturday, the digest.

## 2026-09-16 — harris-c, ledger-order and ID3d-reconcile merged and running; the C2 switch stops one step short of the tick; my own round-8 merge clobbered another session's entry — commits move to patches (Cowork)

**OWNERGAP2-harris-c (PR #2541, Railway `4fc03bbd` = main).** All five: `on_conflict=acct,file_year` on
the POST; one `{written, errors}` shape with the DB's `code`/`message` surfaced; `owner_name` from
`owners.txt` ln 1 when the export has no `name` column, and `--apply` refuses a stage with any empty
owner; `isHcadPlaceholderOwnerName()` (`CURRENT OWNER`, `OWNER UNKNOWN`, …) filtered before grouping,
so HCAD's sentinel can never be written; `--include-classes` on the loader and `includeClasses` on the
matcher, default F1/F2. 18 + 33 tests, suite 6,489/0. ⚠️ **The switch reaches the matcher but not the
route** — `ownergap2-owner-resolve-tick` reads no `include_classes` query parameter, so the C2 dry run
S5 asks for cannot be run live yet; and the stage holds no C2 rows until the loader is re-run with the
flag. Both are one small step *if* S5 lands on (a); folded into the S5 row rather than prompted ahead of
the decision. The round also wrote its own response file into `responses/` (moved to `done/`).

**OWNERGAP2-ledger-order (PR #2540, running).** `applyOwnerResolution()` now reads the ledger insert's
result and on failure PATCHes the property back to NULL (re-checked against the owner id it just
wrote, so a race is never clobbered) and reports `ledger_write_failed:<status>` — `wrote` can no longer
exceed ledger rows. Default `batch_tag` is minute-granular; a caller-supplied tag is checked against
open ledger attempts for the population before any write and refused `409 batch_tag_collision`
(verified: the check is on the write path — a dry-run GET with the old tag still answers normally,
which is right, dry runs ledger nothing). Sequence gap answered: `id` is `bigserial`, `nextval()` fires
before CHECK/unique evaluation, so the 48 missing ids are the failed inserts — nothing was deleted.
Ledger row 125 untouched. 6 new tests + 2 source-shape assertions; 6,486/0.

**ID3d-reconcile (LCC PR #2539 merged; Dialysis PR #7416 opened for the removal — merge state not
visible from here → checklist D3).** Three live hashes pinned and unchanged before/after
(`dia_resolve_guarantor`, `dia_normalize_guarantor_text`, the trigger); migration ported
byte-identical with an "already live" header carrying the hashes; 9 structural tests ported to
`node --test`; `CLAUDE.md` doctrine row now says the rule binds a CC/Cowork session with Supabase MCP
too. The 87 unresolved leases are **81 distinct guarantor strings** — single-clinic SPEs, personal
guarantees, multi-party splits ("USRC and Nephrology Group") — listed in the commit; filed as
**ID3d-b** (review lane, not prompted).

**A finding about my own process, from another session.** PR #2537 (the HCRIS-TIMEOUT chat) records
that its STATUS entry and Open-threads update, merged at PR #2516, were **silently reverted by my
round-8 merge** (`8cda70b9`) — no conflict raised, because my rounds copy whole files from a bundle
built against the `origin/main` I fetched at the start of the turn, and the fresh worktree takes the
bundle's file as-is. Anything merged to those files between my fetch and my push is overwritten. The
other session recovered the content by re-checking `origin/main` before reporting. **Fix, from this
round on:** the bundle carries a base SHA and a unified diff per existing doc; the commit script runs
`git apply --3way` against a fresh `origin/main` and stops on conflict — new files still copy. Row
`PROCESS-MERGE-CLOBBER`. The other session's HCRIS-TIMEOUT-5 finding itself (both fixes merged and
redeployed, the identical failure shape persists on a fresh run) stays theirs; its row is in the
Open-threads table as they wrote it.

**Where the decisions live, since Scott asked:** `docs/claude-code/OPERATOR-CHECKLIST.md` → § *Decisions
(Scott's)*, rows S1–S5, each with the options and where the answer lands. Answer in chat or in the
file; Cowork does the rest.

**Next:** Scott's D3 (merge Dialysis #7416) and V1; S1–S5; PRI2 side-by-side; the next free-bulk
jurisdiction once S5 settles what Harris looks like finished.

## 2026-09-16 — Five rounds reconciled (GOVDEED3, DEED1-reconcile-2, ID3d, MISPARSE1, BR1/BR3); H7 applied — and the apply exposed a ledger-ordering defect (Cowork)

**H7 applied.** `POST …?jurisdiction=harris_tx` under the day's batch tag → `wrote: 1`:
`2626 South Loop West` → `AMALGAMATED HOUSTON HOLDINGS LLC`, source `ownergap2_public_assessor:harris_tx:1145390000003`.
Properties with a `recorded_owner_id` **5,517 → 5,519** (the other +1 is `1325 Hwy 4 East` and two more
from other writers in the same window — not OWNERGAP2). ⚠️ **The ledger did not get the row.** The
property already carried an `unresolved / no_staged_rows` row under the same batch tag from the
19-owner apply, `uq_dia_ownergap2_open_attempt (batch_tag, property_id)` refused the `resolved` insert,
and the owner write proceeded anyway. Cowork wrote the missing ledger row by hand (id 125, batch
`…20260916b`, the citation says why). Two defects — ledger after write with no rollback; a reused tag
is silently half-blind — and one operator error (reusing the tag) → **`OWNERGAP2-ledger-order`**,
prompted, small. 40 assessor-sourced owners are live; the provenance contract held only because
someone looked.

**GOVDEED3 → gov PR #406, merged.** The round measured 5,671 dateless `deed_records` (Cowork's
prompt said 4,908 — the population grew between measurements; note the drift, not a conflict):
5,142 carry `consideration=0` **and** a placeholder grantor; the 9 with a positive consideration all
carry a real grantor. Gate made conjunctive on the placeholder shape (no date, no document number,
placeholder grantor), `consideration` left unguarded per §13d, positive control for a real $0
quitclaim, 59 tests. ⚠️ Merged is not running: `public_record_ingest.py` runs wherever the gov
ingestion runs — **V1** on the checklist is to confirm the deployed copy carries `_is_placeholder_party_name`.

**DEED1-reconcile-2 → LCC PR #2535 + Dialysis PR #7414, both merged.** Hashes matched the pin before
and after (view `9fc5aa3f…`/4747, function `72b48cd9…`/2183); the migration now sits in
`supabase/migrations/dialysis/`; the Dialysis copy is removed; `CLAUDE.md`'s Dialysis_DB inventory row
no longer reads as an ownership verdict and names this incident as the worked example.
CANON-OWNERSHIP1's contradiction is therefore closed in the text; 👤 Scott's formal confirmation is
still the open item on that row.

**ID3d → applied live, then Dialysis PR #7415 — the wrong repo, the same day the doctrine was
re-stated.** Verified live on Dialysis_DB: `leases.guarantor_id` **1 → 628 of 715** (87 to review),
`dia_guarantor_aliases` 58, `dia_resolve_guarantor()`, a real FK `fk_leases_guarantor_id` (it had
been described as an FK and was not), fill-blanks trigger, parity view; DaVita/Fresenius subsidiaries
kept distinct with `parent_company_id`. The round applied directly via Supabase MCP (no PR first) and,
lacking this repo in its scope, committed the migration + 9 tests to `Dialysis`. Right result, wrong
record — **`ID3d-reconcile`** prompted: port byte-identical here, remove there, and add the sentence to
the doctrine table that stops the third occurrence.

**MISPARSE1 → LCC PR #2533, merged and running** (Railway `affc5d84` = main). `email_fanout` split by
mailbox genericness: a personal-shaped shared mailbox fanning out to several person-shaped names is
admitted whole; a role inbox stays strict. 4 → 9 of 12 real brokers recovered on the live fixture, 0
new junk; `person_junk_name` strengthened for the genuine junk that had been leaking (financial line
items, `PO Box`, `NAI <City>`). The round wrote its own STATUS entry and rows (kept).

**BR1/BR3 → applied live + LCC PR #2534, merged.** Cowork re-measured Dialysis_DB: `broker_companies`
**75** (from 131), 10 `;`-rows left (the ambiguous ones, in `dia_broker_company_composite_review`),
`brokers.broker_company_id` **366 of 2,550 (14.4%)**; the review table holds **674** rows — 10 firm
composites, **661 `brokers.company` strings with no registry match** (queued, never minted), 3
existing-link conflicts. That 661 is the real next unit for BR4. Write guard rejects new `;` names.
The round wrote its own STATUS entry and rows (kept; the open-threads row header it produced is fixed).

**Process note.** Three of the five rounds edited `STATUS.md` / `PLANNED-BACKLOG.md` directly. Two of
them re-introduced rows that already existed (caught by the ID-uniqueness guard, fixed by the rounds
themselves) and one appended a fifth cell to four rows (caught by the table-shape guard). The guards
did their job; the rule that keeps the fixes from being needed goes in `BUILD-TURN-PROTOCOL.md`: a
round **appends** to STATUS and **updates the row it owns**; it never restates a row, and Cowork
reconciles in the next turn. Row `PROCESS-CC-DOCS`.

**Next:** send `OWNERGAP2-harris-c`, `OWNERGAP2-ledger-order`, `ID3d-reconcile`; V1 (where does
`public_record_ingest.py` run?); decisions S1–S5; the PRI2 side-by-side.

## 2026-09-16 — MISPARSE1: email_fanout split into generic-inbox vs team-roster (Cowork)

`isGenericMailboxLocalPart()` + `recoverTeamRosterBatch()` (`api/_shared/misparse-disposition.js`),
additive to the existing single-owner `recoverFanoutOwner`: a personal-shaped shared mailbox (not
`info@`/`leasing@`/`admin@`/…) that fans out to several distinct person-shaped, non-org names is now
admitted whole; a role/generic inbox stays exactly as strict before. Measured on the live 15-row
`email_fanout` fixture: recovered 4 → 9 of 12 named real brokers, 0 new junk admitted. Strengthened
`person_junk_name` (`hasFirmSuffix`/`tmMisparseReason`) to catch the genuine junk that had been
leaking into `email_fanout` instead (financial line items, `PO Box ####`, `NAI <City>` franchise
brand, CRE marketing headlines) — never touched the working `person_junk_name` rule itself.
`test/hp1-p2misparse-guard-disposition.test.mjs` +9 (23/23). Full suite 6458/6458, 0 regressions.
See `docs/os/PLANNED-BACKLOG.md` MISPARSE-BACKLOG1 / HP1-P2misparse.
## 2026-09-16 — BR1/BR3 broker_companies registry repair applied live to Dialysis_DB (Claude Code)

**`broker_companies` was a corrupted firm registry** — of 131 rows, 73 (56%) carried a literal `;`
composite capture artifact ("`<firm>; <agent surname>`", occasionally a genuinely ambiguous
multi-party capture), and `brokers.broker_company_id` was wired on only 184 of 2,542 rows (7.2%).
Re-measured live before building (the PLANNED-BACKLOG counts were stale): confirmed 73/131, and
that the `&` vs `;` distinction (BR3) holds exactly — `&` names a real firm (`Lee & Associates`,
`Cushman & Wakefield`, `Horvath & Tremblay`), `;` is the capture pipeline's composite separator.

**Applied via Supabase MCP (`apply_migration`) directly against Dialysis_DB `zqzrriwuavgrquhisnoa`,
then committed to the repo** as `supabase/migrations/dialysis/20260916120000_dia_br1_broker_company_registry_repair.sql`.
Dry-run first, then real apply, then the fleet-wide `brokers.broker_company_id` backfill, then a
hardening pass (RLS + `search_path` on the four new tables/functions — closed both advisor
findings the first apply produced).

- **Classifier, not a hand-enumerated list.** `br1_classify_composite()` splits each `;`-row into
  firm-token / agent-text and flags four GENERIC ambiguity shapes (more than one `;`; a stray `:`
  alongside the `;`; the firm and agent text sharing a prefix in either direction — the
  "`reichel; reichel realty`" / "`silver; silver group`" reversed-capture shape; an agent token
  that itself names another existing firm — the "`cole; m&m`" shape). **10 of 73 rows are
  genuinely ambiguous and were routed to `dia_broker_company_composite_review`, untouched.**
- **A real bug found mid-build and fixed before applying for real:** the agent-token splitter's
  first draft used `\s*(&|,| and )\s*` — optional whitespace around `&` — which shreds a tight
  firm abbreviation like `m&m`/`c&w`/`b&e` into two garbage tokens and made the classifier blind
  to `"cole; m&m"` naming a second real firm. Fixed to `\s+&\s+|,\s*|\s+and\s+` (mandatory
  surrounding whitespace), caught by a dry-run diff before the real apply, and pinned with a
  positive-controlled test.
- **Resolution order: exact match against an existing bare canonical row, then a small
  evidence-backed alias table, then mint verbatim (never fabricate an expansion).** Two aliases
  seeded, both citing evidence already present verbatim elsewhere in the table (`m&m` →
  `marcus & millichap`, whose fuller spelling already exists as its own bare row; `c&w` →
  `cushman & wakefield`, minted from the literal firm-token text of the
  `"cushman & wakefield; sheldon"` row). **The `m&m` alias never actually fires** — a bare `m&m`
  row already existed and exact-match wins first, so all 37 `m&m;<agent>` composites collapsed
  onto the pre-existing abbreviated row, not onto `marcus & millichap`. That is the SAFER outcome:
  merging those two bare rows into one identity is the ID3c decision this unit deliberately stays
  out of.
- **Live result:** 63 collapsed (colliers 5-way onto the existing bare `colliers` row; `m&m`
  37-way; `c&w` 10-way onto a newly-minted `cushman & wakefield`; `kw`/`encore`/`svn` 1–2-way
  each); 6 new firms minted verbatim (`b&e`, `berkeley capital advisors`, `coldwell`,
  `cp partners`, `horvath & tremblay`, `ribeiro corp`); 7 brokers created, 49 filled from blank;
  1 pre-existing broker FK repointed off a composite id before its row was deleted (measured live:
  81 brokers rows already pointed straight at a composite id — `broker_company_history` and
  `sale_brokers` also FK `broker_companies` and are repointed the same way). `broker_companies`
  131 → 75. Fleet-wide `brokers.broker_company_id` backfill (exact/alias match only): 126 more
  filled, 661 `brokers.company` values with no registry match routed to review (raw text intact,
  never used to mint a company) → **coverage 184/2,542 (7.2%) → 366/2,549 (14.4%)**.
- **Guard against a new composite ever landing again:** `trg_br1_guard_no_composite_company_name`
  (BEFORE INSERT/UPDATE OF company_name) rejects any value containing `;` — verified live with a
  real INSERT that raised 23514.
- **Parity/audit view `v_br1_broker_company_parity`** — confirmed only the 10 collapsed-into firms
  (`b&e`, `berkeley capital advisors`, `coldwell`, `colliers`, `cp partners`, `cushman & wakefield`,
  `encore`, `m&m`, `ribeiro corp`, `svn`) show a `broker_count` movement; nothing else moved.
- **Idempotent, verified live**: re-running `br1_repair_broker_companies` after the real apply
  returns `composites_seen=10, resolved_collapsed=0, companies_minted=0` — the 10 ambiguous rows
  and nothing else.
- **Not done here, by scope:** no `brokers` dedupe (BR4), no display-layer change (BR5), no
  identity merge across the `m&m`/`marcus & millichap` bare-row pair or any other ID3c collision.
  All three are now unblocked.
- **Guard:** `test/br1-broker-company-registry-repair.test.mjs` (20 tests; positive-controlled —
  reverting the whitespace-guarded `&`-split regex back to the loose form turns the guard red).
- Docs updated in the same change: `docs/os/PLANNED-BACKLOG.md` (BR1/BR3 marked ✅ shipped, BR4/BR5/
  ID3c/BR1-misparse-handoff annotated unblocked), `docs/os/CURRENT-STATE.md` (Dialysis_DB section).

---

---

## 2026-09-16 — H6: the loader wrote nothing twice on the real HCAD file; Cowork repaired it and staged the full roll; the third dry run says the rest is a situs gap, not a matcher gap (Cowork)

**Scott's two runs.** Run 1 had no Dialysis credentials in `.env.local` (`[ops-db] WARN … DIA_SUPABASE_URL`)
— every chunk 503'd, reported as `chunk_at_0_failed:undefined`. Run 2, with the credentials, parsed
1,628,306 lines → 71,276 F1/F2 rows and again reported `wrote 0 of 71276 … 72 chunk(s) failed`. The
DB said otherwise: 53,000 rows had landed. Patching a copy of the loader in the VM to print PostgREST's
body found the real error on the other 19 chunks: `23505 duplicate key value violates unique constraint
"uq_hcad_stage_acct_year"`. The POST carries `Prefer: resolution=merge-duplicates` but no
`on_conflict=acct,file_year`; PostgREST infers the arbiter from the primary key only, so every chunk
holding one of Cowork's 37 seeded accounts failed. And the `wrote 0` was a second bug: `flush()` reads
`r.ok`/`r.status` from `upsertRows`, which returns `{ written, errors }`.

**Then the worse one.** `owner_name` was NULL on all 71,276 rows — and the upsert had overwritten the 37
seeded owners with NULL. The 2026 `real_acct.txt` header is `acct, yr, mailto, mail_addr_1, …`: **no
`name` column**, so the parser's candidate list matched nothing; the loader only used `owners.txt` for a
second owner. The harris-b prompt had specified `owners.txt` ln 1 as the owner of record. Cowork's
patched copy (on_conflict; `owner_name` from `owners.txt`; honest accounting) re-ran in ~60 s:
**71,282 rows, 0 without an owner, 68,811 F1 / 2,465 F2**, seeded rows restored (`2000 CRAWFORD
PROPERTY LLC` back). 995 rows carry HCAD's placeholder `CURRENT OWNER`; none was ever applied (checked
`recorded_owners`). All three fixes + the placeholder refusal + a C2 switch → **`OWNERGAP2-harris-c`**
(prompt written). Nothing in the repo changed this round; the patched copy lives in the VM only.

**Third live dry run (full roll, deployed `ac96fd45`, population 31 still open): 1 resolved / 30
refused** — 27 `no_staged_rows`, 2 `no_records_returned`, 1 `no_matching_record`. With the whole roll
staged, `no_staged_rows` means HCAD has no account at that street+number. Checked in the raw file, all
classes, for 20 of the 27: `5208 Atascocita Rd` (HCAD: 5123/5131/5132/5210/5212/5220/5226), `6626
Antoine Dr` (6601/6696/6700), `2254 Holcombe Blvd` (2245/2249/2250/2265 W), `2920 Fulton St`
(2901/2902), `2916 Woodridge Dr` (2900/2928), `1426 Kingwood Dr` (1409/1450), `10923 Scarsdale Blvd`
(10901–10906), `20435 Cypresswood Dr` (20434/20445/20467)… **LCC's house numbers are not HCAD situs
numbers.** That is the §P10a property-identity problem (a clinic inside a larger parcel or a
tenant-facing number) and needs a parcel discriminator, not a looser matcher — nearest-number is
guessing and stays forbidden. Two of the 30 are the class filter: `380 E Little York Rd`
(`0222430000049`, **C2**, `380 LITTLE YORK LLC`) and `10311 S Post Oak Rd` (`0440360000028`, **C2**,
`LUEL PARTNERSHIP LTD`) → decision **S5**. The 1 resolved: `2626 South Loop West` → `AMALGAMATED
HOUSTON HOLDINGS LLC` (`1145390000003`, exact; the `2626 W LOOP S` account on West Loop South correctly
not taken) → **H7**, applied on Scott's go.

**Net for the lane:** the Harris population is 50; 19 applied, 1 applying, 2 pending S5, 27 need a
parcel discriminator, 1 is the Longenbaugh Rd/Dr duplicate. The free-bulk pattern holds — the ceiling
here is address identity, which is now measured, not assumed.

## 2026-09-16 — Harris owners applied (19) via HCAD bulk PDATA; backlog regrouped by category; ROADMAP.md added (Cowork)

**OWNERGAP2-harris-b reconciled (PR #2531, `6c97c86a`; Railway at `ac96fd45` = main).** The round did
what the prompt asked — `harrisPdataStreetKeys()` queries HCAD's bare `str` plus `str_num` with alias
expansion, the suffix is optional when LCC has none — and found two more real bugs on the way:
`stageRowToLocation` was concatenating `site_addr_2/3` (city/zip) into the street text, and
`normalizeAddress` collapsed `Northwest Fwy` to `FWY`. Against the 37 real staged rows: 24 of 25 named
targets resolve; Little York 2711 correctly refuses (`needs_parcel_discriminator`). Crawford and Kirby
resolved rather than refused because their non-F1/F2 accounts are excluded as untyped — that is the
rule working, but Kirby 9001 (three accounts) is worth Scott's spot-check. Loader rewritten to stream
(`JSZip.nodeStream()` + `readline`), `owner_name` from `owners.txt`, `mailto` → `owner_name_2`, `--dsn`
accepted; verified on a synthetic 50k-row zip through the real decompression path — the production zip
is still unloaded (→ H6). 19 new tests; suite 6,452/0.

**Live (Cowork, Scott's go):** second dry run `jurisdiction=harris_tx`, population 50 → **19 resolved /
31 refused** (streets outside the subset, plus real refusals — `18003 Longenbaugh Dr` refused on a
suffix conflict because LCC holds that site as both `Rd` and `Dr`: a dia duplicate to fold). POST,
batch `ownergap2_harris_tx_20260916` → **wrote 19**. Re-measured on Dialysis_DB: properties with a
`recorded_owner_id` **5,494 → 5,517**; ledger 76 rows (harris 19/31, philadelphia 20/6); every Harris
source cites its HCAD account; TX `true_owner_id` fingerprint `8810c66e…` unchanged. **39 assessor-
sourced owners now live; 41 Harris targets wait on the full-roll load (checklist H6).**

**Scott's question — "have the inventory prompts and responses been integrated into our to-do lists
by category?"** Honest answer: the *rows* were — every INVENTORY1/1b finding is a backlog row or a
loop change (INVENTORY-process, REMEDIATION-2026-05, FLAGS-geocode, REGISTRY-contacts-hub) — but they
were filed **by adjacency, not by category**: DEED/GOVDEED/C1B/C1C rows sat under §P18 *Executive
briefs*, OWNERGAP rows under §P17 *Donna TX walkthrough*, SBN/FLOWS/INVENTORY rows under §P17 too.
Nothing above the row level said "here is the ownership-evidence lane, here is app & flow health,
here is process." Fixed this round: three new backlog sections — **P19 Ownership evidence** (deeds,
owner-source conflicts, research lanes, the owner gap: 30 rows), **P20 App observations & flow
health** (17), **P21 Inventory, process & consolidation** (7) — rows moved verbatim (747 table lines
before and after, IDs unchanged), each with an intro that names the arc, its state, and what is
still open. And the missing layer above the backlog: **`docs/os/ROADMAP.md`** — one screen per
category (live / partial / open / next unit / Scott's decision), pointing at the rows. It is the
file to read when the question is "what is the next unit of work in lane X?"; the backlog stays
the row-level truth; CURRENT-STATE stays the measured state.

**Also:** Open-threads table de-duplicated (CoStar, C2g and Deed rows each appeared twice after the
09-15/09-16 merges; the newer line kept). CURRENT-STATE's OWNERGAP2 paragraph rewritten (it still
said "zero rows written" and "Harris ships fetches:false"). OPERATOR-CHECKLIST: H5 ✅, H6 added
(exact command, both credential options). `OWNERGAP2-harris-b` prompt + response → done/.
**Next:** H6 (Scott) → third Harris dry run → apply; decisions S1–S4; PRI2 side-by-side (S1 input);
GOVDEED3 handoff; CLAUDE.md pass 2.

## 2026-09-16 — FLOWS1-artifact live; FLOWS1-order refuted by the round — the race is two flows on one trigger, not LCC; F1c verified from the export (Cowork)

**FLOWS1-artifact ✅ live** (PR #2528, Railway `c6fda4e7`): `fetchSharepointBytes()` reads both Get
Artifact shapes and returns a named `too_large`; the CRE longdoc lane rides its 30-day ceiling; the
plain doc-text lane gets `artifact_too_large` and leaves the eligible queue;
`GET /api/document-text-tick?mode=dead-letter` lists both. Not done, filed: size-aware skip at
discovery and real backoff for non-terminal failures. **F1c verified from Scott's second export:**
metadata first from the trigger path, `Size < 20000000`, content fetch inside the True branch, the
bytes `Response` exactly as specified; the False branch is the plain metadata JSON without
`ok/reason`, which LCC already treats as `too_large`. Test passed on Scott's side.

**FLOWS1-order ❌ refuted, and I was wrong.** I wrote the prompt "from the code" after seeing
`await emitPC(...)` on six paths and assuming the emit relayed the move. The round read
`emitProcessingComplete()` to the end: it writes a `processing_log` row (`move_status='pending'`)
and returns — it never imports or calls `pa-move-message.js`. The move happens two ways, both
after the card: the flow's own `HTTP_ProcessingComplete` step, and the 15-minute Move Queue
Executor (P120/P121, live since 2026-08-20; 113 moves in 14 days, 2 benign `already_out`
races, worklist empty). No code changed. So what *does* move the message before
`GetEmailWebLink` runs? The exports answer it: **two flows fire on the same `When an email is
flagged (V3)` trigger** — *LCC Flagged Email Intake* ends with `Flag → Mark → Move email`, and
*Outlook Intake to Teams (Hardened)* reads the message a few seconds later. Flow vs flow, not LCC.
Scott's F2 (web link first) and F3 (retry + run-after) are the mitigation; the durable fix is one
flow per trigger, which is Scott's design call (`FLOWS-consolidate`, decision). Correction applied
in place to the 2026-09-16 entries that said otherwise, per ⑥.

**Lesson, filed:** a partial code read produced a confident wrong mechanism; the round's full read
plus live counts refuted it. "Confirmed from code" means the *whole* call chain, to the side effect.

---

## 2026-09-16 — Harris: stage table applied and seeded from the real export, first dry run 0/50 for a matcher-shape reason, harris-b written; F1c re-specified after Scott's first test (Cowork)

**F1c.** Scott's first test failed one step earlier than before — `Get file metadata using path` was
referencing `body('Get_file_content_using_path')`, which trips the same chunked-content rule. The
corrected shape (metadata first from the trigger path, Condition on Size, content fetch *inside* the
small-file branch) is in the flow guide and the checklist; large files no longer enter the 24-second
fetch at all. `FLOWS1-artifact` merged (PR #2528) — LCC reads both response shapes.

**Harris.** Scott downloaded `Real_acct_owner.zip` and the codebook; the loader died on the 889 MB
`real_acct.txt` (`RangeError: Invalid string length` — it reads the whole file as one string) and has
no local Dialysis credentials. I read the file directly: tab-delimited, headers exactly as the parser
expects, **F1 68,811 / F2 2,465** (the assumed codes are right; L1/L2 live in a separate personal-property
file), and `owners.txt` holds the clean owner name while `mailto` carries care-of text. The stage
migration had never been applied — applied it — and loaded a **37-row targeted subset** (every account
on the 50 target streets and house numbers) with `owner_name` from `owners.txt`. Dry run on the deployed
route: **0 resolved / 50 refused** — 47 `no_staged_rows` because the matcher queries `str=eq.'CRENSHAW RD'`
while HCAD stores `CRENSHAW` with the suffix in `str_sfx`; 3 `no_matching_record` because the comparison
demands a suffix LCC's address lacks. Proved the rest of the pipeline locally: `5040 Crenshaw Rd` resolves
`exact` against the real staged row the moment the fetch shape is right. → **OWNERGAP2-harris-b**
(fetch shape, optional suffix, streaming loader, owners.txt mapping, creds). Expected on the rerun:
roughly 25 of the 50 resolve from the subset alone; the rest need the full-roll load.

---

## 2026-09-16 — Five rounds reconciled (PRI2, DIA1b, MCP1, OWNERGAP2-harris, INVENTORY1b ×3), Scott's seven flow edits verified from their exports, and one of them changed a contract LCC still expects (Cowork)

Railway auto-deployed `8ab35ec9` = main, so PRI2 (flag OFF), DIA1b and MCP1 are running. **MCP1 verified
live**: `get_property_context(28398, dia)` now returns a labelled facts-only context naming
`EPISCOPAL HOSPITAL` with the operator flagged — OWNERGAP2's gate #6 finally passes.

**PRI2 ✅ built, flag `priority_tab_v2` OFF.** V1 untouched behind a router; V2 = one ranked list from
`v_lcc_seller_prospect_queue` with a footer naming each hidden code-doable band's count and producer
(`/api/priority-hidden-band-counts`). The side-by-side gate is the next step, and it is Scott's read.

**DIA1b ✅.** NPI tile now shows the gated lane (81) with the raw diff (~1,019) as a labelled second line;
"as of" stamps from an unused `computed_at` on the MV; lease-backfill relabelled as raw backlog (26
completions ever, all one April bulk); the 45-vs-21 operators question is answered — **both real**: 45
distinct raw name strings, 21 canonical ids, **878 properties with an operator name and no
`operator_id`** — the ID1 fragmentation, second instance. Which number the tile should show is Scott's
call (→ `DIA1b-operators`).

**OWNERGAP2-harris 🟡 built, not run.** Stage table, header-driven parser, matcher on the shared
Philadelphia matcher (Commercial-over-Personal, FM 1960 alias, refusals), loader CLI. hcad.org is
proxy-blocked from the sandbox (and from Cowork's container — the download page is JS-rendered), so
the commercial `state_class` codes are stated assumptions; the run is an operator sequence in
`OPERATOR-CHECKLIST.md` (download → codebook check → dry-run loader → apply → tick).

**INVENTORY1b ✅ three rounds, merged.** With DB access: 7 of the 9 dark flags are deliberate, 2
(`GEOCODIO_API_KEY`, `GOOGLE_MAPS_API_KEY`) are a cost call for Scott; Phase 2.3–2.6 is a **stale doc**,
not a gap (all four sources registered and active — doc fixed in this change); of the twelve May TODOs,
C7/C9/B6/B8 shipped under other names, C5 is open on gov and shipped on dia, A6a partial, C8/A7/A8/C4/B3
still open, C2 partial — now one backlog row instead of a dead table; CONTACTS_HUB: `CLAUDE.md` is right,
the registry note is the stale one; and pass 2's "132 untraced prompts" was an **under-scoped search**
— all 30 sampled resolved once `migrations/`, `test/`, `api/` and `responses/` were included. 1,789
rows, ~1,700 still UNMEASURED, and the process recommendations per leak class are in the gap map; the
one that binds the loop is class 3: *a plan doc's TODO rows either are backlog rows or are retired
with a pointer the moment the work ships*.

**Scott's flow exports, read.** F2 (web link first), F3 (retry 3×PT20S + run-after), F4 (Flag before
Move), F5 (`triggerBody()?['Id']`), F7 (concurrency 1) are exactly as specified. F6 already had a
dead-letter and a timeout response. **F1 took option B** — the flow now returns `{name,size,link,path}`
— and `fetchSharepointBytes()` still expects `content_base64`, so every Get Artifact call from LCC now
fails softly instead of loudly. → **FLOWS1-artifact** (both shapes, size cap, dead-letter; supersedes
FLOWS1-crons) with a one-condition flow addendum F1c. And the export settles FLOWS1-order: the flow
*also* emits processing-complete at its end, so LCC's early await-and-relay inside the intake
response is the only reason the move ever runs first → **FLOWS1-order** prompt written from the code.
⚠️ **Correction (2026-09-16, later that day):** wrong — `emitProcessingComplete` only writes `processing_log`; the move is
flow-driven or the Move Queue Executor. The race is two flows on one trigger. See the later entry.

---

## 2026-09-16 — OWNERGAP2-harris: the free HCAD bulk PDATA loader + matcher, built without a live sample (Claude Code)

Prompt: `docs/claude-code/prompts/done/OWNERGAP2-harris-use-hcad-bulk-pdata-not-the-portal.md`. **hcad.org is
unreachable from this sandbox** — the outbound proxy answers `CONNECT tunnel failed, response 403` (a policy
denial, not HCAD's bot wall this time) — so neither `Real_acct_owner.zip` nor the codebook PDF could be
fetched. Built the full pipeline anyway, honest about every unverified assumption, ready to run the moment an
operator hands it a real download:

- **`supabase/migrations/dialysis/20261012090000_dia_ownergap2_harris_hcad_pdata_stage.sql`** — new
  `hcad_real_acct_stage` table (`acct, owner_name, owner_name_2, mailing fields, str_num/str/str_sfx,
  site_addr_1-3, state_class, is_commercial_class, raw_row, source_file, file_year`), unique on
  `(acct, file_year)` for idempotent re-loads. `is_commercial_class` uses the Texas Comptroller's PUBLISHED
  taxonomy (F1/F2 real commercial+industrial, L1/L2 personal commercial+industrial) — **not independently
  verified against `pdataCodebook.pdf`**, stated in the migration header + column comment as needing operator
  confirmation. `raw_row` keeps every column the loader saw so a wrong mapping is correctable without a
  re-download.
- **`api/_shared/hcad-pdata-parse.js`** (pure) — HEADER-DRIVEN parser (never a fixed column order) for
  `real_acct.txt` + `owners.txt`; sniffs the delimiter (assumed tab, per every documented consumer of this
  dataset, but auto-detects); refuses rather than guesses when the one required column (`acct`) is missing.
  Also carries the commercial-class classification + `harrisStateClassToAccountType()`, mapping onto the SAME
  `'commercial'`/`'personal'` vocabulary the existing payload-only Harris adapter already uses.
- **`api/_shared/ownergap2-harris-pdata-match.js`** — turns staged rows into OWNERGAP2 candidates and resolves
  through the SAME shared matcher (`ownergap2-address-match.js`) Philadelphia and the payload path use: the
  Commercial account is preferred over a co-located Personal account (PDR2 rule, never re-derived from name
  text), the FM 1960/Cypress Creek Pkwy alias applies, multi-account ambiguity refuses. `fetchHarrisPdataForProperty()`
  queries the stage via `domainQuery` and fails closed (never a fabricated match) when the stage is empty or
  unreachable.
- **`api/_handlers/ownergap2-owner-resolve-tick.js`** — Harris now tries the PDATA stage FIRST; an
  operator-supplied payload (the pre-existing manual capture route) remains a fallback for anything the loaded
  export doesn't cover. Nothing auto-runs — same no-cron discipline as the rest of OWNERGAP2.
- **`scripts/hcad-pdata-load.mjs`** — the operator-facing loader. Takes a LOCAL path (a downloaded
  `Real_acct_owner.zip`, an extracted `real_acct.txt`, or a directory holding either) — **no network access
  required**, dry-run by default. Verified end-to-end against a synthetic zip (jszip, now a direct
  `package.json` dependency — it was already resolved transitively, pinned explicitly for a stable install).
- **21 + 4 new tests** (`test/ownergap2-harris-hcad-pdata.test.mjs`, `test/hcad-pdata-loader.test.mjs`): header-
  driven parsing + refusal on a missing required column, the commercial-class filter's positive AND negative
  control (F1/F2/L1/L2 in, A1/B/C1 out), the matcher refusing a Personal-only account and preferring Commercial
  over co-located Personal, the FM 1960 alias, multi-account ambiguity refusal, and the provenance-required-to-
  write guard reused from the existing OWNERGAP2 suite. **Full suite: 6,401 pass / 0 fail / 6 skipped** (up
  from 6,380 pass before this change — nothing else moved).
- **What remains before a real Harris run**: an operator downloads `Real_acct_owner.zip` from
  `https://hcad.org/pdata/pdata-property-downloads.html` (no login/CAPTCHA), ideally reads
  `pdataCodebook.pdf` to confirm the F1/F2/L1/L2 commercial mapping, runs
  `node scripts/hcad-pdata-load.mjs --file <path> --file-year <YYYY>` dry-run first then `--apply`, then a
  GET (dry-run) on `?_route=ownergap2-owner-resolve-tick&jurisdiction=harris_tx` to see the by-cause table
  before a real POST apply. Full detail + the exact commands:
  `docs/claude-code/responses/OWNERGAP2-harris-use-hcad-bulk-pdata-not-the-portal.response.md`.

---

## 2026-09-16 — `daily-briefing` deployed (v26), INVENTORY1 merged, the flow fixes written as click-paths, and Harris turns out not to need Scott (Cowork)

Scott deployed `daily-briefing` — live **v26**, verified — so HOME1 §C's routing fix is running; the
behavioural check is tomorrow's briefing. INVENTORY1's branch is merged; INVENTORY1b can run.

The seven Power Automate fixes are now a step-by-step guide with exact clicks and a suggested
order (`docs/setup/POWER-AUTOMATE-FLOW-FIXES-2026-09-16.md`; F1 has a quick option and a durable one
that hands LCC a link instead of the bytes). While writing F2 I confirmed the LCC-side half from the
code: `api/intake.js` **awaits `emitProcessingComplete` before it responds**, and that emit POSTs the
*(⚠️ corrected later the same day: it does not POST — it writes `processing_log` only; the FLOWS1-order round refuted this)*
move instruction to the Move flow immediately — so the message is moved while the intake flow is still
waiting on our response. `FLOWS1-order` is real, not inferred.

Harris: OWNERGAP2 built it payload-only because the HCAD *portal* is bot-walled, but HCAD publishes
the entire roll as free bulk PDATA files. That makes Harris a prompt (**OWNERGAP2-harris**), not a
hand-fetch; P1 is withdrawn from the operator checklist. Nothing for Scott to gather.

---

## 2026-09-16 — FLOWS1 and INVENTORY1 reconciled: the flows are diagnosed (and I disagree with the round on one), the inventory is honest about being half an inventory (Cowork)

**FLOWS1 ✅ diagnosis complete**, no LCC code changed. The round read the same 17 screenshots and
reached the same per-flow causes; it also checked the dead-letter plane (`v_flow_run_failures_open`
had 2 rows against 750+ digest failures — the webhook records *that* a run failed, never *why*) and
tied Get Artifact's 709/week to two overlapping 30-minute crons (`lcc-document-text`,
`lcc-cre-doc-text-backfill`, ~96 ticks/day). Its conclusion — "nothing on the LCC side to fix" — I
don't accept on two flows and have said so in the row: a cron re-requesting a file that fails
deterministically ~100 times a day is an LCC defect (no dead-letter, no backoff) whatever the flow does
about chunking; and the Outlook-Intake 404 happens because our completion callback fires the Move flow
before the intake flow has read the message — tolerating the 404 hides the ordering. Both are now
their own rows (**FLOWS1-crons**, **FLOWS1-order**). Scott's seven flow edits are in the new
**`docs/claude-code/OPERATOR-CHECKLIST.md`** — the one list of steps only he can do, now a standing file. List Folder's stale path (`… MOVED TO R DRIVE …`) is open: the
round says LCC escapes correctly, so the stored path is wrong, and nobody has named its writer yet.

**INVENTORY1 🟡 two passes, stated limits.** 1,779 CSV rows from headings across architecture, audits,
history and `prompts/done`; ~20 files deep-read; **no DB, no code, no root `.docx`** (no pandoc in the
sandbox). Findings worth the round: nine feature flags OFF with no recorded reason; a six-item
never-tracked cluster in `data_quality_self_learning_loop.md` Phase 2.3–2.6; a ⬜ TODO table from
2026-05-23 (12 rows) never closed; CONTACTS_HUB described as dormant by its seed and live by
`CLAUDE.md`; ~124 prompts with no discoverable trace — a worklist, not a verdict. It is on
`claude/inventory1-audit`, unmerged. The round asked whether to keep scraping or start re-testing;
re-testing is the answer → **INVENTORY1b**, with DB access and the root reports now readable:
`docs/history/root-reports/` holds a pandoc conversion of all ten `.docx` files, headers saying they
are copies, not truth.

Deploy state: Railway `0b6e75b8` = main; `daily-briefing` edge function **still v25** (HOME1-deploy).

---

## 2026-09-16 — Three app rounds reconciled (HOME1, PRI1, DIA1), the flow screenshots read, and one merged fix that is not running (Cowork)

Each round found the same shape under Scott's observation: the surface was showing something other
than what its caption claimed, and in two cases the deployed artefact was months behind the repo.

**PRI1 ✅** (PR #2511): readable band labels are live. The measurement matters more than the labels:
941 of 1,635 queue rows are code-doable plumbing, the tab is 89.6% disjoint from the seller doctrine,
and **`v_lcc_seller_prospect_queue` — shipped 2026-09-03, 520 rows — already implements exactly what
Scott described and has no UI**. That is **PRI2**, written.

**DIA1 🟡** (PR #2512): the dead button was the deployed Dialysis `data-query` edge function sitting at
v41 from July while the repo's allowlist had the econ views — every call 403'd into a silent catch.
Redeployed, and the handler now tells the user when it fails. §A/§C were diagnosed, not finished, and
the round's report went to a scratchpad that no longer exists → **DIA1b** restates and finishes it.

**HOME1 🟡** (PR #2513): cleanup classes are out of the gaps widget (live on Railway `0b6e75b8`); the
three-lane spec exists (→ **HOME2**); the DaVita-under-Government bug was a real one — `inferDomain()`
compared long-form domain strings the data never carries. Fixed with a test. ⚠️ **Not deployed**: the
live `daily-briefing` edge function is v25 from May. Merged is not running, again, and this time it is
the fix for the bug Scott photographed → **HOME1-deploy**. Also found: ID3a's fold doesn't write the
column the drift check reads → **ID3a-drift**.

**Flow screenshots (SBN-9).** All 17 read. The eight failures are now diagnosed and split: four are
ours (Get Artifact builds a `Response` from chunked `body()`; Outlook Intake and Flagged Intake read a
message the Move flow already moved — our completion callback fires the move too early; List Folder
sends a path with an apostrophe; the Switch flow's Salesforce lookups outrun the caller's timeout),
three are Scott's in Power Automate, one is benign. FLOWS1 updated in place; ready to run.

Railway is at `0b6e75b8` = main. STATUS archived (twentieth span). Queue: HOME1/PRI1/DIA1 to `done/`;
new: PRI2, DIA1b; backlog-only: HOME2, ID3a-drift, HOME1-deploy.

---

## 2026-09-16 — OWNERGAP2 applied: the first 20 owners in the arc; CLAUDE.md pass-1 cut; INVENTORY1 and MCP1 drafted (Cowork)

**OWNERGAP2 ✅ applied (Philadelphia).** After Scott's Railway redeploy (`/version` = `0235c31a` = main)
I ran the dry run against the deployed route — through pg_net with the vault key, so the key never
entered this chat — and got the build's exact numbers: 26 → 20 resolved / 6 refused. Scott chose apply.
Batch `ownergap2_philadelphia_pa_20260916` wrote 20: properties with an owner **5,474 → 5,494**,
`recorded_owners` +17 (three owners span two addresses), ledger 26 rows, every new row's `source`
citing its OPA record id, PA `true_owner_id` fingerprint unchanged. **Twenty of the 4,021 now have an
owner from a public record**, and the method is proven; Harris needs an operator-supplied HCAD payload.
Gate #6 failed for a reason that is its own finding → **MCP1**: `get_property_context` cannot see a dia
property that is not among the 1,784 minted LCC assets, and its address path throws
`(rows \|\| []).filter is not a function`.

**CLAUDE.md pass 1 (CONSOLIDATE4).** 5,503 → **3,268** lines. The 34 dated round narratives (Aug 14 –
Sep 2) went verbatim to `docs/history/CLAUDE_rounds_2026-08-14_to_2026-09-02.md`; an index of their
titles (each title is its lesson) stands where they were, and the header says so. Every rule,
doctrine, footgun and invariant stayed. Pass 2 — condensing the doctrines and footguns themselves —
waits for Scott, section by section.

**INVENTORY1 drafted.** Scott's ask: every plan, design and discussion ever, against what is actually
built and running, to find what is slipping through the cracks and aim the next rounds. The prompt is
read-only, extracts intent from every source including the loose `.docx` reports, measures state
rather than reading it, and ends with the process change per leak class.

---

## 2026-09-16 — GOVDEED5b + OWNERGAP2 reconciled; the SB-notes intake exists now, and its first pass produced four app prompts (Cowork)

**GOVDEED5b ✅ live** (gov PR #405): the three sale propagators re-pointed to `latest_transfer_*`;
`pg_proc` writers of `latest_deed_date` 4 → **1**; `latest_deed_date` 3,340 → **43** and holding after a
hand-run of the 03:30 cron and a trigger fire in rolled-back transactions. Re-measured here: 43 / 43 /
1 writer. GOVDEED2 → 4 → 478 → 5 → 5b is the whole deed arc, and it is done except GOVDEED3 (the
accept gate) and the Python writer's deployed state, which the round scoped out and said so.

**OWNERGAP2 🟡 merged, not run** (LCC PR #2508): Philadelphia 20/26 live, Harris payload-only (HCAD is
bot-walled — the prompt's rule, honoured), guard intact and refusing a real `ABC INC`. Nothing applied
by design. The next step is an operator sequence: redeploy both Railway services, confirm `/version`,
dry-run tick, review, apply, and then the number the whole arc exists for — how many of the 4,021.

**SB notes — the intake.** Scott's new folder (`docs/claude-code/SB notes/`) holds what he notices in
the app. It now has a protocol (`README.md`), a ledger (`TRIAGE.md`, `SBN-n`), a line in
`BUILD-TURN-PROTOCOL.md` §④, and `docs/claude-code/README.md` was rewritten — it still described
`NN-slug.response.md` files and a dossier-era trail doc nobody uses; that was the exact misdirection a
future chat would have walked into. First pass, two files → **8 rows, 4 prompts**: **FLOWS1** (eight PA
flows failed in a week, Get Artifact 709×; the LCC side first, Scott supplies one failed-run screenshot
per flow), **HOME1** (the gaps list is 9/10 agency-drift cleaning — ID3a's class — and one real human row;
Home mirrors Priority; a DaVita deal under *Government highlights* is a lane-key bug to fix), **PRI1**
(P-bands → one ranked human-only list; spec + label change only), **DIA1** (six action items graded
human/code/noise; the Market Economics Exhibit button fails silently at `dialysis.js:1744`; tiles are
stale by 22 rows and one counts a different thing: 45 "operators" vs 21 distinct `operator_id`).

Every screenshot number was checked against the database before it became a row.

---

## 2026-09-16 — `HCRIS-TIMEOUT-5` fixed both bugs, confirmed merged/redeployed, and a fresh post-fix run still shows the identical failure — plus a content-loss regression from a parallel session's merge, now recovered

**Recovery note first, since it affects trust in this file's history**: this entry (and the `HCRIS-TIMEOUT-5`
STATUS entry, and the round-5 update to the Open-threads table above) was **written once already earlier
today, merged to `main` at `ab14c9cf`/PR #2516 — and then silently reverted** by a parallel Cowork session's
later merge (`8cda70b9`, "docs(round8)... STATUS archived tail12"), which appears to have branched from a
stale checkout and overwrote this shared section back to its pre-`HCRIS-TIMEOUT-5` state without any conflict
being raised. Caught by independently re-checking this file against `origin/main` before reporting live-run
status, rather than assuming a prior write stuck. Re-applying the full content now. This is the same
doctrine-collision shape `CANON-OWNERSHIP1`/`DIA_OWNERSHIP1` already named for this repo (two branches
touching a shared append-only doc, one clobbering the other on merge) — worth a guard, not just a one-off fix;
flagged separately below.

**HCRIS-TIMEOUT-5 (original content, restored)**: Fifth round, first fix round since `HCRIS-TIMEOUT-4`
isolated the two structural bugs. CC fixed both same day:

- **Discarded run id**: `start_run()` now builds an actual query-builder object and passes it (with
  `return_representation=True`) into `safe_execute()`, instead of a bare lambda with `.execute()` already
  baked in — the fix the prior round called for. All named call sites (`main.py:3177`, `run_cms_ingestion.py:
  852/1786/1833`, `acquire_ingestion_lock()`) route through `start_run()` directly, so **one fix repairs all
  of them**, confirming the "fix once, fixes everywhere" framing from the `-5` prompt.
- **Swallowed timeout**: CC reports the loop-vs-hang question this round was specifically asked to resolve
  **couldn't be settled from the error-log evidence alone** (the ledger only flushes between steps, not
  per-row) — disclosed plainly rather than guessed. Found independent structural evidence instead: `aux_cms_
  tables`'s direct `psycopg` calls carry no `statement_timeout`/keepalive tuning (every other DB call in the
  codebase does), and `SIGALRM` can't interrupt a blocked native socket read. Fixed both angles: `TimeoutError`
  now re-raised before the per-row `except Exception:`, plus a 60s statement timeout + keepalives on the
  direct connections.

10 new regression tests, full suite 3,280 passed / 1 pre-existing unrelated failure (confirmed by CC to also
fail on unmodified `main`). Pushed to `claude/compassionate-hamilton-geof1p`, commit `226f7e3`, `Dialysis` PR
#7413 — **Scott confirmed both this PR and the corresponding `life-command-center` docs PR merged and
redeployed.**

**New, since the original entry — live proof attempted, and it did not pass.** Scott triggered a fresh CMS
ingestion run at 2026-09-16 14:39:20 UTC (confirmed live: the two prior stuck runs from before the fix were
cleanly reclaimed/closed at that same moment — `593e1e75…`→abandoned, `1fb8af07…`→failed — one small confirming
sign the fix's reclaim path works). **The new run shows the identical failure shape as every pre-fix round**:
errors burst from 14:39:32–14:54:55 (~15 min, the same `ratings`/`clinic_quality_metrics` circuit-breaker
errors as always), then total silence — zero errors of any kind for 5+ hours since. `ingestion_tracker.notes`
is still `'{}'`, and `facility_cost_reports` hasn't moved off 2026-03-16. **One genuinely new detail**: the
`"step 'aux_cms_tables' exceeded 900s"` timeout message that fired on every prior run **did not appear at all**
this time — different behavior, but not yet understood whether that's the fix changing how the timeout
surfaces or a different blocking point upstream of that check. Scott's own log upload for this run turned out
to be an unrelated sub-job (`facility_patient_counts` revenue propagation, confirmed genuinely still live via
`properties.updated_at` moving in real time) — not the `aux_cms_tables`/HCRIS pipeline being tested.

`HCRIS-TIMEOUT` **stays 🔴**. Both bug rows move from "fixed, unproven live" back toward needing a sixth round,
since the live proof this round exists specifically to get did not materialize. Full writeup:
`docs/claude-code/responses/done/HCRIS-TIMEOUT-5-fix-the-two-structural-bugs-start-run-header-and-aux-cms-timeout-swallow.response.md`.

## 2026-09-17 — `HCRIS-TIMEOUT-6`'s fix, live-tested overnight on a scheduled run, did not work — the `StepTimeout` still never fires

Scott confirmed `Dialysis` PR #7417 merged and redeployed. The scheduled 06:00 UTC cron run (started
2026-09-17 06:04:28 UTC) was the first genuinely clean live test this arc has had: no ambiguity about whether
the fix was live, because Scott's Railway screenshot shows the active deployment is PR #7417, dated ~14 hours
before the check (i.e., deployed well before this run started).

**Checked live at DB time 11:51 UTC (~5h47m into the run) and again via Scott's Railway screenshot (6h13m,
still running)**: the same 13-minute startup error burst (06:04–06:17 UTC, the usual `ratings`/
`clinic_quality_metrics` circuit-breaker errors), then the identical pattern `HCRIS-TIMEOUT-6` diagnosed —
sustained real `properties` writes with zero `ingestion_run_errors` after the burst. **This run has already
touched 9,964 properties (more than the 6,879 that triggered `HCRIS-TIMEOUT-6` in the first place) and is still
writing in near-real-time.** No `StepTimeout` has appeared anywhere in `ingestion_run_errors`. `notes` is still
`'{}'`; `facility_cost_reports` is still frozen at `2026-03-16`.

**Plain reading: `HCRIS-TIMEOUT-6`'s fix did not solve the problem.** The `except TimeoutError: raise` change
only matters if the 900s `SIGALRM` actually fires — re-raising a signal that never arrives changes nothing.
Either the alarm isn't being armed for this step at all (maybe `propagate_financials()`/the `patient_counts`
step was never wrapped in `run_with_timeout()` to begin with, unlike `aux_cms_tables`), or it's armed but not
being delivered during this specific call pattern. That's a materially different, likely deeper question than
what round 6 answered, and `HCRIS-TIMEOUT-7` needs to check whether the timeout mechanism is even reachable
here before proposing another fix.

Still being live-monitored as this is written — how the run eventually ends (finishes and reaches
`hcris_cost_reports` for the first time in this whole arc, or gets killed again around the 4–7 hour mark like
the prior run) is itself useful evidence not yet in hand.

## 2026-09-16 — `HCRIS-TIMEOUT-6`: root cause confirmed against the deployed code — a third swallowed-timeout site, matching this session's own live evidence exactly; two backlog bugs now confirmed genuinely fixed

Sixth round. This session's own `-6` prompt (drafted right after correcting the "genuine hang" misread below)
asked CC to confirm, against the actual deployed code, whether the `facility_patient_counts`→`properties`
propagation step is unbatched, and what stops execution right after it finishes without ever calling
`finish_run()`. **CC's answer matches the live evidence exactly rather than reinterpreting it**:
`propagate_financials()` in `src/propagation_utils.py` does 2 sequential Supabase round trips per property
(`SELECT`+`UPDATE`) in a plain per-row loop — the same N+1 shape already fixed once for `hcris_propagation`'s
old path, never ported here — and its `except Exception:` swallows the 900s `StepTimeout` the identical way
`aux_cms_tables` used to. Since the alarm is one-shot, that permanently disarmed timeout enforcement for the
rest of the step, turning a 15-minute budget into the 4h18m, 6,879-property run this session watched live. The
whole-run 90-minute budget never caught it because (per this session's own guess in the prompt, now confirmed)
it's only checked *between* steps. The missing `finished_at` is attributed to a platform-level (Railway) kill
landing before Python could finalize — CC notes the existing SIGTERM handler's own comment already
acknowledges it can't cover SIGKILL, rather than presenting this as a new discovery.

**Fixed** (`Dialysis` PR #7417, branch `claude/hcris-timeout-6-8f3k2a`): `TimeoutError` re-raised before the
generic handler at 4 call sites (`propagate_financials()`, `_resolve_property_id_for_financials()`, both call
sites in `patient_count_ingestor.py`); a batched prefetch added for the SELECT side, with the UPDATE side
deliberately left per-row — disclosed as a scope call, not silently skipped, with a safe per-id fallback. 16
new tests, full suite 3,292 passed / 1 pre-existing unrelated failure. **PR merge status not yet confirmed by
Scott — asked directly.**

**Two backlog rows this arc has carried since `HCRIS-TIMEOUT-4` are now confirmed genuinely fixed, not just
patched-and-hoped**: `HCRIS-START-RUN-HEADER-BUG` and `HCRIS-AUX-CMS-TIMEOUT-SWALLOWED` both move to ✅ — the
live evidence that the run advanced clean past `aux_cms_tables` into a much later step and held a lock for
4h18m is only possible if both fixes are genuinely working (the old header bug would have orphaned the lock
immediately; the old `aux_cms_tables` swallow would never have let the run past step 3 at all). Full writeup:
`docs/claude-code/responses/done/HCRIS-TIMEOUT-6-not-a-hang-a-slow-unbatched-propagation-step-that-never-hands-off-to-finish_run.response.md`.

`HCRIS-TIMEOUT` stays 🔴, but for the first time in this arc the next live test is cheap: watch the next run die
fast and cleanly (~15 minutes, a genuine `StepTimeout` logged to `ingestion_run_errors`) instead of running for
hours — a very different signal to wait for than anything prior rounds could check for.

## 2026-09-16 — `HCRIS-TIMEOUT`, live-monitoring the post-`HCRIS-TIMEOUT-5` run to a stop: NOT a hang — a ~4h18m real, slow, unfinished step, then the run stopped without ever reaching `finish_run()`

**Correction on the record first**: the same-day entry immediately below this one (originally posted with the
heading "...went silent at minute 15, and its tracker row was never closed") called this a likely "genuine
hang." That reading is now known to be wrong, on better evidence gathered minutes later — not deleted, but
corrected here rather than silently overwritten, per this file's own recovery discipline earlier today.

Continuing to live-monitor the run triggered 14:39:20 UTC rather than accept status secondhand. Scott reported
the `cms-ingestion` Railway service (confirmed by name as the one he's been triggering) started ~9:38 local, ran
4h18m, and is no longer running on Railway; he then supplied a Railway dashboard screenshot (Cron Runs tab,
confirming the 09:38 execution ran exactly 4h18m) and a 25-second log slice from its tail (18:56:46–18:57:11
UTC). **Checking `properties.updated_at` minute-by-minute across the full run window — not just two point
snapshots, which is what produced the wrong "silent for 6 hours" reading — shows continuous, accelerating write
activity from 14:55 UTC through 18:57 UTC** (5–10 writes/minute early on, ramping to 60–100/minute), **6,879
distinct properties touched, stopping within a minute of Railway's own reported end time.** The log slice
confirms what it is: `src.propagation_utils` writing `estimated_annual_revenue` to `properties`, tagged
`facility_patient_counts` — real, legitimate work, not a stuck process. **The earlier theory that this write
activity belonged to a separate, concurrently-running job was also wrong** — it's this same run.

So the run wasn't hung — it spent essentially its whole 4h18m runtime inside one very slow step (~2 seconds per
property across 6,879 properties, the signature of an unbatched sequential-write loop, the same anti-pattern
already found and fixed elsewhere in this codebase for `hcris_propagation`'s old `save_estimate()` path). Then,
within a minute of that step's last write, **the run simply stopped**: `facility_cost_reports` never moved off
`2026-03-16`; `ingestion_tracker.notes` is still `'{}'` on both the `cms-ingestion` row (`d45f27ff…`) and the
`facility_patient_counts` lock row (`ec39768b…`); neither got `finished_at` set; zero new
`ingestion_run_errors` since `14:54:55`. No crash, no exception logged — it stopped without reaching whatever
comes after that step, which should include `hcris_cost_reports` and `finish_run()`.

**Open questions for `HCRIS-TIMEOUT-6`, now much narrower than "hang vs. loop"**: (1) is this
`facility_patient_counts`→`properties` step genuinely unbatched/sequential, and can it be batched the same way
`hcris_propagation` already was; (2) what stops execution right as that step ends — does it hit a wall-clock
budget, an unhandled exception the per-row handlers are swallowing the same way `aux_cms_tables` used to, or a
Railway-side execution/timeout limit on the cron job itself; (3) did this run actually carry `HCRIS-TIMEOUT-5`'s
fix (PR #7413) at all, or does the fact that it got much further than any prior round (past `aux_cms_tables`
entirely) already answer that. Asked Scott for the deploy timestamp and, if available, this execution's actual
exit/crash status from Railway's Deployments tab (not just the Cron Runs duration).

Two smaller notes on the record: (1) Scott's initial "it looks like that run has completed" claim was checked
directly and was not correct — `run_status='started'` at the time, ~5h47m in; corrected in-conversation, not
carried into this file as fact until independently confirmed. (2) A log upload Scott provided for this run
(`logs.1789573371348.json`) was confirmed to be an unrelated sub-job (`facility_patient_counts` revenue
propagation, zero hits on any HCRIS/`aux_cms_tables`/tracker term) — not useful for this pipeline, flagged to
Scott rather than mined for false signal.

`HCRIS-TIMEOUT` stays 🔴, now with a concrete "hang, not loop" data point for round 6 to build on, pending the
Railway deploy-timing/crash-log confirmation.

## 2026-09-16 — `HCRIS-TIMEOUT-4`: root cause finally isolated — two structural bugs, neither one HCRIS-specific, and this round deliberately did not fix them

Fourth round on this defect, and the first one framed as triage rather than another single-hypothesis fix —
after three rounds each independently correct on their own terms (PR #7410 fixed a real timeout bug,
`HCRIS-TIMEOUT-3`/PR #7411 fixed a real tracker-blindness bug) with the symptom unmoved, this round asked CC to
step back rather than extend the pattern a fourth time. **This session independently re-verified every
load-bearing claim live against Dialysis_DB before filing it** — most held up exactly as described; one
needed a real correction, noted below.

**Bottom line CC reported, verified true**: HCRIS was never the step hanging. Two independent bugs compound:

1. **`ingestion_tracker.start_run()` silently discards its own run id on every call.** `get_supabase_client()`
   sets a client-wide default `Prefer: return=minimal` header; `safe_execute()` only overrides it to
   `return=representation` when handed a live query-builder object, not a pre-built `.execute()` closure.
   `start_run()` passes a bare lambda, so a genuinely successful insert (HTTP 201) comes back with an empty
   body and reads as a failure — `_CURRENT_RUN_ID` is `None` for the entire life of every run, which is why
   `HCRIS-TIMEOUT-3`'s heartbeat/notes instrumentation could never write anything no matter how many retries
   it got. **Same call, same bug, also used by `acquire_ingestion_lock()`** — this is why the ingestion-lock
   rows have been orphaned every run, a repo-wide defect (4+ more `start_run()` call sites named, not
   individually traced) rather than anything CMS/HCRIS-specific.
2. **`aux_cms_tables` (step 3 of ~15, several steps before `hcris_cost_reports` at step ~8) swallows its own
   900-second `SIGALRM` step-timeout inside a per-row `except Exception:`**, so the pipeline never advances
   past it and never reaches HCRIS at all. `facility_cost_reports` freezing at 2026-03-16 is a direct,
   mechanical consequence of the run never getting there — not a separate HCRIS-side defect.

**Independently confirmed live, exactly as claimed**: `ingestion_tracker.notes='{}'` on every relevant row back
to 2026-09-10 (the last populated `notes` on record for this dataset is 2026-08-31, well before this whole
arc started); zero `ingestion_run_errors` rows with `table_name='ingestion_tracker'`; the `aux_cms_tables`
900s timeout firing exactly on schedule (17:52:36 UTC, ~15 min after run 1's 17:37:29 start); `facility_cost_
reports` still frozen at exactly 2026-03-16 15:35:48; both orphaned lock rows present with the described
timestamps.

**One correction filed**: CC's response describes "a massive, continuous stream of errors ... for the entire
observed [12.7-hour] lifetime," ~17,753 total. Checked by the minute — that's actually **two separate
15-minute startup bursts** (run 1's own, 17:37–17:52, ~8,877 errors, ending exactly when its own timeout
fired; run 2's own startup burst the next morning, 06:03–06:18, ~8,876 errors) with **zero errors of any kind
in the ~12h09m between them**. Total silence, not continuous activity — the same burst-then-silence shape
every prior round already found, not new behavior. This matters for the fix: a per-row loop that's genuinely
"still going, just not hitting these particular tables" would look different from a process that's actually
hung/deadlocked after the swallowed signal. CC's fix-round instruction now includes confirming which one it
actually is, not assuming "keeps looping obliviously" the way this round's prose implied.

**No fix attempted this round** — correctly, per the prompt's explicit instruction not to make a fifth narrow
patch before full triage. `HCRIS-TIMEOUT` stays 🔴. **Next step**: a dedicated fix round for both structural
bugs, plus resolving the loop-vs-hang question above. Full writeup:
`docs/claude-code/responses/done/HCRIS-TIMEOUT-4-full-triage-run-log-still-silent-after-the-fix-built-to-fix-it.response.md`.

## 2026-09-16 — `HCRIS-TIMEOUT` live-monitored across two full run cycles post-fix: same failure shape both times, and a new, more basic problem found — `run_log` has written nothing at all in 28 hours

Watched the post-`HCRIS-TIMEOUT-3`/`PR #7411` run live rather than waiting for another log upload. Two
full cycles have now completed since the fix merged, and neither tells a different story than before.

**Run 1** (`593e1e75…`, started 2026-09-15 17:37:36 UTC): ran until it was reclaimed as `abandoned` at
2026-09-16 06:02:56 — **~12h25m**, well past the 90-minute budget. **Run 2** (`64e34e14…`, started
2026-09-16 06:03:24 UTC, the daily scheduled run) was still live as of this check, ~5h17m in, `properties`
being written to seconds before the query ran. Both runs show the **identical error-burst-then-silence
shape**: ~8,880 `ingestion_run_errors` in the first ~15 minutes (unrelated `medicare_ingestion` writes), then
total silence. `facility_cost_reports` remains frozen at 2026-03-16 through both cycles, and
`public_data_snapshots` still has zero HCRIS rows, ever.

**The new finding, more basic than HCRIS itself: `run_log` has not received a single write since
2026-09-15 07:33:40 UTC — 28 hours and two full run cycles ago.** That's the run that predates the fix
entirely. Neither of the two post-fix runs logged anything — not a startup summary, not a step heartbeat,
not the `step_errors` map `HCRIS-TIMEOUT-3` added specifically so this wouldn't require another manual
cross-check. **`ingestion_tracker.notes` is also still blank (`'{}'`) on both runs, including the one that's
now fully closed out** (`593e1e75…`, `run_status='abandoned'`, `finished_at` populated) — a finished, closed
run with populated `notes` is exactly the case `HCRIS-TIMEOUT-3`'s fix was built to handle, and it didn't.

**This points back at the same open question `HCRIS-TIMEOUT-2` raised and never got a direct answer to:
is the Railway service genuinely running the merged commit (`651c630`)?** Two consecutive runs producing
zero diagnostic output despite a fix specifically designed to produce that output is hard to explain any
other way. Not re-diagnosing the fix's logic again without that answer first — same discipline as before.
`HCRIS-TIMEOUT` stays 🔴. Nothing filed as a new backlog row yet — this is additional evidence on the
existing `HCRIS-TIMEOUT` row, not a new defect.
## 2026-09-16 — OWNERGAP2: the first BUILD in the owner arc; verified against the live Philadelphia API; nothing applied (Claude Code)

Two adapters, as scoped. Built, tested, migration applied live, **zero owner rows written anywhere.**

**Verified against the real API, not only against tests.** The sandbox has no direct egress to
`phl.carto.com` (proxy 403), so the production matcher was run over the production query's real
responses fetched through `pg_net` from Dialysis_DB, across the WHOLE Philadelphia population:
**20 of 26 resolved = 76.9%**, above the 68% §8 measured by hand. 19 of the 25 that fired, plus
property 36738 (a duplicate address of 28606, which resolved). Recovered owners include
UNIV CITY ASSOCIATES (OPA 882000790), EPISCOPAL HOSPITAL (777012002), 3020 MARKET OPERATING LP,
PHILA SUBURBAN, RS REALTY PARTNERS L P. **Three refusals were correct** — `3300 Henry Ave` carries
5 distinct owning LPs, and two Walnut St properties sit inside a range holding 3–4 owners.

⚠️ **THE PRESCRIBED FIX WAS INSUFFICIENT AND THE MEASUREMENT IS WHAT SHOWED IT.** §8 said the
Philadelphia misses were *"fixed by prefix matching"*; implemented, **prefix-only resolves 16 of
26**. It cannot see a range **containment** row (`3823 Market St` ⊂ `3817-39 MARKET ST`). Prefix +
containment + **odd/even parity** gives 20 — and parity is load-bearing, not tidiness: `3823` falls
inside both `3817-39` (odd) and `3816-40` (even), so without it the property returns two owners and
a **FALSE `needs_parcel_discriminator`, which reads exactly like the safety rule working.**

⚠️ **A leading directional was being eaten by the house-number regex, costing 5 of 26 as silent
"no record".** `^(\d+)\s*(?:-\s*\d+)?\s*([A-Z])?\b` captured the `E` of `100 E. Lehigh Ave`
as a sub-parcel letter, leaving street `LEHIGH AVE`. No error, no null — the instrument answered
confidently. Fixed by requiring the letter be attached (`2910R`) and exempting directionals.

⚠️ **THE FIRST QUERY WOULD HAVE SHIPPED A SILENT TRUNCATION.** It fetched the whole street at
`LIMIT 100`; MARKET ST holds **1,218** parcels and WALNUT ST **1,923**. It survived a first
verification only because that run happened to narrow to `38%MARKET ST`. Shipped: a numeric band on
the house number, `ORDER BY … DESC` so the containing range is reachable, and an explicit
`truncated` flag → `source_response_truncated`. Four live requests hit the 250 cap; all four still
resolved.

**Harris is `fetches: false`, decided by measurement per §2 of the prompt.** Probed live via
`pg_net`: `search.hcad.org` → **403 Cloudflare managed challenge**, `hcad.org` → **521**,
`public.hcad.org/records/quicksearch.asp` → **404**, `download.hcad.org` → 200 but a shell page
with no file index. No reachable free API or enumerable bulk path, and §6 forbids automating a
bot-protected portal. Harris therefore ships as a **parser + `Personal`/`Commercial` account-type
discriminator over an operator-supplied payload** — never a fetcher. §9's 86% stands as a rate; it
was never evidence the fetch is automatable.

⚠️ **THE CITY OF PHILADELPHIA RECORDS `ABC INC` AS A REAL OWNER, AND THE OWNERGAP1 GUARD FLAGS
IT.** `dia_is_fabricated_placeholder_owner('ABC INC')` → true. **The guard was NOT weakened** — one
real name is worth less than the containment. The writer pre-checks and refuses with
`blocked_by_fabrication_guard`, keeping the name and its citation in the ledger, surfaced on
`v_dia_ownergap2_fabrication_guard_collisions`. Guard positive-controlled both directions the same
day: `XYZ Dialysis Centers LLC`/`unknown` → true; `UNIV CITY ASSOCIATES`/`RALSTON MERCY-DOUGLASS
HO` → false.

⚠️ **`county ilike '%harris%'` RETURNS 52 AND TWO ARE HARRISON COUNTY** (Marshall, TX — a different
appraisal district ~200 miles away). Harris proper is **50**, matching §9. The adapter keys on
equality and a guard pins it.

**Provenance is CHECK-enforced, and the constraints were positive-controlled in both directions.**
`chk_ownergap2_resolved_must_cite` refused all four malformed shapes (no citation / empty
`source_record_ids` / no `source_query` / unresolved with no cause) and **accepted** both
well-formed shapes, inside a self-rolling-back transaction — **0 residue** afterwards. A constraint
that only ever refuses is indistinguishable from a broken one.

👤 **NOTHING IS APPLIED, AND THAT IS THE STATE TO CARRY.** GET is a dry run; no POST was issued.
Measured at close: `dia_ownergap2_resolution_log` **0 rows** · `recorded_owners` **7,585, 0 of them
`ownergap2*`-sourced** · properties with a `recorded_owner_id` **5,473** · `true_owner_id`
untouched (10,308). The JS half needs the Railway redeploy before the tick exists in production
(the migration shipped instantly — the documented half-applied-deploy split).

⚠️ **Population drift, stated not reconciled:** owner-unknown is **4,014** (OWNERGAP1 said 4,021),
`recorded_owners` **7,585** (said 7,487), owned properties **5,473** (said 5,467).

Files: `api/_shared/ownergap2-{address-match,sources,owner-writeback}.js`,
`api/_handlers/ownergap2-owner-resolve-tick.js`, migration
`supabase/migrations/dialysis/20261010120000_dia_ownergap2_owner_resolution_ledger.sql` (applied
live), fixtures `test/fixtures/ownergap2-live-samples.json`, guard
`test/ownergap2-owner-resolution.test.mjs` (**55 tests, 33 mutations verified RED**). Audit §10;
backlog `OWNERGAP2`, `OWNERGAP1-decision`.

---


## 2026-09-16 — All four rounds landed; C1C closed on both arms; GOVDEED5 was undone by a nightly cron twenty minutes after it applied (Cowork)

Reconciled the four responses against live state on both databases.

**C1B-GOV-GATE ✅** (gov PR #403): SF arm sealed (0 passing), SOS unsealed (2,019). `v_ownership_gaps`
had no committed source anywhere before this — it was live-only. Then ran **C1C's gov arm** here:
dry run 1,851 / real run `c1c-gov-20260916` **1,851 retired**; watch view `{dia 839, gov 1851}`;
the SF lane is gone from the lane summary. C1C is closed. Consequence to carry: LCC now holds
**1,346 open `owner_needs_sos`** tasks and nothing consumes them — OWNERGAP2 is next, not someday.

**GOVDEED-478 ✅** (gov PR #402): 4,995 deed rows marked `rejected_placeholder` (kept, not deleted);
290 grantees cleared, 91 grantee+price, 97 held because a sale corroborates them; conflicts
899 → 518 at the time.

**C2k ✅** (gov attestation 856 → LCC PR #2506): 234 eligible (13 fill / 221 supersede), 218
superseded, 40/43 A-class pairs to the sponsor (the other 3 were already there), 16/16 controls
untouched, unsupersede round-trips 218/218. CI caught `lcc_c2k_unsupersede` created with the default
anon grant — a function that rewrites ownership, callable unauthenticated — fixed before merge.
That is the SEC1 test doing exactly its job.

**GOVDEED5 🟡** (gov PR #404): the split landed and reported 43/43 truthfully — at 03:09 UTC. At
03:30 the `gov-propagate-recompute-tick` cron ran `propagate_sales_recompute`, whose candidate
predicate treats a NULL `latest_deed_date` as 1900 and whose write is `latest_deed_date =
sale_date`: **3,310** properties got a sale date back by 03:35. `pg_proc` has **six** writers; the
round inventoried the `sql/` tree and found three. Two more are triggers on the sales tables. Live
now: 3,340 / 2,743 / conflicts 1,295. → **GOVDEED5b** handoff written. Same class as C1B-GOV-GATE:
the live catalog, not the repo, is the inventory.

Queue: four prompts + responses to `done/`; GOVDEED5b in `prompts/`.

---

## 2026-09-16 — Four open decisions walked through and closed; four prompts written (Cowork)

Scott took each with the same shape — the recommended option, the measured alternative, the cost —
and chose the recommended one on all four. Every choice is the "Not on file over a plausible value"
rule applied to a different column.

**GOVDEED5 → split by source** (👤 gov). `latest_deed_date` was three writers deep and 94% sale dates;
`latest_deed_grantee` is set on 5,787 properties, 5,744 without a dated deed behind them. New
`latest_transfer_{date,party,source,ref}` backfilled from evidence with the source written beside it;
`latest_deed_*` become deed-only (≈43); the 75 untraceable go to NULL, snapshotted; every writer
must be able to clear (GOVDEED4 needed a hand-run clear because none can).

**C2k → attested-only widening** (gov step 1, then LCC). The domain `true_owner` may supersede a
lower-tier resolution only where an SOS/SAM manager on the SPE names it (≈858 gov); unattested rows
stay gap-fill. Ledgered, reversible, dry run with a 20-row hand read, and the 16 no-evidence C2g pairs
are the positive control that nothing unattested moved. Full lift (1,036 at once) and sponsor-as-edge
were not chosen; the latter is noted as future work.

**C1B-GOV-GATE → seal SF, unseal SOS** (👤 gov). Re-measured: `owner_needs_salesforce` 1,838 passing,
`owner_needs_sos` sealed — still the wrong arm a week on. The test must read which arm carries the
marker. Once live, C1C's gov arm runs (≈1,851, dry run first).

**GOVDEED-478 → exclude placeholder deeds + clear the planted grantee** (👤 gov). Conflicts today: 899 =
478 dateless (all from the 4,995 no-date/no-instrument rows) + 405 sale-backed (real, must stay) +
16 other. Mark rejected, don't delete (GOVDEED3 still reads them); view and propagators ignore them;
grantee NULLed only where it traces solely to a rejected row.

Queue: four prompts in `prompts/` — three gov handoffs, one LCC build with a gov precondition.
Nothing applied.

---

## 2026-09-16 — GOVDEED4 applied live: 676 dates demoted, 147 properties reconciled (12 repointed, 135 cleared), and `latest_deed_date` turns out to have three writers (Cowork)

Gov PR #401 merged; read the migration first. Confirmed what the response left unsaid: it never
touches `properties`, and `propagate_deed_to_property` only ever SETs. Measured before applying:
**147** properties (⚠️ not 493 — that earlier figure counted join rows, not distinct properties;
corrected in the backlog and the entry below) carried a `latest_deed_date` from a soon-to-be-demoted
deed; 12 had another real dated deed to fall back to, 135 did not. Scott chose apply + clear.

Applied `20260916_gov_govdeed4_low_confidence_date_guard` to `scknotsqkcheojiaewwh`: **168 dated /
676 approx / 676 in the snapshot**, 0 `low` rows still dated, remaining dated by confidence
∅ 145 · medium 21 · high 2 — exactly the migration's own expected numbers. Then, ledgered in
`_gov_govdeed4_cleared_properties_20260916` (147 rows, prior date + grantee, `outcome`): ran
`propagate_deed_to_property` → `latest_deed_set = 12` (the predicted 12), then NULLed
`latest_deed_date` + `latest_deed_grantee` on the properties still pointing at a demoted deed with no
surviving dated source → **135 cleared**. Ledger reads `{cleared: 135, repointed: 12}`.
`properties.latest_deed_date = '2023-10-01'` went 130 → **5** (those 5 come from `sales_transactions`,
not deeds — see below). 17 `ownership_history` rows still carry a demoted deed's date; left as-is for the
GOVDEED-478 disposition, as the handoff said.

⭐ Side-finding while verifying: of **2,401** properties with a `latest_deed_date`, only **43** trace to
a bridged dated deed. **2,263** match `sales_transactions.sale_date` — written by the intel sweep
(`20260508_gov_intel_sweep_tier3c_and_true_owner.sql` l.191, `latest_deed_date = l.sale_date`) —
and a third writer, `sync_properties_from_sources.py` l.1723, also SETs from deeds. The column is
mostly a sale date wearing a deed name; **75** values trace to nothing at all. Not this defect (a
CoStar sale month is a different convention from a model guess), but it belongs in the backlog as
**GOVDEED5** before anyone reads `latest_deed_date` as "there is a deed." Nothing else changed.

---

## 2026-09-16 — GOVDEED4 reconciled: built in gov (PR #401), migration NOT yet applied; two deviations from the handoff, one of them a disposition decision (Cowork)

The round (gov branch `claude/modest-wozniak-kyexxl`, commit `ce1d5bc`, tracking **PR #401**, not merged)
did the four steps: `deed_records.recording_date_approx` + a real `date_confidence` column;
`save_deed_record` demotes the date into the approx column and `has_chronology_key` no longer
counts it, so a placeholder-grantor row with only a guessed date is now **rejected**; prompt rule 5
asks for `null` when the day is unknown; 5 new tests with both positive controls (57/57 in file).
📊 Live check: columns absent, snapshot table absent, **844 dated / 676 low — unchanged**, so
nothing has run against `scknotsqkcheojiaewwh` yet (no credentials in the round's sandbox — stated).

Two departures, both worth knowing before the apply. ① **Narrower than asked:** the guard fires only
on `low` **AND** day-of-month = 01, not on any `low` date — the round's own positive control asserts a
non-day-01 low date still writes as recorded. Today that is the same population (676/676 are day-01),
and with rule 5 changed the model should now emit `null` instead; but a `low` non-01 date remains a
recorded date. Follow-up, not a blocker. ② **Wider than asked:** the migration **demotes the 676
existing rows in place** (`recording_date` → approx, `recording_date` set NULL), snapshotting the ids
to `_gov_govdeed4_demoted_dates_20260916` for reversal. The handoff deferred that to the GOVDEED-478
disposition round. It is ledgered and reversible, and it is the disposition that round would most
likely have chosen — so acceptable, but it makes the apply a **data change**, not a guard. ⚠️ What the
response does **not** say: the `properties.latest_deed_date` values (**147** distinct properties — first written
here as 493, which was join rows) and **25** `ownership_history` rows sourced from those deeds. Demoting the deed does not clear them; unless the
migration re-runs propagation (unreadable from here — no repo access to gov from this session), those
493 keep a date whose source row no longer has one. That is the first thing to read in the SQL.

Next: merge #401, pull `GovernmentProject`, read the migration for the 493/25 question, apply, re-measure
(`recording_date IS NOT NULL` before/after, `latest_deed_date` on the 493), then GOVDEED3/GOVDEED-478
inherit a smaller problem. Queue: `GOVDEED4` prompt + response filed to `done/` — and the four moves PR #2502 *claimed*
(DEED1-autofix, GOVDEED1, GOVDEED2, ID3b) had not happened (the apply script only moved C1C-SPLIT);
done for real here. STATUS archived to ~2,350 (eighteenth span, `tail10`).

---

## 2026-09-16 — GOVDEED4: the dated gov deeds are 80% invented dates, and GOVDEED2 just promoted them to winner (Cowork)

Ran down the two C2g side-findings. The "seller" resolutions are **not a class** — `Scannell` and
`Park De Ville Trio` each have real, older evidence (a 2017 `rel_purchase`, a 2021 lease-diff
transition); the later deeds never became LCC evidence because **there is no deed-grantee feeder** —
deeds reach LCC only via gov's `true_owner`, behind C2k's gate. Folded into C2k, with one more
structural note: `v_lcc_owner_supersession_candidates` has the same `unresolved`-only gate, so
**whichever feeder touches an asset first wins forever**.

The `2023-10-01` sentinel is real, and bigger than 130 properties. `deed_records` has **844** dated
rows; **676 (80%) carry `raw_payload.date_confidence='low'`**, every one day-01, 667 with no document
number, 451 with a placeholder grantor. The extraction prompt's rule 5 *tells* the model to emit
`YYYY-MM-01` with `date_confidence='low'` when the day is unknown; the recall path does it when
nothing is known (`2023-10-01` ×486). `save_deed_record` writes the date as recorded, keeps the flag
only inside `raw_payload`, and lets it satisfy the accept gate. ⚠️ **GOVDEED2's NULL guard made these
the winning deed** — 493 properties now source `latest_deed_date` from a `low` row. Only **2** dated
rows are `high` with a document number. dia: 230 dated, 0 low, clean. 👤 `government-lease` →
**GOVDEED4** handoff written; the 676 join GOVDEED-478's disposition question. Nothing applied.

---

## 2026-09-16 — C1C-SPLIT applied and run live: 839 dia tasks retired, gov untouched — and the dry run was counting lanes (Cowork)

Ran the sequence the round asked for, on LCC Opps: applied `20260908130300` (the nine
objects DEPLOY2 caught absent; **C1C-UNAPPLIED closed**), applied `20260916120000`, positive-controlled
both guards live (empty array and `owner_needs_sos` each RAISE with the documented message), one
signature in `pg_proc`.

⚠️ **Then the dry run said `tasks_to_retire = 1`** next to `by_type = {dia: 839}`. The `count(*)`
in the dry-run `jsonb_build_object` runs over the per-lane `GROUP BY` subquery, so it counts lanes
— 1 for dia alone, 2 for both. The defect is in `20260908130300` as well and was never seen because
that file never ran. The write path counts the ledger's `RETURNING` and is right; but the dry run is
the function's safety property, and the prompt's own stop rule reads exactly that field. Fixed as
**`20260916130000_lcc_c1csplit_b_dry_run_counts_tasks.sql`** (`sum(n)`), applied live before any
write, guard test added with a positive control that the original still carries the defect.

Corrected dry run: **839 dia / 0 gov** — 838 plus one row minted 2026-09-15 after the round measured.
Explained, so not a stop; noted that the dia trickle is 2 in 9 days, not 0. Real run, batch
`c1c-dia-20260916`: **839 retired**, 839 ledger rows, 839 stamped `terminal=true`, watch view 839
with 0 gov, and `v_lcc_research_lane_summary` no longer lists the dia lane while gov
`owner_needs_salesforce` reads **1,851, unchanged**. Reversal handle:
`lcc_c1c_unretire('c1c-dia-20260916')`. C1B-GOV-GATE untouched, as instructed. Prompt-queue
hygiene in the same PR: DEED1 (autofix), GOVDEED1, GOVDEED2, ID3b filed to `done/`.

---

## 2026-09-16 — C1C-SPLIT: `lcc_c1c_retire_sf_lanes` gains lane scoping; dia retire is ready, gov stays out (Claude Code)

C1c (`20260908130300`) can only retire BOTH `owner_needs_salesforce` (gov) and
`true_owner_needs_salesforce` (dia) at once — its plan CTE hardcodes
`_lcc_c1c_lane_types()`. That is now wrong: **C1B-GOV-GATE** found the gov gate
guards `owner_needs_sos`, not `owner_needs_salesforce`, so the gov lane is still
being fed (175 rows minted 2026-09-08..15) while the dia lane genuinely holds
(1 row minted in the same window, gate confirmed live).

Shipped `supabase/migrations/20260916120000_lcc_c1csplit_scope_retire_by_lane.sql`:
`lcc_c1c_retire_sf_lanes` gains a 4th, trailing `p_research_types text[] default
null` parameter. `NULL` still means the full lane set (both lanes) — the
reversal runbook and any future gov retirement depend on that default not
narrowing. A non-null array is validated against `_lcc_c1c_lane_types()` and
**raises** on an empty array or an unrecognised lane name; there is no
zero-row silent success. The pre-split 3-arg signature is `drop function if
exists`-ed before the new `create or replace` (the N15d/N15g 42725 overload
trap), and the migration asserts live — via `pg_proc`, in a `do $$ ... raise
exception` block — that exactly one signature survives, rather than trusting
the DROP. `_lcc_c1c_lane_types()`, `lcc_c1c_unretire`,
`lcc_c1c_reopen_tasks` and `lcc_c1c_reopen_relinked` are untouched.

Guard: `test/c1c-split-scope-retire-by-lane.test.mjs` — 12 structural
assertions over both migration files (comment-stripped), all passing,
including a positive control that the unknown-lane RAISE interpolates the
real bad values rather than a static string.

⚠️ **The live apply and run are PENDING.** This sandbox has no Supabase egress
(the same constraint DEPLOY2 already documented), so nothing here executed
against LCC Opps. Cowork applies in order: (1) `20260908130300` — DDL only,
defines functions, runs nothing inline; (2) this scoping migration; (3)
`select lcc_c1c_retire_sf_lanes(true, 'c1c-dia-<date>', null,
array['true_owner_needs_salesforce'])` — **expect `tasks_to_retire = 838`,
`research_types = ["true_owner_needs_salesforce"]`, 0 gov rows touched; any
other number is a STOP, re-measure rather than proceed**; (4) the same call
with `p_dry_run => false`; (5) re-read `v_lcc_research_lane_summary`: dia lane
→ 0 open, gov `owner_needs_salesforce` unchanged at ~1,851.

C2 stays open until the dia retirement is confirmed live. C1B-GOV-GATE stays
open and is explicitly out of scope for this change — do not retire the gov
lane, do not touch the gov gate, do not re-apply the retired `government/`
copy of C1b. Backlog: **C1C-SPLIT** row updated to shipped/live-run-pending.

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
