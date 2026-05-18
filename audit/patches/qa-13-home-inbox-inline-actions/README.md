# QA-13 — Home Inbox rail inline actions (P2 deferred)

**Severity: P2.** The Home rail's inbox cards offered only
"Open in Outlook ↗", forcing a tab-switch (or a click into the Inbox
page) to triage an email already visible on Home. The dedicated
Inbox page had the full Triage / Promote / Assign / Dismiss action
set; this patch mirrors that set onto the Home rail.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-13-home-inbox-inline-actions
node audit/patches/qa-13-home-inbox-inline-actions/apply.mjs --dry
node audit/patches/qa-13-home-inbox-inline-actions/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-13-home-inbox-inline-actions/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-13-home-inbox-inline-actions -m "Merge audit/qa-13-home-inbox-inline-actions"
git push origin main
```

## What changed

`app.js` `renderRecentEmails` — canonical-inbox path. After the
existing "Open in Outlook ↗" link, each card now ends with a row of
four buttons matching `ops.js inboxItemHTML`:

| Button | Handler | When shown |
|---|---|---|
| **Triage** | `_opsBtnGuard(this, triageSingle, id)` | only when `item.status === 'new'` |
| **Promote** (primary) | `_opsBtnGuard(this, promoteSingle, id)` | always |
| **Assign** | `quickReassign(id, 'inbox', title)` | always |
| **Dismiss** (danger) | `_opsBtnGuard(this, dismissSingle, id)` | always |

All four handlers are top-level declarations in `ops.js` (i.e.,
window globals), so the calls work from any code path. The button
row is wrapped in `<div onclick="event.stopPropagation()">` so the
card's `navTo('pageInbox')` doesn't fire when buttons are clicked.

The legacy fallback path (raw flagged emails from the edge function,
no canonical queue row) keeps the existing "Open in Outlook ↗" link
only — those items don't have a database-backed `id` and can't be
triaged/promoted/dismissed without first being canonicalized.

## Before vs after

**Before:**
```
[Email card]
  Subject
  Sender · Date
  Body preview…
  Open in Outlook ↗
```

**After (canonical path):**
```
[Email card]
  Subject
  Sender · Date
  Body preview…
  Open in Outlook ↗
  [Triage] [Promote] [Assign] [Dismiss]    ← QA-13
```

## Why this matters

The original QA report noted: "Forces an unnecessary navigation to
the Inbox page (or a tab-switch to Outlook) to triage an email
already showing on Home." With 7,400+ flagged emails in inbox, the
click-economy cost of always navigating to the dedicated page was
the main thing keeping the rail under-utilized.

## Files changed

- `app.js` — `renderRecentEmails` canonical-inbox path
- `AUDIT_PROGRESS.md` (closeout)

## Verified

- Sentinels present (see `apply.mjs --dry`)
- Handlers (`triageSingle`, `promoteSingle`, `dismissSingle`,
  `quickReassign`, `_opsBtnGuard`, `jsStringArg`) confirmed as
  top-level declarations in `ops.js` and reachable as globals from
  `app.js` runtime contexts.

## Follow-ups (deferred — separate patches)

- **QA-14**: Messages page inline actions (every row currently has only
  "Open in Outlook ↗").
- **QA-15**: Research page — wire the LLC + Agency Drift widgets onto
  pageResearch.
