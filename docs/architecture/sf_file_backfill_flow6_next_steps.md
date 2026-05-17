# Flow 6 (`SF -> LCC: On-demand File Backfill`) — Next-Session Notes

**Flow Id:** `aaa452c0-7eb5-4c98-bfe2-f6d872d80639`
**Current state:** Saved, status On, partial functionality.

## What works today

- **Manual trigger** with one input: `Property Id` (Salesforce SObject record Id — accepts any LinkedEntityId, not just Property).
- **`Initialize variable` → BatchId** = `files_backfill_<utcNow()>` (unchanged from the Flow 2 clone).
- **`Get Content Versions`** — despite the legacy name, this action now queries the **`ContentDocumentLink`** SObject with filter
  `LinkedEntityId eq '@{triggerBody()?['text']}'`. Validated to return rows when run against Comp `a1YVs000000sngTMAQ` on the Jurupa Valley DaVita property (`a068W00000FbQDmQAN`). Returns zero rows when run against the Property itself — confirms NorthMarq's convention is that OMs live on the Comp record, not the Property.
- **`Map Files to Manifest`** + **`POST File Manifest`** — wire through; the LCC `intake-salesforce-files?action=manifest` endpoint accepts the call (200), but because Map is still mapping ContentVersion-shaped fields out of ContentDocumentLink rows, all the per-file fields land as `null` and the LCC endpoint returns an empty `to_fetch`.
- **`Apply to each`** — iterates over `to_fetch` from the manifest response. With an empty `to_fetch` array the loop is skipped silently (which is why the failed test run showed Apply to each with `1s` red error: it tried to iterate over what came back, which was malformed).

## The architectural gap

`ContentDocumentLink` carries `Id` + `LinkedEntityId` + `ContentDocumentId` + `ShareType` + `Visibility` — **no `VersionData` URL**, no `Title`, no `FileExtension`, no `ContentSize`. The downstream file pipeline needs all of those. So the current shape (Map a link row directly into a manifest entry) can't possibly produce a working manifest item.

Two architectural options for the fix:

### Option A — Restructure as per-file inner loop (recommended)

Replace the `Map Files to Manifest` + `POST File Manifest` + `Apply to each` trio with a **single** `Apply to each` that iterates directly over `body('Get_Content_Versions')?['value']` (the ContentDocumentLink array). Inside the loop, per link:

1. **`Get ContentVersion for Link`** — Salesforce `Get records` on `ContentVersion`, filter
   `ContentDocumentId eq '@{items('Apply_to_each')?['ContentDocumentId']}' and IsLatest eq true`, Top 1.
2. **`POST File Manifest (single)`** — POST one-item manifest to `intake-salesforce-files?action=manifest`. The item has the real `VersionData` URL, `Title`, `FileExtension`, `ContentSize`, etc.
3. **`Get File Bytes`** — Salesforce Send-HTTP `GET @{first(outputs('Get_ContentVersion_for_Link')?['body/value'])?['VersionData']}`.
4. **`Get Upload URL`** — POST to `intake-salesforce-files?action=upload-url` with the storage path returned from step 2.
5. **`PUT bytes`** — HTTP PUT to the signed URL with `x-upsert: true`.
6. **`POST File Bytes`** — POST to `intake-salesforce-files?action=bytes` to record completion.

This is the cleanest. Each file is one self-contained loop iteration.

### Option B — Replace `Get Content Versions` with a single SOQL `Send-HTTP`

Use the Salesforce connector's **Send an HTTP request to Salesforce** action with this SOQL query (URL-encoded):

```
GET /services/data/v62.0/query?q=SELECT+Id,Title,FileExtension,ContentSize,VersionData,FirstPublishLocationId+FROM+ContentVersion+WHERE+ContentDocumentId+IN+(SELECT+ContentDocumentId+FROM+ContentDocumentLink+WHERE+LinkedEntityId='<propertyId>')+AND+IsLatest=true
```

Returns one record per file, fully populated. Keep the existing Map → POST → Apply pattern but change Map's source to `body('Send_an_HTTP_request_to_Salesforce')?['records']` and the inner refs to match SOQL field names.

Pros: one Salesforce round-trip instead of N+1. Cons: less idiomatic in PA — dynamic content references work differently for Send-HTTP outputs vs Get records.

## NorthMarq behavior notes worth remembering

- **OMs are attached to `Comp__c` records, not `Property__c`.** Spot-checked on Jurupa Valley DaVita — Property has zero file links; the corresponding Comp (`a1YVs000000sngTMAQ`) has them.
- **The PA Salesforce connector "Get records" Filter Query is OData**, not SOQL: `eq` / `ge` / `le`, not `=` / `>=` / `<=`. Booleans like `IsLatest eq true` work either way, but strings absolutely need `eq`.
- **`ContentVersion.FirstPublishLocationId` is NOT a reliable parent record reference** — it's typically the user's library where the file was first uploaded. Always go through `ContentDocumentLink` to find a file's parent records.

