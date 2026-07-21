# Flow 1 — Processing Complete → Move Message (LOAD-BEARING)

Last updated: 2026-07-20
Owner: LCC architecture/audit track (Scott Briggs)
Part of: `closing-the-loop-overview.md` (prompt 3 — mailbox mechanics)
Tenant: `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f` (NorthMarq Capital, LLC)
Connector: Office 365 Outlook (Scott's mailbox)

> **Build this flow FIRST.** It is the only piece that actually moves a message.
> Both hygiene flows (Weekly Retention Sweep) and the Daily-Briefing summary line
> depend on the move having happened + being logged. Until this exists, prompts
> 1–2 classify email that never leaves the Inbox.

## Intent

When prompt-2 finishes classifying an email, it calls this flow with the message
identity + the disposition. The flow performs the **single reversible action**
this whole layer is built around: it moves the message from the Inbox to the
right `Processed/*` sub-folder. No delete — ever. (Deletion is the Weekly
Retention Sweep's job, and only from `Processed/Duplicates` after 30 days.)

## LCC relay — `POST /api/webhooks/processing-complete` (SHIPPED 2026-07-20)

The LCC side is now wired. It is a thin **relay**, NOT the mover: LCC receives a
single processing-complete event and POSTs the move instruction to THIS flow's
HTTP-trigger URL; the PA flow does the actual Outlook find + move + flag-clear.

- **Route:** `POST /api/webhooks/processing-complete` → `api/sync.js`
  `?_route=processing-complete` (a **sub-route** — no new `api/*.js`; the
  handler is `handleProcessingComplete`, the outbound helper is
  `api/_shared/pa-move-message.js`). Wired in `server.js` + `vercel.json`.
- **Delivery model — single-event, synchronous, one POST per completed intake.
  NOT batched/queued.** The PA HTTP trigger resolves exactly one
  `internet_message_id` per invocation, so a batch payload would break it. Each
  intake completion fires one relay POST.
- **The PA trigger URL carries a live `sig` credential**, so LCC reads it from the
  **`PA_MOVE_MESSAGE_WEBHOOK_URL` env var — set it in the RAILWAY env** (production
  runs on the Railway Express server; `vercel.json` is legacy). Never hardcoded.
- **Safe no-op until configured:** with `PA_MOVE_MESSAGE_WEBHOOK_URL` unset, the
  relay validates the body and returns **HTTP 503** (`moved:false`) — never a
  false "moved". Once set, no redeploy is needed (read per request).
- **Body the relay sends:** `{ internet_message_id, target_folder, outcome }`
  (`disposition` is mirrored to `outcome` for a flow keyed on either name). It
  also **forwards `correlation_id` / `schema_version` / `subject` when the inbound
  caller supplies them**, so the relay satisfies BOTH this sheet's fuller
  `required` schema and a minimal 3-field flow — build the flow's trigger schema
  to whichever you prefer; the relay is compatible with both.
- **To Do auto-completion fields (Option A, SHIPPED 2026-07-20):** the relay also
  forwards `complete_todo` (boolean) and, ONLY when `complete_todo` is true,
  `todo_task_id` + `todo_list_id`. The gate is category-driven (see "To Do task
  completion" below): a **leave-open** category sends `complete_todo:false` and NO
  task id, so the Move flow's conditional completion step never fires and the To
  Do stays open. A message that was never flagged (no mapping) also gets
  `complete_todo:false`. **The task-id lookup is best-effort — a DB miss/error
  resolves to "leave open," never blocking the move.**
- **Outcome-truthful:** the relay reports the PA flow's real status — an HTTP 200
  with the flow's `ok:false`, a 4xx, or a 5xx are all returned as failures
  (`moved:false`, `502`), never a false success. Transient 5xx / network errors
  retry with exponential backoff (2s→4s→8s→16s); a 4xx is permanent (no retry).

### Prompt-2 prerequisite (still outstanding)
The CALLER of `/api/webhooks/processing-complete` — prompt 2's classifier + the
`processing_log` table — **does not exist yet**. Until prompt 2 wires the caller,
this flow + the LCC relay can be **built and left ON** safely: with no caller, the
relay is never invoked and the HTTP trigger never fires.

## Trigger

- Type: **When a HTTP request is received** (Request trigger).
- The flow's generated POST URL is the value prompt 2 uses for
  `PROCESSING_COMPLETE_WEBHOOK_URL` (or equivalent env). Copy it out of the
  designer after first save.
- **Request Body JSON Schema** (drives the observability `required` gate):

```json
{
  "type": "object",
  "required": ["correlation_id", "schema_version", "internet_message_id", "target_folder", "disposition"],
  "properties": {
    "correlation_id":       { "type": "string" },
    "schema_version":       { "type": "string" },
    "internet_message_id":  { "type": "string" },
    "target_folder":        { "type": "string" },
    "disposition":          { "type": "string", "enum": ["auto_filed", "flagged", "duplicate"] },
    "subject":              { "type": "string" }
  }
}
```

## Payload contract (what prompt 2 sends)

| Field | Meaning | Example |
|---|---|---|
| `correlation_id` | GUID minted by prompt 2; echoed in every AuditLog + response so a run can be traced end-to-end. | `"a1b2c3…"` |
| `schema_version` | Payload version. Start `"1.0"`. | `"1.0"` |
| `internet_message_id` | **The move key.** The RFC `Internet-Message-Id` header of the mail (stable, mailbox-independent). Move-by-this, not by the mutable Graph `id`. | `"<CAF…@mail.gmail.com>"` |
| `target_folder` | Path under `Processed/` (see the taxonomy in the overview). The flow resolves/creates it. | `"Processed/OM"`, `"Processed/Duplicates"`, `"Processed/News"` |
| `disposition` | One of `auto_filed` / `flagged` / `duplicate` / `staged`. Written to `processing_log` (prompt 2) so the briefing line can count. Does NOT change the delete rule — a `duplicate` is *moved to* `Processed/Duplicates`, never deleted here; a `staged` email is *moved to* `Intake Staged, Not Completed` (kept flagged). | `"staged"` |
| `clear_flag` | Whether the Move flow should clear the flag after moving. `false` for a `staged` move (still outstanding work — keep the flag); `true` for filed/duplicate (terminal). Relay default (absent) = true, except `staged` ⇒ false. Gates step 5. | `false` |
| `category` | Optional (prompt 2's classification tag: `news` / `reference` / `fyi` / `deals` / `leads` / `general` / `infra` / `needs_review` / …). Drives the To Do auto-completion gate ONLY. Absent ⇒ the To Do is left open (allow-list default). | `"news"` |
| `subject` | Optional, for the audit log only (never used as a match key). | `"OM — 123 Main St"` |

## Action topology

1. **Compose `AuditLog_start`** — `correlation_id`, `schema_version`,
   `disposition`, `internet_message_id`, `utcNow()`. (First-action audit control.)
2. **Find the message** — `Get emails (V3)` (or a Graph message query) filtered by
   `internetMessageId eq <internet_message_id>`, Top 1, scoped to the mailbox.
   Null-safe: if 0 results, skip to the fault branch (message already moved /
   deleted / not yet delivered — a no-op, not a failure).
3. **Resolve the folder** — look up the folder id for `target_folder` under
   `Processed/`; if missing, create it. (Move email V2 needs a folder id/path.)
4. **Move email (V2)** — message id from step 2 → the folder from step 3.
   Retry policy: **Exponential, 4 × PT10S**.
5. **Clear the flag (V2) — on move success AND `clear_flag` true only.** After the
   Move succeeds, IF the relay sent **`clear_flag: true`**, run **Flag email (V2)**
   with **flag status `notFlagged`** to clear the flag on the now-filed message.
   The flag = "ingest this into LCC" (the flagged-email intake trigger); once the
   email is filed, the flag has served its purpose, so leaving it set clutters the
   flag view forever. **The `clear_flag` gate is what makes a `staged` move keep
   its flag:** a staged email moves to "Intake Staged, Not Completed" with
   `clear_flag:false` (it is still outstanding work), so this step is SKIPPED and
   the flag stays — the flag clears only later, when Flow 6 files it on To Do
   completion (with `clear_flag:true`). filed/duplicate send `clear_flag:true`.
   Wrap step 5 in a **Condition** `clear_flag is equal to true`. **Order matters —
   clear AFTER the move, never before:** if you cleared first and the move failed,
   you'd strand an un-flagged, un-filed email (worse than the reverse). **Id-remap
   gotcha:** Move email (V2) returns a NEW folder-specific `Id` for the moved
   message; feed the **Move action's output `Id`** into the Flag step (the
   `internet_message_id` is stable but the Flag connector keys on the item `Id`,
   which changed on the move). A Flag failure is non-fatal — the move already
   succeeded; log + continue (run after → is successful, so a flag-clear hiccup
   never fails the move).
6. **Complete the linked To Do (V3) — on move success only (Option A).** Runs in
   the SAME successful-move branch as the flag-clear (step 5), off the same
   condition. Add a **Condition** `todo_task_id is not empty` (equivalently
   `complete_todo is equal to true` — the relay only sends a task id when the gate
   says complete), and in the True branch run **Update a to-do (V3)** with To-do
   list Id `todo_list_id`, Task Id `todo_task_id`, **Status = `completed`**. When
   the relay leaves those fields empty (a leave-open category, or an email that was
   never flagged), the condition is false and the To Do is left OPEN — filing is
   not always the whole job (see "To Do task completion" below). A To-do update
   failure is non-fatal (log + continue), exactly like the flag-clear.
7. **Respond** — HTTP 200 `{ ok: true, correlation_id, moved: true,
   internet_message_id, target_folder }`. On the no-message path respond
   `{ ok: true, moved: false, reason: "message_not_found" }` (a benign no-op —
   prompt 2 treats `moved:false` as already-handled, not an error).
8. **Fault branch** — a `Move email` failure / timeout (Configure run after → has
   failed / has timed out) posts to the shared dead-letter (Teams alert) with the
   `correlation_id`, and responds HTTP 502 `{ ok: false, ... }` so prompt 2 can
   retry.

## To Do task completion — Option A, SHIPPED 2026-07-20 (Scott-confirmed)

Filing the email and completing the underlying To Do are **two different things**.
Auto-complete the task ONLY where filing genuinely IS the whole job; leave it OPEN
where intake is step one and a human deliverable follows (a BOV, a reply, a lead
follow-up, anything routed to `needs_review`). Both the flag-clear (step 5) and
the To Do completion (step 6) fire off the SAME successful-move condition.

### The link — an LCC mapping table (not an email custom property)
Outlook categories are visible/noisy and the PA connector's extended-property
support is weak; LCC already round-trips every processed email keyed on
`internet_message_id`, so it is the correlation hub. The Flag → To Do flow POSTs
the created task ids to LCC, which stores the mapping; the move-relay reads it.

1. **Flag → To Do flow (the ONLY change to it):** after **Create a to-do (V3)**,
   add one **HTTP** action POSTing to `/api/webhooks/todo-task-created`:
   `{ "internet_message_id": <the flagged message's Internet-Message-Id>,
   "todo_task_id": <Create-a-to-do output Id>, "todo_list_id": <the list Id> }`.
   It still creates the task exactly as today; this only records which task
   belongs to which email. (A flagged email can be BOTH moved by this flow AND
   surfaced as a To Do by that one — orthogonal until this mapping links them.)
2. **LCC mapping store + receiver (SHIPPED, no new `api/*.js`):**
   `POST /api/webhooks/todo-task-created` → `api/sync.js` `?_route=todo-task-created`
   (`handleTodoTaskCreated`) upserts `public.todo_task_map`
   (`internet_message_id → {todo_task_id, todo_list_id}`, unique on
   `internet_message_id` — a re-flag/re-POST relinks, never duplicates). Migration
   `20260720120000_lcc_todo_task_map.sql` (LCC Opps, additive; drop the table →
   zero trace). Auth mirrors the other webhooks (`X-PA-Webhook-Secret` OR an
   authenticated user; transitional-open when the secret is unset).
3. **The move-relay looks it up + gates it** (`handleProcessingComplete`,
   `resolveTodoCompletion`): it computes `complete_todo` from the category gate,
   and only when the gate says complete does it look up the task id and forward
   `todo_task_id` + `todo_list_id` (+ `complete_todo:true`) to the Move flow.
4. **The Move flow completes the task** — step 6 above (conditional on the task id
   being present), in the same successful-move branch as the flag-clear.

### The category gate (the tunable knob — `api/_shared/todo-complete-gate.js`)
`shouldAutoCompleteTodo(outcome, category)`. `AUTO_COMPLETE_CATEGORIES` is the
single confirmable constant:

| Category | On a filed email | Why |
|---|---|---|
| `news` / `reference` / `fyi` | ✅ **auto-complete** | No human deliverable — filing closes it. |
| `duplicate` (disposition) | ✅ **auto-complete** | A dedup has nothing to work (matched via the outcome, not a category). |
| `deals` / `leads` | ❌ **leave open** | Intake is step one — a BOV / follow-up follows. |
| `general` / `infra` | ❌ **leave open** | Catch-all + infra alerts stay open until each is trusted (flip in the constant when they move off `needs_review`). |
| `needs_review` | ❌ **NEVER** (hard guard) | Explicitly still open. |
| unknown / absent | ❌ **leave open** | Allow-list default — a new prompt-2 category never silently auto-completes. |

Gate: auto-complete iff (a) a `duplicate` disposition, OR (b) `outcome ∈
{filed, auto_filed}` AND `category ∈ AUTO_COMPLETE_CATEGORIES`; `needs_review`
and a bare `flagged` disposition never complete. The category is prompt 2's
conceptual set (not a live enum yet), so until prompt 2 sends `category` the gate
returns false for every filed email ⇒ the To Do is left open (inert, safe). To
change the policy, edit `AUTO_COMPLETE_CATEGORIES` — nothing else.

## Observability controls (all apply)

| Control | How |
|---|---|
| correlation_id | Echoed from the payload; on every AuditLog + the response. |
| schema_version + Request-Body Schema with `required` | Trigger schema above; a missing required field fails the trigger fast. |
| Exponential 4×PT10S retry | On the `Move email (V2)` action. |
| Dead-letter / fault branch | Step 7 (run-after has-failed/has-timed-out). |
| Flag-clear on success only | Step 5 runs after Move succeeds (off the Move output `Id`); a flag-clear hiccup never fails the move. |
| To Do completion on success + gate | Step 6 runs in the same successful-move branch, conditional on `todo_task_id` being present (the relay only sends it when the category gate says complete). A To-do-update hiccup never fails the move; a leave-open category / unmapped email leaves the To Do open. |
| Logical-failure detection | The no-message path responds `moved:false`, and prompt 2 must treat a 200-with-`moved:false` as "not moved," not success — the same "200 ≠ ok" lesson that auto-disabled HTTP Init LLC for 14 days. |
| Null-safe accessors | Step 2 checks the 0-results case before indexing `[0]`. |

## Verify after build

1. In the designer, **Test → Manually**, POST a body with a real
   `internet_message_id` from a **flagged** test mail sitting in the Inbox and
   `target_folder:"Processed/OM"`. Confirm the mail moves, **its flag is cleared**
   (no flag icon in `Processed/OM`), and the response is `{ ok:true, moved:true }`.
2. POST a bogus `internet_message_id` → response `{ ok:true, moved:false,
   reason:"message_not_found" }`, no error, no mail touched.
3. POST with `target_folder:"Processed/Duplicates"` → mail moves there (it is
   **not** deleted — deletion is the Weekly Retention Sweep after 30 days).
4. Confirm the flow's POST URL is handed to prompt 2 as the webhook target.
5. **To Do completion (Option A):** flag a test mail, let the Flag → To Do flow
   create a task and POST the ids to `/api/webhooks/todo-task-created`. Then hit
   `/api/webhooks/processing-complete` for that message with a **terminal**
   category (e.g. `category:"news"`, `outcome:"auto_filed"`): the LCC response
   shows `complete_todo:true` + the `todo_task_id`, and the Move flow marks the To
   Do **completed**. Repeat with a **leave-open** category (e.g. `deals`) or
   `needs_review`: response `complete_todo:false`, no task id, the To Do stays
   **open**. An unflagged message (no mapping) also returns `complete_todo:false`.

## Locked "do nots"

- **Never delete here.** This flow only moves. `Processed/Duplicates` is a
  destination, not a deletion — the Weekly Retention Sweep is the only deleter,
  and only after 30 days.
- **The ONLY change to the Flag → To Do flow is the new HTTP step** POSTing the
  created task's ids to `/api/webhooks/todo-task-created` (it still creates the
  task exactly as today). A flagged email can be both moved by this flow AND
  surfaced as a To Do by that one; the mapping links them.
- **Do not clear the flag before the move.** The flag-clear (step 5) runs only on
  move success, off the Move action's output `Id` — never on a failed move. The
  To Do completion (step 6) rides the same successful-move branch.
- **Do not blanket-complete every filed email's To Do.** Filing ≠ done. Only the
  terminal categories auto-complete (`news`/`reference`/`fyi`/`duplicate`);
  `needs_review` NEVER completes; unknown categories leave the To Do open. The
  policy is one constant — `AUTO_COMPLETE_CATEGORIES` in
  `api/_shared/todo-complete-gate.js`.
