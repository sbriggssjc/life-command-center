# Claude Code — Phase 2 Slice 2b.2: upload sends separate folder_path + file_name

## Why (grounded live 2026-06-10)
Slice 2b.1 made `uploadDocToFolder` POST the Save-flow contract `{path,
content_base64, content_type}` to reuse the existing `Create file` flow. Live test
revealed that flow's `Create file` action has its **Folder Path hardcoded to the
intake zone** (`Storage OM's/Intake`) — so the write-back file landed in
`/Shared Documents/Storage OM's/Intake/…` instead of the resolved property folder
(`…/PROPERTIES/D/DaVita/Chilton, WI`), even though the resolver was correct. The
flow's `Create file` is being reconfigured (by Scott, native browser) to take a
**dynamic Folder Path + File Name** from the trigger. This aligns the adapter to
that contract.

## New flow contract (the flow Scott is configuring)
`POST <SHAREPOINT_UPLOAD_URL>` body
`{ folder_path, file_name, content_base64 }` where:
- `folder_path` is **library-relative** (e.g. `PROPERTIES/D/DaVita/Chilton, WI` —
  no leading slash, no `/sites/TeamBriggs20/Shared Documents` prefix), matching how
  the SharePoint connector's "Create file" **Folder Path** field resolves against
  the site's default library (same form as the old fixed `Storage OM's/Intake`).
- `file_name` is the `[LCC]`-tagged filename.
→ Create file: Folder Path = `folder_path`, File Name = `file_name`, File Content =
`base64ToBinary(content_base64)`. Response still `{ ok:true, server_relative_url, … }`.

## The change — `uploadDocToFolder` (`api/_shared/storage-adapter.js`)
- Keep the existing `libraryRelativeDocPath`-style prefix strip, but **split** it:
  derive a library-relative **folder** from the resolved `folderPath` (strip
  `SHAREPOINT_DOC_PREFIX`, default `/sites/TeamBriggs20/Shared Documents`, + leading
  slashes; collapse `//`) and send the `fileName` separately. e.g. add/keep a small
  exported `libraryRelativeFolder(folderPath)` helper returning
  `PROPERTIES/D/DaVita/Chilton, WI` for the Chilton input.
- POST body: `{ folder_path: libraryRelativeFolder(folderPath), file_name: fileName,
  content_base64: bytes.toString('base64') }`. (Drop the combined `path` and the
  `content_type` field — the Create file action infers content type from the binary.)
- Response parsing unchanged (`server_relative_url`); return
  `{ ok, server_relative_url, status, detail }`; 503 when env unset; never throw.

## Tests / house rules
- Update `test/storage-adapter-upload.test.mjs`: assert the request body now has
  `folder_path` (library-relative, e.g. `PROPERTIES/D/DaVita/Chilton, WI`) +
  `file_name` (the `[LCC]` name) + `content_base64`, and NO `path`/`content_type`.
  Keep the prefix-strip unit case. `performDocWriteback` tests already mock
  `uploadDoc` and assert `server_relative_url` — unchanged.
- `node --check`; ≤12 `api/*.js`; full suite green. Ships on the Railway redeploy.

## After deploy (Claude/Cowork)
Scott will have reconfigured the `Create file` action (dynamic Folder Path/File
Name) + trigger schema by then. I'll re-run the write-back against dia 29841 and
confirm `server_relative_url` is now under `…/PROPERTIES/D/DaVita/Chilton, WI/…`
(NOT the intake folder), the `lcc_generated` `property_documents` row links the
correct path, and the next enrich tick skips the `[LCC]` file. Then I apply the
`lcc_generated` priority migration.
