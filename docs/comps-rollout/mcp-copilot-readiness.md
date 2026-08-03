# MCP Copilot Readiness - Prompt 21

Date: 2026-08-03

## Readiness Verdict

**Not ready at the exact URL Scott planned to use.**

`https://tranquil-delight-production-633f.up.railway.app/mcp` is currently the root LCC Railway Express app, not
the standalone MCP server. Live probes on 2026-08-03 showed:

- `GET /health` returns the root app health JSON.
- `GET /version` returns deploy `2abda2a8ee21` from `railway_git_commit_sha`.
- `POST /mcp` returns `404 Cannot POST /mcp`.
- `GET /.well-known/oauth-protected-resource` and `GET /.well-known/oauth-authorization-server` return the SPA
  HTML, not OAuth metadata.

Do **not** paste that URL into Copilot Studio's MCP tool setup until `/mcp` is mounted there or a separate MCP
Railway service URL is confirmed.

## Transport

### Code status

`mcp/server.js` implements a standalone MCP HTTP JSON-RPC service:

- `POST /mcp` handles `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, and `ping`.
- `DELETE /mcp` exists for session cleanup.
- `GET /mcp` intentionally returns 405 because the current tools do not need server-push.
- Responses are JSON request/response bodies, not the older two-endpoint HTTP+SSE pattern.

This is close to the streamable HTTP request/response shape Copilot Studio expects, but the local implementation
still advertises MCP `protocolVersion: 2024-11-05` on `initialize`. Before using Copilot Studio's
`x-ms-agentic-protocol: mcp-streamable-1.0` custom-connector path, update/verify it against MCP `2025-03-26+`
and test a client request that sends the streamable MCP headers.

### Deployed status

The prompt URL does **not** expose the MCP transport. The smallest production fix is one of:

1. Deploy `mcp/` as its own Railway service and use that service URL plus `/mcp`.
2. Mount the standalone MCP routes/OAuth discovery in the root Railway app, taking care not to duplicate root
   `server.js` routing or bypass existing auth/deploy gates.

The cleaner path is option 1 because `mcp/README.md` already treats MCP as a separate deployable service.

## Auth

### Code status

`mcp/server.js` accepts:

- `Authorization: Bearer <LCC_API_KEY>` on `/mcp`.
- OAuth discovery and authorization endpoints:
  - `/.well-known/oauth-protected-resource`
  - `/.well-known/oauth-authorization-server`
  - `/register`
  - `/authorize`
  - `/oauth/token`

The OAuth flow ultimately issues the same `LCC_API_KEY` as the bearer access token.

### Deployed status

OAuth discovery is **not live** on `https://tranquil-delight-production-633f.up.railway.app`; those paths fall
through to the SPA. Copilot Studio should use Bearer auth only after the actual MCP service URL is confirmed. If
OAuth onboarding works on the real MCP service, use OAuth; otherwise create/use the MCP custom connector with
`x-ms-agentic-protocol: mcp-streamable-1.0` and `Authorization: Bearer <LCC_API_KEY>`.

## Tool List

Because the live prompt URL returns 404 for `POST /mcp`, the deployed tool list cannot be confirmed there. The
local standalone MCP server would advertise these tools via `tools/list`:

| Tool | Short description |
|---|---|
| `get_daily_briefing` | Today's strategic, important, and urgent priorities. |
| `search_entities` | Search LCC properties, contacts, and organizations. |
| `get_property_context` | Property lease, ownership, comps, score, research, contacts, tenants, and guarantors. |
| `get_offer_context` | Context package for an inbound offer on a listing. |
| `log_offer` | Log an inbound offer and enqueue follow-up/Salesforce work. |
| `get_contact_context` | Contact relationship context, activity, deals, and recommendations. |
| `get_queue_summary` | Current research/action queue in priority order. |
| `get_pipeline_health` | Pipeline run status, success rates, and failures. |
| `recall_memory` | Recall shared Cortex memory. |
| `log_memory` | Write a durable Cortex memory entry. |
| `generate_bov` | Generate a Briggs CRE BOV workbook download link. |
| `generate_comps` | Generate a Briggs CRE comps workbook download link. |
| `query_comps` | Pull normalized sales comps across dialysis, government, and Salesforce-staged sources. |
| `synthesize_comps` | Parse a plain-language comp request and return a ranked comp set. |
| `list_comp_reviews` | List flagged sold comps awaiting human review. |
| `resolve_comp_review` | Resolve or dismiss a flagged comp review. |
| `get_deal_dossier` | Read a deal/entity dossier and activity timeline. |
| `list_deal_checkpoints` | List deal milestones and due/overdue checkpoints. |
| `update_deal_dossier` | Append a touchpoint or milestone to the deal timeline. |

