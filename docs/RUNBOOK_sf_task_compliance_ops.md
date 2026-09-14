# RUNBOOK — three Salesforce Task ops so LCC can own the pursuit list

**Doctrine (Scott, 2026-08-17):** LCC is the **operational source of truth** for
Team Briggs BD. Northmarq requires call logging and open activities in
Salesforce, so SF carries the **minimum compliance artifact and nothing more** —
no enrichment, no extra links, no LCC-derived data pushed across. SF is read
**only to audit compliance**, never as a source of truth.

## The gap these close

Your practice: one open Task per pursued contact, `NM Type = Opportunity` marks a
seller prospect, completed Tasks are the logged calls, you push the open one's
**due date** forward, and you **close** it when you stop pursuing.

| step | LCC before | after |
|---|---|---|
| open the pursuit Task | ✅ `create_opportunity` | ✅ |
| log a completed call | ✅ `logSalesforceActivity` | ✅ |
| **push the due date** | ❌ | ✅ `update_task_due` |
| **close it** | ❌ | ✅ `close_task` |
| audit compliance | ❌ | ✅ `open_tasks_by_owner` (read-only) |

The two you did by hand were exactly the two LCC couldn't do — which is why LCC
couldn't be the source of truth for the pursuit list, only start one.

## Field reference

**`NM Type` → API name `SJC_Type_sjc__c`.** In Object Manager → Task → Fields &
Relationships, search **`SJC`**, not "NM Type". The `SJC_` prefix is almost
certainly a Stan Johnson Company leftover from the Northmarq merge — anything
else carrying it is likely legacy net-lease plumbing too.

Picklist: `--None--`, **Opportunity** (= seller prospect), **Prospect**,
**Execution**, **Client Management**, **Other**.

---

## Paste these three cases into the existing switch

Same flow, same connection — three new cases alongside `create_opportunity`.
Nothing else changes; no new URL, no new env var.

### Case: `update_task_due`

```json
{
  "case": "update_task_due",
  "actions": {
    "Update_Task_Due": {
      "type": "OpenApiConnection",
      "inputs": {
        "parameters": {
          "table": "Task",
          "id": "@triggerBody()?['sf_task_id']",
          "item/ActivityDate": "@triggerBody()?['activity_date']"
        },
        "host": {
          "apiId": "/providers/Microsoft.PowerApps/apis/shared_salesforce",
          "connectionName": "shared_salesforce",
          "operationId": "UpdateItem_V2"
        },
        "authentication": "@parameters('$authentication')"
      }
    },
    "Respond_update_task_due": {
      "runAfter": { "Update_Task_Due": ["Succeeded"] },
      "type": "Response",
      "kind": "Http",
      "inputs": {
        "statusCode": 200,
        "headers": { "Content-Type": "application/json" },
        "body": { "ok": true, "operation": "update_task_due",
                  "task": { "Id": "@{triggerBody()?['sf_task_id']}" } }
      }
    }
  }
}
```

### Case: `close_task`

```json
{
  "case": "close_task",
  "actions": {
    "Close_Task": {
      "type": "OpenApiConnection",
      "inputs": {
        "parameters": {
          "table": "Task",
          "id": "@triggerBody()?['sf_task_id']",
          "item/Status": "@triggerBody()?['status']"
        },
        "host": {
          "apiId": "/providers/Microsoft.PowerApps/apis/shared_salesforce",
          "connectionName": "shared_salesforce",
          "operationId": "UpdateItem_V2"
        },
        "authentication": "@parameters('$authentication')"
      }
    },
    "Respond_close_task": {
      "runAfter": { "Close_Task": ["Succeeded"] },
      "type": "Response",
      "kind": "Http",
      "inputs": {
        "statusCode": 200,
        "headers": { "Content-Type": "application/json" },
        "body": { "ok": true, "operation": "close_task",
                  "task": { "Id": "@{triggerBody()?['sf_task_id']}" } }
      }
    }
  }
}
```

