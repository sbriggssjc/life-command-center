# Unified Calendar — System Status & Architecture (as-built)

> Investigation date: **2026-07-22**. Purpose: a single, honest record of the
> calendar ingestion + view system, because it is **already built and running**
> and had been under-documented enough that follow-up work was scoped as if
> starting from a dead stub. It is not a stub — see the live evidence below.

## TL;DR

The unified, color-coded, multi-source calendar Scott wanted **already exists,
ingests on schedule, and renders in the LCC app.** Nothing needs to be rebuilt.
Two narrow, real gaps remain (football feed empty; one superseded PA flow to
retire) — both documented at the bottom with exact one-line fixes.

Everything lives on the **Dialysis_DB** Supabase project
(`zqzrriwuavgrquhisnoa`) — the calendar handlers use `getDialysisClient()`, not
LCC Opps. Keep new calendar work on that project.

## Live evidence (2026-07-22, ~13:30 UTC)

```
calendar_events total ............ 819
events in the future ............. 327
events synced in last 48h ........ 408
last sync (max synced_at) ........ 2026-07-22 13:21  (≈2h before investigation)
```

Per-source (calendar_name) — all synced same day except the superseded `personal`:

| calendar_name          | events | future | last sync (UTC)      | channel        |
|------------------------|-------:|-------:|----------------------|----------------|
| `business`             |   414  |    11  | 2026-07-22 13:21     | PA → Outlook    |
| `tsc-claire-soccer`    |   200  |   175  | 2026-07-22 12:07     | ICS feed        |
| `tsc-jack-soccer`      |   140  |   115  | 2026-07-22 12:07     | ICS feed        |
| `icloud:Scott and Ellen`|   31  |     9  | 2026-07-22 12:23     | CalDAV          |
| `icloud`               |    28  |    15  | 2026-07-22 13:21     | CalDAV          |
| `icloud:Briggs Family` |     3  |     2  | 2026-07-22 12:23     | CalDAV          |
| `personal`             |     3  |     0  | **2026-07-13 04:00** | PA (superseded) |

## Architecture — three ingestion channels, one table, one view, one page

```
                         ┌───────────────────────────────────────────┐
  Outlook (work +        │  Power Automate flow (hourly)              │
  any Outlook cal) ─────▶│  POST ai-copilot/sync/calendar-events     │──┐
                         │  → handleSyncCalendarEvents (handlers-b2)  │  │
                         └───────────────────────────────────────────┘  │
                                                                          ▼
  TeamSnap / league ────▶ calendar-ics-sync  (cron :07 hourly)  ───▶ calendar_events
  (public .ics URLs)      reads calendar_registry.ics_url             (Dialysis_DB)
                                                                          ▲
  iCloud published  ────▶ calendar-caldav-sync (cron :23 every 2h) ──────┘
  (Scott&Ellen, Briggs)   + calendar-caldav-push (cron :37 hourly)
                                                                          │
                                                                          ▼
                          v_calendar_events_app  (merged + de-duped,
                          adds cortex_domain + hex color per source)
                                                                          │
                                                                          ▼
                          GET ai-copilot/sync/calendar-events  ──▶  app.js
                          (handleGetCalendarEvents)                renderCalendarFull()
                                                                   on #/cal (pageCal)
```

### Components (all present, all working)

| Concern | Implementation | Notes |
|---|---|---|
| Schema | `calendar_events` (dedup key `id`) | TZ stored as true UTC (post-2026-05-21 normalization). |
| Source config | `calendar_registry` (26 rows) | `source_type` ∈ `ics_feed` / `outlook_connector` / `manual`; per-source `domain`, `color`, `emoji`, `label`, `sport`, `kid`. **`ics_url` is configurable** — this is where you change a TeamSnap/league URL when it rotates each season. |
| Merged/colored view | `v_calendar_events_app` | The de-duplicated unified view with `cortex_domain` + hex `color`. Also `v_calendar_events_merged`. |
| Outlook ingest | `ai-copilot/handlers-b2.ts` `handleSyncCalendarEvents` (v54) | Upsert on `id`; TZ-normalizes; **safe delete-reconciliation** (forward-only window + `CALENDAR_MAX_RECONCILE_DELETES` guard against mass-delete when a source drops out). |
| ICS ingest | `calendar-ics-sync/index.ts` | Server-side fetch + VEVENT parse; DST-aware floating-time → UTC (America/Chicago default); upserts with `id = "ics-"+UID`. Cron `cortex-calendar-ics-sync` `7 * * * *`. |
| CalDAV ingest | `calendar-caldav-sync` / `calendar-caldav-push` | iCloud published calendars. Crons `cortex-calendar-caldav-sync` `23 */2 * * *`, `cortex-calendar-caldav-push` `37 * * * *`. |
| Read API | `handleGetCalendarEvents` | Serves `v_calendar_events_app`; `?calendar=personal|business|<domain>` filters by `cortex_domain`; `days_back` / `days_forward` window. |
| In-app view | `app.js renderCalendarFull()` @ `pageCal` (`#/cal`) | Day-grouped agenda; per-event color-coded left border (`ev.color`); all-day, zero-duration-task, and canceled-event handling; location + organizer. A Today schedule/timeline widget (`sched-event`) also renders color-coded. |

