# LCC Data Pipeline Fix Prompts

These prompts target backend systems — Supabase views, edge functions, and the LCC Vercel repo's serverless functions. Each prompt specifies which system/repo to send it to.

---

## Prompt A: Fix Email Sync — Deduplication, Flag Sync, Stale ID Cleanup

**Target:** LCC Vercel Repo (`/api/sync.js` + Supabase Edge Function `ai-copilot`)

```
TASK: Fix the email sync pipeline so that (1) flagged emails don't create duplicates, (2) resolved flags in Outlook are reflected in the LCC, and (3) email deep-link IDs stay valid.

CURRENT ISSUES:
1. One flagged email in Outlook generates 2-3 duplicate inbox items in the LCC
2. Resolving a flag in Outlook does not remove or mark the item as resolved in the LCC
3. Email deep-links sometimes say "email may have been moved or deleted" — stale Graph IDs

ARCHITECTURE:
- Email sync is triggered by: POST /api/sync?action=ingest_emails (sync.js line ~160)
- The handler calls the Supabase Edge Function at EDGE_FUNCTION_URL + /sync/flagged-emails
- The edge function queries Microsoft Graph API for flagged emails and returns them
- Results are written to OPS Supabase tables: activity_events and inbox_items
- The frontend fetches emails from the same edge function via GET /sync/flagged-emails?limit=500
- Frontend also shows canonical inbox items from GET /api/inbox (queue.js → inbox_items table)

INVESTIGATION NEEDED:
1. In the ai-copilot Edge Function, find the /sync/flagged-emails handler:
   - Does it use Graph API's $filter for flagged messages or does it pull all and filter?
   - What message ID format does it return? (Graph REST id, immutableId, or internetMessageId)
   - Does it check for existing records before inserting (upsert vs insert)?

2. In sync.js ingestEmails() handler (~line 160, 989):
   - How are emails written to inbox_items? Is there a unique constraint on internet_message_id?
   - Is there logic to mark previously-flagged emails as resolved when they're no longer flagged?

FIXES NEEDED:

### Fix 1: Prevent Duplicates (Edge Function + sync.js)
- Edge Function: Ensure the /sync/flagged-emails endpoint returns a unique internet_message_id per email
- sync.js ingestEmails(): Before inserting into inbox_items and activity_events, check for existing records:
  - Use upsert with ON CONFLICT (internet_message_id) DO UPDATE for inbox_items
  - Skip activity_events insert if an event for that internet_message_id already exists
- If inbox_items doesn't have a unique constraint on internet_message_id, add one via migration

### Fix 2: Resolve Stale Flags (sync.js)
- Add a "reconciliation" pass after ingesting new flagged emails:
  1. Query inbox_items WHERE source_type = 'outlook_email' AND status NOT IN ('dismissed','completed')
  2. Compare against the set of currently-flagged email IDs returned by the edge function
  3. Any inbox_items NOT in the current flagged set → mark as status = 'resolved' with resolved_at = now()
- This means the sync endpoint needs to track the "full set" of currently flagged emails, not just new ones

### Fix 3: Stable Deep-Link IDs (Edge Function)
- Ensure the edge function returns the Graph REST API message ID (the long base64-encoded string from /me/messages/{id})
- This ID works with: https://outlook.office.com/mail/deeplink/read/{encodedId}
- Do NOT use immutableId (doesn't work with web deep-links) or internetMessageId (requires search, not direct nav)
- Store this ID as external_id or email_id on the inbox_items record

### Fix 4: OPS Database — Add Unique Constraint
Run this migration on the OPS Supabase:
  ALTER TABLE inbox_items ADD CONSTRAINT inbox_items_internet_message_id_unique 
    UNIQUE (internet_message_id) WHERE internet_message_id IS NOT NULL;

FILES TO MODIFY:
1. /api/sync.js — ingestEmails handler, add upsert logic and reconciliation pass
2. Edge Function (ai-copilot) — /sync/flagged-emails handler, ensure unique IDs and correct ID format
3. OPS Supabase — Migration for unique constraint on inbox_items.internet_message_id

CONSTRAINTS:
- Do NOT create new .js files in /api/ (12-file hard limit)
- The edge function is deployed separately via Supabase CLI, not through Vercel
- Test by: flag one email in Outlook → run sync → verify only one inbox_item created → unflag → run sync → verify item marked resolved
```

---