## State of `intake-salesforce-files` edge function (no changes needed)

All three actions are deployed v5 ACTIVE and proven by Flow 6's POST File Manifest call (200 response):

- `?action=manifest` — accepts file metadata array, dedupes, returns `to_fetch`
- `?action=upload-url` — mints Supabase Storage signed upload URL
- `?action=bytes` — records bytes received (storage_path or base64; 6MB cap on base64 path)

## To resume

### Updated state of Flow 6 (after the 2026-05-15 session ending here):

**`Get records`** is configured correctly and queries:
- Salesforce Object Type: `Content Document Link`
- Filter Query: `LinkedEntityId eq '@{triggerBody()?['text']}'`
- Select Query: `Id,ContentDocumentId,LinkedEntityId,ContentDocument/Id,ContentDocument/LatestPublishedVersionId,ContentDocument/Title,ContentDocument/FileExtension,ContentDocument/ContentSize`

Tested live — returns proper rows for Comp `a1YVs000000sngTMAQ` with nested `ContentDocument` data containing `LatestPublishedVersionId` and friends. **This is the key insight: the relationship-expand in the `select` field gives us everything in a single round-trip, no nested loop needed.**

**`Map Files to Manifest`** is currently in a broken state. The Select action's parameter editor stored each value as a stringified template `@{expr}` which it then concatenates into one giant string for the `select` property — not the object literal that Select needs. PA refuses to save: *"Invalid parameter for 'Map Files to Manifest'. Error: Enter a valid JSON."*

### Recommended fix when resuming:

After three attempted approaches this session, the path that actually works in PA is:

**Restructure as a per-link inner loop** with a nested `Get records` call against `ContentVersion` inside. This is the proper two-step pattern. Everything else has been ruled out:

| Attempt | What we tried | Why it failed |
|---|---|---|
| 1 | `Map Files to Manifest` (Select action) mapping ContentDocumentLink fields directly | ContentDocumentLink doesn't carry `Title`, `VersionData`, etc. — fields all null. |
| 2 | `Get records` with Select Query `ContentDocument/LatestPublishedVersionId,...` | PA Salesforce connector rejects multi-level paths in `$select`: *"Found a path with multiple navigation properties or a bad complex property path in a select clause."* |
| 3 | `Compose` action with `select(..., createObject(...))` | `createObject` is not a defined PA WDL function. *"The template function 'createObject' is not defined or not valid."* |

So the two-step structure is required. Final shape:

```
Manually trigger a flow (Property Id input)
↓
Initialize variable (BatchId)
↓
Get records (Content Document Link)
  Filter Query: LinkedEntityId eq '@{triggerBody()?['text']}'
  (No Select Query — leave default)
↓
Apply to each [body('Get_records')?['value']]
  ↓ inside the loop, per link:
  Get records (Content Versions)
    Filter Query: ContentDocumentId eq '@{items('Apply_to_each')?['ContentDocumentId']}' and IsLatest eq true
    Top Count: 1
  ↓
  POST File Manifest (single-item)
    Body: @addProperty(
      json(concat('{"payload_version":"sf-files-2026-05-v1","batch_id":"',variables('BatchId'),'"}')),
      'files',
      array(createObject_via_addProperty_chain_or_inline_json(
        first(outputs('Get_Content_Versions')?['body/value'])
      ))
    )
  ↓
  Get File Bytes (Salesforce Send-HTTP)
    URI: /services/data/v59.0/sobjects/ContentVersion/@{first(outputs('Get_Content_Versions')?['body/value'])?['Id']}/VersionData
  ↓
  Get Upload URL (intake-salesforce-files?action=upload-url)
  ↓
  PUT bytes (HTTP)
  ↓
  POST File Bytes (intake-salesforce-files?action=bytes)
```

### Current state of Flow 6 on the server (end of third session)

Structural rebuild completed AND first inner HTTP action wired. Test run against Comp `a1YVs000000sngTMAQ`:
- Get records (ContentDocumentLink, filter LinkedEntityId eq Property Id) → **0.4s, 2 rows** ✓
- Apply to each over those rows → **2s, "1 of 2" iterations** ✓
- Inner Get records 1 (ContentVersion, filter ContentDocumentId eq `items('Apply_to_each')?['ContentDocumentId']` AND IsLatest eq true, Top 1) → **0.5s** ✓
- Inner HTTP POST File Manifest → **0.4s, Succeeded** ✓ (returned 2xx)

The five-action structural chain (discovery + per-link fetch + manifest post) is wired and accepted by the LCC endpoint.

