# QA-14 — Messages page inline actions (P2 deferred)

**Severity: P2.** Every row on the Messages page had only
"Open in Outlook ↗", forcing a context switch per message. The
Inbox page has the full Triage / Promote / Assign / Dismiss action
set; this patch wires the same set onto the Messages page's
**flagged** tab.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-14-messages-inline-actions
node audit/patches/qa-14-messages-inline-actions/apply.mjs --dry
node audit/patches/qa-14-messages-inline-actions/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-14-messages-inline-actions/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-14-messages-inline-actions -m "Merge audit/qa-14-messages-inline-actions"
git push origin main
```

## Why this is structurally different from QA-13

The Home Inbox rail (QA-13) renders canonical inbox rows directly —
each item already has a queue UUID and `status`, so the four
handlers (`triageSingle` / `promoteSingle` / `dismissSingle` /
`quickReassign`) work without translation.

The Messages page's **flagged** tab is different — it pulls raw
Outlook emails from `/api/sync?action=flagged_emails`. Those items
have an Outlook `external_id` but no canonical queue UUID.
**Recent** and **Sent** tabs are SF activity rows, not triage
queue items — they don't get action buttons at all (no Promote
target).

The canonical inbox sync runs separately and creates a queue row
for each flagged email (eventually). So at any given moment some
flagged emails on the Messages page have a canonical match and
some don't.

## What changed

`app.js`:

1. **New module-level `Map`:** `msgCanonicalById` — keyed by Outlook
   `external_id`, value `{ id, status }` of the canonical inbox
   row.
2. **`loadMessages`** now also fetches
   `/api/queue-v2?view=inbox&per_page=500` and populates the map.
   Failure is logged but doesn't block the rest of the page.
3. **`renderMessages`** — flagged tab:
   - Each mapped item carries `canonicalId` + `canonicalStatus`.
   - Cards with a `canonicalId` render the four-button action row
     (Triage shown only when `canonicalStatus === 'new'`, matching
     `inboxItemHTML`).
   - Cards without a match keep just the "Open in Outlook ↗" link
     plus a small grey hint `"(not yet in inbox queue)"` so the
     user knows the actions will appear once the inbox sync
     canonicalizes the email.

The Recent/Sent tabs are unchanged — those items are SF activities,
not triage queue items, so adding action buttons would be
misleading.

## Before vs after (flagged tab)

**Before:**
```
[Message row]
  Sender · Date
  Subject
  Preview…
  Open in Outlook ↗
```

**After (canonical match exists):**
```
[Message row]
  Sender · Date
  Subject
  Preview…
  Open in Outlook ↗
  [Triage] [Promote] [Assign] [Dismiss]    ← QA-14
```

**After (no canonical match yet):**
```
[Message row]
  Sender · Date
  Subject
  Preview…
  Open in Outlook ↗  (not yet in inbox queue)
```

## Files changed

- `app.js` — `loadMessages` adds canonical-inbox cross-ref fetch +
  Map. `renderMessages` flagged-tab path emits action buttons when
  matched.
- `AUDIT_PROGRESS.md` (closeout)

## Follow-up (deferred)

- **QA-15**: Research page — wire the LLC + Agency Drift widgets onto
  pageResearch. Last item from the deferred list.

## Optional follow-up (not in this patch)

A "Bring to Inbox" button on unmatched flagged-tab cards could
manually create the canonical row on demand (rather than waiting
for the next sync). That requires a small backend endpoint
(`/api/workflows?action=canonicalize_email` taking `external_id`)
and is bigger than this UI patch's scope.
