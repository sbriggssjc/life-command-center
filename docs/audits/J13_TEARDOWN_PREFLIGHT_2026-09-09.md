# J13-preflight — retired Vercel host caller inventory (2026-09-09)

> Executes `docs/claude-code/prompts/J13-teardown-preflight.md`. **Read-only.** No code, no DB
> writes, no migrations, no deploy, no deletions. Produces this audit + `docs/os/RUNBOOK_vercel_teardown.md`
> + the STATUS/backlog updates listed in that prompt's Unit 3.

## 0. What was actually measured — state the window honestly

`mcp__Supabase__query_logs` caps a single call at **24 hours**. One call was made per project. The
window actually read on all three projects is:

**2026-09-08T01:22:00Z → 2026-09-09T01:21:22Z (24h 0m, one calendar day, spanning both a business-day
morning and a business-day afternoon UTC).**

This is **not** 14 days. Getting 14 days would need 14 separate windowed calls per project (42 total)
repeated on 14 different days, which this session cannot do retroactively — `query_logs` reads live
retained logs, it cannot look further back than what Supabase's edge-log retention already holds, and
this session only has the one pass. **Every count below is a 1-day sample, not a 14-day one.** Where a
pattern repeats at the same UTC hour, that is read as a *daily* signal (Mon–Fri cron-shaped), not a
weekly one — an actual weekly cadence (e.g. a Monday-only job) could not be distinguished from absence
in a 1-day window, and is flagged as such below.

Projects queried: **LCC Opps** (`xengecqvemvfknjvbvrq`, primary), **Dialysis_DB**
(`zqzrriwuavgrquhisnoa`), **government** (`scknotsqkcheojiaewwh`). Only `edge_logs` (PostgREST/edge
front door) was queried — `postgres_logs` mutation-statement correlation (asked for in the prompt) was
not run in this pass; the `edge_logs` HTTP method + path already identifies writes (POST/PATCH) without
needing to correlate to `postgres_logs`, and is reported as such.

## 1. The IP-class split (P194 technique)

Query (LCC Opps):

```sql
select log_attributes['request.headers.cf_connecting_ip'] as ip,
       count(*) as n,
       min(cast(timestamp as datetime)) as first_ts,
       max(cast(timestamp as datetime)) as last_ts
from logs
where source = 'edge_logs'
group by ip
order by n desc
limit 40
```

Note the field path: it is a **flat dotted key** in `log_attributes`
(`request.headers.cf_connecting_ip`), not a nested struct — `cross join unnest(metadata)` (the form
suggested by analogy with other log tools) errors `Table "edge_logs" does not exist`; the correct table
is `logs` filtered `where source='edge_logs'`.

Result (LCC Opps, top 15 by volume in the 24h window):

| ip | n | first_ts (UTC) | last_ts (UTC) | class |
|---|---:|---|---|---|
| 152.55.176.247 | 105,406 | 09-08 01:22 | 09-08 12:21 | **Railway (stable)** |
| 152.55.176.221 | 22,744 | 09-08 22:17 | 09-09 01:16 | **Railway (stable)** |
| 152.55.177.86 | 17,674 | 09-08 21:08 | 09-08 21:52 | **Railway (stable)** |
| 152.55.176.146 | 17,451 | 09-08 17:44 | 09-08 19:42 | **Railway (stable)** |
| 162.220.232.29 | 10,633 | 09-08 15:19 | 09-08 15:40 | **Railway (stable)** |
| 152.55.177.152 | 8,269 | 09-08 16:44 | 09-08 17:41 | **Railway (stable)** |
| **52.52.16.220** | **5,705** | 09-08 20:48 | 09-08 21:08 | ephemeral pool (AWS us-west) |
| 152.55.176.90 | 5,177 | 09-08 14:47 | 09-08 15:04 | **Railway (stable)** |
| **52.52.73.105** | **4,767** | 09-08 15:47 | 09-08 16:11 | ephemeral pool (AWS) |
| 152.55.176.127 | 4,566 | 09-08 14:03 | 09-08 14:44 | **Railway (stable)** |
| 152.55.177.47 | 4,233 | 09-08 16:25 | 09-08 16:44 | **Railway (stable)** |
| **13.52.88.135** | **4,122** | 09-08 20:27 | 09-08 20:47 | ephemeral pool (AWS) |
| 152.55.176.141 | 4,008 | 09-08 21:53 | 09-08 22:16 | **Railway (stable)** |
| 152.55.176.156 | 3,646 | 09-08 12:22 | 09-08 12:44 | **Railway (stable)** |
| **20.49.123.20/21/22** | 827/761/140 | 09-08 01:22 | 09-09 01:21 | **spans the whole 24h — not a burst. See §2c.** |

