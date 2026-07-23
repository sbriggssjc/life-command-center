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
| ChatGPT | GPT Action | `{MCP_BASE_URL}/api/query-comps`, `/api/synthesize-comps` | Bearer | ✅ routes live; ⬜ schema→ done | Add action from `lcc-comps-openapi.yaml` (Guide §4) | Scott | ☐ |
| Copilot Studio | Custom connector | same HTTP routes | Bearer | ✅ routes live; ⬜ schema→ done | Import OpenAPI connector (Guide §5) | Scott | ☐ |

## Assets delivered
- `lcc-comps-openapi.yaml` — OpenAPI 3.0 schema for ChatGPT + Copilot (queryComps, synthesizeComps).
- `comps-engine-SKILL.md` — Cowork skill wrapping query/synthesize/generate with Team Briggs policy.
- `comps-surface-setup-guides.md` — step-by-step per-surface registration.
- This checklist.

## Verification per surface (after config)
Run the same prompt on each and confirm parity:
> "Government medical-office comps in Texas, last 12 months."
Expect: reliable-or-exclude applied, `MT (…)`/`MOB (…)` naming, cap rates as %, a `flagged_for_review` count,
and (Claude/Cowork) a populated workbook with LAND / ON MARKET / DOM filled and no `buyer`/`seller` columns.

## Optional follow-ups
- Add `generate_comps` (workbook export) as an action on ChatGPT/Copilot via the BOV `/generate-comps` endpoint.
- Refresh `mcp/README.md`'s tool list + AI Surface Comparison to include the three comps tools (currently omits them).
