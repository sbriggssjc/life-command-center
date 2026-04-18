# LCC Round 5 — Data Pipeline Quality Prompts (April 9, 2026)

These prompts target the underlying data pipeline issues that cause empty/zero values in the frontend. Each prompt targets a specific system and includes investigation steps, root cause analysis, and fix approach.

---

## R5-1: "Clinic null" Display in Dialysis Top Movers

**Target:** `dialysis.js` (frontend only)
**Priority:** MEDIUM — visible to Scott on every Dialysis overview load
**Context:** The Top 5 Movers Up/Down lists show "Clinic null" for clinics where the `facility_name` column in the DIA Supabase `v_npi_signals` view contains the literal string `"Clinic null"` (not JS null — the actual text). This happens because the NPI ingestion pipeline concatenates "Clinic " + a null-coerced facility name.

```
TASK: Fix "Clinic null" display in Dialysis overview Top Movers lists.

ROOT CAUSE: The DIA Supabase NPI signals view returns facility_name values like
"Clinic null" — the string, not JS null. The current check in dialysis.js only
tests for strict equality with 'null', missing this pattern.

FILE: dialysis.js

FIND (3 locations — line ~668 infoCard, line ~686 moversUp loop, line ~700 moversDown loop):
All three use a pattern like:
  r.facility_name && r.facility_name !== 'null' ? r.facility_name : r.clinic_name || r.address || 'Unknown Clinic'

REPLACE all three with:
  r.facility_name && !/\bnull\b/i.test(r.facility_name) ? r.facility_name : (r.clinic_name && !/\bnull\b/i.test(r.clinic_name) ? r.clinic_name : r.address || 'Unknown Clinic')

This regex-based check catches "null", "Clinic null", "NULL", and any variant
containing the word "null" as a word boundary. The fallback chain tries
clinic_name (with the same null check), then address, then "Unknown Clinic".

ALSO — fix the root cause in the DIA Supabase NPI ingestion:
1. Check the view definition:
   SELECT definition FROM pg_views WHERE viewname = 'v_npi_signals';

2. Look for the facility_name derivation. It likely does something like:
   'Clinic ' || facility_name
   or
   COALESCE(facility_name, 'null')

3. Fix it to:
   COALESCE(NULLIF(facility_name, ''), NULLIF(facility_name_2, ''), address, 'Unknown Clinic')

VERIFY: Reload Dialysis → Overview → Top 5 Movers should show real names or
addresses instead of "Clinic null"
```

---

## R5-2: Properties Tab "Avg Building SF" Shows Dash

**Target:** `dialysis.js` + DIA Supabase schema check
**Priority:** LOW — cosmetic stat on Properties tab header
**Context:** After server-side pagination was added, the Properties tab summary stats need separate aggregate queries. The "States" count now works (shows 97), but "Avg Building SF" shows "—" with "0 with SF data". The query filters on `building_sf` column but gets 0 results.

```
TASK: Fix the Properties tab "Avg Building SF" summary stat that shows "—".

ROOT CAUSE: The aggregate query in dialysis.js (line ~5337) queries:
  diaQueryAll('properties', 'building_sf', { filter: 'building_sf=gt.0' })

This returns 0 rows, meaning either:
a) The column name is wrong (not "building_sf" in the actual table), or
b) The column exists but has no data populated

INVESTIGATION (DIA Supabase):
1. Check what SF-related columns exist:
   SELECT column_name, data_type
   FROM information_schema.columns
   WHERE table_name = 'properties'
     AND (column_name ILIKE '%sf%' OR column_name ILIKE '%square%'
          OR column_name ILIKE '%size%' OR column_name ILIKE '%area%'
          OR column_name ILIKE '%building%');

2. Check which columns have data:
   SELECT 'building_sf' as col, COUNT(*) FILTER (WHERE building_sf > 0) as populated FROM properties
   UNION ALL
   SELECT 'square_feet', COUNT(*) FILTER (WHERE square_feet > 0) FROM properties
   -- add whatever columns the schema check reveals

3. If the column exists but is named differently (e.g., square_feet, building_size,
   rentable_sf), update dialysis.js line ~5337 to use the correct column name.

FILE: dialysis.js — search for "diaPropSFValue" to find the aggregate query section

FIX (once correct column is identified — example if it's "square_feet"):
  // Line ~5337: Change the query column
  diaQueryAll('properties', 'square_feet', { filter: 'square_feet=gt.0' })
  // Line ~5361: Change the field reference
  sfRows[j].square_feet  // instead of sfRows[j].building_sf

ALSO update detail.js line ~283 and ~575 which reference building_sf with fallbacks
to ensure consistency.

VERIFY: Reload Dialysis → Properties tab → "Avg Building SF" should show a number
```

