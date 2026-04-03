# Vercel Secret Usage Audit (LCC)

Date: 2026-04-02  
Repo: `life-command-center`  
Scope: code references and runtime behavior for:
- `WEBEX_CLIENT_ID`
- `WEBEX_CLIENT_SECRET`
- `WEBEX_REFRESH_TOKEN`
- `WEBEX_ACCESS_TOKEN`
- `OPS_SUPABASE_URL`
- `OPS_SUPABASE_KEY`
- `GOV_SUPABASE_URL`
- `GOV_SUPABASE_KEY`
- `DIA_SUPABASE_URL`
- `DIA_SUPABASE_KEY`

## Method
- Searched all repo files for exact env var references.
- Verified runtime behavior in active API modules under `api/*` and shared modules under `api/_shared/*`.
- Classified each variable for required/optional behavior, fallback behavior, and fail-open vs fail-closed behavior.
- Excluded secret values; only code-path analysis is included.

## High-Level Findings
- All listed variables are referenced in code.
- `OPS_SUPABASE_URL` + `OPS_SUPABASE_KEY` are foundational for canonical ops DB and auth user resolution.
- `GOV_*` and `DIA_*` keys are service-role style backend credentials used server-side for domain reads/writes.
- `WEBEX_*` variables are used for outbound WebEx API auth/token refresh in contact and messaging flows.
- There is already an API-key auth pattern in LCC (`LCC_API_KEY` via `X-LCC-Key`) and it should be reused, not replaced.
- A transitional auth fallback exists when `LCC_API_KEY` is unset (`api/_shared/auth.js`), which is risky in production.

## Per-Variable Audit

### `WEBEX_CLIENT_ID`
- Referenced in code: Yes
- File(s) and function(s):
  - `api/contacts.js` -> `refreshWebexToken(refreshToken)`
- Depends on feature/workflow:
  - OAuth refresh grant for WebEx token lifecycle used by call ingest and WebEx/SMS messaging flows.
- Required or optional:
  - Required for refresh path only.
  - Not required if a still-valid `WEBEX_ACCESS_TOKEN` is already available and never refreshed.
- Fallback if missing:
  - None in refresh flow (`refreshWebexToken` returns `null` if missing).
- Fail-open vs fail-closed:
  - Fails closed for refresh-capable behavior; downstream WebEx actions can return `503` when token cannot be obtained.
- Production safety:
  - Safe as server-only env usage.
  - Operational risk: missing credentials causes token refresh outage.

### `WEBEX_CLIENT_SECRET`
- Referenced in code: Yes
- File(s) and function(s):
  - `api/contacts.js` -> `refreshWebexToken(refreshToken)`
- Depends on feature/workflow:
  - Same as `WEBEX_CLIENT_ID` (OAuth refresh grant).
- Required or optional:
  - Required for refresh flow.
- Fallback if missing:
  - None in refresh flow.
- Fail-open vs fail-closed:
  - Fail-closed for refresh; WebEx ingestion/messaging degrades with `503` when token unavailable.
- Production safety:
  - Safe server-side usage; must remain secret.

### `WEBEX_REFRESH_TOKEN`
- Referenced in code: Yes
- File(s) and function(s):
  - `api/contacts.js` -> `getWebexToken()`, `refreshWebexToken(refreshToken)`, `upsertWebexToken(...)`
- Depends on feature/workflow:
  - Refreshes expired WebEx access token; supports continuity of:
    - `ingest_webex_calls`
    - WebEx message read/send
    - SMS read/send via WebEx
- Required or optional:
  - Optional if a valid non-expired access token is always present.
  - Practically required for reliable long-running production behavior.
- Fallback if missing:
  - DB-stored refresh token in `system_tokens.refresh_token` can be used first.
- Fail-open vs fail-closed:
  - Fails closed for token refresh when both DB and env refresh token are absent/invalid.
- Production safety:
  - Safe server usage.
  - Risk: `.env.example` currently documents `WEBEX_ACCESS_TOKEN` but not refresh/client vars, increasing misconfiguration risk.

### `WEBEX_ACCESS_TOKEN`
- Referenced in code: Yes
- File(s) and function(s):
  - `api/contacts.js` -> `getWebexToken()`
  - `api/contacts.js` -> `getWebexMessages(...)`, `sendWebexMessage(...)`, `getSmsMessages(...)`, `sendSmsMessage(...)`
- Depends on feature/workflow:
  - WebEx APIs for call history ingest, WebEx messaging, and SMS features.
- Required or optional:
  - Required for direct messaging endpoints.
  - For ingest path, token may also be obtained via refresh flow.
- Fallback if missing:
  - `getWebexToken()` can use DB token and refresh flow (`WEBEX_REFRESH_TOKEN` + client credentials).
- Fail-open vs fail-closed:
  - Messaging/read endpoints fail closed with `503` if token absent.
- Production safety:
  - Safe server-only use in current code.
  - Reliability risk if token rotation/refresh config is incomplete.

