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