## Scheduling (pg_cron on Dialysis_DB — all active)

| jobname | schedule | what |
|---|---|---|
| `cortex-calendar-ics-sync` | `7 * * * *` | fetch every active `ics_feed` registry row |
| `cortex-calendar-caldav-sync` | `23 */2 * * *` | pull iCloud published calendars |
| `cortex-calendar-caldav-push` | `37 * * * *` | CalDAV push leg |

The Power Automate Outlook flow(s) run hourly and POST into the sync endpoint.

## The two real gaps (and exact fixes)

### 1. Football feed is registered but empty (likely off-season / rotated URL)

`calendar_registry` row `mca-graham-football` (`source_type='ics_feed'`, active,
`ics_url = https://ical-cdn.teamsnap.com/team_schedule/7f0072a3-…ics`) is fetched
hourly by the same cron that lands the two soccer feeds, yet has **0 events**.
The soccer feeds (identical mechanism) synced hundreds the same day, so the
pipeline is fine. On 2026-07-22 it is **football off-season**, and TeamSnap ICS
URLs typically expire/rotate season-to-season (the exact scenario the registry's
configurable `ics_url` was built for).

- **No action** → the hourly cron will pick up the fall schedule automatically
  **if the current URL is still valid** when the season is published.
- **If it stays empty once season starts** → get a fresh TeamSnap "Team
  Schedule" ICS link and update the row:
  ```sql
  update calendar_registry
     set ics_url = '<fresh teamsnap .ics url>'
   where match_pattern = 'mca-graham-football';
  ```
  (No deploy needed — the cron reads the row on the next run.)

### 2. `flow-personal-calendar-sync.json` is superseded — retire it

Both `flow-personal-calendar-sync.json` and `flow-outlook-calendar-sync.json`
POST to the **same** endpoint (`ai-copilot/sync/calendar-events`) hourly. The
`personal` flow enumerates all Outlook.com personal calendars; its `personal`
source has produced **3 events, last synced 2026-07-13** — i.e. it has already
effectively stopped, and its job (family calendars) is now served server-side by
`calendar-caldav-sync` (iCloud). It is redundant with the CalDAV path.

- **PA-side (Scott):** disable/delete the **"Personal Calendar Sync"** flow in
  the Power Automate designer so there is a single Outlook flow feeding the
  endpoint. (This repo file is only a saved definition; it does not control the
  live flow.)
- **Repo:** once disabled in PA, `flow-personal-calendar-sync.json` +
  `docs/architecture/flows/lcc-personal-calendar-sync.md` can be removed as dead
  definitions. Left in place for now to avoid implying the live flow was touched.

## What was verified but is NOT a gap

- **Colors** — already assigned per source in `calendar_registry` (work=Blue,
  soccer=Green, football=Brown, Scott&Ellen=Red, Briggs=Blue, coaching/basketball
  =Red/Orange, travel=Teal, …) and surfaced through `v_calendar_events_app.color`.
- **Configurable URLs** — `calendar_registry.ics_url`, exactly as required.
- **Dedup / re-sync safety** — upsert on `id` + guarded delete-reconciliation.
- **Two-way sync** — intentionally out of scope (read-only ingestion), matching
  the request.

## Not built (candidate follow-ups, only if Scott wants them)

- **Conflict/overlap flagging** in `renderCalendarFull()` (e.g. two kids' games
  at once). Genuinely absent today.
- **Month-grid view** — the in-app view is a day-grouped agenda list only.
- **History window** — the app currently loads ~1 day back + upcoming
  (`loadCalendar()` uses `days_back=1&days_forward=14`; the GET handler defaults
  `days_back=7&days_forward=30`). Widen if more history is wanted.
