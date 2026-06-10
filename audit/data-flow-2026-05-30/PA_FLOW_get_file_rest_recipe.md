# PA flow fix — "Get file content" read-back (SHAREPOINT_FETCH_URL) on REST

## The problem (grounded live 2026-06-10)
The capped folder-feed drain proved stage → classify works end-to-end, but the
extractor's byte read-back fails for **every** file:

```
SharePoint fetch failed: 502 [object Object] — ref=/sites/TeamBriggs20/Shared Documents/Gv't Leased Research/On Market/OLD/Champaign SSA OM.pdf
SharePoint fetch failed: 502 [object Object] — ref=/sites/TeamBriggs20/Shared Documents/Dialysis Research/Comps/On Market/_added or updated in comps spreadsheet/DaVita-Dialysis-Houston-TX-Fortis-OM.pdf
```

A gov path (apostrophe in "Gv't") **and** a dia path (no apostrophe anywhere)
both 502 identically → it is **not** the apostrophe; the Phase-1 Get flow simply
doesn't handle full server-relative tree paths. It was built in Phase 1 but never
exercised by a real SharePoint fetch (Phase-1 verification was Supabase
no-regression), so this is its first live run.

## The contract the LCC adapter calls (must not change)
`api/_shared/storage-adapter.js::fetchSharepointBytes` POSTs:
```
POST <SHAREPOINT_FETCH_URL>
{ "server_relative_url": "/sites/TeamBriggs20/Shared Documents/<path>/<file>.pdf" }
```
and REQUIRES the response:
```
{ "ok": true, "content_base64": "<base64 of the file bytes>", "content_type": "application/pdf" }
```
(`server_relative_url` is the FULL server-relative path with a SINGLE apostrophe;
the flow must double it for the OData literal, exactly like the List flow.)

## The fix — rebuild the Get flow on the proven REST pattern
Mirror the working List flow (`Send an HTTP request to SharePoint`). The file-bytes
endpoint is `GetFileByServerRelativeUrl('<path>')/$value`, which returns the raw
file content as the action body.

**Trigger** — "When an HTTP request is received", JSON schema with one string
property `server_relative_url`.

**Action 1 — Send an HTTP request to SharePoint**
- Site Address: **Team Briggs** (`https://northmarq.sharepoint.com/sites/TeamBriggs20`)
- Method: **GET**
- Uri (inline `@{}` is fine in this text field; double the apostrophes for the
  OData string literal with `replace(...,'''','''''')`):
  ```
  _api/web/GetFileByServerRelativeUrl('@{replace(triggerBody()?['server_relative_url'], '''', '''''')}')/$value
  ```
- Headers: none required. (`$value` returns binary; PA captures it as the body.)

**Action 2 — Response**
- Status 200, Content-Type `application/json`.
- Body MUST be entered through the **fx editor as ONE committed expression**
  (typed-as-text returns the literal string — the recurring gotcha). Build the
  two properties with nested `addProperty`:
  ```
  addProperty(addProperty(json('{"ok":true,"content_type":"application/pdf"}'),'content_base64', base64(body('Send_an_HTTP_request_to_SharePoint'))), 'ok', true)
  ```
  (The outer `addProperty(...,'ok',true)` is a harmless no-op that guarantees the
  whole body is one expression so the static JSON validator passes — same wrap
  trick as the List flow's `addProperty(json('{"ok":true}'),'sp',…)`. If the
  editor accepts the simpler single wrap, this is equivalent:
  `addProperty(json('{"ok":true,"content_type":"application/pdf"}'),'content_base64', base64(body('Send_an_HTTP_request_to_SharePoint')))`.)

### base64 nuance to verify on the first real fetch
`body('Send_an_HTTP_request_to_SharePoint')` for a `$value` GET should be the raw
binary; `base64(...)` then yields the file's base64 the adapter decodes with
`Buffer.from(content_base64,'base64')`. **If** the first live fetch comes back
corrupt (PA sometimes hands `$value` back as a UTF-8 string and double-encodes),
switch Action 1 to the connector **"Get file content using path"** instead —
File Path = `triggerBody()?['server_relative_url']` (that action takes a plain
text path, NOT a picker id, so unlike "List folder" it accepts a dynamic path) —
and set the Response `content_base64` to `base64(body('Get_file_content_using_path'))`.
"Get file content using path" returns the bytes as proper binary, which is the
more robust option if the `$value` base64 round-trip is lossy.

## Alternative if you'd rather not touch the existing flow
Leave the current Get flow and point `SHAREPOINT_FETCH_URL` at a NEW flow built
per above. The adapter only cares about the URL + the request/response contract.

## Verify after the rebuild (Claude/Cowork, no new staging needed)
The two already-staged-and-failed intakes can be re-extracted once the flow is
fixed (their `seed_data.source_path` is intact). I'll re-run extraction on
intake `ed1e9005-…` (Champaign SSA) + `3625ca3b-…` (DaVita Houston) and confirm
`fetched:true` + a real snapshot, then resume the capped drains.
