# Build the "SF → LCC: Record Lookup by ID" Power Automate flow (step by step)

Purpose: a small, reusable flow that LCC calls with a list of Salesforce record IDs (as a ready-made
filter) and gets the requested fields back. LCC "drives the middle" — it computes which IDs it needs and
asks for exactly those. v1 use: fetch `On_Market_Date__c` for the ~560 comps the broad crawl can't reach.

**Why this is shaped this way:** we learned this Salesforce connector's Filter Query is **OData** (`eq`,
`gt`, `contains`, `or`) and does **NOT** support `IN` (that was the `Get_Deals` bug). So LCC sends a
pre-built `Id eq 'a' or Id eq 'b' …` filter and the flow just plugs it in — no expression-building or
quote-escaping for you to hand-write.

## Steps

1. **make.powerautomate.com → My flows → New flow → Instant cloud flow.**
   - Name: `SF -> LCC: Record Lookup by ID`
   - Trigger: search **"When an HTTP request is received"** → select it → Create.

2. **Configure the trigger** (the HTTP request).
   - Click the trigger. In **"Request Body JSON Schema"**, paste:
     ```json
     {
       "type": "object",
       "properties": {
         "object_type": { "type": "string" },
         "fields":      { "type": "string" },
         "filter":      { "type": "string" },
         "request_id":  { "type": "string" }
       }
     }
     ```
   - (Optional but recommended) Under the trigger's **Settings**, you can require a header secret; if you
     prefer, skip for now — the generated URL already carries a SAS token. Tell me if you want the
     shared-secret check and I'll give the exact condition step.
   - The POST **URL is generated only after you Save** (step 6) — you'll copy it then.

3. **Add the Salesforce step.** New step → search **Salesforce** → choose **"Get records"**
   (a.k.a. "List records" / "Get records of type"). Configure:
   - **Salesforce Object Type:** click the field → **"Enter custom value"** → set it to the trigger's
     `object_type`: type `@{triggerBody()?['object_type']}` (or pick *object_type* from Dynamic content).
     (For v1 you may instead just pick **"Comps"** from the dropdown — but the custom value makes it
     reusable for Property/Listing/Account later.)
   - Expand **"Show advanced options"**:
     - **Filter Query:** set to `@{triggerBody()?['filter']}` (pick *filter* from Dynamic content).
     - **Select Query:** set to `@{triggerBody()?['fields']}` (pick *fields*). This limits the returned
       columns to what LCC asked for (e.g. `Id,On_Market_Date__c,CreatedDate`).
   - Leave Top Count / Order By empty.

4. **Add the Response step.** New step → search **"Response"** (under *Request*; it's a premium action —
   your env already uses it elsewhere). Configure:
   - **Status Code:** `200`
   - **Body:**
     ```json
     {
       "records": @{outputs('Get_records')?['body/value']}
     }
     ```
     - To get this right: clear the Body box, type `{ "records": ` then from **Dynamic content** insert
       the **value** (the list of records) output of the Get records step, then type the closing `}`.
       If you don't see a clean "value" token, use the expression
       `outputs('Get_records')?['body/value']` (match the action's actual name — if your Salesforce step
       is named "Get records of type X", adjust the name inside `outputs(' ')`).
   - (Optional) add `"request_id": @{triggerBody()?['request_id']}` to echo it back for logging.

5. **(Optional) Error passthrough.** On the Get records step → **Settings → Configure run after**, or add
   a parallel branch, so a Salesforce error returns a 502 with the message instead of a generic failure.
   Not required for v1.

6. **Save.** Re-open the trigger → copy the **HTTP POST URL** (the long `…/triggers/manual/paths/invoke?…`
   link). Send it to me — it becomes the `SF_RECORD_LOOKUP_URL` env in LCC.

## Test it yourself before handing off (optional but nice)
- Use the flow's **Test → Manually**, then POST a tiny body with 1–2 known comp IDs, e.g.:
  ```json
  { "object_type": "Comp__c",
    "fields": "Id,On_Market_Date__c,CreatedDate",
    "filter": "Id eq 'a1YVs000002sgifMAA' or Id eq 'a1Y8W000004JunVUAS'" }
  ```
  (those two are real comps from the recovery set). A green run returning two records with
  `On_Market_Date__c` confirms it works. If the Filter Query errors, it'll be the same OData syntax class
  as before — send me the message.

## What LCC does with it (so you can picture the whole loop)
LCC computes the comp IDs still missing a date, batches them (~100/call), builds the
`Id eq '…' or Id eq '…'` filter, POSTs to this flow, lands the returned `On_Market_Date__c` in the
retained map, and re-runs the reversible backfill — dating the remaining held listings. Same flow later
serves "look up these specific properties / listings / companies."

## Notes / limits
- **Batch size:** LCC keeps each `filter` to ~100 IDs so the filter string + the connector's 2000-record
  return stay comfortable. You don't manage this — LCC chunks.
- **Permissions:** the existing Salesforce connection already reads `Comp__c`, so no new SF access needed.
- **Security:** the SAS-token URL is the gate for v1; if you want a header secret too, say so and I'll add
  the one-step condition (mirrors how the object-sync flow is protected).