**Resolved 2026-05-15:** The reason no row appeared in `sf_files` despite the manifest POST returning 2xx was a Postgres `42P10` error inside the endpoint — *not* a body issue. The handler used `?on_conflict=content_version_id,source_system` to deduplicate, but the matching unique index `uq_sf_files_version` is **PARTIAL** (`WHERE content_version_id IS NOT NULL`), and PostgREST's `on_conflict` shortcut can't target partial unique indexes. Every insert was rejected with `there is no unique or exclusion constraint matching the ON CONFLICT specification`, and the endpoint silently incremented its `errors` counter while still returning `ok:false`. The `ok` field was being ignored upstream.

**Fix (deployed v6 ACTIVE):** Removed the `on_conflict` shortcut from `handleManifest()` in `supabase/functions/intake-salesforce-files/index.ts`. Application-level dedup via the `existing` lookup is already sufficient — the on_conflict was redundant. The handler now also returns an `insert_errors` array for visibility on any future failures. Verified end-to-end via direct curl: a fake manifest payload posted at v6 inserted `file_id:2` into `sf_files` and the response correctly reported `discovered:1, errors:0`. The bug applied to both `dia` and `gov` DBs (same partial index in both).

The current Flow 6 (5-action chain through POST File Manifest) should now begin populating `sf_files` rows when re-run against Comp `a1YVs000000sngTMAQ`. Re-test before adding more inner actions.

**2026-05-15 follow-up — verified end-to-end:** Re-ran Flow 6 against Comp `a1YVs000000sngTMAQ` after the v6 deploy. Two rows landed in `sf_files`:

| file_id | content_version_id | title | size_bytes | ingestion_status |
|---|---|---|---|---|
| 5 | 068Vs00000IbTlVIAV | DaVita Dialysis - Jurupa Valley - CA - OM | 6,473,114 | discovered |
| 6 | 068Vs00000OOUonIAH | DaVita Dialysis - Jurupa Valley - CA - OM - Updated | 6,417,997 | discovered |

**Initial gap caught + patched:** the first verified test had `linked_entity_type` and `linked_entity_sf_id` set to NULL because the manifest body didn't pass them. The storage path scheme (`salesforce/<entity_type>/<entity_sf_id>/<doc>/<ver>/<file>`) would have collapsed to `salesforce/unknown/unknown/...`. Patched the manifest expression in Flow 6's HTTP body to include:

```
"vertical":"dia","linked_entity_type":"Comp__c","linked_entity_sf_id":"',items('Apply_to_each')?['LinkedEntityId'],'"
```

