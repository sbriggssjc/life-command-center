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

