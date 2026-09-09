# Flow Detail: HTTP-Switch Salesforce Lookup Router

Last updated: 2026-05-11
Flow export: `HTTP-Switch_20260511211836.zip`
Definition path: `Microsoft.Flow/flows/096ab40b-07b7-497d-9fc4-d9acfe5fd4ce/definition.json`

## Intent
Expose one HTTP entrypoint that routes lookup requests by `operation` and performs Salesforce Account/Contact queries.

## Trigger
- Type: `Request` (`Http`)
- Trigger name in definition: `manual`
- Entry contract pivot: `@triggerBody()?['operation']`

## High-Level Action Topology
1. Receive HTTP request.
2. `Switch` on `operation`.
3. Branches:
   - account lookup branch (`Case_1`) with Salesforce lookup + response.
   - contact lookup branch (`Case 2`) with Salesforce lookup + response.
4. Default branch returns fallback response (`Response_2`).

## Contract and Data Dependencies
- Requires caller payload with `operation`.
- Uses Salesforce connector reference `shared_salesforce`.
- Connector map id shared with queue worker flow (`LCCSFFlow1`).

## Key Risks
1. Contract drift when callers send unexpected/renamed `operation`.
2. Branch naming inconsistency (`Case_1` vs `Case 2`) increases maintenance ambiguity.
3. Default branch behavior not sufficiently documented for downstream systems.

## Current Controls (Observed)
- Explicit switch/default logic.
- Response actions in account/contact branches.

## Recommended Improvements
1. Formalize request schema (`operation`, `schema_version`, required fields).
2. Add strict validation and typed error payloads for unknown operations.
3. Normalize branch naming and add branch-level telemetry.
4. Add explicit per-branch timeout/retry notes in runbook.

## Evidence Snapshot
- Trigger: `manual` (Request/Http)
- Switch expression: `@triggerBody()?['operation']`
- Cases observed: `Case_1`, `Case 2`
- Connector map: `shared_salesforce`
- API map: `shared_salesforce`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (account path): `TBD`
- Last validated run id (contact path): `TBD`
- Last validated run id (default/error path): `TBD`

## `soql` operation (SF-DIRECT-b, 2026-09-09)

**Why.** SF-DIRECT (v25) proved the direct-SOAP path works end to end and then hit
`INVALID_SSO_GATEWAY_URL` at the org's door — the integration user's profile is under
corporate SSO (delegated auth), so password API login needs a Salesforce-admin change
Scott has chosen not to request yet. This flow already authenticates successfully under
that same SSO (it runs the Salesforce connector as Scott's own signed-in session), so a
guarded, read-only, generic query case gives every caller (Railway app, edge functions)
a working path today without touching the org's auth policy. This section is written to
build the new `Switch` case from — Scott builds it in the PA designer; nobody hand-edits
the exported flow JSON.

### New Switch case

Add one more branch to the existing `Switch` on `@triggerBody()?['operation']`, alongside
the account/contact/reassign/create-opportunity/activity-logging cases already there:

- **Case value:** `soql`

### Request contract

```json
{
  "operation": "soql",
  "soql": "SELECT Id, Name FROM Account WHERE Name = 'Acme LLC' LIMIT 5",
  "max_rows": 200,
  "schema_version": 1
}
```

- `soql` (string, required) — a single `SELECT` statement. No DML, no multi-statement input.
- `max_rows` (integer, optional, default 200) — caps the number of records returned.
- `schema_version` (integer, optional) — reserved for future contract changes; ignored by
  this version of the case but accepted so a caller can send it unconditionally.

### Guards — INSIDE the flow, BEFORE the Salesforce connector action

Evaluate these as `Condition` actions immediately after entering the `soql` case, in this
order, each returning the 400 below on failure (never reaching the connector):

1. **Must be a read.** `trim(toUpper(triggerBody()?['soql']))` must **start with** `SELECT`
   (case-insensitive; leading/trailing whitespace trimmed first). Anything else — `UPDATE`,
   `DELETE`, `INSERT`, `UPSERT`, `MERGE`, a bare object name, an empty string — is rejected.
2. **No statement chaining.** The raw `soql` string must **not contain** a `;` character
   anywhere. (SOQL has no multi-statement execution, but a semicolon is also not valid
   syntax in a single SOQL statement, so rejecting it costs nothing legitimate and closes
   off any attempt to smuggle a second clause past a naive `SELECT`-prefix check.)
3. **Clamp, never reject, `max_rows`.** `min(coalesce(triggerBody()?['max_rows'], 200), 500)`
   — if the caller omits it, asks for more than 500, or sends something non-numeric,
   resolve to a number in `[1, 500]` (a non-numeric or ≤0 value resolves to the default
   200, not a guard failure — this field is a hint, not a contract term worth 400ing over).

**On guard failure (1 or 2 only — `max_rows` never fails), respond 400:**

```json
{ "ok": false, "reason": "soql_rejected" }
```

### Connector action

**Salesforce → Execute a SOQL Query** (`shared_salesforce`, the same connection reference
every other case in this flow already uses — no new connection to authorize). Query
expression: `@{triggerBody()?['soql']}`. Do not add a `LIMIT` clause to the query string
server-side; row-count enforcement happens on the *response* (see below), because SOQL's
own `LIMIT` clause is part of the caller's query and a flow-injected second `LIMIT` is
invalid syntax.

### Response — success (200)

```json
{
  "ok": true,
  "operation": "soql",
  "total_size": 42,
  "done": true,
  "records": [ { "Id": "001...", "Name": "..." }, ... ]
}
```

- `total_size` — the connector's own `totalSize` (Salesforce's count of matching rows,
  which can exceed what was returned if the caller's query itself was unbounded and the
  connector paginates — this flow does not walk `nextRecordsUrl`; a caller needing more
  than one page should add its own `LIMIT`/`OFFSET`).
- `done` — the connector's own `done` flag, passed through as-is.
- `records` — the connector's `records` array, **truncated to `max_rows`** (the resolved,
  clamped value from guard 3) if the connector returned more.

### Response — connector failure

```json
{ "ok": false, "reason": "flow_reported_failure", "detail": "<connector error message, truncated to 500 chars>" }
```

This is the **same shape** `api/_shared/salesforce.js::callSfLookupFlow` and
`supabase/functions/_shared/salesforce-gateway.ts::sfGatewayQuery` already parse for every
other case in this flow — do not invent a new error shape for this one case. `detail`
should be the raw Salesforce/connector error text (e.g. `MALFORMED_QUERY: ...`),
truncated; do not wrap it in additional flow-authored prose.

### Secure Inputs / Secure Outputs

Set **Secure Inputs** and **Secure Outputs** on:
- the HTTP `Request` trigger (already sensitive — carries the signed URL and, for other
  cases, contact/account values), and
- the new **Execute a SOQL Query** action specifically (its inputs echo the caller's raw
  query text, and its outputs can carry record bodies — e.g. contact emails, deal amounts —
  that must not sit in plaintext run history).

This matches the existing 2026-09-09 hygiene note against `briefing-daily-teams-v2`'s
Teams webhook action in `FLOW-REGISTRY.yaml` — the same rule (secure any action whose
inputs/outputs can carry a secret or PII) applied to this flow's newest action.

### Registry

Once Scott builds the case and re-exports, bump `FLOW-REGISTRY.yaml`'s `sf-http-switch-lookup`
entry: add a `notes:` line naming the new `soql` operation and the export date, and update
`exported_at` / `package_path` / `sha256` to the new export under
`private/power-automate/exports/production/<date>/`.

