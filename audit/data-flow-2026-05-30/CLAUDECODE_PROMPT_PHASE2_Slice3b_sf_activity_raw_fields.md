# Claude Code — Slice 3b follow-up: /api/sf-activity accepts raw Salesforce Task fields

## Why
The "SF → LCC: Activity Sync" PA flow is simplest if it POSTs the **raw** Salesforce
"Get records (Tasks)" output (no in-flow field mapping). The handler
(`api/_handlers/sf-activity-ingest.js`) currently expects the canonical shape
`{sf_id, type, subject, description, activity_date, who_id, what_id, status}`. Make
each record ALSO accept the raw SF field names so the flow can POST
`{ records: <Get records value array> }` directly.

## The change — `api/_handlers/sf-activity-ingest.js`
In the per-record normalization (before resolving the entity / inserting), accept
either shape, preferring the canonical key when present:
```js
const sfId   = rec.sf_id        ?? rec.Id;
const rawType= rec.type         ?? rec.TaskSubtype ?? rec.Type;     // Call/Email/Task/...
const subject= rec.subject      ?? rec.Subject;
const descr  = rec.description  ?? rec.Description;
const actDate= rec.activity_date?? rec.ActivityDate;
const whoId  = rec.who_id       ?? rec.WhoId;
const whatId = rec.what_id      ?? rec.WhatId;
const status = rec.status       ?? rec.Status;
```
Feed those into the existing type→category map (Call→`call`, Email→`email`,
Meeting→`meeting`, else→`note`) + entity resolution (`whoId` then `whatId` via
`external_identities source_system='salesforce'`) + `appendActivityEvent`
(`sourceType:'salesforce'`, `externalId:sfId`, dedup on the unique index). Behavior
for the canonical shape is unchanged; raw SF records now also work.

Keep `metadata` carrying the useful raw fields (e.g. `{ sf_type: rawType, status,
who_id: whoId, what_id: whatId, activity_date: actDate }`) for the timeline.

## Tests / house rules
Extend `sf-activity-ingest.test.mjs`: a raw SF record (`{Id, Subject, ActivityDate,
TaskSubtype:'Call', WhoId/WhatId}`) resolves + inserts with category `call`; canonical
records still pass; mixed batch works. `node --check`; ≤12 `api/*.js`; suite green.
Ships on the main-app Railway redeploy.