---

## R5-3: Daily Briefing Market Intelligence Empty

**Target:** Daily briefing generation pipeline (external to LCC codebase)
**Priority:** MEDIUM — "No market summary available yet" / "No market highlights" shown daily
**Context:** The `/api/daily-briefing.js` fetches market intelligence from two external URLs configured via env vars `MORNING_BRIEFING_STRUCTURED_URL` and `MORNING_BRIEFING_HTML_URL`. When both fail, the briefing shows "No market summary" and status becomes "degraded".

```
TASK: Diagnose and fix why the Daily Briefing Market Intelligence section is empty.

ARCHITECTURE:
- api/daily-briefing.js lines 13-14 read:
    MORNING_STRUCTURED_URL = process.env.MORNING_BRIEFING_STRUCTURED_URL || ''
    MORNING_HTML_URL = process.env.MORNING_BRIEFING_HTML_URL || ''
- fetchMorningStructured() (line 77): Fetches JSON from MORNING_STRUCTURED_URL
  - Returns { ok: false, missing: true, reason: 'structured_url_not_configured' }
    when the env var is empty
- fetchMorningHtml() (line 91): Fetches HTML from MORNING_HTML_URL
  - Same pattern — returns failure if URL is empty

The briefing API currently returns:
  status.missing_sections: ["global_market_intelligence.structured_payload",
                            "global_market_intelligence.html_fragment"]

This means BOTH URLs are either not configured or returning errors.

INVESTIGATION:
1. Check Vercel env vars:
   - Is MORNING_BRIEFING_STRUCTURED_URL set? To what URL?
   - Is MORNING_BRIEFING_HTML_URL set? To what URL?

2. If URLs are set, test them directly:
   curl -H "Accept: application/json" "$MORNING_BRIEFING_STRUCTURED_URL"
   curl -H "Accept: text/html" "$MORNING_BRIEFING_HTML_URL"

3. If URLs are NOT set, this means the Morning Briefing Agent (a separate
   orchestration service) hasn't been deployed or configured yet. Options:
   a) Deploy a morning briefing generator (could be a scheduled Edge Function
      that pulls from market data APIs and generates a daily summary)
   b) Add a static/fallback market summary generator inside daily-briefing.js
      that uses the existing DIA/GOV Supabase data to build a basic summary

FIX OPTION A — Static fallback in daily-briefing.js:
If both morning URLs fail, build a basic market summary from available data:
  - Pull 10Y Treasury from a free API (or use the existing Treasury data
    already shown on the home page)
  - Summarize DIA and GOV transaction volume from domain DB materialized views
  - Format as: "10Y Treasury at X.XX%. Y dialysis sales TTM totaling $ZM.
    Government sector: W transactions."

This goes in the buildSnapshot() function around line 955-984 where
global_market_intelligence is assembled. Add a fallback block after the
morningStructured and morningHtml checks fail:

  if (!morningStructured.ok && !morningHtml.ok) {
    // Build basic market summary from domain data
    const [diaSales, govSales] = await Promise.all([
      diaQuery('sales_comps', 'count', { filter: 'sale_date=gte.' + ttmDate }),
      govQuery('sales_comps', 'count', { filter: 'sale_date=gte.' + ttmDate })
    ]);
    marketIntel.summary = `${diaSales.count || 0} dialysis and ${govSales.count || 0} government transactions in the trailing 12 months.`;
    marketIntel.highlights = [
      { text: `Dialysis TTM volume: ${diaSales.count} transactions`, category: 'dialysis' },
      { text: `Government TTM volume: ${govSales.count} transactions`, category: 'government' }
    ];
  }

VERIFY: Reload home page → Daily Briefing → Market Intelligence should show
summary text instead of "No market summary available yet."
```

---

## R5-4: Team Signals All Zeros in Daily Briefing

