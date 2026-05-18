# QA-09 — "Open Activities" stat reconciliation (P1)

**Severity: P1.** Three different numbers across Home / Pipeline /
Metrics all looked like they meant "how many things does Scott have
to do?", but they each measured something different. The user
correctly distrusted the dashboard because the numbers didn't add up.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-09-open-activities-stat-reconcile
node audit/patches/qa-09-open-activities-stat-reconcile/apply.mjs --dry
node audit/patches/qa-09-open-activities-stat-reconcile/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-09-open-activities-stat-reconcile/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-09-open-activities-stat-reconcile -m "Merge audit/qa-09-open-activities-stat-reconcile: stat label + Pipeline filter"
git push origin main
```

## The conflict (before)

| Surface | Stat | Value | What it actually counted |
|---|---|---|---|
| Home | "Open Activities" | 0 | `work_counts.open_actions` — promoted/assigned actions only (correct, but unlabeled) |
| Home | "Flagged Emails" | 3,569 | Raw Outlook flag count from a separate email API |
| Pipeline | "My Work · 23 items" | 23 | First 100 `flagged_email` rows from `/api/queue`, after dedup by `(title, source_type, date)` |
| Metrics | "INBOX · 7,402 needs triage" | 7,402 | `work_counts.inbox_new` |
| Inbox page | "100 items" | 100 | Same flagged_email source, paginated |

Five numbers, four different concepts, overlapping labels.

## What this patch does

**Tight scope** — does NOT renumber or rename any of the five stats.
Just stops Pipeline from pulling the wrong rows and adds a tooltip to
Home so the semantics are explicit.

### 1. `ops.js` — `renderMyWork`

Drops `source_type === 'flagged_email'` and `item_type === 'inbox'`
rows after the fetch, before the dedup. The "23 items" was a coincidence
of dedup math over the first 100 raw email rows — those items belong
on the Inbox page, not in the action queue. After this change, Pipeline
truly shows action items only, agreeing with Home's "Open Activities".

```js
opsMyWorkData = qRes.data?.items || qRes.data || [];
// QA-09: exclude raw flagged-email / inbox triage rows from "My Work".
const inboxDropped = opsMyWorkData.filter(item =>
  item.source_type === 'flagged_email' || item.item_type === 'inbox'
).length;
opsMyWorkData = opsMyWorkData.filter(item =>
  item.source_type !== 'flagged_email' && item.item_type !== 'inbox'
);
window._opsMyWorkInboxDropped = inboxDropped;
```

### 2. `ops.js` — `renderMyWorkList` empty state

When the filter drops N items and the queue is otherwise empty, the
empty state now says:

> **No action items assigned to you**
> 7,400 flagged emails sitting in Inbox — triage there to promote
> them into actions.
> [ Open Inbox ]

Instead of:

> **No work items yet**
> Sync your connectors or promote inbox items to populate your queue.

### 3. `index.html` — `#statActivities` tooltip

Adds `title=` attribute to the Home "Open Activities" stat card so
hovering explains it's **not** the inbox triage queue:

```html
title="Promoted / assigned action items only — does not include raw
       flagged emails. See the Flagged Emails stat (next card) for
       the triage queue."
```

## After

| Surface | Stat | Meaning | Internally consistent? |
|---|---|---|---|
| Home | "Open Activities" | promoted/assigned actions only (tooltip explains) | ✓ matches Pipeline |
| Home | "Flagged Emails" | raw Outlook flag count (separate concept) | ✓ no overlap |
| Pipeline | "My Work" | only true actions, raw emails excluded | ✓ matches Home |
| Metrics | "INBOX · needs triage" | `work_counts.inbox_new` | ✓ separate concept |
| Inbox page | "X items" | `work_counts.inbox_new` (paginated) | ✓ same source as Metrics |

The dropped-count hint on the Pipeline empty state turns the previously
confusing "0 items" into a productive "you have N emails waiting in
Inbox — go triage them" call-to-action.

## Caveats / what we did NOT change

- The 3,569 (Home Flagged Emails) vs 7,402 (Metrics INBOX) gap is
  real but a separate issue. The Outlook flag count is a different
  source than the canonical inbox count — they will not agree until
  the inbox sync catches up. Out of scope for QA-09.
- Renaming the labels themselves (e.g. "Open Activities" →
  "Actions Assigned") is the "medium scope" option — also out of
  scope. The tooltip is a minimal-blast-radius substitute.

## Follow-ups (separate patches)

Still queued from the 2026-05-18 QA pass:
- **P1** Sync error count contradicts itself (Pipeline header / Metrics tile / Sync Health page)
- **P1** Public REITs + same-entity duplicates in `llc_research_queue`
- **P2** Casing/UX nits documented in
  `outputs/lcc-qa-pass-2026-05-18.docx`.