> **⚠ One thing I could not verify:** `operationId: "UpdateItem_V2"`. Your
> `create_opportunity` case uses `PostItem_V2`, so the update twin *should* be
> `UpdateItem_V2` on the same connector generation — but I can't see your
> connector's operation list. **If the designer rejects it**, add the case in the
> UI with the Salesforce **"Update record"** action (Table = `Task`, Record Id =
> `sf_task_id`, and the single field), then send me the exported JSON and I'll
> match it. Everything else here is copied from ops you already run.

### Case: `open_tasks_by_owner` (read-only audit)

```json
{
  "case": "open_tasks_by_owner",
  "actions": {
    "Owner_Filter_SOQL": {
      "type": "Compose",
      "inputs": "@if(empty(triggerBody()?['owner_ids']), '', concat(' AND OwnerId IN (''', join(triggerBody()?['owner_ids'], ''','''), ''')'))"
    },
    "NmType_Filter_SOQL": {
      "runAfter": { "Owner_Filter_SOQL": ["Succeeded"] },
      "type": "Compose",
      "inputs": "@if(equals(triggerBody()?['nm_type'], null), '', concat(' AND SJC_Type_sjc__c = ''', triggerBody()?['nm_type'], ''''))"
    },
    "Get_Open_Tasks": {
      "runAfter": { "NmType_Filter_SOQL": ["Succeeded"] },
      "type": "OpenApiConnection",
      "inputs": {
        "parameters": {
          "queryParameters/query": "SELECT Id, WhoId, WhatId, Subject, Status, ActivityDate, SJC_Type_sjc__c, OwnerId FROM Task WHERE IsClosed = false@{outputs('Owner_Filter_SOQL')}@{outputs('NmType_Filter_SOQL')} ORDER BY ActivityDate ASC"
        },
        "host": {
          "apiId": "/providers/Microsoft.PowerApps/apis/shared_salesforce",
          "connectionName": "shared_salesforce",
          "operationId": "ExecuteSoqlQuery"
        },
        "authentication": "@parameters('$authentication')"
      }
    },
    "Respond_open_tasks": {
      "runAfter": { "Get_Open_Tasks": ["Succeeded"] },
      "type": "Response",
      "kind": "Http",
      "inputs": {
        "statusCode": 200,
        "headers": { "Content-Type": "application/json" },
        "body": { "ok": true, "operation": "open_tasks_by_owner",
                  "tasks": "@body('Get_Open_Tasks')?['records']" }
      }
    }
  }
}
```

That SELECT is the whole audit surface: **eight fields, open tasks only.** It
exists to answer *"is every contact I'm pursuing carrying exactly one open Task?"*
— nothing more. LCC must never write SF state back into itself from it.

---

## Two fixes worth making while you're in the flow

1. **`NMT_Type` is dead code.** In `create_opportunity` it composes
   `@triggerBody()?['operation']` — the string `"create_opportunity"`, not the NM
   Type. It is harmless only because `item/SJC_Type_sjc__c` reads `triggerBody()`
   directly and the Compose is just a `runAfter` dependency. Anyone reading the
   flow would reasonably assume it feeds the field. Delete it, or point it at
   `nm_type`.

2. **The Status default is backwards.**
   `@if(empty(triggerBody()?['status']), 'Completed', triggerBody()?['status'])`
   means an omitted status creates the Task **closed**. LCC always sends `'Open'`
   so it never fires today — but a default of "Completed" on a pursuit record is
   a sharp edge. `'Open'` is the safer default.

---

## LCC side — already shipped

`api/_shared/salesforce.js`:

| function | sends |
|---|---|
| `updateSalesforceTaskDue({ sfTaskId, activityDate })` | id + `ActivityDate` |
| `closeSalesforceTask({ sfTaskId, status })` | id + `Status` |
| `getOpenTasksForCompliance({ ownerIds, nmType })` | read only |

Deliberate behaviours, each covered by a test (`test/sf-task-maintenance.test.mjs`,
11 passing):

- **A missing date is refused, not defaulted.** `createSalesforceTask` falls back
  to today, which is right when *opening* a task and wrong here — it would
  silently re-date a live customer pursuit.
- **Each write sends the id plus exactly one field.** The tests assert the whole
  key set, so any future enrichment leaking into SF fails the build. That is the
  compliance contract, not an optimisation.
