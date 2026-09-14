# Flow 7 — LCC Move Queue Executor (the leg that actually moves the email)

Last updated: 2026-08-20 (P120; ordering hazard resolved by P121)
Owner: LCC architecture/audit track (Scott Briggs)
Part of: `closing-the-loop-overview.md` (mailbox mechanics)
Connector: Office 365 Outlook (Scott's mailbox) · Microsoft Graph
Flag: `MOVE_QUEUE_EXECUTOR` (Railway env; `feature_flags_registry`)

> **This is the flow that makes intake→folder hygiene real.** Everything upstream
> of it has worked for a month; nothing downstream of it could, because the
> message never left the Inbox.

## Why it exists — measured live 2026-08-20

`api/_shared/processing-complete.js` has been computing a `target_folder` and
writing `move_status='pending'` for every processed email since 2026-07-21. **No
consumer ever drained that queue:**

| outcome | move_status | rows | oldest |
|---|---|---|---|
| `staged` | `pending` | 325 | 2026-07-21 |
| `duplicate` | `pending` | 15 | 2026-07-20 |
| `filed` | `moved` | 16 | 2026-07-21 |
| `needs_review` | `skipped` | 47 | 2026-07-20 |

All 16 `moved` rows carry `outcome='filed'` **and** `target_folder =
final_target_folder` — the exact signature of the Flow 6 `todo-completion-poll`
`staged→filed` flip (`api/sync.js` `markFiled`). `intake.js` never emits
`outcome='filed'`. **So the move executor had stamped zero rows, ever.**

The push relay (`POST /api/webhooks/processing-complete` → `pa-move-message.js`)
is real and correct but has **no caller**, and it never wrote `move_status` on
any path — so there was neither a queue to poll nor a stamp-back. This flow +
`api/_handlers/move-queue.js` are both.

Consequence: the "Intake Staged, Not Completed" folder stayed empty, so the W7.6
mirror correctly-but-uselessly acked every candidate `already_out`.

## Ownership — one owner per folder transition (P119's rule, made concrete)

| transition | owner |
|---|---|
| Inbox → "Intake Staged, Not Completed" | **this flow** |
| Inbox → `Processed/*` (filed / duplicate) | **this flow** |
| "Intake Staged, Not Completed" → `Processed/*` | W7.6 mailbox mirror |
| `needs_review` | nobody — the message stays put by design |

**The PA flagged-email intake flow must NOT also move the message at
classification time.** A transient Graph failure there is lost forever (there is
no queue behind it), and two movers on one transition is precisely the race P119
killed. The intake flow's job ends at handing LCC the message; the queue owns
the mailbox action.

## Endpoints (LCC side — SHIPPED)

Both are sub-routes of `api/intake.js` (repo rule: no new top-level `api/*.js`),
handler `api/_handlers/move-queue.js`, mounted in `server.js`.

### `GET /api/move-queue-worklist?limit=25`

Auth: `X-LCC-Key` (or a signed-in operator). Flag-gated — returns
`{ ok:true, skipped:'flag_off' }` until `MOVE_QUEUE_EXECUTOR=true`; `?force=1`
gives a dry-run read without flipping the flag.

```jsonc
{ "ok": true, "count": 25, "limit": 25,
  "rows": [{
    "internet_message_id": "<AS8P...@namprd10.prod.outlook.com>",
    "graph_rest_id": "AAMkAG...",           // fallback lookup key
    "outcome": "staged",                     // staged | filed | duplicate
    "target_folder": "Intake Staged, Not Completed",
    "final_target_folder": "Processed/Deals",// where Flow 6 / the mirror files it later
    "subject": "...", "channel": "om", "domain": "dia",
    "created_at": "2026-07-21T14:02:11Z",
    "move_attempts": 0,
    "clear_flag": false                      // staged keeps the flag; filed/duplicate clear it
  }]
}
```

The view `v_lcc_move_queue_worklist` is **actionable-only**: it publishes a row
only if a mover can act on it right now — it has a move key and a destination,
is not parked, and is outside the 1-hour retry backoff. FIFO by `created_at`.

### `POST /api/move-queue-ack`

Single ack, or a batch via `{ "items": [...] }` so one "Apply to each" reports
the whole batch in one call.

```jsonc
{ "items": [
  { "internet_message_id": "<a@b>", "moved": true,  "target_folder": "Intake Staged, Not Completed" },
  { "internet_message_id": "<c@d>", "moved": false, "error": "ErrorItemNotFound" }
]}
```

Response carries **honest counts** — note `moves_performed` is the real
move-delta and deliberately excludes `already_out`:

```jsonc
{ "ok": true, "acked": 2, "moves_performed": 1,
  "counts": { "moved":1, "already_out":1, "retrying":0, "parked":0, "already_done":0, "failed_ack":0 },
  "results": [ /* per-item RPC verdicts */ ] }
```

## Error semantics — reused from P119, never reinvented

Send the mover's error text **verbatim**. LCC does not classify it in JS; the
single owner of that decision is the SQL function
`lcc_mailbox_mirror_error_is_terminal()` (a JS copy would be the normaliser
drift this codebase keeps getting bitten by, and a test asserts there isn't one).

| mover reports | meaning | LCC does |
|---|---|---|
| `moved: true` | relocated | `move_status='moved'`, `move_outcome='moved'` |
| **MESSAGE** not found / not in source folder (`ErrorItemNotFound`, `not_found_or_not_in_source_folder`) | the desired end state is **already true** | **terminal SUCCESS on the FIRST ack** — `move_outcome='already_out'`. No retry, no park, no alert; any open park alert is resolved |
| **DESTINATION** folder missing (`ErrorFolderNotFound`, stale folder id) | a **real break** | retry (1h backoff) → park after 5 → deduped `move_queue_parked` health alert |
| anything else | transient | same bounded retry → park → alert |

"X not found" is two different facts. Never collapse them into one predicate.

## Reading the numbers (Consumption-Layer)

`move_status='moved'` covers BOTH "we relocated it" and "it was already gone".
**Never quote it as a count of moves performed.** Read `move_outcome`:

```sql
select move_outcome, count(*) from processing_log where move_outcome is not null group by 1;
-- 'moved'       = the real move-delta
-- 'already_out' = terminal no-op (it had already left)
-- 'failed'      = genuinely stuck (move_parked = true)
```

Genuinely-stuck backlog: `select * from lcc_health_alerts where
alert_kind='move_queue_parked' and resolved_at is null;`
Auto-retire sweep: `select lcc_move_queue_retire_cleared_parks(false);`
(dry-run default; `alerts_left_open` is the honest stuck count).

## The Power Automate flow

**Trigger:** Recurrence, every 15 minutes.

1. **HTTP — GET** `https://<lcc-host>/api/move-queue-worklist?limit=25`
   Header `X-LCC-Key: @{...}`. Parse JSON with the schema above.
2. **Condition** — `body('Parse')?['skipped']` is empty (the flag is on) AND
   `count` > 0. Otherwise terminate as Succeeded (a quiet run is not a failure).
3. **Apply to each** `rows`, **concurrency 1** (Graph throttling; and FIFO is the
   point). Inside:
   a. **Initialize/compose** `folderId` — map `target_folder` to the Graph mail
      folder id. Resolve the well-known ones ONCE outside the loop (an
      "Intake Staged, Not Completed" / `Processed/*` lookup per message is what
      produces `ErrorFolderNotFound` storms when a folder is renamed).
   b. **Find the message** — Graph `GET /me/messages?$filter=internetMessageId eq '<id>'&$select=id&$top=1`.
      Prefer this over the stored `graph_rest_id`: a REST id changes on move, an
      internet_message_id does not. Fall back to `graph_rest_id` when the filter
      returns nothing.
      - **Zero results ⇒ do NOT fail.** Ack `moved:false` with
        `error: "ErrorItemNotFound"` — LCC records that as terminal success.
   c. **Move email (V2)** / Graph `POST /me/messages/{id}/move` with
      `{"destinationId": "<folderId>"}`.
   d. **Clear the flag — only when `clear_flag` is true.** Graph
      `PATCH /me/messages/{id}` with
      `{"flag":{"flagStatus":"complete"}}`. A `staged` message KEEPS its flag
      (the work is still outstanding, so the native Flagged-email To Do stays
      open until Flow 6 files it).
   e. **Append to an array variable** `acks`:
      `{ internet_message_id, moved: true, target_folder }` on success;
      on failure `{ internet_message_id, moved: false, error: <the Graph error
      code/message, verbatim> }`.
   f. **Configure run after** on the move action so a failure routes to the
      failure-ack append rather than aborting the loop.
4. **HTTP — POST** `https://<lcc-host>/api/move-queue-ack` with
   `{ "items": @{variables('acks')} }` and the `X-LCC-Key` header.
5. **(optional) Terminate** with the response's `moves_performed` in the run
   title so the run history shows real moves, not rows processed.

**Never delete a message.** Move only. Deletion is the Weekly Retention Sweep's
job, and only from `Processed/Duplicates` after 30 days.

## Rollout

1. Migration `20260820140000_lcc_p120_move_queue_executor.sql` — **applied live**
   to LCC Opps (`xengecqvemvfknjvbvrq`). Live immediately.
2. Ship the JS on the **Railway redeploy of merged `main`**, then run the deploy
   gate: `npm run verify:deploy`. The two new sub-routes must return JSON, not
   the SPA HTML.
3. Dry-run read (no flag flip):
   `GET /api/move-queue-worklist?force=1&limit=5` — expect 5 rows.
4. Build the PA flow; point it at the two endpoints.
5. **Flip the flag:** set `MOVE_QUEUE_EXECUTOR=true` in the Railway env and
   update the `feature_flags_registry` row to `state='on'`.
6. Watch the first run: the backlog drains oldest-first at 25/run × 4 runs/hr.
   Verify by **state delta**, not the run's own tally:
   ```sql
   select move_outcome, count(*) from processing_log where move_outcome is not null group by 1;
   select count(*) from v_lcc_move_queue_worklist;   -- should fall
   ```
7. Then confirm the end-to-end loop: a fresh intake email lands in "Intake
   Staged, Not Completed" with `move_outcome='moved'`; completing its To Do
   moves it to `Processed/*`.

## ✅ Known ordering hazard downstream — RESOLVED by P121 (2026-08-20)

Once staging was populated, **two things reacted to a completed To Do**, and both
keyed on the same transient `processing_log.outcome='staged'`:

- **Flow 6** (`todo-completion-poll`) flipped `staged → filed` and stamped
  `move_status='moved'` — but it only *records*; it performs no Graph move.
- **The W7.6 mirror** actually performs the staging → `Processed/*` move, and its
  worklist was gated on `outcome='staged'`.

If Flow 6 won the race the row stopped being `staged`, the mirror's worklist
dropped it, and the message sat in staging forever while the DB read
`filed`/`moved`. **P121 closes it** — migration
`20260820160000_lcc_p121_staging_processed_single_owner.sql`, applied live:

1. **`processing_log.staged_at`** — the durable placement anchor, stamped by
   `lcc_move_queue_ack` on a genuine move into `lcc_staging_folder_name()`, and
   never by an `already_out` ack (that proves the message left the Inbox, not that
   it reached staging). The mirror's worklist anchors on it, so an `outcome` flip
   can no longer drop a message that is still in staging.
2. **Flow 6 stops asserting a move.** It routes through
   `rpc/lcc_todo_completion_mark_filed`, which flips the outcome + stamps
   `todo_completed_at` and never touches `move_status` / `moved_at` /
   `move_outcome`. Three dispositions: `mirror_owns_move` (already in staging — the
   mirror moves it), `retargeted_to_final` (never staged and still queued — the row's
   `target_folder` is retargeted to `final_target_folder` so THIS executor delivers
   it straight to Processed, keeping one owner for Inbox → \*), and
   `no_move_state_change`.
3. **A stale ledger verdict no longer excludes.** An ack recorded before the current
   `staged_at` describes a prior state of the mailbox.
4. **A `todo_completed` closure arm on the mirror worklist** — mandatory, because the
   native-Flagged-email model creates no `action_items` (0 of 103 staged messages
   have any), so `todos_done` can never fire for this population and a completed
   To Do would otherwise flip the row to `filed` with nothing publishing the move.

**Both interleavings are safe by construction.** If this executor is mid-flight when
Flow 6 retargets, an ack naming the staging destination still stamps `staged_at`, so
the mirror picks the message up on that arm; an ack naming the retargeted destination
means the message went straight to `Processed/*` and the mirror correctly never
publishes it. Proven by self-rolling-back synthetic gates (A/B/C, 0 residue).

Measured live at the fix: 81 messages in staging, **61 of them already invisible to
the mirror** (pre-placement `parked` verdicts from 2026-08-07..09); mirror worklist
**0 → 61**; stranded detector `v_lcc_mailbox_mirror_stranded` **61 → 0** after the
re-enqueue sweep, with 25 already moved out by the live mirror within the hour.

**Remaining operator step:** the Flow 6 PA flow still has its own Move + Flag-clear
actions. LCC now publishes `move:false` / `clear_flag:false` / a `contract` note on
that worklist, but cannot stop a PA action it does not own. Until that edit lands the
two movers race **benignly** — the loser acks `ErrorItemNotFound` → `already_out` →
terminal success. A redundant Graph call, not a stranded message.
