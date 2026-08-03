# Connector packages — what to upload where (2026-08-02 update)

Delta walkthrough for the prompt-11 comps update. Full canonical procedure is
`Team Briggs - Documents/_WORKFLOW/MULTI_AI_DEPLOYMENT_CHECKLIST.md`; this covers **what changed and exactly
where to re-upload it** to fix the Copilot "LCC Deal Agent" `ConnectorOperationNotFound` and give every surface
the comps ops.

## 0. Two constants (fill these everywhere)
- **MCP base URL** = `https://tranquil-delight-production-633f.up.railway.app` (confirmed live).
- **LCC_API_KEY** = the Bearer token. Rotate it first — it was exposed in chat (checklist P1). Set the new value
  in Railway (MCP + BOV services) env, then use that new value in every connector below.

## 1. The files that changed (now on `main`)
| File (in repo) | Feeds | What's new |
|---|---|---|
| `docs/comps-rollout/lcc-openapi.yaml` | ChatGPT Action + Copilot custom connector (OpenAPI 3.0) | adds `queryComps` / `synthesizeComps` (+ `generateComps`) to the 7 read ops |
| `copilot/lcc-deal-intelligence.connector.v4.swagger.json` | Power Platform custom connector (Swagger 2.0) | v4 — the comps ops registered; use if Power Platform wants Swagger 2.0 |
| `docs/setup/copilot_studio_manifest/lcc-agent/appPackage/` (+ `LCC-Assistant.zip`) | Copilot Studio / Teams agent package | refreshed `openapi.json` / `declarativeAgent.json` / `ai-plugin.json` |
| `docs/architecture/copilot_action_registry.json` | the registry the agent reads for action discovery | comps actions registered (the fix for `ConnectorOperationNotFound`) |

## 2. Microsoft Copilot Studio — the "LCC Deal Agent" (fixes the comps error) <- do this first
1. Power Platform (make.powerapps.com or Copilot Studio) → Custom connectors → open your existing LCC connector → Edit.
2. Definition → Import → upload updated `copilot/lcc-deal-intelligence.connector.v4.swagger.json` (Swagger 2.0).
   If it prefers OpenAPI 3.0, import `docs/comps-rollout/lcc-openapi.yaml` instead.
3. General: Host = `tranquil-delight-production-633f.up.railway.app`; Base URL = `/`.
4. Security: API Key / HTTP → Bearer → header `Authorization`, value `Bearer <LCC_API_KEY>` (rotated key).
5. Update connector. Confirm `queryComps` / `synthesizeComps` (and the 7 read ops) now appear.
6. In the LCC Deal Agent (Copilot Studio → agent → Tools/Actions) add/refresh the connector's comps actions. If
   package-based, re-upload refreshed `LCC-Assistant.zip` (Teams admin → Manage apps, or Copilot Studio publish).
7. Test: "Pull DaVita dialysis comps in The Villages, FL." (no `ConnectorOperationNotFound`, no web fallback).

## 3. ChatGPT — the custom GPT
1. ChatGPT → GPT → Edit → Configure → Actions → open the LCC action.
2. Schema: replace with `docs/comps-rollout/lcc-openapi.yaml`; set `servers[0].url` =
   `https://tranquil-delight-production-633f.up.railway.app`.
3. Authentication: API Key → Bearer → `<LCC_API_KEY>`. Save. Test: "Government MOB comps in Texas, last 12 months."

## 4. Northmarq Claude Project (team) — no connector (by design)
Managed Northmarq Claude can't add the MCP connector without an admin, so the team Project composes payloads and
hands off to the LCC `/comps` and `/bov` pages. Nothing to re-upload for the comps change. Live DB comps for the
team come through the Copilot Deal Agent (§2). If an admin later adds the connector: Claude → Settings →
Connectors → Add custom connector → `https://tranquil-delight-production-633f.up.railway.app/mcp` → Bearer.

## 5. Personal Claude — MCP connector
Claude → Settings → Connectors → Add custom connector →
`https://tranquil-delight-production-633f.up.railway.app/mcp` → Bearer `<LCC_API_KEY>`.

## 6. Cowork — skill (already available)
The `comps-engine` skill drives query/synthesize/generate with Team Briggs policy. No upload needed.

---
## Priority
For the failure you hit (Copilot LCC Deal Agent → `ConnectorOperationNotFound`): §2 is the fix — re-import the v4
connector + rotated key, then add/refresh the comps actions. §3 (ChatGPT) is the same schema-replace.
