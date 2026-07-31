# Known Issues

Low-priority, non-blocking issues surfaced during other work. Each entry states
the symptom, the root cause, the preferred fix, and (importantly) what NOT to do.

---

## `v_field_provenance_unranked`: 31 pre-existing costar_sidebar rows (registry-coverage gap, NOT drift)

**Surfaced:** 2026-07-31 (session 33, during W5.1 migration verification).

**Symptom:** `v_field_provenance_unranked` (LCC Opps) returns 31 rows — all
`costar_sidebar` writes to `dia/gov.sales_transactions` ancillary fields
(`updated_at`, `data_source`, `rent_source`, `cap_rate_confidence`,
`sale_notes_raw/extracted`, etc.).

**Root cause:** the costar_sidebar registry rules cover its primary fields but
not these bookkeeping/side-effect columns; the sidebar pipeline has been writing
them since at least 2026-07-13 (pre-dates W4.4, whose flush upgrade and drift=0
claim concerned the splink/human sources and remains true). NOT caused by W5.1
(its sources are fully registered) or W4.4.

**Preferred fix:** register the 31 table/field combos for `costar_sidebar` at
its standard priority 70 `record_only` — a mechanical INSERT mirroring its
existing rules — ideally in the next Claude Code session touching the registry
(so intent is checked field-by-field; a couple, like `updated_at`, may be better
excluded from provenance emission at the writer instead).

**What NOT to do:** don't treat this as W4.4 flush drift (it isn't — first_seen
pre-dates it), and the W6.6 monthly audit should count these 31 as KNOWN until
fixed, alerting only on unranked rows BEYOND this set.

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
  mailbox move via `pa-move-message.js` and **never touches
  `processing_log.move_status`** on the terminal path. (The To Do Completion Poll's
  `staged → filed` flip does set `move_status='moved'` for staged emails.)

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
`sync.js` relay + the To Do Completion Poll already own real move-tracking; adding a
second mechanism would recreate the exact two-systems-doing-the-same-thing
duplication that PR #1435 just removed.
