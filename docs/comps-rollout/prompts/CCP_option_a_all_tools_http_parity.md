# Claude Code Prompt — Option A: Expose All Read Tools over HTTP for Full Surface Parity (LCC MCP server)

## Objective
Give ChatGPT + Copilot (and any HTTP caller) the SAME tools Claude gets via MCP, so logging into any surface
means the same context + capabilities. Today only `query_comps`/`synthesize_comps` have HTTP routes; the other
read tools are MCP-only. Add HTTP routes for the read tools and extend the OpenAPI schema, reusing the SAME
underlying handlers (no logic fork).

## Scope (read-only tools → HTTP)
Expose: `search_entities`, `get_property_context`, `get_contact_context`, `get_daily_briefing`,
`get_queue_summary`, `get_pipeline_health`, `recall_memory`. Already exposed: `query_comps`,
`synthesize_comps`. Workbook generation (`generate_comps`, `generate_bov`) is handled in the companion prompt
(`CCP_generate_comps_action_chatgpt_copilot.md`) — coordinate so all end up under one host/auth.

**Exclude `log_memory` from HTTP** (it's the only WRITE tool). Keep memory-write on the Claude/MCP surfaces
only, unless a follow-up decision says otherwise.

## Implement
1. **Refactor for one implementation.** For each tool above, ensure the request handler is a plain function
   (args → result) that BOTH the MCP tool wrapper and a new HTTP route call — mirror how `comps-tools.js`
   exposes `makeCompsTools` (MCP) + `makeCompsHttpRoutes` (HTTP) over one `runComps`. Extract shared handlers
   in `mcp/server.js` (or a small `mcp/tools-core.js`) so MCP and HTTP can't diverge.
2. **Add Bearer-authed HTTP routes** (same `authenticate` middleware as the comps routes):
   `POST /api/search-entities`, `/api/property-context`, `/api/contact-context`, `/api/daily-briefing`,
   `/api/queue-summary`, `/api/pipeline-health`, `/api/recall-memory`. JSON body = the tool's input schema;
   JSON response = the tool's output (+ a `markdown` convenience field where the MCP tool returns one).
3. **Unified OpenAPI.** Extend `docs/comps-rollout/lcc-comps-openapi.yaml` into a comprehensive
   `docs/comps-rollout/lcc-openapi.yaml` (keep the comps file or supersede it — note which) covering every
   HTTP operation (the reads above + comps + workbook generation from the companion prompt), one server, one
   `bearerAuth`. This single schema is what ChatGPT and Copilot import to reach full parity.
4. **Docs.** Update `docs/comps-rollout/comps-rollout-checklist.md` and `SURFACE_CAPABILITY_PARITY.md` so the
   ChatGPT/Copilot columns flip ⬜→✅ for the newly-exposed tools; update `mcp/README.md` Endpoints table with
   the new `/api/*` routes; refresh the surface setup guides to point ChatGPT/Copilot at `lcc-openapi.yaml`.

## Security (build these in — see the parity doc's security notes)
- **Read-only guarantee preserved:** none of the new routes mutate data; `log_memory` intentionally excluded.
  Add a one-line assertion/comment per route that it's read-only.
- **Auth unchanged** (Bearer `LCC_API_KEY`) — but note in the PR that this widens the single key's read scope
  from comps to all context/CRM, so (a) the pending key rotation is now higher-priority, and (b) recommend a
  follow-up for **per-surface API keys** (distinct tokens per connector so one leak is scoped/ revocable). Do
  NOT implement per-surface keys in this PR unless trivial — just document the recommendation.
- **Data-governance note:** these routes let ChatGPT (OpenAI) and Copilot (Microsoft) receive contact/CRM/
  pipeline data. Add a note in the checklist that this is enabled by design (Scott approved Option A); if any
  tool should stay Claude-only for PII reasons, gate it behind an env allowlist (e.g. `HTTP_TOOLS_ALLOWLIST`).

## Verify / report
- `curl` each new route with a Bearer token → 200 + expected shape; without token → 401.
- Confirm MCP tools still return identical results (shared-handler refactor didn't change behavior) — spot-check
  `search_entities` + `get_property_context` via both /mcp and the new /api route and diff.
- Report the new route list, the unified schema path, and the checklist/matrix cells flipped to ✅.

## Guardrails
- One implementation per tool (no MCP-vs-HTTP drift). Read-only only; `log_memory` stays off HTTP.
- Additive + reversible; no change to existing /mcp or comps routes. `node --check` clean; existing tests pass.
