# Teams Chat Bot Setup Guide — LCC @LCC Keyword Bot

> **No Copilot Studio, no Azure AD App Registration, no M365 admin access required.**
> This uses only Power Automate + the HTTP connector + the Teams connector — tools Scott already has working with 7 live flows.

---

## How It Works

```
Teams message with "@LCC" keyword
    → Power Automate trigger (When keywords are mentioned)
    → HTTP POST to LCC /api/chat (Bearer LCC_API_KEY)
    → Parse JSON response
    → Post adaptive card reply back to the Teams thread
```

The flow routes your question to the right LCC action based on keywords in your message, then formats the response as an adaptive card in-thread.

---

## STEP 1 — Import the Flow (5 min)

### Option A: Import Package (recommended)

1. Go to [make.powerautomate.com](https://make.powerautomate.com).
2. Click **My Flows** in the left nav.
3. Click **Import** → **Import Package (Legacy)**.
4. Upload `flow-lcc-teams-chat.json` from the repo root.
5. Power Automate will show the import screen — map the Teams connector to your M365 account and click **Import**.

### Option B: Manual Build (if import fails)

1. Go to [make.powerautomate.com](https://make.powerautomate.com) → **Create** → **Automated cloud flow**.
2. Name: `LCC Teams Chat Bot`
3. Trigger: **When keywords are mentioned** (Microsoft Teams connector).
4. Follow the step-by-step logic described in `flow-lcc-teams-chat.json` to build each action manually.

---

## STEP 2 — Configure Connections (5 min)

### Teams Connector

- When prompted, sign in with your M365 account.
- This is the same Teams connector you already use in your other 7 flows.

### HTTP Connector — LCC API Key

The HTTP action in Step 3 of the flow uses Bearer token auth:

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer <YOUR_LCC_API_KEY>` |
| `Content-Type` | `application/json` |
| `X-LCC-Surface` | `teams_chat_bot` |

**To get your LCC_API_KEY:**
- Go to your **Railway dashboard** → your LCC project → **Variables** → copy the `LCC_API_KEY` value.
- Power Automate stores this as a secure string — it never appears in run history logs.

**To set the LCC_RAILWAY_URL:**
- Replace the `<LCC_RAILWAY_URL>` placeholder in the HTTP action URI with your actual Railway deployment URL (e.g., `https://your-lcc-app.up.railway.app`).

---

## STEP 3 — Set the Trigger Channel (2 min)

1. Edit the flow trigger (**When keywords are mentioned**).
2. **Team:** Select your Team from the dropdown.
3. **Channel:** Select the channel to monitor.
4. **Keywords:** Confirm these are set: `@LCC`, `@lcc`, `!lcc`

**Recommendations:**
- Create a dedicated **"LCC"** channel in Teams for bot interactions — keeps bot chatter out of general channels.
- OR use an existing channel — the bot only responds when someone includes `@LCC` in their message.

---

## STEP 4 — Test (5 min)

1. **Turn on** the flow (toggle in the top-right of the flow editor).
2. In the configured Teams channel, type:

   ```
   @LCC What should I focus on today?
   ```

3. Within **15-30 seconds**, the flow should reply with your LCC daily briefing as an adaptive card in the thread.
4. If no response appears:
   - Go to **My Flows** → click the flow → **Run history** to see what happened.
   - Check the HTTP step for 401 errors (API key mismatch) or 500 errors (LCC server issue).
   - Verify your Railway deployment is running: visit `<LCC_RAILWAY_URL>/api/config` in a browser — it should return JSON.

---

## STEP 5 — Personal Chat Trigger (Optional)

The same flow can respond to direct 1:1 Teams chat messages:

1. Duplicate the flow.
2. Change the trigger to **When a new chat message is received** (Teams connector).
3. Add a condition to filter for messages starting with `lcc:` or `@LCC`.
4. The rest of the flow (HTTP call, parse, reply) stays the same.

This lets you message LCC from any Teams chat without needing to be in a specific channel.

---

## Action Routing

The flow automatically routes your question to the right LCC action based on keywords:

| Keywords in Message | LCC Action | What You Get |
|---|---|---|
| `briefing`, `today`, `focus`, `priorities` | `get_daily_briefing_snapshot` | Morning briefing with strategic/important/urgent items |
| `search`, `find`, `look up`, `who is`, `what is` | `search_entity_targets` | Entity/property search results |
| `contact`, `call`, `relationship`, `touch` | `get_relationship_context` | Relationship briefing for a contact |
| `pipeline`, `queue`, `research`, `backlog` | `get_pipeline_intelligence` | Pipeline health and bottleneck report |
| `prospect`, `call sheet`, `outreach targets` | `generate_prospecting_brief` | Prospecting call sheet |
| *(anything else)* | `get_daily_briefing_snapshot` | Freeform query passed to LCC copilot |

Keyword matching is **case-insensitive** — `@LCC SEARCH for Boyd` works the same as `@lcc search for Boyd`.

---

## Usage Examples

Post these in your Teams channel description for quick reference:

```
@LCC What should I focus on today?
@LCC Search for Boyd Watterson
@LCC What's in the research queue?
@LCC Generate a prospecting call sheet
@LCC Pipeline health check
@LCC Who are my warmest contacts right now?
@LCC What deals need attention this week?
@LCC Call prep for my meeting with [name]
```

---

## Troubleshooting

**No response after 30 seconds:**
- Check Power Automate run history for errors.
- Verify the flow is turned on.
- Confirm the trigger channel matches where you posted.

**401 Unauthorized from HTTP step:**
- The `LCC_API_KEY` in the Authorization header doesn't match what's in Railway env vars.
- Re-copy the key from Railway → Variables → `LCC_API_KEY`.

**500 Internal Server Error:**
- Check Railway logs for the LCC deployment.
- Verify `OPS_SUPABASE_URL` and `OPS_SUPABASE_KEY` are set in Railway.

**Bot responds but with empty/generic content:**
- Check Railway deployment is fully running (`<LCC_RAILWAY_URL>/api/config` returns JSON).
- Review the parsed response in the run history — the response shape may have changed.

**Trigger not firing:**
- Ensure the keywords list includes `@LCC` (case matters for the trigger config).
- The Teams connector may need to be re-authorized — edit the trigger and re-select your account.

---

## Architecture Reference

```
User (Teams Channel)
    |  "@LCC What should I focus on today?"
    v
Power Automate Trigger (keyword mention)
    |
    v
Step 1: Extract message text, strip keyword
    |
    v
Step 2: Route to copilot_action via keyword matching
    |
    v
Step 3: HTTP POST → LCC /api/chat (Bearer token auth)
    |                  └─→ /api/operations?_route=chat (vercel.json rewrite)
    v
Step 4: Parse JSON response
    |
    v
Step 5: Build adaptive card (error or results)
    |
    v
Teams: Reply with adaptive card in thread
```

### Related Files

| File | Purpose |
|------|---------|
| `flow-lcc-teams-chat.json` | Flow definition (this bot) |
| `docs/architecture/teams_lcc_chat_adaptive_card.json` | Results adaptive card template |
| `docs/architecture/teams_lcc_chat_error_adaptive_card.json` | Error adaptive card template |
| `flow-daily-briefing-to-teams.json` | Scheduled daily briefing flow (reference) |
| `flow-outlook-intake-to-teams-hardened.json` | Email intake flow (reference) |
| `api/_shared/ai.js` | COPILOT_SYSTEM_PROMPT used by /api/chat |
