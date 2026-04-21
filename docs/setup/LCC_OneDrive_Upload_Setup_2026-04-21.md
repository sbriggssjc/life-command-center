# LCC OneDrive + Supabase Storage Ingestion Setup
_2026-04-21 — supersedes the direct-to-Vercel path for large OMs_

## What this unlocks

A single ingestion architecture that accepts OMs of any size (up to 100 MB)
from any of these sources:

- Chrome sidebar **Stage to LCC** button
- Saving a PDF directly to your OneDrive `/LCC OM Intake/` folder (drag, save-as, Teams file-share, mobile scan — anything)
- Manual PowerShell / Postman calls to Flow A's URL

No Vercel payload limit in the byte path — bytes flow: caller → Power
Automate → Supabase Storage → LCC reads by reference. Vercel only sees
tiny JSON envelopes with `storage_path` references.

## One-time setup (your hands, ~20 minutes total)

### Step 1 — Supabase Storage bucket (2 min)

1. Open Supabase Studio on the **LCC Opps** project → **Storage** (left nav).
2. Create bucket: **`lcc-om-uploads`**.
   - Public: **OFF**
   - File size limit: **100 MB**
   - Allowed MIME types: leave blank OR set to `application/pdf, application/vnd.*`

3. Open **SQL Editor** and run `schema/039_om_uploads_bucket.sql` — this
   adds RLS policies so only the service role can write and only workspace
   members can read. (Idempotent; safe to re-run.)

### Step 2 — OneDrive folder (30 sec)

1. Go to your **business** OneDrive (the Northmarq one, not personal).
2. Create a folder: **`LCC OM Intake`**
3. Inside it, create a subfolder: **`Processed`**

That's it. Any PDF that lands in `/LCC OM Intake/` will auto-process.

### Step 3 — Build Flow A (HTTP trigger, ~8 min)

This flow is the one the Chrome extension and any other HTTP caller hits.

1. Power Automate → **Create → Automated cloud flow** → Skip → search
   **"When an HTTP request is received"** → name it `LCC — Stage OM via HTTP`.
2. On the trigger, click **Use sample payload to generate schema**, paste:
   ```json
   {
     "file_name":    "test.pdf",
     "mime_type":    "application/pdf",
     "bytes_base64": "...",
     "source_url":   "https://example.com",
     "hostname":     "example.com",
     "intent":       "demo"
   }
   ```
3. Save the trigger. Copy the generated **HTTP POST URL** — you'll paste it
   into the Chrome extension in Step 5.
4. Now add the actions. Easiest: import `flow-a-lcc-stage-om-http.json`
   from the repo via **+ New step → ... → Import from template**. If import
   complains about the trigger (same issue you hit earlier with the
   Copilot-Studio-trigger flow), build manually:

   - **Initialize variable** `LccHost` = `https://life-command-center-nine.vercel.app`
   - **Initialize variable** `LccApiKey` = _(paste your LCC_API_KEY)_
   - **HTTP POST** to `@{variables('LccHost')}/api/intake/prepare-upload`
     - Headers: `Content-Type: application/json`, `X-LCC-Key: @{variables('LccApiKey')}`
     - Body:
       ```json
       {
         "file_name": "@{triggerBody()?['file_name']}",
         "mime_type": "@{coalesce(triggerBody()?['mime_type'], 'application/pdf')}",
         "intake_channel": "sidebar"
       }
       ```
   - **Parse JSON** of the previous body, schema: `{ "properties": { "storage_path": {"type":"string"}, "upload_url":{"type":"string"}, "upload_token":{"type":"string"} } }`
   - **Compose** `Decode_Bytes` = `@base64ToBinary(triggerBody()?['bytes_base64'])`
   - **HTTP PUT** to `@body('Parse_PrepareUpload')?['upload_url']`
     - Headers:
       - `Content-Type: @{coalesce(triggerBody()?['mime_type'], 'application/pdf')}`
       - `Authorization: Bearer @{body('Parse_PrepareUpload')?['upload_token']}`
       - `x-upsert: true`
     - Body: `@outputs('Decode_Bytes')`
   - **HTTP POST** to `@{variables('LccHost')}/api/intake/stage-om`
     - Headers: same as prepare-upload
     - Body:
       ```json
       {
         "intake_source":  "copilot",
         "intake_channel": "sidebar",
         "intent": "@{coalesce(triggerBody()?['intent'], 'Staged from sidebar')}",
         "artifacts": {
           "primary_document": {
             "storage_path": "@{body('Parse_PrepareUpload')?['storage_path']}",
             "file_name":    "@{triggerBody()?['file_name']}",
             "mime_type":    "@{coalesce(triggerBody()?['mime_type'], 'application/pdf')}"
           }
         }
       }
       ```
   - **Parse JSON** on the stage-om response
   - **Respond to PowerApps/Flow** (or Response action) with the parsed values