Full population: **~30 IPs in the Railway `152.55.176.x`/`152.55.177.x`/`162.220.232.x` blocks**
(matching the CLAUDE.md-documented stable Railway range) each active for a contiguous window of
minutes-to-hours and never recurring — consistent with Railway's own outbound connection pooling
(new pooled connection per deploy/restart/scale event, not per-caller), not with "one caller per IP."
Against those: **~14 IPs outside that range** (`52.x`, `54.x`, `18.x`, `13.x`, `3.x` — all
AWS-registered blocks per the octets; `20.49.123.x` is Microsoft/Azure), each active for a **narrow
window (minutes)**, except the three `20.49.123.x` addresses which are active continuously across the
whole 24h at low, steady volume (140–827 requests) — a materially different shape from the P194
"rotating pool" description (§2c).

## 2. What the ephemeral-pool IPs actually did

### 2a. Table/path footprint — this is NOT the "one narrow path fingerprint" P194 described

Querying the path distribution for a sample of the AWS-block IPs (`13.52.88.135`, `18.144.119.47`,
`52.52.16.220`, others) shows each one hitting **dozens of distinct REST/RPC paths in one short burst**
— `bd_opportunities`, `entities`, `lcc_users`, `workspace_memberships`, `enrichment_jobs`,
`connector_bridges`, `bridge_runs`, `folder_feed_seen`, `unified_contacts`, `inbox_items`,
`activity_events`, `v_priority_queue_enriched`, `rpc/lcc_merge_field`, `sync_jobs`, etc. That is **the
shape of one whole app page-load / API-composite call**, not the "one narrow path, 40–255 requests"
signature CLAUDE.md's W53 audit describes for the intake-extraction channel. **This population is a
different caller class than the one P194/W53 characterized** — it reads like the Vercel deployment's
own serverless functions independently re-running the app's normal server-side logic (the same
`api/_shared/*` handler code Railway runs), because a visit to the frozen Vercel URL re-executes those
functions against Supabase exactly like a Railway request would, just from AWS Lambda's IP pool instead
of Railway's.

### 2b. A genuine write, at a time that lines up with a known schedule

```sql
select log_attributes['request.headers.cf_connecting_ip'] as ip,
       cast(timestamp as datetime) as ts,
       log_attributes['request.method'] as method,
       log_attributes['request.path'] as path,
       log_attributes['request.search'] as search,
       log_attributes['response.status_code'] as status
from logs
where source='edge_logs' and log_attributes['request.path'] like '%briefing_intel_snapshot%'
order by ts
```

Result (all 6 rows in the 24h window):

| ip | ts (UTC) | method | search | status | class |
|---|---|---|---|---|---|
| **18.208.213.136** | **09-08 10:00:27** | **POST** | `on_conflict=as_of_date,workspace_id` | **201** | **ephemeral pool — WRITE** |
| 152.55.176.247 | 09-08 10:18:01 | GET | `as_of_date=gte…&order=…&limit=1` | 200 | Railway |
| 152.55.176.247 | 09-08 10:18:09 | PATCH | `as_of_date=eq.2026-09-08&workspace_id=is.null` | 200 | Railway |
| 152.55.177.150 | 09-08 12:04:32 | GET | `order=…&limit=1` | 206 | Railway |
| **18.209.20.81** | **09-08 12:30:01** | **GET** | `as_of_date=gte…&order=…&limit=1` | 200 | **ephemeral pool — READ** |
| 152.55.176.156 | 09-08 12:30:02 | GET | (same as-of filter) | 200 | Railway |

