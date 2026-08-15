# Power Automate — Outlook full-body sweep → voice corpus (`email_bodies`)

Backward + forward Graph sweep that fills the **voice corpus** (`email_bodies`)
with the **full** Sent/Inbox message body — the training signal for draft-assist
(`api/draft-assist.js` `loadCorpus` → `voice-corpus-clean.js` `pickBestBody`).

This is the flow that ACTUALLY fills the corpus. It supersedes the Prompt-110
assumption that the `/api/intake?_route=outlook-message` / `outlook-sent` flows
feed `email_bodies` — **they do not** (they write `staged_intake_items` /
`activity_events`). The corpus is written by **exactly one path**: the bridge
handler `handleOutlookMessageExtract` (`api/_shared/bridge-handlers-outlook.js`),
reached through the bridge ingest receiver. This doc feeds that path.

---

## Grounded contract (verified live 2026-08-15, LCC Opps `xengecqvemvfknjvbvrq`)

- **`email_bodies` is written only by** `handleOutlookMessageExtract`, upsert on
  `(workspace_id, internet_message_id)` with `Prefer: resolution=merge-duplicates`.
  It reads the FULL Graph body via `p.body.contentType` + `p.body.content` and
  stores `body_text` (contentType `text`) / `body_html` (contentType `html`).
  Because the upsert is merge-duplicates, **a backward re-sweep UPDATES existing
  empty-body rows with their real body** — no writer change, no row churn.
- **Ingestion is queue-based:** `POST /api/bridges?_route=ingest&_source=outlook&bridge=outlook.messages`
  enqueues one `enrichment_jobs` row per message (`job_type = outlook.message.extract`);
  the worker `POST /api/bridges?_route=worker` drains it into the handler.
- **⚠ The blocker that was fixed (Prompt 114):** the ingest receiver strips any
  field not on the bridge's per-object **allowlist** (`applyAllowlist`,
  `api/_shared/bridges.js`) BEFORE enqueue. The `outlook.messages` allowlist for
  object `Message` did **not** include `body`, so the full body was dropped at
  ingest and every one of the 23,169 `email_bodies` rows landed with
  `body_text = body_html = NULL`. Migration
  `supabase/migrations/20260905120000_lcc_p114_outlook_body_allowlist.sql`
  (applied live) added `body` to that allowlist. **Without that change this sweep
  fills nothing** — it silently succeeds while the body is stripped. If you clone
  this pattern to another workspace, add `body` to that bridge's `Message`
  allowlist first.

- **⚠ The SECOND blocker that was fixed (Prompt 115) — the handler split, not the
  payload.** With the allowlist open, a real 25-message Sent-Items sweep landed
  the FULL body in `enrichment_jobs.payload` (verified live: `contentType='html'`,
  content 5,700–248,516 chars) and `email_bodies` still came out
  `body_format = body_text = body_html = NULL` on every row. The payload was fine;
  `handleOutlookMessageExtract` dropped it. Two failure modes, both now closed:
  1. **`p.body` does not always arrive as an object.** Grounded from the stored
     payloads: the first sweep sent the Graph object
     `{contentType:'html', content:'<html>…'}`, and a later `setProperty`/compose
     variant of the same 25 messages sent `body` as a **serialized JSON string**
     (`'{"content":"<html>…","contentType":"html"}'`). The old split
     `p.body?.contentType === 'html' ? p.body.content : null` yields `undefined`
     on the string shape → **both** columns NULL while 90–180 KB of content is
     discarded. `normalizeGraphBody` now parses the string shape, lowercases /
     trims `contentType`, accepts the `text/html` + `text/plain` spellings, and
     **sniffs** HTML from the content itself when `contentType` is missing —
     non-empty content always lands in a column.
  2. **The bodyless forward sweep ERASED filled bodies.** The 5-minute
     recurrence sends no `body` key at all, and the handler wrote explicit
     `body_*: null` into a `resolution=merge-duplicates` upsert — so it
     overwrote whatever a body-bearing sweep had stored. That is why the
     object-shaped sweep at 18:41 read as "stored nothing": the string-shaped
     re-sweep of the same 25 messages 13 minutes later nulled the row. The body
     columns are now **omitted** from the row when there is no content — a fresh
     row still lands NULL (column default, no fabrication), an existing body is
     never clobbered.
  Also: the upsert result was previously discarded, so a rejected write looked
  exactly like a stored body. It is now checked, logged, and reported as
  `enrichment_jobs.result->>'body_persist_error'`, and the call gets a 20s
  timeout (the 8s `opsQuery` default is thin for a 250 KB write).

