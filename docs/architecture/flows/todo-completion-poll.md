# Flow 6 — LCC To Do Completion Poll (staged → Processed), native "Flagged email" list

Last updated: 2026-07-21
Owner: LCC architecture/audit track (Scott Briggs)
Part of: `closing-the-loop-overview.md` (prompt 3 — mailbox mechanics)
Tenant: `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f` (NorthMarq Capital, LLC)
Connectors: Office 365 Outlook + **Microsoft To-Do (Business)** — the connector's
**"List to-do's by folder (V2)"** action DOES expose `linkedResources`
(`displayName`/`externalId`/`webUrl`), so **no raw Graph / HTTP-with-Entra-ID step
is needed** (confirmed by probe 2026-07-21).

> **Build this AFTER Flow 1 (Processing Complete → Move Message).** Flow 6 reuses
> Flow 1's mailbox mechanics (Move email V2 + Flag email V2) — it just drives them
> from a scheduled trigger. Flow 6 files a **staged** email once its native
> "Flagged email" To Do task is completed.

## What changed (2026-07-21) — track the NATIVE "Flagged email" list, no custom task

The old design had a separate **Flag → To Do** PA flow *create* a custom To Do
task and POST its ids to LCC (`/api/webhooks/todo-task-created` → `todo_task_map`),
and this poll joined the staged email to that mapping. Two problems killed it:

1. **Duplicate creation.** Every re-flag / re-process created a NEW custom task
   with no dedup — the "Business Development" list accumulated hundreds of tasks
   with 10+ exact duplicates of a single subject.
2. **Wrong list.** Outlook auto-generates its OWN native **"Flagged email"** To Do
   list whenever *any* email is flagged — completely independent of the custom
   flow. **Scott completes tasks THERE**, not in the custom list, so the mapping
   pointed at a task he never touched (and PA's `Get a to-do` 404'd when that
   custom task was cleaned up separately).

**New model: stop creating custom tasks. Track the native "Flagged email" list.**
Outlook creates exactly one native task per flagged message — no dedup logic
needed on our side. LCC no longer creates a task, no longer receives its ids, and
no longer stores a mapping. This poll returns the staged emails; **PA queries the
native "Flagged email" list itself and matches each completed task back to a
staged email.**

Retired (removed from the code): `/api/webhooks/todo-task-created` +
`handleTodoTaskCreated`, the move-relay's `resolveTodoCompletion` +
`todo-complete-gate.js`, and the poll's `todo_task_map` join. The
`public.todo_task_map` table is kept but marked deprecated (migration
`20260721120000_lcc_todo_task_map_deprecate.sql`) — no live writer/reader.
**The custom "Flag → To Do" PA flow itself is removed by Scott in the designer.**

## Intent — why a poll, and why PA (not LCC) checks completion

Microsoft To Do exposes no "task completed" trigger, so completion must be
DISCOVERED by polling. And **LCC cannot call the To-Do/Graph API directly** —
Northmarq IT blocks Azure AD app registrations, so there is no Graph service
token (this is why the whole system runs on Power Automate connectors). So the
To-Do/Graph calls live **inside Power Automate**, whose Microsoft To-Do
(Business) connection is already OAuth-authenticated. **LCC only ever does DB
reads/writes — no Graph, no token, anywhere.**

A finished-intake email gets a THIRD state, `staged`: it is moved to a single
**"Intake Staged, Not Completed"** folder and **kept flagged** — outstanding
work, not filed. Its native "Flagged email" task stays open. The flag clears + it
reaches its `Processed/{category}` folder only once **Scott completes that native
task** (or clears the flag, which completes it). This flow runs on a schedule,
asks LCC "which staged emails are awaiting completion?", finds each one's native
task **in PA**, and files the completed ones.

## ✅ CONFIRMED — the match strategy (probe run 2026-07-21, signed in as Scott)

Scott probed a REAL flagged task via the native **"List to-do's by folder (V2)"**
connector action. Findings, and the resulting decision:

- **The "Flagged email" list id:**
  `AAMkADI4MzMxOTI5LTEyM2ItNGQ2MC1iNzMzLThiZThjMzVlZTY4YwAuAAAAAABBxdqkZqf0RIdzC4BjZ3blAQCnShL4q_KHTb2FkYRCIsjjAAC56pC5AAA=`.
  Still **resolve it each run** via `wellknownListName eq 'flaggedEmails'` (below)
  — don't hardcode; it can differ per environment/account. This value is only a
  reference for what a resolved id looks like.
