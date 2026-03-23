# Power Automate Update Guide — Salesforce & RCM Flows

> **Purpose**: Step-by-step instructions for updating Power Automate flows to fix RCM ingestion and enable recurring Salesforce activity sync.
> **Audience**: Claude Cowork / Flow administrators
> **Last updated**: 2026-03-23

---

## Status: ALL CHANGES COMPLETE (Mar 23, 2026)

| # | Flow | Change | Status |
|---|------|--------|--------|
| 1 | RCM Email Watcher | Updated endpoint from `/api/dia-query` → `/api/rcm-ingest` | **DONE** (Mar 23, 10:47 AM) |
| 2 | Sync SF Activities to Supabase | Filter query updated to rolling 7-day window; recurrence already set to 4h | **DONE** (Mar 23) |
| 3 | (No change) | `salesforce_tasks` table — ignore | Info only |

Both flows are **On** and running on their configured schedules. Next RCM email arrival triggers the new `/api/rcm-ingest` endpoint. SF sync pulls fresh activities within the next 4 hours.

---

## 1. RCM Email Watcher — Update Endpoint URL

### What's wrong

The RCM flow currently POSTs raw email bodies to `/api/dia-query`, which does a raw table insert without parsing. Contact name, email, phone, and company are never extracted from the email text — they sit in `raw_body` unprocessed.

### What to change

In the Power Automate flow that watches `Inbox/Property marketing/RCM`:

**Find the HTTP action** that POSTs to Supabase/LCC. Change the URI:

```
BEFORE:  https://life-command-center-nine.vercel.app/api/dia-query
AFTER:   https://life-command-center-nine.vercel.app/api/rcm-ingest
```

**Keep the same request body structure:**

```json
{
  "source": "rcm",
  "source_ref": "@{triggerOutputs()?['body/id']}",
  "deal_name": "@{triggerOutputs()?['body/subject']}",
  "raw_body": "@{body('Html_to_text')?['text']}",
  "status": "new"
}
```

**Keep the same headers** (authentication headers for the LCC API).

### What the new endpoint does

The `/api/rcm-ingest` endpoint:
1. Parses the `raw_body` to extract: contact name, email, phone, company, inquiry type
2. Inserts into `marketing_leads` table with all parsed fields
3. Auto-matches to existing Salesforce contacts by email
4. Creates a linked `salesforce_activities` task so the lead appears in the CRM hub
5. Refreshes the CRM materialized view for immediate visibility
6. Deduplicates by `(source, source_ref)` — safe to retry

### Verification after update

1. Forward an RCM notification email to `Inbox/Property marketing/RCM`
2. Check Power Automate run history — should show 201 response
3. In LCC Marketing tab, the RCM lead should appear with parsed name/email/phone
4. Check browser console for `[RCM Backfill]` messages on next load

---

## 2. SF Activities Sync — Convert to Recurring Schedule

### What's wrong

The "Sync SF Activities to Supabase" flow ran as a one-time bulk load. It imported ~359K activity rows filtered to:
- `ActivityDate >= 2025-01-01`
- `OwnerId eq '0051I000001vHJbQAM'` (Scott Briggs)

Since it doesn't recur, new SF activities (calls logged, tasks created, opportunities updated) never reach LCC. The CRM hub shows stale data.

### What to change

**Option A: Schedule the existing flow (recommended)**

1. Open the "Sync SF Activities to Supabase" flow
2. Change the trigger from **Manual** to **Recurrence**
3. Set interval: **Every 4 hours** (or daily if concerned about API limits)
4. Add a filter to only fetch recent records:
   - `ActivityDate >= [utcNow() minus 7 days]`
   - This keeps each run small (~50-200 records vs 359K)
5. The LCC endpoint handles deduplication — duplicate SF IDs are safely ignored

**Option B: Use the LCC sync endpoint**

Create a new scheduled flow:

```
Trigger: Recurrence — Every 4 hours
Action:  HTTP POST to https://life-command-center-nine.vercel.app/api/sync?action=ingest_sf_activities
Headers: (same auth headers as other LCC flows)
Body:    {} (empty — the endpoint fetches from the edge function)
```

This calls the existing `ingestSfActivities()` handler which:
- Fetches from the ai-copilot edge function (`/sync/sf-activities`)
- Deduplicates by SF activity ID
- Creates `inbox_items` for open tasks
- Logs to `activity_events` for audit trail
- Updates connector health status

### Filter parameters

The edge function supports these query parameters:
- `limit` — max records (default 5000)
- `sort_dir` — `desc` for newest first
- `assigned_to` — `all` for full team, or specific name

### Verification

1. After enabling the schedule, wait for the first run
2. Check Power Automate run history for success
3. In LCC, open Marketing tab — new activities should appear
4. Check `/api/sync?action=health` for connector status

---

## 3. About `salesforce_tasks` — No Action Needed

The `salesforce_tasks` table contains **10,410 records from a May 2020 Data Loader bulk import**. These are NOT real open tasks — they're artifacts from a one-time data migration:

