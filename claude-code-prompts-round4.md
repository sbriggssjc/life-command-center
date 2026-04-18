# LCC Round 4 — Verification Results & Remaining Fixes (April 8, 2026)

Full live app verification completed after Round 3 deploys. Two direct code fixes applied in this session, plus remaining issues that need backend or targeted prompts.

---

## Direct Fixes Applied This Session

### Fix 1: Home Page My Work Dedup (app.js)
The My Work widget on the home page showed "Re: LOI: Omaha, NE (Arka Capital Holdings LLC)" 4 times. The Pipeline page (ops.js) had dedup but `renderPriorityTasks()` in app.js did not. Added Set-based dedup by title + source_type + date before rendering.

### Fix 2: "Clinic null" in Dialysis Top Movers (dialysis.js)
The Top 5 Movers Up/Down lists showed "Clinic null" for 2 entries where facility_name was the literal string "null". Added fallback chain: facility_name → clinic_name → address → "Unknown Clinic", with an explicit check for the string "null".

---

## Verification Results: What's Fixed

| Issue | Status | Evidence |
|-------|--------|----------|
| Gov allowlist 403s (R3-3) | FIXED | Gov Sales: 2,224 comps loaded. Gov Research: Step 1 of 6 loaded with pending_updates categories. No 403 errors. |
| Email sync fallback (R3-2) | FIXED | Flagged Emails stat shows "28" (falls back to canonical inbox count). |
| Daily Briefing display (R3-1) | PARTIALLY FIXED | Shows "As of Apr 8, 4:39 PM · Partial" with content sections. No more "unavailable" error. Dot separator and friendly "Some sections still loading" message working. |
| Activity Breakdown zeros (R3-6) | PARTIALLY FIXED | "My Actions: 28" shows correctly from canonical fallback. Team Open, Done This Week, Overdue still show 0 (requires mv_work_counts fix). |
| Pipeline dedup (R3-5) | FIXED | Pipeline page shows each email title only once. |
| Properties tab pagination (R3-4) | FIXED | Server-side pagination working: Page 1 of 445 (11,103 total), 25 rows per page. No more 15-20 sec load. |
| Detail overlay close (prior session) | FIXED | Panel closes cleanly, overlay removed, page fully interactable after close. |
| Outlook deeplinks (prior session) | FIXED | "Open in Outlook ↗" links use deeplink/read URLs. |
| Available comps blank filter (prior session) | FIXED | Only comps with address/name/facility show. |
| Daily Briefing action links (prior session) | FIXED | Links target pagePipeline directly. |

---

## Remaining Issues — Need Prompts / Backend Fixes

### R4-1: Briggsland Capital Workspace Name (OPS Supabase)

**Priority: LOW** — Cosmetic but visible on Pipeline page header.

```
TASK: The Pipeline page header still shows "Scott Briggs · owner · Briggsland Capital". 
The workspace name needs to be updated in OPS Supabase.

FIX (OPS Supabase SQL):
SELECT id, name, slug FROM workspaces WHERE name ILIKE '%briggsland%';
UPDATE workspaces SET name = 'Briggs CRE' WHERE name ILIKE '%briggsland%';

VERIFY: Reload Pipeline page → header should show "Briggs CRE"
```

---

### R4-2: Home Page "Open Activities" Still Shows 0 (OPS Supabase)

**Priority: HIGH** — First stat card on the home page shows "0".

```
TASK: The Open Activities stat card always shows "0". This comes from 
mv_work_counts.my_actions which is a materialized view that's returning all zeros.

The Activity Breakdown section works because it falls back to canonical inbox count (28),
but the top stat card uses a different code path that reads the raw canonical count.

INVESTIGATION:
1. Check the mv_work_counts definition in OPS Supabase:
   SELECT * FROM pg_matviews WHERE matviewname = 'mv_work_counts';
   
2. Refresh it:
   REFRESH MATERIALIZED VIEW mv_work_counts;
   
3. Check the underlying query — it may be filtering on workspace_id or user_id 
   that doesn't match the current user's context
   
4. If the view is based on inbox_items, check:
   SELECT status, count(*) FROM inbox_items GROUP BY status;
   
   The view should count items WHERE status IN ('new','open','assigned')

FIX: Either fix the materialized view definition or add a frontend fallback 
in renderHomeStats() similar to what renderCategoryMetrics() does.
```

---

### R4-3: Properties Tab Summary Stats Show Zeros (dialysis.js)

**Priority: MEDIUM** — Properties tab header shows "States: 0", "Avg Building SF: —".

