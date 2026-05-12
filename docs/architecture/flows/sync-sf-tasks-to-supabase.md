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
