# SF-DIRECT — rebuild the direct-Salesforce capability `sf-test` proved

2026-09-09. Code shipped; live deploy + first `sf-ping` run is Scott's operator step (documented
below). Backlog row: `docs/os/PLANNED-BACKLOG.md` → **SF-DIRECT** (🟡 until the first live run is
recorded).

## What shipped

1. **`supabase/functions/_shared/salesforce-soap.ts`** — dependency-free Deno client:
   - `sfLogin()` — POSTs a SOAP `login` envelope to `https://${SF_LOGIN_HOST}/services/Soap/u/${SF_API_VERSION}`
     (defaults `login.salesforce.com` / `61.0`), password = `SF_PASSWORD` + `SF_SECURITY_TOKEN`
     concatenated (the SOAP convention). Returns `{ sessionId, serverUrl, instanceUrl, userId }`.
   - `sfQuery(session, soql)` — GETs the REST Query API at `${instanceUrl}/services/data/v${version}/query`
     with `Authorization: Bearer <sessionId>` — the SOAP session id is valid for the REST API, which is
     what makes the SOAP login worth having with no Connected App.
   - `buildLoginEnvelope` / `parseLoginResponse` are exported PURE functions (no I/O) so the fault
     path and the success path are both testable without a network call.
   - `SfAuthError` carries the SOAP **fault code** only — never the fault string verbatim (it can
     echo submitted input), never the envelope, never the session id or password.
   - `SF_LOGIN_HOST` toggles sandbox vs production without a code change.

2. **`intake-salesforce?action=sf-ping`** (GET) — added to the existing `intake-salesforce` edge
   function, behind the **same** `authenticateWebhook()` gate every other action in that file uses
   (the gate runs once, before the GET/POST switch — there is no separate per-action door to add).
   Calls `sfLogin()` then `sfQuery(..., "SELECT Id, Subject, Status FROM Task WHERE IsClosed = false LIMIT 5")`
   and returns:
   ```json
   { "ok": true, "api_version": "61.0", "instance_host": "na1.salesforce.com",
     "user_id_suffix": "aBcD", "open_tasks": 5, "elapsed_ms": 812 }
   ```
   No record bodies, no session id, no credentials. Added to the bare-GET service listing
   (`actions: [..., "sf-ping"]`). No new function slug — `intake-salesforce` deploys as v25.

3. **Tests (no network):**
   - `test/salesforce-soap.test.mjs` (13 tests) — envelope building + XML escaping, success-path
     parsing, fault-path parsing for both `INVALID_LOGIN` and `LOGIN_MUST_USE_SECURITY_TOKEN`, a
     **positive control** that the thrown message never contains the raw `faultstring` text (which
     can echo credential-shaped input), and that `SfAuthError`'s own fields never carry
     password/session-id-shaped data.
   - `test/intake-salesforce-sf-ping-auth.test.mjs` (4 tests) — `_shared/auth.ts` cannot be imported
     directly under plain `node --test` (it transitively imports
     `https://esm.sh/@supabase/supabase-js@2` via `supabase-client.ts`, which Node's ESM loader
     rejects with `ERR_UNSUPPORTED_ESM_URL_SCHEME`), so this is a structural/source check: sf-ping is
     listed in the action inventory, is dispatched, sits strictly after the single unconditional
     `authenticateWebhook(req)` gate (so it cannot be reached without it), and its response body
     never contains `SF_PASSWORD`, `SF_SECURITY_TOKEN`, or `sessionId`.
   - Both files pass: `node --test test/salesforce-soap.test.mjs test/intake-salesforce-sf-ping-auth.test.mjs`
     → 13 pass / 0 fail.

4. **Docs:**
   - `docs/architecture/edge-function-deploy-drift.md` — dated section under 2026-09-09 recording
     the rebuild.
   - `docs/os/PLANNED-BACKLOG.md` — SF-DIRECT row updated with what shipped and the remaining
     operator step.
   - `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` — Dialysis_DB edge-function env var list now
     names `SF_USERNAME` / `SF_PASSWORD` / `SF_SECURITY_TOKEN` / `SF_LOGIN_HOST` / `SF_API_VERSION`.

## Verify-on checklist

- ✅ `grep -rn "SF_PASSWORD" api supabase` → exactly one read site
  (`supabase/functions/_shared/salesforce-soap.ts:135`), plus two comments naming the env var; never
  logged (`console.*` nowhere near it).
- ✅ No new function slug in `list_edge_functions` — `intake-salesforce` is redeployed in place.
- 👤 **Pending (operator step):** deploy —
  ```
  supabase functions deploy intake-salesforce --project-ref zqzrriwuavgrquhisnoa --no-verify-jwt
  ```
  then run:
  ```
  curl -s "https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/intake-salesforce?action=sf-ping" \
    -H "X-PA-Webhook-Secret: <the real secret>"
  ```
  and confirm (a) no header → `401`, (b) with the header → `200` with an `open_tasks` count. Record
  only the count (never the raw response body, which could carry a live `instance_host`) in this
  file, then flip the backlog row to ✅.

## Out of scope (by design)

- No Salesforce write — `sfQuery` only ever runs SELECT statements the caller supplies at the code
  level (there is no write helper in `salesforce-soap.ts`).
- No Power Automate replacement — PA2/PA3/PA4 (outbound SF lanes) are unchanged; this only notes in
  the backlog that a direct path now exists for future outbound work, and does not build one.
- No credential rotation — if `SF_PASSWORD` is ever rotated, only the Supabase secret value changes;
  no code here depends on its current value.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## Cowork reconcile — deploy + first live run (2026-09-09)

Deployed v25 (`verify_jwt=false` confirmed). Live: no header → 401; real secret → 200 and the handler ran;
first call `sf:LOGIN_MUST_USE_SECURITY_TOKEN` (token stale after seven idle months — reset and re-set);
second call **`sf:INVALID_SSO_GATEWAY_URL`** — the integration user's profile is under delegated
authentication (corporate SSO), so Salesforce refuses password API login by policy. **Code and deploy are
complete and proven to Salesforce's door; the remaining step is a Salesforce-admin profile change (backlog
SF-DIRECT, 👤).** Counts not recorded because no query ran. The May audit's description of `sf-test` as having
"queried 5 open tasks" is not corroborated by any recorded success; treat the rebuilt path as the first
end-to-end measurement.
