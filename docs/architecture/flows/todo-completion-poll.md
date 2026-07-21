# Flow 6 — LCC To Do Completion Poll (staged → Processed)

Last updated: 2026-08-08
Owner: LCC architecture/audit track (Scott Briggs)
Part of: `closing-the-loop-overview.md` (prompt 3 — mailbox mechanics)
Tenant: `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f` (NorthMarq Capital, LLC)
Connector: Office 365 Outlook (Scott's mailbox)

> **Build this AFTER Flow 1 (Processing Complete → Move Message).** Flow 6 reuses
> Flow 1's mailbox mechanics (Move email V2 + Flag email V2) — it just drives them
> from a different trigger. Flow 6 is the piece that files a **staged** email once
> its To Do task is done.

## Intent — why a poll (there is no "task completed" trigger)

Microsoft To Do exposes no "task completed" trigger, so completion must be
DISCOVERED by polling. The "Defer auto-filing until To Do completion" model gives
a finished-intake email a THIRD state, `staged`: it is moved to a single
**"Intake Staged, Not Completed"** folder and **kept flagged** — outstanding work,
not filed. The flag clears + the email reaches its `Processed/{category}` folder
only once the linked To Do task is marked **completed** (by Scott, or by Flow 1's
terminal-category auto-complete gate).

This flow runs on a schedule, asks LCC "which staged emails' To Do tasks are now
done?", and executes the move-and-flag-clear for each.

## LCC endpoint — `GET/POST /api/webhooks/todo-completion-poll` (SHIPPED)

The heavy lifting (read the staged queue, read each task's Graph status, decide
the move) is on the LCC side; the PA flow is a thin **executor** of the returned
instructions.

- **Route:** `/api/webhooks/todo-completion-poll` → `api/sync.js`
  `?_route=todo-completion-poll` (a **sub-route** — no new `api/*.js`; the handler
  is `handleTodoCompletionPoll`, the pure poll logic is
  `api/_shared/todo-completion.js`). Wired in `server.js`.
- **What it does per call:** selects the open `processing_log` rows with
  `outcome='staged'` (oldest first, `?limit=` default 100 / max 200), looks up each
  email's To Do task in `todo_task_map` (by `internet_message_id`), reads that
  task's `status` from Graph (`GET /me/todo/lists/{listId}/tasks/{taskId}`, delegated
  `MS_GRAPH_TOKEN` — the same token `operations.js` uses for To Do), and for the
  tasks that are now `completed` returns a move instruction. As each instruction is
  issued it flips the row `staged → filed` (idempotent, guarded on `outcome=staged`),
  so a completed email is instructed exactly once.
- **`GET` = dry-run** (reads Graph status, returns the would-be instructions,
  **mutates nothing**). **`POST` = live** (flips `staged → filed` as it issues each
  instruction). The scheduled flow uses **POST**.
- **Feature-flagged on `MS_GRAPH_TOKEN`:** without the delegated Graph token the
  endpoint is a clean no-op (`{ok:true, graph_configured:false, count:0,
  instructions:[]}`) so the scheduled flow never dead-letters — the staged emails
  simply stay staged + flagged in the folder.
- **Response body the flow consumes:**

```json
{ "ok": true, "graph_configured": true, "dry_run": false,
  "checked": 12, "completed": 3, "unresolved": 1, "errored": 0, "count": 3,
  "instructions": [
    { "internet_message_id": "<CAF…@mail>", "target_folder": "Processed/Deals", "clear_flag": true },
    { "internet_message_id": "<AAMk…@mail>", "target_folder": "Processed/Infra", "clear_flag": true }
  ] }
```

Each instruction's `target_folder` is the email's `final_target_folder` —
resolved + stored **at staging time** (`targetFolderFor('filed', {channel, domain})`),
never re-derived here. `clear_flag` is always `true` on a completion instruction
(the email is now filed, so the flag is cleared).

### Optimistic-on-issue (the one documented tradeoff)
The row is flipped `staged → filed` the moment the instruction is issued, NOT on a
PA move-report. If the subsequent PA move fails, the email is left in the
"Intake Staged, Not Completed" folder, **still flagged, still visible** — never
lost (and the Weekly Retention Sweep never touches the staging folder). It just
won't be re-instructed automatically; a human can re-file it from the folder. This
keeps the poll simple and idempotent (the flip guard means concurrent polls issue
each instruction at most once).

## Trigger