- **Malformed owner ids are dropped** before they reach SOQL.
- **Every op no-ops honestly** when `SF_LOOKUP_WEBHOOK_URL` is unset.

## Not wired to the cadence engine yet — deliberately

Nothing calls these automatically. Hooking `updateSalesforceTaskDue` to
`advanceCadence()` and `closeSalesforceTask` to the retire sweep means LCC starts
writing to Salesforce on a schedule, and I would rather you see the ops work by
hand first. Say the word and I will wire them, single-advance-owner style, so one
cadence advance produces exactly one SF update.

---

# LIVE RESULTS — 2026-08-17

## Step 1 `update_task_due` — PASSED, and the write is genuinely minimal

Task `00TVs00001Md5uEMAR` (Bryan Webb / DaVita Snellville), field by field:

| field | before | after |
|---|---|---|
| **Due Date** | 7/28/2026 *(Overdue)* | **9/30/2026** |
| Subject / Name / Assigned To / Related To / Related Deal | — | unchanged |
| **Status** | Open | **Open** |
| NM Type / Action Taken / Deal Activity / Comments / NM Notes | blank | blank |
| Last Modified By | Sarah Martin 7/23 | **Scott Briggs 8/17 4:45 PM** |

Two checks that mattered: **Status stayed `Open`** (the `create_opportunity` case
defaults Status to `'Completed'` when empty — had `UpdateItem_V2` applied the
same default, this pursuit would have silently closed), and the "Overdue" flag
cleared, which is Salesforce recomputing from the new date rather than a second
field being written.

`operationId: "UpdateItem_V2"` — the one thing I could not verify when writing
this runbook — is **confirmed correct** on this connector.

⚠️ `Last Modified By` reads **Scott Briggs**, not an integration user: the flow
runs under Scott's Salesforce connection, so audit trails attribute LCC-driven
updates to him personally. Worth deciding rather than discovering.

## Step 2 `open_tasks_by_owner` — PASSED, and immediately found a live bug

### 🔴 Five Tasks carry the literal string `triggerBody()?['nm_type']` in NM Type

    00TVs00001J4igbMAB  Easterly Government Properties — Government Buyer
    00TVs00001J3iCfMAJ  Easterly Government Properties — Government Buyer
    00TVs00001J3oHzMAJ  Boyd Watterson Global — Government Buyer
    00TVs00001J3HduMAF  Boyd Watterson Global — Government Buyer
    00TVs00001GC1l7MAD  Boyd Watterson Global — Government Buyer

**LCC created all five and LCC was right.** `createSalesforceTask` only sets
`body.nm_type` when truthy, and `admin.js` states the rule: *"a government buyer
carries NMType BLANK (never 'Opportunity')"*. When the key is absent,
`item/SJC_Type_sjc__c: "@triggerBody()?['nm_type']"` resolves to nothing and
Power Automate writes **the expression text itself**. Intent blank, result garbage
— in a compliance field.

Invisible until now because nothing ever read Tasks back. Caught on the audit's
first run, which is the argument for having built it.

**Flow fix** — `create_opportunity`, that one field:

    if(empty(triggerBody()?['nm_type']), null, triggerBody()?['nm_type'])

The 5 existing records need NM Type cleared by hand.

### Audit of the 10 genuine seller prospects (owner 0058W00000FDlFWQA1)

- ✅ **zero contacts carry more than one open Task** — the one-per-contact rule holds
- ⚠️ **9 of 10 have NO due date**, so the due-date discipline is not being
  maintained on these — and it is the signal LCC would drive from
- ⚠️ **two open statuses in play**: 9 `Not Started`, 1 `Open`. `IsClosed = false`
  catches both; anything keying on `Status = 'Open'` would miss nine
- ⚠️ `PORTNEUF ASC - Pocatello, ID - SOLD` (`00T8W00005CI0RdUAL`) is an open
  pursuit on a sold deal — the natural `close_task` test subject

85 open Tasks total for this owner: 70 blank NM Type (marketing/broker),
10 Opportunity, 5 corrupted.
