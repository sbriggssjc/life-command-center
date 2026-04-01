# Marketing Tab Fixes — Claude Code Prompt

## Context

The Marketing CRM Activity Hub in `app.js` loads 1,000 contacts from `v_crm_client_rollup` (materialized view) and renders them as cards. The data is flowing but three critical features are missing from the deployed build.

**Current state:** 995 contacts loading, retry logic works, assigned_to filter works, cards show contact info + last call + completed activity count. But:

1. **Open task titles are not visible** — `open_tasks` JSON is in the `leanFields` select but arrives as an empty array. The `open_tasks` column on the materialized view contains a JSON array like:
   ```json
   [{"subject":"5 - ARA - Port St. Lucie, FL - SOLD","notes":null,"date":"2026-08-13","type":"Opportunity"},
    {"subject":"Call","notes":"f/u on DL: DaVita | Omaha, NE","date":"2025-01-23","type":null}]
   ```
   Each task has `subject` (the deal title), `notes`, `date`, and `type` ("Opportunity" or null for general tasks).

2. **Sort order is backwards** — data arrives from the API sorted `last_activity_date DESC` but renders oldest first. The array needs to be reversed after loading, or the `renderProspectCardsHTML` function is re-sorting it.

3. **No "Sort by Deal" toggle** — needs a pill toggle: "Recent Activity | By Deal"

---

## Fix 1: Show open task titles on each contact card

In the `renderProspectCardsHTML` function in `app.js`, after the contact name/company/phone lines, add rendering of the `open_tasks` array:

```javascript
// After the phone and before the action buttons, render open tasks
if (c.open_tasks && c.open_tasks.length > 0) {
  html += '<div style="margin-top:4px;font-size:11px">';
  html += '<span style="color:var(--text2);font-weight:600">Open Tasks (' + c.open_tasks.length + '):</span>';
  c.open_tasks.slice(0, 5).forEach(function(t) {
    var subj = t.subject || 'Task';
    var isOpp = t.type === 'Opportunity';
    var icon = isOpp ? '<span style="color:var(--yellow)">★</span> ' : '<span style="color:var(--text3)">•</span> ';
    html += '<div style="padding:2px 0 2px 8px">' + icon;
    html += '<span style="color:' + (isOpp ? 'var(--accent)' : 'var(--text)') + '">' + esc(subj) + '</span>';
    if (t.date) html += ' <span style="color:var(--text3)">(' + esc(t.date) + ')</span>';
    if (t.notes) html += ' <span style="color:var(--text3);font-style:italic">— ' + esc(t.notes) + '</span>';
    html += '</div>';
  });
  if (c.open_tasks.length > 5) html += '<div style="padding:1px 0 1px 8px;color:var(--text3)">+ ' + (c.open_tasks.length - 5) + ' more...</div>';
  html += '</div>';
} else if (c.open_task_count > 0) {
  html += '<div style="font-size:11px;color:var(--accent);margin-top:3px">' + c.open_task_count + ' open task' + (c.open_task_count > 1 ? 's' : '') + ' — click to view</div>';
}
```

**IMPORTANT:** If `open_tasks` arrives as an empty array despite `open_task_count > 0`, the issue is that the `leanFields` select string excludes `open_tasks`. Make sure the select includes it:
```
sf_contact_id,sf_company_id,first_name,last_name,contact_name,company_name,email,phone,assigned_to,open_task_count,open_tasks,last_activity_date,completed_activity_count,last_call_notes
```

If payload size is a concern (1000 rows × ~112 bytes of JSON = ~112KB — manageable), include it. If it times out, fetch `open_tasks` on-demand when the card is expanded via `toggleContactDetail`.

---

## Fix 2: Sort order — most recent first

After fetching the client rollup data and normalizing it, reverse the array OR sort client-side:

```javascript
// After normalizing tasks array:
tasks.sort(function(a, b) {
  return (b.due_date || '').localeCompare(a.due_date || '');
});
```

OR simply add `.reverse()` after the normalization if the API already returns DESC order:
```javascript
const tasks = (clientRollupRaw || []).map(d => ({ ... }));
// API returns DESC but array may be reversed during processing
tasks.sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''));
```

---

## Fix 3: Sort by Deal toggle

Add a `mktSort` state variable:
```javascript
let mktSort = 'date'; // 'date' | 'deal'
```

In `renderMarketing()`, add sort pills after the status filter pills:
```javascript
html += '<div class="pills" style="margin-bottom:8px">';
html += '<span style="font-size:11px;color:var(--text3);margin-right:6px">Sort:</span>';
html += '<span class="pill ' + (mktSort==='date'?'active':'') + '" onclick="mktSort=\'date\';mktPage=0;renderMarketing()">Recent Activity</span>';
html += '<span class="pill ' + (mktSort==='deal'?'active':'') + '" onclick="mktSort=\'deal\';mktPage=0;renderMarketing()">By Deal</span>';
html += '</div>';
```

When `mktSort === 'deal'`, group contacts by their primary Opportunity deal subject:
```javascript
if (mktSort === 'deal') {
  // Group contacts under their deal subjects
  var dealGroups = {};
  filtered.forEach(function(c) {
    var tasks = c.open_tasks || [];
    var oppTasks = tasks.filter(function(t) { return t.type === 'Opportunity'; });
    if (oppTasks.length > 0) {
      oppTasks.forEach(function(t) {
        var key = t.subject || '(Untitled)';
        if (!dealGroups[key]) dealGroups[key] = { deal: key, date: t.date, contacts: [] };
        dealGroups[key].contacts.push(c);
      });
    }
  });
  // Sort deals by most recent date, render each deal as a card with contacts listed underneath
  var sortedDeals = Object.values(dealGroups).sort(function(a, b) {
    return (b.date || '').localeCompare(a.date || '');
  });
  // Render deal-grouped cards...
}
```

Each deal group card should show:
- Deal title as header (e.g., "5 - DaVita MT - McKees Rocks, PA")
- Contact count and due date
- Each contact underneath with name, company, email, phone, and action buttons

---

## Fix 4: Task management controls (bonus)

On each open task line, add inline controls:
- ✓ button to mark as Completed (PATCH salesforce_activities SET status='Completed')
- Date picker to reschedule (PATCH salesforce_activities SET activity_date=newDate)
- ✕ button to dismiss/archive (PATCH salesforce_activities SET status='Abandoned')

These PATCH to `salesforce_activities` via the `dia-query` proxy using `filter=sf_contact_id=eq.{id}` and `filter2=subject=eq.{subject}`.

---

## Files to modify

| File | Change |
|------|--------|
| `app.js` | Add mktSort state, sort toggle UI, deal grouping logic, open task rendering, sort fix, task management controls |

## Verification

After implementation:
1. Marketing tab shows contacts sorted most-recent-first (Venkata Parsa 2026-08-13 on top)
2. Each card shows open task titles with ★ for Opportunity deals
3. "Sort: Recent Activity | By Deal" toggle works
4. By Deal view groups contacts under deal headers
5. Task management buttons (✓/date/✕) work on each task line
