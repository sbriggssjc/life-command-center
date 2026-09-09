# RAILWAY-PA-SECRET-log — a log-only mode for Railway's webhook door, so `PA_WEBHOOK_SECRET` can be set without guessing who breaks

> **Measured 2026-09-09.** After the COPILOT-OPEN-gate Railway redeploy, every Railway→`ai-copilot` call logs
> `DENY-WOULD … node railway`, and the new `connectorHeaders()` attaches `X-PA-Webhook-Secret` only when
> `PA_WEBHOOK_SECRET` is present — so the variable is (Derived) **unset on tranquil-delight**. That matters more
> than the copilot gate: `api/sync.js::authenticateWebhook` line 76 is `if (!PA_WEBHOOK_SECRET) return true;`, and
> the eight webhook routes are shaped `if (!authenticateWebhook(req)) { user = await authenticate(req,res);
> requireRole('operator') }` — with the variable absent the fallback **never runs** and the routes are open.
> Reading all 17 flow exports (51 HTTP actions): **no PA flow sends the secret to Railway**; they send `x-lcc-key`
> or a bearer, which the fallback accepts. Setting the variable would therefore refuse only callers sending
> *neither* — one known (the To Do Completion Poll's second, header-less call) and three unknown (the unexported
> PA5 flows: RCM Email Watcher, LoopNet, Personal Calendar Sync). **This unit makes that population visible
> before anything is refused** — the COPILOT-OPEN-gate shape, on Railway. Backlog **RAILWAY-PA-SECRET**.

**Repo:** `life-command-center` · **Code: `api/sync.js` (one helper, eight call sites), tests. No Railway env
change in this PR — Scott sets the variable after merge. No edge function, no migration.** Branch → PR → CI
green → merge → redeploy both Railway services.

**Read first:** `api/sync.js` lines 60–90 (`PA_WEBHOOK_SECRET`, `authenticateWebhook`), the eight webhook handlers
(`grep -n "authenticateWebhook(req)" api/sync.js` → rcm-ingest, rcm-backfill, loopnet-ingest, lead-ingest,
live-ingest, listing-webhook, processing-complete, todo-completion-poll) · `supabase/functions/ai-copilot/index.ts`
lines 1–80 (the log-line format and classifier to mirror) · `docs/claude-code/STATUS.md` 2026-09-09
"Read the 17 flow exports" entry (the table of who sends what).

---

## Unit 1 — one helper, one log line, no behaviour change in `log` mode

Add `webhookAuth(req, res, routeName)` in `api/sync.js` and route the eight handlers through it:

1. `authenticateWebhook(req)` true → return `{ ok:true, path:'secret' }`.
2. Else run the existing fallback (`authenticate` + `requireRole('operator')`). Record `path:'api-key' |
   'jwt' | 'none'` from what `authenticate()` matched (it already distinguishes `x-lcc-key` from a bearer JWT —
   read it; do not re-implement).
3. **When `PA_WEBHOOK_SECRET` is set and the header was absent or wrong**, log exactly one line
   `[pa-webhook] DENY-WOULD <route> <fallback-path> <ua_class> <ip_class>` — where `fallback-path` says what the
   fallback found. `ua_class`/`ip_class` mirror the edge gate's classes; read the known-IP list from
   `PA_WEBHOOK_KNOWN_IPS` (same `class:prefix` format, never a literal address in source).
4. `PA_WEBHOOK_AUTH_MODE`: `log` (default) → if the fallback also failed, **still allow** (the request proceeds
   exactly as today) but the line says `none`; `enforce` → the fallback's own 401/403 stands. Unset = `log`.

The important property: in `log` mode, with the variable set, **nothing changes for any caller** — Railway starts
*sending* the secret (that is `connectorHeaders()`, already shipped), and the log shows who would be refused
under `enforce`. A `none` line is the only thing that predicts a break.

**Do not touch** `authenticate()` itself or the API-key path — if `LCC_API_KEY` turns out to be unset on Railway,
the log will say `none` for every `x-lcc-key` flow and that becomes its own operator item; it is not this unit's
to fix.

## Unit 2 — tests (`test/pa-webhook-auth-mode.test.mjs`, no network)

Structural + behavioural with a stubbed `authenticate`: all eight handlers dispatch through `webhookAuth`
(positive control: a synthetic handler that calls `authenticateWebhook` directly fails the assertion); `log`
mode never returns 401 from the helper; `enforce` returns the fallback's status; the log line never contains the
secret or the API key; with `PA_WEBHOOK_SECRET` unset the helper logs nothing and allows (today's behaviour, so
the deploy before the variable lands is a no-op).

## Unit 3 — docs

- `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` §4a → add a Railway sub-table: `PA_WEBHOOK_SECRET` (to set),
  `PA_WEBHOOK_AUTH_MODE`, `PA_WEBHOOK_KNOWN_IPS`; state plainly that Supabase and Railway are two environments
  holding one value.
- `docs/os/PLANNED-BACKLOG.md` RAILWAY-PA-SECRET → 🟡 with the operator order: merge → redeploy → set the
  variable + known IPs → 3-day read of `[pa-webhook] DENY-WOULD … none` → fix each `none` caller (starting with
  the To Do poll's second call, in the designer, re-export) → `enforce`.
- STATUS entry; response `docs/claude-code/responses/RAILWAY-PA-SECRET-log.response.md`.

---

## Out of scope — say so

- Setting any Railway variable (Scott, after merge).
- The To Do Completion Poll flow edit (Scott, designer + re-export; never hand-edit the JSON).
- Exporting the three PA5 flows (Scott) — but name them as the callers this log will identify.
- The edge-side gates (COPILOT-OPEN, SFENRICH-gate).

## Verify on

- `grep -n "authenticateWebhook(req)" api/sync.js` → only inside `webhookAuth` (paste).
- With `PA_WEBHOOK_SECRET` unset locally: the eight handlers behave byte-for-byte as before (the test proves it).
- `npm test` green, 0 live calls.
