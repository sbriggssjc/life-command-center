# EDGE-GATES1 — caller inventory for the log-only auth gate

Companion to `docs/claude-code/prompts/done/COPILOT-OPEN-gate.md` and
`.../done/SFENRICH-gate.md` (the two prior rounds this one replicates), and modeled on
`ai-copilot-sync-callers.md`. Covers the 16 named `supabase/functions/` targets on the
Dialysis_DB project (`zqzrriwuavgrquhisnoa`) reviewed for EDGE-GATES1.

## What shipped

Same pattern as `ai-copilot` / `salesforce-enrichment`: `authenticateWebhook()`
(`_shared/auth.ts`, constant-time `X-PA-Webhook-Secret` vs `PA_WEBHOOK_SECRET`; returns
`true` — i.e. allow — whenever the secret env var is unset, which is the state on every
one of these functions today) plus the shared UA/IP classifier (`_shared/caller-class.ts`).
Every gated function checks the credential; on failure it logs
`[<fn>-auth] DENY-WOULD <method> <path> <ua_class> <ip_class>` and, in `log` mode (the
default, and the only mode this round ever sets), **still lets the request through**. Only
`<PREFIX>_AUTH_MODE=enforce` would ever 401 — nothing here sets that, on any function.

## Measured verdict per function

