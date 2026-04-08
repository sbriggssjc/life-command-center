# Copilot Studio Setup Guide — LCC Assistant

> **No M365 admin access required.** Any licensed M365 user can create and publish a personal Copilot agent through Copilot Studio (copilotstudio.microsoft.com).

---

## PHASE 1 — Azure AD App Registration (15 min)

> Skip this phase if you only need bearer-token (API key) auth. Come back to it when you want OAuth/SSO.

1. Go to **portal.azure.com** and sign in with your M365 account.
2. Navigate to **Azure Active Directory** > **App Registrations** > **+ New registration**.
3. Configure the registration:
   - **Name:** `LCC Copilot Plugin`
   - **Supported account types:** Single tenant (this organization only)
   - **Redirect URI:** Platform = Web, URI = `RAILWAY_URL/auth/callback`
4. Click **Register**.
5. On the app overview page, copy and save:
   - **Application (client) ID**
   - **Directory (tenant) ID**
6. In the left nav, go to **Certificates & secrets** > **+ New client secret**:
   - Description: `LCC Copilot`
   - Expiry: 24 months (or per your org policy)
   - Click **Add** and **copy the secret value immediately** (it won't be shown again).
7. In the left nav, go to **Expose an API**:
   - Click **Set** next to Application ID URI — accept the default `api://<client-id>` or customize.
   - Click **+ Add a scope**:
     - Scope name: `lcc.access`
     - Who can consent: Admins and users
     - Admin consent display name: `Access Life Command Center`
     - Admin consent description: `Allows the Copilot agent to call LCC APIs on behalf of the user.`
     - State: Enabled
   - Click **Add scope**.

---

## PHASE 2 — Update Railway Environment Variables

In the **Railway dashboard** for your LCC deployment, add these environment variables:

| Variable | Value | Notes |
|----------|-------|-------|
| `AZURE_CLIENT_ID` | Application (client) ID from Phase 1 | Only needed if using OAuth |
| `AZURE_TENANT_ID` | Directory (tenant) ID from Phase 1 | Only needed if using OAuth |
| `AZURE_CLIENT_SECRET` | Client secret value from Phase 1 | Only needed if using OAuth |

> **Note:** Bearer token auth (using `LCC_API_KEY`) works without the Azure AD variables. You can skip Phase 1 and Phase 2 entirely if you configure Copilot Studio with a bearer token in Phase 3.

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
   - Type: **Bearer token**
   - Token value: Enter the `LCC_API_KEY` value from your Railway/Vercel environment variables.
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
