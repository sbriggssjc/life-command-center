# Claude Code — Phase 2 Slice 2b.3: keep the library segment in the upload folder_path

## Why (grounded live 2026-06-11, exact connector error)
The write-back's `Create file` action failed `400 BadRequest` with the SharePoint
message **"Root folder is not found"**. The run inputs show:
```
dataset    : https://northmarq.sharepoint.com/sites/TeamBriggs20
folderPath : PROPERTIES/D/DaVita/Chilton, WI      ← WRONG (missing the library)
name       : LCC Writeback Test [LCC].pdf
```
The connector resolves `folderPath` relative to the **site root**
(`/sites/TeamBriggs20`). `PROPERTIES` is NOT at the site root — it lives inside the
**"Shared Documents"** document library. So the path must keep the library
segment: `/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI`. This is the SAME form
that made the Get flow work (we strip only `/sites/TeamBriggs20`, leaving
`/Shared Documents/...`).

`uploadDocToFolder` currently strips `/sites/TeamBriggs20/Shared Documents` (site
AND library) via `libraryRelativeFolder`, producing the bare `PROPERTIES/...`. It
must strip only the **site** prefix.

## The change — `api/_shared/storage-adapter.js`
- The folder sent in the upload `folder_path` must retain the library:
  strip only the site path, keep `/Shared Documents/...`. Concretely, change the
  derivation used by `uploadDocToFolder` so the Chilton input
  `/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI`
  → `/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI` (leading slash retained,
  matching the proven Get-flow form).
- Implement via a site-prefix constant, e.g.
  `const SHAREPOINT_SITE_PATH = process.env.SHAREPOINT_SITE_PATH || '/sites/TeamBriggs20';`
  and `folderForUpload = String(folderPath).replace(SHAREPOINT_SITE_PATH, '')`
  (collapse `//`; KEEP the single leading slash). Do NOT use `SHAREPOINT_DOC_PREFIX`
  here (that one includes the library and is correct for OTHER call sites — leave
  those untouched).
- Rename or repurpose the helper accordingly (e.g. `siteRelativeFolder(folderPath)`),
  keeping it exported + unit-tested. `libraryRelativeDocPath` (if still used
  elsewhere) is unaffected.
- Everything else (request body keys `folder_path` / `file_name` / `content_base64`,
  the `server_relative_url` response handling, 503-when-unset) stays as Slice 2b.2.

## Tests / house rules
- Update `test/storage-adapter-upload.test.mjs`: the upload `folder_path` for the
  Chilton input is now `/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI` (NOT the
  bare `PROPERTIES/...`). Add the leading-slash + `//`-collapse cases.
- `node --check`; ≤12 `api/*.js`; full suite green. Ships on the Railway redeploy.
  No PA flow change — the flow's `Create file` (Folder Path = `folder_path`,
  File Name = `file_name`, File Content = `base64ToBinary(content_base64)`) is
  already correct; it just needs the library-qualified value.

## After deploy (Claude/Cowork)
I'll re-run the write-back against dia 29841 — the `Create file` should now resolve
`/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI` and land
`… [LCC].pdf` in the property folder. Then I confirm the `lcc_generated`
property_documents link + the enrich-tick skip, and apply the `lcc_generated`
migration.