## Bounded Outputs

Bounded outputs are mandatory for Copilot Studio because over-large tool results can trigger
`TooMuchDataToHandle`.

Current code review:

- `query_comps` is capped by the MCP handler at default 40, max 100 rows.
- `synthesize_comps` is capped by the MCP handler at default 25, max 50 rows.
- `search_entities` defaults to 10 and caps at 50.
- `get_queue_summary` defaults to 25 and caps at 100, even though it over-fetches up to 1000 internally.
- `recall_memory` defaults to 20 and caps at 50.
- `get_contact_context`, `get_daily_briefing`, `get_pipeline_health`, `get_deal_dossier`, and
  `list_deal_checkpoints` use bounded source queries.
- `generate_comps` and `generate_bov` return metadata plus a download link, not workbook bytes.

Caveat: `mcp/http-response-bound.js` applies the 45k-character hard guard to the REST `/api/*` HTTP mirror
routes, not to `/mcp` tool calls. The specific old 1.1M-character comps dump should not recur because the comps
MCP handlers now cap row counts and strip raw comp payloads, but a true Copilot `/mcp` pilot should still include
a size smoke test for `get_property_context` and `get_daily_briefing`.

## Required Change Before Pivot

Minimum:

1. Deploy the standalone `mcp/` service to Railway, or mount equivalent `/mcp` and OAuth routes in the root app.
2. Update/verify `initialize` for MCP `2025-03-26+` streamable HTTP compatibility. The current local response
   says `protocolVersion: 2024-11-05`.
3. Probe the real MCP service with:
   - unauthenticated `POST /mcp` -> 401
   - Bearer-authenticated `initialize` -> 200 JSON
   - Bearer-authenticated `tools/list` -> the table above
   - Bearer-authenticated `tools/call` for `synthesize_comps` using "DaVita, The Villages, FL comps" -> bounded
     JSON result
4. If using a Power Apps custom connector, set `x-ms-agentic-protocol: mcp-streamable-1.0` and Bearer
   `LCC_API_KEY`.

## Scott Copilot Studio Steps After Readiness Is Green

1. Open the LCC Deal Agent in Copilot Studio.
2. Go to **Settings -> Orchestration** and turn **Generative** orchestration on.
3. Go to **Build -> Tools -> Add a tool -> Add -> Model Context Protocol**.
4. Enter the confirmed MCP server URL, ending in `/mcp`.
5. Configure auth:
   - Prefer OAuth if the real MCP service discovery succeeds.
   - Otherwise use the MCP custom connector path with `x-ms-agentic-protocol: mcp-streamable-1.0` and
     `Authorization: Bearer <LCC_API_KEY>`.
6. Review the discovered tool list.
7. Save.
8. Publish.
9. Publish the agent to the **Teams & Microsoft 365 Copilot** channel.
10. Test in Preview: "Pull DaVita comps in The Villages, FL and export the workbook."

## Copilot Studio Notes

- If Copilot Studio shows `"Expected 'dialogId' to be defined"` in the classic action/canvas path, save and
  publish the agent, refresh/reopen it, and confirm Generative Orchestration is on. The MCP tool path avoids
  hand-wiring each operation and should sidestep this per-action authoring issue.
- Tenant DLP can block custom connector creation. If that happens, create the MCP custom connector in a
  Dev/Sandbox Power Platform environment per Microsoft troubleshooting guidance.
- Prompt 20 still ships for ChatGPT because ChatGPT still needs the OpenAPI schema. This MCP pivot removes the
  OpenAPI/Swagger dependency only for Microsoft surfaces after the MCP endpoint is live.
