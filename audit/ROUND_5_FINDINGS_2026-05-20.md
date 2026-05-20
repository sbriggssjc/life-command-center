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
- **R5-FE-note — 3× outlook connector registrations.** Two healthy + one errored. Worth
  confirming whether all three are intended (Work, Personal, + a legacy bare-label
  `outlook` `3c7be7f6-…` last synced 2026-04-22) or whether the bare-label one is a
  dedup candidate.
