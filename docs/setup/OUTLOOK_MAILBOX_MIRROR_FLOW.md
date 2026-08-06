# Power Automate — Outlook Mailbox Mirror (W7.6)

Keeps an Outlook folder mirroring **open LCC work**: a flagged email that created
LCC to-dos sits in **"Intake Staged, Not Complete"**; when its loop closes in LCC
(the follow-up was SENT, the to-do that closes it COMPLETED, or the item was
triaged away), this flow **moves** the message to **"Intake Staged, Processed"**
(+ unflags + marks read). The Not-Complete folder then shows ONLY open work.

**PULL model — LCC never touches the mailbox.** LCC publishes a deterministic
worklist; this flow (the "mover") executes the Graph move and acks each outcome
back. **Move only — never delete.** The LCC side is already built and live:

- `GET /api/mailbox-reconcile-worklist` — up to N (default 25) closed-loop
  messages: `{ internet_message_id, reason, closed_at, deal_entity_id,
  inbox_item_id, subject, attempts }`.
- `POST /api/mailbox-reconcile-ack` — body `{ internet_message_id, moved:
  true|false, reason?, error? }`. On `moved:false` the message re-queues after a
  1-hour backoff and **parks after 5 tries** with a loud `lcc_health_alerts`
  (`mailbox_mirror_parked`) row — never a silent drop.

Both endpoints are **flag-gated** (`MAILBOX_MIRROR`, default off). While off they
return `{ "skipped": "flag_off" }` — build the flow first, then flip the flag.

> **Folder names are placeholders you confirm.** Scott's source folder is "Intake
> Staged, Not Complete" and destination "Intake Staged, Processed" — set the exact
> display names below. You reference the DESTINATION by its **folder id** (found
> once via Graph, step A0).

---

## Why Graph, not "Get emails (V3)" / "Move email"

Same lesson as W7.3 path C and W7.5 (session 36y): the connector actions don't
reliably surface `internetMessageId` and their paging is opaque, and the Outlook
"Move email" action keys on the connector's message id, not the internet message
id. Use **"Send an HTTP request" (Office 365 Outlook)** against **Microsoft
Graph** — resolve the message by `internetMessageId`, then move by its Graph id.

---

## Part A — build the flow (Power Automate)

