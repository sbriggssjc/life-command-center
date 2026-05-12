# Flow Detail — Sync Flagged Emails to Supabase

## Metadata
- Export artifacts:
  - `SyncFlaggedEmailstoSupabase_20260512135136.zip`
  - `SyncFlaggedEmailstoSupabase_20260512135251.zip`
- Display name: `Sync Flagged Emails to Supabase`
- Trigger: `Recurrence`
- Connector: `shared_office365`

## Purpose
Recurring sync of flagged Outlook emails into Supabase-backed LCC task/intake context.

## Risks
1. Two exports indicate parallel versions and potential drift.
2. Polling recurrence can reprocess already-synced messages without watermark/idempotency.

## Improvements
1. Select one canonical production version and deprecate the duplicate.
2. Add message-level idempotency key and last-processed watermark.
3. Standardize failure branch + dead-letter write.
