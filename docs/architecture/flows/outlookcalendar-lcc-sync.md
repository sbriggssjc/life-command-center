# Flow Detail — Outlook Calendar - Life Command Center Sync

## Metadata
- Export artifact: `OutlookCalendar-LifeCommandCenterSync_20260512134742.zip`
- Display name: `Outlook Calendar - Life Command Center Sync`
- Trigger: `Recurrence`
- Connectors: `shared_office365`, `shared_outlook`, `shared_onedriveforbusiness`
- Action count: 16
- Flow ID: `74ba8f8d-6454-4753-8cb8-524605129d6c`
- **Health (verified 2026-05-14, Task #7):** Status On. Last 8+ runs in 28-day history ALL Succeeded; avg run duration ~1m27s. No failure pattern — flow is healthy. "Stabilize" = optional hardening (idempotency/dead-letter/correlation/partial-source error handling), not a repair.
- **Hardened 2026-05-14 (Task #7 follow-up):** `Sync Events to Supabase` HTTP POST retry policy set to explicit Exponential (count 4, interval PT10S); body enriched with `correlation_id` (guid()) + `schema_version` via nested setProperty.

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

---

## 2026-05-22 — Actual deployed architecture, TZ fix applied, and open items

> Written after verifying PR #859 against the LIVE flow. **Important:** the deployed
> flow does NOT match the repo flow-JSON files. Read this before editing.

### Repo JSON vs. reality (do not blindly re-import)
`flow-outlook-calendar-sync.json` / `flow-personal-calendar-sync.json` in the repo root
are **simplified, aspirational, and were never imported**. The live flow
(`74ba8f8d-6454-4753-8cb8-524605129d6c`) is a richer hand-built flow. Importing the
repo JSON over it would **destroy** the iCloud / TeamSnap / exposure-events
integrations. Treat the repo JSON as reference only. If you want an accurate copy,
**Export** the live flow.

### Real action topology (verified in the designer)
```
Recurrence (hourly)
 → Initialize variable  (AllEvents = [])
 → 8 PARALLEL "Get" actions (all shared_office365 GetEventsCalendarView-style):
     • Get calendar view of events (V3)   ← WORK calendar (Focus time, broker mtg live here)
     • Get personal default calendar
     • Get teamsnap schedule 1 / 2          ← iCal subscriptions
     • Get icloud calendar 1 / 2            ← iCal subscriptions
     • Get exposure events 1 / 2
 → Merge personal calendars  (union of the 7 personal/iCal Get outputs)
 → Filter personal events
 → Merge Events  (Compose):
     @union(outputs('Get_calendar_view_of_events_(V3)')?['body/value'], body('Filter_personal_events'))
 → Apply to each  (over Merge Events):
     • Compose Event           ← builds the per-event object
     • Append to array variable (AllEvents)  ← MUST append the Compose output
 → Sync Events to Supabase (HTTP POST  events = @variables('AllEvents'))
     POST https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/calendar-events
 → Get file metadata using path → Update file   (OneDrive backup of the payload)
```

### Connector field shapes (per event, from `Get calendar view of events (V3)`)
- `start`            → naive, no offset, e.g. `2026-05-22T08:00:00.0000000`
- `startWithTimeZone`→ **offset-bearing**, e.g. `2026-05-22T08:00:00-05:00`  ← use this
- `timeZone`         → Windows name, e.g. `Central Standard Time`
- (same trio for `end` / `endWithTimeZone`)

### Edge function contract (`ai-copilot`, v53+, deployed 2026-05-22)
`parseDateTimeDetailed` in `supabase/functions/ai-copilot/handlers-b2.ts`:
- string carrying `Z` or `±HH:MM` → parsed to true UTC, `tz_normalized_at` SET (trusted)
- bare naive string (no offset)   → stored as-is, `tz_normalized_at` NULL (untrusted)
- `{dateTime, timeZone}` object   → converted via Intl (handles Windows TZ names)
**Implication:** feed it `startWithTimeZone` (offset-bearing) and it does the rest.

### What was actually broken and the fix applied (2026-05-22)
1. **Migration** `20260521000000_dia_calendar_events_normalize_to_utc.sql` was never run.
   Applied via Supabase MCP → added `tz_normalized_at`, backfilled 306 rows.
2. **Edge function** was 2 months stale (last deploy 2026-03-26). Redeployed → v53/63.
3. **`Compose Event`** had `start`/`end` wrapped in
   `convertTimeZone(coalesce(start,Start), 'UTC','Central Standard Time','yyyy-MM-ddTHH:mm:ss')`,
   which strips the offset and (because sources are inconsistently zoned) double-shifted
   times (8 AM CT → stored 03:00 UTC). **Fixed to:**
   ```
   "start": "@coalesce(items('Apply_to_each')?['startWithTimeZone'], items('Apply_to_each')?['start'], items('Apply_to_each')?['Start'])"
   "end":   "@coalesce(items('Apply_to_each')?['endWithTimeZone'], items('Apply_to_each')?['end'], items('Apply_to_each')?['End'])"
   ```
   (title / location / isAllDay / organizer / body / id were unchanged.)
4. **`Append to array variable`** Value had been overwritten with the **literal text**
   `coalesce(items('Apply_to_each')?['endWithTimeZone'], ...)` (no leading `@`, so it
   never evaluated). This made every array item a string, not an event object →
   `events_upserted: 0`. **Fixed to:** `value = @outputs('Compose_Event')`.

### Verified result (post-fix manual run)
- 17 events upserted (was 0 while broken); all `tz_normalized_at = true`.
- Focus time now `13:00 UTC` = 8:00 AM CT (was 03:00 UTC / 10 PM CT). ✅
- Broker meeting: live future instances will land at `16:00 UTC` = 11 AM CT. The
  May 20 instance is past / outside the ±30-day window, so it keeps its backfilled value.

### OPEN ITEMS / circle-back list
1. **`calendar_name` is still NULL for all rows (Check 2 — not done).**
   `Compose Event` has no calendar field, and all 8 sources are merged into ONE array
   *before* the `Apply to each` loop, so inside the loop there is no per-event source
   marker. To populate it, tag the source BEFORE the merge:
   - **Option A (recommended):** in each `Get*` branch, run a `Select` that adds a
     constant `CalendarName` (e.g. `Work`, `TeamSnap`, `iCloud`, `Exposure`) onto every
     event, then merge. Add to `Compose Event`:
     `"calendarName": "@coalesce(items('Apply_to_each')?['CalendarName'], items('Apply_to_each')?['calendarName'])"`.
   - **Option B:** split the single `Apply to each` into per-source loops, each
     stamping a constant `CalendarName`.
   The edge function already reads `e.CalendarName || e.calendar_name` and writes
   `calendar_events.calendar_name`, so no edge-function change is needed.
2. **Event naming structure / `id` key.** `Compose Event.id = @coalesce(...['id'],...['Id'])`
   is the Graph event id and is the **upsert key** (`onConflict id` in the edge function).
   Changing the `id` format would re-key every row and create duplicates — if you change
   it, do a one-time `calendar_events` cleanup. The verbose `subject` (e.g. the broker
   meeting "...ACCEPT THIS MEETING...") comes straight from Outlook; clean it in
   `Compose Event.title` if desired.
3. **Past events outside the ±30-day PA window** won't re-sync (e.g. the May 20 broker
   instance). Correct deep history manually if ever needed.
4. **Repo flow JSONs are stale.** Re-export the live flow if you want a faithful backup.

### How to edit `Compose Event` / `Append` safely (lesson learned)
The new-designer token field rejects piecemeal chip edits and silently saves expressions
as **literal text** if the leading `@` is dropped (that's exactly what broke this flow).
Reliable method: open the action → Parameters → select-all in the field → **paste** the
full corrected value (with `@` prefixes) from the clipboard → confirm via **Code view**
that `inputs`/`value` is a real expression (`"@coalesce(...)"`, not `"coalesce(...)"`)
**before** Save.

