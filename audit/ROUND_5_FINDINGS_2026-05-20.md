# LCC Round 5 Audit — Findings (2026-05-20)

Scope: (1) live LCC app UI/interaction review (code + live drive), (2) end-to-end
data-flow / connectivity trace across the 3 DBs — is all data ingested, propagating,
and flowing where intended? Mode: **fix-as-I-go**.

Projects: LCC Opps `xengecqvemvfknjvbvrq` · Dialysis_DB `zqzrriwuavgrquhisnoa` ·
government `scknotsqkcheojiaewwh`.

---

## Part 1 — Data-flow / connectivity trace

### Freshness map (who's writing, and when)

**✅ Real-time sources — flowing today (LCC Opps `field_provenance`):**
| Source | writes/24h | last write |
|---|---|---|
| costar_sidebar | 12,642 | today 18:46 |
| rca_sidebar | 10,381 | today 18:46 |
| salesforce | 19,302 | today 12:52 |
| om_extraction | 930 | today 18:22 |
| auto_link_orphan / exact_singleton | ~38 | today 17:25 ✅ (unblocked by R4-1) |

**✅ dia domain tables** — all written today (ingestion_log); npi_registry 4.7d
(matches its weekly cadence). **gov GSA leases** — 7,495 rows, May 1 snapshot,
updated May 5 → **current** (uses a path not named in ingestion_tracker; not stale).

**✅ Propagation is active** — gov `sync_properties_from_sources` upserted 50,123
rows 2.3d ago; LCC cross-domain-match / merge-log-reconcile / entity-hub crons all
healthy (R4); dia auto-link unblocked (R4-1) + auto-merge fixed (R4-2b).

### Flags (non-acute — mostly external batch cadence or usage, run from Scott's workstation)

- **R5-1 [CLOSED — benign] — `crexi_sidebar` capture silent 13.7 days** (last May 7).
  Confirmed with Scott 2026-05-20: he simply hadn't been in CREXi since May 7. He then
  captured a fresh CREXi listing (`5820 Road 68, Pasco, WA 99301`) which landed
  correctly — visible in the live app's INBOX panel as `OM: crexi-5820-Road-68-…`
  tagged `sidebar_om`, Today. **Capture path is healthy; the gap was usage, not a bug.**
- **R5-2 [REVIEW] — SAM.gov lease opportunities ingest = `partial`, 0 rows** (last
  run May 18). `sam_lease_opportunities` may not be refreshing — check the SAM.gov
  API key / quota in `ingest_sam_opportunities.py`. (Workstation script, not a cron.)
- **R5-4 [LOW] — OPM workforce + USAJOBS 64 days stale** (March snapshots). These
  feed `opm_headcount` / hiring-signal property fields; ~2 months old. OPM publishes
  periodically — a refresh run may be due. (Workstation scripts.)
- **R5-note — `propagation_worker.py` 41d idle** — appears superseded by the active
  `sync_properties_from_sources` (2.3d, 50k upserts); confirm it's deprecated, not
  silently broken.

None of these are DB-fixable by the assistant (they're external batch ingests run
from your workstation / a usage question), so they're flagged for you rather than
auto-remediated. The real-time pipeline and propagation are healthy.

---

## Part 2 — Live LCC app UI / interaction review

App is a vanilla-JS SPA at repo root (`index.html` + `app.js`, `gov.js`,
`dialysis.js`, `detail.js`, `contacts-ui.js`, `capital-markets.js`, `treasury.js`,
`ops.js`, …). Prior audit `APP_AUDIT_REMAINING_ISSUES.md` (Mar 2026) had most issues
resolved; 5 open are data-enrichment (gov leases missing address/city; gov entity
dedup; 1,050 flagged-email count; dia operator-name normalization; 42% Unknown
agency). Cleanliness: stray `app.js.restored`, `dialysis.js.backup`, `gov.js.backup`.

### Frontend↔API wiring (code review) — TWO broken routes found, both CONFIRMED LIVE

The catch-all rewrite is identity (`/api/(.*)` → `/api/$1`), so any frontend route
with no specific `vercel.json` rewrite + no `api/*.js` file resolves to a missing
file → **404**. Two such orphans are actively called. **Both confirmed as live 404s
2026-05-20** via direct in-browser probes (deployed `detail.js` still has 11
`data-query` refs / 0 `data-proxy`; deployed `gov.js` still builds `data-proxy`):