- All created on the same date (May 2020)
- All have the same `owner_id`
- All marked "Open" but are 6 years old
- Zero records created after June 2020

**No Power Automate flow feeds this table.** LCC no longer reads from it (disabled in the March 23 update). The table can be left as-is or cleaned up at your discretion.

Real open tasks come from `salesforce_activities` via `v_crm_client_rollup`.

---

## Current Flow Inventory

| Flow | Trigger | Frequency | Status |
|------|---------|-----------|--------|
| To Do Sync | Recurrence | Hourly | Working |
| Email Flag → Todo (Work) | Email flagged | Event-driven | Working |
| Email Flag → Todo (Personal) | Email flagged | Event-driven | Working |
| Complete → Unflag | Recurrence | Every 15 min | Working |
| Personal Calendar Sync | Recurrence | Hourly | Working |
| RCM Email Watcher | Email arrives in RCM folder | Event-driven | **DONE** (Mar 23) |
| Sync SF Activities | Recurrence | Every 4 hours | **DONE** (Mar 23) |
| Log Activity to SF | HTTP trigger | On demand | Working |
| **Complete SF Task** | HTTP trigger | On demand | **NEW — needs creation (see Section 4)** |

---

## Environment & Endpoints Reference

| Endpoint | Purpose |
|----------|---------|
| `/api/rcm-ingest` | RCM email parsing + lead creation |
| `/api/rcm-backfill` | Re-process existing unparsed RCM leads |
| `/api/sync?action=ingest_sf_activities` | Ingest SF activities via edge function |
| `/api/sync?action=health` | Check sync connector health |
| `/api/sync?action=verify_connector` | Verify a specific connector |
| `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/sf-activities` | Edge function: fetch SF activities |
| `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/log-to-sf` | Edge function: write activity back to SF |

---

## Salesforce Read/Write Capabilities in LCC

### What works today

| Feature | How it works | Status |
|---------|-------------|--------|
| **View open tasks** | `v_crm_client_rollup` (from `salesforce_activities`) | Working |
| **Log Call/Activity** | "Log" button → edge function `/sync/log-to-sf` → Power Automate → creates SF Task | Working |
| **Complete task** | Marks complete in Supabase + fires `/sync/log-to-sf` to SF | Working |
| **Reschedule task** | Updates `activity_date` in Supabase + syncs to SF | Working |
| **Dismiss task** | Marks complete with "[Dismissed]" note + syncs to SF | Working |
| **Log & Reschedule** | Logs today's touchpoint + pushes task date out | Working |
| **SF Contact link** | Contact names hyperlink to `northmarqcapital.lightning.force.com` | Working |

## 4. NEW: Complete SF Task Flow — Close Open Activities from LCC

### Problem

When users click "Complete" on a task in LCC, it:
1. Marks the activity `Completed` in Supabase (works) ✅
2. Creates a NEW completed SF Task via `/sync/log-to-sf` → "Log Activity to SF" PA flow ✅
3. **But the ORIGINAL open SF Task stays Open** ❌

The original task isn't closed because the "Log Activity to SF" flow only **creates** tasks — it can't **update** existing ones.

### New Power Automate Flow: "Complete SF Task"

**Trigger:** HTTP request (When an HTTP request is received)

**Expected JSON payload:**
```json
{
  "sf_contact_id": "0038W00002PSA33",
  "subject": "4 - DaVita MOB - Charlottesville, VA",
  "action": "complete",
  "ref_id": "LCC-abc12345"
}
```

**Flow steps:**

1. **Parse JSON** — Parse the trigger body

2. **Get records (Salesforce)** — Query for the open task:
   - Object type: `Task`
   - Filter query: `WhoId = '@{triggerBody()?['sf_contact_id']}' AND Subject = '@{triggerBody()?['subject']}' AND Status != 'Completed'`
   - Top count: 1

3. **Condition** — Check if a task was found:
   - If yes (task exists):
     - **Update record (Salesforce)** — Update the found Task:
       - Record ID: `@{first(outputs('Get_records')?['body/value'])?['Id']}`
       - Status: `Completed`
       - Description: append `[Completed via LCC: @{triggerBody()?['ref_id']}]`
     - **Respond to HTTP request** — 200 OK: `{ "success": true, "task_id": "...", "action": "completed" }`
   - If no (task not found):
     - **Respond to HTTP request** — 200 OK: `{ "success": true, "task_id": null, "action": "not_found" }`

**After creating the flow:**

1. Copy the HTTP trigger URL
2. Store it as Supabase secret: `PA_COMPLETE_TASK_URL`
3. The edge function `/sync/log-to-sf` will be updated to also call this URL when `action: 'complete'` is present in the payload

### Edge function changes needed

The `/sync/log-to-sf` edge function needs a new code path:
- If the payload contains `action: 'complete'` AND `subject`:
  - Call `PA_COMPLETE_TASK_URL` with `{ sf_contact_id, subject, action, ref_id }`
  - This closes the original open SF task
  - THEN also create the completion log entry (existing behavior)

