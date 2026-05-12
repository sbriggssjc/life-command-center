# Flow Detail: SyncSFActivitiestoSupabase

Last updated: 2026-05-12
Flow export: `SyncSFActivitiestoSupabase_20260512134632.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Run scheduled Salesforce activity pulls, shape payload, and forward to Supabase edge sync endpoint.

## Trigger
- Type: `Recurrence`
- Frequency: `Hour`
- Interval: `4`
- Start time observed: `2026-03-06T16:00:00Z`

## High-Level Action Topology
1. Pull Salesforce records using multiple `GetItems` actions.
2. Transform payload (`Select`).
3. POST to:
   - `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/activities`

## Contract and Data Dependencies
- Connector: `shared_salesforce`
- Supabase edge endpoint `/sync/activities`
- Headers in HTTP action include `Content-Type`, `Authorization`, `apikey`.

## Key Risks
1. P0 security: plaintext credential material detected in exported definition.
2. Multi-query merge path can drift without explicit dedupe/watermark controls.
3. 4-hour schedule needs lag/failure replay policy.

## Required Immediate Remediation (P0)
1. Rotate exposed Supabase keys immediately.
2. Replace inline auth values with secure references.
3. Re-export and verify credential-free definitions.
4. Record remediation completion in change log.

## Evidence Snapshot
- Trigger: `Recurrence` every 4 hours
- Top actions: `Get_records`, `Get_records_1`, `Get_records_2`, `Select`, `HTTP`
- Credential signal scan: `hasBearer=true`, `hasJwt=true`, `hasApiKey=true`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`
- Credential rotation completed: `TBD`

