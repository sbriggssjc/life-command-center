# Flow Detail: HTTP-ParseJSON Property Email

Last updated: 2026-05-11
Flow export: `HTTP-ParseJSON_20260511215138.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Accept manual JSON input, parse the `address`, call LCC property lookup endpoint, and send results by email.

## Trigger
- Type: `Request` (`manual`)
- Connector references: `shared_office365` (email delivery).

## High-Level Action Topology
1. Receive HTTP/manual request payload.
2. `Parse_JSON` to extract input fields.
3. `HTTP` GET:
   - `https://life-command-center-nine.vercel.app/api/property?address=@{body('Parse_JSON')?['address']}`
   - header: `X-LCC-Key`
4. `Send_an_email_(V2)` with lookup output.

## Contract and Data Dependencies
- Input contract depends on JSON body including `address`.
- Endpoint dependency: `/api/property?address=...`
- Header dependency: `X-LCC-Key`
- Email output dependency: `shared_office365`

## Key Risks
1. Manual trigger lacks strict upstream caller guardrails by default.
2. Query-string address handling can fail on malformed/unsanitized values.
3. Hardcoded endpoint URL and secret header dependence.

## Recommended Improvements
1. Add strict request schema (required fields + validation errors).
2. URL-encode or sanitize address payload before GET call.
3. Add error-handling branch for failed property lookup.

## Evidence Snapshot
- Trigger: `manual` request
- Top actions: `Parse_JSON`, `HTTP`, `Send_an_email_(V2)`
- Connector map: `shared_office365`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

