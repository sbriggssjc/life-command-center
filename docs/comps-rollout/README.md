# Comps Engine — Rollout & Reference

Living docs for the unified CRE comps engine (`mcp/comps-tools.js`) and its rollout across surfaces.
Update these as the engine changes.

## Contents
- **comps-rollout-checklist.md** — every surface, what's built vs. what needs config, owners, status. Start here.
- **comps-surface-setup-guides.md** — step-by-step registration for each surface (Claude MCP, Cowork skill, ChatGPT GPT Action, Copilot Studio).
- **lcc-comps-openapi.yaml** — OpenAPI 3.0 schema for the HTTP routes (`/api/query-comps`, `/api/synthesize-comps`); import into ChatGPT + Copilot. Set `servers[0].url` to your `MCP_BASE_URL`.
- **comps-engine-SKILL.md** — the Claude Cowork skill wrapping query/synthesize/generate with the Team Briggs policies (reliable-or-exclude, MOB/MT naming, reconciliation flags, export mapping).
- **prompts/** — Claude Code prompts behind the engine build (RPC perf, reconciliation + review queue, Pearland/dedup, CMS-link/census cleanup) — for provenance and re-runs.

## No-approval team rollout (when Northmarq IT connector approval isn't available)
- **copilot-deal-agent-team-sharing-runbook.md** — give the team live LCC tools via the Copilot Deal Agent (DLP self-check first, maker-provided credentials, direct share).
- **northmarq-claude-project-setup.md** — get the Team Briggs methodology into a shared Northmarq Claude Project as knowledge + instructions (no live DB access; pair with Copilot for live pulls).

## Before rolling out
1. Rotate `LCC_API_KEY` and the government DB password (both were exposed in chat); update the env on the MCP + BOV Railway services.
2. Fill your live `MCP_BASE_URL` into the OpenAPI `servers` block and the setup guides.
3. Work the checklist per surface; verify each with the same prompt for parity.

## Engine invariants (don't let a surface diverge)
Reliable-or-exclude NOI/rent (dialysis + government); cap rates as decimals; request-aware multi-tenant naming (MOB/MT + anchor); cap/rent reconciliation flags → dialysis review queue; `buyer`/`seller`/`financing` out of comps unless explicitly requested; formula-protected workbook columns never written.