### A0. One-time — find the destination folder id
Run once (Graph Explorer or a throwaway "Send an HTTP request"):
```
GET https://graph.microsoft.com/v1.0/me/mailFolders?$top=100&$select=id,displayName
```
Find the row whose `displayName` is your **Processed** folder ("Intake Staged,
Processed") and copy its `id`. Store it as a flow **String** variable
`processedFolderId`. (Folder ids are stable per mailbox.)

### A1. Trigger — Recurrence, every 5 minutes

### A2. HTTP — GET the LCC worklist
**HTTP** action:
- **Method:** `GET`
- **URI:** `https://<your-lcc-host>/api/mailbox-reconcile-worklist?limit=25`
- **Headers:**
  - `X-LCC-Key: <LCC_API_KEY>` (the same key the other operator-scoped flows use)
  - `X-LCC-Workspace: <workspace id>` only if the flow serves more than one workspace

### A3. Parse + Apply to each
- **Parse JSON** the response `body`. The rows live under **`rows`** — so the
  **Apply to each** input is `@{body('Parse_JSON')?['rows']}` (the `?['rows']` is
  the 36y foreach pitfall: iterating the raw body yields one bogus pass).
  > If the body is `{ "skipped": "flag_off" }`, `rows` is absent and the loop is
  > empty — that's the flag being off, not an error.

Inside **Apply to each**, work `item()?['internet_message_id']`:

### A4. Graph — resolve the message by internetMessageId
**Send an HTTP request** (Office 365 Outlook):
- **Method:** `GET`
- **URI** (the single-quoted odata literal is the 36y fx pitfall — only the id
  token is an expression; the rest is literal text, and the value is wrapped in
  `'...'`):
  ```
  https://graph.microsoft.com/v1.0/me/messages?$filter=internetMessageId eq '@{items('Apply_to_each')?['internet_message_id']}'&$select=id,parentFolderId&$top=1
  ```
- **Parse JSON** the response; the match is `@{...?['value']?[0]}`.

**Condition — was it found?** `length(body('Resolve')?['value'])` is greater than
`0`.

### A5a. If FOUND — move + unflag + mark read, then ack moved:true
1. **Send an HTTP request** — move:
   - **Method:** `POST`
   - **URI:** `https://graph.microsoft.com/v1.0/me/messages/@{first(body('Resolve')?['value'])?['id']}/move`
   - **Body:** `{ "destinationId": "@{variables('processedFolderId')}" }`
2. **Send an HTTP request** — unflag + mark read (the moved message keeps the same
   Graph id in Graph's response; use it):
   - **Method:** `PATCH`
   - **URI:** `https://graph.microsoft.com/v1.0/me/messages/@{body('Move')?['id']}`
   - **Body:** `{ "flag": { "flagStatus": "complete" }, "isRead": true }`
3. **HTTP** — ack success to LCC:
   - **Method:** `POST` · **URI:** `https://<your-lcc-host>/api/mailbox-reconcile-ack`
   - **Headers:** `X-LCC-Key`, `Content-Type: application/json`
   - **Body:**
     ```json
     {
       "internet_message_id": "@{items('Apply_to_each')?['internet_message_id']}",
       "moved": true,
       "reason": "@{items('Apply_to_each')?['reason']}"
     }
     ```

Use **Configure run after** (or a Scope + failure branch) so that if the move or
PATCH fails, you fall through to the failure ack below with the error text.

### A5b. If NOT FOUND (or move failed) — ack moved:false
- **HTTP** — `POST https://<your-lcc-host>/api/mailbox-reconcile-ack`
  ```json
  {
    "internet_message_id": "@{items('Apply_to_each')?['internet_message_id']}",
    "moved": false,
    "error": "not_found"
  }
  ```
  (Use `"error": "move_failed"` / the Graph error body in the move-failed branch.)
  LCC re-queues the message after 1h and parks it after 5 failures with a health
  alert — so a message that can't be found/moved is never silently lost.

---

## Part B — LCC side (already built)

Nothing to deploy. `GET /api/mailbox-reconcile-worklist` reads the deterministic
view `v_lcc_mailbox_reconcile_worklist`; `POST /api/mailbox-reconcile-ack` calls
`lcc_mailbox_reconcile_ack` (idempotent ledger upsert + retry/backoff/park +
alert). See `supabase/migrations/20260824120000_lcc_w7_6_mailbox_mirror.sql`.

### When is a message "closed" (worklist gate — deterministic, no AI)?
A flagged-email `inbox_item` (with an `internet_message_id`) qualifies when **ANY**
of:
- **`todos_done`** — every to-do generated from it (`action_items.inbox_item_id`
  lineage) is terminal (completed/cancelled), and at least one existed;
- **`thread_replied`** — a later outbound comm exists in the same
  `conversation_id` (a `outlook_sent` / `outlook_tagged` reply after the inbound);
- **`inbox_triaged`** — the `inbox_item` was triaged to `dismissed` or `archived`.

**Inverse guard:** a message is **withheld** while its deal has an **open
`offer_review`** — an offer thread stays visible until the offer resolves. (Tune
by widening/narrowing the `offer_review` predicate in the view.)

Messages already moved, parked, or inside a retry-backoff are excluded via the
ledger, so re-runs are safe and idempotent.

---

## Turn it on
1. Build + save the flow (endpoints return `{skipped:'flag_off'}` until enabled —
   the loop is simply empty).
2. Set `MAILBOX_MIRROR=true` in Railway; flip the `feature_flags_registry` row for
   `MAILBOX_MIRROR` to `on`.
3. First runs drain the historical closed-loop backlog 25/run — expected. Watch
   the Processed folder fill and the Not-Complete folder shrink to open work only.
4. If a message parks, an `lcc_health_alerts` (`mailbox_mirror_parked`) row is
   opened — investigate the `last_error`, fix, then delete that ledger row to
   re-queue.

Companion docs: `OUTLOOK_SENT_SWEEP_FLOW.md` (W7.5), `OUTLOOK_CATEGORY_TAGGING_FLOW.md` (W7.3).
