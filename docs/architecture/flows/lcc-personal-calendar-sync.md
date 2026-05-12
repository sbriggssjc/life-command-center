# Flow Detail: LCC-PersonalCalendarSync

Last updated: 2026-05-12
Flow export: `LCC-PersonalCalendarSync_20260512134721.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Pull personal calendar event windows and sync normalized event payloads to Supabase edge endpoint.

## Trigger
- Type: `Recurrence`
- Frequency: `Hour`
- Interval: `1`
- Start time observed: `2026-03-15T15:00:00Z`

## High-Level Action Topology
1. Initialize accumulator variable.
2. Pull calendar view events (`GetEventsCalendarViewV2`) from Outlook connector.
3. Iterate events and construct payload.
4. POST to:
   - `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/calendar-events`

## Contract and Data Dependencies
- Connector: `shared_outlook`
- Supabase edge endpoint `/sync/calendar-events`.

## Key Risks
1. Hourly poll + event window overlap can cause duplicate inserts without idempotency.
2. Edge endpoint availability directly impacts calendar freshness.
3. Limited branching could hide partial transform failures.

## Recommended Improvements
1. Enforce event id-based idempotency in payload contract.
2. Add explicit retry/dead-letter behavior for endpoint failures.
3. Add payload schema version marker.

## Evidence Snapshot
- Trigger: `Recurrence` hourly
- Top actions: `Initialize_variable`, `Get_calendar_view_of_events_(V2)`, `Apply_to_each`, `HTTP`

## Change Tracking Hooks
- Snapshot hash (pre-change): `TBD`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