| Probe (GET) | Result |
|---|---|
| `/api/data-proxy?_route=gov-write` | **404** (dead) |
| `/api/gov-write` | 405 (route exists, POST-only) ✅ |
| `/api/data-query?_source=gov` | **404** (dead) |
| `/api/admin?_route=edge-data&_source=gov` | 200 (correct destination) ✅ |

- **R5-FE-1 [HIGH — confirmed broken, FIXED locally] — `gov.js` gov-write → dead route.**
  `govWriteService()` (gov.js:138) built `/api/data-proxy?_route=gov-write`; `data-proxy`
  was absorbed into admin.js and has NO rewrite/file. Powers the gov write endpoints
  `ownership`, `lead-research`, `financial`, `resolve-pending` — all 404'd from the UI.
  **Fix applied:** gov.js now builds `/api/gov-write?endpoint=…` (vercel.json line 16
  already rewrites that to `admin?_route=edge-data&_edgeRoute=gov-write`); dropped the
  stale `_route=gov-write` param. **Pending Vercel deploy.**
- **R5-FE-2 [HIGH — confirmed broken, FIXED locally] — `detail.js` `/api/data-query` (11 calls) → 404.**
  Contact/ownership lookups + the inline Add-Contact writer call `/api/data-query?_source=gov|dia…`;
  no `data-query` rewrite existed. Verified all 11 calls carry their own `_source`
  (gov or dia), so a single rewrite that does NOT bake `_source` covers them all.
  **Fix applied:** added `{"source":"/api/data-query","destination":"/api/admin?_route=edge-data"}`
  to vercel.json (after the dia-query line). **Pending Vercel deploy.**

