# Deal-correspondence ingestion — design (2026-07-31)

## Why this is the unlock
Multiple intelligence features (real deal staleness, content-aware next-steps, the role-aware
engine firing at volume) are gated on one thing: **deal email threads aren't in the activity
spine.** Audits (`activity-coverage-audit.md`, `data-availability-map.md`) proved it's not a
query/linkage bug — the correspondence was never ingested, and the deal↔contact linkage that
would let us attribute existing contact touches isn't populated either (2 of 40 open deals carry
a primary contact; none resolve). So the fix is upstream, in ingestion — and it's **connector-
dependent** (needs Outlook/Graph via Power Automate, the same pattern as the SF-owner flow).

## Architecture (mirrors the proven SF-owner flow pattern)
Two flows, one shared LCC receiver. LCC tells the connector *what to fetch*; the connector
returns messages; LCC logs them deal-stamped and idempotent.

### A. Ongoing capture — mostly built, needs tightening
`handleOutlookMessage` / `handleOutlookSent` → `logInboundCorrespondenceDualAnchor` already
capture NEW mail and stamp `party_entity_id` / `deal_entity_id`. Two gaps:
1. The Outlook connector must actually forward the folders/threads where deal mail lives.
2. `lcc_resolve_contact` must map the counterparty → the **deal** (not just a contact). Today it
   resolves a party + primary open deal; ensure deal counterparties (buyer/broker emails on the
   SF opp) resolve to that deal so the stamp lands.

### B. Historical backfill — new, the actual unlock
A Power Automate + Outlook (or Graph) flow, invoked per open deal:
1. LCC calls the connector with the deal's **search terms**: counterparty emails + property/deal
   name (from `lcc_deal_correspondents(deal)` — to build; see below).
2. The flow searches the mailbox, returns the matching messages (`{internet_message_id, subject,
   from, to, received_at, body_preview, web_link}`), same JSON contract style as the SF flow.
