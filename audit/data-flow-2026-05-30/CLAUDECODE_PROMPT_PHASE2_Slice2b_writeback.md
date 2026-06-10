# Claude Code — Phase 2 Slice 2b: write LCC-generated docs back into property folders

## Goal (ARCH §10.2(b), Scott 2026-06-10)
Close the bidirectional loop: LCC-generated deliverables (BOVs, OMs, client memos,
master sheets) get written **into the matched property's own SharePoint folder**,
tagged so re-ingestion knows they're our authoritative work, and linked to the
property record. The folder + the DB become one connected object. This is the
WRITE side of the PROPERTIES channel whose READ side shipped in Slice 2a.

Build the **mechanism** (one entrypoint any producer can call), not a specific
producer integration — deliverables are generated in several places (app exports,
Cowork BOV/memo skills), so expose a single endpoint they all call.

## Doctrine / safety
- **Tag every LCC-authored file** so re-ingest classifies it as our own work, not a
  third-party doc: filename marker `... [LCC].<ext>` AND a `property_documents` row
  with `source='lcc_generated'` (high trust). The folder-feed read path must SKIP
  re-ingesting `[LCC]`-tagged files for extraction (they're our output, not new
  intel) — add that guard to the classifier/worker.
- **Never overwrite** an existing SharePoint file. If the target name exists, append
  a ` (YYYY-MM-DD)` (or a short counter) — write-back is additive, never destructive.
- **Resolve the destination folder confidently or refuse.** No guessed writes into
  the wrong property folder. Unresolved → return a clear error to the caller, never
  a silent or mis-placed write.
- Feature-flagged on `SHAREPOINT_UPLOAD_URL` — inert (clear 503/“not configured”)
  until the PA upload flow is wired.

## Unit 1 — PA upload flow (Scott, native browser; mirrors List/Get)
New flow **"Http -> Upload file (LCC Put Artifact)"**:
- HTTP trigger, body `{ folder_path, file_name, content_base64 }` (`folder_path` =
  full server-relative path of the destination folder; single apostrophes).
- Action **SharePoint "Create file"** — Site = Team Briggs; **Folder Path** =
  `triggerBody()?['folder_path']` (the connector takes a literal path like "Get file
  content using path", so no OData doubling); **File Name** =
  `triggerBody()?['file_name']`; **File Content** =
  `base64ToBinary(triggerBody()?['content_base64'])` (committed via the fx editor —
  raw base64 text would write corrupt bytes).
- Response (single fx expression, the wrap trick):
  `addProperty(json('{"ok":true}'),'server_relative_url', body('Create_file')?['Path'])`
  (return the created file's path so LCC can store it).
- Copy the trigger URL → `SHAREPOINT_UPLOAD_URL` env on tranquil-delight.

## Unit 2 — storage-adapter upload (`api/_shared/storage-adapter.js`)
`uploadDocToFolder({ folderPath, fileName, bytes, fetchImpl })` → POST
`SHAREPOINT_UPLOAD_URL` `{ folder_path, file_name, content_base64: bytes.toString('base64') }`;
returns `{ ok, server_relative_url, status, detail }`. Mirror the existing
`fetchSharepointBytes` shape (tolerant parse, 503 when the env is unset).

## Unit 3 — property → folder-path resolver
Resolve a `(domain, property_id)` to its PROPERTIES folder, in priority order:
1. **Known from the enrich read path (most reliable):** the property's most recent
   `property_documents.source_url` that lives under `…/PROPERTIES/…` — take its
   PARENT directory. (Slice 2a populates these as the crawl maps properties.)
2. **Derived fallback:** `PROPERTIES/<bucket>/<tenant-folder>/<City, ST>` from the
   property's tenant + city/state. Bucket = first alnum char of the tenant folder
   (A–Z, else 1-9). Only use when it matches an EXISTING folder (verify via the List
   flow); if the derived folder doesn't exist, treat as unresolved.
3. **Unresolved → refuse** (return `{ok:false, reason:'folder_unresolved'}`); the
   caller surfaces it. (A later slice can add a decision-lane task to map the folder.)

## Unit 4 — the write-back entrypoint (sub-route, NO new api/*.js — still 12)
Add `POST /api/property-doc-writeback` as a sub-route on `intake.js`
(`?_route=property-doc-writeback`, + a `vercel.json` rewrite). Body:
`{ domain:'dia'|'gov', property_id, file_name, doc_type, content_base64 }`. Flow:
1. Resolve the folder (Unit 3); refuse if unresolved.
2. Ensure the `[LCC]` filename tag; if the name collides in the folder, de-dup with a date.
3. `uploadDocToFolder` (Unit 2). On failure → 502, write nothing to the DB.
4. On success → insert a `property_documents` row on the domain DB
   (`source='lcc_generated'`, `source_url`=returned path, `document_type`=doc_type,
   `file_name`) + `field_provenance` (`source='lcc_generated'`, confidence 1.0). The
   doc-attach is effect-first/outcome-truthful (a failed DB write after a successful
   upload returns 207-ish with the uploaded path so it isn't lost).
Register `field_source_priority` rows for `source='lcc_generated'` on the
property_documents fields (priority 1 — top, it's our own authoritative work).

## Unit 5 — re-ingest guard
In the folder-feed classifier/worker, a file whose name carries the `[LCC]` marker
(or whose `property_documents.source='lcc_generated'`) is recorded
`status='skipped'` `detected_type='lcc_generated'` and NOT re-extracted — it's our
output, not new market intel. (Prevents the enrich crawl from re-ingesting our own
BOVs as if they were third-party OMs.)

## Tests / house rules
- Unit-test the resolver (known-path parent; derived fallback; unresolved refusal),
  the `[LCC]` tag + de-dup, and the effect-first DB write (upload-ok + db-fail path).
- `[LCC]` re-ingest guard: a `... [LCC].xlsx` file classifies as skipped/lcc_generated,
  never staged.
- `node --check`; ≤12 `api/*.js` (sub-route only); additive migration for the
  `lcc_generated` priority rows. Ships on Railway redeploy.

## After deploy (Claude/Cowork)
Once `SHAREPOINT_UPLOAD_URL` is set, I'll call `/api/property-doc-writeback` with a
small test doc against the already-mapped DaVita Chilton property (29841), confirm
it lands in that property's folder as `… [LCC].pdf`, links a `lcc_generated`
property_documents row, and is NOT re-ingested by the next enrich tick.

## Out of scope (Slice 3, later)
The context layer — linking property + docs to email / SF notes / conversation
notes / LLC research (the shared-context service). Separate prompt.
