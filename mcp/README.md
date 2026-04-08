# LCC MCP Server

A standalone [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that connects Claude.ai directly to Life Command Center data. When connected, you can ask Claude natural-language questions like "pull up the GSA lease on 1301 Clay St" and Claude calls LCC tools natively — no copy-paste required.

This server is a **separate deployable service**. It does NOT run inside the Vercel `/api/` directory and does NOT count against the 12-function limit.

## Quick Start

```bash
cd mcp
cp .env.example .env
# Fill in your Supabase URLs/keys and LCC_API_KEY
npm install
npm run dev
```

The server starts on `http://localhost:3100` with hot-reload via `--watch`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPS_SUPABASE_URL` | Yes | OPS database Supabase URL |
| `OPS_SUPABASE_KEY` | Yes | OPS database service role key |
| `GOV_SUPABASE_URL` | For pipeline tools | Government domain Supabase URL |
| `GOV_SUPABASE_KEY` | For pipeline tools | Government domain service role key |
| `LCC_API_KEY` | Recommended | Bearer token for authentication (if blank, auth is disabled) |
| `MCP_BASE_URL` | Recommended | Public URL of this MCP server (used in OAuth metadata). If not set, derived from request host header. |
| `PORT` | No | Server port (default: 3100) |

## Deploy to Railway

1. Create a new Railway project
2. Connect your GitHub repo or push the `/mcp` directory
3. Set the root directory to `/mcp` (or use the Dockerfile)
4. Add environment variables in Railway dashboard
5. Railway auto-detects the Dockerfile and deploys

Alternatively, Railway's nixpacks will auto-detect `package.json` and run `npm start`.

## Connect in Claude.ai

1. Open Claude.ai → Settings → Integrations
2. Click "Add MCP Server"
3. Enter:
   - **URL:** `https://your-railway-domain.up.railway.app/sse`
   - **Authentication:** Header → `Authorization: Bearer YOUR_LCC_API_KEY`
4. Claude will discover all 6 tools automatically

## Tools

### 1. `get_daily_briefing`
Get today's strategic, important, and urgent priorities for the team.

**Example prompts:**
- "What should I focus on today?"
- "Give me the morning briefing"
- "What are the team's strategic priorities?"

### 2. `search_entities`
Search for properties, contacts, or organizations in the LCC database.

**Example prompts:**
- "Find all properties in Houston"
- "Look up Scott Briggs"
- "Search for DaVita entities"
- "Find government-leased assets in Texas"

### 3. `get_property_context`
Get full context for a specific property: lease details, ownership history, comps, investment score, research status, and related contacts.

**Example prompts:**
- "Pull up the GSA lease on 1301 Clay St"
- "What do we know about the VA clinic in Tampa?"
- "Get the full context on that Dallas property"

### 4. `get_contact_context`
Get relationship context for a contact: touchpoint history, active deals, last interaction, outreach recommendations.

**Example prompts:**
- "When did I last talk to John Smith?"
- "Give me the relationship brief on Sarah Johnson before my call"
- "Who haven't we touched in over 2 weeks?"

### 5. `get_queue_summary`
Get the current research and action queue — what needs to be done, in priority order.

**Example prompts:**
- "What's in the queue right now?"
- "Show me pending government research tasks"
- "What's in progress across all domains?"

### 6. `get_pipeline_health`
Check the status of all data pipelines — last run times, success rates, and any failures.

**Example prompts:**
- "Are all pipelines healthy?"
- "When did the GSA diff last run?"
- "Any pipeline failures I should know about?"

## Endpoints

| Path | Method | Description |
|---|---|---|
| `/sse` | GET | SSE connection for MCP clients |
| `/messages` | POST | Message endpoint for MCP protocol |
| `/health` | GET | Health check with tool list and config status |
| `/` | GET | Server info |

## Architecture

```
Claude.ai ──SSE──→ /mcp/server.js ──fetch──→ OPS Supabase (entities, actions, events)
                                    ──fetch──→ GOV Supabase (leases, ownership, pipelines)
```

All database calls use the same fetch-based PostgREST pattern as the main LCC API (`api/_shared/ops-db.js`). No database drivers — just HTTP to Supabase REST endpoints.

All tools are **read-only**. The MCP server cannot create, update, or delete any data.

## AI Surface Comparison

| Feature | Claude (MCP) | ChatGPT (GPT Actions) | Copilot (Copilot Studio) |
|---|---|---|---|
| Real-time LCC data | Yes | Yes | Yes |
| Setup required | Connect MCP in settings | Create GPT + add action | Copilot Studio agent |
| Best for | Deep research sessions | Quick lookups, data analysis | M365 workflow (Outlook, Teams) |
| Auth | Bearer token | API Key bearer | Bearer token |
| Read/Write | Read-only | Read-only | Read + Tier 1/2 actions |
