# COPILOT-OPEN-gate — put a door on `ai-copilot` without breaking the two callers that legitimately use it

> **Measured 2026-09-09 from the DEPLOYED body (v79, Dialysis_DB), not the repo:** `ai-copilot` has **25 routes,
> one service-role client, and zero authentication anywhere** — no `authenticateWebhook`, no bearer or `apikey`
> check, no 401 path; CORS `*`; `verify_jwt:false`, so the gateway forwards anything. Open **write** routes:
> `POST /sync/activities`, `/sync/accounts`, `/sync/log-to-sf`, `/sync/sf-tasks`, `/sync/flagged-emails`,
> `/sync/calendar-events` (upsert + reconcile-delete), `/enrich`, `/bd/config`, `/bd/log-completion`,
> `/bd/auto-reschedule`, `/bd/route-task`. CI proved reachability by accident: 798 unauthenticated `POST /chat`
> in 24 h (TEST-NET-LEAK, fixed). **Caller inventory, 24 h** (`docs/claude-code/STATUS.md` 2026-09-09
> COPILOT-OPEN entry): the **browser** at Scott's address → `GET /health`, `/sync/sf-activities`,
> `/sync/calendar-events` (~570, `app.js` calls the edge URL directly); **four Power Automate flows** → `POST
> /sync/calendar-events|activities|sf-tasks|flagged-emails` (35, UA `azure-logic-apps/1.0 (workflow <id>)`);
> **Railway → 0**. Backlog **COPILOT-OPEN**. Sibling rows filed from the same read, NOT this unit:
> **COPILOT-SYNC-500**, **CAL-RECONCILE-STUCK**.

**Repo:** `life-command-center` · **Code: the edge function's router + `_shared/auth.ts` reuse, two front-end
files, tests. One deploy (`ai-copilot`, Scott). No migration, no schema, no Railway env change in this unit.**
Branch → PR → CI green → merge. **The gate ships in log-only mode; enforcement is a second flip after the
inventory is confirmed empty of unknowns.**

**Read first:** `supabase/functions/ai-copilot/index.ts` (the router — 40 lines) · `supabase/functions/_shared/auth.ts`
(`authenticateWebhook`, the door `intake-salesforce` uses) · `api/sync.js` lines ~60–75 (Railway's own
`PA_WEBHOOK_SECRET` + `authenticateWebhook`, and its `EDGE_FN_URL` calls at ~572 / 763 / 837 / 990 / 1367) ·
`app.js` lines 11, 6456, 6519, 6536, 7778, 8060 and `detail.js` 11096 (every direct browser call to the edge URL) ·
`CLAUDE.md` § P194 (a browser never holds a secret).

---

## Unit 1 — the door, in the router, in log-only mode

In `index.ts`, before dispatch, classify the request:

- `GET /health` → **always open** (it returns nothing sensitive — confirm by reading `handleHealth`; if it
  returns counts or config, it is not open).
- Everything else → `authenticateWebhook(req)` from `_shared/auth.ts` (`X-PA-Webhook-Secret` against the
  project's `PA_WEBHOOK_SECRET` — **the same secret value Railway holds**, already set on Dialysis_DB for
  `intake-salesforce`; do not invent a second one).
- Behaviour is governed by `COPILOT_AUTH_MODE` env: `log` (default in this PR) → on failure, log one structured
  line `[copilot-auth] DENY-WOULD method path ua_class ip_class` and **continue**; `enforce` → 401 with the
  existing `jsonResponse` shape. No other value; unset = `log`.
- `ua_class` ∈ `browser | logic-apps | node | other`, `ip_class` ∈ `railway | scott | other` — derive the
  Railway block and Scott's address from `Deno.env.get("COPILOT_KNOWN_IPS")` (comma list, set by Scott), never
  hardcode an address in source.

Log-only exists so the unknown callers show up in `function_logs` **before** anything is refused. The flip to
`enforce` is Scott's, after ≥ 3 days with zero `DENY-WOULD` lines from anything but the browser (Unit 2 moves the
browser off the edge, so that class should go to zero too).

## Unit 2 — the browser stops calling the edge directly

