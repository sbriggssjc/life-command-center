# RAILWAY-PA-SECRET-log — response record

**Date:** 2026-09-10 (re-run of a unit a prior CC session completed but never pushed — see the
prompt's preamble and the STATUS entry for this date). Repo: `life-command-center`. Branch:
`claude/railway-pa-secret-log` (fresh checkout off `main`, not a continuation of the prior
session's local clone).

## What shipped

**Unit 1 — one helper, one log line, no behaviour change in `log` mode.**

`api/sync.js` gained `webhookAuth(req, res, routeName, opts)` immediately after the existing
`authenticateWebhook()` definition, and all seven call sites were rewritten to dispatch through it:

| handler | route name | `requireOperatorRole` |
|---|---|---|
| `handleRcmIngest` | `rcm-ingest` | true (default) |
| `handleRcmBackfill` | `rcm-backfill` | true (default) |
| `handleLoopNetIngest` | `loopnet-ingest` | true (default) |
| `handleProcessingComplete` | `processing-complete` | false |
| `handleTodoCompletionPoll` | `todo-completion-poll` | false |
| `handleListingWebhook` | `listing-webhook` | false |
| `handleCrossDomainMatch` | `cross-domain-match` | false |

Confirmed live via `grep -n "authenticateWebhook(req)" api/sync.js` before writing any code: **seven**
call sites, not eight — `lead-ingest` proxies straight to the `lead-ingest` edge function
(`proxyToLeadIngest`, no local webhook check) and `live-ingest` uses plain `authenticate()` with no
`authenticateWebhook` path at all. Neither was ever in this population; the prompt's preamble had
already corrected this from an earlier (wrong) count of eight, and this session verified it again
independently rather than trusting the correction unchecked.

Four of the seven never checked `requireRole(user, 'operator', ...)` in the original code
(`processing-complete`, `todo-completion-poll`, `listing-webhook`, `cross-domain-match` — read from
source before writing `webhookAuth`, not assumed) — `webhookAuth`'s `requireOperatorRole` option
preserves that per-handler difference rather than silently tightening four routes to require a role
they never did.

`handleListingWebhook` reads its resolved `user` downstream (workspace + `userId` stamping), so
`webhookAuth` returns `{ ok, user }`, not just a boolean.

**Mode semantics, exactly as specified:**
- `authenticateWebhook(req)` true (secret header matches, or `PA_WEBHOOK_SECRET` unset) → `{ok:true,
  user:null}`, fallback never runs, nothing is ever logged. This is the entire live-today behavior
  and it is unchanged.
- `PA_WEBHOOK_AUTH_MODE=enforce` (or the secret fails and mode is `enforce`) → calls
  `authenticate(req, res)` with the REAL `res`, applies `requireRole` when required, and returns
  `{ok:false}` on denial — byte-identical to the code every handler carried before this unit,
  because the real `res` gets the real 401/403.
- `PA_WEBHOOK_AUTH_MODE=log` (default) → probes the SAME fallback logic but against a throwaway stub
  `res` object, so a would-be 401/403 is never written to the real response; the request always
  proceeds (`ok:true`). This was a deliberate implementation choice beyond what the prompt spelled
  out mechanically: calling `authenticate(req, res)` with the real `res` and then *ignoring* a
  failure would still leave the 401 body already sent (Express-style `res.status(...).json(...)`
  sends immediately), so letting the request continue afterward would double-send. The stub-`res`
  probe is what makes "still allow, nothing changes" actually true rather than crashing on a second
  write.
- The `DENY-WOULD` line is only emitted when `PA_WEBHOOK_SECRET` is configured — with it unset,
  `authenticateWebhook` short-circuits before any of this runs, so nothing is ever logged.
- The log line never contains the secret or the caller's API key: it only ever names `routeName`,
  a header-derived `fallback-path` class (`jwt|api-key|none`), and UA/IP *classes* (never the raw
  UA or IP), which was asserted directly in the guard (see below), not merely inferred from the
  code shape.

**UA/IP classification** (`pawUaClass`, `pawIpClass`, `pawParseKnownIps`, `pawRequestIp`) mirrors
`supabase/functions/_shared/caller-class.ts` — same classification rules
(`azure-logic-apps`→`logic-apps`, `node`/`node-fetch`/`undici`→`node`,
`Mozilla|Chrome|Safari|Firefox`→`browser`, else `other`; `class:prefix` env format) reimplemented in
plain JS rather than imported, because this service is Node on Railway, not Deno — the two modules
cannot share an import, only the shape, as the prompt's Read-first note anticipated.

## Unit 2 — tests

`test/pa-webhook-auth-mode.test.mjs`, 9 tests, all passing in isolation and inside the full suite:

1. **Structural** (comment-stripped source scan): the token `authenticateWebhook(req)` appears
   exactly twice in the whole file — its own `function authenticateWebhook(req) {` definition and
   the single `if (authenticateWebhook(req))` call inside `webhookAuth()`. A positive control
   appends a synthetic handler that calls it directly and asserts the count moves to three, proving
   the assertion would actually catch a regression rather than passing vacuously.
2. `webhookAuth()`'s docstring names `PA_WEBHOOK_AUTH_MODE`, `'enforce'`, and `DENY-WOULD`.
3. Secret unset → the fallback never runs; a wrong `x-lcc-key` header still reaches the handler's
   own 500 (`DIA_SUPABASE_URL` unset); zero `[pa-webhook]` lines logged.
4. Log mode (default), secret set, wrong `x-lcc-key` → still no 401/403 (reaches the handler's own
   500); exactly one `DENY-WOULD` line, matching `^\[pa-webhook\] DENY-WOULD rcm-backfill api-key
   \S+ \S+$`.
5. Enforce mode, same inputs → real 401 with `{"error":"Invalid API key"}` (authenticate()'s own
   body, unchanged), and the same DENY-WOULD line is still logged.
6. Correct `X-PA-Webhook-Secret` passes in **both** modes with zero log lines — the byte-identical-
   behavior claim, checked in both directions.
7. A `requireOperatorRole:false` handler (`processing-complete`) with no credentials at all in log
   mode never 403s — reaches its own 400 validation instead.
8. The DENY-WOULD line is asserted, character-by-character, to never contain the configured secret
   value or the caller-supplied API-key value.
9. `PA_WEBHOOK_KNOWN_IPS` resolves the caller's IP to its configured class in the logged line.

Deterministic non-DB test strategy: rather than depending on `LCC_ENV`/`OPS_SUPABASE_URL`-driven
branches of `authenticate()` (which are captured as module-top-level `const`s in
`api/_shared/auth.js` and therefore order-dependent across the whole suite once that bare-URL module
is first imported by any test file), every test sends an `x-lcc-key` header that does not match the
(unset) `LCC_API_KEY` — `authenticate()`'s branch-2 "invalid API key" arm is reached unconditionally
regardless of environment or database state, giving a fully reproducible deny with fallback-path
`api-key`.

`npm test` run **before** handing off, per the prompt's explicit instruction that a single-file run
is not sufficient: **5,603 pass / 0 fail / 6 skipped** across 2,489 suites — the full-suite pass/fail
line, not just the new file's output.

## Unit 3 — docs

- `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` gained §4a-Railway, a new sub-table distinct from
  the existing Supabase-side `COPILOT_*`/`SFENRICH_*` pair, naming `PA_WEBHOOK_SECRET`,
  `PA_WEBHOOK_AUTH_MODE`, `PA_WEBHOOK_KNOWN_IPS` and the operator order.
- `docs/os/PLANNED-BACKLOG.md`'s `RAILWAY-PA-SECRET` row moved 🔴 → 🟡, records this unit's
  completion (branch/PR, guard, suite result) and restates the 👤 operator sequence: merge → redeploy
  → set the variable (+ known IPs) → read `DENY-WOULD … none` for ~3 days → fix each `none` caller
  (To Do Completion Poll's second call first) → flip to `enforce`.
- `docs/claude-code/STATUS.md` gained a 2026-09-10 entry (prepended, newest-first) naming this as the
  re-run and explaining why the prior session's work is not recoverable.

## Out of scope (named, not silently skipped)

- Setting any Railway environment variable — 👤 Scott, after merge.
- The To Do Completion Poll flow's second, header-less call — 👤 Scott, Power Automate designer edit
  + re-export (never hand-edited).
- Exporting the three PA5 flows (RCM Email Watcher, LoopNet, Personal Calendar Sync) — 👤 Scott.
- The edge-side gates (COPILOT-OPEN, SFENRICH-gate) — already shipped and live as of 2026-09-09; not
  touched by this unit.
- `proxyToLeadIngest` and `handleLiveIngest` — confirmed out of scope by source read, not guessed.

## Verify on

- `grep -n "authenticateWebhook(req)" api/sync.js` → two lines: the definition (74) and the single
  call inside `webhookAuth` — pasted above and in the guard test itself.
- `grep -n "await webhookAuth(" api/sync.js` → seven lines, one per handler, each named.
- With `PA_WEBHOOK_SECRET` unset locally: behavior is byte-identical to before this unit (test 3).
- Full `npm test`: **5,603 pass / 0 fail / 6 skipped**, 2,489 suites.
- Branch pushed to `origin` and a PR opened for this change — confirmed before ending the session,
  not assumed, given the prior attempt's failure mode was exactly "did the work, never pushed it."