- **The connector exposes `linkedResources`** (`displayName` / `externalId` /
  `webUrl`) on "List to-do's by folder (V2)" — **no raw Graph / HTTP-with-Entra-ID
  step is needed.** (This corrects the earlier assumption that the connector hides
  it and a raw Graph call was required.)
- **`externalId` is an OWA ItemID (`AAk…` format), NOT the `internetMessageId`**
  we store. There is no clean translation, AND the OWA ItemID **drifts when the
  email moves** (a moved message gets a new store id), so `externalId` is
  available-but-not-usable for matching a completed task back to a staged email.
- **`linkedResources[0].displayName` EXACTLY mirrors the email subject line**
  (confirmed on both sample tasks pulled). The subject is **move-independent** — it
  survives the move to the staging folder — so it is the SOUNDER match key here.

**DECISION: `displayName` (subject) matching is the PRIMARY path** (not a
fallback), gated by the ambiguity guard below. The LCC `GET` already returns
everything this needs — `subject`, `staged_at`, and `subject_ambiguous` — so **no
LCC code change is required.**

> **Honest limitation (accepted):** a `subject_ambiguous` item (≥2 staged emails
> share a normalized subject, or the subject is blank) has NO unique key here —
> `externalId` can't disambiguate it (drifts) and the subject can't identify it —
> so it will **not auto-file**. It stays staged (still flagged, in the folder) and
> is a rare manual case. This is by design; never guess which task/email it is.

## The two LCC endpoints — `GET` + `POST /api/webhooks/todo-completion-poll` (SHIPPED)

Both are pure DB operations on `api/sync.js` `?_route=todo-completion-poll`
(sub-route — no new `api/*.js`; handler `handleTodoCompletionPoll`, pure logic in
`api/_shared/todo-completion.js`). Wired in `server.js`. Auth mirrors the other
webhooks (`X-PA-Webhook-Secret`, or an authenticated user; transitional-open when
the secret is unset). **No `MS_GRAPH_TOKEN` — LCC never calls Graph.**

### `GET` — the worklist (LCC → PA)
Returns the open `staged` emails awaiting completion (`?limit=` default 100 / max
200). A pure DB read — **no todo task ids** (LCC doesn't know, and no longer
creates, the native task):

```json
{ "ok": true, "count": 2, "no_destination": 0,
  "items": [
    { "internet_message_id": "<CAF…@mail>", "subject": "OM — 123 Main St",
      "staged_at": "2026-07-21T14:02:00Z", "subject_ambiguous": false,
      "target_folder": "Processed/Deals", "clear_flag": true },
    { "internet_message_id": "<AAMk…@mail>", "subject": "OM — 123 Main St",
      "staged_at": "2026-07-21T14:05:00Z", "subject_ambiguous": true,
      "target_folder": "Processed/Deals", "clear_flag": true }
  ] }
```

- `subject` — **the PRIMARY match key.** The completed native task's
  `linkedResources[0].displayName` mirrors the email subject exactly (probe
  2026-07-21), and the subject is move-independent (unlike the OWA-ItemID
  `externalId`, which drifts on the move). PA matches a completed task to a staged
  item when `displayName == subject`.
- `internet_message_id` — the stable key PA uses to FIND + move the message once a
  subject match is made (the message query below), and the key it reports back so
  LCC flips the row `staged → filed`. It is NOT derivable from the task
  (`externalId` is an OWA ItemID, no clean translation), so it can't drive the
  match — it drives the move + the report-back.
- `staged_at` — the staging timestamp (`processing_log.created_at`), a collision
  guard: it disambiguates a same-subject NON-staged email PA might also see in the
  completed set (match the completed task whose flag/created time is near
  `staged_at`, ± a small window). LCC can't see non-staged emails, so PA applies
  this proximity check.
- `subject_ambiguous` — `true` when ≥2 staged emails share a (normalized) subject
  OR the subject is blank. **PA must NOT subject-match an `subject_ambiguous`
  item** — the subject can't uniquely identify it and `externalId` can't rescue it
  (drifts), so leave it staged (still flagged) for a manual pass. Never guess.
