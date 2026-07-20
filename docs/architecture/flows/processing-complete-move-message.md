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
| `disposition` | One of `auto_filed` / `flagged` / `duplicate`. Written to `processing_log` (prompt 2) so the briefing line can count. Does NOT change the delete rule — a `duplicate` is *moved to* `Processed/Duplicates`, never deleted here. | `"auto_filed"` |
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
5. **Clear the flag (V2) — on move success only.** After the Move succeeds, run
   **Flag email (V2)** with **flag status `notFlagged`** to clear the flag on the
   now-filed message. The flag = "ingest this into LCC" (the flagged-email intake
   trigger); once the email is filed, the flag has served its purpose, so leaving
   it set clutters the flag view forever. **Order matters — clear AFTER the move,
   never before:** if you cleared first and the move failed, you'd strand an
   un-flagged, un-filed email (worse than the reverse). **Id-remap gotcha:** Move
   email (V2) returns a NEW folder-specific `Id` for the moved message; feed the
   **Move action's output `Id`** into the Flag step (the `internet_message_id` is
   stable but the Flag connector keys on the item `Id`, which changed on the move).
   A Flag failure is non-fatal — the move already succeeded; log + continue (run
   after → is successful, so a flag-clear hiccup never fails the move).
6. **Respond** — HTTP 200 `{ ok: true, correlation_id, moved: true,
   internet_message_id, target_folder }`. On the no-message path respond
   `{ ok: true, moved: false, reason: "message_not_found" }` (a benign no-op —
   prompt 2 treats `moved:false` as already-handled, not an error).
7. **Fault branch** — a `Move email` failure / timeout (Configure run after → has
   failed / has timed out) posts to the shared dead-letter (Teams alert) with the
   `correlation_id`, and responds HTTP 502 `{ ok: false, ... }` so prompt 2 can
   retry.

## To Do task completion — DECISION PENDING (Scott, 2026-07-20)

The Flag → To Do flow creates a Microsoft To Do task when Scott flags an email;
this flow files that same email. Nothing links a specific To Do task to the email
that spawned it, so a filed email leaves its To Do task open. Two options:

- **Option A — link + auto-complete.** Flag → To Do writes the created task's id
  back so this flow can mark it complete on file. **Cleanest form is an LCC
  mapping table, NOT an email custom property** (Outlook categories are visible /
  noisy and the PA Outlook connector's extended-property support is weak). LCC is
  already the correlation hub (this webhook round-trips every processed email
  through LCC keyed on `internet_message_id`), so store `internet_message_id →
  {todo_task_id, todo_list_id}` there. Requires: (1) a new step in Flag → To Do
  POSTing the created task ids to a small LCC sub-route; (2) an LCC mapping store
  + receiver (a sub-route, no new `api/*.js`); (3) LCC returns the task id in the
  move-relay payload; (4) a conditional **Update a to-do (V3) → `completed`** step
  here that fires only when a task id is present (non-flagged emails skip it).
- **Option B — don't link; flag-clear is enough.** Treat "flag cleared + email
  filed" (step 5) as the sufficient visible signal, and leave To Do completion a
  MANUAL check-off (done when Scott has actually acted).

**The deciding question is what the To Do MEANS.** If the task is a "process this
email" reminder that *filing* satisfies → A is honest. If it means "a human must
personally act" → auto-completing on file asserts work that wasn't done (violates
the honest-signals doctrine) → B. Recommendation: **ship step 5 (flag-clear) now
regardless** (it's cheap, same-flow, unambiguously correct), and **default to B
until Scott confirms the To Do semantics**; adopt A (mapping-table form) only if
the To Do is really just a filing reminder. Do not build A speculatively.

## Observability controls (all apply)

| Control | How |
|---|---|
| correlation_id | Echoed from the payload; on every AuditLog + the response. |
| schema_version + Request-Body Schema with `required` | Trigger schema above; a missing required field fails the trigger fast. |
| Exponential 4×PT10S retry | On the `Move email (V2)` action. |
| Dead-letter / fault branch | Step 7 (run-after has-failed/has-timed-out). |
| Flag-clear on success only | Step 5 runs after Move succeeds (off the Move output `Id`); a flag-clear hiccup never fails the move. |
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

## Locked "do nots"

- **Never delete here.** This flow only moves. `Processed/Duplicates` is a
  destination, not a deletion — the Weekly Retention Sweep is the only deleter,
  and only after 30 days.
- **Do not touch the Flag → To Do flow** *unless* Scott picks Option A above — in
  which case the ONLY change to it is a new step POSTing the created task's ids to
  LCC (it still creates the task exactly as today). A flagged email can be both
  moved by this flow AND surfaced as a To Do by that one; they are orthogonal
  until (and unless) A links them.
- **Do not clear the flag before the move.** The flag-clear (step 5) runs only on
  move success, off the Move action's output `Id` — never on a failed move.
