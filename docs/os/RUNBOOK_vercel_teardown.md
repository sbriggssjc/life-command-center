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
  sidebar capture's `POST` lands from a Railway IP (the extension itself has no separate "repoint" step
  once the installed build is current — `pickIntakeHost()` already prefers `LCC_RAILWAY_URL`).
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
