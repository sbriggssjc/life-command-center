# ChatGPT GPT Actions Setup — LCC Assistant

Step-by-step guide for creating a private ChatGPT GPT that connects to the Life Command Center API for real-time CRE deal intelligence.

## Prerequisites

- ChatGPT Plus or Team subscription (GPTs require a paid plan)
- LCC deployed to Railway with a public URL
- `LCC_API_KEY` value from your Railway environment variables

---

## Step 1: Create the GPT

1. Go to [https://chatgpt.com](https://chatgpt.com)
2. Click **Explore GPTs** (left sidebar)
3. Click **Create a GPT** (top right)

## Step 2: Configure Tab

Fill in the following fields:

| Field | Value |
|-------|-------|
| **Name** | LCC Assistant |
| **Description** | Life Command Center AI for Team Briggs CRE deal intelligence |
| **Instructions** | Paste the full contents of `gpt-actions-system-prompt.txt` |

### Conversation Starters

Add these five conversation starters:

1. `What should I focus on today?`
2. `Pull up the context for 1301 Clay Street Oakland`
3. `Give me a relationship brief on Boyd Watterson before I call`
4. `How is the pipeline looking?`
5. `Generate a prospecting call sheet for today`

## Step 3: Capabilities

Configure these capability toggles:

| Capability | Setting | Reason |
|------------|---------|--------|
| **Web Search** | **Disable** | LCC has real data — web search conflicts with live API results |
| **Code Interpreter** | **Enable** | Useful for analyzing comp data, building charts from pipeline metrics |
| **DALL-E Image Generation** | Disable | Not needed for CRE workflows |

## Step 4: Actions — Add the LCC API

1. Click **Actions** → **Add action**
2. Choose one of these import methods:

### Option A: Import from URL
- Click **Import from URL**
- Enter: `RAILWAY_URL/api/copilot-spec`
- ChatGPT will auto-discover the OpenAPI schema

### Option B: Upload JSON
- Click **Import from file** or paste the contents of `gpt-actions-openapi.json`

### Authentication

After importing the schema, configure authentication:

| Setting | Value |
|---------|-------|
| **Authentication type** | API Key |
| **Auth Type** | Bearer |
| **API Key** | *(paste your `LCC_API_KEY` value)* |

### Privacy Policy

- **Privacy policy URL**: `RAILWAY_URL/privacy`

## Step 5: Test in Preview

Use the preview panel on the right to verify the GPT works:

### Test 1: Daily Briefing
> "What should I focus on today?"

Expected: GPT calls `get_daily_briefing_snapshot` and returns prioritized items organized by STRATEGIC / IMPORTANT / URGENT.

### Test 2: Entity Search
> "Search for Boyd Watterson"

Expected: GPT calls `search_entity_targets` with `q: "Boyd Watterson"` and returns matching entities.

### Test 3: Pipeline Check
> "How's the pipeline looking?"

Expected: GPT calls `get_pipeline_intelligence` and returns deal velocity, conversion rates, and bottleneck analysis.

### Test 4: Prospecting
> "Generate a prospecting call sheet for today"

Expected: GPT calls `generate_prospecting_brief` and returns a ranked list of contacts with call prep notes.

### Test 5: Email Draft
> "Draft an outreach email for reconnecting with John Smith"

Expected: GPT calls `draft_outreach_email` with `contact_name: "John Smith"` and `intent: "reconnect"`, then presents the draft for review.

## Step 6: Save

1. Click **Save** (top right)
2. Set visibility to **Only me** (private GPT)
3. Confirm and save

## Step 7: Access Your GPT

Your GPT is now available at:
```
https://chatgpt.com/g/[your-gpt-id]
```

You can also find it under **Explore GPTs** → **My GPTs** in the ChatGPT sidebar.

---

## Troubleshooting

### "Authentication failed" or 401 errors
- Verify the API Key is set correctly: Authentication → API Key → Bearer → paste key
- Ensure `LCC_API_KEY` is set in your Railway environment variables
- Check that the Railway deployment is running

### "Could not connect" or timeout errors
- Verify the Railway URL is correct and the service is deployed
- Check Railway logs for any startup errors
- Ensure the `/api/copilot-spec` endpoint returns the OpenAPI spec

### GPT doesn't call the API
- Verify the instructions contain the line: "always call the LCC API first"
- Check that Web Search is **disabled** (it can override API calls)
- Try being more explicit: "Use the LCC API to get my daily briefing"

### GPT returns raw JSON
- The system prompt instructs it to format with tables and bullets
- If it still shows raw JSON, add to the instructions: "Always format API responses as readable markdown"

---

## Updating the GPT

When the LCC API adds new actions:

1. Open the GPT editor (My GPTs → LCC Assistant → Edit)
2. Go to Actions → click the existing action
3. Re-import from `RAILWAY_URL/api/copilot-spec` or upload the updated `gpt-actions-openapi.json`
4. Update the Instructions if new actions need prompt guidance
5. Save
