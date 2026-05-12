# Flow Detail: GovLeaseLeadSync

Last updated: 2026-05-12
Flow export: `GovLeaseLeadSync_20260512134512.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Synchronize inbound GovLease lead payloads into Salesforce by updating an existing Lead or creating a new Lead.

## Trigger
- Type: `Request` (`manual`)
- Connector reference: `shared_salesforce`

## High-Level Action Topology
1. Receive request payload.
2. `Get_records` (`GetItems`) on Salesforce `Lead`:
   - filter by `Company eq triggerBody()['agency']`.
3. `Condition` checks if a matching lead exists.
4. True branch: `Update_record_(V3)`.
5. False branch: `Create_record`.
6. Return standardized response (`status`, `message`).

## Contract and Data Dependencies
- Salesforce object: `Lead`
- Matching key: `Company` from `agency` input field.
- Request contract must include agency and lead payload fields expected by update/create steps.

## Key Risks
1. Company/agency-only matching may cause false positives or lead collision.
2. Manual request flow mutates CRM without built-in orchestration policy context.
3. No explicit multi-match resolution strategy documented.

## Recommended Improvements
1. Add stronger matching criteria (agency + geography + source_ref when available).
2. Add schema versioning and strict validation branch.
3. Add explicit audit payload fields (source flow run id, actor, correlation id).

## Evidence Snapshot
- Trigger: `manual`
- Top actions: `Get_records`, `Condition`, `Response`
- Salesforce operation: `GetItems` on `Lead`
- Branches: update existing or create new

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

