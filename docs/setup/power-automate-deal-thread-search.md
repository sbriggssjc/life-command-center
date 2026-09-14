# Power Automate — "Outlook Deal Thread Search" flow (W7.1 historical backfill)

> Operator follow-up for the deal-correspondence **historical** backfill. Mirrors the
> SF-owner flow pattern (`power-automate-sf-owner-flow.md`). The LCC side is **already
> built** — this doc is the connector piece + the two live routes you call.

## What LCC already exposes (no further LCC work needed)
- **`lcc_deal_correspondents(p_deal_entity_id)`** — per-deal search seed (party emails from
  every `deal_party` edge + SF opp contacts + `metadata.primary_contact`, plus deal/property
  name, core tenant, city). Live.
- **`POST /api/intake-deal-backfill`** (alias of `POST /api/deal-correspondence-backfill`) —
  receiver: body `{ deal_entity_id, messages:[{internet_message_id, subject, from, to,
  received_at, body_snippet, web_link}] }` → logs each via the dual-anchor loggers, deal-stamped,
  **idempotent on `internet_message_id`**, returns counts. Worker mode (no body, `?missing_only=1&limit=N`)
  sweeps open deals → seed → the flow below → log, once `OUTLOOK_SEARCH_WEBHOOK_URL` is set.

## The flow to build (connector-side)
HTTP-triggered Power Automate flow, same signed-URL contract as `SF_LOOKUP_WEBHOOK_URL`; its
URL goes in the Railway env var **`OUTLOOK_SEARCH_WEBHOOK_URL`**.

1. **Trigger schema:** `{ operation, subjects:[string], emails:[string], since?:string, top:int }`.
   Type `since` as `["string","null"]` (or omit it) — LCC only sends non-null fields, but this
   makes the trigger tolerant.
2. On `operation == 'deal_thread_search'`: Office 365 Outlook **Get emails (V3)** on Inbox and
   Sent, `searchQuery = first(subjects)`, `top` from the body. (v2 recall upgrade: also OR a
   `from:/to:` search over `emails`, and loop all `subjects` — see correspondence-ingestion-design.md §v2.)
3. **Response 200:** `{"ok": true, "operation": "deal_thread_search",
   "messages": @union(coalesce(Get_Inbox.value,[]), coalesce(Get_Sent.value,[]))}`.
   Set the success `Response.runAfter` to `Get_Sent: [Succeeded, Failed, TimedOut]` so a
   single-folder hiccup still returns partial results (do **not** add a second `{ok:false}`
   Response wired after success — that double-responds and marks every run Failed).
   Graph camelCase field names (`internetMessageId`, `subject`, `bodyPreview`,
   `receivedDateTime`, `webLink`) are what LCC's mapper expects.

## Runbook
1. Build the flow, set `OUTLOOK_SEARCH_WEBHOOK_URL` in Railway.
2. Dry-run gate: `POST /api/deal-correspondence-backfill?limit=3` (worker) — confirm messages log.
3. Full sweep: `POST /api/deal-correspondence-backfill?missing_only=1&limit=8` in batches until
   `deals_searched:0` (batching stays under the ~88s platform request wall; each deal is marked
   `correspondence_swept_at` even on 0 messages so paging advances).
4. Spot-check a deal's timeline for the backfilled thread.

The **ongoing** capture (new mail) does NOT need this flow — the Outlook bridge +
`lcc_resolve_contact` roster mapping (W7.1) self-stamp new deal mail at ingest.