- `target_folder` — the email's `final_target_folder`, the `Processed/{category}`
  resolved + stored **at staging time** (never re-derived). `clear_flag` is always
  `true` (the email is being filed → clearing the flag also completes the native
  task, closing the loop).
- Only ACTIONABLE items are returned: a staged email with no resolved destination
  is excluded (surfaced only as a `no_destination` count).

### `POST` — the report-back (PA → LCC)
After PA moves + flag-clears the emails whose native tasks it found completed, it
POSTs their ids back to flip the rows `staged → filed`:

```json
{ "completed": [ { "internet_message_id": "<CAF…@mail>" }, "<AAMk…@mail>" ] }
```

(Accepts objects carrying `internet_message_id` OR bare id strings.) LCC flips
each matching `staged` row → `filed` (`move_status='moved'`, `target_folder =
final_target_folder`, `moved_at`), guarded on `outcome=staged` so a re-report /
concurrent poll flips it at most once (idempotent). Response:

```json
{ "ok": true, "requested": 2, "filed": 2, "not_staged": 0, "filed_keys": ["<CAF…@mail>", "<AAMk…@mail>"] }
```

A reported id with no staged row (already filed / unknown) is `not_staged` — a
benign no-op, never an error. **The email was already moved by PA before this
POST, so the flip is bookkeeping only.** If PA's move failed, PA simply doesn't
report that id → the row stays `staged` (still flagged, still in the folder,
re-offered on the next tick — never lost; the retention sweep never touches the
staging folder).

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
4. **Resolve the native "Flagged email" list id** — once per run, via the
   **Microsoft To-Do (Business)** connector's **"Lists"** action (or, if you keep
   the wellknown filter, `wellknownListName eq 'flaggedEmails'`); take the single
   flaggedEmails list's `id`. Discover it — never hardcode a per-environment id.
5. **List the native COMPLETED tasks** — the **"List to-do's by folder (V2)"**
   connector action on that list, **expanding `linkedResources`** (it does surface
   them — probe 2026-07-21), filtered to `status eq 'completed'`. Each returned
   task carries `linkedResources[0].displayName` (== the email subject) — the match
   anchor. No raw Graph call needed.
