# Flow Detail — Sync SF Tasks to Supabase

## Metadata
- Export artifact: `SyncSFTaskstoSupabase_20260512134655.zip`
- Display name: `Sync SF Tasks to Supabase`
- Trigger: `Recurrence`
- Connector: `shared_salesforce`

## Purpose
Pull Salesforce Task records on schedule and sync them into Supabase/LCC tables.

## Risks
1. Export previously indicated embedded credential risk in related Supabase write path (P0).
2. Polling sync can create duplicates without deterministic external-id upserts.

## Improvements
1. Rotate/secure all API credentials.
2. Use external ID mapping (`sf_task_id`) with upsert-only semantics.
3. Add retry ceiling and dead-letter for write failures.
# Flow Detail: SyncSFTaskstoSupabase

Last updated: 2026-05-12
Flow export: `SyncSFTaskstoSupabase_20260512134655.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Run scheduled Salesforce Task extraction and forward results to Supabase edge sync endpoint.

## Trigger
- Type: `Recurrence`
- Frequency: `Hour`
- Interval: `6`
- Start time observed: `2026-03-08T15:00:00Z`

## High-Level Action Topology
1. Execute Salesforce SOQL query (`ExecuteSoqlQuery`).
2. POST payload to:
   - `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/sf-tasks`

## Contract and Data Dependencies
- Connector: `shared_salesforce`
- Supabase edge endpoint `/sync/sf-tasks`
- Headers in HTTP action include `apikey` and `Authorization`.

## Key Risks
1. P0 security: plaintext credential material detected in exported definition.
2. Potential duplication/late-arrival gaps without explicit watermarking policy.
3. Endpoint coupling to one Supabase project reference.

## Required Immediate Remediation (P0)
1. Rotate exposed Supabase keys immediately.
2. Replace hardcoded credential values with secure reference pattern.
3. Re-export and verify no credentials appear in exported definitions.
4. Log rotation evidence in `FLOW_CHANGES_LOG.md`.

## Evidence Snapshot
- Trigger: `Recurrence` every 6 hours
- Top actions: `Execute_a_SOQL_query`, `HTTP`
- Credential signal scan: `hasBearer=true`, `hasJwt=true`, `hasApiKey=true`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`
- Credential rotation completed: `TBD`