### LCC app-side changes (already done)

The `_syncTaskToSalesforce` function now sends:
- `subject`: The task/deal name (e.g., "4 - DaVita MOB - Charlottesville, VA")
- `deal_name`: The linked opportunity name if available
- `activity_type`: `'Call'` for completions (not generic 'Follow-up')
- `notes`: `[Completed] subject | Deal: deal_name`

---

### What works today (detail)

- **Log Call/Activity**: "Log" button opens a modal → POSTs to edge function `/sync/log-to-sf` → Power Automate creates a Salesforce Task with `WhoId`, `WhatId`, `ActivityDate`, `Status=Completed`. Includes a 75-day guard rail that warns if another team member recently logged activity on the same contact. Users can override with `force: true`.
- **Complete task**: PATCHes `salesforce_activities` status to `Completed` in Supabase, then fires `/sync/log-to-sf` to record completion in SF (non-blocking).
- **Reschedule task**: Updates `activity_date` in Supabase. **Note**: the reschedule does NOT currently push the new date back to SF — only updates locally.
- **Log & Reschedule**: Logs today's touchpoint via `/sync/log-to-sf` AND pushes the task date out in Supabase.

### What's missing or needs improvement

| Gap | Impact | Priority | Recommendation |
|-----|--------|----------|----------------|
| **SF sync is one-time** | Tasks go stale after initial load | **High** | Make recurring (see Section 2) |
| **No task creation from LCC** | Can't create new SF tasks, only log activities | Medium | Add "New Task" modal that POSTs to `/sync/log-to-sf` with `status: 'Open'` |
| **Task status lifecycle** | Can't update task status (Open → In Progress → Completed) without going to SF | Medium | Add `/sync/update-sf-task` endpoint with `status` parameter |
| **Reschedule doesn't push to SF** | Rescheduled dates only update locally in Supabase | Medium | Add SF writeback in `submitLogReschedule` function |
| **No opportunity stage sync** | Opportunity stage changes in SF don't reflect in LCC | Low | Add opportunity-specific sync via edge function |
| **Outbound flag disabled** | `sync_outbound_enabled: false` — the formal outbound pipeline is off | Low | Direct edge function calls work fine today; enable flag when ready for full audit trail via `/api/sync?action=outbound` |
| **No Kelly Largent filter** | CRM hub defaults to "My Tasks" (Scott) — Kelly's tasks require "All Tasks" toggle | Low | Add team member selector or auto-detect from login |

### Implementation priority

**Phase 1 — DONE (Mar 23)**
1. ~~RCM flow URL update~~ ✅
2. ~~SF Activities recurring sync~~ ✅
3. ~~Task routing fix (prospect-pattern subjects)~~ ✅
4. ~~Deal context in SF completion logs~~ ✅

**Phase 2 — In progress (PA changes needed)**
1. **Complete SF Task flow** — New PA flow to close original open SF tasks (Section 4 above)
2. Reschedule → push new date to SF (similar PA flow: update `ActivityDate` on existing task)
3. Task creation modal + SF writeback

**Phase 3 — Polish**
1. Enable `sync_outbound_enabled` flag for full audit trail
2. Opportunity stage sync
3. Bulk task operations
4. Task completion metrics / completion rate in CRM rollup

### Marketing vs Prospecting — Separate Task Views

Currently all CRM contacts land on the marketing tab, with opportunity-linked tasks routed to domain prospect sections via `deal_name` detection. This works but could be cleaner.

**Current classification logic:**
- Task has a `deal_name` (SF `what_name`) → routed to domain prospect tab (government/dialysis/all_other)
- Task has no `deal_name` → stays on marketing tab as a CRM outreach task
- Domain determined by: opportunity domain map → keyword classification (company name, task subjects) → fallback to `all_other`

**What the `open_tasks` JSON already contains:**

The `v_crm_client_rollup` view's `open_tasks` array has this structure per task:
```json
{
  "subject": "Call about DaVita deal",
  "date": "2026-03-19",
  "notes": "Follow-up notes...",
  "type": "Opportunity"
}
```

The `type` field is `nm_type` from `salesforce_activities`. Common values: `Task`, `Opportunity`, `Call`, `Email`.

**Current separation (shipped today):**
- `type === 'Opportunity'` OR task has a `deal_name` → routed to domain prospect tab
- Everything else → stays on marketing tab

**Recommended future enhancement — task intent classification:**

Add a `task_intent` classification to better separate:

| Intent | Example | Where it shows |
|--------|---------|----------------|
| `marketing_outreach` | "Call John about Q2 market trends" | Marketing tab |
| `prospecting` | "Call John RE: DaVita Omaha acquisition" | Domain prospect tab |
| `internal` | "Update CRM notes" | Marketing tab |

Classification logic:
1. Task has `WhatId` (Opportunity linked) → `prospecting`
2. Task has `WhoId` only + type is Call/Email/Follow-up → `marketing_outreach`
3. Else → `internal`

This would be a Supabase column addition + app.js filter update. No Power Automate changes needed — classification happens at load time.
