# Claude Code — Phase 2 Slice 2b.1: align write-back upload to the proven Save-flow contract + Railway route mount

## Why (grounded live 2026-06-10)
Slice 2b's write-back is deployed and the handler works — a bogus property
correctly returns `422 {"ok":false,"reason":"folder_unresolved"}`, and a real
property (dia 29841) resolves its folder. But the upload step fails
(`{"ok":false,"error":"upload_failed","upstream_status":400}`). Two concrete gaps:

1. **The PA upload flow uses the EXISTING Save-flow contract, not a new one.** To
   avoid editing the (very unstable) PA designer, we reuse the proven
   `Create file` flow shape. The live "Http -> Put file (LCC Put Artifact)" flow is
   a clone of the working Save flow — it is now **On**, SharePoint connection green,
   and `SHAREPOINT_UPLOAD_URL` points at it. Its trigger contract is the SAME as
   `putToSharePoint` (Phase-1 save):
   `trigger { path, content_base64, content_type }` → `response { ok:true, server_relative_url, item_id, url? }`,
   where **`path` is a LIBRARY-RELATIVE file path** (e.g. `Storage OM's/Intake/2026-06-10/x.pdf` —
   no leading slash, no `/sites/TeamBriggs20/Shared Documents` prefix; the connector's
   Site Address supplies the library root). `uploadDocToFolder` currently POSTs
   `{folder_path, file_name, content_base64}` (full server-relative folder + separate
   name) → the flow's `Create file` gets nulls for `path` → 400.

2. **Railway route mount missing.** `/api/property-doc-writeback` 404s on the live
   app, but `/api/intake?_route=property-doc-writeback` works (returns the 422). Per
   CLAUDE.md, **production is Railway and uses `server.js` mounts, not `vercel.json`
   rewrites.** The vercel rewrite was added; the `server.js` mount was not.

## Unit 1 — `uploadDocToFolder` → the Save-flow contract (`api/_shared/storage-adapter.js`)
Rewrite the request to mirror `putToSharePoint` exactly (it is the proven, working
shape against this same `Create file` action):
- Build a **library-relative** path: strip the site/library prefix from the resolved
  `folderPath` and join the file name. Reuse the SAME prefix logic the rest of the
  module uses (`SHAREPOINT_DOC_PREFIX`, default `/sites/TeamBriggs20/Shared Documents`):
  ```js
  const PREFIX = (process.env.SHAREPOINT_DOC_PREFIX || '/sites/TeamBriggs20/Shared Documents');
  const libRelFolder = String(folderPath).replace(PREFIX, '').replace(/^\/+/, '');
  const path = `${libRelFolder}/${fileName}`.replace(/\/{2,}/g, '/');
  ```
- POST `{ path, content_base64: bytes.toString('base64'), content_type: 'application/pdf' }`
  to `SHAREPOINT_UPLOAD_URL`.
- Read the response shape `{ ok, server_relative_url, item_id, url? }` (same as
  `putToSharePoint`); return `{ ok, server_relative_url, status, detail }`. 503 when
  `SHAREPOINT_UPLOAD_URL` is unset, never throw (unchanged).
- The writeback handler already stores `server_relative_url` into
  `property_documents.source_url` — keep that wiring; it now receives the flow's
  returned path.

(Net: write-back and Phase-1 save now speak the identical flow contract. They use
separate env URLs so they CAN point at different flows, but both work against the
clone or the original Save flow interchangeably.)

## Unit 2 — mount the clean route on Railway (`server.js`)
Add the `/api/property-doc-writeback` mount next to the other intake sub-routes
(mirror how `/api/folder-feed-tick` is mapped to the intake handler with
`_route=folder-feed-tick`). Keep the existing `vercel.json` rewrite. After this,
external producers can POST the clean `/api/property-doc-writeback` path on the live
(Railway) app, not just the `?_route=` form.

## Tests / house rules
- Update the `uploadDocToFolder` unit test (and the `performDocWriteback` 200/502
  cases) to the new request body (`{path, content_base64, content_type}`) +
  `server_relative_url` response. The library-relative path derivation has a unit
  test: `/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI` +
  `Foo [LCC].pdf` → `PROPERTIES/D/DaVita/Chilton, WI/Foo [LCC].pdf`.
- `node --check`; ≤12 `api/*.js` (adapter + server.js + the handler — no new file);
  full suite green. Ships on the Railway redeploy of merged `main`.

## After deploy (Claude/Cowork)
The "Http -> Put file" flow is already On + `SHAREPOINT_UPLOAD_URL` set, so no PA
work remains. I'll re-run the write-back against dia 29841 (DaVita Chilton) via the
clean `/api/property-doc-writeback` path, confirm the file lands as `… [LCC].pdf`
in that property's folder, links an `lcc_generated` `property_documents` row, and is
skipped by the next enrich tick. I'll also apply the `lcc_generated` priority
migration (Slice 2b) at that time.