**Both fixes change the live deployed app (vercel.json + gov.js → Vercel deploy).**
Scott approved commit+push 2026-05-20. **Deploy handed back to Scott:** the assistant's
sandbox cannot complete git writes — a stale `.git/index.lock` (and `maintenance.lock`)
on the Windows-mounted `.git` can't be unlinked from the Linux sandbox (`Operation not
permitted`). Also discovered the working tree is heavily diverged (747 changed tracked
files; both `gov.js` and `vercel.json` were **truncated mid-file on disk** — CRLF/WIP
churn, not the assistant's edits). To avoid shipping the truncated copies, the assistant
**restored both files from HEAD (= origin/main, 0 ahead/0 behind) and re-applied only the
two surgical changes** — so the on-disk `gov.js` (9,744 lines, complete) and `vercel.json`
(valid JSON) now contain exactly the fixes and nothing else. Commands for Scott to run in
the VS Code terminal:
```
cd C:\Users\scott\life-command-center
del .git\index.lock        # clear the stale lock (PowerShell: Remove-Item .git\index.lock)
git add gov.js vercel.json
git commit -m "Round 5 (R5-FE-1/FE-2): fix two dead frontend API routes (gov-write, data-query)"
git push origin main       # Vercel auto-deploys
```
After deploy, re-probe: `/api/data-proxy?_route=gov-write` should now be unused; live
`/api/gov-write` (405 on GET) and `/api/data-query?_source=gov` (should flip 404→200).

**✅ VERIFIED LIVE 2026-05-20 (post-merge/deploy):** `/api/data-query?_source=gov` → **200**,
`?_source=dia` → **200** (both were 404), `/api/gov-write` → 405 (live), deployed `gov.js`
now builds `new URL('/api/gov-write')`. R5-FE-1 and R5-FE-2 are **CLOSED**.

### Live drive — completed 2026-05-20
Walked Today (dashboard) → Gov property detail (1200 New Jersey Ave SE / LDC01477) →
Pipeline (My Work) → Sync Health. Observations:
- **Dashboard healthy** — Next Best Action surfacing agency-drift items (GSA vs Passport,
  DOJ, FCC) and a $990M recorded-owner research lead; fresh CREXi capture present in INBOX.
- **Gov detail healthy** — all 7 panel loads went through `/api/gov-query` and `/api/entities`,
  every one **200**. (The `data-query` 404s in R5-FE-2 fire on contact-resolution / Add-Contact
  actions, not the tab's initial load — confirmed via direct probe instead.)
- **Pipeline / My Work** — renders clean (0 items; 25 flagged emails awaiting triage).
- **No console errors** observed across the walk.

- **R5-FE-3 [MED — new] — One Outlook connector stuck in `error`: Symbol.iterator.**
  Sync Health shows **3 registered `outlook` connectors**; *Outlook — Work (NorthMarq)*
  (`cc406fc7-…`) is `status=error` with `object is not iterable (cannot read property
  Symbol(Symbol.iterator))`, last sync 2026-05-15. The sibling *Outlook — Personal*
  (`c5a4a92c-…`) carries the note *"Round 76bi: reset after fixing Symbol.iterator bug
  in sync.js"* and is now healthy — i.e. **this exact bug was fixed once but the Work
  connector still throws it.** The Round 76bi guard exists at 3 edge-data iteration
  sites in `api/sync.js` (emails L531, events L717, activities L791) and all 3 are
  `Array.isArray()`-protected — yet the Work connector errored on **May 15, after** the
  2026-04-28 fix shipped. So either (a) the throw originates in the edge function
  (`/sync/flagged-emails`, Deno side), or (b) it's a stale recorded error that a clean
  re-sync would clear (which is exactly how the Personal connector was resolved — a
  reset). **Definitive test run 2026-05-20 (Scott approved):** clicked "Sync Now" on the
  Work connector → `POST /api/sync?action=ingest_emails` returned **503**, button reverted
  to "Sync Now", and the connector stayed `status=error` with the **unchanged** May-15
  error + timestamp. **Conclusions:** (1) this is a **live, recurring failure — not a stale
  status a reset would clear**; (2) the 503 short-circuited *before* `ingestEmails` ran its
  own error path (its catch returns **500** and would update the connector error+timestamp;
  neither happened), so the displayed "object is not iterable" is the **stale May-15
  symptom**, not this run's cause; (3) `api/sync.js` emits **no 503 anywhere**, and Vercel
  **runtime logs show nothing** for the call — so the 503 is platform-level (function
  crashed/timed out before logging) or from a shared guard. Across this codebase `503` is
  almost always *"<service/DB/credential> not configured"*. **Leading hypothesis:** the
  Work (NorthMarq) connector has a **stale/missing credential or per-connector config** (its
  OAuth token/refresh), so its sync crashes where Personal's (re-authed in 76bi) succeeds —
  i.e. a connector-credential problem, not purely a code bug. **Next steps (deferred):**
  inspect the Work connector's stored token/config row + pull the `ai-copilot/sync/
  flagged-emails` edge-function logs on the dia Supabase project for this connector;
  re-auth the Work connector if the token is expired. Note: primary flagged-email intake
  (via Power Automate) is unaffected — dashboard shows 3,591 flagged emails and OMs landing;
  this is the secondary connector-sync path, so MED severity stands.

  **ROOT-CAUSE CONFIRMED 2026-05-20 (DB evidence, `connector_accounts` + `sync_jobs` on LCC Opps):**
  - Three outlook rows: bare `outlook` (`3c7be7f6`, `direct_api`, no config, never used — vestigial),
    *Personal* (`c5a4a92c`, `power_automate`), *Work (NorthMarq)* (`cc406fc7`, `power_automate`).
  - **Personal**: 1 `failed` flagged_email job on **2026-04-28** (pre-76bi-fix), then **1 `completed`
    today (19:10) with 9,990 records** → the Round 76bi guard works; Personal is healthy.
  - **Work (NorthMarq)**: **7 jobs, all `failed`, 0 completed, 0 records ever**, `last_sync_at` is
    **NULL** (the `/api/connectors` "2026-05-15" was the last *failed-job* time, not a success).
    Identical config keys to Personal (`account, sync_calendar, sync_flagged_emails`).
  - **Therefore this is NOT the 76bi code regression** (same code succeeds for Personal). The Work
    mailbox's Graph response is a non-array (an auth/consent failure on the NorthMarq tenant is the
    leading cause — the connector has *never* synced), and the **`ai-copilot/sync/flagged-emails`
    edge function on dia (`zqzrriwuavgrquhisnoa`) lacks the `Array.isArray` guard** that sync.js
    L531 has, so it throws "object is not iterable" instead of degrading to 0 records.
  - **Two independent fixes:** (1) **Re-auth the NorthMarq work mailbox** (Scott — OAuth consent)
    *if* direct sync of work email is wanted; OR treat this row as **redundant** because work
    email already flows via the Power Automate `LCC Flagged Email Intake` flow (the OMs in the
    Inbox panel — Fresenius, DaVita — are work emails) and **deactivate/remove the row** so it
    stops failing + showing red. (2) **Harden the edge function** with the same non-array guard
    so an unauthorized/odd Graph response degrades cleanly instead of crashing — robustness fix,
    independent of the auth decision. **Decision needed from Scott: is the Work direct connector
    wanted (→ re-auth) or redundant given PA covers work email (→ disable)?**

  **RESOLUTION 2026-05-20 (Scott: "redundant — disable it" + "harden the edge fn"):**
  - ✅ **DONE — Work connector disabled.** `UPDATE connector_accounts` (id `cc406fc7…`) →
    `status='disconnected'`, `config.sync_flagged_emails=false`, `config.sync_calendar=false`,
    `last_error=NULL`, with a `disabled_reason` note in config; `account` config preserved.
    Fully reversible. Verified live: `/api/connectors` now shows the row `disconnected` with no
    error and **total connectors-in-error = 0** (was 1) — the "1 connector failing: outlook"
    banner in Sync Health is cleared. (Note: `resolveConnector` in `api/sync.js` selects outlook
    by user+workspace `limit=1` and **ignores status**, so the durable disable is the config
    `sync_*=false` flags, not status alone — both were set.)
  - ⏸ **DEFERRED (do from source, NOT a blind redeploy) — edge guard.** The
    `ai-copilot/sync/flagged-emails` handler (dia `zqzrriwuavgrquhisnoa`) should mirror
    `api/sync.js` L531: wrap the Graph response array in `Array.isArray(...)` before iterating
    (Graph returns `{ value: [...] }`; on an auth failure it returns a non-array error object →
    the unguarded `for…of` / spread throws "object is not iterable"). **Not applied this round**
    because the deployed `ai-copilot` is a single 72KB function shared by SF-sync, calendar,
    Personal email, data-query, and daily-briefing, its source is **not version-controlled in any
    mounted repo**, and it's only retrievable as a 31k-token single-line dump — so a
    modify-and-redeploy from here would be a high-blast-radius blind change with no clean source
    base or rollback. Recommend Scott locate/checkout the `ai-copilot` source, add the
    `Array.isArray` guard at the flagged-emails iteration, and `supabase functions deploy
    ai-copilot`. Now lower priority since the only known trigger (the Work connector) is disabled.
- **R5-FE-note — 3× outlook connector registrations.** Two healthy + one (Work) now
  `disconnected`. The legacy bare-label `outlook` `3c7be7f6` (`direct_api`, no config,
  never synced) is a vestigial dedup candidate — left in place this round.

---

## Part 3 — Key pipeline deep-dive (end-to-end)

### OM intake pipeline (`staged_intake_items` on LCC Opps) — ONE active gap found

Status distribution (2026-05-20): `finalized` 621 (305 in 7d, 47 today — healthy throughput),
`matched` 64 (all in 7d), `review_required` **2,666** (139 in 7d — large human-triage backlog,
by-design but worth a triage push), `discarded` 671 (none recent), `failed` **45** (39 in 7d,
5 today — investigated below).

- **R5-P-1 [HIGH — active] — Salesforce `Comp__c`-seeded OM files never get their file bytes
  staged → extraction never runs → `failed`.** All 39 recent failures are SF `Comp__c`-seeded
  intakes (28 dia + 9 gov, **25 distinct deals**) carrying `seed_data.source_content_version_id`
  + a real `file_name` (e.g. *"Fresenius Medical Care - Pittsboro - NC - OM.pdf"*). Decisive
  localization via `staged_intake_artifacts` / `staged_intake_extractions`: of the 39, **37 have
  NO artifact row and NO extraction row** (only 2 ever received a file; those 2 ran extraction and
  hit the lesser "No valid extractions"). So the break is **upstream of extraction — the OM PDF
  bytes from the Salesforce ContentVersion are never delivered/staged**; the staged item is created
  from the SF *reference* only, then marked `failed`, then retried hourly (`_retry_meta.count≥1`),
  forever failing. **No LCC `api/` code fetches SF `ContentVersion`/`VersionData`** (grep = 0
  hits), so the file must be delivered by the **Power Automate `SF -> LCC: File Discovery & Move`
  / `On-demand File`** flow (built ~2026-05-16/17, per R3-M-3d). The flow discovers the file
  (writes the reference + file_name) but fails to move the actual bytes — **same class as the
  historical `base64ToBinary` Bug E** (download VersionData base64 → must convert to binary before
  POSTing to LCC intake). **Fix lives in that PA flow** (inspect the ContentVersion download +
  the body sent to `/api/intake`): confirm it (a) downloads VersionData, (b) `base64ToBinary()`s
  it, (c) POSTs it as the artifact, and (d) doesn't create/abandon a staged item when the file
  step fails. Impact: 25 in-flight deals (Fresenius, DaVita, gov comps) are not flowing into
  dia/gov property data. **Recommend fixing the flow next.**
- **R5-P-1b [LOW] — the gov `Comp__c` variant stopped 2026-05-16** (9 items, last May 16), while
  dia continues failing daily — suggests the gov path may have been partially fixed or simply
  hasn't re-run; verify when fixing R5-P-1.

  **ROOT CAUSE CORRECTED + PARTIALLY FIXED 2026-05-20 (deep trace).** My first hypothesis (PA
  flow drops the bytes) was **wrong**. Actual architecture, end to end:
  1. **PA Flow 6/7 (`SF -> LCC: File Discovery & Move` / `Daily Bulk`) → `sf_files` + `salesforce-files`
     storage bucket: ✅ WORKS.** 92 dia files `ingestion_status='stored'`. Bytes are present in storage.
  2. **Bridge: dia cron `sf-files-extract-queued-hourly` (`15 * * * *`, active) → edge fn
     `intake-salesforce-files?action=stage-queued`.** It pulls `extraction_status='queued'` PDFs,
     downloads bytes from the bucket, base64-encodes, and POSTs to LCC `/api/intake/stage-om` with
     `artifacts.primary_document.bytes_base64` (correct contract). On success → `sf_files`
     `extraction_status='extracted'`; on failure → `extract_failed` (reason in `process_notes`).
     The hourly :15 cadence is exactly why the failed `staged_intake_items` cluster at :15.
  3. **stage-om (LCC copilot-action `intake.stage.om.v1`): the failure point.** `process_notes` on
     `extract_failed` rows shows **two classes**: `stage-om failed: HTTP 404` (2 rows, newest 01:15
     today — *before* the R5-FE-2 deploy) and `stage-om failed: copilot_action_exception` (6 rows,
     newest 18:15). The staged_intake_items I first saw (channel=email, no artifact) are stage-om's
     own stored shape after it fails — not a separate broken path.
  - **Fix #1 — ALREADY SHIPPED (R5-FE-2 route deploy).** The `HTTP 404` class was stage-om's
    internal `/api/data-query` call 404'ing — the exact bug fixed earlier today. **Verified:** a
    manual bridge re-run after the deploy moved `extracted` 40→42 and `queued` 44→41 (files that
    were failing now extract). So the 404 sub-class is resolved and the backlog now drains each
    hourly tick (~2/run; slow because each 6 MB OM's extraction is slow).
  - **Fix #2 — REMAINING (`copilot_action_exception` subset).** intake.js wraps any handler
    runtime error as `copilot_action_exception` and **hides `detail` unless `LCC_ENV=development`**;
    Vercel runtime logs are not retained/queryable for this project, so the inner error isn't
    visible remotely. To capture it: temporarily set `LCC_ENV=development` in Vercel (surfaces
    `detail` + `name`/`code` in the stage-om response, which the bridge will then write into
    `sf_files.process_notes`), re-run the bridge, read one failing row's notes, then revert. Likely
    a specific-PDF extractor edge case (pdf-parse failure / AI extraction limit) on a subset of OMs.
  - **storage_path refactor — RULED OUT (investigated 2026-05-20).** Tempting idea (file is already
    in storage) but **not viable and not the fix**: stage-om's `storage_path` branch in
    `intake-om-pipeline.js` fetches bytes from **`OPS_URL`** (LCC Opps storage), whereas the SF OMs
    live in the **dia** project's `salesforce-files` bucket — passing storage_path would point the
    extractor at the wrong project. And the inline-bytes cap is `OM_INLINE_MAX_BYTES` (~25 MB) which
    returns a clean **413 file_too_large**; these OMs are ~6 MB, far under it — so size is not the
    cause. The real `copilot_action_exception` cause is elsewhere in staging/extraction and is only
    visible once surfaced (see diagnostic below).
  - **Diagnostic landed 2026-05-20 (`error_summary`).** Added an always-on, non-sensitive
    `error_summary` (error name + 160-char message, no stack/PII) to `api/intake.js`'s
    copilot-action catch, and updated the SF-file bridge (`intake-salesforce-files` `handleStageQueued`)
    to record it in `sf_files.process_notes`. After both ship, the next hourly bridge tick writes the
    real cause into `process_notes` — no `LCC_ENV=development` toggle needed. Then apply the targeted
    fix to whatever it reveals.
  - **Secret-hygiene flag:** the `sf-files-extract-queued-hourly` cron command embeds the
    `X-PA-Webhook-Secret` in **plaintext** in `cron.job.command`. Same standing P0 class as the
    inline anon keys — move to Vault and reference it. (Did not echo the secret value anywhere.)
  - **Status:** R5-P-1 downgraded from "fully broken" to "partially fixed + draining"; the
    `copilot_action_exception` subset (a minority of OMs) is the open remainder, gated on surfacing
    the inner error (needs the `LCC_ENV=development` toggle — Scott).

  **R5-P-1 follow-ups discovered 2026-05-20 (deploy topology + an incident):**
  - **Deploy topology — Vercel + TWO Railway services.** The LCC app runs on Vercel
    (`life-command-center-nine.vercel.app`, what Scott's browser uses) AND Railway (project
    "handsome-luck": services `life-command-center` → `life-command-center-production.up.railway.app`
    and `tranquil-delight` → `tranquil-delight-production-633f.up.railway.app`). The Supabase edge
    functions / PA flows target **Railway `tranquil-delight`** via `LCC_BASE_URL`. Railway runs a
    custom `server.js` (Express) that **mirrors `vercel.json` rewrites as routes** — and the two
    drifted: R5-FE-2 added `/api/data-query` to `vercel.json` only, so on Railway `/api/data-query`
    falls through to the SPA catch-all and returns **HTML 200** (confirmed by server-to-server probe).
    **server.js must get the same route** — `app.all('/api/data-query', (req,res)=>{ req.query._route='edge-data'; adminHandler(req,res); });` after the dia-query line. Going forward, `vercel.json`
    and `server.js` are a PAIRED change. (Railway does deploy from git — its `gov.js` carried the
    R5-FE-1 fix — but a Railway platform build incident on 2026-05-20 left the latest pushes
    "Queued", so `error_summary` wasn't live on the backend yet.)
  - **INCIDENT 2026-05-20 — LCC Opps connection-pool exhaustion (resolved by restart).** Mid-session
    the LCC app stopped loading and login failed with "Failed to fetch". Root cause: **LCC Opps
    (`xengecqvemvfknjvbvrq`) ran out of DB connections** (`max_connections=60`). Every path timed
    out — browser auth, browser REST (504), and even admin `SELECT 1` ("Connection terminated due to
    connection timeout"). dia/gov were unaffected. Contributing load: repeated manual `stage-queued`
    bridge runs (chasing the R5-P-1 diagnosis) each hold an LCC Opps connection through slow 6 MB
    PDF/AI extraction, layered on the hourly `sf-files-extract-queued` cron + heavy diagnostic
    queries. **Resolved** by a Supabase **project restart** (post-restart: 27/60 conns, 0
    idle-in-txn). **Lessons:** (a) `max_connections=60` is a tight budget — the extraction bridge
    should cap concurrency / shorten connection hold (or LCC Opps compute should be bumped); (b) do
    not manually re-trigger `stage-queued` — let the hourly cron drain it. The `error_summary`
    diagnostic will surface the `copilot_action_exception` cause on the next cron tick without manual
    triggering.

  **R5-P-1 RESOLVED 2026-05-20.** After the LCC Opps restart + the `server.js` `data-query` route
  deploy (verified: `tranquil-delight…/api/data-query` now returns 200 JSON, was HTML), a single
  gentle limit-3 bridge run **extracted all 3 cleanly with zero new failures and no `error_summary`
  recorded** — i.e. nothing failed. This confirms the `copilot_action_exception` cluster
  (20:21–20:31) was **collateral damage from the connection-exhaustion incident** (stage-om couldn't
  write to LCC Opps), not a PDF/extractor bug. With the DB healthy and the route live, extraction
  succeeds (extracted 40→50 and climbing). The 16 incident-straggler `extract_failed` rows were
  **re-queued** (file_ids 198,206,210,211,214,225,229,232,234,241,248,262,277,280,281,288) to
  re-process on the next cron tick; the genuine "No valid extractions" rows were left alone (those
  are real extractor verdicts, and will now record a clean `error_summary` if they recur). **Net:
  the SF→LCC OM pipeline is healthy end-to-end** — file move ✅, bridge ✅, route (Railway+Vercel) ✅,
  extraction ✅, queue draining via the hourly cron. The `error_summary` diagnostic + `server.js`/
  `vercel.json` route parity remain as permanent improvements. **Open ops follow-ups (not blocking):**
  cap the extraction bridge's connection hold / bump LCC Opps compute; investigate the secondary
  Railway service `life-command-center-production` (404s on `/api/data-query` — likely stale).

### SF → LCC object/activity sync — HEALTHY

Very active and current: `sf_sync_log` has **6,862 rows in the last 24h** (newest 19:01 today)
and `salesforce` wrote **19,302 `field_provenance`** rows in 24h (R5 Part 1). The SF→LCC data
path is alive and flowing.

- **R5-P-2 [LOW — confirm deprecation] — `sf_sync_queue` find/link worker idle since 2026-04-29.**
  468 `done` / 1 `failed`, all activity Apr 24–29, nothing since. This is the old `LCCSFFlow1`
  1-minute find/link queue. Given SF→LCC is otherwise very active, this queue looks **superseded**
  (analogous to `propagation_worker.py` — R5-note) by the newer May-16/17 `SF -> LCC: Object Sync`
  family, not broken. Confirm it's intentionally retired (and retire the 1-min worker flow if so,
  to stop an empty poll), or re-enable its feeder if find/link is still wanted.

### Sidebar capture (CoStar / RCA / CREXi) — HEALTHY

`costar_sidebar` 12,642 + `rca_sidebar` 10,381 `field_provenance` writes in 24h (R5 Part 1);
fresh CREXi capture (`5820 Road 68, Pasco WA`) landed live during the drive. No silent-drop
signal. Full table coverage (properties, listings, leases, sales, contacts, public records,
deeds, loans) per the Phase 2.2 instrumentation. No action.

### Part 3 summary

Pipelines are healthy except **R5-P-1 (HIGH)** — the SF `Comp__c` OM **file-move** step in
Power Automate delivers the reference but not the bytes, stranding 25 deals' OMs before
extraction. That's the one active fix to pursue next; it's a PA-flow change (inspect the
ContentVersion download + `base64ToBinary` + the POST to `/api/intake`).
*(Superseded — see the R5-P-1 RESOLVED note above: file move actually works; the failures were
LCC-Opps-incident collateral, now drained.)*

---

## Part 4 — UI continuation audit (2026-05-20, post-incident)

Walked with the app fully healthy + logged in. Lighter surfaces all render cleanly with **zero
console errors**: Today dashboard, gov property detail, Pipeline/My Work, Sync Health, Dialysis
**Overview** (Database Health 8,535 clinics / 88.1% data / 98.1% property-linked / 94.1% lease;
action queues 1,438 NPI signals, 162 unlinked, 507 lease-backfill), Dialysis **Search**, and a
full **dia property detail** (DaVita Jurupa Valley — completeness 91, CMS-linked, all tabs/fields
populated). The SF→LCC OMs are visibly flowing into the **Inbox panel** as promotable items
(U.S. Renal Care, Fresenius Pasadena — Salesforce Comp__c, vertical:dia) — R5-P-1 confirmed in-UI.

- **R5-UI-1 [MED — perf/UX] — heavy views freeze the renderer.** Two views hard-froze the browser
  (CDP screenshot timed out, "renderer unresponsive"), recoverable only by navigating away:
  - **Dialysis section** loads several large datasets client-side *at once*: `v_npi_inventory_signals`
    **limit=5000**, `salesforce_activities` **limit=5000**, `research_queue_outcomes` **limit=2000**,
    plus multiple `limit=1000` views.
  - **Inbox** view renders the **2,955** flagged-email backlog (`sync?action=flagged_emails&limit=2000`).
  Both block the main thread on render. **Fix:** server-side pagination + windowed/virtualized list
  rendering (or cap initial load + lazy-load on scroll) for these two surfaces. The lightweight
  dashboard previews (Inbox panel, NBA list) are fine — it's the full-list views that choke.
- **Data quality (read-only checks, gov+dia — improving):**
  - **gov** (17,606 props): Unknown agency **16.4%** (2,880) — down from the prior audit's ~42%;
    missing address **32** / city **12** (was a backlog — now negligible); geocoded **89.4%**.
  - **dia** operator names well-normalized; ~73 rows in minor variants ("Fresenius Medical Care" 25
    vs "Fresenius"; "US Renal Care" 45 vs "US Renal Care, Inc." 384; 3 DaVita pipe one-offs) — small
    hygiene item.
- **Not yet walked (deferred — heavy-view freeze risk):** Inbox triage actions, Contacts/entity
  dedup, Capital Markets reports, and the More menu. Best revisited *after* the R5-UI-1
  pagination/virtualization fix so they don't freeze the browser mid-audit.

### Data-consolidation findings (from a live detail-drawer screenshot — DaVita Rocky Mount, NC)

Scott flagged the **DaVita Dialysis – Rocky Mount, NC** ownership drawer (property_id 23146,
110 Enterprise Dr). Four real issues, root-caused in dia:

- **R5-DQ-1 [MED — bad price → impossible cap rate; 242 rows affected].** The 2026-04-01
  "sale" at **$1,700,000** (`data_source='costar_sidebar'`) yields `calculated_cap_rate`
  **13.99%** (= rent_at_sale $237,772 ÷ $1.7M). The 2022 Northmarq sale was $3,800,000 @ 5.69%
  — a $3.8M→$1.7M drop on a DaVita NNN is implausible, so the **$1.7M is a misparse** (partial
  interest / assessed value / wrong line item) and the cap math faithfully turned garbage-in
  into garbage-out. The cap-rate framework's `[0.005, 0.30]` guardrail is **too wide for
  dialysis** — 13.99% passes. **Scale: 242 dia `sales_transactions` have cap > 10% (116 > 12%)**
  — implausible for dialysis NNN; almost certainly bad-price captures. **Fix:** add a
  domain-specific sanity bound (flag/quarantine dia caps > ~10% as `suspect`, exclude from
  market metrics) AND audit the costar_sidebar sale-price parser for partial-interest /
  assessed-value mis-capture.
- **R5-DQ-2 [LOW-MED — owner entity dedup].** Same entity in ≥3 unconsolidated variants:
  "Tsoumpas 203 N Carolin GRP LLC" / "Tsoumpas 203 N Carolin Grp LLC" / "Tsoumpas 203 North
  Carolina Group LLC" (truncated "Carolin"→"Carolina", GRP/Grp→Group, N→North). Feeds the known
  entity-dedup backlog; a normalize-on-write (expand abbreviations, fix the "Carolin" truncation)
  + a merge pass would consolidate.
- **R5-DQ-3 [LOW — junk address from OM parsing; 4 props].** A duplicate property record
  (property_id 42748) has address **"2 Lease Summary 110 Enterprise Dr"** — an OM section header
  ("Lease Summary") parsed into the address, tenant null, owner "Unknown". Only **4** dia props
  match OM-section-header address patterns, so it's a small cleanup (merge into the real record +
  add the section-header tokens to the address-parser reject list).
- **R5-DQ-4 [LOW — UI display].** The ownership-history drawer shows the $3.8M deal twice
  (one dated, one undated) and renders the Northmarq decoration **inline with the owner name**
  ("…GRP LLC by Northmarq"), which reads as if it's part of the LLC name. De-dup the history rows
  and render the Northmarq indicator as a separate badge.
