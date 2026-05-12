# Flow Detail — Sync SF Activities to Supabase

## Metadata
- Export artifact: `SyncSFActivitiestoSupabase_20260512134632.zip`
- Display name: `Sync SF Activities to Supabase`
- Trigger: `Recurrence`
- Connector: `shared_salesforce`

## Purpose
Scheduled extraction of Salesforce activity data into Supabase/LCC context tables.

## Risks
1. Multi-step recurrence flow increases partial commit risk.
2. Credential handling posture must be verified after prior P0 findings.

## Improvements
1. Enforce transaction-safe write pattern (staging then promote).
2. Add correlation IDs and per-batch reconciliation counts.
3. Route failed records to dead-letter queue.
