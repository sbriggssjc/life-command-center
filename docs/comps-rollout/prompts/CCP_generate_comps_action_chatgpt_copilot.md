# Claude Code Prompt — Expose Comps Workbook Generation to ChatGPT + Copilot (parity with Claude)

## Context
`generate_comps` (build the populated Briggs sales/lease workbook) is available on the Claude surfaces two ways:
the LCC MCP tool `generate_comps`, and the BOV service route **`POST /generate-comps`** on
`https://pacific-love-production-f6b9.up.railway.app` (already in `bov-generator/claude_project_action.json`,
**X-API-Key** auth). ChatGPT and Copilot currently have **query/synthesize** comps (via `mcp/` HTTP routes,
Bearer auth) but **not** workbook generation — a parity gap. Close it.

## Two problems to fix together
1. **Auth mismatch across the two comps schemas.** The query/synthesize routes on the MCP server use
   **Bearer `LCC_API_KEY`**; the BOV `/generate-comps` route uses **X-API-Key**. A single ChatGPT/Copilot
   action can't cleanly carry two auth schemes. Pick one of:
   - (Preferred) Add a thin `POST /api/generate-comps` route on the **MCP server** (`mcp/server.js`) that
     proxies to the BOV `/generate-comps` (server-side X-API-Key), so all three comps operations share one
     host + Bearer auth. Then all of query/synthesize/generate live under `{MCP_BASE_URL}` with `LCC_API_KEY`.
   - (Alternative) Document both hosts/auth in the action config and accept two security schemes.
2. **Stale contract.** The `/generate-comps` description in `claude_project_action.json` still lists
   `property_name, st, init_price, yr_built, buyer, seller, financing, submarket` — columns that don't exist
   in the current templates (verified: real input tokens are `state`, `built`/`year_built`, `initial_price`,
   plus the government/dialysis-specific ones; aliases now accept `st`/`init_price`/`yr_built`). Update the
   description to the real contract and note `buyer`/`seller`/`financing` are opt-in only (Team Briggs policy).

## Implement
1. Add the `/api/generate-comps` proxy route (Preferred above) on the MCP server, Bearer-authed, returning the
   same `{status, filename, download_url, file_base64, rows_by_sheet, skipped_formula_keys, unknown_keys,
   recalc_errors}` shape.
2. Add a `generateComps` operation to `docs/comps-rollout/lcc-comps-openapi.yaml` (the schema ChatGPT + Copilot
   import) with the corrected row-key contract and the `vertical: dialysis` note (CHAIRS/PATIENTS).
3. Fix the `/generate-comps` description in `bov-generator/claude_project_action.json` to the corrected contract
   so the Northmarq Claude Project action matches.
4. Keep the reliability/reconciliation policy notes consistent with `comps-tools.js`.

## Verify / report
- ChatGPT/Copilot (or a curl against the new route with a Bearer token) generates a dialysis + a government
  workbook; `unknown_keys` empty, `recalc_errors` 0, LAND/ON MARKET/DOM populated.
- Confirm query + synthesize + generate all work under one host/auth for the non-Claude surfaces.

## Guardrails
- Don't change the BOV service's own contract beyond the description; the proxy is additive. Read-only for the
  DBs. Reversible. Update `docs/comps-rollout/comps-rollout-checklist.md` to mark generate_comps ✅ on all surfaces.
