# Multi-Surface Rollout — one comps engine, three AI surfaces

Goal: Claude (Northmarq team), Copilot Studio, and ChatGPT all expose the same comps
capability and return identical data + output, for any team member on their own machine.

## The architecture (hub & spokes)

```
                         ┌─────────────────────────────────────────┐
                         │   Railway MCP app  (the ENGINE)          │
                         │   comps-tools.js → runComps()            │
                         │     • query rpc_query_comps (gov + dia)  │
                         │     • cross-source dedup + normalize     │
                         │     • formatCompsMarkdown() (one table)  │
                         │                                           │
                         │   Surfaces (thin):                        │
                         │     • MCP tool  query_comps  (Claude)     │
                         │     • POST /api/query-comps  (REST)       │
                         └───────┬───────────────┬───────────────┬──┘
                                 │               │               │
                           MCP connector   Custom connector   GPT Action
                                 │               │               │
                             ┌───▼───┐       ┌───▼────┐      ┌───▼────┐
                             │ Claude │       │Copilot │      │ChatGPT │
                             │ (team) │       │ Studio │      │ custom │
                             └────────┘       └────────┘      └────────┘
```

Because every surface ultimately calls `runComps()` on the Railway app, they cannot
diverge. Dedup, normalization, and the table format live in ONE place. Add a source or
change scoring once → all three update on the next redeploy.

## What changed on the server (this session)

`mcp/comps-tools.js` refactored so the query/dedup/format logic is a shared core
(`runComps`, `runSynthesize`, `formatCompsMarkdown`) consumed by two exports:
- `makeCompsTools(...)` → the MCP tools (Claude) — unchanged behavior.
- `makeCompsHttpRoutes(...)` → Express handlers for the REST surface.

`mcp/server.js` now also registers (behind the existing `authenticate` bearer middleware):
- `POST /api/query-comps`
- `POST /api/synthesize-comps`

Both return `{ comps, meta, markdown }`. **Requires a Railway redeploy** (commit + push, like last time).

## Auth (v1 and upgrade path)

- v1: bearer `LCC_API_KEY` — the same token the MCP server already uses. Every surface sends
  `Authorization: Bearer <LCC_API_KEY>`. The service key for Supabase stays server-side; the
  surfaces never see it.
- Upgrade path for team-wide use with per-user audit: issue per-user API keys (a small keys
  table + middleware check) or move to OAuth (the server already has the OAuth scaffolding used
  by Claude.ai). Not required to ship; do it when you want per-user attribution.

---

## Surface 1 — Claude (Northmarq team)

The MCP server is a standalone bearer-authenticated service, so team rollout is configuration,
not build:
1. Get the MCP server URL (the Railway domain that serves `/mcp`) and the `LCC_API_KEY`.
2. In the shared **Claude "Northmarq" project / org connectors**, add a connector:
   - URL: `https://<mcp-domain>/mcp`
   - Auth: Header → `Authorization: Bearer <LCC_API_KEY>`
3. Every team member using that project gets `query_comps` + `synthesize_comps` on their own
   machine. (This is exactly how your personal connector already works — just at the shared
   project/org scope instead of one account.)

No code change; the tools are already live once the server is redeployed.

---

## Surface 2 — Copilot Studio (LCC Deal Agent)

1. **Create a custom connector** from the OpenAPI file `openapi_comps.yaml`:
   - Power Platform → Custom connectors → **New → Import an OpenAPI file** → upload
     `openapi_comps.yaml`. (Newer Copilot Studio also supports "Add action → from REST/OpenAPI"
     directly; either lands the same two operations.)
   - Set the **host** to your MCP Railway domain (replace the `servers:` placeholder in the yaml first).
   - Security: **API Key / Bearer** → parameter name `Authorization`, prefix `Bearer`, value = `LCC_API_KEY`.
     (If the importer only offers "API Key" header auth, set header `Authorization` with value `Bearer <key>`.)
2. **Add the action to the LCC Deal Agent:** in Copilot Studio → your agent → **Actions → Add an
   action → Connector →** the connector's `queryComps` (and `synthesizeComps`) operations.
3. **Wire the topic/prompt** so the agent maps the user's request to the inputs (property_types,
   states, date window, government_only) and, in its response, **renders the `markdown` field
   verbatim** — that's what guarantees the table matches Claude's. Tell the agent NOT to
   re-summarize from SharePoint; the connector is the source of truth for comps.
4. Test: "government medical sales in Oklahoma, last 12 months" → should return the same VA comps
   Claude returned (Muskogee $1.45M, Yukon $1.538M, Norman $2.1M).

> Note: the false-negative you saw earlier was the agent using its own SharePoint/entity search.
> Once this action exists and the topic routes comp questions to it, that path is replaced by the
> shared engine.

---

## Surface 3 — ChatGPT (custom GPT)

1. Create a **custom GPT** (or an Assistants API assistant) → **Configure → Actions → Create new action**.
2. **Import** the same `openapi_comps.yaml` (ChatGPT Actions require OpenAPI 3.0+, which this is).
   Set the `servers` URL to your MCP domain.
3. Auth: **API Key → Bearer** → value = `LCC_API_KEY`.
4. In the GPT's instructions: "For comp requests, call `queryComps`/`synthesizeComps` and present
   the `markdown` field as the answer. Do not fabricate comps."
5. Same test query → same output.

---

## One spec, both connectors

`openapi_comps.yaml` is the single contract for Copilot **and** ChatGPT. Keep it in the repo next
to the server; if the endpoint ever changes, update the yaml once and re-import in both. Power
Platform historically prefers Swagger 2.0 — if its importer rejects 3.0, run the yaml through any
OpenAPI 3.0→2.0 converter (or the Power Platform "paste 3.0" path) and keep both alongside each other.

## Rollout order

1. Redeploy the Railway app (commit + push) so `/api/query-comps` is live.
2. Smoke-test the endpoint with curl:
   `curl -s -X POST https://<mcp-domain>/api/query-comps -H "Authorization: Bearer <LCC_API_KEY>" -H "Content-Type: application/json" -d '{"property_types":["medical"],"states":["OK"],"government_only":true,"date_from":"2025-07-21"}'`
   → expect JSON with the VA comps + a `markdown` table.
3. Add the Claude team connector (config only).
4. Build the Copilot Studio custom connector + action.
5. Build the ChatGPT action (mostly free — same spec).
