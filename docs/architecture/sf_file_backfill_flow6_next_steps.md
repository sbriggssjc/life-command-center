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
