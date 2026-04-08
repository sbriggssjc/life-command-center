# LCC Office Add-ins

Sideloadable Office Add-ins for Outlook, Excel, and Word that connect to the
Life Command Center API. No admin approval, store listing, or IT involvement
required — load once per Office app and they persist.

---

## Add-ins

### 1. Outlook — Contact Context Panel

Opens a task pane when reading an email that shows the sender's LCC relationship
context: engagement score, touchpoints, active deals, and recommended actions.

**Features:**
- Auto-loads sender context from LCC when you open an email
- Contact card with engagement metrics and deal history
- Log Call, Draft Reply, and Open in LCC action buttons
- Handles unknown contacts with an "Add Contact" flow

### 2. Excel — Comp Data Population

Task pane for searching LCC comp data and inserting it into Briggs comp templates.

**Features:**
- Search comps by address, city, state, or tenant with domain/type filters
- Select and insert comps into the active cell (Briggs template column order)
- Property context lookup with "Insert to Sheet" for full property packets
- Daily briefing insert formatted with color-coded priority sections

### 3. Word — Document Assistant

Task pane for inserting property context and AI-generated content into BOV and OM documents.

**Features:**
- Property context search with insert buttons for summary paragraph, tenant section, and comp table
- AI draft assist: generate Executive Summary, Investment Highlights, Market Overview, Lease Abstract, Tenant Background, or Pricing Rationale
- Insert at cursor or replace selection with generated text
- All inserted text uses Calibri 11pt to match Briggs document standards

---

## Sideloading Instructions

### First-Time Setup (per add-in)

Each add-in requires loading the manifest XML file once. After loading, the
add-in persists across sessions until you remove it.

#### Outlook Desktop (Windows)

1. Open Outlook desktop
2. Go to **File** → **Manage Add-ins** (opens in browser)
3. Scroll to the bottom → **My add-ins**
4. Click **Add a custom add-in** → **Add from file**
5. Browse to and select `office-addins/outlook/manifest.xml`
6. Click **Install** when prompted

#### Outlook Web (OWA)

1. Open Outlook on the web (outlook.office.com)
2. Click the **Settings gear** → **View all Outlook settings**
3. Go to **Mail** → **Customize actions** → **Get add-ins**
4. Click **My add-ins** → **Custom add-ins** → **+ Add custom add-in**
5. Select **Add from URL**
6. Paste: `https://YOUR_RAILWAY_URL/office-addins/outlook/manifest.xml`
7. Click **Install**

#### Excel Desktop (Windows)

1. Open Excel
2. Go to **Insert** → **Add-ins** → **My Add-ins**
3. Click **Upload My Add-in** (at the bottom)
4. Browse to and select `office-addins/excel/manifest.xml`
5. Click **Upload**

#### Word Desktop (Windows)

1. Open Word
2. Go to **Insert** → **Add-ins** → **My Add-ins**
3. Click **Upload My Add-in** (at the bottom)
4. Browse to and select `office-addins/word/manifest.xml`
5. Click **Upload**

### After Loading

1. Open the add-in task pane (it may auto-open, or find it in the ribbon)
2. Click the **gear icon** (bottom-right) to open Settings
3. Enter your **LCC Railway URL** (e.g., `https://your-lcc.railway.app`)
4. Enter your **LCC API Key**
5. Click **Test Connection** to verify, then **Save**

Settings persist in localStorage — you only need to configure once per browser/WebView.

---

## Hosted Manifests

When the LCC server is running on Railway, manifests are served at:

- `https://YOUR_RAILWAY_URL/office-addins/outlook/manifest.xml`
- `https://YOUR_RAILWAY_URL/office-addins/excel/manifest.xml`
- `https://YOUR_RAILWAY_URL/office-addins/word/manifest.xml`

The server automatically replaces the `RAILWAY_URL` placeholder in both manifest
XMLs and taskpane HTML files with the actual Railway base URL at serve time.

---

## Architecture

```
office-addins/
  outlook/
    manifest.xml       ← Office Add-in manifest (MailApp, MessageRead)
    taskpane.html      ← Single-file task pane (HTML + CSS + JS inline)
  excel/
    manifest.xml       ← Office Add-in manifest (TaskPaneApp, Workbook)
    taskpane.html      ← Single-file task pane (HTML + CSS + JS inline)
  word/
    manifest.xml       ← Office Add-in manifest (TaskPaneApp, Document)
    taskpane.html      ← Single-file task pane (HTML + CSS + JS inline)
  shared/
    lcc-api.js         ← Reference copy of LCCApi class (inlined in each HTML)
  README.md            ← This file
```

Each taskpane.html is a **single self-contained file** — all CSS and JS is
inline. The LCCApi class from `shared/lcc-api.js` is copied inline into each
file. This is required because Office Add-in WebViews do not support ES modules
or external file references without full HTTPS + CORS hosting.

---

## Security Note

The LCC API key is stored in `localStorage` within the Office WebView. This is
acceptable for a personal, corporate-managed device where Scott is the sole user.
**Do not use this approach on shared computers** — the API key would be accessible
to other users of the same Windows profile.

---

## API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | Copilot actions (search, draft, log, generate) |
| `/api/context` | POST | Context packet assembly (property, contact) |
| `/api/config` | GET | Connection test (public, no auth) |
