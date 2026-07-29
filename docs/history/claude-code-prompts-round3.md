# LCC Round 3 — Fixes from Live App Testing (April 8, 2026)

Issues discovered by walking through the live app at life-command-center-nine.vercel.app. Organized by severity.

---

## Prompt R3-1: Fix Daily Briefing API 500 Error

**Target:** LCC Vercel Repo (`api/daily-briefing.js`)

```
TASK: The /api/daily-briefing?action=snapshot endpoint is returning HTTP 500 with "FUNCTION_INVOCATION_FAILED". This causes the Daily Briefing section to show "Daily briefing unavailable" with a Retry button.

ERROR FROM VERCEL LOGS:
The function is crashing before it can return a response — this is a Vercel function invocation failure, not a caught application error.

INVESTIGATION:
1. Check Vercel deployment logs for the daily-briefing function:
   - Go to Vercel dashboard → Deployments → Functions tab → daily-briefing.js
   - Look for the actual error stack trace (could be: missing env var, Supabase timeout, 
     unhandled promise rejection, or payload too large)

2. Common causes for FUNCTION_INVOCATION_FAILED:
   - Unhandled exception in async code
   - Function exceeding Vercel Hobby plan memory limit (1024 MB)
   - Function exceeding timeout (10 seconds on Hobby plan)
   - Missing environment variable (OPS_SUPABASE_URL, OPS_SUPABASE_KEY)

3. The daily briefing aggregates data from multiple sources (daily-briefing.js):
   - OPS Supabase: mv_work_counts, mv_user_work_counts (lines ~115-116)
   - DIA Supabase: v_sf_activity_feed, v_marketing_deals (lines ~460-500)
   - GOV Supabase: mv_gov_overview_stats
   - If ANY of these queries fail unhandled, the whole function crashes

FIX:
Wrap the entire handler in a try/catch and return a partial/degraded response instead of crashing:

In the main handler function, ensure:
1. Each Supabase query has its own try/catch with fallback to empty data
2. The outer handler catches any unhandled error and returns { error: 'Briefing build failed', partial: true }
3. Add console.error logging for the actual error before returning the 500

ALSO: Check if the function has grown too large to execute within 10 seconds. If so, 
consider caching the last successful snapshot in OPS Supabase and returning it on failure.

FILES: api/daily-briefing.js
```

---

## Prompt R3-2: Fix Email Sync API 500 Error

**Target:** LCC Vercel Repo (`api/sync.js`)

```
TASK: The /api/sync?action=flagged_emails endpoint is returning HTTP 500 with {"error":"Internal server error"}. This causes the Flagged Emails stat to show "-" and no emails load on the home page.

The email sync flow:
1. Frontend calls: GET /api/sync?action=flagged_emails&limit=2000
2. sync.js routes this to an edge function at EDGE_FUNCTION_URL + /sync/flagged-emails
3. The edge function calls Microsoft Graph API for flagged emails
4. Results are returned to the frontend

INVESTIGATION:
1. Check sync.js — find the handler for action=flagged_emails
   - Is the EDGE_FUNCTION_URL env var set correctly?
   - Is the edge function reachable from Vercel?
   - Is there proper error handling wrapping the fetch to the edge function?

2. The limit was recently increased from 500 to 2000 — if the edge function can't handle 
   that volume, it may be timing out

3. Check if the Outlook OAuth connector token has expired — the edge function needs a valid 
   token to call Graph API

FIX OPTIONS:
A. If the edge function is down: Add a fallback in sync.js that returns cached email data 
   from the OPS inbox_items table (which already has ingested emails)
B. If the limit is too high: Reduce back to 500 or implement pagination
C. If the auth token expired: Refresh the connector in the admin panel

IMMEDIATE FRONTEND FIX: 
The home page already has inbox data from the canonical model (/api/queue-v2?view=inbox) 
which returned 28 items successfully. The stat card should fall back to showing the canonical 
inbox count when the email sync fails. In app.js renderHomeStats(), if emailTotalCount is 
still 0 or undefined after load, use canonicalInbox.pagination.total instead.

FILES: api/sync.js, app.js (renderHomeStats fallback)
```

---

## Prompt R3-3: Add Gov Tables to Allowlist — 403 Access Denied

**Target:** LCC Vercel Repo (`api/_shared/allowlist.js`)

```
TASK: Several government database tables are returning 403 "Read access denied" errors because they're not in the proxy allowlist. This breaks:
- Gov Research tab (sales_comps, research_queue_outcomes, pending_updates)
- Gov Sales detail panel (sales_comps query for transaction history)

ERRORS FROM CONSOLE:
- govQuery research_queue_outcomes: HTTP 403 {"error":"Read access denied for table: research_queue_outcomes"}
- govQuery sales_comps: HTTP 403 {"error":"Read access denied for table: sales_comps"}
- govQuery pending_updates: HTTP 403 {"error":"Read access denied for table: pending_updates"}

FIX:
Add these tables to the GOV allowlist in /api/_shared/allowlist.js:

Open allowlist.js and find the GOV_ALLOWED_TABLES array (around lines 7-38). Add:
- 'sales_comps'
- 'research_queue_outcomes'  
- 'pending_updates'

These are legitimate operational tables needed by the frontend. The allowlist is a 
security measure to prevent arbitrary table access through the proxy, but these tables 
were missed when the features were deployed.

Also check if there are any other tables the new features reference that might be missing:
- In gov.js, search for govQuery(' to find all table names being queried
- Cross-reference each with the allowlist
- Add any missing ones

FILE: api/_shared/allowlist.js
```

---

## Prompt R3-4: Fix Dialysis Properties Tab — Server-Side Pagination

**Target:** LCC Vercel Repo (`dialysis.js`)

