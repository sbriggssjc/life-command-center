# RAILWAY-PA-SECRET-log — response

**Prompt:** `docs/claude-code/prompts/RAILWAY-PA-SECRET-log.md`

## What shipped

- `api/sync.js`: one new helper, `webhookAuth(req, res, routeName, opts)`, plus two small
  classifiers (`classifyCallerUa`, `classifyCallerIp`) mirroring the edge-side
  `caller-class.ts` shape. All seven `authenticateWebhook(req)`-gated handlers
  (`rcm-ingest`, `rcm-backfill`, `loopnet-ingest`, `listing-webhook`, `processing-complete`,
  `todo-completion-poll`, `cross-domain-match`) now call `webhookAuth` instead of
  `authenticateWebhook(req)` + their own copy of the fallback block.
- `PA_WEBHOOK_AUTH_MODE` (default `log`) and `PA_WEBHOOK_KNOWN_IPS` (default unset) are new,
  Railway-only env vars — nothing here changes any Supabase edge function.
- `test/pa-webhook-auth-mode.test.mjs` — 11 tests, structural (every handler dispatches through
  the helper; a positive control proves the detector would catch a direct call) + behavioural
  (log mode never 401s; enforce mode's 401 stands; the secret path never touches `authenticate()`;
  the DENY-WOULD line never carries a secret or api-key value; UA/IP classification).
- Docs: `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` §4a-Railway (new section, the env-var
  table + operator sequence); `docs/os/PLANNED-BACKLOG.md` RAILWAY-PA-SECRET row updated 🔴→🟡
  with this unit's scope marked done and the remaining operator steps stated; STATUS.md entry.

## What did NOT ship (deliberately, per the prompt's scope)

- No Railway environment variable was set. `PA_WEBHOOK_SECRET` remains unset on Railway; in
  `log` mode this change is a no-op for every caller until Scott sets it.
- No edit to the To Do Completion Poll Power Automate flow, and none of the three unexported
  PA5 flows (RCM Email Watcher, LoopNet, Personal Calendar Sync) were touched or exported.
- No change to the edge-side gates (COPILOT-OPEN, SFENRICH-gate).

## A count correction against the prompt

The prompt's header quoted "eight webhook routes" (`rcm-ingest`, `rcm-backfill`,
`loopnet-ingest`, `lead-ingest`, `live-ingest`, `listing-webhook`, `processing-complete`,
`todo-completion-poll`). Reading `api/sync.js` directly: `lead-ingest` is a proxy
(`proxyToLeadIngest`) that forwards headers to a Supabase edge function and never calls
`authenticateWebhook` itself — auth happens edge-side; `live-ingest` (`handleLiveIngest`) calls
plain `authenticate()` only, no webhook secret path at all. The actual population of
`authenticateWebhook(req)` call sites in this file is **seven**, and it includes one the
prompt's list omitted: `cross-domain-match` (`handleCrossDomainMatch`). The seven above are the
ones this unit touched; `grep -n "authenticateWebhook(req)" api/sync.js` after the change shows
exactly one live call (inside `webhookAuth` itself) plus the function's own declaration line.

## A design note not anticipated going in

`api/_shared/auth.js` reads `LCC_ENV` (and `LCC_API_KEY`) into module-level `const`s at import
time. A same-process re-import of `api/sync.js` via a cache-busting query string (`?probe=N`)
only re-runs `sync.js`'s OWN top-level code — Node resolves its relative `./_shared/auth.js`
import back to the identical cached module, because the query string lives on the importing
module's URL, not on the resolved relative specifier. So `auth.js`'s frozen `LCC_ENV` sticks at
whatever value was in effect the FIRST time any test in the file imported it, for the rest of the
process. The `enforce`-mode 401 assertion (the one behaviour that genuinely depends on
`authenticate()` seeing `LCC_ENV=production`) is therefore proven in a spawned child process
instead, matching how the real deployment actually works (env fixed for the process's whole
life). The other scenarios don't need this because they resolve inside `webhookAuth` before ever
reaching `authenticate()`.

## Verify

- `grep -n "authenticateWebhook(req)" api/sync.js` → line 74 (the declaration) and line 135
  (`if (authenticateWebhook(req)) return { ok: true, user: null };`, inside `webhookAuth`).
- `node --test test/pa-webhook-auth-mode.test.mjs` → 11/11 pass.
- `npm test` → 5598 pass / 0 fail / 6 skipped (unchanged skip count from before this change).
- With `PA_WEBHOOK_SECRET` unset locally, the seven handlers behave byte-for-byte as before this
  change (proven by the "PA_WEBHOOK_SECRET unset" test).
