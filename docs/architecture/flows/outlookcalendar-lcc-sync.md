# Flow Detail — Outlook Calendar - Life Command Center Sync

## Metadata
- Export artifact: `OutlookCalendar-LifeCommandCenterSync_20260512134742.zip`
- Display name: `Outlook Calendar - Life Command Center Sync`
- Trigger: `Recurrence`
- Connectors: `shared_office365`, `shared_outlook`, `shared_onedriveforbusiness`
- Action count: 16
- Flow ID: `74ba8f8d-6454-4753-8cb8-524605129d6c`
- **Health (verified 2026-05-14, Task #7):** Status On. Last 8+ runs in 28-day history ALL Succeeded; avg run duration ~1m27s. No failure pattern — flow is healthy. "Stabilize" = optional hardening (idempotency/dead-letter/correlation/partial-source error handling), not a repair.

## Purpose
Scheduled sync pipeline between Outlook calendar artifacts and LCC-facing sync state.

## Risks
1. Large action surface increases partial-failure exposure.
2. Calendar sync without conflict policy can create stale or duplicate updates.

## Improvements
1. Define source-of-truth policy for calendar fields.
2. Add idempotent upsert semantics and conflict resolution.
3. Add run telemetry mapping from event IDs to sync outcomes.
# Flow Detail: OutlookCalendar-LifeCommandCenterSync

Last updated: 2026-05-12
Flow export: `OutlookCalendar-LifeCommandCenterSync_20260512134742.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Aggregate events from multiple calendar sources, merge/filter into a unified payload, and sync to Supabase edge endpoint for LCC consumption.

## Trigger
- Type: `Recurrence`
- Frequency: `Hour`
- Interval: `1`

## High-Level Action Topology
1. Pull Office 365 calendar view events.
2. Read and update OneDrive sync artifact.
3. Pull multiple personal/outlook calendar streams.
4. Merge and filter personal/event sets.
5. POST merged payload to:
   - `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/calendar-events`

## Contract and Data Dependencies
- Connectors:
  - `shared_office365`
  - `shared_onedriveforbusiness`
  - `shared_outlook`
- Supabase edge endpoint `/sync/calendar-events`.

## Key Risks
1. Multi-source merge logic complexity and potential duplication/drift.
2. Hourly cadence with many calls can increase throttling risk.
3. Sync artifact update can hide partial-failure states if not guarded.

## Recommended Improvements
1. Add merge de-dup key policy documentation and validation checks.
2. Add per-source fetch error handling with partial-sync flags.
3. Add end-to-end correlation id in sync payload.

## Evidence Snapshot
- Trigger: `Recurrence` hourly
- Key actions include:
  - `Get_calendar_view_of_events_(V3)`
  - multiple `CalendarGetItems` pulls
  - `Sync_Events_to_Supabase` (HTTP POST)

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