```
TASK: The Dialysis Properties tab loads ALL 11,000+ properties into memory via 12 sequential 
API calls (1,000 per page) before rendering. This takes 15-20 seconds and creates a bad 
user experience with "Loading properties..." stuck on screen.

CURRENT BEHAVIOR:
The renderDiaProperties() function does:
1. Fetches ALL properties with pagination loop: diaQuery('properties', '*', { order: 'address.asc', limit: 1000, offset: page*1000 })
2. Concatenates all results into one array
3. THEN applies client-side pagination to show 25 at a time

This is backwards — we're loading 11,000 records to display 25.

FIX — Server-side pagination:
1. Change the initial load to only fetch one page: diaQuery('properties', '*', { order: 'address.asc', limit: 25, offset: 0 })
2. When the user clicks to the next page, fetch the next 25: diaQuery('properties', '*', { order: 'address.asc', limit: 25, offset: currentPage * 25 })
3. For the total count, use a separate count query or the Supabase Prefer: count=exact header
4. For search/filtering, send the filter to the server: diaQuery('properties', '*', { filter: 'or(address.ilike.*searchTerm*,property_name.ilike.*searchTerm*)', limit: 25, offset: 0 })
5. For state filtering, add: filter: 'state=eq.TX' to the query

ALSO FIX:
- "Avg Building SF" shows "—" with "0 with SF data" — the query selects '*' but the 
  summary calculation probably references wrong field names (building_sf vs sf vs square_feet)
- "Clinics Linked" shows 0 — the property records may not have a clinic_count field; 
  this metric should count properties where there's a matching clinic in the clinics table 
  via property_id, or remove it if the join isn't available

FILE: dialysis.js — renderDiaProperties() function
```

---

## Prompt R3-5: Fix Pipeline Duplicate Emails and Briggsland Capital

**Target:** LCC Vercel Repo (`ops.js`) + OPS Supabase (data)

```
TASK: Two issues on the Pipeline (My Work) page:

1. DUPLICATE EMAILS: The same email ("Re: LOI: Omaha, NE (Arka Capital Holdings LLC)") 
   appears multiple times in the My Work queue. The dedup logic added to loadEmails() in 
   app.js only applies to the legacy flagged emails endpoint — the canonical My Work data 
   comes from /api/queue-v2?view=my_work which returns inbox_items without deduplication.

   FIX: Add client-side dedup in the Pipeline renderer (ops.js renderMyWork function).
   Before rendering items, deduplicate by title + source_type composite key:
   
   const seen = new Set();
   items = items.filter(item => {
     const key = (item.title || '') + '|' + (item.source_type || '') + '|' + (item.received_at || '').substring(0, 10);
     if (seen.has(key)) return false;
     seen.add(key);
     return true;
   });

   ALSO: The root cause is in the email sync pipeline (see data pipeline prompts) — 
   inbox_items should have a unique constraint on internet_message_id.

2. BRIGGSLAND CAPITAL: The workspace name still shows "Briggsland Capital" on the Pipeline 
   page header ("Scott Briggs · owner · Briggsland Capital"). This comes from the workspace 
   record in the OPS Supabase.

   FIX (OPS Supabase SQL):
   UPDATE workspaces SET name = 'Briggs CRE' WHERE name ILIKE '%briggsland%';
   
   Or whatever the correct company name should be. Check with:
   SELECT id, name, slug FROM workspaces WHERE name ILIKE '%briggsland%';

FILES: ops.js (dedup), OPS Supabase (workspace name)
```

---

## Prompt R3-6: Fix Activity Breakdown Showing All Zeros

**Target:** LCC Vercel Repo (`app.js`)

```
TASK: The Activity Breakdown on the home page shows My Actions: 0, Team Open: 0, Done This 
Week: 0, Overdue: 0 — even though the canonical work_counts API returns data and there are 
28 inbox items and 633 activities loaded.

ROOT CAUSE:
The /api/queue-v2?view=work_counts returns all zeros:
{
  "my_actions": 0, "open_actions": 0, "completed_week": 0, "overdue": 0, 
  "inbox_new": 0, "due_this_week": 0, ...
}

But the inbox API returns 28 items with status "new". The mv_work_counts materialized view 
is either stale or incorrectly defined.

FRONTEND FIX (app.js renderCategoryMetrics):
The function currently checks: if (canonicalCounts && (canonicalCounts.my_actions > 0 || ...))
When all canonical counts are 0, it falls through to the CRM fallback, which also shows 0.

Change the logic so that:
1. If canonical counts are loaded but all zero, AND we have inbox items loaded, compute 
   counts directly from the loaded data:
   - my_actions = canonicalMyWork?.pagination?.total || 0
   - inbox_new = canonicalInbox?.pagination?.total || 0
2. This way even if the materialized view is stale, the breakdown shows real numbers from 
   the actual queue queries that succeeded

ALSO: The mv_work_counts view needs to be fixed in OPS Supabase (see data pipeline prompts).

FILE: app.js — renderCategoryMetrics() (~line 5048)
```

---

## Summary: Priority Order

| # | Issue | Impact | Target |
|---|-------|--------|--------|
| R3-3 | Gov allowlist 403s | Gov Sales/Research broken | allowlist.js (1-min fix) |
| R3-2 | Email sync 500 | No emails anywhere | sync.js + app.js fallback |
| R3-1 | Daily Briefing 500 | Briefing shows error | daily-briefing.js |
| R3-6 | Activity Breakdown zeros | Home page looks empty | app.js |
| R3-5 | Pipeline dupes + Briggsland | Pipeline looks messy | ops.js + Supabase |
| R3-4 | Properties tab slow load | 15-20 sec load time | dialysis.js |
