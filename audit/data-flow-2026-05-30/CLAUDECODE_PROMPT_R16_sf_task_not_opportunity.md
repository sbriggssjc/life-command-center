# Claude Code — R16: SF write model fix — `create_opportunity` = an SF **Task** (NMType), not an Opportunity object

## Why
In NorthMarq's Salesforce there is **no Opportunity object in use**. An
"opportunity" is vernacular for an **open Task/Activity on a Contact** whose
custom **NMType** picklist = `"Opportunity"` (signals a *seller prospect*). Open
status = a call/touchpoint still owed. Buyers/brokers/to-dos = a Task with NMType
blank or another value.

The codebase's ORIGINAL design already had this right — migration
`supabase/migrations/20260423250000_sf_sync_queue_expand_kinds.sql` documents:
> `create_opportunity = create a Task with NMType=Opportunity (per Northmarq's
> NMType picklist convention, not a standard SF Opportunity record)`

But the R5/R7 helper `api/_shared/salesforce.js::createSalesforceOpportunity`
**drifted** to a real-Opportunity payload (`account_id` / `stage_name` /
`amount`). It's never succeeded live (the PA flow has no matching case yet, so it
returns `unsupported`), so there is **no live data to migrate** — this is a clean
correction. Full grounded mapping in
`audit/data-flow-2026-05-30/PA_FLOW_create_opportunity_case_recipe.md`.

Scott's decisions (2026-06-09): Task on **Contact (WhoId)**; Status **"Open"**;
NMType **"Opportunity"** for seller prospects, **blank** for government buyers;
**fire the SF task at contact-selection time** (when WhoId is known), with the
gov-buyer sync as a retry safety-net.

## Unit 1 — `api/_shared/salesforce.js`: Task helper (replaces the Opportunity helper)
Replace `createSalesforceOpportunity` with `createSalesforceTask(task)` (keep a
thin `createSalesforceOpportunity` alias that calls it with `nmType:'Opportunity'`
if any caller is easier left unchanged — but prefer updating callers). Operation
stays `create_opportunity` (PA Switch + sf_sync_queue enum already use it).

POST body to `SF_LOOKUP_WEBHOOK_URL`:
```json
{ "operation": "create_opportunity",
  "who_id": "003…",            // SF Contact Id (WhoId) — REQUIRED
  "subject": "…",
  "nm_type": "Opportunity",    // OMIT or "" for buyers
  "status": "Open",
  "activity_date": "YYYY-MM-DD",   // optional
  "what_id": "001…",           // optional Account (WhatId)
  "idempotency_key": "<bd_opportunity id>" }
```
- Validate `who_id` matches `/^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/`; require `subject`.
- Success parse: accept `{ ok:true, task:{Id} }` **and** `{ ok:true, opportunity:{Id} }`
  (back-compat). Return `{ ok:true, task:{ Id } }`.
- Stay tolerant: missing URL → `{ok:false, reason:'sf_not_configured'}`; flow not
  implementing the case → `{ok:false, reason:'unsupported'}` (callers must treat
  ok:false as non-fatal, never a false success — same posture as today).

## Unit 2 — fire at contact selection (`api/operations.js`)
Both pickers already accept `sf_contact_id` (the SF Contact Id when the chosen
contact came from SF):
- `bridgeSelectBuyerContact` (~L1308) — government **buyer**. After it seeds the
  buy-side cadence + records `primary_contact`, **if `sfContactId` is present**,
  call `createSalesforceTask({ who_id:sfContactId, subject:<parent/opp touchpoint
  name>, nmType: null /* buyer = blank */, status:'Open', whatId:<mapped account>,
  idempotencyKey:<bd_opportunity_id> })`. Best-effort: on `ok:true` write
  `bd_opportunities.sf_opp_id = task.Id` (the 00T id) + stamp
  `metadata.primary_contact.sf_task_id`; on `ok:false` record it and continue
  (never fail the selection, never a false success). If **no** `sfContactId`
  (entity-graph/new contact not yet in SF), skip the task and record
  `sf_task_pending_contact` — do NOT invent a WhoId.
- `bridgeSelectProspectingContact` (~L1420) — seller **prospect**. Same, but
  `nmType:'Opportunity'`. Write the task id onto the cadence/opp the same way.

## Unit 3 — gov-buyer sync becomes a retry safety-net (`api/admin.js` ~L6240–6334)
`handleGovernmentBuyerSync` currently calls the (wrong) `createSalesforceOpportunity`
at the **account** level with no contact. Change it to:
- Only act on `government_buyer` opps that have a resolved **primary contact with an
  `sf_contact_id`** (from `metadata.primary_contact.sf_contact_id` / the buy-side
  cadence `sf_contact_id`) AND no `sf_opp_id` yet.
- For those, call `createSalesforceTask({ who_id, subject, nmType:null, status:'Open',
  whatId:sf_account_id, idempotencyKey:opportunity_id })`; write back `sf_opp_id`
  (the 00T id) idempotently (same double-read guard as today).
- Opps **without** a contact yet → new outcome `hold_no_contact` (not `failed`).
  Update `v_lcc_government_buyer_sync_health` so `ready_to_sync` means "mapped
  account AND primary contact present"; add a `hold_no_contact` state. (Migration
  on LCC Opps; cache-or-live-safe, additive.)
- Net: the SF task is created at contact selection (Unit 2); the sync only mops up
  any opp that has a contact but missed the inline create (retry/idempotent).

## Unit 4 — PA flow case (Scott, classic designer — NOT the remote new designer)
Build the `create_opportunity` Switch case on the live SF lookup flow
`c3744e93-…` per `PA_FLOW_create_opportunity_case_recipe.md` Part B: Salesforce
**Create record → Task** (WhoId, Subject, Status=coalesce(…, 'Open'), **NMType**
= `triggerBody()?['nm_type']` with NO default, ActivityDate, optional WhatId) →
Response `{ ok:true, task:{ Id:@{outputs('Create_record')?['body/Id']} } }`. The
Task field picker reveals the exact **NMType** API name (confirm — Scott's note
~`NM_Type__c`; codebase calls it NMType). **Production flow — Save only when the
case is complete; the new designer froze on the SF metadata fetch, use classic.**

## House rules
`node --check` on every touched file; keep `ls api/*.js | wc -l` ≤ 12 (no new
api/*.js — Units 1-3 edit salesforce.js/operations.js/admin.js); effect-first +
outcome-truthful (a failed SF write never marks success); idempotent on
`idempotency_key`; secrets via env. Report per-unit. Ships on the Railway
redeploy; the PA case (Unit 4) is the cutover that makes `createSalesforceTask`
return ok:true.

## Test
- After deploy + PA case: `select_buyer_contact` on a mapped buyer parent with an
  SF contact → an **open Task on that contact, NMType blank**, `sf_opp_id`=00T id.
  A seller `select_prospecting_contact` → open Task, **NMType=Opportunity**.
- Contact with no SF id → `sf_task_pending_contact`, no SF write, no false success.
- gov-buyer sync: opp without contact → `hold_no_contact`; with contact + no
  sf_opp_id → creates the task once (idempotent on re-tick).
