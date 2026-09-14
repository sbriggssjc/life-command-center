# Prompt 27 Worklog

Date: 2026-08-03

## Objective

Fix appraisal-scale comp workbook generation so curated rows do not round-trip through ChatGPT/Copilot. A
workbook request should pass request text to the server, synthesize rows server-side, build the Team Briggs
workbook, and return only a download link plus compact counts/summary.

## Plan

1. Add a server-side one-shot comps workbook helper in `mcp/comps-tools.js`.
2. Wire `generate_comps` and HTTP `/api/comps` in `mcp/server.js` to accept `request`.
3. Preserve compact `template_comps` under the HTTP bounded-output guard.
4. Update comps canon and re-render surface canon files.
5. Add focused regression tests for the one-shot workbook path and bounded `template_comps` preservation.

## Notes

- Root `server.js` mounts `mountLccMcp(app)` before the legacy `/api/comps` proxy, so adding `/api/comps` to the
  MCP mount makes ChatGPT/Copilot hit the one-shot route first on the unified host.
- Legacy row-driven `generate_comps` remains available for small pulls and hand-curated rows.
- Added `runGenerateCompsFromRequest()` in `mcp/comps-tools.js`: request text -> `runSynthesize()` ->
  sales workbook rows -> BOV generator callback -> compact link/count response. It intentionally omits
  `comps` and `template_comps` from the caller response.
- Added MCP/HTTP `/api/comps` request mode in `mcp/server.js`; row-driven mode still proxies to
  `/generate-comps`.
- Updated `mcp/http-response-bound.js` so oversized two-step comp responses preserve all `template_comps` and
  reduce/drop full-detail `comps` first.
- Bumped canon to v1.2.1 and re-rendered the surface canon bundles plus the managed Copilot instruction region.
- Updated ChatGPT/Copilot OpenAPI and packaged Copilot agent artifacts to expose request-in/link-out workbook
  generation.

## Verification

- `node --check mcp\comps-tools.js`
- `node --check mcp\server.js`
- `node --test test\comps-bounded-output.test.mjs`
- JSON parse check for Copilot package/replacement artifacts.
