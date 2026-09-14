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

## ~~`pending_moves` cosmetic inflation in the daily-briefing "Email cleanup (24h)" line~~ — **RESOLVED 2026-08-20 (P120)**

**Surfaced:** 2026-07-20. **Resolved:** 2026-08-20 by the Move-Queue Executor (P120).

**Symptom (as filed):** the briefing's `Email cleanup (24h): … N move(s) pending`
clause grew without bound.

**Root cause (as filed, and CORRECT):** `move_status` was set to `'pending'` at
emit time by `emitProcessingComplete` and **nothing ever transitioned it**. The
old queue-drain consumer (`api/_handlers/processing-complete.js`) was shadowed and
then deleted by PR #1435; the live `sync.js` relay never touched
`processing_log.move_status`.

> ### ⚠️ The diagnosis was right; the IMPACT call was wrong, and it cost a month.
>
> This entry concluded **"Impact: Cosmetic only, and confined to the trailing
> 'N moves pending' sub-stat."** It was not cosmetic. A `move_status` that never
> leaves `'pending'` was not a stale counter — it was the mailbox telling us **the
> emails were never being moved at all**. Measured 2026-08-20: 323 `staged` + 15
> `duplicate` moves pending since 2026-07-21, the "Intake Staged, Not Completed"
> folder empty, and every one of the 16 `move_status='moved'` rows explained by
> Flow 6 bookkeeping rather than by a move. The recommended fix — *"drop the
> `pending_moves` clause from the briefing line"* — would have **deleted the only
> live indicator that the loop was open**.
>
> **Durable lesson:** before calling an unmaintained counter cosmetic, ask what
> the counter would look like if the underlying WORK were genuinely not happening.
> If the answer is "exactly like this", it is not a display bug — it is the
> symptom. Assert on the STATE DELTA (did any message change folders?), never on
> the counter's plausibility. Same class as the P159a "drillthrough: 37 while the
> queue drained 6" finding.

**Fix:** P120 built the missing executor —
`GET /api/move-queue-worklist` + `POST /api/move-queue-ack`
(`api/_handlers/move-queue.js`), backed by `v_lcc_move_queue_worklist` and
`lcc_move_queue_ack()` (migration `20260820140000`). It is now the SINGLE
stamp-back path and clears `move_status` on every terminal outcome, so
`pending_moves` is an honest actionable count again and **stays on the briefing
line**.

**The "do NOT wire a second mechanism" warning still stands** — and P120 honours
it: there is exactly ONE owner per folder transition (drainer: Inbox → staging
and Inbox → Processed/*; W7.6 mirror: staging → Processed), and exactly one
stamp-back path. P120 did not add a parallel tracker; it supplied the missing
owner the note assumed already existed.

**When reading the numbers:** `move_status='moved'` covers BOTH "we relocated it"
and "it had already left the folder" (P119 terminal semantics). The real
move-delta is `processing_log.move_outcome = 'moved'`.
