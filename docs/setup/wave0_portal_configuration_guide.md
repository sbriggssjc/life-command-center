# Wave 0 Completion — Microsoft 365 & Portal Configuration Guide

> **Purpose:** Step-by-step instructions for completing Wave 0 configuration outside the codebase.
> These are browser-based tasks in Vercel, Power Automate, and Teams.
> **Date:** 2026-04-06
> **Prerequisite:** Wave 0 code changes are committed and pushed to `claude/review-m365-copilot-rollout-qMpWT`

---

## Overview

| Step | Where | Time | Blocks |
|------|-------|------|--------|
| 1. Set Vercel environment variables | Vercel Dashboard | 5 min | Auth hardening + flow auth |
| 2. Get Teams Team & Channel IDs | Microsoft Teams | 5 min | Flow configuration |
| 3. Create Teams channels | Microsoft Teams | 5 min | Flow targets |
| 4. Import & configure Daily Briefing flow | Power Automate | 10 min | Morning briefing delivery |
| 5. Import & configure Outlook Intake flow | Power Automate | 10 min | Email capture pipeline |
| 6. Verify existing flows are healthy | Power Automate | 5 min | Ongoing sync reliability |
| 7. Set Morning Briefing URL (if available) | Vercel Dashboard | 2 min | Full briefing content |

---

## Step 1: Set Vercel Environment Variables

### Navigate
1. Go to **Vercel Dashboard** → your LCC project
2. Click **Settings** → **Environment Variables**

### Variables to Set

#### Required Now

| Variable | Value | Environment | Notes |
|----------|-------|-------------|-------|
| `LCC_ENV` | `production` | Production | **Critical.** Activates auth hardening. Without this, the transitional fallback we just gated still runs because the default is `development`. |

#### Required Before Activating Power Automate Flows

| Variable | Value | Environment | Notes |
|----------|-------|-------------|-------|
| `LCC_API_KEY` | Generate: `openssl rand -hex 32` | Production | Power Automate flows use this to authenticate. **IMPORTANT:** Once set, all API requests require this key. The frontend currently does NOT send it, so the LCC web app will stop loading data until you either (a) add the header to frontend fetch calls, or (b) keep `LCC_ENV=development` temporarily while you add frontend auth. |

> **Decision Point:** If you're not ready to lock down the frontend yet, you have two options:
>
> **Option A (Recommended for now):** Set `LCC_ENV=production` but do NOT set `LCC_API_KEY` yet. The auth hardening code will reject unauthenticated requests because there's no API key configured and the environment is production. Wait — actually this will block everything. Let me clarify the logic:
>
> **Option B (Pragmatic):** Keep `LCC_ENV=development` for now. Set `LCC_API_KEY` to a strong value. This means:
> - The transitional fallback still works for the frontend (browser requests without credentials get the dev user)
> - Power Automate flows can authenticate with the API key
> - You can migrate the frontend to send the key at your own pace
> - Once the frontend sends the key, flip `LCC_ENV` to `production`
>
> **Option C (Full lockdown):** Set both `LCC_ENV=production` and `LCC_API_KEY`. Then immediately update `app.js` to include `'x-lcc-key': '<LCC_API_KEY>'` in all fetch headers. This is the most secure but requires a code change + deploy before the app works.

#### Optional (Set When Available)

| Variable | Value | Environment | Notes |
|----------|-------|-------------|-------|
| `MORNING_BRIEFING_STRUCTURED_URL` | URL to Morning Briefing JSON output | Production | The daily briefing snapshot endpoint will consume this. Without it, briefings run in degraded mode (ops signals only, no market intelligence). |
| `MORNING_BRIEFING_HTML_URL` | URL to Morning Briefing HTML output | Production | Optional fallback for Outlook digest rendering. |

### After Setting Variables
- Trigger a **redeploy** from the Vercel dashboard (Deployments → most recent → "..." → Redeploy)
- Verify the deployment succeeds (12 serverless functions, no errors)

---

## Step 2: Get Teams Team ID and Channel ID

You'll need these IDs for Power Automate flow configuration.

### Get Team ID

1. Open **Microsoft Teams** (desktop or web)
2. Find the team you want to use for LCC notifications
3. Click the **"..."** (three dots) next to the team name
4. Click **"Get link to team"**
5. Copy the link — it looks like:
   ```
   https://teams.microsoft.com/l/team/19%3A...%40thread.tacv2/conversations?groupId=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX&tenantId=...
   ```
6. The `groupId` parameter is your **TEAMS_TEAM_ID**:
   ```
   XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
   ```

### Get Channel ID

1. Right-click the **channel** you want to post to
2. Click **"Get link to channel"** (or "Copy link")
3. The link looks like:
   ```
   https://teams.microsoft.com/l/channel/19%3ACHANNEL_ID_HERE%40thread.tacv2/ChannelName?groupId=...&tenantId=...
   ```
4. The channel portion is URL-encoded. The **TEAMS_CHANNEL_ID** is:
   ```
   19:CHANNEL_ID_HERE@thread.tacv2
   ```
   (URL-decode the `%3A` → `:` and `%40` → `@`)

