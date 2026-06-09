# Phase 1 — SharePoint storage via Power Automate: flow contracts + cutover

The storage adapter (`api/_shared/storage-adapter.js`) is built and ships with
the Railway redeploy. It defaults to `STORAGE_BACKEND=supabase` (no change to
today). To move OM artifact storage into the **Team Briggs Documents** library,
build the Power Automate HTTP flows below, set the env vars, then flip the flag.
**No Microsoft Graph app registration** — these are PA SharePoint-connector
flows, the same M365 bridge the email-intake flows already use.

Target library (from the team's Export-to-Excel `.iqy`):
- Site: `https://northmarq.sharepoint.com/sites/TeamBriggs20`
- Library: Shared Documents ("Team Briggs - Documents")
- Intake subfolder LCC writes under: `Storage OM's/Intake/<YYYY-MM-DD>/<key>-<file>`
  (override the prefix with `SHAREPOINT_INTAKE_FOLDER`).

---

## Flow 1 — "LCC → SharePoint: Save Artifact"  (REQUIRED for ingest)

HTTP-triggered (POST). Secure the trigger the same way the email-intake flow is
(the SAS token lives in the trigger URL). Set that URL as `SHAREPOINT_SAVE_URL`.

**Request body LCC sends:**
```json
{ "path": "Storage OM's/Intake/2026-06-09/<key>-<file>.pdf",
  "content_base64": "<base64 file bytes>",
  "content_type": "application/pdf" }
```
**Steps:** Compose folder/name from `path` → SharePoint **Create file** in the
Team Briggs library (decode `content_base64` with `base64ToBinary(...)` — the
same gotcha as the email-intake PUT) → Response.

**Response body LCC expects:**
```json
{ "ok": true,
  "server_relative_url": "/sites/TeamBriggs20/Shared Documents/Storage OM's/Intake/2026-06-09/<key>-<file>.pdf",
  "item_id": "<sharepoint item id>" }
```
LCC records `storage_backend='sharepoint_pa'`, `storage_ref=server_relative_url`,
`storage_path=NULL`.

## Flow 2 — "LCC → SharePoint: Get Artifact"  (REQUIRED to extract sharepoint rows)

HTTP-triggered (POST). URL → `SHAREPOINT_FETCH_URL`. The extractor calls this to
read the bytes back during extraction.

**Request:** `{ "server_relative_url": "<storage_ref>" }`
**Steps:** SharePoint **Get file content using path** → Response.
**Response:** `{ "ok": true, "content_base64": "<base64>", "content_type": "application/pdf" }`

## Flow 3 — "LCC → SharePoint: Get Sharing Link"  (OPTIONAL — dashboard download)

HTTP-triggered (POST). URL → `SHAREPOINT_LINK_URL`. Used by the artifact-download
handler. Until set, downloads of SharePoint-stored files return a clean
`501 sharepoint_link_not_configured` (Supabase-stored files are unaffected).

**Request:** `{ "server_relative_url": "<storage_ref>" }`
**Steps:** SharePoint **Create sharing link** (org view) → Response.
**Response:** `{ "ok": true, "url": "<sharing url>", "expires_at": "<ISO|null>" }`

---

## EXACT build recipe (worked out live 2026-06-09; PA designer froze before save)

Flow 1 was configured to ~80% before the new-designer renderer hung (a recurring
instability — 2nd session it's blocked a build). The precise, verified field
values below make this a copy-paste build (Scott in PA, or retry when the
designer is responsive). Nothing was saved — no production impact.

**Flow 1 — "LCC to SharePoint - Save Artifact"**
- Trigger: *When an HTTP request is received*
  - Who can trigger the flow: **Anyone** (LCC's server calls with the SAS URL).
  - Request Body JSON Schema (from sample `{"path":"x","content_base64":"x","content_type":"x"}`):
    object with string props `path`, `content_base64`, `content_type`.
- Action: SharePoint **Create file**
  - Site Address: `Team Briggs - https://northmarq.sharepoint.com/sites/TeamBriggs20`
  - Folder Path: `Shared Documents/Storage OM's/Intake`  *(flat — uniqueness
    comes from the key-prefixed filename; per-date subfolders dropped for
    robustness/simplicity. Adjust if you want date grouping.)*
  - File Name (expression): `last(split(triggerBody()?['path'],'/'))`
  - File Content (expression): `base64ToBinary(triggerBody()?['content_base64'])`
- Action: **Response**
  - Status 200; Body: `{"ok": true, "server_relative_url": <Create file → Path>,
    "item_id": <Create file → ItemId>}` — use the Create-file action's dynamic
    **Path** + **ItemId** outputs, don't reconstruct the URL.
- Save → copy the trigger's HTTP POST URL → `SHAREPOINT_SAVE_URL`.

**Flow 2 — "LCC to SharePoint - Get Artifact"** (recommended: key off ItemId)
- Trigger: HTTP request, Anyone, schema `{server_relative_url, item_id}` (LCC
  has both; passing `item_id` avoids the path-prefix mismatch below).
- Action: SharePoint **Get file content** (by Id) — Site Address Team Briggs,
  Id = `triggerBody()?['item_id']`. *(If keying off path instead, "Get file
  content using path" wants a SITE-relative path, not the full
  `/sites/TeamBriggs20/...` server-relative URL — strip the site prefix first.
  ItemId sidesteps this.)*
- Action: Response: `{"ok": true, "content_base64": base64(body('Get_file_content')),
  "content_type": "application/pdf"}`.
- Save → URL → `SHAREPOINT_FETCH_URL`. **(Minor LCC note: have the adapter send
  `item_id` too, or Flow 2 strips the prefix — flag for Claude Code if keying
  off ItemId.)**

## Flow 1 status + test plan (2026-06-09)

**Flow 1 is BUILT + SAVED** — "LCC to SharePoint - Save Artifact", flow id
`4bebbeff-3049-4f4d-ba5d-f900490f0db5` (env Default-fccf69d3…). Trigger
*When an HTTP request is received* (Anyone; schema `{path, content_base64,
content_type}`) → **Create file** (Team Briggs site, folder
`Shared Documents/Storage OM's/Intake`, name `last(split(triggerBody()?['path'],'/'))`,
content `base64ToBinary(triggerBody()?['content_base64'])`) → **Response** 200
`{"ok":true,"server_relative_url":"@{outputs('Create_file')?['body/Path']}","item_id":""}`.
(ItemId dynamic token would not insert in the new designer; `item_id` left empty
— `server_relative_url` is what the adapter stores, so this is fine. Flow 2 keys
off the path, not item_id.)

**Test approach (chosen: Option 2 — test Save before building Get).** PA's
in-designer Test for an HTTP trigger only parks waiting for an external POST, so
the real test runs through LCC:
1. Scott copies the trigger's HTTP POST URL (copy icon next to "HTTP URL" on the
   manual trigger) → set `SHAREPOINT_SAVE_URL` in Railway.
2. Set `STORAGE_BACKEND=sharepoint_pa`. The next large OM ingest (email OMs
   arrive continuously) routes through Flow 1.
3. **Verification is wired and confirmed readable from this session** — the Team
   Briggs library is synced locally and the `Storage OM's` folder is reachable at
   `C:\Users\scott\NorthMarq Capital, LLC\Team Briggs - Documents\Storage OM's`.
   After the first fire: confirm the file appears under `Storage OM's/Intake/…`,
   AND read the flow **run history → Response output → `server_relative_url`** to
   capture the **exact `Path` format** (e.g. whether it includes the
   `/sites/TeamBriggs20/Shared Documents/…` prefix). That value is the input that
   makes Flow 2 ("Get file content using path") correct on the first build.

## Env vars (Railway)

| var | purpose | required for |
|---|---|---|
| `STORAGE_BACKEND` | `supabase` (default) \| `sharepoint_pa` | the flip |
| `SHAREPOINT_SAVE_URL` | Flow 1 trigger URL | ingest in sharepoint mode |
| `SHAREPOINT_FETCH_URL` | Flow 2 trigger URL | extractor read-back |
| `SHAREPOINT_LINK_URL` | Flow 3 trigger URL | dashboard download |
| `SHAREPOINT_INTAKE_FOLDER` | override intake subfolder | optional |

## Cutover (safe, staged)

1. Ship the adapter (Railway redeploy of merged `main`) with `STORAGE_BACKEND`
   unset/`supabase` → **no behavior change** (verify: a large OM still lands in
   the `lcc-om-uploads` bucket, `storage_backend='supabase'`, extraction works).
2. Build Flows 1 + 2; set `SHAREPOINT_SAVE_URL` + `SHAREPOINT_FETCH_URL`.
3. Set `STORAGE_BACKEND=sharepoint_pa`. New large OMs now land in the Team
   Briggs library (`Storage OM's/Intake/...`), `inline_data` NULL, `storage_ref`
   set; the extractor reads them back via Flow 2.
4. (Optional) Build Flow 3 + set `SHAREPOINT_LINK_URL` for dashboard downloads.

**Safety:** if `STORAGE_BACKEND=sharepoint_pa` is set but `SHAREPOINT_SAVE_URL`
is missing, the adapter logs once and falls back to `supabase` — flipping the
flag early can't break ingest. A PA save failure at runtime also falls back to
Supabase per-file. No bulk migration of existing files — the offload cron keeps
draining the Supabase backlog; only NEW files honor the flag.
