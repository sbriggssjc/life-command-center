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

**Delete `Map Files to Manifest` entirely** and replace with a **Compose** action whose Input is a single `@select()` expression:

```
@select(outputs('Get_records')?['body/value'],
  json(concat('{',
    '"content_version_id":"', item()?['ContentDocument']?['LatestPublishedVersionId'], '",',
    '"content_document_id":"', item()?['ContentDocumentId'], '",',
    '"title":', json(concat('"', replace(item()?['ContentDocument']?['Title'], '"', '\"'), '"')), ',',
    '"file_name":', json(concat('"', replace(item()?['ContentDocument']?['Title'], '"', '\"'), '.', item()?['ContentDocument']?['FileExtension'], '"')), ',',
    '"extension":"', item()?['ContentDocument']?['FileExtension'], '",',
    '"version_number":1,',
    '"size_bytes":', item()?['ContentDocument']?['ContentSize'], ',',
    '"sf_download_url":"/services/data/v59.0/sobjects/ContentVersion/', item()?['ContentDocument']?['LatestPublishedVersionId'], '/VersionData"',
  '}'))
)
```

Or — cleaner — use the proper Workflow Definition `select()` syntax which lets you pass an object-projection without string concatenation:

```
@select(outputs('Get_records')?['body/value'],
  createObject(
    'content_version_id', item()?['ContentDocument']?['LatestPublishedVersionId'],
    'content_document_id', item()?['ContentDocumentId'],
    'title', item()?['ContentDocument']?['Title'],
    'file_name', concat(item()?['ContentDocument']?['Title'], '.', item()?['ContentDocument']?['FileExtension']),
    'extension', item()?['ContentDocument']?['FileExtension'],
    'version_number', 1,
    'size_bytes', item()?['ContentDocument']?['ContentSize'],
    'sf_download_url', concat('/services/data/v59.0/sobjects/ContentVersion/', item()?['ContentDocument']?['LatestPublishedVersionId'], '/VersionData')
  )
)
```

Then update `POST File Manifest`'s body to reference `outputs('Compose')` instead of `outputs('Map_Files_to_Manifest')?['body']`.

### After the Compose fix

The rest of the chain should work unchanged:
- POST File Manifest → returns `to_fetch` array with proper download URLs
- Apply to each over `to_fetch`:
  - Get File Bytes (Salesforce Send-HTTP GET on the manifest URL)
  - Get Upload URL
  - PUT bytes
  - POST File Bytes

### Test target

Run against Comp `a1YVs000000sngTMAQ` (Jurupa Valley DaVita OM). Expected outcome:
- File lands in `salesforce-files` bucket with header `%PDF-1.x` (binary, not base64 ASCII)
- One row in `sf_files` table on Dialysis_DB pointing at it
- LCC sees the OM in storage as `salesforce-files/<date>/<uuid>-DaVita-Dialysis-...pdf`