## Prompt B: Fix mv_work_counts — Accurate Open Activities Count

**Target:** OPS Supabase (SQL migration)

```
TASK: Fix the mv_work_counts materialized view so that the "Open Activities" count on the LCC home page matches the actual open action count.

CURRENT ISSUE:
- Home page shows 633 Open Activities but the user says the actual count should be different
- The count comes from: GET /api/queue-v2 → v2GetWorkCounts() in queue.js
- v2GetWorkCounts queries: SELECT * FROM mv_work_counts WHERE workspace_id = $1
- Also queries: SELECT * FROM mv_user_work_counts WHERE workspace_id = $1

INVESTIGATION:
1. Check the mv_work_counts view definition:
   SELECT * FROM pg_matviews WHERE matviewname = 'mv_work_counts';
   -- or --
   SELECT definition FROM pg_matviews WHERE matviewname = 'mv_work_counts';

2. Check what columns it returns — the frontend uses:
   - canonicalCounts.my_actions (Activity Breakdown "My Actions")
   - canonicalCounts.open_actions (Activity Breakdown "Team Open")
   - canonicalCounts.completed_week (Activity Breakdown "Done This Week")
   - canonicalCounts.overdue (Activity Breakdown "Overdue")
   - canonicalCounts.inbox_new (for inbox count)

3. Check the source table it aggregates from:
   - Likely action_items table with status filters
   - The 633 count may include dismissed, completed, or stale items

LIKELY FIX:
The materialized view probably counts all action_items regardless of status. It should filter to only active/open statuses:

CREATE OR REPLACE VIEW mv_work_counts AS
SELECT
  workspace_id,
  COUNT(*) FILTER (WHERE status IN ('open','in_progress','blocked')) AS open_actions,
  COUNT(*) FILTER (WHERE status IN ('open','in_progress','blocked') AND assigned_to = current_user_id) AS my_actions,
  COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= date_trunc('week', now())) AS completed_week,
  COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND due_date < now()) AS overdue,
  COUNT(*) FILTER (WHERE source_type = 'inbox' AND status = 'new') AS inbox_new
FROM action_items
GROUP BY workspace_id;

-- Then refresh:
REFRESH MATERIALIZED VIEW mv_work_counts;

NOTE: Adjust the status values based on what's actually in the action_items table. Check with:
  SELECT DISTINCT status, COUNT(*) FROM action_items GROUP BY status ORDER BY COUNT(*) DESC;

ALSO: Check if there's a REFRESH trigger or cron job. If the view is stale, counts won't update.
  SELECT schemaname, matviewname, hasindexes, ispopulated FROM pg_matviews WHERE matviewname LIKE 'mv_%';
```

---

## Prompt C: Fix Dialysis v_counts_freshness View — DB Health Zeros

**Target:** DIA Supabase (SQL migration)

```
TASK: Fix the v_counts_freshness view in the Dialysis Supabase so that the DB Health section on the Dialysis overview page shows actual clinic counts instead of all zeros.

CURRENT ISSUE:
- The Dialysis overview shows: Total Clinics = 0, Data Coverage = 0.0%, all health metrics = 0
- Root cause: diaQuery('v_counts_freshness', '*') returns an empty array
- The frontend at dialysis.js lines 469-600 uses diaData.freshness fields:
  f.total_clinics, f.coverage_pct, f.clinics_with_counts, f.last_update, etc.

INVESTIGATION:
1. Check if the view exists:
   SELECT * FROM information_schema.views WHERE table_name = 'v_counts_freshness';
   -- or for materialized:
   SELECT * FROM pg_matviews WHERE matviewname = 'v_counts_freshness';

2. If it exists, check its definition:
   SELECT definition FROM pg_matviews WHERE matviewname = 'v_counts_freshness';
   -- or --
   SELECT view_definition FROM information_schema.views WHERE table_name = 'v_counts_freshness';

3. Try running the view:
   SELECT * FROM v_counts_freshness LIMIT 5;

4. Check what tables it depends on — likely:
   - clinics (or medicare_clinics or cms_clinics) — the main clinic table
   - clinic_patient_counts or similar — for "clinics_with_counts"
   - Some timestamp tracking table for "last_update"

LIKELY FIX:
The view may reference a table that was renamed or restructured. Recreate it to match current schema:

CREATE OR REPLACE VIEW v_counts_freshness AS
SELECT
  (SELECT COUNT(*) FROM clinics) AS total_clinics,
  (SELECT COUNT(*) FROM clinics WHERE total_patients IS NOT NULL AND total_patients > 0) AS clinics_with_counts,
  ROUND(
    (SELECT COUNT(*)::numeric FROM clinics WHERE total_patients IS NOT NULL AND total_patients > 0) /
    NULLIF((SELECT COUNT(*)::numeric FROM clinics), 0) * 100, 1
  ) AS coverage_pct,
  (SELECT MAX(updated_at) FROM clinics) AS last_update,
  (SELECT COUNT(*) FROM clinics WHERE status = 'active') AS active_clinics,
  (SELECT COUNT(DISTINCT state) FROM clinics) AS states_covered
;

ALSO CHECK: 
- Does the DIA Supabase allowlist include v_counts_freshness? Check /api/_shared/allowlist.js line 62-117. 
  It IS in the allowlist at line 74: 'v_counts_freshness'
- Is there an RLS policy blocking the service key? Run: 
  SELECT * FROM pg_policies WHERE tablename = 'v_counts_freshness';

ADJUST table/column names based on actual schema:
  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%clinic%';
  SELECT column_name FROM information_schema.columns WHERE table_name = 'clinics';
```

