# MS Copilot Plugin Registration — Life Command Center

This guide walks through registering the LCC Copilot plugin so Microsoft 365 Copilot can discover and invoke LCC actions directly from Teams, Outlook, and the M365 Chat surface.

## Prerequisites

1. LCC API deployed to Vercel with all endpoints live
2. The following endpoints must be accessible:
   - `GET /api/copilot-spec` → returns the OpenAPI 3.0 spec
   - `GET /api/copilot-manifest` → returns the ai-plugin.json manifest
3. M365 admin access (Global Admin or Teams Admin role)
4. Microsoft 365 Copilot license assigned to users who will use the plugin

## Step 1: Verify Endpoints

Before registering, confirm the spec and manifest are serving correctly:

```bash
# OpenAPI spec (should return JSON with 37+ paths)
curl https://life-command-center.vercel.app/api/copilot-spec | jq '.paths | length'

# Plugin manifest (should return ai-plugin.json format)
curl https://life-command-center.vercel.app/api/copilot-manifest | jq '.name_for_human'
```

Expected manifest response:
```json
{
  "schema_version": "v1",
  "name_for_human": "Life Command Center",
  "name_for_model": "life_command_center",
  "description_for_human": "CRE deal intelligence...",
  "api": {
    "type": "openapi",
    "url": "https://life-command-center.vercel.app/api/copilot-spec"
  },
  "auth": {
    "type": "service_http",
    "authorization_type": "bearer"
  }
}
```

## Step 2: Register in Teams Admin Center

1. Go to **Teams Admin Center** → https://admin.teams.microsoft.com
2. Navigate to **Copilot** → **Agents** (or **Teams apps** → **Manage apps** depending on tenant version)
3. Click **+ Upload a custom app** or **+ New agent**
4. Select **API Plugin** as the type
5. Enter the manifest URL: `https://life-command-center.vercel.app/api/copilot-manifest`
6. Teams Admin will validate the manifest and fetch the OpenAPI spec automatically

## Step 3: Configure Authentication

In the plugin registration wizard:

1. Authentication type: **API Key** (Bearer token)
2. Token location: **Authorization header**
3. Token format: `Bearer <token>`
4. Enter the `LCC_API_KEY` value from Vercel environment variables
5. The same key used by Power Automate flows works for Copilot

**Important**: The LCC API uses dual-mode auth — it accepts both:
- `Authorization: Bearer <LCC_API_KEY>` (for Copilot/PA)
- Standard Supabase JWT auth (for the frontend app)

## Step 4: Configure Plugin Permissions

Set the following permissions in the registration wizard:

- **Read actions** (Tier 0): Allow without confirmation
  - get_daily_briefing_snapshot
  - list_staged_intake_inbox
  - get_my_execution_queue
  - get_work_counts
  - get_hot_business_contacts
  - search_entity_targets
  - list_email_templates
  - get_email_template
  - get_template_performance
  - evaluate_template_health
  - generate_prospecting_brief
  - get_relationship_context
  - get_pipeline_intelligence
  - All other tier 0 actions

- **Write actions** (Tier 1-2): Require user confirmation in Copilot
  - draft_outreach_email
  - generate_template_draft
  - generate_batch_drafts
  - create_todo_task
  - triage_inbox_item
  - promote_intake_to_action
  - record_template_send
  - run_listing_bd_pipeline

- **Blocked actions** (Tier 3): Not available through Copilot
  - Any future tier-3 actions requiring human approval chain

## Step 5: Set User Assignment

1. Under **Users and groups**, assign the plugin to:
   - Scott Briggs (sbriggssjc@gmail.com)
   - Any additional team members with M365 Copilot licenses
2. Or assign to **Everyone in the organization** if preferred

## Step 6: Test in Teams

1. Open **Microsoft Teams** → **Copilot** (or M365 Chat)
2. Type: `@Life Command Center what should I work on today?`
3. Copilot should invoke `get_daily_briefing_snapshot` and return the briefing
4. Try: `draft an outreach email for John Smith` → should invoke `draft_outreach_email`
5. Try: `show me my pipeline health` → should invoke `get_pipeline_intelligence`

## Step 7: Configure Adaptive Cards (Optional)

The LCC API returns `_teams_card` data when the `surface` parameter is set to `teams`. To enable rich adaptive card rendering:

1. In the plugin manifest, ensure the `response_semantics` section includes:
   ```json
   {
     "content_type": "AdaptiveCard",
     "static_template": "$response._teams_card"
   }
   ```
2. This tells Copilot to render the response as an adaptive card when available

## Troubleshooting

**Plugin not appearing in Copilot:**
- Check that the manifest URL is publicly accessible (no auth required for GET)
- Verify the OpenAPI spec validates at https://editor.swagger.io
- Ensure the Copilot license is assigned to the user

**Authentication errors:**
- Confirm the API key in Teams Admin matches `LCC_API_KEY` in Vercel env vars
- Check that the key includes the `Bearer ` prefix in the auth config

**Actions not being invoked:**
- Copilot uses the `description` field in the OpenAPI spec to match natural language to actions
- If an action isn't being triggered, check its description in `action-schemas.js`
- Consider adding `operationId` aliases if the description isn't matching well

**Slow responses:**
- First invocation after cold start may take 3-5 seconds (Vercel serverless cold boot)
- Subsequent invocations should be <1 second
- The daily briefing is pre-cached by the scheduled task at 6:30 AM CT

## Updating the Plugin

When new actions are added to the ACTION_REGISTRY:

1. They automatically appear in the OpenAPI spec (generated dynamically)
2. No need to re-register the plugin — Teams fetches the spec on each invocation
3. New schemas in `action-schemas.js` are automatically reflected
4. Test new actions in Teams to verify Copilot discovers them correctly

## Architecture Reference

```
M365 Copilot
    ↓ natural language
Teams / Outlook / M365 Chat
    ↓ plugin invocation
/api/copilot-spec (OpenAPI discovery)
    ↓
/api/chat (copilot_action gateway)
    ↓ dispatchAction()
ACTION_REGISTRY → handler
    ↓
Response + _teams_card + _digest
    ↓
Copilot renders adaptive card or text
```

The gateway at `/api/chat` handles:
- Input validation against ACTION_SCHEMAS
- Tier-based confirmation (tier 0 = auto, tier 1-2 = explicit)
- Surface-aware formatting (Teams cards, Outlook digests)
- Copilot invocation signals for the learning loop
