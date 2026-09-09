# SF-DIRECT-b — route the direct-Salesforce path through the Power Automate gateway that already works under SSO

> **Why.** SF-DIRECT (v25, 2026-09-09) is built, deployed and proven to Salesforce's door — then refused with
> `INVALID_SSO_GATEWAY_URL`: the integration user's profile is under corporate SSO (delegated auth), so password
> API login is a Salesforce-admin setting away, and Scott has chosen **not** to ask IT until there is a finished
> product to show. **The sanctioned path already exists and already works under SSO:** the Power Automate flow
> **"HTTP Switch Salesforce Lookup"** (`FLOW-REGISTRY.yaml` `sf-http-switch-lookup`, GUID
> `c3744e93-…`), reached by the Railway app via `SF_LOOKUP_WEBHOOK_URL` in `api/_shared/salesforce.js`, whose
> header explains the design: *"a Power Automate flow authenticates via its built-in Salesforce connector (which
> uses the org's SSO token), executes the query on our behalf, and returns the result to LCC over HTTP."* Seven
> typed operations today (`find_account_by_name`, `find_account_by_id`, `find_contact_by_email`,
> `find_contacts_by_account`, `reassign_task_owner`, `create_opportunity`, activity logging).
> **This unit makes that gateway general (a read-only `soql` operation), reachable from edge functions, and the
> fallback for `sf-ping` — while keeping the SOAP helper as the exhibit for the eventual IT conversation.**

**Repo:** `life-command-center` · **Code: one Deno helper, one fallback branch in `sf-ping`, tests. No domain
writes. No new function slug. No Salesforce write operation.** Flow change is Scott's, in the PA designer, from the
spec in Unit 1 — **never hand-edit exported flow JSON.** Deploy: `supabase functions deploy intake-salesforce
--project-ref zqzrriwuavgrquhisnoa --no-verify-jwt`.

**Read first:** `api/_shared/salesforce.js` (the contract and error shapes — mirror them, do not invent new ones)
· `docs/architecture/flows/http-switch-salesforce-lookup.md` · `supabase/functions/_shared/salesforce-soap.ts`
(SF-DIRECT) · `docs/claude-code/STATUS.md` 2026-09-09 SF-DIRECT entries.

---

## Unit 1 — spec for the gateway flow's new `soql` case (Scott builds it; you write the spec)

Write `docs/architecture/flows/http-switch-salesforce-lookup.md` § "soql operation (SF-DIRECT-b)" precisely enough
to build from:

- New `Switch` case on `@triggerBody()?['operation']` = `"soql"`.
- Input: `{ "operation": "soql", "soql": "<SELECT …>", "max_rows": 200, "schema_version": 1 }`.
- **Guards inside the flow, before the connector call:** `soql` must start with `SELECT` (case-insensitive, trimmed);
  must not contain `;`; `max_rows` clamped to ≤ 500. Otherwise respond 400 `{ ok:false, reason:"soql_rejected" }`.
- Action: Salesforce connector → **Execute a SOQL query** (`shared_salesforce`, the connection the flow already uses).
- Response 200: `{ ok:true, operation:"soql", total_size:n, done:true, records:[…] }` — records truncated to
  `max_rows`; on connector failure `{ ok:false, reason:"flow_reported_failure", detail:"<connector message, ≤500 chars>" }`
  (the same shapes `api/_shared/salesforce.js` already parses).
- **Secure Inputs/Outputs on the HTTP trigger and the SOQL action** so run history does not retain record bodies.
- Registry: bump `sf-http-switch-lookup` `notes` with the new operation and the export date once Scott re-exports.

## Unit 2 — `supabase/functions/_shared/salesforce-gateway.ts`

- `sfGatewayQuery(soql, { maxRows })` → POST `Deno.env.get("SF_LOOKUP_WEBHOOK_URL")` with the Unit 1 body,
  `Content-Type: application/json`, 20 s abort. Parse the response with the **same** `ok/reason/detail` handling
  as `api/_shared/salesforce.js` (`pickFlowMessage` semantics — port it, do not diverge).
- Errors: `SfGatewayError` with `reason` (`gateway_not_configured` when the env is missing, `flow_unreachable`,
  `flow_http_error`, `flow_reported_failure`, `soql_rejected`) — **never** the URL (it carries the signature).
- 👤 Scott sets the secret on Dialysis_DB: `supabase secrets set SF_LOOKUP_WEBHOOK_URL="<the flow's HTTP POST URL>"
  --project-ref zqzrriwuavgrquhisnoa` — the same value Railway holds.

## Unit 3 — `sf-ping` learns to fall back

In `intake-salesforce?action=sf-ping`: attempt SOAP (`sfLogin`/`sfQuery`) first. On `SfAuthError` with fault code
`INVALID_SSO_GATEWAY_URL` (or `INVALID_LOGIN`), call `sfGatewayQuery` with the same five-open-Tasks SOQL. Response
gains `via: "soap" | "pa_gateway"` and, when it fell back, `soap_fault_code`. Counts only, as before; the gate is
unchanged (still behind `authenticateWebhook`).

## Unit 4 — tests (no network)

`test/salesforce-gateway.test.mjs`: request body shape; `SELECT`-only client-side pre-check mirrors the flow's guard
(reject `UPDATE …`, reject `;`); response parsing for the four error shapes; positive control that no error message
contains the webhook URL or its `sig=` fragment. Extend `test/intake-salesforce-sf-ping-auth.test.mjs`: the fallback
is reached only after the auth gate and only on the two named fault codes.

## Unit 5 — docs

- `docs/os/PLANNED-BACKLOG.md`: **SF-DIRECT** → record `via:"pa_gateway"` count when Scott runs it; keep the SOAP
  path noted as *ready the day the SSO flag is cleared*. PA2/PA3/PA4: one line — the gateway now has a generic
  read; outbound remains PA-only by design.
- `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`: `SF_LOOKUP_WEBHOOK_URL` now on Dialysis_DB too.
- `docs/architecture/edge-function-deploy-drift.md`: dated line.

---

## Out of scope — say so

- Any Salesforce write via `soql` (SELECT-only, guarded in both the flow and the client).
- Replacing the queue drainer / PA2–PA4.
- Asking IT for anything (the SOAP path stays as the exhibit for that conversation).

## Deliverables / Verify on

- Spec in the flow doc; helper + fallback + tests; `npm test` green; deploy v26.
- 👤 Scott: build the `soql` case, re-export the flow to `private/power-automate/exports/production/<date>/`,
  set the secret, run `sf-ping` → expect `ok:true, via:"pa_gateway", open_tasks:n`. Report `n` only.
- `grep -rn "sig=" supabase api test` shows no literal signature anywhere.