---

## Prompt D: Fix v_clinic_inventory_latest_diff — Remove 500 Limit

**Target:** LCC Vercel Repo (`dialysis.js` frontend)

```
TASK: The Dialysis overview clinical metrics only show 500 clinics because the frontend query has a LIMIT 500. Remove or increase this limit.

CURRENT CODE (dialysis.js line ~178):
  diaQuery('v_clinic_inventory_latest_diff', '*', { limit: 500 })

FIX:
Change to:
  diaQuery('v_clinic_inventory_latest_diff', '*', { limit: 10000 })

This is a one-line change. The view returns inventory change records that feed the Clinical Metrics section of the overview. The 500 limit was arbitrarily low and cut off the full dataset.

FILE: dialysis.js, line ~178
```

---

## Prompt E: Clean Up Briggsland Capital Entity

**Target:** OPS Supabase (data fix)

```
TASK: The entity "Briggsland Capital" appears to be test/placeholder data in the OPS Supabase entities table. Clean it up.

INVESTIGATION:
1. Find the entity:
   SELECT * FROM entities WHERE name ILIKE '%briggsland%';

2. Check what it's linked to:
   SELECT * FROM action_items WHERE entity_id = (SELECT id FROM entities WHERE name ILIKE '%briggsland%' LIMIT 1);
   SELECT * FROM contacts WHERE entity_id = (SELECT id FROM entities WHERE name ILIKE '%briggsland%' LIMIT 1);
   SELECT * FROM activity_events WHERE entity_id = (SELECT id FROM entities WHERE name ILIKE '%briggsland%' LIMIT 1);

3. If it's test data with no real business records linked:
   -- Soft delete or rename
   UPDATE entities SET status = 'archived', name = '[TEST] Briggsland Capital' WHERE name ILIKE '%briggsland%';

4. If it should be renamed to the correct entity name (e.g., "Briggs Capital" or "Briggsland Capital LLC"):
   UPDATE entities SET name = 'Correct Name Here' WHERE name ILIKE '%briggsland%';

5. If there are linked action_items or inbox_items showing this name, they'll need their cached title/entity_name updated too, or they'll pick up the corrected name on next render if they join to the entities table.

NOTE: Check with Scott what the correct entity name should be, or if this is purely test data to remove.
```

---

## Prompt F: Fix Activity Breakdown Wrong Numbers

**Target:** LCC Vercel Repo (`app.js` + `api/queue.js`) and OPS Supabase

