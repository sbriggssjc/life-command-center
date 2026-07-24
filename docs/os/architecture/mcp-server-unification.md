# MCP Server Unification — one URL for every surface

> **Status: OPEN decision — recommended: UNIFY.** Canonical here (repo). A copy also lives at
> `Team Briggs – Documents/_WORKFLOW/ARCHITECTURE_HANDOFF_MCP_SERVER_UNIFICATION.md` (SharePoint). Findings
> verified live against production 2026-07-24.

## Why this is an OS-level issue
The consistency contract says single-source every capability. Today there are **two deployments** from the
`life-command-center` repo and the docs treat them as one — that is drift at the *infrastructure* layer, and
it's why the ChatGPT GPT threw `ResponseTooLargeError` even after the fixes were "merged and redeployed": the
fixes landed on a server ChatGPT never calls.

## The two-server reality (verified 2026-07-24)
| | `tranquil-delight` (`tranquil-delight-production-633f.up.railway.app`) | The MCP service (separate Railway domain, undocumented) |
|---|---|---|
| Runs | repo-root `server.js` (web app) | `mcp/server.js` (own Dockerfile/package.json) |
| `/health` | `{status:"ok",ts}` | rich shape `{status,server,version,tools,http_read_routes}` |
| `/mcp` | **404** (no endpoint) | **live** — what the working Claude connector uses |
| `/api/daily-briefing` | 200 but **107 KB, unbounded, no auth** (admin.js `edge-brief` snapshot) | bounded <45 KB (`boundHttpToolResult`+`shapeDailyBriefing`, reads `briefing_intel_snapshot`) |
| `/api/query-comps`, `/synthesize-comps` | live | live |
| `/api/search-entities`, `/property-context`, `/contact-context`, `/queue-summary`, `/pipeline-health`, `/recall-memory` | **404** | live (Option A `makeReadHttpRoute`, all bounded) |
| `/bov`, `/comps` hand-off pages | live | n/a |

**Root cause (one sentence):** `docs/comps-rollout/lcc-openapi.yaml` sets `servers[0].url` to `tranquil-delight`,
which serves only 3 of 9 ops and an unbounded 107 KB briefing — so 6 ops 404 and the briefing blows ChatGPT's
~100 KB cap.

## Decision: UNIFY onto `tranquil-delight` (one server, one URL)
End-state: `tranquil-delight` serves the web app **plus** `/mcp` **plus** the 9 bounded `/api/*` read/comps
routes — a single base URL backing Claude (`/mcp`), ChatGPT Actions, and the Copilot connector (`/api/*`). This
matches original intent and makes the docs true. The "repoint ChatGPT to the hidden MCP domain" move is a
**throwaway stopgap only** (unification deletes that second URL anyway).

### Work to close it
1. **Mount the MCP surface onto the root app.** Refactor `mcp/server.js` route wiring to be exportable
   (`mountLccMcp(app)` / Express Router): `/mcp` JSON-RPC + OAuth discovery, `READ_HTTP_ROUTES`
   (`makeReadHttpRoute`+`boundHttpToolResult`), comps routes. Mount in root `server.js` **before** the SPA
   catch-all / `/api/*` 404 fallthrough (~lines 492–515) so they aren't shadowed.
2. **Resolve the daily-briefing collision.** Root maps `/api/daily-briefing` → `admin.js` edge-brief (107 KB).
   Pick one winner — prefer routing it to the bounded MCP handler (`get_daily_briefing` → `briefing_intel_snapshot`
   + `boundHttpToolResult`). Only one handler may own that path.
3. **Copy env vars to `tranquil-delight`:** `OPS_SUPABASE_URL/KEY`, `GOV_SUPABASE_URL/KEY`,
   `PRIMARY_WORKSPACE_ID`, `LCC_API_KEY`, `MCP_BASE_URL`/OAuth settings (today they live on the MCP service).
4. **Auth parity.** `/api/daily-briefing` is currently public on `tranquil-delight`; MCP read routes use
   `authenticate` (Bearer `LCC_API_KEY`). Put every `/api/*` read route behind `authenticate`; confirm
   ChatGPT/Copilot send the Bearer. Decide intentionally — don't leave a public briefing by accident.
5. **Point everything at one URL.** `lcc-openapi.yaml` `servers[0].url = https://tranquil-delight-production-633f.up.railway.app`;
   re-import into ChatGPT Actions + Copilot connector. Claude connector = same base + `/mcp`.
6. **Retire the second MCP service** once `tranquil-delight` serves `/mcp` (or keep as warm standby, but stop
   documenting it as a separate required URL).

### Verify after unification
`GET /health` → rich shape · `POST /mcp` initialize → 200/401 (not 404) · each of 9 `/api/*` → 200 and
serialized length <45,000, briefing `source:'briefing_intel_snapshot'` · Claude connector still returns full
payloads · ChatGPT "today's briefing" → real briefing, no `ResponseTooLargeError`.

## Repo facts (for the executing chat)
- Root app `server.js` = single source of `/api/*` routing; `/api/daily-briefing` → adminHandler
  (`_route='edge-brief', action='snapshot'`); comps → `queryCompsHandler`; SPA + `/api/*` 404 near 492–515.
- `mcp/server.js` = `/mcp` JSON-RPC; `makeReadHttpRoute` (~1403) + `READ_HTTP_ROUTES` (~1837, incl.
  `/api/daily-briefing`→`get_daily_briefing`); `boundHttpToolResult` from `mcp/http-response-bound.js`.
- `mcp/http-response-bound.js` = `MAX_HTTP_RESPONSE_CHARS=45000`, `enforceHttpResponseSize`, `shapeDailyBriefing`
  (`source==='briefing_intel_snapshot'`), `shapePropertyContext`.
- `briefing_intel_snapshot` (LCC Opps `xengecqvemvfknjvbvrq`): `workspace_id` NULL on all rows (global) — do
  not filter by it; order by `as_of_date desc, generated_at desc`.

## Docs to correct once the decision lands (tracked in ../REGISTRY.md §F)
`MULTI_AI_DEPLOYMENT_CHECKLIST.md` (~lines 225–226 assert tranquil-delight is the MCP server — the sentence
that sent the fix to the wrong service), plus `CONTEXT_ROUTER.md`, `Capability_Access_Matrix.md`,
`AI_ECOSYSTEM_GUIDE_v2.md` — all conflate the two servers.
