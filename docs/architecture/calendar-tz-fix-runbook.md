# Calendar Timezone + Missing-Calendar Fix — Deployment Runbook

Branch: `claude/fix-calendar-issues-l4200`

## What this changes

1. **Frontend (`app.js`)** — Replaces the `stripTZ` hack with `Intl.DateTimeFormat`-based Central-Time rendering. Reads stored timestamps as true UTC and projects to `America/Chicago` (handles CDT/CST automatically).

2. **Edge function (`supabase/functions/ai-copilot/`)** — `handleSyncCalendarEvents` now normalizes every incoming time to a true-UTC ISO string. Handles three input shapes:
   - bare string with explicit `Z`/`+HH:MM` offset → passes through
   - Microsoft Graph object `{dateTime, timeZone}` → converts via `Intl` (supports Windows TZ names like `Central Standard Time`)
   - legacy bare string with no offset → tagged as UTC (matches old behavior) AND leaves `tz_normalized_at = NULL` so the backfill catches it
   
   Adds new column `tz_normalized_at` for idempotency. Bumps `version` to 53.

3. **DB migration** (`supabase/migrations/dialysis/20260521000000_dia_calendar_events_normalize_to_utc.sql`) — One-shot backfill: shifts every existing row by the Central offset it implicitly carried (CDT in May = +5h; CST in winter = +6h). Postgres's `AT TIME ZONE 'America/Chicago'` handles DST. Marks shifted rows so it's safe to re-run.

4. **Power Automate flow JSON** — Two updated flows:
   - `flow-personal-calendar-sync.json` (Outlook.com): now enumerates ALL personal calendars (including iCal subscriptions like TeamSnap) and emits `Start`/`End` as full `{dateTime, timeZone}` objects.
   - `flow-outlook-calendar-sync.json` (Office 365): new file, replaces the existing `Outlook Calendar - LCC Sync` flow. Iterates `/v3/Me/Calendars` so shared mailbox calendars + iCal subscriptions get pulled.

## Why the displayed times will change

Before the fix, the May 20 "Bi-Monthly Broker Meeting" displayed at 6 AM CT but the actual Outlook event is at 11 AM CT. That's a DATA issue caused by the legacy PA flow writing the wrong value for that recurring instance. The migration alone won't fix the actual time — only re-syncing from Outlook (step 5 below) will.

## Deployment order

Do these in sequence with minimal gaps between steps 1–3 to keep the broken-display window short (~minutes).

### 1. Deploy edge function (safe to do first, no display impact)

```bash
# From your workstation, in the LCC repo root
export SUPABASE_ACCESS_TOKEN=<your_PAT>  # from https://supabase.com/dashboard/account/tokens
supabase functions deploy ai-copilot \
  --project-ref zqzrriwuavgrquhisnoa \
  --no-verify-jwt
```

Verify in Supabase logs that the next PA cron run posts to `/sync/calendar-events` and returns `"version": 53`.

### 2. Apply the backfill migration

Run in Supabase SQL Editor for project `zqzrriwuavgrquhisnoa` (Dialysis_DB):

```sql
-- contents of supabase/migrations/dialysis/20260521000000_dia_calendar_events_normalize_to_utc.sql
```

Expected: ~299 rows updated, `tz_normalized_at` populated.

**Note**: between this step and step 3, the currently-deployed frontend (old `stripTZ` logic) will display all times +5 hours from where they used to (since the underlying stored times shifted forward by the CDT offset). Get step 3 deployed quickly.

### 3. Deploy frontend (Vercel auto-deploys on push)

```bash
git push origin claude/fix-calendar-issues-l4200
# Merge to main; Vercel deploys in ~2 minutes
```

After Vercel deploy completes, all 299 existing events display the same Central time they did before the fix.

### 4. Import the new Power Automate flows

In Power Automate (https://make.powerautomate.com):

- **`LCC - Personal Calendar Sync`** (existing flow): Edit → import updated definition from `flow-personal-calendar-sync.json`. The new version (a) iterates every personal calendar instead of just the default one, and (b) sends `Start`/`End` as full objects.
- **`Outlook Calendar - LCC Sync`** (existing flow): Edit → import the updated definition from `flow-outlook-calendar-sync.json`. The new version iterates `/v3/Me/Calendars` so shared/delegate work calendars + iCal subscriptions land too.

Configure the connections (`outlookcom` for personal, `office365` for work) to the same accounts as today.

### 5. Trigger a manual run on each flow

In the PA UI: Open each flow → "Run". This forces an immediate re-pull from Outlook, overwriting the May 20 Bi-Monthly Broker Meeting (and every other event in the ±30-day window) with the actual Outlook time. The May 20 instance should now correctly show as 11 AM CT.

### 6. Verify

```sql
-- Should now show calendar_name populated (was 100% NULL before)
SELECT calendar_name, count(*) FROM calendar_events
WHERE synced_at > now() - interval '2 hours'
GROUP BY calendar_name ORDER BY 2 DESC;

-- Should show the Bi-Monthly Broker Meeting now stored as 16:00 UTC (11 AM CDT)
SELECT subject, start_time, tz_normalized_at FROM calendar_events
WHERE subject ILIKE '%bi-monthly broker%'
ORDER BY start_time DESC LIMIT 3;

-- Should show events from your shared/TeamSnap calendars
SELECT DISTINCT calendar_name FROM calendar_events;
```

## Rollback

If anything breaks:

```sql
-- Undo the backfill (shifts everything back)
UPDATE public.calendar_events
SET start_time = (start_time AT TIME ZONE 'America/Chicago')::timestamp AT TIME ZONE 'UTC',
    end_time   = CASE WHEN end_time IS NULL THEN NULL
                      ELSE (end_time AT TIME ZONE 'America/Chicago')::timestamp AT TIME ZONE 'UTC' END,
    tz_normalized_at = NULL
WHERE tz_normalized_at IS NOT NULL;
```

Then redeploy the previous `app.js` (revert this branch) and re-deploy the previous edge function version (`supabase functions deploy ai-copilot --project-ref zqzrriwuavgrquhisnoa` from the prior commit).

## What's still a known issue after this fix

- **`tz_normalized_at` column is brand new.** Migration adds it via `IF NOT EXISTS` — re-running the migration won't drop existing values. Safe.
- **PA flow re-import is manual.** The flows aren't deployed via Git; the JSON in this repo is reference-only.
- **One-time historical events outside the ±31-day PA window** stay frozen with whatever the backfill left them at. They'll continue to display at the same CT they showed before. If you need to correct deep history, re-sync each event manually from Outlook.

## 2026-05-22 update — what actually shipped (read this)

This runbook describes the *intended* design. In practice the deployed flow did **not**
match the repo flow-JSON files, and steps 4–5 above (importing the repo JSON) were the
WRONG move — the live flow is a richer hand-built flow whose simplified repo copies were
never imported. The real fix was made by editing the **live** flow's `Compose Event`
(`start`/`end` → offset-bearing `startWithTimeZone`/`endWithTimeZone`) and repairing the
`Append to array variable` value (`@outputs('Compose_Event')`, which had been corrupted
to literal text → `events_upserted: 0`). Times now verify correct (Focus time = 8 AM CT,
`tz_normalized_at = true`, 17 events upserted).

`calendar_name` is still NULL (Check 2 — deferred). Full accurate write-up, real action
topology, and the calendar-name circle-back plan live in
[`flows/outlookcalendar-lcc-sync.md`](flows/outlookcalendar-lcc-sync.md) → section
"2026-05-22 — Actual deployed architecture, TZ fix applied, and open items".
