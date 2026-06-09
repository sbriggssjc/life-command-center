# `create_opportunity` = create an SF **Task** (NMType), not an Opportunity object

**Corrected 2026-06-09 per Scott.** In NorthMarq's Salesforce there is **no
Opportunity object** in use. An "opportunity" is NorthMarq vernacular for an
**open Task/Activity on a Contact** whose custom **NMType** picklist = "Opportunity"
(which signals a *seller prospect*). Open status = a call/touchpoint still owed.
Other NMType values / blank = buyers, brokers, to-dos, etc.

This matches the codebase's ORIGINAL design — migration
`20260423250000_sf_sync_queue_expand_kinds.sql` says verbatim:
> `create_opportunity = create a Task with NMType=Opportunity (per Northmarq's
> NMType picklist convention, not a standard SF Opportunity record)`

The R5/R7 helper `api/_shared/salesforce.js::createSalesforceOpportunity` **drifted**
to a real-Opportunity shape (`account_id` / `stage_name` / `amount`) — that's the
bug. Both the LCC helper AND the PA flow case must target a **Task**.

## Scott's mapping decisions (2026-06-09) — confirmed against the SF UI
The SF surface is the Contact quick action **"Follow Up Only"** (screenshot
2026-06-09): it creates a follow-up **Task** on the contact with fields Subject*,
Due Date*, **NM Type**, Reminder (date/time), Comments. Status is set by the
action (no field in the modal). The PA `create_opportunity` case replicates this
Task.

| Field | Value |
|---|---|
| SF object | **Task** (Activity) — the "Follow Up Only" record |
| Linked to | **Contact** via `WhoId` (the person to call) |
| Status | **"Open"** (confirm the Task Status picklist has "Open"; else "Not Started") |
| Type field | label **"NM Type"**, API name almost certainly **`NM_Type__c`** (confirm in the PA Task field picker) |
| NM Type picklist values | `Opportunity`, `Prospect`, `Execution`, `Client Management`, `Other`, (`--None--`) |
| NM Type — seller prospect | **"Opportunity"** |
| NM Type — government buyer (P-BUYER path) | **--None-- (blank)** per Scott (NOT "Opportunity"). `Prospect`/`Client Management` are available if buyers should later be categorized. |
| Subject | the touchpoint name LCC passes (required) |
| Due Date → ActivityDate | required; close_date if sent, else today/+Nd |
| Comments → Description | optional |
| Reminder | optional (`IsReminderSet` + `ReminderDateTime`) — skip for v1 |
| Drop | `StageName`, `Amount` (real-Opportunity fields, not on Task) |

## Part A — LCC code change (Claude Code; `api/_shared/salesforce.js` + caller)

Rewrite `createSalesforceOpportunity` → create a Task. New POST contract to
`SF_LOOKUP_WEBHOOK_URL` (Switch still branches on `operation`):
```json
{ "operation": "create_opportunity",
  "who_id": "003…",            // SF Contact Id (WhoId) — REQUIRED
  "subject": "Boyd Watterson Global — buy-side touchpoint",
  "nm_type": "Opportunity",    // seller prospect; OMIT/empty for buyers
  "status": "Open",
  "activity_date": "2026-09-07",   // optional; PA defaults
  "what_id": "001…",           // optional Account (WhatId) for context
  "idempotency_key": "<lcc bd_opportunity id>" }
Success: { "ok": true, "task": { "Id": "00T…" } }   // accept opportunity{Id} too for back-compat
```
Caller changes:
- **Gov-buyer sync** (`api/admin.js` handleGovernmentBuyerSync ~6305) must resolve
  a **Contact** (WhoId) before creating the task — buyers get **nm_type omitted**
  (blank). Today it only has the account; the buy-side contact is chosen by the
  **R7 Phase 2.4 P-BUYER contact picker** (`select_buyer_contact`), which
  resolves/creates the SF Contact. **Decision needed:** create the SF Task at
  *contact-selection time* (when WhoId exists) rather than at gov-buyer-open time,
  OR have the sync skip/hold until a primary contact is attached
  (`metadata.primary_contact` / the buy-side cadence `sf_contact_id`). Recommended:
  fire on contact selection — that's when the touchpoint becomes real.
- **Seller prospect path** passes `nm_type:"Opportunity"`.
- Rename the function (e.g. `createSalesforceTask`) or keep the name but fix the
  body; keep `operation:"create_opportunity"` for the PA Switch + the
  `sf_sync_queue` enum that already documents it. (The enum also has a
  `create_task` kind if you'd rather split seller vs buyer by operation instead of
  by an `nm_type` field — either is fine; one operation + nm_type field is simpler.)

## Part B — PA flow case (the SF lookup Switch flow `c3744e93-…`)

⚠️ **Production flow** (live find_account/contact lookups). The new designer
**froze** on the Salesforce metadata fetch during the first attempt (nothing was
saved — prod intact). **Build this case in the CLASSIC designer or Scott's native
browser**, not the remote-driven new designer.

1. Switch → **Add case**, **Equals** = `create_opportunity`.
2. Salesforce **Create record**, Object Type **Task** (the field picker reveals the
   real custom fields incl. **NMType** — confirm its API name here):
   - **WhoId** = `triggerBody()?['who_id']`
   - **Subject** = `triggerBody()?['subject']`
   - **Status** = `coalesce(triggerBody()?['status'], 'Open')`
   - **NM Type** (`NM_Type__c`) = `triggerBody()?['nm_type']` (leave blank when not
     sent — do NOT default to 'Opportunity', or buyer tasks get mistyped). Valid
     values: Opportunity / Prospect / Execution / Client Management / Other.
   - **ActivityDate** = `if(empty(triggerBody()?['activity_date']), utcNow('yyyy-MM-dd'), triggerBody()?['activity_date'])`
   - **WhatId** (optional) = `triggerBody()?['what_id']`
3. **Response** 200:
   ```json
   { "ok": true, "task": { "Id": "@{outputs('Create_record')?['body/Id']}" } }
   ```
4. Leave the Switch **Default** (PostDeadLetter → Terminate) untouched. **Save** only
   when complete.

## Test (after Save — WRITES a real Task; use a test Contact Id, then delete)
```powershell
$b = @{ operation='create_opportunity'; who_id='<TEST Contact Id 003…>';
        subject='LCC test touchpoint — DELETE ME'; nm_type='Opportunity'; status='Open' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "<SF_LOOKUP_WEBHOOK_URL>" -ContentType "application/json" -Body $b
```
Expect `ok=True` + `task.Id` (00T…). Confirm in SF it's an **open Task on the
contact with NMType=Opportunity**. Then run once with `nm_type` omitted → confirm a
blank-NMType task (the buyer shape). Delete both.

## Open question for Scott
- Confirm the exact **NMType** field API name (the PA Task field picker will show
  it). "Custom field, ~NM_Type__c" per your note; codebase calls it **NMType**.
- Confirm where LCC should source the **WhoId Contact** for a gov-**buyer** parent
  (the P-BUYER picker's selected contact is the natural source) and whether the SF
  task should fire at *contact selection* vs the gov-buyer *open*.
