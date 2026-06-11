# PA flow build recipe — "SF -> LCC: Activity Sync"

Feeds the live `/api/sf-activity` handler. Prereq CONFIRMED 2026-06-11: the
Salesforce connection can read the **Tasks** object (it's in the Get-records Object
Type list). Build this in your native browser (reliable). Ships alongside the
`sf-activity-ingest` raw-fields tweak (so the flow can POST raw SF records).

## Sequence
1. Run the Claude Code raw-fields prompt + redeploy the main app FIRST (so the
   handler accepts raw SF Task fields). Then build + turn on this flow.

## Build: New flow → "Scheduled cloud flow"
Name: **SF -> LCC: Activity Sync**. Set the recurrence to **every 1 hour** (matches
the Object Sync cadence).

### Action 1 — Initialize variable "Watermark"  (rolling lookback)
- New step → **Initialize variable**. Name `Watermark`, Type `String`, Value (fx):
  `formatDateTime(addDays(utcNow(),-1),'yyyy-MM-ddTHH:mm:ssZ')`
  (a 24-hour lookback every hour; the handler dedups on the SF id, so the overlap is
  harmless — this is the simple, robust choice vs a stored watermark.)

### Action 2 — Salesforce → "Get records" (V3)
- Connection: **Salesforce** (the existing one).
- **Salesforce Object Type:** `Tasks`
- **Filter Query:** type `LastModifiedDate gt ` then insert the `Watermark` dynamic
  value → `LastModifiedDate gt @{variables('Watermark')}`
  (Tasks are where Salesforce logs Calls/Emails/etc. — `TaskSubtype` carries the
  kind. Standard fields Subject, Description, ActivityDate, Status, WhoId, WhatId,
  TaskSubtype are returned by default.)
- (Optional) Top Count: 200 — keep batches bounded.

### Action 3 — HTTP → POST
- **Method:** POST
- **URI:** `https://tranquil-delight-production-633f.up.railway.app/api/sf-activity`
- **Headers:**
  - `Content-Type` : `application/json`
  - `X-LCC-Key` : `<your LCC_API_KEY value>`  (same key the other LCC flows use)
- **Body:** open the **fx** editor and enter this ONE expression (the wrap trick —
  the Body statically validates JSON, so a bare `@{...array}` fails; `addProperty`
  is one expression that passes):
  `addProperty(json('{}'),'records', body('Get_records')?['value'])`
  — if your Get-records action got a different internal name (e.g. `Get_records_2`),
  use that name inside `body('...')`. The result is
  `{ "records": [ …raw SF Task objects… ] }`, which the (tweaked) handler maps
  server-side.

### Save → Turn On.

## Verify (Claude/Cowork, after it's on)
- Manually **Run** the flow once; check its run succeeded and the HTTP POST returned
  `{ok:true, matched, inserted, ...}`.
- I'll confirm `activity_events` gained `salesforce` rows linked to real entities,
  and that they show up in the property/contact context-packet `activity_timeline`.

## Notes
- The handler skips records whose `WhoId`/`WhatId` don't resolve to an LCC entity
  (no guessed rows) and dedups on the SF id, so re-runs are safe.
- Meetings logged as SF **Events** (separate object) aren't covered by the Tasks
  query — a later add can include an Events query → same endpoint if you want
  meetings too.