3. LCC's receiver logs each via the dual-anchor logger with `deal_entity_id` = the deal entity,
   deduped on `internet_message_id` (the spine's unique key) → they attach to the deal.

## LCC-side pieces to build (code — ready when the connector is available)
1. **`lcc_deal_correspondents(p_deal_entity_id)`** (DB) — returns the emails/contact ids to search
   for a deal's mail: from the SF opportunity's contacts, `metadata.primary_contact`, related
   `deal_party`/`brokers`/`sells` parties, and the property name. This is the search seed and is
   buildable now (even if sparse today, it's the structural connector deals→people).
2. **`POST /api/intake-deal-backfill`** (route) — accepts `{deal_entity_id, messages[]}`, logs each
   through `logEmailIntakeCorrespondence` / `logInboundCorrespondenceDualAnchor` with the deal
   stamp; idempotent; returns counts. Reuses the existing dual-anchor loggers — no new spine logic.
3. **Backfill worker** — iterate open deals, call the connector flow, post results to the receiver.
   Can run once (backfill) and on a cadence (catch stragglers). Feature-gated on the connector URL.

## Connector-side piece (Scott / Northmarq IT)
The Power Automate + Outlook flow op `deal_thread_search` (mailbox search by from/subject),
returning the message list. Same signed-webhook contract as `SF_LOOKUP_WEBHOOK_URL`; a new
`OUTLOOK_SEARCH_WEBHOOK_URL` env var. This is the only piece that can't be built from the DB.

## Sequencing
1. Build `lcc_deal_correspondents` + the `/api/intake-deal-backfill` receiver (LCC-side, testable
   with synthetic messages) — ready and waiting.
2. Stand up the Outlook search flow (connector-side).
3. Run the backfill; verify deal staleness/last-touch populate; the role-aware engine begins
   firing on real deal mail.

## Build status (2026-07-31)
LCC side is **built and ready** (ships on next redeploy):
- `lcc_deal_correspondents(deal_entity_id)` — search seed (40/40 deals by subject, 13 by email). ✅ live.
- `api/_shared/outlook-search.js` `getDealThreads()` — flow proxy, gated on `OUTLOOK_SEARCH_WEBHOOK_URL`.
- `POST /api/deal-correspondence-backfill` — **receiver mode** logs supplied messages now
  (testable), **worker mode** sweeps deals → search → log once the flow exists.

## Connector-side piece to build (you) — the `deal_thread_search` flow
A Power Automate flow (HTTP trigger, same signed-URL contract as `SF_LOOKUP_WEBHOOK_URL`) whose
URL goes in `OUTLOOK_SEARCH_WEBHOOK_URL`:
1. Trigger schema: `{ operation, subjects:[string], emails:[string], since:string, top:int }`.
2. On `operation == 'deal_thread_search'`: use the **Office 365 Outlook** connector's
   "Search messages" (or "Get emails (V3)" with a `$search`/`$filter`) — match subject contains
   any of `subjects` OR from/to in `emails`, newest first, top N.
3. Map results and **Response** 200:
   ```json
   {"ok": true, "messages": "@outputs('...')?['body']?['value']"}
   ```
   Each message needs `internetMessageId, subject, from, toRecipients, receivedDateTime,
   bodyPreview, webLink` (LCC normalizes these field names). Add a failed-run Response
   `{"ok": false, "reason": "flow_error"}`, same as the SF flow.
Then set `OUTLOOK_SEARCH_WEBHOOK_URL` in Railway and call `POST /api/deal-correspondence-backfill`.

## Honest note
Until the Outlook connector is engaged, this stays a design + a ready LCC receiver — the same
posture we took with the SF-owner flow before its Power Automate op existed. The analytics/
intelligence engines are complete and will light up the moment deal mail flows in.

## Flow verification (2026-07-31) — "Outlook Deal Thread Search"
Verified the exported flow definition (display "Outlook Deal Thread Search").
**Contract is correct:** trigger schema carries `operation/subjects/emails/since/top`; `Get_Inbox` and
`Get_Sent` both run `GetEmailsV3` with `searchQuery: @first(triggerBody()?['subjects'])` and
`top: @triggerBody()?['top']`; `Get_Sent` runs after `Get_Inbox` on Succeeded/Failed/TimedOut;
success `Response` returns `{ok:true, operation:'deal_thread_search', messages: @union(coalesce(Get_Inbox.value,[]), coalesce(Get_Sent.value,[]))}`.
**Field casing confirmed** against Microsoft Learn: `GetEmailsV3` returns Graph camelCase
(`internetMessageId`, `subject`, `bodyPreview`, `receivedDateTime`, `webLink`) — matches
`outlook-search.js`'s mapper, so messages resolve an id and are NOT filtered.

**Caveat found + fixed:** the exported flow had a second response `Response_1` (`{ok:false}`) wired
`runAfter: Response [Succeeded]`, i.e. it fired a second HTTP response on every success -> every run
marked Failed + failure-alert spam (LCC still got the valid first 200). Scott deleted `Response_1`.

**Resilience gap (open):** with `Response_1` gone, if `Get_Sent` (or `Get_Inbox`) *fails*, no Response
action's `runAfter` is satisfied, so Power Automate returns **502 BadGateway** (no response
generated) -> LCC records `flow_http_error` and skips the deal. Recommended hardening: set the
success `Response.runAfter` to `Get_Sent: [Succeeded, Failed, TimedOut]` (the `coalesce(...)` in the
union already tolerates a null branch), so a Sent/Inbox hiccup still returns whatever was found.

**First live worker run (limit=3):** `deals_searched:3, messages_logged:0`, all three
`flow_http_error` — the flow is returning a non-2xx (most likely the 502-no-response path above:
one of the `GetEmailsV3` actions is erroring and, post-`Response_1`-deletion, nothing answers).
The backfill worker now echoes the flow's HTTP `status` + `detail` per error (was reason-only), so the
next run surfaces the exact failure. Next: read the flow's run history to see which action fails,
apply the `runAfter` hardening, and re-run.

### Root cause of `flow_http_error` (2026-07-31, resolved on LCC side)
After widening `Response.runAfter` (Scott applied it) and re-firing `?limit=3`, the worker's richer
error surfaced the true cause on all three deals:
```
HTTP 400 TriggerInputSchemaMismatch — "The input body for trigger 'manual' ... did not match its
schema definition. Error details: 'Invalid type. Expected String but got Null.'"
```
**Diagnosis:** `getDealThreads()` sent `"since": null`, and the Power Automate **Request trigger
validates the body against its JSON schema** and rejects a null where `since` is typed `string` —
so it 400s *before any action runs* (which is also why there was no run history until LCC called it,
and why the 502/runAfter theory was only half the story). The flow doesn't even use `since` today
(it searches on `first(subjects)` + `top` only).
**Fix (durable, LCC side):** `outlook-search.js` now builds the payload with only non-null fields —
`operation/subjects/emails/top` always, and `since` included **only** when it's a non-empty string.
No null ever reaches the trigger. Ships on next redeploy; then re-fire `?limit=3`.
**Optional flow-side hardening (immediate, no redeploy):** in the trigger schema change
`"since": { "type": "string" }` to `"type": ["string", "null"]` (or drop `since` from the schema).
That unblocks the *currently-deployed* LCC too; it becomes moot once the LCC fix ships.

## Flow completion status + planned v2 (2026-07-31)
**Done / intended for this layer:**
- Trigger contract `{operation, subjects[], emails[], since?, top}` — stable; `since` now optional.
- Inbox + Sent search via `GetEmailsV3`, `searchQuery = first(subjects)`, `top` from body.
- `Response` returns `{ok:true, messages: union(Inbox.value, Sent.value)}`; runAfter widened to
  Succeeded/Failed/TimedOut so a single-folder hiccup still returns partial results.
- LCC: `getDealThreads` proxy + null-safe payload; `deal-correspondence-backfill` receiver + worker
  with per-message deal-stamp, dedup on `internet_message_id`, direction inference, and
  `lcc_reconcile_deal_todo` wiring; worker echoes flow `status`+`detail` on error.
**Planned v2 (documented to circle back — not blocking):**
1. **Email-based search.** The seed's `correspondent_emails` are currently unused by the flow (it
   searches the deal-name subject only). Add a from/to-in-`emails` search branch (Graph `$search`
   `"from:a@x.com OR to:a@x.com"` or a filtered Get) and union it in — higher recall on threads that
   don't carry the deal name in the subject.
