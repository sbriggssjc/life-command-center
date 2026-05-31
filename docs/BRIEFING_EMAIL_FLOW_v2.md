# LCC Morning Briefing v2 — Power Automate Flow Spec

The v2 executive briefing email is a 10-section, brand-styled HTML rendered
by `GET|POST /api/briefing-email`. This doc describes the flow Power Automate
needs to run each weekday morning.

## Overview

```
5:30 AM CT   pg_cron → Supabase Edge: briefing-intel-snapshot
                     ↳ fetches Yahoo Finance + RSS + Claude AI
                     ↳ writes one row to briefing_intel_snapshot
6:00 AM CT   Power Automate scheduled flow:
                     1. Get today's calendar events (Outlook)
                     2. Get today's to-do tasks (Microsoft To Do)
                     3. (Optional) Get weather for home base
                     4. POST /api/briefing-email with the above as JSON
                     5. Pipe response { subject, html } into Send Email
```

The flow uses two LCC endpoints and three Microsoft 365 connectors. Total
runtime: ~8-12 seconds.

## Endpoints

### 1. Briefing snapshot generator (Supabase Edge)

| | |
|---|---|
| URL | `${OPS_FUNCTIONS_URL}/briefing-intel-snapshot` |
| Method | `POST` |
| Schedule | Cron `30 11 * * 1-5` (UTC, = 5:30 AM CT in winter / 6:30 AM CT in summer) |
| Auth | Supabase service-role bearer token |
| Body | `{}` — defaults to today, auto-detects Friday for deep-dive variant |
| Required env | `OPS_SUPABASE_URL`, `OPS_SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY` |

Schedule via pg_cron on LCC Opps (preferred — keeps cadence with other
LCC crons):

```sql
select cron.schedule(
  'lcc-briefing-intel-snapshot',
  '30 11 * * 1-5',
  $$
    select public.lcc_cron_post(
      '/briefing-intel-snapshot',
      '{}'::jsonb,
      'edge'
    );
  $$
);
```

Manual dry-run (no DB write) for QA:
```
GET ${OPS_FUNCTIONS_URL}/briefing-intel-snapshot?dry_run=1
```

### 2. Briefing email render (Vercel)

| | |
|---|---|
| URL | `${LCC_BASE_URL}/api/briefing-email` |
| Method | `POST` (use GET if no calendar/todo context is being supplied) |
| Headers | `X-LCC-Key: ${LCC_API_KEY}` (required)<br>`X-LCC-Workspace: ${WORKSPACE_ID}`<br>`X-LCC-User-Id: ${USER_ID}`<br>`Content-Type: application/json` |
| Body (POST) | See "POST body shape" below |
| Response | `{ subject, html, text, generated_at, intel_freshness, personal_context_present }` |

## POST body shape

The handler is permissive — any missing key drops out gracefully. Send what
your flow can collect. Lenient field name aliases (`startTime` / `start`,
`isAllDay` / `is_all_day`, etc.) are normalized server-side.

```json
{
  "today": {
    "iso_date": "2026-05-23",
    "weekday":  "Saturday"
  },
  "calendar": {
    "events": [
      {
        "start":      "2026-05-23T13:30:00Z",
        "end":        "2026-05-23T14:00:00Z",
        "subject":    "Call: Smith Property Group — Tucson dialysis",
        "location":   { "displayName": "Zoom" },
        "attendees":  [{ "emailAddress": { "name": "Jane Smith", "address": "jane@smith.com" } }],
        "isAllDay":   false
      }
    ]
  },
  "todo": {
    "tasks": [
      {
        "title":      "Send Bronx DaVita BOV draft to listing team",
        "due":        "2026-05-23T22:00:00Z",
        "importance": "high",
        "list_name":  "BD Pipeline",
        "completed":  false
      }
    ]
  },
  "weather": {
    "high_f":    78,
    "low_f":     61,
    "condition": "Partly cloudy",
    "location":  "Tulsa, OK"
  }
}
```

All four top-level keys are optional. The handler responds in <6s even when
all four are empty — sections degrade to "no items" placeholders.

## Power Automate flow steps

Build this as a new flow named `LCC Morning Briefing v2`.

### Trigger
- **Recurrence** — frequency Day, interval 1, start time 06:00 America/Chicago.
  **Days of week: Mon–Fri only.** Weekends are intentionally excluded — the
  intel-snapshot cron runs Mon–Fri, so a weekend send would re-mail Friday's
  stale snapshot. Belt-and-suspenders: the handler also returns `should_send`
  (see Step 5b) which is `false` on Sat/Sun.

### Step 1 — Get calendar events for today
- **Action:** `Get events (V4)` (Office 365 Outlook connector)
- **Calendar:** Calendar
- **Filter Query:** `start/dateTime ge '@{formatDateTime(utcNow(),'yyyy-MM-ddT00:00:00')}' and start/dateTime lt '@{formatDateTime(addDays(utcNow(),1),'yyyy-MM-ddT00:00:00')}'`
- **Top:** 20
- **Order By:** `start/dateTime asc`
- Stored as: `today_events`

### Step 2 — Get To Do tasks
- **Action:** `List to-do items` (Microsoft To Do connector)
- **List Id:** your "Tasks" or "BD Pipeline" list
- **Filter Query:** `status ne 'completed'`
- **Top:** 20
- Stored as: `today_tasks`

### Step 3 — (Optional) Weather
- **Action:** `Get current weather` (MSN Weather connector) — Location:
  Tulsa, OK (or wherever the broker is based).
- Stored as: `today_weather`.

### Step 4 — Compose request body
- **Action:** `Compose`
- **Inputs:**