`app.js`/`detail.js` call `https://…/functions/v1/ai-copilot/...` with no credential because a browser cannot hold
one. Railway already proxies the same reads with the user's session in `api/sync.js` (`ingest_calendar`,
`ingest_sf_activities`, and the `EDGE_FN_URL` GETs). For each of the six direct calls: **name the Railway route
that returns the same shape**, and if one does not exist, add a thin `GET /api/copilot-read?what=sf-activities|
calendar-events|health` on `server.js` that forwards to the edge **with the secret header** and the existing
user auth (`api/_shared/auth.js`). Then repoint the six calls. The `API` const at `app.js:11` / `detail.js:11096`
goes away or points at Railway — grep for any other reader of it. **Positive control:** a test that fails if any
tracked front-end file contains `functions/v1/ai-copilot` (add the string to the J13a-guard fixture as a
`kind: "direct-edge-url"` identifier scoped to `app.js`/`detail.js`/`extension/`, replacement = the Railway route).

Note the consequence you are also fixing: COPILOT-SYNC-500's 15–30 % failure rate lands on these exact calls; once
they go through Railway, the failure is observable in Railway logs with a body, which is the measurement that row
needs. Do not fix the 500 here — make it visible.

## Unit 3 — the four PA flows (👤 Scott, from your spec)

Write `docs/architecture/flows/ai-copilot-sync-callers.md`: the four workflow ids from the inventory, the route
each POSTs, and the one change each needs — add header `X-PA-Webhook-Secret` = the value the "SF -> LCC: Object
Sync" flow already sends. Scott identifies each flow by opening it (the id is in the URL), adds the header, saves,
**re-exports** to `private/power-automate/exports/production/<date>/`, and you register them in
`FLOW-REGISTRY.yaml` (`state: verified_from_export`, `endpoint_families: [dialysis-ai-copilot-*]`) — resolving PA5's
"in neither list" for whichever of the four it turns out to be. **Never hand-edit exported flow JSON.**

## Unit 4 — tests (no network — the suite is hermetic now)

`test/ai-copilot-auth-gate.test.mjs` (structural, reads source like `test/intake-salesforce-sf-ping-auth.test.mjs`):
`/health` bypasses the gate; every other route is dispatched strictly after it; `log` mode never returns 401;
`enforce` mode returns 401 with no body detail beyond `unauthorized`; the log line never contains the header value.
Positive control: a synthetic router with the gate removed fails the "dispatched after" assertion.

## Unit 5 — docs

- `docs/architecture/edge-function-deploy-drift.md`: dated line — `ai-copilot` v79 → v80 gate (log-only), the
  env vars, the flip procedure.
- `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`: `PA_WEBHOOK_SECRET` now also consumed by `ai-copilot`;
  `COPILOT_AUTH_MODE`, `COPILOT_KNOWN_IPS`.
- `docs/os/PLANNED-BACKLOG.md` COPILOT-OPEN → 🟡 (log-only shipped; enforce pending Scott's 3-day read).
- STATUS entry; response `docs/claude-code/responses/COPILOT-OPEN-gate.response.md`.

---

## Out of scope — say so

- Flipping to `enforce` (Scott, after the log window).
- COPILOT-SYNC-500 and CAL-RECONCILE-STUCK (measured, filed, separate).
- Changing `AI_EXTRACTION_PRIMARY` or reading the Railway env (👤 — but ask Scott to report whether it is set,
  because "Railway made 0 edge calls in 24 h" has two explanations and only he can tell which).
- `salesforce-enrichment` (DRIFT1-sfenrich) — same gate pattern applies later; do not touch it here.

## Deliverables / Verify on

- Deploy: `supabase functions deploy ai-copilot --project-ref zqzrriwuavgrquhisnoa --no-verify-jwt` (v80). 👤
  Scott sets `COPILOT_KNOWN_IPS`; `PA_WEBHOOK_SECRET` is already present — **confirm with `supabase secrets list`,
  names only**.
- After deploy: one `curl` with no header → 200 and a `DENY-WOULD` line in `function_logs`; one with the header →
  200 and no line. Paste the log line (it must not contain the secret).
- Front-end: zero occurrences of `functions/v1/ai-copilot` outside `supabase/`, `api/`, `docs/`, `test/`.
- `npm test` green; 0 live calls (the net-guard would say otherwise).