2. **Multi-subject.** Search all `subjects`, not just `first(subjects)` (loop or OR the search query).
3. **`since` date bound.** Once the flow uses `since`, pass a real lookback from LCC (e.g. deal
   created_at − N days) to cap the search window; today it's omitted and the flow relies on `top`.
4. **Cadence run.** After the one-time backfill, schedule the worker (no-body worker mode) on a
   cadence to catch stragglers — same posture as the SF-owner sync.
5. **Ongoing-capture tightening** (design §A): ensure deal counterparties (buyer/broker emails on the
   SF opp) resolve to the deal so *new* live mail self-stamps without a re-backfill.

## End-to-end proven + batched sweep (2026-07-31)
**It works.** After the null-safe payload fix shipped and the flow trigger tolerated the null, the
first live `?limit=3` returned **24 messages logged, 0 errors**, deal-stamped on the spine
(`source_type='email_intake'`, `entity_id`=deal). The reconciler fired at volume across deals that
have open `deal_next_step` to-dos: each now carries `last_correspondence_{at,dir,subject}`,
`correspondence_count`, and `ball_in_court` (us on last-inbound = "your move", them on last-outbound).

**Batched sweep (the full backfill can't run in one request).** A full ~40-deal serial flow-sweep
exceeds the platform request window (observed **502 "Application failed to respond" at ~88s**), and an
un-paged worker always restarts from the top so it never reaches the tail. Fix:
- **`lcc_mark_deal_swept(entity_id, count)`** stamps `bd_opportunities.metadata.correspondence_swept_at`
  (+`correspondence_last_count`) once a deal is searched — **even on 0 messages** (a true-negative
  subject miss), so it drops out of the next batch. Migration `20260818270000`.
- **Worker `?missing_only=1`** selects open deals where `correspondence_swept_at is null`,
  `order=entity_id.asc`, capped by `?limit`. Repeated small-`limit` calls converge to full coverage
  without ever hitting the timeout. This is also the **cadence hook**: a future run re-sweeps by aging
  or clearing the marker.
- Response now also returns `missing_only` + `deals_swept`.

**Coverage checkpoint (2026-07-31):** 40 open deals; **21 swept / have mail**, **19 unswept**. Deals
already carrying `email_intake` mail were pre-marked swept so the batched run targets only the tail.
**Next (after this worker redeploys):** run `?missing_only=1&limit=8` ~3x to finish the 19, then verify
deal staleness/last-touch across My Day. Some of the 19 will be **true negatives** (no deal-name-subject
match) until the v2 **email-based search** lands — those get marked swept once and stop being retried.

## Reconciliation refinement (2026-07-31) — deal correspondence -> deal_next_step to-dos
The existing self-updating engines (`lcc_advance_todos`, `lcc_autoresolve_todos`) only reconcile
`offer_review` / `follow_up` / `seller_follow_up`. But the bulk of open work is `deal_next_step`
(stage-derived "next move" items from `lcc_generate_deal_next_steps`) — 33 of 37 open to-dos — and
nothing linked deal mail to those. New RPC **`lcc_reconcile_deal_todo(deal, direction, activity, subject, at)`**
closes the loop NON-DESTRUCTIVELY: per deal-stamped message it stamps every open `deal_next_step`
for that deal with `last_correspondence_{at,dir,subject}`, increments `correspondence_count`, sets
`ball_in_court` (`us` on inbound, `them` on outbound) + `awaiting_our_move`, and raises priority to
`high` on an inbound reply. It never auto-completes a broad next-step on a single email (that would
drop real work) — completion of the narrow, touch-satisfiable types stays with the existing engines.
Wired at all three correspondence entry points (backfill `logMessages` with direction inferred from
sender, live inbound dual-anchor, live `handleOutlookSent`). Tested live against a real deal
(inbound -> ball=us/high/awaiting; outbound -> ball=them; count increments), synthetic evidence then
cleared. Migration `20260818260000_lcc_reconcile_deal_todo.sql`.