**Target:** OPS Supabase materialized views + `api/daily-briefing.js`
**Priority:** HIGH — Team Signals section (Open, Inbox New, Sync Errors, Overdue) all show "0"
**Context:** The Team Signals section reads from `mv_work_counts` materialized view via `fetchWorkCounts()` in daily-briefing.js (line 113). The view was previously returning all zeros, causing the Open Activities stat to show "0". That stat was fixed (now shows 28), but the Team Signals in the briefing still show zeros.

```
TASK: Fix Team Signals showing all zeros (Open: 0, Inbox New: 0, Sync Errors: 0,
Overdue: 0) in the Daily Briefing.

ARCHITECTURE:
- api/daily-briefing.js fetchWorkCounts() (lines 113-151):
  1. Queries mv_work_counts WHERE workspace_id = $WORKSPACE_ID (team-level)
  2. Queries mv_user_work_counts WHERE workspace_id AND user_id (user-level)
  3. Falls back to v_work_counts if mv_ views return empty
  4. Falls back to counting action_items directly if views fail

- The team-level view mv_work_counts provides:
  open_actions, inbox_new, inbox_triaged, research_active, sync_errors,
  overdue_actions, due_this_week, completed_week, open_escalations

INVESTIGATION (OPS Supabase):
1. Check if mv_work_counts has data:
   SELECT * FROM mv_work_counts;

2. If empty, check the view definition:
   SELECT definition FROM pg_matviews WHERE matviewname = 'mv_work_counts';

3. Refresh the materialized view:
   REFRESH MATERIALIZED VIEW mv_work_counts;
   REFRESH MATERIALIZED VIEW mv_user_work_counts;

4. If the view definition references tables that are empty or have wrong
   status values, fix the definition. The view should count:
   - open_actions: WHERE status IN ('open','in_progress','waiting','assigned')
   - inbox_new: WHERE source_type = 'flagged_email' AND status = 'new'
   - sync_errors: WHERE status = 'sync_error' OR metadata->>'sync_failed' = 'true'
   - overdue_actions: WHERE due_date < NOW() AND status NOT IN ('completed','archived')

5. Check if the workspace_id filter matches:
   SELECT DISTINCT workspace_id FROM inbox_items LIMIT 5;
   SELECT DISTINCT workspace_id FROM action_items LIMIT 5;
   -- Compare with the workspace_id the API is passing

6. If the view references inbox_items but the emails are stored with a
   different workspace_id than what the briefing API passes, that's the
   root cause. Fix by ensuring consistent workspace_id assignment.

FIX: After investigation, either:
a) Fix the materialized view definition to match actual data
b) Add a CRON or trigger to auto-refresh materialized views
c) Add a direct-count fallback in daily-briefing.js buildTeamSignals()

The fallback approach (option c) in daily-briefing.js around line 1049:
  // If work_counts are all zeros, compute directly
  if (!work_counts.open_actions && !work_counts.inbox_new && !work_counts.overdue) {
    const [openCount, inboxCount, overdueCount] = await Promise.all([
      opsQuery('GET', `action_items?workspace_id=eq.${wsId}&status=in.(open,in_progress,waiting)&select=id`),
      opsQuery('GET', `inbox_items?workspace_id=eq.${wsId}&status=eq.new&select=id`),
      opsQuery('GET', `action_items?workspace_id=eq.${wsId}&status=in.(open,in_progress)&due_date=lt.${today}&select=id`)
    ]);
    work_counts.open_actions = openCount.data?.length || 0;
    work_counts.inbox_new = inboxCount.data?.length || 0;
    work_counts.overdue = overdueCount.data?.length || 0;
  }

VERIFY: Reload home page → Daily Briefing → Team Signals should show non-zero
values for Open and Inbox New at minimum
```

---

## R5-5: Email Sync Returns 0 Emails (Edge Function Pipeline)

**Target:** Edge Function `ai-copilot` + OPS Supabase `inbox_items` table
**Priority:** HIGH — Email sync is the primary intake channel
**Context:** The `/api/sync?action=flagged_emails` GET handler returns 200 but with 0 emails. This is a READ from `inbox_items` WHERE `source_type='flagged_email'` AND `status IN ('new','triaged')`. The 28 inbox items visible in the UI come from `canonicalMyWork`/`canonicalInbox` (a different query path). The email INGEST function (`ingestEmails`, sync.js line 330) calls the Edge Function at `EDGE_FUNCTION_URL/sync/flagged-emails` which requires a valid Outlook connector.

