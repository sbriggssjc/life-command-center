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
  **Except (P119): an error meaning "the message is not in the source folder" is
  recorded as TERMINAL SUCCESS** (`outcome:'already_out'`, `terminal:true`) — no
  retry, no park, no alert. See "not-found is success" below.

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
    "reason": "@{items('Apply_to_each')?['reason']}",
    "error": "not_found"
  }
  ```
  (Use `"error": "move_failed"` / the Graph error body in the move-failed branch.)
  A genuine move failure re-queues after 1h and parks after 5 failures with a
  health alert — so a message that can't be moved is never silently lost. A
  **not-found** ack is terminal success and does none of that (below).

  > **Send `reason` on the failure branch too.** The live mover omitted it, so all
  > 3,963 ledger rows carry `reason = NULL` and the ledger can't say which closure
  > arm published the message.

---

## ⚠️ "not in the source folder" is SUCCESS, not a failure (P119, 2026-08-20)

**What happened.** Between 2026-08-06 and 2026-08-20 the mover acked
**3,963 messages and moved exactly zero** — every single one `moved:false` with
`error: "not_found_or_not_in_source_folder"`. Each burned 5 retries, parked, and
opened an `lcc_health_alerts` row: **3,960 open alerts, 99.3% of the entire
open-alert surface**, burying the ~24 genuinely actionable ones.

**Two independent causes, both fixed on the LCC side (migration
`20260820120000_lcc_p119_mailbox_mirror_not_found_terminal.sql`):**

1. **The worklist published messages that were never in the folder.** It anchored
   on *every* `inbox_items` row with `source_type='flagged_email'` (4,051), of
   which 3,944 are `status='archived'` — and that archive is not deliberate triage
   but two bulk inbox sweeps (2,319 rows on 2026-06-04, 580 on 2026-06-16).
   **100%** of the parked messages qualified via the `inbox_triaged` arm; not one
   via `todos_done` or `thread_replied`. **92.1%** had no `processing_log`
   decision at all (an Apr–May 2026 capture predating the move queue), so LCC
   never routed them anywhere near the staging folder.
   → The view now requires `processing_log.outcome='staged'` — i.e. **LCC itself
   put the message in "Intake Staged, Not Completed"**. Producer anchor
   **4,051 → 323**.

2. **`not_found` was treated as retryable.** If the mover reports the message
   isn't in the source folder, the **desired end state is already true**. It is
   now recorded terminal (`outcome='already_out'`, `action='noop'`) on the first
   ack: no retry, no park, no alert — and any open park alert for that message is
   resolved on the spot.

**Ownership rule — one owner per folder transition:**

| Transition | Owner |
|---|---|
| Inbox → `Processed/*` | the flagged-intake flow's own `Move_email_(V2)` / the `processing_log` move queue |
| Inbox → "Intake Staged, Not Completed" | the `processing_log` move queue (`outcome='staged'`) |
| "Intake Staged, Not Completed" → Processed | **this mover, and only for messages LCC staged** |

A message this mover does not find in the staging folder is **done**, not broken.

**What still fails loudly.** The terminal classifier
(`lcc_mailbox_mirror_error_is_terminal()`, the single owner of the decision —
never re-implement it in the flow or in JS) is a narrow allowlist. A missing
**destination** folder (`ErrorFolderNotFound`, `destinationId ...`) is a real
break — a stale `processedFolderId` binding, the same class that bit the
flagged-intake trigger on 2026-08-19 — and still retries, parks and alerts.
Throttling (429), 5xx, timeouts and auth errors are unchanged.

**Auto-retire (Consumption-Layer arm).**
`lcc_mailbox_mirror_retire_cleared_parks(p_dry_run default true)` resolves open
`mailbox_mirror_parked` alerts whose premise has cleared (ledger row gone /
`moved` / `already_out` / a terminal `last_error`) and normalises those ledger
rows so they can never re-park. Cron `lcc-mailbox-mirror-retire` (06:25 UTC).
It only touches `resolved_at IS NULL`, so it is idempotent and never rewrites the
`cowork-mirror-backlog-retire-20260820` batch. `alerts_left_open` in its return is
the honest count of genuinely stuck moves an operator must still work. Reverse
with `resolved_note LIKE 'p119-mirror-auto-retire:%'`.

**⚠️ Open upstream gap (not a mirror bug).** All **323** `processing_log`
`outcome='staged'` rows are still `move_status='pending'` — the queue that moves
a staged email *into* "Intake Staged, Not Completed" has never been drained (the
only rows it ever moved were 16 `filed` ones, 2026-07-21→23). Until something
consumes that queue, the staging folder is not being populated, so the mirror
will keep (correctly, quietly) acking `already_out`. Draining it is the next
piece of work, not something this fix can do.

---

## Part B — LCC side (already built)

Nothing to deploy. `GET /api/mailbox-reconcile-worklist` reads the deterministic
view `v_lcc_mailbox_reconcile_worklist`; `POST /api/mailbox-reconcile-ack` calls
`lcc_mailbox_reconcile_ack` (idempotent ledger upsert + retry/backoff/park +
alert). See `supabase/migrations/20260824120000_lcc_w7_6_mailbox_mirror.sql`.

### When is a message "closed" (worklist gate — deterministic, no AI)?
A flagged-email `inbox_item` (with an `internet_message_id`) qualifies when LCC
routed it to the staging folder (`processing_log.outcome='staged'` — the P119
source-folder gate) **AND ANY** of:
- **`todos_done`** — every to-do generated from it (`action_items.inbox_item_id`
  lineage) is terminal (completed/cancelled), and at least one existed;
- **`thread_replied`** — a later outbound comm exists in the same
  `conversation_id` (a `outlook_sent` / `outlook_tagged` reply after the inbound);
- **`inbox_triaged`** — the `inbox_item` was triaged to `dismissed` or `archived`.

**Inverse guard:** a message is **withheld** while its deal has an **open
`offer_review`** — an offer thread stays visible until the offer resolves. (Tune
by widening/narrowing the `offer_review` predicate in the view.)

Messages already moved, already-out (P119 terminal), parked, or inside a
retry-backoff are excluded via the ledger, so re-runs are safe and idempotent.

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
   re-queue. Post-P119 a park means a *genuine* failure (bad destination folder,
   throttling, auth), never "the message wasn't there".
5. **Watch the honest counters, not `moved`:**
   ```sql
   SELECT outcome, count(*) FROM public.lcc_mailbox_reconcile_ledger GROUP BY 1;
   SELECT count(*) FROM public.lcc_health_alerts
    WHERE alert_kind='mailbox_mirror_parked' AND resolved_at IS NULL;
   ```
   `moved=true` covers both "we moved it" and "it was already gone" — read
   `outcome` for which. Never quote `moved` as a count of moves performed.

Companion docs: `OUTLOOK_SENT_SWEEP_FLOW.md` (W7.5), `OUTLOOK_CATEGORY_TAGGING_FLOW.md` (W7.3).
