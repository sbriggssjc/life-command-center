<!-- Converted 2026-09-16 by Cowork from the root file `LCC-Copilot-Agent-Setup-Guide.docx` (pandoc, gfm) so that repo tools and Claude Code can read it. The .docx stays at the repo root (REPO1 decision: cited from audit/); this Markdown is the readable copy, NOT a new source of truth — its claims carry the original's date. -->

**LCC Copilot Agent**

Setup Guide for Microsoft 365 Copilot Agent Builder

April 2026 | Life Command Center | Briggs CRE

**Overview**

This guide walks you through creating a custom Microsoft 365 Copilot agent that connects to the Life Command Center (LCC) API. Once set up, the agent will be available in Microsoft 365 Copilot chat, Teams, and Outlook — giving you natural language access to your daily briefing, pipeline intelligence, contact lookups, email drafting, and work queue management.

**What you need:** Access to the Microsoft 365 Copilot agent builder (the “Create agents in Copilot” feature), and your LCC API key.

**Time required:** 15–20 minutes.

**Prerequisites**

  - Microsoft 365 Copilot license with agent creation enabled

  - LCC API key (set as LCC\_API\_KEY in Vercel env vars)

  - LCC production URL: https://life-command-center-nine.vercel.app

**Step 1: Open the Agent Builder**

Navigate to Microsoft 365 Copilot (copilot.microsoft.com or the Copilot app in Teams). Click the “Create” or “Agents” option. Select “New agent” to start from scratch.

**Step 2: Name and Describe the Agent**

|             |                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Field**   | **Value**                                                                                                               |
| Name        | LCC Copilot                                                                                                             |
| Description | CRE deal intelligence — daily briefings, pipeline, outreach, contacts, and queue management for the NorthMarq NNN team. |
| Icon        | Upload your LCC logo or use a briefcase/building icon                                                                   |

**Step 3: Paste the Agent Instructions**

In the “Instructions” (or “System prompt”) field, paste the full contents of:

docs/setup/copilot-agent-instructions.md

This file is in your LCC repository and contains the complete system prompt with all 37 action descriptions, tier definitions, response style guidance, and business context.

**Step 4: Add the API Action**

This is the key step — connecting the agent to your LCC API so it can fetch real data and execute actions.

**Option A: OpenAPI Spec (Recommended)**

In the agent builder, look for “Actions” or “Plugins” or “Add an API.” Select “OpenAPI” or “Add from URL” and enter:

https://life-command-center-nine.vercel.app/api/copilot-spec

The agent builder will import all 37 actions automatically with their descriptions, parameters, and response schemas. The Copilot uses these descriptions to decide which action to call based on the user’s natural language request.

**Option B: Manual Single-Action Setup**

If the agent builder doesn’t support OpenAPI import, add a single action manually:

|             |                                                                                |
| ----------- | ------------------------------------------------------------------------------ |
| **Field**   | **Value**                                                                      |
| Name        | LCC Action Gateway                                                             |
| Method      | POST                                                                           |
| URL         | https://life-command-center-nine.vercel.app/api/chat                           |
| Headers     | Content-Type: application/json                                                 |
| Auth Header | X-LCC-Key: \[your LCC\_API\_KEY value\]                                        |
| Body Schema | { "copilot\_action": "\<action\_id\>", "params": { ... }, "surface": "teams" } |

**Step 5: Configure Authentication**

The agent needs to authenticate to the LCC API. Use API Key authentication:

  - Authentication type: API Key (or Custom Header)

  - Header name: X-LCC-Key

  - Header value: \[your LCC\_API\_KEY from Vercel env vars\]

**Important:** Do NOT use the Supabase JWT for the agent. The API key is the correct auth method for external integrations like Copilot agents and Power Automate flows. The JWT path is for browser-based sign-in only.

**Step 6: Test the Agent**

Before publishing, test these requests in the agent builder’s preview panel:

|                                                      |                                |
| ---------------------------------------------------- | ------------------------------ |
| **Say this to the agent**                            | **Expected action**            |
| “What should I work on today?”                       | get\_daily\_briefing\_snapshot |
| “Show me my work queue”                              | get\_my\_execution\_queue      |
| “Who are my hot leads?”                              | get\_hot\_business\_contacts   |
| “Draft an email to John Smith about our new listing” | draft\_outreach\_email         |
| “Search for DaVita”                                  | search\_entity\_targets        |
| “How’s the pipeline looking?”                        | get\_pipeline\_intelligence    |
| “Is the sync healthy?”                               | get\_sync\_run\_health         |

**Step 7: Publish**

Once testing passes, publish the agent. You have two options:

  - Just for me — only you can use the agent in your M365 Copilot

  - Share with team — share the agent with specific people (doesn’t require admin)

After publishing, the LCC Copilot will appear in your Copilot chat, and you can invoke it by name (e.g., “@LCC Copilot what should I work on today?”) or it may be suggested automatically based on your queries.

**Quick Reference**

**API Endpoints**

|                       |                                                     |
| --------------------- | --------------------------------------------------- |
| **Endpoint**          | **Purpose**                                         |
| /api/chat             | Action gateway — POST with copilot\_action + params |
| /api/copilot-spec     | OpenAPI 3.0 spec (GET, no auth required)            |
| /api/copilot-manifest | Plugin manifest (GET, no auth required)             |

**Action Categories**

|              |                                         |            |
| ------------ | --------------------------------------- | ---------- |
| **Category** | **Description**                         | **Count**  |
| portfolio    | Pipeline, contacts, entities, briefings | 11 actions |
| outreach     | Email drafts, templates, BD pipeline    | 11 actions |
| workflow     | Triage, promote, assign, escalate       | 9 actions  |
| ops          | Sync health, work counts, system status | 4 actions  |
| domain       | Government and dialysis domain data     | 2 actions  |

**Troubleshooting**

**Agent can’t connect:** Verify the API key is correct. Test with: curl -H "X-LCC-Key: YOUR\_KEY" -H "Content-Type: application/json" -d ’{"copilot\_action":"get\_work\_counts"}’ https://life-command-center-nine.vercel.app/api/chat

**401 Unauthorized:** The X-LCC-Key header is missing or incorrect. Check Vercel env vars for LCC\_API\_KEY.

**Actions not showing:** If using OpenAPI import, try refreshing the spec. The spec URL is public and doesn’t require auth.

**Wrong action called:** The agent uses action descriptions for routing. Rephrase your request to be more specific, or call the action by name.