```
TASK: The Properties tab loads 11,103 records via server-side pagination correctly, 
but the summary stats are broken:
- "States" shows "0" (diaPropStatesValue)
- "Avg Building SF" shows "—" with "0 with SF data" (diaPropSFValue / diaPropSFSub)

ROOT CAUSE: When we switched to server-side pagination (only fetching 25 records at a time), 
the summary stats can no longer be computed client-side from all records. They need 
separate aggregate queries.

FIX in dialysis.js renderDiaProperties():
1. Add a count query for distinct states:
   diaQuery('properties', 'state', { select: 'state', distinct: true })
   or use: SELECT COUNT(DISTINCT state) FROM properties WHERE state IS NOT NULL

2. Add an aggregate query for building SF:
   diaQuery('properties', 'building_sf', { not_is: 'null', select: 'building_sf' })
   Then compute avg client-side, or better: use a Supabase RPC/view for aggregates

3. Check the actual column name — it might be 'building_sf', 'square_feet', 'sf', 
   or 'building_square_feet'. Run:
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'properties' AND column_name ILIKE '%sf%' OR column_name ILIKE '%square%';

FILE: dialysis.js — renderDiaProperties() summary section
```

---

### R4-4: Dialysis Overview Missing Data Points

**Priority: LOW** — Several overview cards show missing values.

```
TASK: On the Dialysis Overview page, several data points are missing:

1. "Last 30 Days" touchpoints shows no number — the card renders but the value is blank
2. Sarah Martin, Scott Briggs, Nathanael Berwaldt show "YTD touchpoints" but no number
   (Only Kelly Largent shows 124)
3. "10k_filing" label shows as raw text with no count next to it in the Financial Estimates 
   source breakdown
4. Lease Backfill and Completed Reviews in Research Pipeline show no numbers

INVESTIGATION:
- Team touchpoint data comes from the Salesforce activity feed via DIA Supabase
- Check if the touchpoint query filters by user correctly:
  The query likely only returns data for Kelly Largent because the other team members 
  have different user IDs or the query has a WHERE clause that's too restrictive
- The "10k_filing" source label needs proper display name mapping

FILE: dialysis.js — renderDiaOverview() touchpoints section, financial estimates sources
```

---

### R4-5: Persistent API 500 Errors (Backend)

**Priority: HIGH** — Three endpoints consistently returning 500.

```
TASK: These endpoints are still failing:

1. /api/sync?action=flagged_emails → 500 (edge function issue)
   - Frontend fallback to canonical inbox count is working
   - Root cause: Edge function at EDGE_FUNCTION_URL + /sync/flagged-emails may have 
     expired OAuth token or timeout issues
   
2. /api/daily-briefing?action=snapshot → 500 (FUNCTION_INVOCATION_FAILED)
   - Frontend shows "Partial" with cached sections that loaded before crash
   - Root cause: Function exceeding Vercel Hobby plan limits or unhandled exception
   - Need to check Vercel deployment logs for actual stack trace
   
3. Calendar API → 500
   - Today's Schedule section works from cached data but fresh sync fails
   - Likely same OAuth/edge function issue as email sync

INVESTIGATION STEPS:
1. Go to Vercel Dashboard → Functions tab → check runtime logs for each endpoint
2. For edge functions: Check ai-copilot Supabase edge function logs
3. For OAuth: Check if the Outlook connector token needs refresh
4. Consider adding try/catch wrappers per R3-1 and R3-2 prompt guidance
```

---

### R4-6: Home Page My Work Shows Only 5 Items (app.js)

**Priority: LOW** — Widget shows 5 items + "View all 28 items" link.

```
TASK: The My Work widget on the home page only shows the first 5 canonical items.
After dedup (Fix 1 above), it will show fewer unique items. The widget currently 
hard-limits to whatever items are in canonicalMyWork.items (which appears to be ~5-10 
from the API), then shows "View all 28 items".

The 28 count comes from canonicalMyWork.pagination.total. The API likely only returns 
a small page of items for the widget preview.

This is working as designed — the widget shows a preview and links to the full Pipeline. 
However, the items shown should be the MOST ACTIONABLE (overdue first, then recent), 
not just whatever order the API returns.

OPTIONAL FIX in app.js renderPriorityTasks():
Sort dedupedItems before rendering:
- Overdue items first (due_date < today)
- Then by received_at descending (newest first)
- This ensures the 5-item preview shows what matters most
```

---

## Summary: Priority Order for Round 4

| # | Issue | Impact | Target | Effort |
|---|-------|--------|--------|--------|
| R4-5 | API 500 errors | Core sync broken | Vercel/Edge Functions | Investigation |
| R4-2 | Open Activities = 0 | Home page stat wrong | OPS Supabase + app.js | Medium |
| R4-3 | Properties stats zeros | Tab header empty | dialysis.js | Medium |
| R4-4 | Missing overview values | Incomplete dashboard | dialysis.js + data | Low |
| R4-1 | Briggsland Capital | Wrong company name | OPS Supabase | 1-min SQL |
| R4-6 | My Work item priority | UX improvement | app.js | Low |
