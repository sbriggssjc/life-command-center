# Runbook — tearing down the retired Vercel deployment (`life-command-center-nine.vercel.app`)

> Preflight for this runbook: `docs/audits/J13_TEARDOWN_PREFLIGHT_2026-09-09.md` (backlog **J13-preflight**,
> ✅ done). This runbook is backlog **J13-teardown**, 👤 Scott. **Do the steps in this order — reversing
> the order strands a caller silently** (a live caller that fails *quietly* instead of succeeding
> quietly is worse than a caller that errors loudly).

## Step 1 — Repoint every live caller found in the preflight

Concrete new URLs must come from `server.js`'s actual mounted routes (grepped, never invented):

- **Scheduled daily-briefing caller** (~~writes `briefing_intel_snapshot` at ~10:00 UTC,~~ reads a
  composite dashboard at ~12:30 UTC — preflight §2c; ⚠️ *Cowork 2026-09-09: the 10:00 write is the
  `briefing-intel-snapshot` Supabase edge cron, not this caller — do not go looking for a 10:00 writer to
  repoint*): repoint to
  `https://<railway-host>/api/daily-briefing` — mounted at `server.js:184`
  (`app.all('/api/daily-briefing', ...)` → `_route=edge-brief&action=snapshot` via `adminHandler`).
  👤 Scott: open the Cowork desktop task **"daily-briefing-cache"** and change its configured host from
  `life-command-center-nine.vercel.app` to the Railway host.
  ✅ **RESOLVED 2026-09-09 (walked in Cowork).** The caller was NOT the desktop task and NOT either v2
  flow. It was the **May-2026 Power Automate flow "LCC Daily Briefing to Teams"** (no hyphen — the July
  replacement is "LCC - Daily Briefing to Teams"), still ON, GETting the Vercel host every weekday at
  12:30 UTC with a successful run history. **Turned OFF by Scott 2026-09-09, not deleted.** Registered in
  `FLOW-REGISTRY.yaml` as `retired-daily-briefing-teams-v1`; the two v2 flows registered as
  `briefing-daily-teams-v2` / `briefing-morning-email-v2` (both already on Railway). The desktop task
  `daily-briefing-cache` (06:30 CT, `/api/activities?_route=daily-briefing` — a path Railway swallows) was
  inert and redundant with the 10:00/10:18 crons → 👤 disable it rather than repoint (repointing would
  re-fire the snapshot after the 10:18 Analyst's Take write — the V4 hazard).
  **Proof:** re-run the preflight's §2c query for the *next weekday* 12:30 UTC and confirm the 17-request
  `node` burst is gone from the AWS pool and no `v_my_work` 400 appears — ~~confirm the writing IP falls in the Railway block~~ (there is no Vercel-side write to move; the repointed task will hit Railway's `/api/daily-briefing`, whose reads come from the Railway block (`152.55.176.x` / `152.55.177.x` / `162.220.232.x`),
  not the AWS ephemeral pool.
- **iPhone Shortcut "Send to LCC"**: **blocked, not a simple repoint.** The preflight found
  `/api/intake?_route=mobile-share` is **not mounted in `server.js`** — there is no live Railway route
  for the Shortcut to point at yet. Before touching the Shortcut: either (a) mount an equivalent route
  in `server.js` (a code change, out of scope for this runbook) or (b) 👤 Scott repoints the Shortcut to
  whichever existing mounted route already accepts the same payload shape (check
  `/api/intake` — the bare handler at `server.js:545` — as the fallback target). **Proof:** a test share
  from the Shortcut lands a row in `staged_intake_items`/`staged_intake_artifacts` sourced from a
  Railway IP, within a minute of sending.
- **Chrome/Edge extension**: 👤 Scott confirms the installed version in `chrome://extensions` is at or
  above the build that shipped after the P194 fix (the commit that made `pickIntakeHost()` Railway-first
  — see `extension/background.js` lines 20–47; shipped manifest version at the time of this preflight:
  **1.0.52**). If older, reload the unpacked/packed extension from the current `main`. **Proof:** a
  sidebar capture's `POST` lands from a Railway IP ~~(the extension itself has no separate "repoint" step
  once the installed build is current — `pickIntakeHost()` already prefers `LCC_RAILWAY_URL`)~~.
  **Corrected 2026-09-10 (measured): being on 1.0.52 is NOT sufficient.** On 2026-09-09 sidebar OMs at 13:11
  and 19:25 UTC were written from Railway, while 14:28, 18:59 and 20:30 UTC were written from AWS Lambda
  addresses (`3.94.187.179`, `3.82.217.155`, `52.52.40.44`) — the frozen Vercel build — same machine, same
  day. 1.0.52's resolver returned whatever `chrome.storage.sync` held, and a browser profile configured in
  the Vercel era still holds that origin as `LCC_RAILWAY_URL`. **1.0.53 (EXT-HOST) refuses any
  `*.vercel.app` origin in the resolver and in the side panel's config read.** 👤 Reload the extension to
  1.0.53 in **every** profile that has it (both Edge and Chrome were seen at Scott's address), and in each
  open Settings and set the URL to the Railway origin. **Proof:** two consecutive sidebar captures from each
  browser land from Railway IPs; zero `POST staged_intake_items` from non-Railway IPs for the whole window.
- **Copilot Studio / Teams agent**: 👤 Scott opens the imported connector in Copilot Studio and reads its
  `host` field. Repoint it to whatever `copilot/lcc-deal-intelligence.connector.v4.swagger.json`
  declares (the current canonical connector; v1 is superseded and archived under `_superseded/`) — read
  that file's own `host` key directly before typing anything into Copilot Studio, do not copy this
  runbook's text. **Proof:** an agent action fired from Teams lands at a Railway IP.
- **Power Automate flows**: `docs/os/FLOW-REGISTRY.yaml` and the sampled 2026-08-11 exports carry no
  Vercel-hostname hits (preflight §4) — **no known PA flow needs repointing**, but the preflight also
  names a stated blind spot (3 flows outside both the registry and `retired_flows`, not identified in
  this pass). 👤 Scott: before deleting the Vercel project, re-run the same `unzip -p <zip> | grep -i
  vercel` sweep against the *current* production export set (not just 2026-08-11) and against any flow
  Scott knows is not in the registry.

## Step 2 — Observation window with zero ephemeral-pool writers

**Propose N = 8 days.** Justification from the preflight's hour-of-day evidence: the only confirmed
caller fires on a **daily (weekday-shaped, 10:00/12:30 UTC) cadence**, not weekly — so in principle 2–3
days would show it recur. But the preflight is a **single 24h sample** and cannot rule out a
weekly-only caller (e.g. a Monday-morning batch), so the runbook keeps the ≥8-day floor the original
spec calls for, to cross at least one full week boundary.

**Proof:** re-run the preflight §1/§2b queries (one call per day, since `query_logs` caps at 24h) across
the 8-day window and confirm **zero** rows from the AWS/Azure ephemeral-IP classes hitting
`briefing_intel_snapshot`, and zero POST/PATCH/DELETE from any IP outside the Railway block
(`152.55.176.x`/`152.55.177.x`/`162.220.232.x`) on any of the 8 days. A GET-only ephemeral IP with no
writes after step 1's repoints land is lower-severity (a stale cache, not a live writer) but should
still be chased down before step 4.

## Step 3 — Rotate the LCC Opps service key the frozen Vercel build holds

**This is a separate trigger from the deferred `SEC2`–`SEC4` rotation.** That rotation was deferred
pending "a second user" (per CLAUDE.md/backlog). This trigger is different: **a retired deployment that
still executes and still holds a live service key** — nothing to do with a second human user. Whether
finding this changes the SEC2–SEC4 deferral decision is **Scott's call**, not this runbook's — say so
explicitly rather than silently bundling the two rotations together.

Rotate the key LCC Opps issued to the Vercel deployment's environment variables (the key referenced in
CLAUDE.md's P194 note as still held by the frozen build).

**Proof:** with the old key, `curl -s -o /dev/null -w '%{http_code}' <LCC-Opps-REST-URL>/rest/v1/entities?select=id&limit=1 -H "apikey: <old-key>" -H "Authorization: Bearer <old-key>"` returns **401**, where it previously returned 200/206.

## Step 3b — Environment-variable audit before deletion (Cowork round 33, 2026-09-18)

> **Two corrections to the runbook above, measured 2026-09-17/18 (VERCEL-LIVE1):** (1) the Vercel deployment is
> **not frozen at the July build** — Scott's Vercel log export (21:08 UTC 09-17) shows deployment
> `dpl_8CnznECT2siyQix7G3i4VwQkYDvR`, `branch: main`, serving a client that issues calls added 2026-09-03 and since
> removed from `main`; the Git integration is still connected and a build from early/mid September is what runs
> there. So "today's frozen-build 200" in Step 4 is a **stale-build 200**, and Step 3's key rotation matters more,
> not less. (2) That deployment was **Scott's daily LCC window** (the installed desktop app) until 2026-09-17 and
> the source of the `POST /chat node other` and `browser scott` `DENY-WOULD` lines in the `ai-copilot` log
> (PL-14 / Q1). He is on Railway since 09-17; the browser-class lines stopped at 21:08 UTC that day.

**Source:** Scott's screenshots of `vercel.com/scottbs-projects/life-command-center/settings/environments/production`
(five screens, names only — values never left the dashboard). The dashboard truncates long names (`SO…ET`), so
each is matched here against the names the current `main` actually reads (`process.env.X` across `server.js`,
`api/`, `mcp/`, `scripts/`, `lib/`, `supabase/functions/`, plus `bov-generator/`, `resolver/`, `pipeline/`).
**The screenshots skip the block between `FOLDER_FEED_…` (Jun 11) and `INTAKE_EXTRACTION_ENABLED` (Apr 20)** — that
gap is unaudited; Scott to scroll it once more before deleting.

### What to do with it

1. On Railway (`tranquil-delight` service **and** the standalone MCP service), confirm every name in **column A is
   set**. Anything missing there is the one thing deletion would lose. Compare names, not values.
2. Column B needs no action — the current code never reads it (retired features, Vercel-only build settings, or
   names that belong to another service).
3. Column C (ambiguous) — open the variable on Vercel to read the full name, then place it in A or B.
4. Then: Vercel → Project → Settings → General → **Delete Project** (or pause deployments first if you want a day
   of "nothing broke"). `life-command-center-nine.vercel.app` stops answering; the stale client dies with it.

### A — read by current code on `main` (must exist on Railway)

| Vercel name (as shown) | resolves to | read by |
|---|---|---|
| `MOVE_QUEU…EXECUTOR` | `MOVE_QUEUE_EXECUTOR` | api |
| `SO…ET` | `SOS_PROXY_CF_ACCESS_CLIENT_SECRET` | api (SoS proxy) |
| `SOS_PROXY…LIENT_ID` | `SOS_PROXY_CF_ACCESS_CLIENT_ID` | api |
| `SO…EN` | `SOS_PROXY_TOKEN` | api |
| `CF…ET` / `CF_ACCESS…LIENT_ID` | `CF_ACCESS_CLIENT_SECRET` / `CF_ACCESS_CLIENT_ID` | api (Cloudflare Access to the on-box services) |
| `AI_EXTRAC…_PRIMARY` | `AI_EXTRACTION_PRIMARY` | `api/_shared/ai.js` |
| `MAILBOX_MIRROR`, `W74_ROLE_ISSUES`, `W75_ACTION_SUMMARY` | same | api intake / action summary |
| `TAGGED_CO…_ENABLED` | `TAGGED_COMM_INTAKE_ENABLED` | api |
| `DEAL_COMM…_ENABLED` / `DEAL_EMAI…_ENABLED` | `DEAL_COMMS_PROPAGATE_ENABLED` / `DEAL_EMAIL_MATCH_ENABLED` | api |
| `RESOLVER_URL`, `ORE_USE_RESOLVER` | same | api (owner resolver) |
| `BOV_SERVICE_URL`, `BO…EN`, `BO…EY` | `BOV_SERVICE_URL`, `BOV_BRIDGE_TOKEN`, `BOV_API_KEY` | api (BOV bridge) |
| `LCC_PRIMA…SPACE_ID` | `LCC_PRIMARY_WORKSPACE_ID` | api |
| `MCP_BASE_URL` | same | api |
| `CE…EY` | `CENSUS_API_KEY` | api |
| `OLLAMA_URL`, `OLLAMA_MODEL` | same | `api/_shared/ai.js` (on-box path) |
| `OUTLOOK_S…HOOK_URL` | `OUTLOOK_SEARCH_WEBHOOK_URL` | api |
| `SUPABASE_URL`, `SU…EY` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | everywhere |
| `NEXT_STEP_AI`, `CONTACTS_HUB` | same | api |
| `OCR_CLOUD…STRESORT`, `OC…EY` | `OCR_CLOUD_GPT4O_LASTRESORT`, `OCR_CLOUD_OCR_KEY` | api (OCR) |
| `DECISION_…EED_WINS`, `DECISION_…RITEBACK` | `DECISION_OWNER_DEED_WINS`, `DECISION_GOV_WRITEBACK` | api |
| `PA_MOVE_M…HOOK_URL`, `PA_COMPLE…TASK_URL` | `PA_MOVE_MESSAGE_WEBHOOK_URL`, `PA_COMPLETE_TASK_URL` | api (Power Automate callbacks) |
| `PA…ET` | `PA_WEBHOOK_SECRET` (or `PA_OUTLOOK_DRAFT_SECRET` — check) | api / edge auth |
| `SF_LIST_S…TITUTION`, `SF_CONTAC…RITEBACK` | `SF_LIST_SEED_INSTITUTION`, `SF_CONTACT_WRITEBACK` | api |
| `LC…EY` (×2) | `LCC_API_KEY`, `LCC_SERVICE_ROLE_KEY` | api / scripts |
| `AI_CHAT_PROVIDER`, `AI_CHAT_POLICY`, `AI_CHAT_MODEL`, `AI_MODEL` | same | `api/_shared/ai.js` |
| `PORT`, `LCC_ENV` | same | `server.js` |
| `FOLDER_FE…_EXTRACT`, `FOLDER_FE…CH_ROOTS` | `FOLDER_FEED_ASYNC_EXTRACT` / `FOLDER_FEED_LEASE_EXTRACT`, `FOLDER_FEED_ENRICH_ROOTS` | api |
| `INTAKE_EX…_ENABLED`, `TEAMS_COL…_ENABLED` | `INTAKE_EXTRACTION_ENABLED`, `TEAMS_COLD_ALERTS_ENABLED` | api |
| `OP…EY` | `OPENAI_API_KEY` (most likely; also possible `OPENCORPORATES_API_KEY`) | api |
| `MS…EN` | `MS_GRAPH_TOKEN` | api |
| `OPS_SUPAB…ANON_KEY` | `OPS_SUPABASE_ANON_KEY` | api |
| `WEBEX_CLIENT_ID` | same | api |

### B — not read by current LCC code (no action; safe to lose)

`SU…SN` (a DSN — nothing on `main` reads a `*_DSN`), `TIER0_AUTO_ATTACH` (read from `workspaces.config` / DB, not env),
`NIXPACKS_…_VERSION` (Railway build setting, meaningless on Vercel), `SOS_PROXY_URL` (only in a 2026-08 migration
comment), `FR…EY` (`FRED_API_KEY` — the FRED reader is on the Dialysis side / market briefs, not this repo),
`AI_EXTRAC…PROVIDER` (`AI_EXTRACTION_PROVIDER` — only a flag-seed migration mentions it), `RESOLVER_…O_REJECT` /
`RESOLVER_AUTO_LINK` (read by `resolver/app/config.py` — the resolver service's own env, not the web app's),
`RE…EY` ×2 (no `RESEND_*`/`RE*_KEY` read on `main`; open to read the full name), `PA_DEALFO…FILE_URL` (nothing reads
it), `BOV_ALLOW…REVIEWED`, `LCC_OPS_URL`, `PUBLIC_BASE_URL` (read by `bov-generator/*.py` — the BOV service's env,
lives on `pacific-love`), `AI_PROVIDER` (`pipeline/ai_research.py` only), `NODE_OPTIONS` (runtime tuning; set on
Railway if it was doing something — check its value before deleting).

### C — unaudited

The scrolled-past block between Jun 11 and Apr 20, and the two `RE…EY` names.

### Step 3b result — definitive, from the Raw-Editor name lists (Cowork round 37, 2026-09-18)

Scott exported names-only lists for **Vercel** (78 names) and all four Railway services: `tranquil-delight` (79,
of which 42 are `${{shared.*}}` references to the 46 shared variables), `life-command-center` = the standalone MCP
(71), `pacific-love` = BOV Generator (37), `gracious-radiance` = **the owner resolver** (28 — `RESOLVER_AUTO_LINK`,
`RESOLVER_AUTO_REJECT`, `RESOLVER_STORAGE_KEY` live here; this fourth service was not in `CURRENT-STATE.md` §1
until now). Compared against every `process.env.X` the web app reads on `main`:

| finding | names |
|---|---|
| Vercel names the web app reads **and `tranquil-delight` already has** | 52 of 58 |
| Vercel names the web app reads, **missing on `tranquil-delight`** | `TEAMS_INTAKE_WEBHOOK_URL` (read by `api/_handlers/intake-extractor.js`, `api/_shared/cadence-alerts.js`, `api/_shared/teams-alert.js` — Teams alerts from the web app are silently off on Railway; the value exists on the `life-command-center` service, copy it across) · `INTAKE_AUTOCREATE_CAP` (default `10` in code — optional) · `PORT` (Railway injects it) · `LCC_API_BASE` (MCP-only, present there) · `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (not read by `server.js`/`api/`/`mcp/` — scripts/CI only; the app uses `OPS_SUPABASE_*` / `DIA_SUPABASE_*`) |
| Vercel names **no current code reads** (safe to lose) | `AI_EXTRACTION_PROVIDER`, `AI_PROVIDER`, `AI_TIMEOUT_S`, `BOV_ALLOW_UNREVIEWED`, `FRED_API_KEY`, `LCC_OPS_SERVICE_KEY`, `LCC_OPS_URL`, `NIXPACKS_PYTHON_VERSION`, `PA_DEALFOLDER_FILE_URL`, `PUBLIC_BASE_URL`, `REGRID_API_KEY`, `RESOLVER_AUTO_LINK`, `RESOLVER_AUTO_REJECT`, `RESOLVER_STORAGE_KEY`, `SF_LIST_IMPORT_URL`, `SOS_PROXY_URL`, `SUPABASE_DB_DSN`, `SUPABASE_KEY`, `TIER0_AUTO_ATTACH`, `W75_ACTION_SUMMARY` — most belong to the BOV / resolver services, where they already exist |
| Workspace id | `tranquil-delight` carries **both** `LCC_PRIMARY_WORKSPACE_ID` and `LCC_DEFAULT_WORKSPACE_ID`; the code reads both with a fallback — no action |
| Shared variables shown *ADD* (not attached to `tranquil-delight`) | `OPENAI_API_KEY`, `REGRID_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` — the first is read by the app: confirm `OPENAI_API_KEY` is a **service** variable on `tranquil-delight` (the raw list shows it there) |

**So the only pre-delete action on Railway is one variable:** add `TEAMS_INTAKE_WEBHOOK_URL` to `tranquil-delight`
(same value as on `life-command-center`). Then Step 3 (rotate the LCC Opps key the Vercel build holds:
`OPS_SUPABASE_SERVICE_KEY` / `LCC_SERVICE_ROLE_KEY` on Vercel; rotate in Supabase, update on all four Railway services in
one sitting) → Step 4 (delete) → Step 5.

⚠️ The Railway raw exports Scott saved (`responses/*variable names.docx`) contain **values**, not only names (the
Raw Editor pastes `KEY=value`). They are gitignored (`*.docx`) and never left his machine, but they should be deleted
from the responses folder once this step is closed — a synced folder is not a secrets store.

## Step 4 — Delete the Vercel project (👤 Scott only, Vercel dashboard)

**Proof — and this must distinguish DEPLOYMENT_NOT_FOUND from the CURRENT frozen-build behavior:**

| probe | **before** deletion (today's actual behavior) | **after** deletion (expected) |
|---|---|---|
| `curl -s https://life-command-center-nine.vercel.app/` | 200, serves the frozen SPA `index.html` | Vercel's `DEPLOYMENT_NOT_FOUND` error page |
| `curl -s https://life-command-center-nine.vercel.app/api/daily-briefing` | **200**, a real briefing JSON body generated at request time (measured 2026-09-08 21:44 UTC per CLAUDE.md P194) | `DEPLOYMENT_NOT_FOUND` (not a 404 from the app, not a 200 — a **platform-level** error, since the whole project is gone) |
| `curl -s https://life-command-center-nine.vercel.app/version` | Vercel's own `NOT_FOUND` (this route postdates the frozen build — already 404-shaped **today**, before any teardown) | Still an error, but now `DEPLOYMENT_NOT_FOUND` at the platform level rather than the app's own route-miss 404 |

**Do not read a 200 or an app-level 404 as proof of anything before this step — only
`DEPLOYMENT_NOT_FOUND` (or the equivalent Vercel platform error, not an app response) proves the project
is actually gone.**

## Step 5 — Close the loop in the repo

- Mark **J13-teardown** ✅ in `docs/os/PLANNED-BACKLOG.md` with the date this runbook was executed.
- Update the wording of every `STALE (DOCMAP…` banner currently asserting the host "still answers" /
  "is still live" (the ~10 files listed in CLAUDE.md's J13/J13a rows and found via
  `grep -rl "STALE (DOCMAP" docs/`) to **"torn down <date>"** — a banner that still says "still answers"
  after the teardown is itself now stale and must be corrected in the same change that executes step 4.
  **This rewrite is NOT done as part of this preflight/runbook-authoring pass** — it happens only when
  whoever executes step 4 comes back to do step 5, after the project is actually gone.
- Update the `note` field on the `life-command-center-nine.vercel.app` entry in
  `test/fixtures/retired-identifiers.json` (the J13a-guard fixture) to record the teardown date.

## Rollback — if a caller surfaces AFTER step 4 (deletion)

**There is no redeploying Vercel.** The fix is always the caller's own repoint, never resurrecting the
project. Failure signatures per caller class, so whoever is on call recognizes it:

- **Cowork desktop task / any scheduled HTTP caller**: a connection error / DNS failure or an HTTP-level
  error from Vercel's edge (not a JSON error body — the app is gone, so nothing at the application layer
  can respond). The task's own error log will show a failed fetch, not a 4xx/5xx from `server.js`.
- **iPhone Shortcut**: the Shortcut fails with "could not connect" / a non-2xx status with no JSON body,
  or (if a captive DNS/CDN still resolves) a Vercel platform error page piped into the Shortcut's
  response parser, which will then itself fail to parse JSON.
- **Chrome/Edge extension**: a `fetch()` rejection (network error) or a CORS failure in the extension's
  service-worker console — `pickIntakeHost()` would need `LCC_VERCEL_URL` cleared from
  `chrome.storage.sync` for the fallback path to stop being attempted at all; until then a stale
  installed build will visibly fail rather than silently succeed.
- **Copilot Studio / Teams agent**: the connector call fails inside Copilot Studio's action log with a
  connection/DNS error, surfaced to the Teams user as "the agent could not complete this action."
- **Any Power Automate flow found later**: the HTTP action step fails and (if configured) triggers the
  flow's own retry/dead-letter path — check `SF-LCCRetry&Dead-letter` and equivalent flows in
  `private/power-automate/exports/` for whether they'd catch this.

In every case: **identify the caller from the failure, repoint it to the Railway route named in step 1,
and do not re-provision anything on Vercel.**
