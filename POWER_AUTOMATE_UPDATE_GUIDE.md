# Power Automate Update Guide — Salesforce & RCM Flows

> **Purpose**: Step-by-step instructions for updating Power Automate flows to fix RCM ingestion and enable recurring Salesforce activity sync.
> **Audience**: Claude Cowork / Flow administrators
> **Last updated**: 2026-03-23

---

## Overview of Changes Needed

| # | Flow | Change | Priority |
|---|------|--------|----------|
| 1 | RCM Email Watcher | Update endpoint URL | **High** — RCM leads not parsing |
| 2 | Sync SF Activities to Supabase | Convert from one-time to recurring schedule | **High** — tasks go stale |
| 3 | (No change) | `salesforce_tasks` table — ignore | Info only |

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
| RCM Email Watcher | Email arrives in RCM folder | Event-driven | **Needs URL update** |
| Sync SF Activities | Manual (one-time) | N/A | **Needs recurring schedule** |

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

### What's missing or needs improvement

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| **SF sync is one-time** | Tasks go stale after initial load | Make recurring (see Section 2) |
| **No task creation from LCC** | Can't create new SF tasks, only log activities | Add "New Task" button that POSTs to `/sync/log-to-sf` with `status: 'Open'` |
| **No opportunity sync** | Opportunity stage changes in SF don't reflect in LCC | Add opportunity-specific sync via edge function |
| **Outbound flag disabled** | `sync_outbound_enabled: false` — the formal outbound pipeline is off | The direct edge function calls work fine; enable flag when ready for full audit trail |
| **No Kelly Largent filter** | CRM hub defaults to "My Tasks" (Scott) — Kelly's tasks require "All Tasks" toggle | Add team member selector or auto-detect from login |

### Marketing vs Prospecting — Separate Task Views

Currently all CRM contacts land on the marketing tab, with opportunity-linked tasks routed to domain prospect sections via `deal_name` detection. This works but could be cleaner:

**Current classification logic:**
- Task has a `deal_name` (SF `what_name`) → routed to domain prospect tab (government/dialysis/all_other)
- Task has no `deal_name` → stays on marketing tab as a CRM outreach task
- Domain determined by: opportunity domain map → keyword classification (company name, task subjects) → fallback to `all_other`

**Recommended improvement — add `nm_type` to the rollup view:**

The `v_crm_client_rollup` view's `open_tasks` JSON already includes `type` (which is `nm_type` from `salesforce_activities`). Common values:
- `Task` — generic CRM task (call, follow-up)
- `Opportunity` — deal-linked activity

A future enhancement could use this to create dedicated sub-filters:
- **Marketing tab**: Only `type = 'Task'` with no `deal_name` (pure outreach)
- **Prospect tabs**: `type = 'Opportunity'` or any task with a `deal_name`

This separation already works with the current `deal_name` detection we shipped today. No additional Power Automate changes needed — the classification happens in `app.js` at load time.
