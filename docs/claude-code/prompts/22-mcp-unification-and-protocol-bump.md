# Prompt 22 — MCP server unification (one URL) + protocol bump for Copilot Studio

## Why (this is the real unblock for the whole Microsoft/Copilot strategy)
Prompt 21's readiness probe found `POST https://tranquil-delight-production-633f.up.railway.app/mcp` returns
**404**. Root cause is already documented in `docs/os/architecture/mcp-server-unification.md`: there are **two
Railway deployments** from this repo — the root web app (`tranquil-delight`, runs repo-root `server.js`) and a
**separate, undocumented MCP service** (runs `mcp/server.js`) that is what the working Claude connector uses.
`/mcp` is live only on the hidden MCP service, not on `tranquil-delight`.

The decision in that doc is to **UNIFY onto `tranquil-delight`**: mount `/mcp` + OAuth discovery + the bounded
`/api/*` read/comps routes onto the root app, so ONE base URL backs Claude (`/mcp`), ChatGPT Actions (`/api/*`
via `lcc-openapi.yaml`), and Copilot Studio (MCP at `/mcp`). This simultaneously (a) unblocks the Copilot Studio
MCP pivot (prompt 21 Part 2), (b) fixes the long-standing "fixes land on the server ChatGPT never calls" drift,
and (c) makes the docs true. The "repoint to the hidden MCP domain" stopgap is explicitly a throwaway.

## Task — follow the existing changeset, then add the protocol bump
1. **Execute the unification** exactly as specified in `docs/os/architecture/mcp-server-unification.md`
   ("Work to close it", steps 1-6) and `docs/os/architecture/unification-changeset.md` (Phase 2, if present):
   - Make `mcp/server.js` route wiring exportable (`mountLccMcp(app)` / Express Router): `/mcp` JSON-RPC +
     OAuth discovery (`/.well-known/oauth-*`, `/register`, `/authorize`, `/oauth/token`), `READ_HTTP_ROUTES`
     (`makeReadHttpRoute` + `boundHttpToolResult`), comps routes.
   - Mount in root `server.js` **before** the SPA catch-all / `/api/*` 404 fallthrough (~lines 492-515) so
     they aren't shadowed.
   - Resolve the `/api/daily-briefing` collision — route it to the bounded MCP handler
     (`get_daily_briefing` -> `briefing_intel_snapshot` + `boundHttpToolResult`), not admin.js edge-brief.
   - Ensure env parity on `tranquil-delight`: `OPS_SUPABASE_URL/KEY`, `GOV_SUPABASE_URL/KEY`,
     `PRIMARY_WORKSPACE_ID`, `LCC_API_KEY`, `MCP_BASE_URL` + OAuth settings (Scott sets these in Railway).
   - Auth parity: put every `/api/*` read route behind `authenticate` (Bearer `LCC_API_KEY`); no public briefing.

2. **Bump the MCP protocol version for Copilot Studio streamable HTTP.** `mcp/server.js` `initialize`
   currently hard-codes `protocolVersion: '2024-11-05'` (~line 1566). Copilot Studio's MCP tool expects
   streamable HTTP (`2025-03-26`+). Change `initialize` to **echo the client's requested `protocolVersion`
   when it is >= `2025-03-26`, otherwise return `2025-03-26`** (don't break Claude's existing connector, which
   negotiates fine). Keep `POST /mcp` = JSON request/response, `GET /mcp` = 405 (no server-push needed).

3. **Bounded-output smoke test** (Copilot throws `TooMuchDataToHandle` on oversized results): add/confirm a test
   that `tools/call` for `get_property_context` and `get_daily_briefing` serialize < 45,000 chars. Comps handlers
   already cap rows (query 40/100, synthesize 25/50) per `mcp-copilot-readiness.md`.

## Verify (from mcp-server-unification.md "Verify after unification")
- `GET /health` on tranquil-delight -> rich shape `{status,server,version,tools,http_read_routes}`.
- `POST /mcp` initialize -> 200 (Bearer) / 401 (no auth), NOT 404; response `protocolVersion` >= 2025-03-26.
- `POST /mcp` `tools/list` -> the 19-tool list.
- Each of the 9 `/api/*` read/comps routes -> 200, serialized length < 45,000.
- Claude connector still returns full payloads (unchanged).
- `tools/call synthesize_comps` "DaVita, The Villages, FL comps" -> bounded JSON.

## After (Scott, no code) — then prompt 21 Part 2 goes green
1. Set the env vars above on the `tranquil-delight` Railway service; redeploy.
2. Correct the docs that assert the two servers are one (per mcp-server-unification.md "Docs to correct":
   `MULTI_AI_DEPLOYMENT_CHECKLIST.md` ~225-226, `CONTEXT_ROUTER.md`, `Capability_Access_Matrix.md`,
   `AI_ECOSYSTEM_GUIDE_v2.md`).
3. Copilot Studio: Generative Orchestration ON -> Add tool -> Model Context Protocol ->
   `https://tranquil-delight-production-633f.up.railway.app/mcp` -> Bearer `LCC_API_KEY` -> review tools ->
   Save -> Publish -> publish to Teams & M365 Copilot channel. Test: "Pull DaVita comps in The Villages, FL and
   export the workbook." (This is prompt 21 Part 2, now unblocked.)

## Note
Optional stopgap (NOT recommended, per the unification doc): point Copilot at the hidden MCP service's own
Railway domain now. It works but leaves the two-server drift in place and gets deleted by unification anyway.