### Save These Values
Record them somewhere secure — you'll need them in Steps 4 and 5:

```
TEAMS_TEAM_ID     = (paste groupId here)
BRIEFING_CHANNEL  = (paste channel ID for daily briefings)
INTAKE_CHANNEL    = (paste channel ID for intake notifications)
```

---

## Step 3: Create Teams Channels (If They Don't Exist)

### Create a Daily Briefing Channel
1. In your team, click **"+" → "Add a channel"**
2. Name: **"Daily Briefing"** (or "Morning Command Center")
3. Description: "Automated daily operational briefing from LCC"
4. Privacy: **Standard** (all team members can see)
5. Click **Create**
6. Get the Channel ID using Step 2 instructions above

### Create an Intake Notifications Channel
1. Click **"+" → "Add a channel"**
2. Name: **"Intake Notifications"** (or "Email Intake")
3. Description: "Flagged Outlook emails captured into LCC intake pipeline"
4. Privacy: **Standard**
5. Click **Create**
6. Get the Channel ID using Step 2 instructions above

---

## Step 4: Import & Configure Daily Briefing Flow

### Import the Flow

1. Go to **Power Automate** → https://make.powerautomate.com
2. Click **"My flows"** in the left nav
3. Click **"Import"** → **"Import Package (Legacy)"**
   - Or: **"New flow" → "Import from file"** (depending on your portal version)
4. Upload: `flow-daily-briefing-to-teams.json` from the LCC repo
5. During import, you'll be asked to map connections:
   - **Teams** → Select your Microsoft Teams connection (or create one)
   - **HTTP** → No connection needed (uses HTTP actions directly)
6. Click **Import**

### Configure Flow Parameters

After import, open the flow and update these values:

| Parameter | Where to Set | Value |
|-----------|-------------|-------|
| `LCC_HOST` | HTTP action URL | Your Vercel deployment URL (e.g., `https://life-command-center.vercel.app`) |
| `LCC_API_KEY` | HTTP action headers → `x-lcc-key` | The API key you set in Vercel (Step 1) |
| `WORKSPACE_ID` | HTTP action headers → `x-lcc-workspace` | Your workspace ID from LCC admin |
| `ROLE_VIEW` | HTTP action URL query param | `broker` (create a second flow for `analyst_ops` if needed) |
| `TEAMS_TEAM_ID` | "Post adaptive card" action → Team | Select your team from dropdown, or paste the ID |
| `TEAMS_CHANNEL_ID` | "Post adaptive card" action → Channel | Select the Daily Briefing channel |

### Configure the HTTP Action

Find the **HTTP** action (fetches the snapshot) and set:
- **Method:** `GET`
- **URI:** `https://<LCC_HOST>/api/daily-briefing?action=snapshot&role_view=broker`
- **Headers:**
  ```
  x-lcc-key: <LCC_API_KEY>
  x-lcc-workspace: <WORKSPACE_ID>
  Content-Type: application/json
  ```

### Configure the Recurrence Trigger

1. Click the **Recurrence** trigger at the top of the flow
2. Set:
   - **Frequency:** Week
   - **Interval:** 1
   - **On these days:** Monday, Tuesday, Wednesday, Thursday, Friday
   - **At these hours:** 7 (or 7:30 if half-hour scheduling is available)
   - **Time zone:** (UTC-06:00) Central Time (US & Canada)

### Leave DISABLED for Now

The daily briefing snapshot endpoint (`GET /api/daily-briefing?action=snapshot`) isn't fully implemented yet — that's Phase 1B work. Keep the flow saved but **turned off** until the endpoint is built.

To test the flow structure:
1. Click **"Test"** → **"Manually"**
2. The HTTP step will likely return an error or partial data — that's expected
3. Verify the Teams posting step is correctly configured (channel, card format)

---

## Step 5: Import & Configure Outlook Intake Flow

### Import the Flow

1. In **Power Automate** → **"My flows"** → **"Import"**
2. Upload: `flow-outlook-intake-to-teams-hardened.json` from the LCC repo
3. Map connections during import:
   - **Office 365 Outlook** → Your Outlook connection
   - **Teams** → Your Microsoft Teams connection
4. Click **Import**

### Configure Flow Parameters

| Parameter | Where to Set | Value |
|-----------|-------------|-------|
| `LCC_HOST` | HTTP actions (both POST and GET) | Your Vercel deployment URL |
| `LCC_API_KEY` | HTTP action headers → `x-lcc-key` | Same API key from Step 1 |
| `WORKSPACE_ID` | HTTP action headers → `x-lcc-workspace` | Your workspace ID |

### Configure the HTTP Actions

**Action 1 — POST intake message:**
- **Method:** `POST`
- **URI:** `https://<LCC_HOST>/api/intake-outlook-message`
- **Headers:**
  ```
  x-lcc-key: <LCC_API_KEY>
  x-lcc-workspace: <WORKSPACE_ID>
  Content-Type: application/json
  ```
