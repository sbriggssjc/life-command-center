# STATUS archive — Claude Code queue, 2026-09-12 (fourteenth span)

Moved **verbatim** from `docs/claude-code/STATUS.md` on 2026-09-16 to keep that file under its
3,000-line budget. Nothing was reworded or dropped; every still-open item named here is tracked in
`docs/os/PLANNED-BACKLOG.md`, which is the canonical open-work list.

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
