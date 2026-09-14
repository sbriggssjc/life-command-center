# Prompt 21 Worklog - Copilot Studio MCP Pivot

## Objective

Verify whether the LCC Deal Agent can connect directly to the LCC MCP server from Copilot Studio, using Microsoft
Copilot Studio's streamable HTTP MCP tool path, and document the readiness status in
`docs/comps-rollout/mcp-copilot-readiness.md`.

## Context Read

- Read `CLAUDE.md` and `.github/AI_INSTRUCTIONS.md`.
- Confirmed production app routing is owned by root `server.js`.
- Read `docs/comps-rollout/ms-surface-triage-and-mcp-pivot.md`.
- Read `mcp/server.js`, `mcp/comps-tools.js`, `mcp/http-response-bound.js`, and bounded-output tests.

## Verification Notes

- Local `mcp/server.js` implements a standalone MCP JSON-RPC service with `POST /mcp`, `DELETE /mcp`,
  `tools/list`, `tools/call`, Bearer auth, and OAuth discovery endpoints.
- Local `mcp/server.js` initializes with MCP protocol version `2024-11-05`, not `2025-03-26`.
- The exact live URL from the prompt, `https://tranquil-delight-production-633f.up.railway.app/mcp`, is the root
  LCC Railway app. It does not mount `/mcp`.
- Live probes on 2026-08-03:
  - `GET /health` returned root app health JSON.
  - `GET /version` returned deploy version `2abda2a8ee21`.
  - `POST /mcp` returned `404 Cannot POST /mcp`.
  - OAuth discovery paths returned the SPA HTML, not OAuth metadata.

## Current Conclusion

The exact Railway URL in the prompt is not ready for Copilot Studio MCP connection. The standalone MCP app exists
in the repo and is close to streamable HTTP request/response behavior, but it is not deployed or mounted at that
URL, and its protocol version should be bumped/verified for Copilot's `mcp-streamable-1.0` path.

## Deliverables

- Added `docs/comps-rollout/mcp-copilot-readiness.md` with transport, auth, tool-list, bounded-output, fix, and
  Scott click-path notes.