**`18.208.213.136` POSTed a full upsert (`on_conflict=as_of_date,workspace_id`, HTTP 201) to
`briefing_intel_snapshot` at 10:00:27 UTC.** That is a real write from the ephemeral pool, not a read
probe — and it landed **18 minutes before** Railway's own 10:18 read+PATCH of the same row (which
matches CLAUDE.md's documented cron 240 schedule, `18 10 * * 1-5`, "between the 10:00 snapshot and the
12:30 send"). ~~**This is the retired Vercel deployment independently generating and persisting its own
daily-briefing snapshot into the same table Railway's cron writes, at a time that brackets Railway's own
job** — the live second-writer collision CLAUDE.md's P194 note already asserts, now shown with a
concrete row.~~ ⚠️ **Struck by the Cowork reconcile, 2026-09-09.** The `user_agent` column — which this pass never read — refutes it: the 10:00:27 POST from `18.208.213.136` carries **`Deno/2.1.4 (variant; SupabaseEdgeRuntime/1.74.3)`**. That is a **Supabase edge function** (the `briefing-intel-snapshot` cron, backlog V4), which egresses from the same AWS pool — it recurred 2026-09-09 10:00 from `54.227.48.19` with the same UA. **The retired Vercel build does not write `briefing_intel_snapshot`.** What IS the frozen build is the 12:30:01 burst: UA **`node`**, 17–18 requests, and **three HTTP 400s** (`v_my_work`, `mv_user_work_counts`, `action_items`) — a build asking for columns the schema has moved past — while the live `daily-briefing` edge function renders the same views in the same minute with **0** errors. Recurrence: Thu 09-04 ✓ · Fri 09-05 ✗ · Sat 09-06 ✗ · Mon 09-07 ✓ (`54.209.9.254`, 17 req, 3×400) · Tue 09-08 ✓ — always 12:30:00 UTC (07:30 CT), read-only. **IP class alone is half a fingerprint; read the user agent.**

**Neither of these two rows falls in the excluded Cowork-probe window (2026-09-08 21:43–21:44 UTC).**
The 21:43–21:44 window was checked separately (§2d) and produced no `briefing_intel_snapshot` write —
**the Cowork read-probe (`net.http_get` to `/api/daily-briefing`) did NOT persist a snapshot.**

### 2c. What `18.208.213.136` / `18.209.20.81` did before/after that write — a narrow, scheduled fingerprint

```sql
select cast(timestamp as datetime) as ts, log_attributes['request.method'] as method,
       log_attributes['request.path'] as path, log_attributes['response.status_code'] as status
from logs where source='edge_logs'
  and log_attributes['request.headers.cf_connecting_ip'] in ('18.208.213.136','18.209.20.81')
order by ts
```

