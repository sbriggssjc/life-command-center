# Power Automate — Outlook category-tagging capture (W7.3 path C)

Zero-UI capture that works **at send time**: you (or the team) assign an Outlook
**category** to any message — sent OR received — and a Power Automate flow posts
it to LCC, which deal-stamps it onto the activity spine so the **W7.2
propagation tick** picks it up (summary / milestones / next steps / dossier)
within the hour.

The LCC side is already built: the receiver `POST /api/intake-tagged-comm`
(`api/_handlers/intake-tagged-comm.js`), the deterministic deal resolver
(`api/_shared/deal-resolve.js`), and the `tag_unresolved` parking lane
(`research_tasks`). Once the flow below exists and the flag is set, it's live.

---

## Category convention

- **`LCC`** — auto-resolve the deal from the sender (the W7.1
  `lcc_resolve_contact` paths + conversation-thread continuity).
- **`LCC:<deal hint>`** — explicit. The hint is matched conservatively against
  open-deal names / tenant+city cores. **Ambiguous or no match → the message is
  PARKED** in the `tag_unresolved` My Work lane (never guessed); attach it later
  with the Copilot `tag_comm_to_deal` action using the `internet_message_id`.

Create the `LCC` category once in Outlook (any color). Team members can add
`LCC:<hint>` categories as free-text on send.

---

## Part A — build the flow (you, in Power Automate)

Two triggers feed the same HTTP POST, so build one child "HTTP action" and call
it from both. (Or build two flows — one per trigger — pointing at the same URL.)

### A1. Trigger — "When an email is flagged/categorized"
Office 365 Outlook has no direct "category assigned" trigger, so use the
robust pattern:

- **Trigger:** *When a new email arrives (V3)* **and** a scheduled *Get emails
  (V3)* sweep of **Sent Items** + **Inbox** filtered to messages whose
  `categories` contains `LCC`. (A 5-minute recurrence sweep catches both sent
  and received tagged mail; the arrival trigger gives near-real-time inbound.)
- **De-dupe** on `internetMessageId` — the receiver is idempotent, so a message
  seen by both the trigger and the sweep is a safe no-op.

### A2. Filter — only LCC-categorized messages
Add a **Condition**: `categories` (the message's category array) **contains**
`LCC`. Skip everything else. Do NOT strip the `LCC:<hint>` variants — pass the
full `categories` array through; LCC parses the hint.

### A3. HTTP — POST to the LCC receiver
**HTTP** action:
- **Method:** `POST`
- **URI:** `https://<your-lcc-host>/api/intake-tagged-comm`
- **Headers:**
  - `Content-Type: application/json`
  - `X-PA-Webhook-Secret: @{...}` — the shared secret (see Part B). Same auth
    contract as the SF-sync flows.
- **Body:**
  ```json
  {
    "internet_message_id": "@{items('Apply_to_each')?['internetMessageId']}",
    "subject": "@{items('Apply_to_each')?['subject']}",
    "from": "@{items('Apply_to_each')?['from']}",
    "to": "@{items('Apply_to_each')?['toRecipients']}",
    "sent_at": "@{items('Apply_to_each')?['sentDateTime']}",
    "received_at": "@{items('Apply_to_each')?['receivedDateTime']}",
    "categories": @{items('Apply_to_each')?['categories']},
    "conversation_id": "@{items('Apply_to_each')?['conversationId']}",
    "body_preview": "@{items('Apply_to_each')?['bodyPreview']}",
    "direction": "@{if(contains(toLower(items('Apply_to_each')?['from']), 'northmarq'), 'outbound', 'inbound')}"
  }
  ```
  `direction` is optional — LCC infers it from an internal sender when omitted.
  `categories` must be the raw array (not a string) so `LCC:<hint>` survives.

The receiver returns `{ ok, logged, parked, deal_entity_id, direction, advance, note }`.
`parked:true` means it couldn't match a single open deal and filed a `tag_unresolved` task.

**W7.5 — a tagged SEND now completes work.** When `direction` resolves to
`outbound` and a deal is matched, the receiver advances the deal's `offer_review`
/ reach-out `follow_up` to-dos (and schedules the seller follow-up) and
non-destructively stamps the open `deal_next_step` — the same outbound engine
`handleOutlookSent` runs. The `advance` field in the response shows what fired.
A tagged send and the untagged Sent-Items sweep (`OUTLOOK_SENT_SWEEP_FLOW.md`)
are de-duped on `internet_message_id`, so a to-do never advances twice.

---

## Part B — LCC side (already built — just configure)

1. **Secret:** set `PA_WEBHOOK_SECRET` in Railway (reuse the existing one — the
   receiver accepts the same header the SF-sync flows use), and put the same
   value in the flow's `X-PA-Webhook-Secret` header.
2. **Flag ON:** set `TAGGED_COMM_INTAKE_ENABLED=true` in Railway. Until then the
   receiver no-ops (returns `{ skipped: 'flag_off' }`); flag row
   `TAGGED_COMM_INTAKE` in `feature_flags_registry`. Flip its `state` → `on`.
3. **Dry test:** `POST /api/intake-tagged-comm?force=1` with a real
   `internet_message_id` + `categories:["LCC:<a real deal>"]` and confirm
   `logged:true` + a `deal_entity_id`. Then verify the deal's next W7.2 summary
   regeneration reflects it.

---

## Idempotency, resolution, and the unresolved lane

- **Idempotent** on `internet_message_id` (activity_events unique index on
  (workspace, `outlook_tagged`, external_id)) — PA replays are no-ops.
- **Resolution order:** explicit `LCC:<hint>` → sender via `lcc_resolve_contact`
  → conversation-thread continuity → **park** (`research_tasks` research_type
  `tag_unresolved`, idempotent). Deal resolution NEVER guesses.
- **Parked items** surface in My Work (the `tag_unresolved` lane). Attach one via
  Copilot `tag_comm_to_deal` with its `internet_message_id`, or ignore it.

Mirror doc for the resolver-side deal-thread search: `power-automate-deal-thread-search.md`.