- Type: **Recurrence** (scheduled).
- Frequency: **every 30 minutes**. Set the time zone in the Recurrence action.
- No inputs — the flow discovers work by calling the LCC endpoint.

## Action topology

1. **Compose `AuditLog_start`** — `correlation_id = guid()`, `run_started = utcNow()`.
2. **HTTP — call the poll** — `POST` to the LCC endpoint
   `/api/webhooks/todo-completion-poll` (its full Railway URL), with the
   `X-PA-Webhook-Secret` header (matches `PA_WEBHOOK_SECRET`, like the other
   webhooks). Retry: **Exponential, 4 × PT10S**. Parse the JSON response.
3. **Guard — nothing to do:** a **Condition** on `body('poll')?['count']` (or
   `length(body('poll')?['instructions'])`) `> 0`. When 0, skip straight to the
   summary (a clean no-op — this is the common tick).
4. **Apply to each `instructions` item** — for each returned instruction, reuse
   Flow 1's move mechanics:
   - **Find the message** — `Get emails (V3)` / Graph message query filtered
     `internetMessageId eq @{item()?['internet_message_id']}`, Top 1. Null-safe:
     0 results ⇒ skip this item (already moved/deleted — a no-op).
   - **Resolve/create the folder** for `@{item()?['target_folder']}`.
   - **Move email (V2)** → that folder. Retry: **Exponential, 4 × PT10S**.
   - **Flag email (V2) → `notFlagged`** — the email is now filed, and every
     completion instruction carries `clear_flag:true`, so clear the flag (feed the
     **Move action's output `Id`** into the Flag step — the item `Id` changes on
     the move; the `internet_message_id` is stable but the Flag connector keys on
     `Id`). A Flag failure is non-fatal (log + continue).
   - **Do NOT** touch the To Do task here — it is already `completed` (that is why
     this instruction exists). This flow only files the email.
5. **Compose `AuditLog_summary`** — the poll's `checked` / `completed` / `count`
   counts + how many moved, plus the `correlation_id`. (Optional: post to the
   shared ops channel.)
6. **Fault branch** — run-after has-failed/has-timed-out on the HTTP call or a Move
   → shared Teams alert with the `correlation_id`. A failed poll is a no-op that
   alerts; the staged emails stay staged for the next tick.

## Locked constraints

- **Reuse Flow 1's mover — do NOT re-implement move logic.** Flow 6 differs only
  in its trigger (scheduled) and its source (the poll's instruction list); the
  Move + Flag steps mirror Flow 1 exactly.
- **Never delete.** Flow 6 only MOVES (staging → `Processed/{category}`). Deletion
  stays the Weekly Retention Sweep's job, and only from `Processed/Duplicates`.
- **The staging folder is out of the retention sweep's scope** — it is a top-level
  sibling of `Processed/`, so the sweep's `Processed/*` archive branch never
  touches it. A staged (outstanding) email is never archived/deleted by age; it
  leaves the staging folder ONLY when its To Do completes and Flow 6 files it.
- **Trust the poll's `clear_flag`.** A completion instruction always carries
  `clear_flag:true` (filed), so the flag is cleared on this move — the OPPOSITE of
  the original staging move (Flow 1, `clear_flag:false`, flag kept).

## Verify after build

1. **Seed a staged email:** flag a test mail so intake runs a `staged` category
   (deals / leads / general / infra); confirm it moves to "Intake Staged, Not
   Completed" **and keeps its flag** (Flow 1 with `clear_flag:false`), and the Flag
   → To Do flow created a task + POSTed its ids to `/api/webhooks/todo-task-created`.
2. **Dry-run the poll (no writes):** `GET /api/webhooks/todo-completion-poll` while
   the task is still open → `count:0` (nothing completed). Mark the To Do
   **completed** in Microsoft To Do, then `GET` again → the instruction appears
   (with the correct `Processed/{category}` `target_folder`), and `processing_log`
   is **unchanged** (still `staged`) because GET is a dry-run.
3. **Live run:** `POST` (or run the flow) → the staged email moves to its
   `Processed/{category}` folder, **the flag is cleared**, and the `processing_log`
   row flips `staged → filed` (`move_status='moved'`). A second POST returns
   `count:0` for it (idempotent — it is no longer staged).
4. **No Graph token:** with `MS_GRAPH_TOKEN` unset, the endpoint returns
   `graph_configured:false, count:0` — the scheduled flow no-ops without erroring.
