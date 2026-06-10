# Claude Code — Phase 2 Slice 1b: folder-feed list via SharePoint REST

## Why
Slice 1 shipped the folder-feed worker expecting a PA "List folder" flow. Live
testing (2026-06-10) proved the SharePoint **List folder** connector action
can't list a **dynamic** folder path — its "File Identifier" is an opaque
picker-encoded id, so an arbitrary runtime `folder_path` returns NotFound for
every format. The flow is being rebuilt on **"Send an HTTP request to
SharePoint"** (REST), which takes a plain server-relative path. This slice
aligns the worker's parser to the REST response. (PA flow:
`ARCHITECTURE_PHASE2_folder_feed.md` §9.2.)

## The PA flow contract (REST) — CONFIRMED LIVE 2026-06-10
`POST <SHAREPOINT_LIST_URL>` body `{ "folder_path": "/sites/TeamBriggs20/Shared Documents/<path>" }`
→ the flow runs `GET _api/web/GetFolderByServerRelativeUrl('<folder_path>')?$expand=Folders,Files`
→ Response (verified shape from a live run against `Ad-Hoc Analyst Requests`):
```
{ "ok": true,
  "sp": { "d": {                       // <- OData *verbose* envelope: note the `d`
    "Name": "Ad-Hoc Analyst Requests",
    "ServerRelativeUrl": "/sites/TeamBriggs20/Shared Documents/Ad-Hoc Analyst Requests",
    "ItemCount": 4,
    "Files":   { "results": [ {Name, ServerRelativeUrl, Length, TimeCreated,
                               TimeLastModified, UniqueId, ETag, MajorVersion, …} ] },
    "Folders": { "results": [ {Name, ServerRelativeUrl, ItemCount, UniqueId,
                               TimeLastModified, …} ] }
  } } }
```
**Two gotchas the live payload proved:**
1. The arrays are nested under **`sp.d.Files.results`** and **`sp.d.Folders.results`**
   (the `d` root + `.results` wrapper are SharePoint's `odata=verbose` format — the
   flow returns verbose, not nometadata). Do NOT read `sp.Files` directly.
2. **`Length` comes back as a STRING** (`"208384"`) → `parseInt` it. (`TimeCreated`/
   `TimeLastModified` are ISO-Z strings; `UniqueId` is a bare GUID; `ETag` is the
   quoted `"{GUID},N"` form.)

## Unit 1 — `callListFolder` parses the REST shape (`api/_handlers/folder-feed.js`)
- Read the verbose envelope, tolerant of a future nometadata switch:
  `const sp = json.sp?.d ?? json.sp ?? json;`
  `const files   = sp.Files?.results   ?? sp.Files   ?? json.items ?? json.value ?? [];`
  `const folders = sp.Folders?.results ?? sp.Folders ?? [];`
  From `files` build file items; from `folders` build subfolder items (the worker
  enqueues subfolders to recurse).
- Field map (add to the existing fallbacks — REST is PascalCase; keep the old
  lowercase fallbacks so the helper stays tolerant):
  `path  = it.ServerRelativeUrl || it.serverRelativeUrl || it.path || …`
  `name  = it.Name || it.name || …`
  `size  = it.Length != null ? parseInt(it.Length, 10) : (it.size ?? null)`  (folders have no Length → null, fine)
  `modified = it.TimeLastModified || it.modified || …`
  `etag  = it.ETag || it.UniqueId || it.etag || …`
  Tag folder items (`is_folder:true` from the `Folders` array) so the walk
  enqueues them and the classifier skips them as files.

## Unit 2 — folder_path format + roots (`api/_handlers/folder-feed.js` + env)
- The REST `GetFolderByServerRelativeUrl` needs the **full server-relative path**
  `/sites/TeamBriggs20/Shared Documents/<path>` and **apostrophes doubled** for
  the OData string literal (`Storage OM's` → `Storage OM''s`). Add a
  `toServerRelative(root)` helper that prefixes `/sites/TeamBriggs20/Shared
  Documents/` (configurable) and `.replace(/'/g, "''")`.
- `FOLDER_FEED_ROOTS` default → the real roots in this form, e.g.
  `/sites/TeamBriggs20/Shared Documents/PROPERTIES`,
  `/sites/TeamBriggs20/Shared Documents/Storage OM''s`,
  `/sites/TeamBriggs20/Shared Documents/Gv't Leased Research` (apostrophes
  doubled), `/sites/TeamBriggs20/Shared Documents/Dialysis Research`.
- The `subject_hint` path parser keys off `PROPERTIES/<bucket>/<brand>[/<city,st>]`
  — strip the `/sites/TeamBriggs20/Shared Documents/` prefix before parsing so the
  anchor logic is unchanged.

## House rules / test
`node --check`; ≤12 api/*.js (edit the handler only); idempotent on `(path,hash)`;
emit to the promoter, never write domain tables. Test: with `SHAREPOINT_LIST_URL`
set, a `folder-feed-tick` POST against a root returns the folder's Files+Folders,
stages OM PDFs, enqueues subfolders, records `folder_feed_seen`. Ships on the
Railway redeploy.

## (PA side — Scott, native browser, the one remaining manual piece)
On flow `ca110bdc-…`: delete the **List folder** action; add **Send an HTTP
request to SharePoint** (Site=Team Briggs, GET, Uri
`_api/web/GetFolderByServerRelativeUrl('@{triggerBody()?['folder_path']}')?$expand=Folders,Files`);
set **Response** body to the single expression
`addProperty(json('{"ok":true}'),'sp',body('Send_an_HTTP_request_to_SharePoint'))`;
Save; copy the trigger URL → `SHAREPOINT_LIST_URL`.
