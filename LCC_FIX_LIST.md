# LCC Fix List — App Audit (March 24, 2026)

Findings from a live walkthrough of the production app at life-command-center-nine.vercel.app.
Each issue includes exact file paths, line numbers, root cause, and recommended fix.

---

## Bug 1: `POST /api/queue-v2?view=_perf` returns 405 on every page load

**Severity:** Low (no user-visible impact, but wastes a request and clutters server logs)

**Root cause:** `ops.js` line 25 sends performance telemetry via `navigator.sendBeacon()`, which always uses HTTP POST:
```js
// ops.js:25
navigator.sendBeacon?.('/api/queue-v2?view=_perf', JSON.stringify({
  label, dur, ts: Date.now()
}));
```
But `api/queue.js` lines 45-47 reject all non-GET requests before routing:
```js
// api/queue.js:45-47
if (req.method !== 'GET') {
  return res.status(405).json({ error: 'Only GET is supported on the queue endpoint' });
}
```

**Fix:** Add a POST handler for the `_perf` view in `api/queue.js`. Before the GET-only guard (line 45), add:
```js
// Allow POST for _perf beacon (performance telemetry)
if (req.method === 'POST' && req.query?.view === '_perf') {
  return res.status(204).end(); // Accept and discard (or log to a telemetry table)
}
```
Alternatively, if you want to actually store perf data, insert it into a `perf_telemetry` table.

---

## Bug 2: Marketing data loads twice (double pagination)

**Severity:** Medium (doubles network traffic and load time for the Marketing tab — 13 sequential API calls x2 = 26 calls, ~12K rows transferred when 6K would do)

**Root cause:** When the user clicks the Marketing business tab, `loadMarketing()` is called from two separate codepaths:

1. **`app.js` line 544** — the tab click handler (`setBizTab`):
   ```js
   if (currentBizTab === 'marketing') {
     loadMarketing();  // CALL #1
   }
   ```

2. **`app.js` line 730** — `renderBizContent()`, which is called right after the tab click handler:
   ```js
   function renderBizContent() {
     if (currentBizTab === 'marketing') {
       loadMarketing();  // CALL #2
       return;
     }
   ```

Both fire for the same navigation event, causing two full pagination runs back-to-back.

**Fix:** Add a loading guard to `loadMarketing()`. Near the top of the function (around line 980), add:
```js
let _mktLoading = false;
async function loadMarketing() {
  if (_mktLoading) return;  // Prevent double-load
  if (mktLoaded) { renderMarketingView(); return; }  // Already loaded, just re-render
  _mktLoading = true;
  try {
    // ... existing pagination logic ...
  } finally {
    _mktLoading = false;
  }
}
```
Also consider removing the `loadMarketing()` call from one of the two codepaths (line 544 or line 730) since both aren't needed.

---

## Bug 3: Activity Breakdown shows all zeros while header shows 1,164

**Severity:** Medium (confusing/contradictory data on the home page)

**Root cause:** The home page has two stat sections that use different data sources:

**Header stats** (`renderHomeStats()`, line 4123):
- Tries `canonicalCounts` first (from OPS queue — currently all zeros)
- Falls back to `mktData` (CRM client rollup from Salesforce) at line 4129, which correctly shows 1,164 open activities

