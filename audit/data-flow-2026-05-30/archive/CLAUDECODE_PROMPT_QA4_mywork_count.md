# Claude Code prompt — QA#4: reconcile "My Work" counts (Today vs Pipeline)

Paste into Claude Code, run from the **life-command-center** repo. Touches
`api/queue.js` + `ops.js` only — no overlap with QA#1/QA#2/QA#3 files.

---

## Context (verified live 2026-06-03 — don't re-investigate)

"My Work" disagrees across surfaces:
- **Today** widget shows "View all **8442** items" — `app.js` ~line 6471–6473
  reads `canonicalMyWork.pagination.total` from `/api/queue-v2?view=my_work`.
- **Pipeline** shows "**0** items" — `ops.js renderMyWork` fetches
  `/api/queue?view=my_work` then drops `source_type==='flagged_email' ||
  item_type==='inbox'` client-side (the QA-09 filter), leaving 0 for Scott.
- The empty-state hint says "**25** flagged emails" but Today says "**3,004**".

Root cause: `v_my_work` (LCC Opps) is a UNION of **action_items + inbox +
research**. By `item_type` it's dominated by inbox rows
(`email_om` 4,636 · `flagged_email` 3,004 · `sidebar_om` 514 ·
`new_contact_qualify` 303 · `copilot*` 5 ≈ 8,462) plus `research` 2,750; actual
`action` items ≈ 0. Both query paths in `api/queue.js` select `v_my_work` with
**no inbox exclusion**, so the v2 `pagination.total` counts all the inbox rows
(8442). The Pipeline page only hides them client-side, so the displayed count
(0) and the Today total (8442) disagree, and `statActivities`(0) disagrees with
both. Inbox rows belong to the Inbox surface (`v_inbox_triage`), not My Work.

## Task

### 1. Exclude inbox rows from "My Work" at the source (api/queue.js)
Add `&item_type=neq.inbox` to **both** my_work query paths so the count is the
true action-item count everywhere (this matches the existing client-side filter
and covers every inbox `source_type`, including `flagged_email`):
- v1 `case 'my_work'` (~line 68): the `v_my_work?...` path.
- v2 `v2GetMyWork` (~line 276): the same `v_my_work?...` path.

Do **not** change `v_inbox_triage` / the inbox view, `team`, or `research`.
Confirm `v2GetWorkCounts` already excludes inbox (statActivities reads 0 — if it
doesn't, align it the same way so the strip, the widget total, and Pipeline all
agree).

### 2. Fix the flagged-email hint (ops.js)
In `renderMyWork`'s empty state, the hint uses `window._opsMyWorkInboxDropped`
(count of inbox rows within the fetched page — now ~0 since the server excludes
them). Replace it with the **true** flagged/inbox total so the hint is honest —
reuse the same source the Today "Flagged Emails" stat uses
(`/api/sync?action=flagged_emails` count, or the inbox count from
`work_counts`). Phrase: "N flagged emails waiting in Inbox — triage to promote
them into actions." The client-side `flagged_email/inbox` filter can stay as
belt-and-suspenders.

## Verify + ship
- After deploy, on a single load: Today "View all N items", Pipeline "N items",
  and the Today "Open Activities" stat should all show the **same** number; the
  Inbox hint should match the Today "Flagged Emails" stat (≈3,004), not a
  per-page subset.
- `node --check api/queue.js ops.js`. Function count unchanged.
- Branch `claude/qa4-mywork-count-<sessionId>`; end with merge + deploy commands.
