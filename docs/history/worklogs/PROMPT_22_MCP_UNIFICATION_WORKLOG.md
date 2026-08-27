# Prompt 22 MCP Unification Worklog

## Objective
Unify the MCP surface onto the root Railway app so `tranquil-delight` serves `/mcp`, OAuth discovery, rich `/health`, bounded `/api/*` read routes, and comps routes from the same implementation as the standalone MCP service. Bump MCP initialize protocol negotiation for Copilot Studio streamable HTTP.

## Constraints Read
- `CLAUDE.md`: Railway root `server.js` is production routing source; prefer mounted/sub-routes; enforce auth when `LCC_API_KEY` is set.
- `.github/AI_INSTRUCTIONS.md`: read before `/api/` changes; every route must be mounted in `server.js`.
- `docs/os/architecture/mcp-server-unification.md`: final target is one URL on `tranquil-delight`; `/api/daily-briefing` should route to bounded MCP handler.
- `docs/os/architecture/unification-changeset.md`: Phase 2 extraction pattern, but it keeps `/api/ai/*`; Prompt 22 supersedes that for `/api/daily-briefing`.

## Plan
1. Refactor `mcp/server.js` route wiring into exported `mountLccMcp(app, options)`.
2. Guard standalone `app.listen()` so imports do not start another server.
3. Mount MCP in root `server.js` before existing `/api/*` aliases and catch-alls.
4. Change `initialize` protocol response to return at least `2025-03-26`, echoing newer client requests.
5. Add/confirm bounded-output tests for `get_property_context` and `get_daily_briefing`.
6. Run focused tests and boot checks.

## Progress
- Created worklog after reading required architecture docs.
- Existing bounded shaper tests already cover `get_daily_briefing` and `get_property_context`; will add protocol/mount tests if practical.
- Refactored `mcp/server.js` to export `mountLccMcp(app)` and guard standalone `app.listen()`.
- Added `negotiateProtocolVersion()`: echoes client protocol versions `>= 2025-03-26`, otherwise returns `2025-03-26`.
- Mounted `mountLccMcp(app)` in root `server.js` before legacy `/api/*` aliases, so `/health` is rich and `/api/daily-briefing` resolves to the bounded MCP read route.
- Added root `express.urlencoded()` support so OAuth token exchange works for form-encoded clients on the unified app.
- Added focused protocol negotiation coverage in `test/http-response-bound.test.mjs`; retained bounded-output coverage for `get_daily_briefing` and `get_property_context`.

## Verification
- `node --check mcp/server.js`: passed.
- `node --check server.js`: passed.
- `node --test test\http-response-bound.test.mjs`: passed, 19 tests.
- `npm run check:boot`: passed; full server module graph imports cleanly.
- Local smoke with `LCC_API_KEY=test-key`:
  - `GET /health`: rich MCP health, `server:"lcc-mcp-server"`, 19 tools, 7 read routes.
  - `POST /mcp` initialize without bearer: 401.
  - `POST /mcp` initialize with bearer and `protocolVersion:"2025-06-18"`: 200, echoed `2025-06-18`.
  - Authenticated `GET /mcp`: 405.
  - Authenticated `tools/list`: 19 tools.
  - Unauthenticated POSTs to all 9 read/comps routes (`search-entities`, `property-context`, `contact-context`, `daily-briefing`, `queue-summary`, `pipeline-health`, `recall-memory`, `query-comps`, `synthesize-comps`): 401.