### The bridge name footgun

The **bridge key is `outlook.messages`** (the `connector_bridges.bridge_key`). The
value `outlook.message.extract` is the `enrichment_jobs.job_type`, NOT the bridge
key — do not put it in the `?bridge=` query param (the receiver 400s
`Unknown bridge for source=outlook`).

---

## Part A — build the flow (Power Automate)

One "Send an HTTP request" (Graph) sweep, run twice conceptually: a bounded
**backward** pass (historical fill) and a 5-minute **forward** Recurrence. Same
flow body; only the high-water-mark window differs. Sweep **both** Sent Items and
Inbox (two Graph calls, or loop the two folder ids).

### A1. Trigger + high-water mark
- **Forward:** Recurrence every 5 minutes. Keep a **String** variable
  `hwMark` (last max `sentDateTime`/`receivedDateTime` seen), initialized to
  `addMinutes(utcNow(), -6)` on first run and persisted at the end.
- **Backward:** a one-time bounded pass. Walk OLDER than a `cursor` timestamp
  (start at `utcNow()`), page with `$top` + `$orderby ... desc`, and after each
  page set `cursor` = the OLDEST timestamp on that page. Stop when a page returns
  `< $top` rows (or you reach a floor date). This keyset walk terminates and is
  resumable — mirror the `lastRun`/high-water mechanics in
  `OUTLOOK_SENT_SWEEP_FLOW.md` A5.

### A2. Send an HTTP request — Graph query (INCLUDE the full body)
**"Send an HTTP request"** (Office 365 Outlook), **Method `GET`**. Sent Items:
```
https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?$select=internetMessageId,id,subject,body,bodyPreview,from,toRecipients,ccRecipients,conversationId,sentDateTime,receivedDateTime,isDraft,hasAttachments&$filter=sentDateTime ge @{variables('hwMark')}&$top=25&$orderby=sentDateTime desc
```
Inbox: same, but `mailFolders/Inbox/messages` and filter/order on
`receivedDateTime`.

> **`$select` MUST include `body`** — that is the whole point (it returns
> `{ contentType, content }`, the full body). `$top=25` because full bodies are
> large; keep batches small so the POST loop and the worker stay under timeouts.
>
> **fx pitfalls (from `OUTLOOK_SENT_SWEEP_FLOW.md`):** `@{variables('hwMark')}`
> must be a plain ISO-8601 UTC string; do **not** wrap the whole URI in one
> `@{...}` (only the variable token is an expression) or it 400s.

### A3. Parse + Apply to each
- **Parse JSON** the response `body`; iterate `@{body('Parse_JSON')?['value']}`
  (the `?['value']` matters — iterating the raw body yields one bogus pass).
- `from`/`toRecipients`/`ccRecipients` are **object arrays** in Graph. The bridge
  handler accepts the raw Graph shapes (`{ emailAddress:{ name,address } }`), so
  pass them through as-is — do **not** Select them down to strings (that would
  strip the display names the timeline captures).

### A4. POST each message to the bridge ingest receiver (inside Apply to each)
**HTTP** action:
- **Method:** `POST`
- **URI:** `https://<your-lcc-host>/api/bridges?_route=ingest&_source=outlook&bridge=outlook.messages`
- **Headers:**
  - `Content-Type: application/json`
  - `X-LCC-Key: <operator key>` — the receiver runs `authenticate`; use the same
    operator key/connection the other operator-scoped flows use.
  - `X-LCC-Workspace: a0000000-0000-0000-0000-000000000001`
  - `X-LCC-Source-User-Id: 1d3f7321-a4ad-4f83-9c7b-489554fc1c51` — **required**
    (`requireSourceUser`). This is Scott's `lcc_users.lcc_user_id`; the handler
    errors `missing_source_user_id` without it. The receiver injects it into each
    enqueued payload as `_source_user_id` and stamps it onto `email_bodies.source_user_id`.