### `OPS_SUPABASE_URL`
- Referenced in code: Yes
- File(s) and function(s):
  - `api/_shared/auth.js` -> `verifySupabaseJwt`, `resolveUser`, `resolveFirstOwner`, `resolveDevUser`, `authenticate`
  - `api/_shared/ops-db.js` -> `opsUrl`, `isOpsConfigured`, `opsQuery`, `requireOps`
- Depends on feature/workflow:
  - Canonical ops data access and user/workspace auth resolution across major APIs.
- Required or optional:
  - Required for normal production ops DB behavior.
  - Transitional fallback behavior exists if missing.
- Fallback if missing:
  - Auth can return synthetic/default dev user in non-production-like transitional mode when `LCC_API_KEY` is unset.
- Fail-open vs fail-closed:
  - Many handlers with `requireOps(res)` fail closed (`503`) when missing.
  - Auth path can fail open (transitional) if `LCC_API_KEY` is not configured.
- Production safety:
  - Safe if configured and transitional mode is disabled (set `LCC_API_KEY` and enforce real auth).
  - Risk if left unset in production-like environments.

### `OPS_SUPABASE_KEY`
- Referenced in code: Yes
- File(s) and function(s):
  - `api/_shared/auth.js` -> `verifySupabaseJwt`, `resolveUser`, `resolveFirstOwner`, `resolveDevUser`, `authenticate`
  - `api/_shared/ops-db.js` -> `opsKey`, `isOpsConfigured`, `opsQuery`, `requireOps`
- Depends on feature/workflow:
  - Server-side ops table reads/writes and membership/role resolution.
- Required or optional:
  - Required for canonical ops DB use.
- Fallback if missing:
  - Same transitional auth fallback behavior as above when `LCC_API_KEY` is unset.
- Fail-open vs fail-closed:
  - Mostly fail-closed (`503`) in handlers using `requireOps`.
  - Transitional auth fallback can still admit requests if API key is unset.
- Production safety:
  - Safe server-side credential use.
  - High risk if combined with transitional auth in production.

### `GOV_SUPABASE_URL`
- Referenced in code: Yes
- File(s) and function(s):
  - `api/data-proxy.js` -> source selection and GOV read/write proxy path
  - `api/apply-change.js` -> `SOURCE_CONFIG.gov` mutation routing
  - `api/contacts.js` -> GOV DB backing for unified contacts and token table
  - `api/bridge.js` -> `fetchPortfolioStats()` optional gov stats enrichment
  - `api/diagnostics.js` -> config/diag checks
  - plus legacy/non-primary files: `gov-query.js`, `diag.js`, `app.js`, Python pipeline scripts
- Depends on feature/workflow:
  - Government-domain query/mutation/proxy and contacts-related gov storage.
- Required or optional:
  - Required for GOV data-proxy/apply-change/contacts operations.
  - Optional for chat stat enrichment path in `api/bridge.js`.
- Fallback if missing:
  - No runtime URL fallback in primary `api/*` handlers.
  - Legacy files include hardcoded default URLs (not primary path).
- Fail-open vs fail-closed:
  - Primary handlers fail closed (`500/503`) when missing.
  - `api/bridge.js` stats enrichment degrades gracefully (non-fatal).
- Production safety:
  - Safe in primary API path.
  - Risk: duplicate legacy files with hardcoded URL defaults can create ambiguity.

### `GOV_SUPABASE_KEY`
- Referenced in code: Yes
- File(s) and function(s):
  - Same modules as `GOV_SUPABASE_URL` for gov operations.
- Depends on feature/workflow:
  - Auth header (`apikey` + bearer) for server-side gov Supabase operations.
- Required or optional:
  - Required for most GOV reads/writes.
- Fallback if missing:
  - No key fallback in primary API routes.
- Fail-open vs fail-closed:
  - Primary GOV operations fail closed (`500/503`) when missing.
- Production safety:
  - Safe server-side service-role usage.
  - Important: do not expose in client code; current usage is server-side only.

### `DIA_SUPABASE_URL`
- Referenced in code: Yes
- File(s) and function(s):
  - `api/data-proxy.js` -> DIA read/write proxy path
  - `api/apply-change.js` -> `SOURCE_CONFIG.dia` mutation routing
  - `api/sync.js` -> RCM/LoopNet ingest, backfill, lead-health checks, DIA writes
  - `api/bridge.js` -> `fetchPortfolioStats()` optional dia stats
  - `api/diagnostics.js` -> config/diag checks
  - plus legacy/non-primary files: `dia-query.js`, `diag.js`, `app.js`
- Depends on feature/workflow:
  - Dialysis-domain proxy and lead ingestion pipelines.
- Required or optional:
  - Required for DIA data writes/reads in sync/proxy/apply-change paths.
  - Optional for chat stat enrichment.
- Fallback if missing:
  - No primary runtime fallback.
  - Legacy files include hardcoded default URL fallback.
- Fail-open vs fail-closed:
  - Primary DIA operations fail closed (`500/503`) when missing.
  - Bridge stat enrichment degrades gracefully.
