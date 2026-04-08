# Copilot Studio Setup Guide — LCC Assistant

> **No M365 admin access required.** Any licensed M365 user can create and publish a personal Copilot agent through Copilot Studio (copilotstudio.microsoft.com).

---

## PHASE 1 — Authentication Setup (NO AZURE APP REGISTRATION NEEDED)

LCC uses API Key bearer token authentication — a static key in the Authorization
header. This does NOT require Azure AD, App Registrations, or admin consent.

You only need: the **LCC_API_KEY** value from your Railway environment variables.

**To get it:**
1. Go to your **Railway dashboard** → your LCC project → **Variables**.
2. Copy the `LCC_API_KEY` value.
3. This is the only credential needed for all Copilot Studio, ChatGPT, and
   Power Automate integrations.

> **Note:** The Azure AD App Registration steps previously documented here are
> NOT required. Bearer token auth is sufficient for all current LCC integrations.
> If you need OAuth/SSO in the future, see the Azure AD documentation separately.

---

## PHASE 2 — Verify Railway Environment Variables

In the **Railway dashboard** for your LCC deployment, confirm these variables are set:

| Variable | Purpose | Notes |
|----------|---------|-------|
| `LCC_API_KEY` | Bearer token for API auth | Used by Copilot Studio, Power Automate, and ChatGPT |
| `OPS_SUPABASE_URL` | OPS database connection | Required for all LCC data |
| `OPS_SUPABASE_KEY` | OPS database auth | Required for all LCC data |

> **Note:** No Azure AD variables (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`) are needed. LCC uses bearer token auth exclusively.

---

## PHASE 3 — Copilot Studio Agent Creation (20 min, no admin needed)

### 3.1 — Create the Agent

1. Go to **copilotstudio.microsoft.com** and sign in with your M365 account.
2. Click **Create** > **New agent**.
3. Configure:
   - **Name:** `LCC Assistant`
   - **Description:** `Life Command Center AI assistant for Team Briggs net lease investment sales.`
   - **Instructions:** Paste the full instructions text from `copilot_studio_manifest/declarative-copilot.json` (the `instructions` field value).

### 3.2 — Add the API Action

1. In the agent editor, go to **Actions** > **+ Add an action** > **Call an API**.
2. Click **Upload an OpenAPI description** and select `docs/setup/lcc-copilot-openapi-core.json` from your repo.
3. Copilot Studio will parse the spec and list the available operations.
4. Configure **Authentication**:
   - Select **API Key** → Auth Type: **Bearer**
   - API Key: Paste the `LCC_API_KEY` value from Railway (see Phase 1).
   - No Azure AD setup required.
5. Click **Save**.

### 3.3 — Test Each Action

In the **Test panel** on the right side of Copilot Studio, run these queries:

| # | Test Query | Expected Action |
|---|-----------|----------------|
| 1 | "What should I focus on today?" | `get_daily_briefing_snapshot` |
| 2 | "Search for GSA properties in Dallas" | `search_entity_targets` |
| 3 | "Who are my hottest contacts right now?" | `get_hot_business_contacts` |
| 4 | "Are all data pipelines running and current?" | `get_sync_run_health` |
| 5 | "Generate a prospecting call sheet for today" | `generate_prospecting_brief` |

Verify each returns real data from LCC (not a generic "I can't access that" response).

### 3.4 — Publish to Teams

1. In the agent editor, click **Publish**.
2. Under **Channels**, enable **Microsoft Teams**.
3. Click **Make available in Teams** > **Personal** (appears in the user's chat list).
4. Wait 1-2 minutes for the publish to propagate.

---

## PHASE 4 — Teams App Sideloading (backup, 5 min)

> Use this if Copilot Studio publish is unavailable or you need to distribute the app to additional users manually.

### Prerequisites

- Replace all `RAILWAY_URL` and `RAILWAY_DOMAIN` placeholders in the manifest files (see `copilot_studio_manifest/README.md` for the full list).
- Add icon files: `color.png` (192x192) and `outline.png` (32x32 transparent) in the manifest directory.

### Steps

1. Open a terminal in the `docs/setup/copilot_studio_manifest/` directory.
2. Create the zip (files only, not the folder):
   ```bash
   cd docs/setup/copilot_studio_manifest
   zip lcc-assistant.zip manifest.json declarative-copilot.json ai-plugin.json color.png outline.png
   ```
3. Open **Microsoft Teams**.
4. Go to **Apps** > **Manage your apps** > **Upload a custom app**.
5. Select the `lcc-assistant.zip` file.
6. Teams will validate the manifest and install the app.

---

## PHASE 5 — Verification Checklist

Run through each item to confirm the integration is working end-to-end:

- [ ] **Teams > Copilot > plugin icon** — LCC Assistant is listed as an available plugin.
- [ ] **"What should I focus on today?"** — Returns a structured daily briefing with strategic/important/urgent sections referencing real data.
- [ ] **"Search for GSA properties in Dallas"** — Returns entity search results from the LCC database.
- [ ] **"Who are my hottest contacts?"** — Returns contacts with engagement scores and activity context.
- [ ] **"Are all pipelines running?"** — Returns sync connector health status.
- [ ] **Railway logs** — Show `/api/chat` POST calls corresponding to each test query.
- [ ] **Response times** — Each action completes within 5 seconds (excluding cold starts).

---

## Troubleshooting

**Agent doesn't appear in Teams after publishing:**
- Wait 5 minutes — Teams propagation can be slow.
- Try signing out and back into Teams.
- Verify the publish completed without errors in Copilot Studio.

**Actions fail with authentication errors:**
- Confirm the bearer token in Copilot Studio matches `LCC_API_KEY` in Railway env vars.
- Check Railway logs for 401/403 responses.

**Actions return empty or generic responses:**
- Verify the Railway deployment is running (`RAILWAY_URL/api/config` should return JSON).
- Check that `OPS_SUPABASE_URL` and `OPS_SUPABASE_KEY` are set in Railway.
- Review the OpenAPI spec at `RAILWAY_URL/api/copilot-spec` to confirm it serves correctly.

**Copilot doesn't invoke the right action:**
- The `description` and `summary` fields in the OpenAPI spec drive action matching.
- Try rephrasing the query to match the operation descriptions more closely.
- In Copilot Studio, you can add **Topic triggers** to map specific phrases to specific actions.

---

## Architecture Reference

```
User (Teams / Copilot Chat)
    |
    v
Copilot Studio Agent (LCC Assistant)
    |
    v  (bearer token auth)
Railway Express Server
    |
    v
/api/chat (copilot_action gateway)
    |
    v  dispatchAction()
ACTION_REGISTRY -> handler
    |
    v
Response (JSON + optional Teams adaptive card)
```