```
TASK: The Activity Breakdown section on the LCC home page shows wrong numbers for My Actions, Team Open, Done This Week, and Overdue.

ROOT CAUSE:
The renderCategoryMetrics() function in app.js (line ~5048) has THREE fallback data sources:
1. canonicalCounts (from OPS mv_work_counts via /api/queue-v2)
2. mktData (from DIA v_marketing_crm_tasks via /api/dia-query)
3. activities (from DIA v_sf_activity_feed legacy Salesforce data)

Each source returns different numbers because they count different things. The function cascades through them, using whichever loads first.

INVESTIGATION:
1. Check which data source is actually being used. In app.js renderCategoryMetrics():
   - Line 5050: if (canonicalCounts && (canonicalCounts.my_actions > 0 || ...)) → uses canonical
   - Line 5070: else if (mktLoaded && mktData.length > 0) → uses CRM rollup
   - Line 5086: else → uses legacy Salesforce activities

2. The canonical path should be authoritative. Check what mv_work_counts returns:
   - GET /api/queue-v2 (handled by queue.js v2GetWorkCounts)
   - This queries mv_work_counts and mv_user_work_counts from OPS Supabase

FIX APPROACH:

### Step 1: Ensure canonical counts are always preferred
In app.js renderCategoryMetrics(), change the condition at line ~5050 from:
  if (canonicalCounts && (canonicalCounts.my_actions > 0 || canonicalCounts.open_actions > 0))
To:
  if (canonicalCounts)
  
This ensures the canonical path is used even when counts are zero (zero is valid — means no open work).

### Step 2: Fix the materialized view (OPS Supabase)
See Prompt B above for fixing mv_work_counts to return accurate counts.

### Step 3: Remove confusing fallback data
Consider removing the CRM and legacy Salesforce fallbacks entirely, or at minimum labeling them as "Estimated" when shown:
  - The CRM fallback at line 5070 shows marketing deal data as "My Actions" which is misleading
  - The Salesforce fallback at line 5086 categorizes by text matching (isDiaCategory, isGovCategory) which is unreliable

FILES TO MODIFY:
1. app.js — renderCategoryMetrics() function (~line 5048-5104)
2. OPS Supabase — mv_work_counts view definition (see Prompt B)
3. api/queue.js — verify v2GetWorkCounts returns the right columns
```

---

## Prompt G: Increase Flagged Email Limit

**Target:** Supabase Edge Function (`ai-copilot`) + LCC Vercel Repo (`app.js`)

```
TASK: The flagged email count is always capped at 1,050 regardless of how many flagged emails exist in Outlook.

CURRENT STATE:
- Frontend fetches: GET ${API}/sync/flagged-emails?limit=500 (app.js line 4499)
- This hits the Supabase Edge Function ai-copilot at /sync/flagged-emails
- The edge function queries Microsoft Graph API for flagged messages

ISSUE:
- The Graph API likely has pagination that the edge function doesn't follow
- The frontend also has its own limit=500 parameter

FIXES NEEDED:

### Edge Function (ai-copilot):
1. Implement cursor-based pagination for the Graph API /me/messages?$filter=flag/flagStatus eq 'flagged' endpoint
2. Use @odata.nextLink to page through all results
3. Or increase the $top parameter to a higher value (Graph API supports up to 999 per page)
4. Return the full count in the response: { emails: [...], total: actualTotal }

### Frontend (app.js):
1. Change the limit parameter or remove it:
   From: fetch(`${API}/sync/flagged-emails?limit=500`)
   To:   fetch(`${API}/sync/flagged-emails?limit=2000`)
   
2. Better yet, implement client-side pagination — load the first 100 for display, show total count from API response

### Alternative: Don't load all emails at once
Instead of loading all flagged emails on page load, only load the count for the home stat card and lazy-load the actual email list when the user navigates to the inbox:
  - GET /sync/flagged-emails?count_only=true → returns { total: N }
  - GET /sync/flagged-emails?limit=50&offset=0 → returns paginated results

FILES TO MODIFY:
1. Edge Function (ai-copilot) — /sync/flagged-emails handler
2. app.js — loadEmails() function at line ~4497
```

---

## Summary: Where to Send Each Prompt

| Prompt | Target System | What to Open |
|--------|--------------|--------------|
| **A** (Email Sync) | LCC Vercel Repo + Edge Function + OPS Supabase | Claude Code on LCC repo, then Supabase dashboard for migration, then edge function repo |
| **B** (mv_work_counts) | OPS Supabase | Supabase SQL Editor or migration |
| **C** (v_counts_freshness) | DIA Supabase | Supabase SQL Editor or migration |
| **D** (500 limit) | LCC Vercel Repo | Claude Code on LCC repo (one-line fix in dialysis.js) |
| **E** (Briggsland Capital) | OPS Supabase | Supabase SQL Editor (data cleanup) |
| **F** (Activity Breakdown) | LCC Vercel Repo + OPS Supabase | Claude Code on LCC repo + Supabase SQL Editor |
| **G** (Email Limit) | Edge Function + LCC Vercel Repo | Edge function repo + Claude Code on LCC repo |
