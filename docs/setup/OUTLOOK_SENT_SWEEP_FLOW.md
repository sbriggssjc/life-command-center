# Power Automate — Outlook Sent-Items sweep (W7.5 outbound loop closure)

Auto-completes the to-do a send satisfies **without any tagging**: a 5-minute
Power Automate sweep of **Sent Items** posts every external send to LCC's
existing outbound engine (`handleOutlookSent`), which advances the deal's
`offer_review` / reach-out `follow_up` to-dos, schedules the seller follow-up
when an offer just went out, and non-destructively stamps the open
`deal_next_step`.

The LCC side is already built and live — the receiver
`POST /api/intake?_route=outlook-sent` (friendly alias
`POST /api/intake-outlook-sent`), `api/intake.js::handleOutlookSent`. This doc is
only the flow that FEEDS it. (Before W7.5 the engine was complete but **unfed** —
no live flow posted sent mail to it, so sending the email a to-do asked for did
not close the to-do.)

This complements — does not replace — the W7.3 **category-tagging** flow
(`OUTLOOK_CATEGORY_TAGGING_FLOW.md`). Tagging is the precise, operator-driven
path; this sweep is the zero-effort catch-all for **every** external send. Both
paths are de-duped server-side on `internet_message_id` (see the last section),
so running both is safe.

---

## Why a Graph sweep, not "Get emails (V3)"

Same lesson as W7.3 path C (session 36y): the **Get emails (V3)** connector
action does **not** reliably return `categories`, `internetMessageId`, or
`conversationId`, and its paging is opaque. Use a **"Send an HTTP request"**
(Office 365 Outlook) action against **Microsoft Graph** with an explicit
`$select`, which returns exactly the fields below. This is the same pattern the
tagging flow settled on.

---

## Part A — build the flow (Power Automate)

### A1. Trigger — Recurrence, every 5 minutes
- **Recurrence:** 5 minutes.
- Keep a "last run" high-water mark: initialize a **String** variable
  `lastRun` from a stored value (or `addMinutes(utcNow(), -6)` on first run) and
  update it at the end. This bounds the Graph query to new sends only.

### A2. Send an HTTP request — Graph Sent-Items query
**"Send an HTTP request"** (Office 365 Outlook) action:
- **Method:** `GET`
- **URI** (Graph, `$select` for the exact fields; filter to sends since the
  high-water mark):
  ```
  https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?$select=internetMessageId,subject,from,toRecipients,ccRecipients,sentDateTime,bodyPreview,conversationId,webLink&$filter=sentDateTime ge @{variables('lastRun')}&$top=50&$orderby=sentDateTime desc
  ```
  > **fx-expression pitfall (36y):** `@{variables('lastRun')}` must be a plain
  > ISO-8601 UTC string (e.g. `2026-08-06T14:00:00Z`). Do **not** wrap the whole
  > URI in one `@{...}` — only the variable token is an expression; the rest is
  > literal text. A fully-wrapped URI makes Flow treat `$select`/`$filter` as
  > part of the expression and the call 400s.

### A3. Parse + Apply to each
- **Parse JSON** the response `body`. The messages live under **`value`** — so
  the **Apply to each** input is `@{body('Parse_JSON')?['value']}` (the
  `?['value']` is the 36y foreach pitfall: iterating the raw body instead of
  `value` yields one bogus pass).

### A4. HTTP — POST each send to LCC (inside Apply to each)
**HTTP** action:
- **Method:** `POST`
- **URI:** `https://<your-lcc-host>/api/intake-outlook-sent`
- **Headers:**
  - `Content-Type: application/json`
  - Auth per the receiver's contract — `handleOutlookSent` requires a **signed-in
    operator** (it calls `authenticate` + `requireRole('operator')`). Use the
    same authenticated-connection / bearer the other operator-scoped flows use
    (e.g. `X-LCC-Key` when key-auth is enforced, plus `X-LCC-Workspace` if the
    flow serves more than one workspace). This differs from the tagging flow,
    which accepts the `X-PA-Webhook-Secret`.
- **Body** (map the Graph fields; the receiver accepts both snake_case and the
  raw Graph camelCase, but be explicit):
  ```json
  {
    "internet_message_id": "@{items('Apply_to_each')?['internetMessageId']}",
    "subject": "@{items('Apply_to_each')?['subject']}",
    "from": "@{items('Apply_to_each')?['from']?['emailAddress']?['address']}",
    "to_recipients": "@{join(body('Select_To'), ';')}",
    "cc_recipients": "@{join(body('Select_Cc'), ';')}",
    "sent_date_time": "@{items('Apply_to_each')?['sentDateTime']}",
    "body_preview": "@{items('Apply_to_each')?['bodyPreview']}",
    "conversation_id": "@{items('Apply_to_each')?['conversationId']}",
    "web_link": "@{items('Apply_to_each')?['webLink']}"
  }
  ```
  - `to`/`cc` are arrays of objects in Graph; use a **Select** action to project
    `item()?['emailAddress']?['address']` then `join(..., ';')`. The receiver
    also accepts the raw array text and regex-extracts addresses, so a plain
    `@{items('Apply_to_each')?['toRecipients']}` works too (less clean).
  - The receiver drops any `@northmarq` recipient (internal), so a send with only
    internal recipients returns `{ logged:false, reason:'no_external_recipient' }`
    — expected.

### A5. Update the high-water mark
After the loop, set `lastRun` = the max `sentDateTime` seen (or `utcNow()`), and
persist it for the next run.

---

## Part B — LCC side (already built)

Nothing to deploy. The receiver:
1. Resolves the deal by "a recipient is a correspondent on an open deal" →
   most-recent-correspondent → conversation-thread continuity. Unattached sends
   are logged without a deal (no guessing).
2. Logs an `outlook_sent` `email` activity (idempotent on
   `(workspace, outlook_sent, internet_message_id)`).
3. Advances the deal's outbound to-dos via `lcc_advance_todos` +
   `lcc_reconcile_deal_todo` (reversible, metadata-stamped).

**Backfill:** POST with `"backfill": true` to log historical sends WITHOUT
advancing/closing to-dos (avoids mass-closing open work from replayed history).

---

## Idempotency + cross-path de-dupe (safe to run alongside tagging)

- **Same-path idempotency:** the unique index on
  `(workspace, outlook_sent, internet_message_id)` makes PA replays no-ops.
- **Cross-path de-dupe (W7.5):** a tagged send lands in **both** this sweep
  (`outlook_sent`) and the tagging flow (`outlook_tagged`). The two use different
  `source_type`s, so the per-path index can't catch it. Each receiver now checks
  for an existing spine row from the OTHER path on the same
  `internet_message_id` and **skips both the insert and the advance** — so a
  to-do never advances twice for one send. Whichever path logs first wins; the
  second returns `{ duplicate:true, cross_path:<other> }`.

Mirror doc for the tagging path: `OUTLOOK_CATEGORY_TAGGING_FLOW.md`.
