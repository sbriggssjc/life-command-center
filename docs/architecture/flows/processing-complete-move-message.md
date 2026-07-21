# Flow 1 — Processing Complete → Move Message (LOAD-BEARING)

Last updated: 2026-07-21
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
- **To Do completion (native "Flagged email" model, 2026-07-21):** the relay
  forwards **no** To Do fields. The flagged message's task is Outlook's OWN native
  "Flagged email" task, so **clearing the flag completes it** — there is no custom
  task to complete inline and no `todo_task_map` lookup (both retired; see "To Do
  task completion" below). `clear_flag` is the single lever: a terminal
  (filed/duplicate) move clears the flag → the native task auto-completes; a
  `staged` move keeps the flag → the native task stays open until Flow 6 files it.
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
| `category` | Optional (prompt 2's classification tag: `news` / `reference` / `fyi` / `deals` / `leads` / `general` / `infra` / `needs_review` / …). Forwarded as audit metadata only — it no longer drives any To Do gate (native task completion rides `clear_flag`). | `"news"` |
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
6. **No separate To Do step — the flag-clear IS the completion.** The flagged
   message's task is Outlook's native "Flagged email" task, so **clearing the flag
   in step 5 completes it** (Microsoft's flag-sync). There is no `Update a to-do`
   action here anymore, and the relay forwards no task ids. A `staged` move keeps
   the flag (`clear_flag:false`) → the native task stays open until Flow 6 files it
   on completion; a terminal (filed/duplicate) move clears the flag → the native
   task auto-completes. See "To Do task completion" below.
7. **Respond** — HTTP 200 `{ ok: true, correlation_id, moved: true,
   internet_message_id, target_folder }`. On the no-message path respond
   `{ ok: true, moved: false, reason: "message_not_found" }` (a benign no-op —
   prompt 2 treats `moved:false` as already-handled, not an error).
8. **Fault branch** — a `Move email` failure / timeout (Configure run after → has
   failed / has timed out) posts to the shared dead-letter (Teams alert) with the
   `correlation_id`, and responds HTTP 502 `{ ok: false, ... }` so prompt 2 can
   retry.

## To Do task completion — native "Flagged email" model (2026-07-21)

Filing the email and completing the underlying To Do are **two different things** —
but with the native model the mechanism is simply the flag. Outlook auto-creates
one task in the system **"Flagged email"** To Do list for every flagged message,
and **clearing the flag completes that task** (Microsoft's flag-sync). So there is
NO custom task, NO mapping, and NO category gate — `clear_flag` (step 5) alone
drives completion:

- **Terminal (`filed` / `duplicate`)** — the move clears the flag (`clear_flag:true`)
  → the native task auto-completes. Filing IS the whole job.
- **`staged`** — the move keeps the flag (`clear_flag:false`) → the native task
  stays open. Intake is step one; a human deliverable follows. It is completed later
  by Scott (in the "Flagged email" list) and filed by the **To Do Completion Poll**
  (Flow 6, `todo-completion-poll.md`), which clears the flag on that file.
- **`needs_review`** — stays in the Inbox, still flagged, never staged/filed here.

### Retired (removed 2026-07-21)
The old "Option A" wired a **custom** Flag → To Do task + an LCC mapping so the
move-relay could complete that custom task inline. All of it is gone:

- The custom **Flag → To Do** PA flow (creates a task + POSTs its ids) — **removed
  in the designer.** It caused duplicate-task creation and pointed at a custom list
  Scott didn't work; Outlook's native flag-to-task sync replaces it.
- `/api/webhooks/todo-task-created` + `handleTodoTaskCreated` (the mapping
  receiver) + its `server.js` route — removed.
- `resolveTodoCompletion` (the move-relay's `todo_task_map` lookup + category gate)
  and `api/_shared/todo-complete-gate.js` — removed. The relay forwards no
  `complete_todo` / `todo_task_id` / `todo_list_id`.
- `public.todo_task_map` — kept but deprecated (migration
  `20260721120000_lcc_todo_task_map_deprecate.sql`; no live writer/reader). The
  original create migration `20260720120000_lcc_todo_task_map.sql` remains for
  reversibility.

**Do not re-introduce a custom-task-creation step or a completion gate** — the flag
is the single lever, and the native list is the source of truth for completion.

## Observability controls (all apply)

| Control | How |
|---|---|
| correlation_id | Echoed from the payload; on every AuditLog + the response. |
| schema_version + Request-Body Schema with `required` | Trigger schema above; a missing required field fails the trigger fast. |
| Exponential 4×PT10S retry | On the `Move email (V2)` action. |
| Dead-letter / fault branch | Step 7 (run-after has-failed/has-timed-out). |
| Flag-clear on success only | Step 5 runs after Move succeeds (off the Move output `Id`); a flag-clear hiccup never fails the move. |
| To Do completion via flag-clear | No separate To Do action — clearing the flag (step 5) completes the native "Flagged email" task. A `staged` move keeps the flag, so the native task stays open until Flow 6 files it. |
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
5. **Native To Do completion via flag-clear:** flag a test mail (Outlook creates a
   native "Flagged email" task). Hit `/api/webhooks/processing-complete` for that
   message with a **terminal** outcome (e.g. `outcome:"auto_filed"`,
   `clear_flag:true`): the mail moves, its **flag clears**, and the native task
   disappears/completes in the "Flagged email" To Do list. Repeat with
   `outcome:"staged"` (`clear_flag:false`): the mail moves to "Intake Staged, Not
   Completed" but **keeps its flag**, and the native task **stays open** — it is
   completed later by Scott and filed by Flow 6 (the To Do Completion Poll).

## Locked "do nots"

- **Never delete here.** This flow only moves. `Processed/Duplicates` is a
  destination, not a deletion — the Weekly Retention Sweep is the only deleter,
  and only after 30 days.
- **No custom To Do task, no mapping.** The custom Flag → To Do flow +
  `/api/webhooks/todo-task-created` + `todo_task_map` are RETIRED. Outlook's native
  "Flagged email" task is the only To Do; do not re-introduce a custom-task-creation
  step or a completion gate.
- **Do not clear the flag before the move.** The flag-clear (step 5) runs only on
  move success, off the Move action's output `Id` — never on a failed move.
  Clearing the flag is what completes the native task, so the same "success only"
  rule protects the To Do state too.
- **Completion rides `clear_flag`, not a category gate.** A terminal
  (`filed`/`duplicate`) move clears the flag → the native task completes; a
  `staged` move keeps the flag → the native task stays open until Flow 6 files it.
  `needs_review` stays in the Inbox (never moved/completed here).
