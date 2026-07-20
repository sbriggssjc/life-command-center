# Known Issues

Low-priority, non-blocking issues surfaced during other work. Each entry states
the symptom, the root cause, the preferred fix, and (importantly) what NOT to do.

---

## `pending_moves` cosmetic inflation in the daily-briefing "Email cleanup (24h)" line

**Surfaced:** 2026-07-20 (follow-up to PR #1435, which removed the shadowed
duplicate `/api/webhooks/processing-complete` intake handler).

**Symptom:** The daily executive briefing's "Ops & Queue" section renders an
`Email cleanup (24h): … N move(s) pending` clause. The `N` grows without bound —
it counts essentially every move-eligible email in the 24h window.

**Root cause:** `fetchProcessingSummary` (`api/_shared/briefing-data.js`) computes
`pending_moves` as `count(processing_log WHERE move_status = 'pending')`.
`move_status` is set to `'pending'` at emit time (`emitProcessingComplete` in
`api/_shared/processing-complete.js`) but **nothing ever transitions it to
`moved` / `move_failed`**:

- The only code that flipped `move_status` was the queue-drain consumer in
  `api/_handlers/processing-complete.js` (`reportMoveResults`), which was **already
  shadowed/unreachable** before PR #1435 (the `sync.js` mount for
  `/api/webhooks/processing-complete` is registered first, wins in Express, and
  returns 405 on the `GET` that queue design needed). PR #1435 deleted that dead
  handler.
- The live production handler (`sync.js` `handleProcessingComplete`) reconciles the
  mailbox move via `todo_task_map` + `pa-move-message.js` and **never touches
  `processing_log.move_status`**.

So `move_status` has been unmaintained since the "Closing the Loop" redesign
superseded the old queue design — this predates PR #1435, which neither caused nor
worsened it.

**Impact:** Cosmetic only, and confined to the trailing "N moves pending" sub-stat.
The headline numbers in the same line — `filed` / `needs_review` / `duplicate`
("N auto-filed, M flagged for review, K deduped") — are **accurate**: they key on
the `outcome` column, which `emitProcessingComplete` still writes correctly.

**Preferred fix (when someone picks this up):** Drop the `pending_moves` clause
from the briefing line entirely (`fetchProcessingSummary` + the render in
`api/_handlers/briefing-email-handler.js` `renderOpsAndQueue`).

**Do NOT** wire a parallel PATCH-based tracker on `processing_log.move_status`. The
`sync.js` relay + `todo_task_map` already own real move-tracking; adding a second
mechanism would recreate the exact two-systems-doing-the-same-thing duplication
that PR #1435 just removed.