After patch + re-test, both rows now carry `linked_entity_type:"Comp__c"` and `linked_entity_sf_id:"a1YVs000000sngTMAQ"` — confirmed via Supabase query. (Note: `Comp__c` is hardcoded; future improvement is to derive entity type from the SF ID prefix or the connector's `LinkedEntityType` field, so the same flow can run against Property__c, Listing__c, etc. without per-flow changes.)

PA's static validator flagged "This expression has a problem" on the Add dialog — false positive (the schema for `ContentDocumentLink.LinkedEntityId` isn't part of PA's typed model). The expression evaluated correctly at runtime.

### Working with Monaco editor in PA via Chrome MCP — gotchas learned

- Monaco's textarea (`.monaco-editor textarea.inputarea`) is virtualized — only visible lines are in the DOM via `.view-line`. Reading `.value` only returns visible-window content (~few hundred chars), not the full model.
- `document.execCommand` and synthetic `ClipboardEvent` paste events DON'T reach Monaco's command queue.
- Long `computer:type` actions timed out at 30s on a 932-char string — Monaco can't keep up with the CDP keystroke stream past a few hundred chars.
- The path that worked: delete the entire `json(…)` chip from the Body field by clicking its `×`, then click the `fx` insert-expression button to open a fresh empty editor, click into the editor body, and `Ctrl+V` from a clipboard prepared via `navigator.clipboard.writeText(...)`. PA accepts the paste cleanly. Click `Add` to commit (even if the static validator complains).

### POST File Manifest inner action — saved config

- URI: `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/intake-salesforce-files?action=manifest`
- Method: POST
- Headers: `Content-Type: application/json`, `X-PA-Webhook-Secret: <hex secret>`
- Body (rendered as a `json(...)` chip):

```
@{json(concat('{
  "payload_version":"sf-files-2026-05-v1",
  "batch_id":"',variables('BatchId'),'",
  "files":[{
    "content_version_id":"',first(outputs('Get_records_1')?['body/value'])?['Id'],'",
    "content_document_id":"',items('Apply_to_each')?['ContentDocumentId'],'",
    "title":"',first(outputs('Get_records_1')?['body/value'])?['Title'],'",
    "file_name":"',first(outputs('Get_records_1')?['body/value'])?['PathOnClient'],'",
    "extension":"',first(outputs('Get_records_1')?['body/value'])?['FileExtension'],'",
    "version_number":',string(first(outputs('Get_records_1')?['body/value'])?['VersionNumber']),',
    "size_bytes":',string(first(outputs('Get_records_1')?['body/value'])?['ContentSize']),',
    "sf_download_url":"/services/data/v59.0/sobjects/ContentVersion/',first(outputs('Get_records_1')?['body/value'])?['Id'],'/VersionData"
  }]
}'))}
```

The expression parses cleanly and PA collapses it to a `json(...)` chip. Add a `"vertical":"dia",` entry inside the file object (or as a top-level payload field) if the next test still produces empty `sf_files`.

### Remaining inner actions (5 to add inside Apply to each, after Get records 1)

All five mirror Flow 2's original inner-loop pattern, just adapted for single-file shape:

1. **`POST File Manifest`** (HTTP, body sends ONE file's metadata):
   - URI: `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/intake-salesforce-files?action=manifest`
   - Headers: `Content-Type: application/json`, `X-PA-Webhook-Secret: <secret>`
   - Body:
     ```
     @addProperty(
       json(concat('{"payload_version":"sf-files-2026-05-v1","batch_id":"', variables('BatchId'), '"}')),
       'files',
       array(createArray(
         json(concat(
           '{"content_version_id":"', first(outputs('Get_records_1')?['body/value'])?['Id'], '",',
           '"content_document_id":"', items('Apply_to_each')?['ContentDocumentId'], '",',
           '"title":"', first(outputs('Get_records_1')?['body/value'])?['Title'], '",',
           '"file_name":"', first(outputs('Get_records_1')?['body/value'])?['PathOnClient'], '",',
           '"extension":"', first(outputs('Get_records_1')?['body/value'])?['FileExtension'], '",',
           '"version_number":', string(first(outputs('Get_records_1')?['body/value'])?['VersionNumber']), ',',
           '"size_bytes":', string(first(outputs('Get_records_1')?['body/value'])?['ContentSize']), ',',
           '"sf_download_url":"/services/data/v59.0/sobjects/ContentVersion/', first(outputs('Get_records_1')?['body/value'])?['Id'], '/VersionData"}'
         ))
       ))
     )
     ```
   - Note: if title or filename contains quotes, this will fail JSON parsing. May need `replace(...,'"','\"')` wrapping. Worth testing first without to see how SF data behaves.

2. **`Get File Bytes`** (Salesforce "Send an HTTP request" — but if that action isn't available, use a generic HTTP GET):
   - PA Salesforce connector might not expose "Send HTTP request to Salesforce" — Flow 2's pattern used `body('POST_File_Manifest')?['to_fetch'][0]?['sf_download_url']` which is now `first(body('POST_File_Manifest')?['to_fetch'])?['sf_download_url']`.
   - Actually simpler: use generic HTTP, but it'd need SF OAuth. The SF connector handles this. Look in the action list for any Salesforce action whose URL field accepts raw paths.
   - Fallback: use the Salesforce connector's "Get records" or "Update record" pattern, which won't return raw file bytes. May need to mint the connector's `Send an HTTP request to Salesforce` action which previously couldn't be found by name — try searching for "Salesforce custom action" or "Salesforce Invoke" or look under "See all" for the Salesforce connector. The Flow 2 file move flow used this action successfully, so it's available somewhere in the connector.

3. **`Get Upload URL`** (HTTP POST to intake-salesforce-files?action=upload-url):
   - URI: `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/intake-salesforce-files?action=upload-url`
   - Body:
     ```
     @addProperty(
       json(concat('{"content_version_id":"', first(outputs('Get_records_1')?['body/value'])?['Id'], '","vertical":"dia"}')),
       'file_name',
       first(outputs('Get_records_1')?['body/value'])?['PathOnClient']
     )
     ```

4. **`PUT bytes`** (HTTP PUT, body is bytes from Get File Bytes):
   - URI: `@{body('Get_Upload_URL')?['upload_url']}`
   - Headers: `x-upsert: true`
   - Body: `@{body('Get_File_Bytes')}`

5. **`POST File Bytes`** (HTTP POST to intake-salesforce-files?action=bytes):
   - URI: `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/intake-salesforce-files?action=bytes`
   - Body:
     ```
     @{addProperty(
       json('{"vertical":"dia"}'),
       'storage_path',
       body('Get_Upload_URL')?['storage_path']
     )}
     ```

### Test expectation

After adding all 5 inner actions, run against Comp `a1YVs000000sngTMAQ`. Expected:
- Both files end up in the `salesforce-files` storage bucket on Dialysis_DB
- Two rows in `sf_files` tracking the storage paths
- Files have `%PDF-1.x` header (binary, not base64 ASCII)
- The OM is one of the two files

### Test target

Run against Comp `a1YVs000000sngTMAQ` (Jurupa Valley DaVita OM). Expected outcome:
- File lands in `salesforce-files` bucket with header `%PDF-1.x` (binary, not base64 ASCII)
- One row in `sf_files` table on Dialysis_DB pointing at it
- LCC sees the OM in storage as `salesforce-files/<date>/<uuid>-DaVita-Dialysis-...pdf`

### 2026-05-16 — Flow 6 fully validated end-to-end

The Jurupa Valley DaVita Comp test passed completely. Two OMs ingested:

| file_id | content_version_id | storage_path | size_bytes | header |
|---|---|---|---|---|
| 11 | 068Vs00000IbTlVIAV | salesforce/Comp__c/a1YVs000000sngTMAQ/069Vs00000ILqCcIAL/068Vs00000IbTlVIAV/DaVita_Dialysis_-_Jurupa_Valley_-_CA_-_OM.pdf | 6,473,114 | `%PDF-1.6` |
| 12 | 068Vs00000OOUonIAH | …069Vs00000O1y61IAB/068Vs00000OOUonIAH/DaVita_Dialysis_-_Jurupa_Valley_-_CA_-_OM_-_Updated.pdf | 6,417,997 | (verified by size) |

Both rows: `ingestion_status:"stored"`, `extraction_status:"queued"`. Bucket eTags are multi-part (`-2` suffix), confirming Supabase Storage uploaded the bytes via TUS chunking from the PUT signed URL.

### Three additional bugs caught + patched after the first end-to-end run

1. **Edge-function `?action=upload-url` was not idempotent.** Re-runs hit `"Signed-URL mint failed: The resource already exists"` because Supabase's `/object/upload/sign/` endpoint refuses when the object exists from a prior partial run. **Fix (v7 deploy):** best-effort `DELETE /object/<bucket>/<path>` before minting the signed URL. Now safe to re-run the flow against the same Comp.

2. **First successful end-to-end run wrote 0-byte files.** PA's HTTP PUT action defaulted to **chunked transfer mode** (`transferMode: "Chunked"`), which begins with an initiating request expecting a `Location` header back. Supabase signed-upload URLs return the bytes endpoint directly with no `Location` header on the first POST, so PA aborted with `"The response to partial content upload initiating request is not valid. The response to initiating partial content upload request must contain a valid location header."` and silently stored 0 bytes. **Fix:** PUT bytes → Settings tab → Networking → Content transfer → Allow chunking = **Off**. After this, the bytes flow as a single PUT and Supabase happily stores the full payload (multi-part eTag was actually internal TUS chunking on Supabase's side, not PA).

3. **(Already documented above)** Partial unique index broke manifest `on_conflict`; missing `linked_entity_*` in manifest body. Both fixed.

### Final inner-action chain for Flow 6 (locked-in shape)

```
Manually trigger a flow (Property Id input — accepts any LinkedEntityId)
↓
Initialize variable BatchId = files_backfill_<utcNow()>
↓
Get records (ContentDocumentLink, filter LinkedEntityId eq trigger input)
↓
Apply to each [body('Get_records')?['value']]
  ↓ inside the loop, per link:
  Get records 1 (ContentVersion by ContentDocumentId, IsLatest=true, Top 1)
  ↓
  HTTP — POST File Manifest
    POST <DIA>/functions/v1/intake-salesforce-files?action=manifest
    Body: { payload_version, batch_id, files:[{vertical:"dia", linked_entity_type:"Comp__c",
            linked_entity_sf_id, content_version_id, content_document_id, title, file_name,
            extension, version_number, size_bytes, sf_download_url }] }
  ↓
  Send an HTTP request (Salesforce connector) — Get File Bytes
    GET /services/data/v59.0/sobjects/ContentVersion/<id>/VersionData
  ↓
  Get Upload URL (HTTP)
    POST <DIA>/functions/v1/intake-salesforce-files?action=upload-url
    Body: {"vertical":"dia","content_version_id":"<id>"}
  ↓
  PUT bytes (HTTP)
    PUT body('Get_Upload_URL')?['upload_url']
    Header: x-upsert: true
    Body: body('Send_an_HTTP_request')      ← the Salesforce binary body
    Settings: Allow chunking = OFF  ← critical
  ↓
  POST File Bytes (HTTP)
    POST <DIA>/functions/v1/intake-salesforce-files?action=bytes
    Body: {"vertical":"dia","content_version_id":"<id>","storage_path":"<from Get_Upload_URL>"}
```

### Next steps (now that Flow 6 is shipped)

- **Generalize `linked_entity_type:"Comp__c"`** — currently hardcoded. Derive from the SF Id prefix or pass via trigger input so the flow works against Property__c, Listing__c, Opportunity, etc.
- **sha256 + size_bytes finalization** — the `?action=bytes` endpoint receives `storage_path` but not `sha256` or actual byte length. Currently those columns are NULL on the stored rows. Either: (a) hash on the client side in PA before POST (expensive in PA), or (b) have the edge function HEAD the just-uploaded object to fill `size_bytes` and stream-hash. Option (b) is cleaner.
- **Extraction pipeline** — rows are now sitting at `extraction_status:"queued"`. Hook up the actual OM text extractor next.
- **Pursue Connected App path async** — when someone with SF admin perms can set up the OAuth Client Credentials Flow, the `?action=fetch` server-side endpoint becomes available and Flow 6 can collapse from 6 inner actions to 1.

---

## Flow 7 — Daily Bulk SF File Backfill (spec)

**Goal:** Walk every NorthMarq Comp with files attached daily, run the discovery + manifest + byte-move chain, and let the LCC manifest endpoint auto-route each file to the right vertical DB (dia vs gov) based on tenant/property-type signals.

**Status as of 2026-05-16:** Auto-routing landed in edge function v8 (smoke-tested with one dia and one gov file — both routed correctly). PA flow shell cloned from Flow 6 as `SF -> LCC: Daily Bulk File Backfill` (flow id `3d8be768-cfe7-41c9-81f4-e6b6f024ee5e`), currently off. Trigger restructure + outer Comp loop still to be wired.

### Edge function v8 — auto-routing contract

Manifest endpoint now supports `vertical:"auto"` per file. When `auto` (or missing), it routes based on signals from:
- `linked_entity_tenant` (e.g. "DaVita Dialysis", "United States of America / GSA")
- `linked_entity_property_type` (e.g. "Medical Office", "Government Office")
- `linked_entity_name` (the Comp/Property/Listing name)
- `title` (the file's SF Title)
- `file_name` (the file's filename)

Dia signals: `dialysis, davita, fresenius, renal, kidney, clinic, nephrology`.
Gov signals: `gsa, federal, government, u.s., department of, veterans, social security`.
Default fallback: dia.

### Flow 7 structure (target)

```
Recurrence trigger (Daily, 6:00 AM Central / 12:00 UTC)
↓
Initialize variable BatchId = bulk_backfill_<utcNow()>
↓
Get records — Comp__c
  Filter Query: (none initially; add later to narrow scope)
  Select Query: Id, Name, Tenant_Name2__c, Property_Type__c
  Top Count: 100  (start small; raise after first successful run)
  Order By: LastModifiedDate desc
↓
Apply to each Comp [body('Get_Comps')?['value']]
  ↓ per Comp:
  Get records — ContentDocumentLink
    Filter Query: LinkedEntityId eq '@{items('Apply_to_each')?['Id']}'
    Top Count: 200
  ↓
  Apply to each Link [body('Get_ContentDocumentLinks')?['value']]
    ↓ per link, same 6 inner actions as Flow 6, but with auto-routing in the manifest body
    Get records 1 — ContentVersion
      Filter Query: ContentDocumentId eq '@{items('Apply_to_each_2')?['ContentDocumentId']}' and IsLatest eq true
      Top Count: 1
    ↓
    HTTP — POST File Manifest
      Body (json):
      {
        "payload_version": "sf-files-2026-05-v4",
        "batch_id": "<BatchId>",
        "files": [{
          "vertical": "auto",          ← NEW: was "dia", now signal-routed
          "linked_entity_type": "Comp__c",
          "linked_entity_sf_id": "<items('Apply_to_each')?['Id']>",
          "linked_entity_tenant": "<items('Apply_to_each')?['Tenant_Name2__c']>",       ← NEW
          "linked_entity_property_type": "<items('Apply_to_each')?['Property_Type__c']>", ← NEW
          "linked_entity_name": "<items('Apply_to_each')?['Name']>",                     ← NEW
          "content_version_id": "<first(outputs('Get_records_1')?['body/value'])?['Id']>",
          "content_document_id": "<items('Apply_to_each_2')?['ContentDocumentId']>",
          "title": "<first(...)?['Title']>",
          "file_name": "<first(...)?['PathOnClient']>",
          "extension": "<first(...)?['FileExtension']>",
          "version_number": <first(...)?['VersionNumber']>,
          "size_bytes": <first(...)?['ContentSize']>,
          "sf_download_url": "/services/data/v59.0/sobjects/ContentVersion/<id>/VersionData"
        }]
      }
    ↓
    Send an HTTP request — Get File Bytes
      (same as Flow 6 — GET VersionData)
    ↓
    Get Upload URL — HTTP POST
      Body: {"vertical":"<body('POST_File_Manifest')?['to_fetch'][0]?['vertical']>", "content_version_id":"<id>"}
      ← Note: pull vertical from the manifest response, NOT from the manifest body, because the routed vertical is server-decided
    ↓
    PUT bytes — HTTP PUT
      (same as Flow 6 — chunking OFF in Settings)
    ↓
    POST File Bytes — HTTP POST
      Body: {"vertical":"<body('POST_File_Manifest')?['to_fetch'][0]?['vertical']>", "content_version_id":"<id>", "storage_path":"<body('Get_Upload_URL')?['storage_path']>"}
```

### Concrete copy-paste expressions for Flow 7 manifest body

The full JSON body expression (paste into PA expression editor via clipboard):

```
json(concat('{"payload_version":"sf-files-2026-05-v4","batch_id":"',variables('BatchId'),'","files":[{"vertical":"auto","linked_entity_type":"Comp__c","linked_entity_sf_id":"',items('Apply_to_each')?['Id'],'","linked_entity_tenant":"',coalesce(items('Apply_to_each')?['Tenant_Name2__c'],''),'","linked_entity_property_type":"',coalesce(items('Apply_to_each')?['Property_Type__c'],''),'","linked_entity_name":"',coalesce(items('Apply_to_each')?['Name'],''),'","content_version_id":"',first(outputs('Get_records_1')?['body/value'])?['Id'],'","content_document_id":"',items('Apply_to_each_2')?['ContentDocumentId'],'","title":"',first(outputs('Get_records_1')?['body/value'])?['Title'],'","file_name":"',first(outputs('Get_records_1')?['body/value'])?['PathOnClient'],'","extension":"',first(outputs('Get_records_1')?['body/value'])?['FileExtension'],'","version_number":',string(first(outputs('Get_records_1')?['body/value'])?['VersionNumber']),',"size_bytes":',string(first(outputs('Get_records_1')?['body/value'])?['ContentSize']),',"sf_download_url":"/services/data/v59.0/sobjects/ContentVersion/',first(outputs('Get_records_1')?['body/value'])?['Id'],'/VersionData"}]}'))
```

(`coalesce(..., '')` guards against NULL tenants/property types — important when Comp records have incomplete data.)

### Trigger setup

Power Automate Recurrence trigger config:
- Frequency: Day
- Interval: 1
- Time zone: Central Standard Time
- Start time: pick any past 6:00 AM CST date so the first auto-run fires at 6am tomorrow
- (Or skip the schedule until ready and just keep the manual trigger for now to test)

### Test plan

1. Initial test: keep Top Count: 5 on the Comp__c query, run manually. Verify 5 Comps × (avg files) end up in the right vertical's sf_files table.
2. Spot-check one dia and one gov route by inspecting `linked_entity_tenant` on the resulting rows.
3. Raise Top Count to 100, manual run. Time it.
4. If runtime stays under 5 min, raise to 500, then full org with no Top Count.
5. Turn the scheduled trigger ON.

### Flow 7 in-progress state (2026-05-16, end-of-session)

What's wired in PA so far (saved + valid):
- ✅ Recurrence trigger (Day, every 1 day, Central Time (US & Canada), hour 6)
- ✅ Initialize variable BatchId (preserved from clone)
- ✅ **Get records 2** — Salesforce Object Type: `Comps`, Top Count: 5, Select Query: `Id,Name,Tenant_Name2__c,Property_Type__c`
- ❌ (still) Get records — ContentDocumentLink action still has its old `triggerBody()?['text']` filter from when this flow was cloned (manual trigger). Must be re-pointed to the outer Comp loop's item Id.
- ❌ (still) Apply to each — its 6 inner actions are intact (Get records 1, HTTP/POST File Manifest, Send an HTTP request/Get File Bytes, Get Upload URL, PUT bytes, POST File Bytes), BUT not yet wrapped in an outer Comp loop, AND the manifest body still hardcodes `vertical:"dia"` instead of `vertical:"auto"` + Comp metadata.

### Three remaining manual steps in PA (~1 minute total in PA UI)

**Step 1 — Wrap the existing Get records + Apply to each in an outer Apply to each over Comps.**

In the canvas, click the `+` just below `Get records 2`. Add a `Control → Apply to each` action. In its "Select an output from previous steps" field, pick **Get records 2 → value** (the Comps array). Rename it to "Apply to each Comp" for clarity.

Now you have an empty outer Apply to each. The two existing actions below (`Get records` and the existing `Apply to each` with 6 inner actions) need to move INSIDE this new outer loop.

**Drag-drop method (fastest):** In PA's v3 designer, hover over each action card to reveal a 6-dot drag handle on its left edge. Drag the existing `Get records` card and drop it inside the new outer Apply to each (the drop target shows as a blue dashed outline). Then do the same with the existing `Apply to each` card. Both should land inside the outer Apply to each Comp.

**Cut-paste alternative if drag-drop fights you:** Right-click each action → Cut. Click the `+` inside the outer Apply to each. Paste.

**Step 2 — Re-point the inner Get records (ContentDocumentLink) filter.**

Click into the (now inner) Get records (ContentDocumentLink) action. Its Filter Query currently reads:

```
LinkedEntityId eq '@{triggerBody()?['text']}'
```

Replace `triggerBody()?['text']` with `items('Apply_to_each_Comp')?['Id']`:

```
LinkedEntityId eq '@{items('Apply_to_each_Comp')?['Id']}'
```

(If you renamed your outer Apply to each to something different, swap `Apply_to_each_Comp` for that internal name. Internal action names use underscores in place of spaces.)

**Step 3 — Update the manifest body for auto-routing.**

Click into the inner HTTP action (POST File Manifest). Delete the existing `json(...)` chip from the Body field by clicking its `×`. Click `fx` to open the expression editor. Paste this expression (full body with auto-routing + Comp metadata):

```
json(concat('{"payload_version":"sf-files-2026-05-v4","batch_id":"',variables('BatchId'),'","files":[{"vertical":"auto","linked_entity_type":"Comp__c","linked_entity_sf_id":"',items('Apply_to_each_Comp')?['Id'],'","linked_entity_tenant":"',coalesce(items('Apply_to_each_Comp')?['Tenant_Name2__c'],''),'","linked_entity_property_type":"',coalesce(items('Apply_to_each_Comp')?['Property_Type__c'],''),'","linked_entity_name":"',coalesce(items('Apply_to_each_Comp')?['Name'],''),'","content_version_id":"',first(outputs('Get_records_1')?['body/value'])?['Id'],'","content_document_id":"',items('Apply_to_each')?['ContentDocumentId'],'","title":"',first(outputs('Get_records_1')?['body/value'])?['Title'],'","file_name":"',first(outputs('Get_records_1')?['body/value'])?['PathOnClient'],'","extension":"',first(outputs('Get_records_1')?['body/value'])?['FileExtension'],'","version_number":',string(first(outputs('Get_records_1')?['body/value'])?['VersionNumber']),',"size_bytes":',string(first(outputs('Get_records_1')?['body/value'])?['ContentSize']),',"sf_download_url":"/services/data/v59.0/sobjects/ContentVersion/',first(outputs('Get_records_1')?['body/value'])?['Id'],'/VersionData"}]}'))
```

Click Add. PA may flag "expression has a problem" (false positive — same as Flow 6). Click Add anyway.

Then update the `Get Upload URL` and `POST File Bytes` bodies to pull the routed vertical from the manifest response instead of hardcoded "dia". Change `"vertical":"dia"` in both bodies to `"vertical":"@{first(body('POST_File_Manifest')?['to_fetch'])?['vertical']}"`. (Action name `POST_File_Manifest` should match whatever the canvas shows for the HTTP/POST File Manifest action — verify by checking that action's card title.)

**Step 4 — Test.**

Save. Click Test. Run flow manually (no inputs needed — the recurrence trigger fires immediately on manual test). After ~30-60 sec, query `sf_files` on both dia and gov DBs to verify the 5 Comps × their files were processed and routed correctly:

```bash
# Dia
curl -s -H "apikey: $DIA_SUPABASE_KEY" -H "Authorization: Bearer $DIA_SUPABASE_KEY" \
  "$DIA_SUPABASE_URL/rest/v1/sf_files?import_batch=like.bulk_backfill_*&order=discovered_at.desc&limit=20"
# Gov
curl -s -H "apikey: $GOV_SUPABASE_KEY" -H "Authorization: Bearer $GOV_SUPABASE_KEY" \
  "$GOV_SUPABASE_URL/rest/v1/sf_files?import_batch=like.bulk_backfill_*&order=discovered_at.desc&limit=20"
```

If happy, raise `Get records 2 → Top Count` from 5 → 100 → eventually unlimited. Turn the flow ON to enable the daily recurrence.

### Open follow-ups after Flow 7 is live

- The Comp__c query above uses `Tenant_Name2__c` and `Property_Type__c` — confirm these are the correct API names for NorthMarq (intake-salesforce/sf-config.ts has these as the first candidates, confirmed against `a1Y8W000004JrP3UAK`).
- If gov routing misses some Comps (because `Tenant_Name2__c` doesn't contain "government" / "GSA" etc.), extend the GOV_SIGNALS list in `intake-salesforce-files/index.ts` OR pass an additional signal field (e.g. the boolean "government as tenant" field Scott mentioned in chat — schema TBD).
- After bulk backfill catches up the historical inventory, decide whether to keep daily cadence or switch to weekly + an on-demand trigger from LCC UI.