5. Save the flow. Grab the HTTP POST URL from the trigger.

### Step 4 — Build Flow B (OneDrive trigger, ~5 min)

This flow handles files that land in OneDrive via any path (drag-drop, Teams, mobile, email save). It **calls Flow A** so there's only one place to maintain the ingestion logic.

1. Power Automate → **+ Create → Automated cloud flow** → pick trigger
   **"When a file is created (OneDrive for Business)"** → name it
   `LCC — Forward OneDrive OMs to Flow A`.
2. Trigger config:
   - Folder: `/LCC OM Intake` (business OneDrive)
   - Include subfolders: **No**
3. Add action **Get file content** (OneDrive) — File: the trigger's File
   identifier.
4. Add action **HTTP** (POST) to Flow A's URL from Step 3.
   - Body:
     ```json
     {
       "file_name":    "@{triggerOutputs()?['body/Name']}",
       "mime_type":    "@{coalesce(triggerOutputs()?['body/MediaType'], 'application/pdf')}",
       "bytes_base64": "@{base64(body('Get_file_content'))}",
       "source_url":   "OneDrive: @{triggerOutputs()?['body/Path']}",
       "hostname":     "onedrive",
       "intent":       "Staged from OneDrive drop"
     }
     ```
5. Add action **Move file** (OneDrive) — move the trigger file to
   `/LCC OM Intake/Processed/`. Overwrite if exists.

6. Save.

### Step 5 — Configure the Chrome extension (30 sec)

Set the Flow A URL so the extension routes through it:

1. Open `chrome://extensions` → LCC Assistant → **Details** → **service worker** → opens DevTools.
2. In the Console tab, paste:
   ```javascript
   chrome.storage.local.set({ lccIntakeFlowUrl: 'PASTE_FLOW_A_URL_HERE' });
   ```
3. Close + reopen the side panel.

## Deploy checklist

Before testing, make sure you've:

- ✅ Ran `schema/039_om_uploads_bucket.sql` in Supabase SQL Editor
- ✅ Confirmed bucket `lcc-om-uploads` exists (Supabase Studio → Storage)
- ✅ Created OneDrive folders `/LCC OM Intake/` + `/LCC OM Intake/Processed/`
- ✅ Built Flow A, saved, URL copied
- ✅ Built Flow B, saved, pointing at Flow A's URL
- ✅ Latest code deployed to Vercel (the `data_uri` + `storage_path` support)
- ✅ Chrome extension `lccIntakeFlowUrl` set via service-worker console

## Test sequence

**Test 1 — Direct call to prepare-upload from PowerShell** (proves the new endpoint works):

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "X-LCC-Key"    = "2e046e98d331df549b23a8f15a5a07de7ab16737c5dbd5db692ff42c3bb8b64c"
}
$body = @{
  file_name = "test.pdf"
  mime_type = "application/pdf"
  intake_channel = "sidebar"
} | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "https://life-command-center-nine.vercel.app/api/intake/prepare-upload" -Headers $headers -Body $body
```

Expected: `ok: True, storage_path: "lcc-om-uploads/2026-04-21/<uuid>-test.pdf", upload_url: "https://...signed...", upload_token: "eyJ..."`.

**Test 2 — Flow A end-to-end** (run a small test request):

Use the flow's built-in test tool or PowerShell to POST a tiny payload
(same payload shape as step 3's sample). Watch the flow's Run history —
should be green through all six actions.

**Test 3 — OneDrive drop**: Save any PDF to `/LCC OM Intake/`. Within
~30 sec Flow B fires, Flow A processes, the PDF ends up in `/Processed/`,
and a new row appears in `inbox_items` on LCC Opps.

**Test 4 — Chrome sidebar**: On a CRE listing page with a PDF doc card,
click **Stage to LCC**. Expect `✓ Staged (processing|review_required|failed)`
with an intake_id. Any PDF size now works (up to 100MB).

## Rollback

If anything breaks: the direct `/api/intake/stage-om` path still works for
small PDFs. To disable the flow path on the extension:
```javascript
chrome.storage.local.remove('lccIntakeFlowUrl');
```
The extension will fall back to the direct POST path (Path B in
background.js).
