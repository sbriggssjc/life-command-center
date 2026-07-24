# Copilot Deal Agent — Team Sharing Runbook (No Admin Approval Path)

Goal: give the whole team live LCC comps + read tools through the Copilot Deal Agent, without a Northmarq IT
ticket. Sharing the agent is maker-doable; the one governed piece is the **custom connector** (Power Platform
DLP). Do the self-check first.

Fill in: `MCP_BASE_URL` (your Railway MCP domain), `LCC_API_KEY` (Bearer token).

## Step 0 — DLP self-check (decides whether this path is open)
In Copilot Studio, open your Deal Agent → **Tools** → **Add a tool** → **New tool** → **Custom connector** →
you're taken to the Power Apps portal → **New custom connector** → **Import an OpenAPI file** → upload
`docs/comps-rollout/lcc-openapi.yaml`.
- Host = your `MCP_BASE_URL` domain, Base URL `/`.
- Security = **API Key** / **HTTP Bearer** → header `Authorization`, value `Bearer {LCC_API_KEY}`.
- Save, then **Test** an operation (e.g. `queryComps`).
  - **Returns data → your DLP permits custom connectors. Proceed.**
  - **Blocked / can't create / greyed out → same wall as Claude, in Power Platform.** Your tenant runs a
    default-blocked connector posture; a Power Platform admin must unblock the custom connector (or classify its
    URL pattern as Business). Stop here and route that one item to the admin.

## Step 1 — Maker-provided credentials (so the team doesn't each need the key)
On the connector tool → **Overview** → **Details** → **Additional details** → **Credentials to use** →
select **Maker-provided credentials**. The agent must be on an **authenticated channel** (Copilot Studio →
your agent → **Settings** → **Security** → authentication) for maker credentials to apply. Now team members use
*your* LCC connection — no per-person API key, no per-person setup.

## Step 2 — Wire the agent to use the tools
In the agent instructions, tell it to prefer `synthesizeComps` for plain-language comp asks, use the read tools
(`getPropertyContext`, `searchEntities`, `getDailyBriefing`, etc.) for lookups, render the returned `markdown`
table, and surface `meta.flagged_for_review`. (These mirror the Team Briggs doctrine — reliable-or-exclude,
MOB/MT naming, reconciliation flags — which the engine already enforces server-side.)

## Step 3 — Share with the team (direct share, not app-catalog publish)
- **Agent:** Copilot Studio → your agent → **Share** → add your team members (view access is enough to use it).
  *Do NOT "publish to the org app catalog"* — that step needs admin approval; direct sharing does not.
- **Connection:** make.powerapps.com → **Connections** → the LCC connection → **Share** → add the same users →
  Permission **Can use + share**. (Required so their sessions can use your maker connection.)

## Step 4 — Deploy surface
Publish the agent to **Teams** (or a Teams channel) for the team, or keep it in Copilot Chat. Both are
member-shareable; the Teams *app store* (org-wide catalog) is the only path that needs admin.

## Step 5 — Verify parity
Each team member runs: *"Government medical-office comps in Texas, last 12 months."* Confirm reliable-or-exclude
applied, `MT (…)`/`MOB (…)` naming, cap rates as %, and a flagged-for-review count — identical to personal Claude.

## Notes
- Workbook generation (`generate_comps`) isn't in `lcc-openapi.yaml` yet — run
  `prompts/CCP_generate_comps_action_chatgpt_copilot.md` to add it, then re-import the connector.
- Data-governance: these tools send contact/CRM/comp data to Microsoft via the agent — you approved this scope
  (Option A). If any read tool should stay off Copilot, gate it with the server's `HTTP_TOOLS_ALLOWLIST`.
- Security: this uses the shared `LCC_API_KEY`. Rotating it later means updating the connector's stored Bearer value.