```
TASK: Diagnose and fix why the email sync pipeline returns 0 flagged emails.

ARCHITECTURE:
- READ path (sync.js lines 259-324): Queries inbox_items WHERE
  source_type='flagged_email' AND status IN ('new','triaged') AND
  flag_removed_at IS NULL. Returns 0 means no rows match this filter.

- INGEST path (sync.js lines 330-506): Called via POST to
  /api/sync?action=ingest_emails. This:
  1. Resolves the Outlook connector for the user (resolveConnector)
  2. Calls Edge Function at EDGE_FN_URL/sync/flagged-emails with
     connector headers (line 351-353, timeout 7s)
  3. Upserts results into inbox_items table

- The Edge Function URL (sync.js line 37):
  EDGE_FN_URL = process.env.EDGE_FUNCTION_URL ||
  'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot'

INVESTIGATION:
1. Check if inbox_items has ANY flagged_email rows:
   SELECT source_type, status, COUNT(*)
   FROM inbox_items
   GROUP BY source_type, status
   ORDER BY source_type, status;

2. If there are rows but status isn't 'new' or 'triaged':
   SELECT status, COUNT(*) FROM inbox_items
   WHERE source_type = 'flagged_email'
   GROUP BY status;
   -- Emails might have been auto-archived or marked 'completed'

3. If there are NO flagged_email rows, the ingest hasn't run. Check:
   a) Is there a connector configured?
      SELECT * FROM connectors WHERE provider = 'outlook' LIMIT 5;
   b) Is the Edge Function accessible?
      curl -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
        "$EDGE_FUNCTION_URL/sync/flagged-emails?limit=5"
   c) Is there a sync schedule (Power Automate flow or CRON)?
      Check sync_jobs table for recent email sync jobs:
      SELECT * FROM sync_jobs WHERE job_type = 'flagged_email'
      ORDER BY created_at DESC LIMIT 10;

4. If the Edge Function returns emails but they're not being stored,
   check the upsert logic (sync.js lines 369-451) for field mapping errors.

5. The 28 items visible in canonicalInbox come from a DIFFERENT query:
   v_my_work or inbox_items with broader status filters. Check:
   SELECT * FROM inbox_items WHERE workspace_id = '$WS_ID'
   ORDER BY received_at DESC LIMIT 30;
   -- See what source_type and status these 28 items have

FIX depends on diagnosis:
a) If emails exist but with wrong status → update the READ query to include
   the actual statuses: status=in.(new,triaged,assigned,open)
b) If no connector → user needs to re-authorize Outlook OAuth
c) If Edge Function down → check Supabase Edge Function logs
d) If ingest never runs → add a trigger or scheduled task

The most likely cause is (a): The home page shows 28 items from canonicalInbox
which uses a broader query (v_my_work), while the flagged_emails handler
specifically filters source_type='flagged_email'. If the items were ingested
with source_type='email' or 'inbox' instead of 'flagged_email', they won't
show up. Check:
   SELECT DISTINCT source_type FROM inbox_items;

VERIFY: After fix, GET /api/sync?action=flagged_emails should return > 0 emails
```

---

## R5-6: Dialysis Overview Missing Touchpoint Numbers

**Target:** `dialysis.js` + DIA Supabase touchpoint data
**Priority:** LOW — Sarah Martin, Nathanael Berwaldt show "0 YTD touchpoints"
**Context:** The Team Touchpoints section shows Kelly Largent: 920, Scott Briggs: 1, but Sarah Martin and Nathanael Berwaldt show 0. This comes from a Salesforce activity sync via the DIA Supabase.