```
{
  "today": {
    "iso_date": "@{formatDateTime(utcNow(), 'yyyy-MM-dd')}",
    "weekday":  "@{dayOfWeek(utcNow())}"
  },
  "calendar": { "events": @{outputs('Get_events_(V4)')?['body/value']} },
  "todo":     { "tasks":  @{outputs('List_to-do_items')?['body/value']} },
  "weather": {
    "high_f":    @{outputs('Get_current_weather')?['body/temperature_high']},
    "low_f":     @{outputs('Get_current_weather')?['body/temperature_low']},
    "condition": "@{outputs('Get_current_weather')?['body/conditions']}",
    "location":  "Tulsa, OK"
  }
}
```

### Step 5 — Call the briefing endpoint
- **Action:** `HTTP`
- **Method:** `POST`
- **URI:** `${LCC_BASE_URL}/api/briefing-email`
- **Headers:**
  - `X-LCC-Key`: `<store in environment variable LCC_API_KEY>`
  - `X-LCC-Workspace`: `<your workspace UUID>`
  - `X-LCC-User-Id`: `<your user UUID>`
  - `Content-Type`: `application/json`
- **Body:** `@{outputs('Compose')}`
- Stored as: `briefing_response`

### Step 5b — Guard: only send on weekdays
Add a **Condition**: `@{body('HTTP')?['should_send']}` is equal to `true`.
- **If yes** → proceed to Step 6 (Send the email).
- **If no** → do nothing (or log `suppressed_reason` = `weekend_non_send`).

This is defense-in-depth alongside the Mon–Fri recurrence: even if the flow
is triggered manually or the recurrence is widened, the email is suppressed
on weekends. To force a weekend send for QA, call the endpoint with
`?force=true` (or POST `{ "force": true }`) — that flips `should_send` to true.

### Step 6 — Send the email
- **Action:** `Send an email (V2)` (Office 365 Outlook)
- **To:** the recipient (typically yourself + the team alias)
- **Subject:** `@{body('HTTP')?['subject']}`
- **Body:** `@{body('HTTP')?['html']}` — **set "Is HTML" = Yes**

### Step 7 — (Optional) Log telemetry
The response also carries `intel_freshness` and `personal_context_present`.
Drop these into a Teams card or a SharePoint log list for monitoring.

## Behavior matrix

| Snapshot present? | POST body? | Result |
|---|---|---|
| Yes | Yes | All 10 sections rendered. Best case. |
| Yes | No (GET) | All sections except "Today's Game Plan" — that one shows a hint to send PA data. |
| No  | Yes | Game Plan + Strategic + New on Market + Ops & Queue rendered; Analyst's Take, Capital Markets, Sector Watch, Reading List skipped. Header shows "Market data unavailable" chip. |
| No  | No  | LCC-internal sections only (Strategic, Pipeline, Intakes, Queue). Same as v1 behavior. |

## Friday Deep Dive

The snapshot job auto-detects Friday in America/Chicago and writes
`variant='friday_deep_dive'`. The email handler reads this and adds a
"Week in Numbers" section between Capital Markets and Deal Intelligence,
showing 1-day and 5-day deltas across 14 metrics. The subject changes from
`LCC Morning Briefing` to `LCC Weekly Deep Dive`.

To force a Friday variant on demand (e.g., for QA):
```
POST ${OPS_FUNCTIONS_URL}/briefing-intel-snapshot?variant=friday_deep_dive
```

## Env vars

Production:
```
# Vercel
LCC_API_KEY=<rotate via Vercel env>
LCC_DEFAULT_WORKSPACE_ID=<workspace UUID>
LCC_SYSTEM_USER_ID=<user UUID>
OPS_SUPABASE_URL=https://<ops-ref>.supabase.co
OPS_SUPABASE_KEY=<anon key — handler reads only>
DIA_SUPABASE_URL=https://<dia-ref>.supabase.co
DIA_SUPABASE_KEY=<anon or service key>
GOV_SUPABASE_URL=https://<gov-ref>.supabase.co
GOV_SUPABASE_KEY=<anon or service key>

# Supabase Edge (briefing-intel-snapshot)
OPS_SUPABASE_URL=https://<ops-ref>.supabase.co
OPS_SUPABASE_SERVICE_KEY=<service role key — function writes>
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6   # optional
```

## Deploy checklist

1. Apply migration `schema/040_briefing_intel_snapshot.sql` on LCC Opps.
2. Deploy edge function:
   ```
   supabase functions deploy briefing-intel-snapshot --project-ref <ops-ref>
   ```
3. Set `ANTHROPIC_API_KEY` and (if missing) `OPS_SUPABASE_SERVICE_KEY` on
   the LCC Opps edge function env.
4. Schedule the pg_cron job (see SQL block above). Verify it runs:
   ```sql
   select * from cron.job_run_details
    where jobname='lcc-briefing-intel-snapshot'
    order by start_time desc limit 5;
   ```
5. Confirm a snapshot row landed:
   ```sql
   select as_of_date, variant, ai_tokens_in, ai_tokens_out,
          source_counts->>'news_total' as news_n
     from briefing_intel_snapshot
    order by generated_at desc limit 3;
   ```
6. Update the Power Automate flow per the steps above. Switch the existing
   `LCC Morning Briefing` flow to disabled before enabling v2 so you don't
   double-send.
7. Smoke-test by hitting `POST /api/briefing-email` from Postman with a
   minimal body — verify the HTML preview renders the new layout.

## Rollback

The new handler is fully backward-compatible with the v1 flow (which only
sent GET, no body). If v2 misbehaves, switch the Power Automate flow back
to GET and remove the POST body — the email still renders, just without
calendar / to-do.

To revert the handler entirely: `git revert` the commit that landed this
file's sibling rewrite of `api/_handlers/briefing-email-handler.js`. The
old layout was the 5-section version captured in this commit's parent.
