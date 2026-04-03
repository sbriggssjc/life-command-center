# Personal Outlook.com — Power Automate Setup Guide

One flow to set up. It syncs your personal Outlook.com calendar events to the LCC Supabase backend every hour — same pattern as the work calendar sync. Personal flagged emails already route to Microsoft To Do via the existing flag-to-task flow.

---

## Pre-requisite: Add the Outlook.com Connection

1. Go to [Power Automate](https://make.powerautomate.com)
2. Left sidebar → **Connections**
3. Click **+ New connection**
4. Search for **Outlook.com** (the one with the blue Outlook icon — NOT "Office 365 Outlook")
5. Sign in with your personal Microsoft account (sbriggssjc@gmail.com or your Outlook.com address)
6. Once connected, you'll see it listed alongside your existing Office 365 connection

---

## Flow: Personal Calendar Sync → Supabase

Pulls events from your personal Outlook.com calendar and POSTs them to the same Supabase Edge Function endpoint that handles work calendar events. Events are tagged with `CalendarName: "personal"` so the LCC frontend can filter them.

### Quick Build (5 min)

1. **Create new flow** → Scheduled cloud flow
2. **Name:** `LCC - Personal Calendar Sync`
3. **Schedule:** Every 1 hour

### Steps

**Step 1 — Initialize variable**
- Name: `AllEvents`
- Type: Array
- Value: `[]`

**Step 2 — Get events (V4)** — use the **Outlook.com** connector (NOT Office 365 Outlook)
- Calendar: Calendar
- Start Time: `addDays(utcNow(), -1)`
- End Time: `addDays(utcNow(), 30)`

**Step 3 — Apply to each** → loop over `value` from Get events

Inside the loop, add **Append to array variable**:
- Variable: `AllEvents`
- Value (switch to JSON/expression mode):
```json
{
  "Id": "personal-@{items('Apply_to_each')?['id']}",
  "Subject": "@{items('Apply_to_each')?['subject']}",
  "Start": "@{items('Apply_to_each')?['start']}",
  "End": "@{items('Apply_to_each')?['end']}",
  "Location": "@{items('Apply_to_each')?['location']?['displayName']}",
  "IsAllDay": "@{items('Apply_to_each')?['isAllDay']}",
  "Organizer": "@{items('Apply_to_each')?['organizer']?['emailAddress']?['address']}",
  "BodyPreview": "@{substring(coalesce(items('Apply_to_each')?['bodyPreview'], ''), 0, min(length(coalesce(items('Apply_to_each')?['bodyPreview'], '')), 300))}",
  "WebLink": "@{items('Apply_to_each')?['webLink']}",
  "IsRecurring": "@{items('Apply_to_each')?['isRecurrence']}",
  "CalendarName": "personal",
  "Sensitivity": "@{items('Apply_to_each')?['sensitivity']}",
  "ShowAs": "@{items('Apply_to_each')?['showAs']}"
}
```

> **Key detail:** `CalendarName: "personal"` is what tags these events so LCC shows them on the Personal tab instead of the work calendar. The `Id` is prefixed with `personal-` to prevent ID collisions with work events.

**Step 4 — HTTP action** (POST to Supabase)
- Method: `POST`
- URI: `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/calendar-events`
- Headers:
  - `Content-Type`: `application/json`
- Body:
```json
{
  "events": @{variables('AllEvents')}
}
```

### Or Import the JSON Definition

Use `flow-personal-calendar-sync.json` from the repo. In Power Automate:
1. My flows → Import → Import Package
2. Select the JSON file
3. Configure the Outlook.com connection when prompted

---

## What About Personal Flagged Emails?

The existing **flagged email → To Do** flow already creates tasks in your To Do lists (Personal, Family, Kids, Health, Finance, House). As long as you flag emails in your personal Outlook.com inbox, they'll appear as To Do tasks — which the existing To Do sync already picks up.

If you want flagged personal emails to also create To Do tasks automatically, you have two options:

**Option A (Recommended):** Flag emails in Outlook.com → they show up in your To Do "Flagged Emails" list automatically (Microsoft's built-in feature). The existing To Do sync flow picks them up.

**Option B:** Create a second flag-to-task flow using the Outlook.com connector. Use `flow-personal-email-flag-to-todo.json` as a template. This gives you sender-based routing (e.g., school emails → Kids list).

---

## Test It

1. Save the flow and run it manually once
2. Check the LCC app → Personal tab
3. Your personal calendar events should appear, grouped by date
4. If no events show, check the flow run history for errors

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "The connector is not available" | Make sure you added the Outlook.com connection (not Office 365 Outlook) |
| Events show on work calendar instead of personal | Check that `CalendarName` is set to `"personal"` in the Append step |
| HTTP POST fails with 400 | Make sure the body wraps events in `{ "events": [...] }` |
| No events in LCC after flow runs | Check Supabase → `calendar_events` table for rows with `calendar_name = 'personal'` |