- **Body** — the receiver expects a `records` **array** (one or many messages per
  POST). Pass the Graph message object through as one record, keeping the raw
  Graph field names (`id`, `internetMessageId`, `body`, `from`, `toRecipients`,
  `ccRecipients`, `conversationId`, `subject`, `bodyPreview`, `sentDateTime`,
  `receivedDateTime`, `isDraft`, `hasAttachments`):
  ```json
  {
    "workspaceId": "a0000000-0000-0000-0000-000000000001",
    "records": [
      {
        "id": "@{items('Apply_to_each')?['id']}",
        "internetMessageId": "@{items('Apply_to_each')?['internetMessageId']}",
        "subject": "@{items('Apply_to_each')?['subject']}",
        "bodyPreview": "@{items('Apply_to_each')?['bodyPreview']}",
        "body": @{items('Apply_to_each')?['body']},
        "from": @{items('Apply_to_each')?['from']},
        "toRecipients": @{items('Apply_to_each')?['toRecipients']},
        "ccRecipients": @{items('Apply_to_each')?['ccRecipients']},
        "conversationId": "@{items('Apply_to_each')?['conversationId']}",
        "sentDateTime": "@{items('Apply_to_each')?['sentDateTime']}",
        "receivedDateTime": "@{items('Apply_to_each')?['receivedDateTime']}",
        "isDraft": @{items('Apply_to_each')?['isDraft']},
        "hasAttachments": @{items('Apply_to_each')?['hasAttachments']}
      }
    ]
  }
  ```
  - `body`, `from`, `toRecipients`, `ccRecipients`, `isDraft`, `hasAttachments`
    are **objects/arrays/booleans** — reference them **without** the surrounding
    quotes (`"body": @{...}`, not `"body": "@{...}"`) so they stay JSON, not
    stringified. `subject`/ids/timestamps are strings (quoted).
  - You can batch: build a single `records` array of N messages per POST (an
    array Select over the page) instead of one POST per message — fewer calls,
    same result. Keep N small (~10–25) for full bodies.
  - **Ingest-side drops (expected, not errors):** the receiver's `skipIf` drops
    drafts (`isDraft:true`) and clearly-automated junk (no-reply/auto-reply/
    calendar-response); CoStar alerts are kept. Those return
    `rows_dropped` in the response, not a failure.

### A5. Drain the queue (the worker)
The ingest receiver only ENQUEUES. Either rely on the existing worker cron, or add
a final **HTTP POST** after the loop:
- `POST https://<your-lcc-host>/api/bridges?_route=worker&batch=50`
  (same `X-LCC-Key`). Repeat until the response `queue_depth` is 0. Each drained
  job runs `handleOutlookMessageExtract`, which fills `body_text`/`body_html`.

### A6. Update the high-water mark / cursor
Forward: set `hwMark` = max `sentDateTime`/`receivedDateTime` seen (or
`utcNow()`). Backward: set `cursor` = oldest timestamp on the page; stop on a
short page.

---

## Part B — the corpus scope gate (decide before the backward pass)

**The privacy gate is real and is a scoping decision, not a bug.** The handler
stores a message ONLY if at least one party is a **tracked contact**
(`findTrackedContacts` against `unified_contacts`, 31,036 rows live); otherwise it
returns `skipped:'no_tracked_party'` and stores nothing. So this sweep fills the
corpus for **deal/BD-relevant** mail, not Scott's entire mailbox.

- **Option A (recommended, and what this doc enables — no writer change):** accept
  the tracked-contact gate. The corpus = Scott's mail with tracked contacts, the
  highest-value voice signal, flowing through the proven bridge writer untouched.
  The only change required is the allowlist migration above (already applied).
- **Option B (bigger, not built):** a corpus-specific writer that stores
  Scott-authored bodies regardless of tracked status (relax the gate for
  `from ∈ SCOTT_FROM`). More coverage, but a privacy/volume review + new code —
  scope it separately if Scott wants it.