| function | had a real check before? | writes? | verdict | new gate | deployed version |
|---|---|---|---|---|---|
| `context-broker` | no (comment said "Authenticate" but body fell straight to work) | yes (writes `entities`/context rows) | **gate** | log-only `CONTEXT_BROKER_AUTH_MODE` | v21 |
| `template-service` | no | yes (template records) | **gate** | log-only `TEMPLATE_SERVICE_AUTH_MODE` | v19 |
| `intake-receiver` | `authenticateUser()` only — the fake gate (always resolves a transitional user regardless of credential) | yes (intake rows) | **gate** | log-only `INTAKE_RECEIVER_AUTH_MODE` | v20 |
| `lead-ingest` | real, enforced check already in the deployed body | yes | **no new gate needed** | — | unchanged |
| `intake-salesforce` | real check; also carries a DRIFT1 header warning future editors to re-diff against the live v8 body before ever redeploying from the repo copy | yes | **no new gate needed — and NOT redeployed** (see Parking Lot) | — | unchanged |
| `intake-salesforce-files` | real, enforced check | yes | **no new gate needed** | — | unchanged |
| `sf-promotion-worker` | real, enforced check | yes | **no new gate needed** | — | unchanged |
| `npi-registry-sync` | its own independent `authOk()` real check | yes | **no new gate needed** | — | unchanged |
| `calendar-ics-sync` | no | yes (writes `calendar_events`) | **gate** | log-only `CALENDAR_ICS_SYNC_AUTH_MODE` | v21 |
| `calendar-caldav-sync` | no | yes (writes `calendar_events` from Scott's whole iCloud account) | **gate** | log-only `CALENDAR_CALDAV_SYNC_AUTH_MODE` | v26 |
| `calendar-caldav-push` | no on the write/admin routes; `probe`/`preview` are read-only diagnostics and deliberately stay open (mirrors `ai-copilot`'s `/health` exemption) | yes — including `?retire_force=`/`?retire_empty=1`, which **delete an iCloud calendar outright** | **gate** (everything except `probe`/`preview`) | log-only `CALENDAR_CALDAV_PUSH_AUTH_MODE` | v24 |
| `calendar-capture` | no | yes (writes `calendar_events`) | **gate** | log-only `CALENDAR_CAPTURE_AUTH_MODE` | v15 |
| `w41-corpus-export` | real, enforced check | read-only export | **no new gate needed** | — | unchanged |
| `w43-sf-link-export` | real, enforced check | read-only export | **no new gate needed** | — | unchanged |
| `w44-retrain-tick` | real, enforced check already present | writes model artifacts | **no new gate needed** | — | unchanged |
| `data-query` | `requireRole(user,'viewer',wsId)` on every request, backed by `authenticateUser()` (the fake-gate identity resolver) — real ROLE check, unverifiable IDENTITY underneath | yes, on non-GET (`gov-write`/`gov-evidence` sub-routes); GET reads are the huge allowlisted proxy traffic and were left untouched | **gate the non-GET branch only** | log-only `DATA_QUERY_AUTH_MODE`, scoped to `req.method !== "GET"` | v44 |

8 of 16 got a new gate; 8 already had a real check (or, for `data-query`, a real-but-narrow
one that this round tightened without touching the read path).

## Caller breakdown (24h window, `function_edge_logs`, this project)

Read from `logs` (`source='function_edge_logs'`), keyed on `request.pathname` /
`request.method` / `request.headers.user_agent` / `request.headers.cf_connecting_ip` /
`request.cf.asOrganization` / `response.status_code`. No `DENY-WOULD` lines were emitted for
any of the 8 gated functions in this window, because `PA_WEBHOOK_SECRET` is unset on all of
them — `authenticateWebhook()` returns `true` (allow) before the classifier ever runs. This
section is therefore a **caller census**, not a denial census — it exists to identify who
the header/config edit in the next section is for.

| function | callers seen (24h) | reads what |
|---|---|---|
| `calendar-caldav-push` | **24 POST** from `54.176.149.5` (Amazon, `pg_net/0.14.0`), 200s throughout | `pg_net` from an LCC Opps pg_cron job — the scheduled write-back sweep |
| `calendar-caldav-sync` | **12 POST** from `54.176.149.5` (Amazon, `pg_net/0.14.0`), 200s | same — pg_cron via `pg_net` |
| `calendar-ics-sync` | **24 POST** from `54.176.149.5` (Amazon, `pg_net/0.14.0`), 200s | same — pg_cron via `pg_net` |
| `data-query` | **~1,500 GET** across a dozen-plus Railway IPs (`152.55.176.x` / `152.55.178.x` / `162.220.232.x`, `ua=node`) — the stable Railway address pool this repo's CLAUDE.md documents — plus a handful of AWS-hosted `node` callers (`54.193.141.168`, `52.9.113.20`, `98.81.58.40`) and 4 `500`s scattered in the same pool | the `/api/dia-query` proxy's normal read traffic; untouched by this round (GET only) |
| `context-broker`, `template-service`, `intake-receiver`, `calendar-capture` | **0 requests** in the 24h window checked | no live callers observed in-window; do not read this as "unused" — a cron/flow caller could simply not have fired in this specific 24h slice |

**What this means for ever flipping to `enforce`:** the three `pg_net` calendar callers are
the ones an `enforce` flip would need to survive. `pg_net` is invoked from
`lcc_cron_post()`-style SQL functions on LCC Opps, which currently send no
`X-PA-Webhook-Secret` header. Before any of `CALENDAR_ICS_SYNC_AUTH_MODE`,
`CALENDAR_CALDAV_SYNC_AUTH_MODE`, or `CALENDAR_CALDAV_PUSH_AUTH_MODE` could move to
`enforce`, the calling `pg_net.http_post` command(s) need a `headers` argument adding
`X-PA-Webhook-Secret: <value>` matching a real `PA_WEBHOOK_SECRET` set on the function, and
that secret needs to live in Supabase Vault the way `lcc_cron_post` already reads its
Railway API key. `data-query`'s non-GET branch is called by Railway's own `admin.js` proxy
(`api/admin.js` `DATA_QUERY_EDGE_URL`) — that caller already has a service-role-adjacent
position and would need the same header added to its outbound POSTs before an `enforce`
flip. `context-broker`, `template-service`, `intake-receiver` and `calendar-capture` need a
longer observation window before anyone can say who calls them at all, let alone what those
callers would need.

## Not touched, per the hard prohibitions

- `ai-copilot` and `salesforce-enrichment` — out of scope for this round, unmodified.
- No `<FN>_AUTH_MODE` was ever set to `enforce` on any function, here or previously.
- `data-query`'s `GET` (read/proxy) path is byte-identical in behavior; only the non-GET
  branch gained the check.