```
TASK: Investigate why some team members show 0 touchpoints in the Dialysis overview.

INVESTIGATION (DIA Supabase):
1. Check the touchpoint data source:
   SELECT assigned_to, COUNT(*) as touchpoints
   FROM touchpoints  -- or activities, or sf_activities — find the right table
   WHERE activity_date >= '2026-01-01'
   GROUP BY assigned_to
   ORDER BY touchpoints DESC;

2. If "touchpoints" table doesn't exist, check alternatives:
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public'
     AND (table_name ILIKE '%touch%' OR table_name ILIKE '%activit%'
          OR table_name ILIKE '%outreach%');

3. Check what user names/IDs are stored:
   SELECT DISTINCT assigned_to FROM [touchpoint_table] LIMIT 20;
   -- Compare with the names displayed: Sarah Martin, Nathanael Berwaldt

4. If names don't match (e.g., stored as emails, Salesforce IDs, or
   differently formatted names), that's the mapping issue.

FILE: dialysis.js — search for "Team Outreach" or "Touchpoints" to find the
rendering function that builds the team leaderboard.

FIX: Either:
a) Fix the name mapping in the query/rendering to match what's in the DB
b) If the data genuinely doesn't exist for those users, this is a Salesforce
   sync gap — those users' activities aren't being synced from SF

VERIFY: Reload Dialysis → Overview → Team Outreach section should show numbers
for all team members
```

---

## R5-7: Gov/Dialysis Highlights Empty in Daily Briefing

**Target:** `api/daily-briefing.js` `buildDomainSignals()` function
**Priority:** LOW — "No government highlights" / "No dialysis highlights"
**Context:** The `buildDomainSignals()` function (line 791) builds highlights by filtering `myWork` and `inboxSummary.items` by domain. If no items have `domain='government'` or `domain='dialysis'`, the sections are empty.

```
TASK: Fix empty Gov/Dialysis Highlights in Daily Briefing.

ARCHITECTURE:
- api/daily-briefing.js buildDomainSignals() (lines 791-819):
  1. Filters myWork items where domain === 'government' or 'dialysis'
  2. Filters inboxSummary.items by same domain
  3. Filters unassignedWork by domain
  4. Returns highlights array (up to 5 titles from each)

ROOT CAUSE: The items in v_my_work and v_inbox_triage likely don't have the
'domain' field populated, or they use different domain values than
'government'/'dialysis'.

INVESTIGATION (OPS Supabase):
1. Check what domain values exist:
   SELECT DISTINCT domain, COUNT(*) FROM inbox_items GROUP BY domain;
   SELECT DISTINCT domain, COUNT(*) FROM action_items GROUP BY domain;

2. Check the views:
   SELECT domain, COUNT(*) FROM v_my_work GROUP BY domain;
   SELECT domain, COUNT(*) FROM v_inbox_triage GROUP BY domain;

3. If domain is NULL for most items, the ingestion pipeline isn't tagging
   items with their domain. Fix by:
   a) Adding domain inference rules during email/task intake:
      - If subject/body mentions GSA, federal, government → domain = 'government'
      - If mentions dialysis, DaVita, Fresenius, clinic → domain = 'dialysis'
   b) Updating existing items:
      UPDATE inbox_items SET domain = 'government'
      WHERE (title ILIKE '%gsa%' OR title ILIKE '%federal%' OR title ILIKE '%government%')
        AND domain IS NULL;
      UPDATE inbox_items SET domain = 'dialysis'
      WHERE (title ILIKE '%dialysis%' OR title ILIKE '%davita%' OR title ILIKE '%fresenius%'
             OR title ILIKE '%clinic%')
        AND domain IS NULL;

4. Alternatively, enhance buildDomainSignals() to pull directly from
   domain databases instead of relying on OPS domain tags:
   - Query GOV Supabase for recent pending_updates or new sales
   - Query DIA Supabase for recent NPI signals or property queue items
   - Build highlights from domain-specific data

VERIFY: Reload home page → Daily Briefing → Gov and Dialysis Highlights
should show relevant items
```

---

## Summary: Priority Order

| # | Issue | Impact | Target System | Effort |
|---|-------|--------|---------------|--------|
| R5-5 | Email sync 0 results | Primary intake broken | OPS Supabase + Edge Function | Investigation |
| R5-4 | Team Signals zeros | Briefing section useless | OPS Supabase mv_work_counts | Medium |
| R5-3 | Market Intel empty | Briefing section empty | daily-briefing.js + env config | Medium |
| R5-1 | "Clinic null" display | Wrong text in overview | dialysis.js + DIA Supabase | Small |
| R5-7 | Domain highlights empty | Briefing sections empty | OPS Supabase domain tagging | Medium |
| R5-2 | Properties SF dash | Missing stat | dialysis.js + DIA schema | Small |
| R5-6 | Missing touchpoints | Incomplete leaderboard | DIA Supabase + SF sync | Investigation |
