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

## ⚠️ Prompt-2 prerequisite (verified absent 2026-07-20)

This flow is triggered by `POST /api/webhooks/processing-complete`, which **does
not exist in the repo yet** (grep confirms no `processing-complete` route or
handler). Prompt 2 must ship it — as a **sub-route** (`?_route=` / `?action=`),
not a new `api/*.js` file (the 12-function limit holds; see repo rule #1–4).

Until prompt 2 ships the caller, this flow can be **built and left ON** safely:
with no caller, the HTTP trigger simply never fires. Build it now so the caller
has a live URL to POST to the moment it lands.

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
5. **Respond** — HTTP 200 `{ ok: true, correlation_id, moved: true,
   internet_message_id, target_folder }`. On the no-message path respond
   `{ ok: true, moved: false, reason: "message_not_found" }` (a benign no-op —
   prompt 2 treats `moved:false` as already-handled, not an error).
6. **Fault branch** — a `Move email` failure / timeout (Configure run after → has
   failed / has timed out) posts to the shared dead-letter (Teams alert) with the
   `correlation_id`, and responds HTTP 502 `{ ok: false, ... }` so prompt 2 can
   retry.

## Observability controls (all apply)

| Control | How |
|---|---|
| correlation_id | Echoed from the payload; on every AuditLog + the response. |
| schema_version + Request-Body Schema with `required` | Trigger schema above; a missing required field fails the trigger fast. |
| Exponential 4×PT10S retry | On the `Move email (V2)` action. |
| Dead-letter / fault branch | Step 6 (run-after has-failed/has-timed-out). |
| Logical-failure detection | The no-message path responds `moved:false`, and prompt 2 must treat a 200-with-`moved:false` as "not moved," not success — the same "200 ≠ ok" lesson that auto-disabled HTTP Init LLC for 14 days. |
| Null-safe accessors | Step 2 checks the 0-results case before indexing `[0]`. |

## Verify after build

1. In the designer, **Test → Manually**, POST a body with a real
   `internet_message_id` from a test mail sitting in the Inbox and
   `target_folder:"Processed/OM"`. Confirm the mail moves and the response is
   `{ ok:true, moved:true }`.
2. POST a bogus `internet_message_id` → response `{ ok:true, moved:false,
   reason:"message_not_found" }`, no error, no mail touched.
3. POST with `target_folder:"Processed/Duplicates"` → mail moves there (it is
   **not** deleted — deletion is the Weekly Retention Sweep after 30 days).
4. Confirm the flow's POST URL is handed to prompt 2 as the webhook target.

## Locked "do nots"

- **Never delete here.** This flow only moves. `Processed/Duplicates` is a
  destination, not a deletion — the Weekly Retention Sweep is the only deleter,
  and only after 30 days.
- **Do not touch the Flag → To Do flow.** A flagged email can be both moved by
  this flow AND surfaced as a To Do by that one; they are orthogonal.