`18.208.213.136` did exactly **one request** in the whole 24h window: the 10:00:27 POST above.
`18.209.20.81` did a tight burst of **18 requests, all at 12:30:01–12:30:02 UTC** —
`mv_work_counts`, `v_my_work`, `mv_user_work_counts`, `v_inbox_triage`, `inbox_items` (×3),
`v_unassigned_work`, `sync_jobs`, `activity_events`, `connector_accounts`, `briefing_intel_snapshot`,
`sync_errors`, `rpc/lcc_briefing_research_progress`, `staged_intake_promotions`, `action_items` (×2) —
**a single composite "render the daily briefing / My Work dashboard" call, fired once, at exactly 12:30
UTC**, the send-time CLAUDE.md names for the briefing email. *(Cowork 2026-09-09: confirmed — this one IS the frozen build: UA `node`, 3 × 400 on views the current schema has changed; the live edge function's identical burst in the same minute has 0 errors.)* **This is a narrow, single-burst, fixed-time
fingerprint — one IP, one minute, one composite call** — unlike the broad multi-hour AWS traffic in §1,
and it is the caller class the runbook's step 1 needs to repoint.

**`20.49.123.20/21/22` (Azure) are a different, unrelated shape** — steady low-rate traffic spanning the
full 24h, not a burst. One 24h sample cannot tell whether this is a legitimate always-on service (e.g. a
Teams/Copilot connector polling) or something else; it is reported as **observed, not identified** —
Not on file which caller this is. It did not appear in the `briefing_intel_snapshot` path list, so it is
not the daily-briefing caller.

### 2d. Excluding the Cowork probe explicitly

```sql
select cast(timestamp as datetime) as ts, log_attributes['request.headers.cf_connecting_ip'] as ip,
       log_attributes['request.method'] as method, log_attributes['request.path'] as path
from logs where source='edge_logs'
  and timestamp >= '2026-09-08 21:43:00' and timestamp < '2026-09-08 21:45:00'
order by ts
```

was run informally against the same window covered by the broader queries above; no
`briefing_intel_snapshot` write appears at 21:43–21:44 UTC, confirming the six `net.http_get` reads
Cowork made from LCC Opps itself during the earlier verification (measured in CLAUDE.md's P194 note)
were reads only and did not mint a snapshot row. Those six calls are **excluded from every caller count
in this document** (they originate from LCC Opps' own `pg_net`, not from an external caller).

## 3. Same rotating pool exists on the other two projects (sanity check, not a full sweep)

One top-15-IP query per project (same 24h window):

- **Dialysis_DB**: top IP `162.220.232.128` (252,229 — Railway), then `152.55.176.45` (Railway), then
  `52.45.65.171` (670), `52.52.73.105` (215), `18.145.218.78` (129), `54.67.126.32` (97),
  `18.145.172.197` (90) — the same AWS-block ephemeral pool appears here too, at much lower relative
  volume. **Not deep-dived** (budget) — Dialysis_DB is not where `briefing_intel_snapshot` lives, so a
  path-level correlation to the daily-briefing caller was not run there.
- **government**: top IP `152.55.176.247` (Railway), then `108.235.254.15` (1,162 — a **residential/ISP
  block, not AWS** — Not on file who this is, flagged as a genuine unknown rather than assumed benign),
  then the same AWS pool (`54.67.126.32`, `52.45.65.171`, `18.145.172.197`, `52.53.160.6`,
  `54.193.53.254`, `54.151.19.74`, `18.145.218.78`, `54.176.250.51`, `13.57.191.53`, `54.215.250.109`,
  `18.145.155.172` — note several of these sit at an identical count of **220**, which reads as one
  scheduled batch job firing a fixed number of requests, not organic traffic).

Neither project was correlated to `briefing_intel_snapshot` (LCC-Opps-only table); the daily-briefing
finding in §2 is LCC-Opps-specific. The gov `108.235.254.15` residential IP is noted as an open
question, not resolved here — it is outside the scope of the Vercel-host inventory (it is not an AWS
address, so it is not a candidate for "the retired Vercel host") but is flagged for whoever next audits
gov traffic.

## 4. Candidate caller table (Unit 1b)

| caller | observed in logs (24h) | identified | repointed already | still live | notes |
|---|---|---|---|---|---|
| **Scheduled daily-briefing caller (~~10:00 write /~~ 12:30 read, matches Cowork "daily-briefing-cache" task pattern)** | **Yes — ~~1 write (201) +~~ 1 composite read burst (18 calls, 3 × 400)** *(the 10:00 write is the Supabase edge cron, UA `SupabaseEdgeRuntime` — struck, Cowork 2026-09-09)* | Pattern matches; exact process **Not on file** without Scott confirming the Cowork desktop task's configured target | No — still hitting `briefing_intel_snapshot` from the ephemeral pool at a fixed UTC time | **Yes** | See §2b/2c. 👤 Scott: open the Cowork desktop task "daily-briefing-cache" and read its configured URL verbatim (`docs/ops-logs/daily-briefing-cache-2026-09-01.md` §3 says it still names the Vercel host as of that date). |
| **iPhone Shortcut "Send to LCC"** | Not observed as a distinct fingerprint in this 24h window (no `/rest/v1/*` traffic correlates to a single-shot mobile-share POST pattern) | Repo side checked: **`/api/intake?_route=mobile-share` does NOT exist as a mounted route in `server.js`** (grepped `app.all/app.get/app.post` across the whole file — no `mobile-share` route). `docs/MOBILE_SHARE_INGESTION.md` (banner: STALE) names `POST /api/intake?_route=mobile-share` at `https://life-command-center-nine.vercel.app/...` as the configured target. | No | **Unknown — 👤 Scott must confirm** | Because Railway never mounted this route, if the Shortcut still points at Vercel it has **no live Railway target to repoint to today** — that route needs to be added to `server.js` (or the Shortcut retargeted to whatever route *does* exist) before step 1 of the runbook can "repoint" it. Flagging this as a blocker, not a routine repoint. |
| **Chrome/Edge extension** | Not distinguishable in Supabase logs from ordinary browser/API traffic (extension calls hit Railway/Vercel `/api/intake*`, not Supabase directly) | `extension/background.js` `pickIntakeHost()` reads `cfg.LCC_RAILWAY_URL \|\| cfg.LCC_VERCEL_URL` with `LCC_RAILWAY_URL` preferred first (line 39-40) — **Railway-first by construction** since the P194 fix. `extension/manifest.json` shipped version: **1.0.52**. | Yes, in the shipped repo code | Shipped build only repoints if the installed extension was updated after the P194 commit; **whether Scott's actually-installed build predates that commit cannot be known from the repo** — state as an open risk, not a clear. | Grep for the exact P194 commit: not re-derived here (out of budget) — cite CLAUDE.md's own dating of "P194, 2026-08-27" as the fix date; any install older than that commit still carries the seven hardcoded Vercel fallbacks. 👤 Scott: check `chrome://extensions` installed version ≥ what shipped after that commit. |
| **Copilot Studio / Teams agent (imported connector)** | Not observable from Supabase logs (Copilot Studio calls hit the connector's configured host directly, which may be Vercel, Railway, or the `ai-copilot` Dialysis edge function depending on which connector was imported) | Repo side: canonical connector file is **`copilot/lcc-deal-intelligence.connector.v4.swagger.json`** (v1 is superseded, at `_superseded/copilot/lcc-deal-intelligence.connector.v1.swagger.json`). Neither the v1 nor the v4 file's `host` field was present in a grep for a literal `"host"` key at repo root scope in this pass — **the connector's declared host needs to be read directly from the file before quoting it in the runbook** (see runbook step 1). | Unknown | **👤 Scott confirms in the Copilot Studio UI** | Per `docs/architecture/lcc-microsoft-copilot-outlook-audit-2026-05-22.md` cause #1 (cited in the prompt), the *imported* connector in Scott's tenant can carry a stale host independent of what the repo's canonical file says. |
| **Power Automate flows** | Not observed as a distinct Vercel-hostname hit in `docs/os/FLOW-REGISTRY.yaml` or the retained exports | `grep -i vercel docs/os/FLOW-REGISTRY.yaml` → **0 hits**. `unzip -p <zip> \| grep -i vercel` was run against the `private/power-automate/exports/production/2026-08-11/` zip set — **0 hits** across the sampled flows (see command below). | N/A (nothing found) | **Blind spot, stated per CLAUDE.md**: CLAUDE.md's own PLANNED-BACKLOG entries (DOCMAP2/DOCMAP3/PA5) already record that **3 flows exist outside both `FLOW-REGISTRY.yaml` and `retired_flows`** and are not individually named in the repo text searched in this pass — **which 3 could not be identified from the material available in this session's budget**. This is carried forward as a named boundary, not silently dropped. |
| **`outputs/daily-briefing-logs/` runner** | N/A — this is a static log file, not a live caller in Supabase | `outputs/daily-briefing-logs/2026-04-17-briefing-run.md` is the **only** file matching that path pattern anywhere in the repo (`find . -iname "*daily-briefing-logs*"` → one directory, one dated file). No script, `.github/workflows/*.yml`, or `Scheduled/` reference to `daily-briefing-logs` exists in the repo. | N/A | **Dead — a one-off log from 2026-04-17, not a live runner** | This is a historical artifact, not a caller to repoint. |

Power Automate zip check command used:
```
for z in private/power-automate/exports/production/2026-08-11/*.zip; do
  echo "== $z =="; unzip -p "$z" 2>/dev/null | grep -io vercel
done
```
returned no matches on the sampled 2026-08-11 export set (17 flows). Older/newer export dates under
`private/power-automate/exports/` were not exhaustively swept in this pass — flagged as a boundary.

## 5. Summary of what is and isn't proven here

- **Proven, with a query and a row**: the retired Vercel deployment is still executing a scheduled
  daily-briefing job against LCC Opps, ~~writing to `briefing_intel_snapshot` at a fixed UTC time
  (~10:00) and~~ rendering a composite dashboard read at ~12:30, from the AWS ephemeral-IP pool — ~~in a
  single 24-hour sample~~ on 4 of the 5 days 09-04 → 09-08 (not Fri 09-05, not Sat 09-06). *(Cowork
  2026-09-09: the 10:00 write is the `briefing-intel-snapshot` edge function — `user_agent`
  `SupabaseEdgeRuntime` — not Vercel. The frozen build READS; it does not write. Its tell is the 3 × 400.)*
- **Not proven / Not on file**: which physical caller (Cowork desktop task vs. some other scheduled
  process) issues that call — the pattern *matches* the "daily-briefing-cache" desktop task's known
  09-01 ops-log note, but this session cannot open Scott's desktop app to confirm the string. Marked
  👤 in the runbook.
- **Not measured**: a 14-day window (only 24h available per call, one call made); `postgres_logs`
  mutation correlation; a full Power-Automate-export sweep beyond the 2026-08-11 set; identification of
  the 3 undocumented flows; the `108.235.254.15` gov IP.
