# SF-DIRECT — rebuild the direct-Salesforce capability `sf-test` proved, as an authenticated helper

> **Why this exists.** On 2026-09-09 the Dialysis_DB edge function `sf-test` was deleted (DRIFT1-retire —
> verdicted DELETE in May, unauthenticated, four months idle). Its body was never committed and the May audit's
> "source on record" claim was false, so the ~40-line body is gone. **What it proved is not gone:** with the
> three project secrets `SF_USERNAME` / `SF_PASSWORD` / `SF_SECURITY_TOKEN` it logged into Salesforce over the
> **SOAP login API and ran a SOQL query** (five open Tasks) — the only working path in the system to reach
> Salesforce **directly** from an edge function, with no Power Automate hop and **no Connected App** (the C1
> audit found no admin rights to create one; `sf_connected_app_setup.md` is STALE for that reason). Scott's
> standing rule: no planned or built capability is lost. **The secrets stay. This unit rebuilds the capability
> properly.** Backlog **SF-DIRECT**; record in `docs/claude-code/STATUS.md` 2026-09-09.

**Repo:** `life-command-center` · **Code: one shared helper + one authenticated diagnostic action + tests. No
domain writes. No new unauthenticated endpoint — that is the whole point.** Deploy = `supabase functions deploy
intake-salesforce --project-ref zqzrriwuavgrquhisnoa --no-verify-jwt` (pinned in `config.toml` since 2026-09-09;
the flag stays as belt-and-braces).

**Read first:** `docs/architecture/edge-function-deploy-drift.md` (2026-09-09 section) ·
`supabase/functions/_shared/auth.ts` (`authenticateWebhook`) · `docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md`
(why SF access is PA-only today and what a direct path would unlock) · `docs/os/PLANNED-BACKLOG.md` rows
PA2 / PA3 / PA4 (the outbound Salesforce work that has no direct path).

---

## Unit 1 — `supabase/functions/_shared/salesforce-soap.ts`

A small, dependency-free client (Deno `fetch`, no jsforce):

- `sfLogin(): Promise<{ sessionId, serverUrl, instanceUrl, userId }>` — POST to
  `https://login.salesforce.com/services/Soap/u/<API_VERSION>` with the SOAP `login` envelope, username from
  `SF_USERNAME`, password = `SF_PASSWORD` **+** `SF_SECURITY_TOKEN` concatenated (the SOAP convention). Pin
  `API_VERSION` as a constant (`61.0` unless the org says otherwise — check with a first call). Parse `sessionId`
  and `serverUrl` from the XML with a narrow regex; never log the password or session id.
- `sfQuery(session, soql): Promise<{ totalSize, done, records }>` — GET
  `${instanceUrl}/services/data/v<API_VERSION>/query?q=<encoded soql>` with `Authorization: Bearer <sessionId>`.
  (The SOAP session id is valid for the REST API — that is what makes the SOAP login worth having.)
- Errors: a typed `SfAuthError` on `INVALID_LOGIN` / `LOGIN_MUST_USE_SECURITY_TOKEN` with the fault code only —
  **never the credentials or the raw envelope** in the message.
- **Sandbox/production toggle:** `SF_LOGIN_HOST` env (default `login.salesforce.com`; `test.salesforce.com` for a
  sandbox) so the helper can be pointed at a sandbox without a code change.

## Unit 2 — an authenticated diagnostic action, not an open function

Do **not** recreate `sf-test` as its own function. Add `?action=sf-ping` to `intake-salesforce` (GET), behind the
existing `authenticateWebhook` gate (`X-PA-Webhook-Secret`) — same door every other action uses. It calls
`sfLogin()` then `sfQuery("SELECT Id, Subject, Status FROM Task WHERE IsClosed = false LIMIT 5")` and returns
`{ ok, api_version, instance_host, user_id_suffix (last 4), open_tasks: n, elapsed_ms }` — **no record bodies, no
session id, no credentials**. Unauthenticated callers get the existing 401.

Add the action to the bare-GET service listing so it is discoverable.

## Unit 3 — tests (no network)

`test/salesforce-soap.test.mjs`: (a) the login envelope builder produces a well-formed envelope with the password
+ token concatenated and the username escaped; (b) the XML parser extracts `sessionId`/`serverUrl` from a
captured-shape fixture and rejects a fault envelope with `SfAuthError`; (c) a positive control that an error
message built from a fault **does not contain** the password string passed in. `test/intake-salesforce-*.test.mjs`
if one exists: `sf-ping` is rejected without the secret.

## Unit 4 — docs

- `docs/architecture/edge-function-deploy-drift.md`: one dated line — `sf-test` deleted 2026-09-09, capability
  rebuilt as `_shared/salesforce-soap.ts` + `intake-salesforce?action=sf-ping`, secrets retained.
- `docs/os/PLANNED-BACKLOG.md`: SF-DIRECT → ✅ with the first successful `sf-ping` result (counts only);
  DRIFT1-retire-secrets → ✅ *kept by decision*; add one line to PA2/PA3/PA4 noting a direct path now exists for
  future outbound work (design only — do not build outbound here).
- `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` env list for Dialysis_DB edge functions: the three `SF_*`
  secrets and `SF_LOGIN_HOST`.

---

## Out of scope — say so

- Any Salesforce **write**. This unit is read-only diagnostic + library.
- Replacing Power Automate for any live lane (PA2–PA4 stay as designed until a separate decision).
- Rotating the Salesforce password (Scott's call; if rotated, only the secret value changes).

## Deliverables

1. The helper, the action, the tests; `npm test` green.
2. One real `sf-ping` run after deploy (Scott supplies the webhook secret in a header — never paste it into the
   response), with the returned counts.
3. Response in `docs/claude-code/responses/SF-DIRECT-soap-helper.response.md`; dated STATUS entry.

## Verify on

- The new action returns 401 without the secret (shown), 200 with it (shown, counts only).
- `grep -rn "SF_PASSWORD" api supabase` shows the secret read in exactly one place (the helper) and never logged.
- No new function slug appears in `list_edge_functions`.