**Activity Breakdown** (`renderCategoryMetrics()`, line 4291):
- Tries `canonicalCounts` first (lines 4293-4300) — currently all zeros, so it renders "0 My Actions / 0 Team Open / 0 Done This Week / 0 Overdue"
- The fallback (lines 4303-4322) uses `activities` array (from the SF activities API), NOT `mktData`
- But `canonicalCounts` IS set (it's just all zeros), so the fallback never triggers — the function returns at line 4300 with zero values

**Fix:** In `renderCategoryMetrics()` (line 4293), change the condition to only use canonicalCounts when it has meaningful data:
```js
// Before (line 4293):
if (canonicalCounts) {

// After:
if (canonicalCounts && (canonicalCounts.my_actions > 0 || canonicalCounts.open_actions > 0 || canonicalCounts.completed_week > 0 || canonicalCounts.overdue > 0)) {
```
This mirrors the same pattern used in `renderHomeStats()` at line 4125 where it checks `canonicalCounts.my_actions > 0 || canonicalCounts.inbox_new > 0`.

Then also add a `mktData` fallback between the canonicalCounts block and the legacy activities fallback (after line 4301):
```js
// CRM rollup fallback (same data source as renderHomeStats)
if (mktLoaded && mktData.length > 0) {
  const userName = LCC_USER.display_name || 'Scott Briggs';
  const myTasks = mktData.filter(d => d.assigned_to === userName && d.open_task_count > 0);
  const allOpen = mktData.filter(d => d.open_task_count > 0);
  const now = Date.now(); const week = 7 * 86400000;
  const overdue = mktData.filter(d => d.due_date && new Date(d.due_date).getTime() < now);
  let html = '<div class="cat-metrics">';
  html += `<div class="cat-metric clickable" onclick="navTo('pageBiz')"><div class="cat-metric-val" style="color:var(--accent)">${myTasks.length}</div><div class="cat-metric-lbl">My Actions</div></div>`;
  html += `<div class="cat-metric"><div class="cat-metric-val" style="color:var(--cyan)">${allOpen.length}</div><div class="cat-metric-lbl">Team Open</div></div>`;
  html += `<div class="cat-metric"><div class="cat-metric-val" style="color:var(--green)">0</div><div class="cat-metric-lbl">Done This Week</div></div>`;
  html += `<div class="cat-metric${overdue.length > 0 ? ' overdue' : ''}"><div class="cat-metric-val" style="color:${overdue.length > 0 ? 'var(--red)' : 'var(--yellow)'}">${overdue.length}</div><div class="cat-metric-lbl">Overdue</div></div>`;
  html += '</div>';
  return html;
}
```

---

## Bug 4: Team Pulse also shows all zeros (same root cause as Bug 3)

**Severity:** Low-Medium

**Root cause:** `renderTeamPulse()` at line 4371 has the same pattern:
```js
if (!isManager || !canonicalCounts) {
```
It gates on `canonicalCounts` being null, but canonicalCounts IS set (just all zeros), so the function renders zero values without any CRM fallback.

**Fix:** Same approach as Bug 3 — add a meaningful-data check:
```js
if (!isManager || !canonicalCounts || (canonicalCounts.unassigned === 0 && canonicalCounts.escalations === 0 && canonicalCounts.sync_errors === 0 && canonicalCounts.research === 0)) {
  return ''; // Hide the section entirely when there's no meaningful data
}
```

---

## Performance 1: Marketing pagination uses small page size (500 rows, 13 requests)

**Severity:** Medium (each round-trip adds latency; Marketing tab takes ~10 seconds to load)

**Root cause:** `app.js` line 991:
```js
const BATCH_SIZE = 500;
```
This results in 13 sequential API calls to load 6,110 contacts. Meanwhile, the opportunities fetch uses `OPP_PAGE = 1000` (line 1098).

**Fix:** Increase `BATCH_SIZE` to 1000 (line 991):
```js
const BATCH_SIZE = 1000;
```
This cuts the number of round-trips from 13 to 7, roughly halving load time. PostgREST typically supports up to 1000 rows per request by default, so this should work without server changes. If the Supabase instance allows it, 2000 would cut it to 4 requests.

---

## Performance 2: Activities data is 73% duplicates (4,399 raw → 1,164 unique)

**Severity:** Low-Medium (wastes bandwidth but only affects initial load)

**Root cause:** `app.js` lines 3764-3792. The `/ai-copilot/sync/sf-activities` edge function returns 4,399 rows, of which 3,235 are duplicates by `subject|contact_name|company_name|activity_date` composite key. The deduplication happens client-side at line 3770-3778.

**Fix:** This is a server-side issue in the Supabase edge function that serves `/sync/sf-activities`. The edge function or its underlying query should deduplicate before returning. Options:
- Add a `DISTINCT ON (subject, contact_name, company_name, activity_date)` clause to the SQL query
- Or create a view `v_salesforce_activities_unique` that deduplicates
- This would reduce the payload from ~4,400 rows to ~1,200 rows (roughly 3x less data transferred)

---

## UX 1: Flagged emails show sender as "Sbriggssjc" or "Account"

**Severity:** Low (cosmetic, but hurts scannability)

**Root cause:** The `sender_name` field from the `/sync/flagged-emails` edge function is returning Outlook mailbox display names rather than actual sender names. In `app.js`:
- Home page: line 4353 uses `e.sender_name || e.sender_email || ''`
- Messages page: line 4629 uses `e.sender_name || e.sender_email || 'Unknown'`

The values "Sbriggssjc" and "Account" come from Outlook's `from.emailAddress.name` field, which for some emails returns the mailbox alias rather than the person's name.

**Fix:** In the edge function that serves `/sync/flagged-emails`, prefer `e.sender_email` when `sender_name` looks like a mailbox alias (no spaces, matches the email prefix, or equals common placeholders like "Account"):
```js
// In the edge function mapping:
const rawName = email.from?.emailAddress?.name || '';
const email_addr = email.from?.emailAddress?.address || '';
// If sender_name looks like a mailbox alias, use email instead
const sender_name = (rawName && rawName.includes(' ') && rawName !== 'Account')
  ? rawName
  : email_addr.split('@')[0]; // Better: show "john.doe" instead of "Account"
```
Or better yet, cross-reference with the CRM contacts to resolve the sender to a known contact name.

---

## UX 2: "More" drawer auto-dismiss on selection

**Severity:** Low (minor polish)

**Root cause:** When tapping an item in the More menu drawer, the drawer stays visible briefly before the page transitions. The drawer dismiss animation and the page navigation happen asynchronously.

**Fix:** In the More menu item click handlers, dismiss the drawer immediately before navigating:
```js
// In the More menu item click handler:
document.querySelector('.more-drawer').classList.remove('open'); // dismiss first
setTimeout(() => navTo(targetPage), 100); // then navigate after brief delay
```

---

## Summary — Priority Order

| # | Issue | Impact | Effort | Priority |
|---|-------|--------|--------|----------|
| 2 | Marketing double-load | High (doubles API calls) | Easy (add guard) | P1 |
| 3 | Activity Breakdown zeros | Medium (confusing UI) | Easy (fix condition) | P1 |
| 5 | Marketing page size 500→1000 | Medium (halves load time) | Trivial (change one number) | P1 |
| 1 | 405 on _perf beacon | Low (wasted request) | Easy (add POST handler) | P2 |
| 4 | Team Pulse zeros | Low-Medium | Easy (same pattern as #3) | P2 |
| 6 | Activities dedup server-side | Medium (3x less data) | Medium (edge function change) | P2 |
| 7 | Email sender display names | Low (cosmetic) | Medium (edge function change) | P3 |
| 8 | More drawer auto-dismiss | Low (polish) | Easy | P3 |
