# Flow Detail: CompleteSFTask

Last updated: 2026-05-12
Flow export: `CompleteSFTask_20260512134535.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Handle manual HTTP requests to locate open Salesforce Tasks for a contact/subject and perform action-specific completion/update logic.

## Trigger
- Type: `Request` (`manual`)
- Connector reference: `shared_salesforce`

## High-Level Action Topology
1. Receive request payload.
2. `Get_records` (`GetItems`) on Salesforce `Task`:
   - filter by `WhoId`, `Subject`, and `Status != Completed`.
3. `Condition` checks if matching records were found.
4. If true: route through `Switch_on_action`.
5. If false: return fallback response (`Response_1`).

## Contract and Data Dependencies
- Salesforce object: `Task`
- Filter fields:
  - `WhoId` from `triggerBody()['sf_contact_id']`
  - `Subject` from `triggerBody()['subject']`
- Manual request contract must include required fields and action directive.

## Key Risks
1. Manual trigger mutation flow requires strict auth + action guardrails.
2. Subject-based matching can produce ambiguous task targeting.
3. Incomplete idempotency semantics for repeated requests.

## Recommended Improvements
1. Add strict schema validation (`sf_contact_id`, `subject`, `action`, `schema_version`).
2. Add correlation id + actor identity logging for every mutation.
3. Add conflict-safe update behavior when multiple matching tasks exist.

## Evidence Snapshot
- Trigger: `manual`
- Top actions: `Get_records`, `Condition`
- Salesforce operation: `GetItems` on `Task`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

