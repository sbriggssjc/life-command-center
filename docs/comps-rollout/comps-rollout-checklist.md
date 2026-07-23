# Comps Engine — Multi-Surface Rollout Checklist

**Engine status: built, live, and verified.** One shared core (`mcp/comps-tools.js`) — reliable-or-exclude gate,
request-aware multi-tenant naming, cap/rent reconciliation + review queue, fast RPCs (~50–60 ms), export mapping.
Rollout below is per-surface registration only; no engine work remains.

## Prerequisites (do first)
| # | Item | Owner | Status |
|---|---|---|---|
| P1 | Rotate `LCC_API_KEY` (exposed in chat) + update env on the MCP + BOV Railway services | Scott | ☐ |
| P2 | Rotate the government DB password (exposed in chat) | Scott | ☐ |
| P3 | Confirm the live `MCP_BASE_URL` (MCP server Railway domain) to fill into schema + guides | Scott | ☐ |

## Surfaces
| Surface | Mechanism | Endpoint | Auth | Built? | Config step | Owner | Status |
|---|---|---|---|---|---|---|---|
| Northmarq Claude | MCP connector | `{MCP_BASE_URL}/mcp` | Bearer / OAuth | ✅ server live | Add custom connector (Guide §1) | Scott / org owner | ☐ |
| Personal Claude | MCP connector | `{MCP_BASE_URL}/mcp` | Bearer / OAuth | ✅ | Add custom connector (Guide §2) | Scott | ☐ |
| Claude Cowork | Skill | (MCP tools) | — | ✅ tools; skill authored | Save `comps-engine` skill (Guide §3) | Scott | ☐ |
| ChatGPT | GPT Action | `{MCP_BASE_URL}/api/*` (7 read routes + query/synthesize-comps) | Bearer | ✅ routes live + schema done | Add action from `lcc-openapi.yaml` (Guide §4) | Scott | ☐ |
| Copilot Studio | Custom connector | same HTTP routes | Bearer | ✅ routes live + schema done | Import `lcc-openapi.yaml` connector (Guide §5) | Scott | ☐ |

**Option A (full read parity) — DONE (2026-07).** The 6 context/ops tools + `recall_memory` now have
Bearer-authed HTTP routes on `mcp/server.js`, each reusing the same MCP handler (verified byte-identical
`/mcp` vs `/api` JSON). ChatGPT + Copilot reach full read parity by importing the unified `lcc-openapi.yaml`.
- **Read-only:** the new routes never mutate data; the WRITE tool `log_memory` is intentionally NOT on HTTP.
- **Security:** the single Bearer key's read scope is now broader (comps → all context/CRM/pipeline), so
  **P1 (rotate `LCC_API_KEY`) is higher priority**, and **per-surface API keys are a recommended follow-up**
  (distinct token per connector, so one leak is scoped/revocable) — not built in this pass.
- **Data governance (by design, Scott approved):** these routes let ChatGPT (OpenAI) + Copilot (Microsoft)
  receive contact/CRM/pipeline data. If a specific tool must stay Claude-only for PII, narrow the
  `READ_ONLY_HTTP_TOOLS` allowlist in `server.js` (one line).

## Assets delivered
- `lcc-openapi.yaml` — **the single** OpenAPI 3.0 schema (7 read ops + queryComps + synthesizeComps; one
  server, one bearerAuth). Supersedes `lcc-comps-openapi.yaml` (comps-only, retained for back-compat).
- `comps-engine-SKILL.md` — Cowork skill wrapping query/synthesize/generate with Team Briggs policy.
- `comps-surface-setup-guides.md` — step-by-step per-surface registration.
- This checklist.

## Verification per surface (after config)
Run the same prompt on each and confirm parity:
> "Government medical-office comps in Texas, last 12 months."
Expect: reliable-or-exclude applied, `MT (…)`/`MOB (…)` naming, cap rates as %, a `flagged_for_review` count,
and (Claude/Cowork) a populated workbook with LAND / ON MARKET / DOM filled and no `buyer`/`seller` columns.

## Optional follow-ups
- Add `generate_comps` / `generate_bov` (workbook export) as actions on ChatGPT/Copilot — the companion prompt
  `CCP_generate_comps_action_chatgpt_copilot.md` appends `generateComps`/`generateBov` into `lcc-openapi.yaml`
  under the same server + Bearer.
- ✅ `mcp/README.md` refreshed this pass (all 12 tools + the `/api/*` read routes in Endpoints).
- Per-surface API keys (distinct token per connector) to scope/rotate independently — recommended after P1.
