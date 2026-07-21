# Flow 6 — LCC To Do Completion Poll (staged → Processed)

Last updated: 2026-08-08
Owner: LCC architecture/audit track (Scott Briggs)
Part of: `closing-the-loop-overview.md` (prompt 3 — mailbox mechanics)
Tenant: `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f` (NorthMarq Capital, LLC)
Connectors: Office 365 Outlook + **Microsoft To-Do (Business)** (Scott's account)

> **Build this AFTER Flow 1 (Processing Complete → Move Message).** Flow 6 reuses
> Flow 1's mailbox mechanics (Move email V2 + Flag email V2) — it just drives them
> from a scheduled trigger. Flow 6 files a **staged** email once its To Do task is
> done.

## Intent — why a poll, and why PA (not LCC) checks completion

Microsoft To Do exposes no "task completed" trigger, so completion must be
DISCOVERED by polling. And **LCC cannot call the To-Do/Graph API directly** —
Northmarq IT blocks Azure AD app registrations, so there is no Graph service
token (this is why the whole system runs on Power Automate connectors, not direct
Graph tokens). So the To-Do calls live **inside Power Automate**, whose Microsoft
To-Do (Business) connection is already OAuth-authenticated. **LCC only ever does
DB reads/writes — no Graph, no token, anywhere.**

The "Defer auto-filing until To Do completion" model gives a finished-intake email
a THIRD state, `staged`: it is moved to a single **"Intake Staged, Not Completed"**
folder and **kept flagged** — outstanding work, not filed. The flag clears + it
reaches its `Processed/{category}` folder only once the linked To Do task is marked
**completed** (by Scott, or by Flow 1's terminal-category auto-complete gate). This
flow runs on a schedule, asks LCC "which staged emails are awaiting completion?",
checks each task's status **in PA**, and files the completed ones.

## The two LCC endpoints — `GET` + `POST /api/webhooks/todo-completion-poll` (SHIPPED)

Both are pure DB operations on `api/sync.js` `?_route=todo-completion-poll`
(sub-route — no new `api/*.js`; handler `handleTodoCompletionPoll`, pure logic in
`api/_shared/todo-completion.js`). Wired in `server.js`. Auth mirrors the other
webhooks (`X-PA-Webhook-Secret`, or an authenticated user; transitional-open when
the secret is unset). **No `MS_GRAPH_TOKEN` — LCC never calls Graph.**

### `GET` — the worklist (LCC → PA)
Returns the open `staged` emails awaiting completion, joined to their To Do task
ids (`?limit=` default 100 / max 200). A pure DB read:

```json
{ "ok": true, "count": 2, "unmapped": 1, "no_destination": 0,
  "items": [
    { "internet_message_id": "<CAF…@mail>", "todo_task_id": "AAMk…", "todo_list_id": "AQMk…",
      "target_folder": "Processed/Deals", "clear_flag": true },
    { "internet_message_id": "<AAMk…@mail>", "todo_task_id": "AAMk…", "todo_list_id": "AQMk…",
      "target_folder": "Processed/Infra", "clear_flag": true }
  ] }
```

- `target_folder` is the email's `final_target_folder` — the `Processed/{category}`
  resolved + stored **at staging time** (never re-derived). `clear_flag` is always
  `true` (the email is being filed).
- Only ACTIONABLE items are returned: a staged email with no To Do mapping
  (`unmapped`) or no resolved destination (`no_destination`) is excluded (surfaced
  only as a count) — PA has nothing to check/file for it; it stays in the folder.

### `POST` — the report-back (PA → LCC)
After PA moves + flag-clears the emails whose tasks it found completed, it POSTs
their ids back to flip the rows `staged → filed`:

```json
{ "completed": [ { "internet_message_id": "<CAF…@mail>" }, "<AAMk…@mail>" ] }
```

(Accepts objects carrying `internet_message_id` OR bare id strings.) LCC flips each
matching `staged` row → `filed` (`move_status='moved'`, `target_folder =
final_target_folder`, `moved_at`), guarded on `outcome=staged` so a re-report /
concurrent poll flips it at most once (idempotent). Response:

```json
{ "ok": true, "requested": 2, "filed": 2, "not_staged": 0, "filed_keys": ["<CAF…@mail>", "<AAMk…@mail>"] }
```

A reported id with no staged row (already filed / unknown) is `not_staged` — a
benign no-op, never an error. **The email was already moved by PA before this POST,
so the flip is bookkeeping only.** If PA's move failed, PA simply doesn't report
that id → the row stays `staged` (still flagged, still in the folder, re-offered on
the next tick — never lost; the retention sweep never touches the staging folder).

## Trigger

- Type: **Recurrence** (scheduled).
- Frequency: **every 30 minutes**. Set the time zone in the Recurrence action.

## Action topology

1. **Compose `AuditLog_start`** — `correlation_id = guid()`, `run_started = utcNow()`.
2. **HTTP — GET the worklist** — `GET` the LCC endpoint
   `/api/webhooks/todo-completion-poll` (its full Railway URL) with the
   `X-PA-Webhook-Secret` header. Retry: **Exponential, 4 × PT10S**. Parse JSON.
3. **Guard — nothing to do:** a **Condition** on `body('worklist')?['count'] > 0`.
   When 0, skip to the summary (the common quiet tick).
4. **Initialize `Completed` array** (empty) — collects the ids PA files.
5. **Apply to each `items` item:**
   - **Microsoft To-Do (Business) → Get a to-do (V3)** with **To-do list Id
     `@{item()?['todo_list_id']}`**, **Task Id `@{item()?['todo_task_id']}`**.
     This uses PA's existing OAuth To-Do connection — no app registration.
     Configure-run-after tolerant: if the Get fails (task deleted), skip this item
     (it will drop off the worklist naturally).
   - **Condition — `status is equal to `completed``** (the Get-task output
     `status` field). Only the True branch acts:
     - **Find the message** — `Get emails (V3)` / Graph message query filtered
       `internetMessageId eq @{item()?['internet_message_id']}`, Top 1. Null-safe:
       0 results ⇒ skip (already moved/deleted).
     - **Resolve/create the folder** for `@{item()?['target_folder']}`.
     - **Move email (V2)** → that folder. Retry: **Exponential, 4 × PT10S**.
     - **Flag email (V2) → `notFlagged`** — the item carries `clear_flag:true`, so
       clear the flag (feed the **Move action's output `Id`** into the Flag step —
       the item `Id` changes on the move). A Flag failure is non-fatal.
     - **Append to `Completed`** — `@{item()?['internet_message_id']}` (only after
       a successful Move, so LCC never marks-filed an email that wasn't moved).
   - **Do NOT** complete/touch the To Do task — it is already `completed` (that is
     the branch condition). This flow only files the email.
6. **Condition — `length(Completed) > 0`** → **HTTP — POST the report-back** to the
   same LCC endpoint with body `{ "completed": @{variables('Completed')} }` and the
   `X-PA-Webhook-Secret` header. Retry: **Exponential, 4 × PT10S**. (LCC flips those
   rows `staged → filed`.)
7. **Compose `AuditLog_summary`** — worklist `count`, `length(Completed)`, the
   POST's `filed`, + the `correlation_id`. (Optional: post to the shared ops channel.)
8. **Fault branch** — run-after has-failed/has-timed-out on either HTTP call → shared
   Teams alert with the `correlation_id`. A failed poll is a no-op that alerts; the
   staged emails stay staged for the next tick.

## Locked constraints

- **LCC never calls Graph/To-Do.** The completion check is PA's **Get a to-do
  (V3)** action on its OAuth connection. LCC only reads the worklist + writes the
  flip. No `MS_GRAPH_TOKEN`, no app registration.
- **Reuse Flow 1's mover — do NOT re-implement move logic.** The Move + Flag steps
  mirror Flow 1 exactly; Flow 6 differs only in trigger (scheduled) + source (the
  worklist + the per-item completion check).
- **Move BEFORE reporting.** Only append an id to `Completed` after a successful
  Move, and only POST the report after the loop — so LCC's `staged → filed` flip
  can never run ahead of the actual move.
- **Never delete.** Flow 6 only MOVES (staging → `Processed/{category}`).
- **The staging folder is out of the retention sweep's scope** — it is a top-level
  sibling of `Processed/`, so the sweep's `Processed/*` archive branch never
  touches it. A staged email is never archived/deleted by age; it leaves the folder
  ONLY when its To Do completes and Flow 6 files it.

## Verify after build

1. **Seed a staged email:** flag a test mail so intake runs a `staged` category
   (deals / leads / general / infra); confirm it moves to "Intake Staged, Not
   Completed" **and keeps its flag** (Flow 1 with `clear_flag:false`), and the Flag
   → To Do flow created a task + POSTed its ids to `/api/webhooks/todo-task-created`.
2. **GET the worklist:** `GET /api/webhooks/todo-completion-poll` → the item appears
   with the right `todo_task_id` / `todo_list_id` / `target_folder`. `processing_log`
   is unchanged (GET never mutates).
3. **Task still open:** run the flow → PA's Get-task returns a non-`completed`
   status, the Condition is false, nothing moves, nothing reported.
4. **Complete the To Do** in Microsoft To Do, run the flow → PA's Get-task returns
   `completed`, the email moves to its `Processed/{category}` folder, the flag is
   cleared, PA POSTs the id back, and the `processing_log` row flips `staged → filed`
   (`move_status='moved'`). A second run returns `count` one lower for it (idempotent).
5. **Report-back idempotency:** `POST { "completed": ["<that-imid>"] }` again →
   `filed:0, not_staged:1` (already filed — a clean no-op).