**Scope counts could not be split tracked-vs-untracked from LCC data:** untracked
traffic is dropped at the handler and never stored, and the sent-sweep activity
stream (`outlook_sent`) has logged 0 messages with an `internet_message_id`, so
there is no LCC-side denominator for "Scott's sends that involve no tracked
contact." Measuring that split needs a mailbox-side count (a Graph query for total
Sent vs Sent-to-a-tracked-address). What IS in the corpus today: **23,169**
`email_bodies` rows (all tracked-party), **all with empty body** pre-fix.

> **`email_bodies.is_sent` is a weak heuristic, not "Scott sent it":** it is set
> `true` when the from-address is *not* a tracked contact (so `salesforce@`,
> `postmaster@webex`, `seekingalpha@` all read `is_sent:true`). The corpus reader
> correctly ignores `is_sent` and gates on `from_email ∈ SCOTT_FROM`
> (`draft-assist-core.js`) instead. Don't build voice logic on `is_sent`.

---

## Part C — the readers (confirmed, no change needed)

`draft-assist.js::loadCorpus` selects `body_text, body_html, body_preview` from
`email_bodies` (gated only on `body_preview is not null` — presence, not length,
so a short real body passes) and resolves the best body via
`voice-corpus-clean.js::pickBestBody` (order: `body_text` → tag-stripped
`body_html` → `body_preview`). So once this sweep lands real bodies, the readers
surface them automatically — no reader change.

The **sent-activity** path (`intake.js::handleOutlookSent`) keeps a 500-char
snippet for deal-timeline logging; leave it as-is. The corpus is covered by this
bridge → `email_bodies` path, so there is no need to also persist the full body on
the sent-activity row.

---

## Verification

After a page of real (non-draft, tracked-party) messages has been swept and the
worker has drained:
```sql
select count(*) filter (where coalesce(length(body_text),0) > 255
                           or coalesce(length(body_html),0) > 255) as body_gt255,
       max(greatest(coalesce(received_at,'epoch'), coalesce(sent_at,'epoch'))) as newest
from email_bodies;
```
`body_gt255` should climb from 0 as the sweep runs. Spot-check one:
```sql
select internet_message_id, from_email, length(body_text) t, length(body_html) h
from email_bodies
where coalesce(length(body_text),0) > 255 or coalesce(length(body_html),0) > 255
order by received_at desc limit 5;
```

Mirror docs: `OUTLOOK_SENT_SWEEP_FLOW.md` (deal-to-do sweep),
`OUTLOOK_CATEGORY_TAGGING_FLOW.md` (tagging path).

---

## STATUS

| Date | Event |
|---|---|
| 2026-08-15 | **Prompt 114** — `body` added to the `outlook.messages` / `Message` allowlist (migration `20260905120000`). Bodies start reaching `enrichment_jobs.payload`; `email_bodies` bodies still 0 of 23,169. |
| 2026-08-15 | **Prompt 115** — root-caused to the HANDLER, not the payload (see the two bullets in the grounded contract above): the `contentType` exact-equality split dropped the serialized-JSON-string body shape, and the bodyless forward sweep wrote NULLs over filled rows. Handler fixed (`normalizeGraphBody` + body columns omitted when there is no content + the upsert result is checked). |
| 2026-08-15 | **Backfill applied live** (migration `20260907120000_lcc_p115_email_body_backfill.sql`, LCC Opps) — re-drove the 25 already-swept payloads straight from `enrichment_jobs` rather than asking for a re-sweep. **Bodies with >255 chars: 0 → 24** (all `body_format='html'`, 5,700–248,516 chars, full `<html>…</html>` intact). 24 not 25 because one swept message has no tracked party, so the privacy gate correctly never created an `email_bodies` row for it. Fill-blanks, idempotent (a re-run writes 0), reversible via `lcc_p115_email_body_backfill_backup`. |

**Still to come:** the handler fix ships on the next Railway redeploy of merged
`main` (the backfill above is data-layer and already live). After that redeploy,
re-run the backward sweep to fill the rest of the 23,169-row corpus — the count
in the Verification query should climb well past 24. Structural regression cover:
`test/outlook-body-persist.test.mjs`.