6. **Initialize `Completed` array** (empty) — collects the ids PA files.
7. **Apply to each worklist `items` item — match it to a completed native task:**
   - **PRIMARY match (subject / displayName), guarded.** Only when
     `item()?['subject_ambiguous']` is **false**: find the completed task whose
     `linkedResources[0].displayName` equals `item()?['subject']` (trim/normalize
     as the worklist does). **Collision guard:** if more than one completed task
     matches the subject, keep only the one whose flag/created time is near
     `item()?['staged_at']` (± a small window); **if that still leaves more than
     one, do NOT act** — leave the item staged (still flagged), never guess.
   - **`externalId` is available but NOT a match key** — it's an OWA ItemID that
     drifts on the move, so it can't be resolved to `internet_message_id`. Do not
     match on it.
   - **On a unique subject match → file the email** (using the item's
     `internet_message_id` to find + move it):
     - **Find the message** — `Get emails (V3)` / Graph message query filtered
       `internetMessageId eq @{item()?['internet_message_id']}`, Top 1. Null-safe:
       0 results ⇒ skip (already moved/deleted).
     - **Resolve/create the folder** for `@{item()?['target_folder']}`.
     - **Move email (V2)** → that folder. Retry: **Exponential, 4 × PT10S**.
     - **Flag email (V2) → `notFlagged`** — `clear_flag:true`, so clear the flag
       (feed the **Move action's output `Id`** into the Flag step — the item `Id`
       changes on the move). Clearing the flag also completes the native task,
       closing the loop. A Flag failure is non-fatal.
     - **Append to `Completed`** — `@{item()?['internet_message_id']}` (only after
       a successful Move, so LCC never marks-filed an email that wasn't moved).
   - **No completed task matches this item (task still open, or ambiguous) ⇒
     skip** — it stays staged and is re-offered next tick.
   - **Do NOT** complete/touch a To Do task directly — the native task completes
     when Scott completes it (that's how it entered the completed set) or when the
     flag clears above. This flow only files the email.
8. **Condition — `length(Completed) > 0`** → **HTTP — POST the report-back** to the
   same LCC endpoint with body `{ "completed": @{variables('Completed')} }` and the
   `X-PA-Webhook-Secret` header. Retry: **Exponential, 4 × PT10S**. (LCC flips those
   rows `staged → filed`.)
9. **Compose `AuditLog_summary`** — worklist `count`, `length(Completed)`, the
   POST's `filed`, + the `correlation_id`. (Optional: post to the shared ops channel.)
10. **Fault branch** — run-after has-failed/has-timed-out on any HTTP call → shared
    Teams alert with the `correlation_id`. A failed poll is a no-op that alerts; the
    staged emails stay staged for the next tick.

## Locked constraints

- **LCC never calls Graph/To-Do.** The native-list lookup + the completion check
  are PA's, on its Microsoft To-Do (Business) OAuth connection. LCC only reads the
  worklist + writes the flip. No `MS_GRAPH_TOKEN`, no app registration, no raw
  Graph step.
- **Discover the list id — never hardcode it.** Resolve it each run via
  `wellknownListName eq 'flaggedEmails'` (it can differ per environment/account).
- **Subject (`displayName`) is the PRIMARY match key — `externalId` is not usable.**
  `linkedResources[0].displayName` mirrors the subject and is move-independent; the
  `externalId` OWA ItemID drifts on the move, so never match on it.
- **Surface ambiguity, never guess.** Subject-match ONLY when the item is not
  `subject_ambiguous` AND (after the `staged_at` proximity guard) it uniquely
  matches ONE completed task. More than one candidate ⇒ leave it staged (never
  clear the wrong task's flag / move the wrong email). A `subject_ambiguous` item
  never auto-files — it is a rare manual case.
- **No custom task, no mapping.** LCC does not create a task and does not store
  `todo_task_id`/`todo_list_id`. Do not re-introduce a custom-task-creation step.
- **Reuse Flow 1's mover — do NOT re-implement move logic.** The Move + Flag steps
  mirror Flow 1 exactly; Flow 6 differs only in trigger (scheduled) + source (the
  worklist + the native-list completion match).
- **Move BEFORE reporting.** Only append an id to `Completed` after a successful
  Move, and only POST the report after the loop — so LCC's `staged → filed` flip
  can never run ahead of the actual move.
- **Never delete.** Flow 6 only MOVES (staging → `Processed/{category}`).
- **The staging folder is out of the retention sweep's scope** — a top-level
  sibling of `Processed/`, so the sweep's `Processed/*` archive branch never
  touches it. A staged email is never archived/deleted by age; it leaves the folder
  ONLY when its native task completes and Flow 6 files it.

## Verify after build

1. **List id resolves:** the "Lists" / `wellknownListName eq 'flaggedEmails'`
   lookup returns the single flaggedEmails list. (Probe 2026-07-21 already
   confirmed the connector exposes `linkedResources.displayName` == the subject —
   no need to re-decide the strategy.)
2. **Seed a staged email:** flag a test mail so intake runs a `staged` category
   (deals / leads / general / infra); confirm it moves to "Intake Staged, Not
   Completed" **and keeps its flag** (Flow 1 with `clear_flag:false`), and that a
   native task appears in the "Flagged email" To Do list. (No custom flow / no
   `/api/webhooks/todo-task-created` POST anymore.)
3. **GET the worklist:** `GET /api/webhooks/todo-completion-poll` → the item
   appears with `internet_message_id`, `subject`, `staged_at`, `subject_ambiguous`,
   `target_folder`. **No** `todo_task_id`/`todo_list_id`. `processing_log` is
   unchanged (GET never mutates).
4. **Task still open:** run the flow → the native task is not in the `completed`
   set, nothing matches, nothing moves, nothing reported.
5. **Complete the native task** in Microsoft To Do (the "Flagged email" list), run
   the flow → PA matches it to the worklist item by subject
   (`linkedResources[0].displayName == subject`), moves the email to its
   `Processed/{category}` folder, clears the flag, POSTs the `internet_message_id`
   back, and the `processing_log` row flips `staged → filed`
   (`move_status='moved'`). A second run returns `count` one lower (idempotent).
6. **Ambiguity guard:** stage two emails with the same subject → both show
   `subject_ambiguous:true`; confirm PA does NOT subject-match them (they stay
   staged, still flagged — the accepted rare manual case). Never file/clear the
   wrong one.
7. **Report-back idempotency:** `POST { "completed": ["<that-imid>"] }` again →
   `filed:0, not_staged:1` (already filed — a clean no-op).