- Production safety:
  - Safe in primary paths; ambiguity risk from legacy duplicate patterns.

### `DIA_SUPABASE_KEY`
- Referenced in code: Yes
- File(s) and function(s):
  - Same primary modules as `DIA_SUPABASE_URL`, especially `api/sync.js` handlers:
    - `handleRcmIngest`
    - `handleRcmBackfill`
    - `handleLoopNetIngest`
    - `handleLeadHealth`
- Depends on feature/workflow:
  - Service-role auth for DIA domain writes and readbacks in ingestion flows.
- Required or optional:
  - Required for DIA sync/proxy/mutation behavior.
- Fallback if missing:
  - No key fallback in primary routes.
- Fail-open vs fail-closed:
  - Fail-closed for domain DB operations.
- Production safety:
  - Safe server-side usage.
  - High impact secret; should stay strictly server-only.

## Variables That Already Behave Like Internal API/Auth Keys

Within the listed variables:
- `OPS_SUPABASE_KEY`, `GOV_SUPABASE_KEY`, and `DIA_SUPABASE_KEY` function as privileged backend API credentials to Supabase REST endpoints (server-to-server).
- These are not intended as client-to-LCC inbound auth headers.

Existing inbound API-key auth pattern already present in repo:
- `LCC_API_KEY` in `api/_shared/auth.js`
- Header: `X-LCC-Key` (read as `x-lcc-key`)
- Verification: constant-time comparison in `verifyApiKey`

Conclusion:
- There is already an established internal API auth key pattern for LCC endpoints.

## Should a New `LCC_API_KEY` Be Created?

Recommendation: **Do not introduce a new key name/pattern. Reuse existing `LCC_API_KEY` + `X-LCC-Key`.**

Why:
- It already exists and is integrated in shared auth middleware (`api/_shared/auth.js`).
- Current Power Automate flow assets in repo already use `x-lcc-key`.
- Introducing another API key variable would increase drift and confusion.

Required hardening:
- Ensure `LCC_API_KEY` is set in production/staging.
- Do not rely on transitional fallback auth mode.

## Risks Identified

1. Transitional auth fallback (high)
- `api/_shared/auth.js` allows a default/transitional user when `LCC_API_KEY` is unset.
- This is a fail-open posture for protected routes that call `authenticate`.

2. Transitional webhook fallback in sync routes (high)
- `api/sync.js` `authenticateWebhook(req)` returns `true` when `PA_WEBHOOK_SECRET` is unset.
- For webhook routes (`_route=rcm-ingest`, `_route=rcm-backfill`, `_route=loopnet-ingest`), this can permit unauthenticated webhook access unless the secret is configured.

3. Weak default for diagnostics secret (medium)
- `api/diagnostics.js` uses fallback default `DIAG_SECRET = 'lcc-diag-2024'` if unset.
- Combined with any authenticated session/API-key access, this is weaker than required production posture.

4. Legacy/duplicate env access patterns (medium)
- Legacy files (`gov-query.js`, `dia-query.js`, `diag.js`, `app.js`) include fallback URLs and older patterns.
- Primary API path is under `api/*`, but duplicate patterns increase maintenance and ownership ambiguity.

5. Config exposure reconnaissance (low)
- `/api/config` reports connected status booleans without auth.
- No secret values exposed, but can aid environment reconnaissance.

## Existing Pattern to Reuse Instead of New `LCC_API_KEY`

Reuse:
- `LCC_API_KEY` + `X-LCC-Key`
- Optionally include:
  - `X-LCC-User-Email` or `X-LCC-User-Id` for deterministic dev user resolution
  - `X-LCC-Workspace` for workspace context

Do not reuse Supabase service-role keys for inbound LCC auth.

## Recommended Auth Approach for Power Automate -> LCC API Calls

1. Primary endpoint auth
- Use existing `LCC_API_KEY` in `X-LCC-Key` for Power Automate calls to protected LCC endpoints (`/api/intake-outlook-message`, `/api/intake-summary`, `/api/sync?action=...` where applicable).
- Include `X-LCC-Workspace` and one identity header (`X-LCC-User-Email` preferred) so auth resolves a deterministic user/workspace.

2. Webhook-style routes
- For webhook ingestion routes in `api/sync.js` (`_route=rcm-ingest`, `_route=rcm-backfill`, `_route=loopnet-ingest`), also configure and send `X-PA-Webhook-Secret` backed by `PA_WEBHOOK_SECRET`.
- Do not leave `PA_WEBHOOK_SECRET` unset.

3. Production enforcement checklist
- Set `LCC_API_KEY` in Vercel (staging + production) to disable transitional no-key fallback.
- Set `PA_WEBHOOK_SECRET` for webhook routes.
- Set `DIAG_SECRET` to a strong random value.
- Keep `OPS/GOV/DIA` service-role keys server-only and never passed from Power Automate clients.

4. Recommendation summary
- **Reuse existing `LCC_API_KEY` pattern; do not introduce another new inbound API key pattern.**

