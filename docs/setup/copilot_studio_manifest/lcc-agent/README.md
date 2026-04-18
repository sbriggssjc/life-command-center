# LCC Assistant — Declarative Agent for Microsoft 365 Copilot

## Prerequisites

1. **Microsoft 365 Copilot license** on your account
2. **VS Code** with the **Microsoft 365 Agents Toolkit** extension installed
   - Install from VS Code Marketplace: search "Microsoft 365 Agents Toolkit" (formerly Teams Toolkit)
   - Or install via CLI: `code --install-extension TeamsDevApp.ms-teams-vscode-extension`
3. **Node.js 18+** (required by the Toolkit)

## Quick Start (3 steps)

### Step 1: Open project in VS Code

Open this `lcc-agent/` folder in VS Code:

```
code /path/to/life-command-center/docs/setup/copilot_studio_manifest/lcc-agent
```

### Step 2: Sign in to Microsoft 365

In VS Code, open the **Microsoft 365 Agents Toolkit** sidebar (shield icon) and sign in with your M365 account under the **Accounts** section.

### Step 3: Provision

In the Agents Toolkit sidebar, under **Lifecycle**, click **Provision**.

This will:
- Register a Microsoft Entra app ID automatically
- Package the manifest with the generated app ID
- Validate and upload the app to your Teams tenant
- Make the agent available in Microsoft 365 Copilot

## Testing the Agent

1. Go to https://m365.cloud.microsoft/chat
2. Click the conversation drawer icon next to **New Chat**
3. Select **LCC Assistant**
4. Try: "What should I focus on today?"

## What This Agent Does

The LCC Assistant connects to the Life Command Center API at:
`https://life-command-center-nine.vercel.app/api/copilot-spec`

It provides 43 operations including:
- Daily briefings and priority triage
- Property and contact context lookups
- Pipeline health monitoring
- Research queue management
- Prospecting briefs and outreach drafts

## File Structure

```
lcc-agent/
  teamsapp.yml              # Toolkit lifecycle config
  env/.env.dev              # Environment variables (auto-populated on provision)
  appPackage/
    manifest.json           # Teams app manifest (v1.19)
    declarativeAgent.json   # Agent instructions + conversation starters
    ai-plugin.json          # Plugin manifest pointing to OpenAPI spec
    color.png               # 192x192 app icon
    outline.png             # 32x32 outline icon
```

## Troubleshooting

**"copilotAgents not recognized"** — This happens when uploading the ZIP manually. Use the Agents Toolkit instead; manual ZIP upload doesn't support declarative agents.

**"Copilot not available"** — Ensure your M365 tenant has Copilot licenses and your account is assigned one.

**Agent not appearing in Copilot** — After provisioning, it may take a few minutes. Try refreshing m365.cloud.microsoft/chat.