- **Body:** Should already be mapped from the Outlook trigger (message_id, subject, from, body_preview, received_date_time, web_link, has_attachments)

**Action 2 — GET intake summary:**
- **Method:** `GET`
- **URI:** `https://<LCC_HOST>/api/intake-summary?correlation_id=@{body('HTTP_PostIntake')?['correlation_id']}&limit=1`
- **Headers:**
  ```
  x-lcc-key: <LCC_API_KEY>
  x-lcc-workspace: <WORKSPACE_ID>
  ```

**Action 3 — Post to Teams:**
- **Team:** Select your team
- **Channel:** Select the Intake Notifications channel

### Test the Flow

1. Click **"Test"** → **"Manually"**
2. Go to **Outlook** and **flag an email** (any email)
3. Watch the flow run:
   - Should POST to intake endpoint
   - Should GET the summary
   - Should post an adaptive card to the Intake Notifications channel
4. Verify in LCC that the inbox item was created
5. Verify the Teams card appears with correct sender, subject, and action buttons

### Enable the Flow

Once testing passes, toggle the flow **ON**. It will now trigger automatically whenever you flag an email in Outlook.

---

## Step 6: Verify Existing Flows Are Healthy

Check that your previously configured flows are still running:

### In Power Automate → My Flows

| Flow | Expected Status | Check |
|------|----------------|-------|
| Email Flag → To Do | On, recent successful runs | Flag a test email, verify To Do task created |
| To Do Complete → Unflag Email | On, recent successful runs | Complete a To Do task, verify email unflagged |
| Personal Calendar Sync | On, runs hourly | Check last run time is < 2 hours ago |
| Personal Email Flag → To Do | On (if configured) | Test with personal Outlook.com |

### For Each Flow
1. Click the flow name
2. Check **"Run history"** — look for recent green checkmarks
3. If any show red X failures:
   - Click the failed run
   - Expand the failed step
   - Common issues:
     - **401 Unauthorized:** Connection needs to be re-authenticated (click "..." → "Edit" → fix the connection)
     - **404 Not Found:** Endpoint URL may have changed after consolidation — update to use the new rewrite paths
     - **429 Too Many Requests:** Rate limiting — reduce frequency or add retry

---

## Step 7: Set Morning Briefing URL (When Available)

This step depends on whether your Morning Briefing repo has a stable JSON output URL.

### If the URL Is Available Now

1. Go to **Vercel Dashboard** → LCC project → **Settings** → **Environment Variables**
2. Add:
   - `MORNING_BRIEFING_STRUCTURED_URL` = `https://<morning-briefing-host>/api/briefing/latest.json` (or whatever your URL is)
   - `MORNING_BRIEFING_HTML_URL` = `https://<morning-briefing-host>/api/briefing/latest.html` (optional)
3. Redeploy

### If the URL Is NOT Available Yet

No action needed. The daily briefing snapshot endpoint will run in **degraded mode**:
- LCC operational signals (queue counts, my work, inbox, sync health) will still populate
- The `global_market_intelligence` section will be empty
- The card will show a `status.completeness: "degraded"` badge
- This is by design — the briefing is still useful without market intel

---

## Verification Checklist

After completing all steps, verify:

- [ ] Vercel deployment is live with correct environment variables
- [ ] `LCC_ENV` is set appropriately (see Step 1 decision point)
- [ ] `LCC_API_KEY` is set (if you chose Option B or C)
- [ ] Teams has a "Daily Briefing" channel created
- [ ] Teams has an "Intake Notifications" channel created
- [ ] Team ID and Channel IDs are recorded
- [ ] Daily Briefing flow is imported, configured, and **saved (disabled)**
- [ ] Outlook Intake flow is imported, configured, tested, and **enabled**
- [ ] Existing email/calendar/To Do flows show recent green runs
- [ ] Morning Briefing URL is set (or noted as pending)

---

## What Happens Next

With Wave 0 portal configuration complete:

1. **Phase 1B (next code sprint):** Build the daily briefing snapshot aggregation logic. Once that endpoint returns real data, enable the Daily Briefing flow.
2. **Phase 1C:** The Outlook Intake flow is already live after this guide — flagged emails will start flowing into LCC intake immediately.
3. **Phase 1D-F:** Copilot read actions, prospecting wiring, and write action confirmation are all code-side work.

---

## Quick Reference: All Values You'll Need

Copy this template and fill in your values as you go:

```
# Vercel Environment Variables
LCC_ENV=production
LCC_API_KEY=<generate with: openssl rand -hex 32>
MORNING_BRIEFING_STRUCTURED_URL=<pending or URL>
MORNING_BRIEFING_HTML_URL=<pending or URL>

# Teams IDs
TEAMS_TEAM_ID=<from Step 2>
BRIEFING_CHANNEL_ID=<from Step 3>
INTAKE_CHANNEL_ID=<from Step 3>

# LCC Context
LCC_HOST=<your Vercel deployment URL>
WORKSPACE_ID=<from LCC admin panel or ops database>
```
