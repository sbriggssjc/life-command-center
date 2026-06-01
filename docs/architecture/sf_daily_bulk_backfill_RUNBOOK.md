# Runbook — SF → LCC: Daily Bulk File Backfill (Flow 7)

One-page operator guide for the `SF -> LCC: Daily Bulk File Backfill` Power
Automate flow (id `3d8be768-cfe7-41c9-81f4-e6b6f024ee5e`). Distilled from
`sf_file_backfill_flow6_next_steps.md` (§ "Flow 7"). Pick **Option A** (stop the
daily alert now) or **Option B** (finish the build).

Background: this flow is a clone of the fully-working **Flow 6** (on-demand,
single Comp, validated 2026-05-16). It was left **intentionally off**, half-built —
only the outer "loop over all Comps" is missing. It is currently switched on and
failing daily at `Apply to each`, which is what fires the `flow_failure` alert
(`lcc_health_alerts` on LCC Opps, source `SF -> LCC: Daily Bulk File Backfill`).
The `intake-salesforce-files` edge function (v8, `vertical:"auto"` routing) is
already deployed — **no server changes are required for either option.**

---

## Option A — Turn it OFF (stops the daily alert immediately)

Do this if you don't want to finish the build right now.

1. Go to **make.powerautomate.com** → **My flows** (or the shared environment that
   owns it).
2. Find **`SF -> LCC: Daily Bulk File Backfill`**.
3. Click the **⋯ (More commands)** → **Turn off**. (Or open the flow and toggle
   the status to Off in the top bar.)
4. Confirm the status shows **Off**.

That's it — no more daily 11:26-ish failures. Tell me when it's off and I'll
resolve the open LCC alert (#475). Flow 6 (on-demand single-Comp) stays working
and untouched.

---

## Option B — Finish the build (≈4 clicks, then test)

The inner 6-action chain is already wired and proven (it's the Flow 6 chain). You
only need to wrap it in an outer Comp loop, re-point one filter, and switch the
manifest to auto-routing.

### Pre-check (already true, listed for confidence)
- ✅ Recurrence trigger (Day, every 1 day, Central Time, hour 6)
- ✅ Initialize variable `BatchId`
- ✅ `Get records 2` — Salesforce object `Comps`, Top Count **5** (keep small for
  the first run), Select `Id,Name,Tenant_Name2__c,Property_Type__c`
- ✅ Edge function v8 auto-routing deployed (dia/gov decided server-side)

### Step 1 — Wrap the existing chain in an outer Apply to each over Comps
- Click the **+** just below `Get records 2` → **Control → Apply to each**.
- In "Select an output from previous steps", pick **Get records 2 → value**.
- Rename it **`Apply to each Comp`**.
- Move the existing `Get records` (ContentDocumentLink) **and** the existing
  `Apply to each` (with its 6 inner actions) **inside** this new outer loop —
  drag by the 6-dot handle, or right-click → Cut, then paste inside.

### Step 2 — Re-point the inner ContentDocumentLink filter
Open the (now inner) `Get records` (ContentDocumentLink). Change its Filter Query
from the old manual-trigger reference to the outer loop's Comp Id:
```
LinkedEntityId eq '@{items('Apply_to_each_Comp')?['Id']}'
```
(If you named the outer loop differently, use that name with spaces → underscores.)

### Step 3 — Switch the manifest body to auto-routing + Comp metadata
Open the inner **HTTP / POST File Manifest** action. Remove the existing body chip,
click **fx**, and paste this single expression (it sends `vertical:"auto"` plus the
Comp's tenant / property-type / name so the server can route dia vs gov):
```
json(concat('{"payload_version":"sf-files-2026-05-v4","batch_id":"',variables('BatchId'),'","files":[{"vertical":"auto","linked_entity_type":"Comp__c","linked_entity_sf_id":"',items('Apply_to_each_Comp')?['Id'],'","linked_entity_tenant":"',coalesce(items('Apply_to_each_Comp')?['Tenant_Name2__c'],''),'","linked_entity_property_type":"',coalesce(items('Apply_to_each_Comp')?['Property_Type__c'],''),'","linked_entity_name":"',coalesce(items('Apply_to_each_Comp')?['Name'],''),'","content_version_id":"',first(outputs('Get_records_1')?['body/value'])?['Id'],'","content_document_id":"',items('Apply_to_each')?['ContentDocumentId'],'","title":"',first(outputs('Get_records_1')?['body/value'])?['Title'],'","file_name":"',first(outputs('Get_records_1')?['body/value'])?['PathOnClient'],'","extension":"',first(outputs('Get_records_1')?['body/value'])?['FileExtension'],'","version_number":',string(first(outputs('Get_records_1')?['body/value'])?['VersionNumber']),',"size_bytes":',string(first(outputs('Get_records_1')?['body/value'])?['ContentSize']),',"sf_download_url":"/services/data/v59.0/sobjects/ContentVersion/',first(outputs('Get_records_1')?['body/value'])?['Id'],'/VersionData"}]}'))
```
PA may warn "expression has a problem" — that's the known false positive; click
**Add** anyway.

Then in **Get Upload URL** and **POST File Bytes**, change the hardcoded
`"vertical":"dia"` to the server-routed value:
```
"vertical":"@{first(body('POST_File_Manifest')?['to_fetch'])?['vertical']}"
```
(Match `POST_File_Manifest` to the actual manifest action's card name.)

### Critical gotcha to preserve (carried over from Flow 6)
On the **PUT bytes** action: **Settings → Networking → Content transfer → Allow
chunking = Off**. With chunking on, PA stores 0-byte files. This should already be
off from the clone — verify it.

### Step 4 — Test, then ramp
1. **Save** → **Test** → **Manually** (the recurrence trigger fires immediately on
   manual test; no inputs needed).
2. Ping me — I'll query `sf_files` on **dia** and **gov** for
   `import_batch like 'bulk_backfill_%'` and confirm the 5 Comps' files landed and
   routed to the right vertical.
3. If good: raise `Get records 2 → Top Count` 5 → 100 (manual run, time it) → then
   higher / unlimited.
4. Leave the recurrence trigger **On** for the daily 6am Central run.

### Known follow-ups (don't block go-live)
- Confirm `Tenant_Name2__c` / `Property_Type__c` are the right NorthMarq API names.
- If some gov Comps misroute to dia, extend `GOV_SIGNALS` in
  `supabase/functions/intake-salesforce-files/index.ts`.
- When resuming, also fix the flow's **fault branch** to POST the actual
  failed-action error body into `lcc_record_flow_failure` (today it only sends the
  Logic App run header, so `error_detail` is empty and failures are
  undiagnosable).
