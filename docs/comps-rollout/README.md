# Comps Engine — Code Artifacts (operational docs live in Team Briggs `_WORKFLOW`)

**One source of truth.** The canonical *operational* docs for deploying/updating every AI surface live in
`Team Briggs - Documents/_WORKFLOW/` (OneDrive), registered in `CONTEXT_ROUTER.md`. Do not maintain a second
copy here — update the canonical docs, not this folder, when process changes:

| Topic | Canonical doc (Team Briggs `_WORKFLOW/`) |
|---|---|
| What to upload/update, where, per surface | `MULTI_AI_DEPLOYMENT_CHECKLIST.md` |
| Capability × surface status grid | `Capability_Access_Matrix.md` |
| Team methodology / prompt (comps §3C, BOV §3P) | `NORTHMARQ_PROJECT_PROMPT.md` (v1.9+) |
| The master map of where everything lives | `CONTEXT_ROUTER.md` |

## What this folder IS — the code artifacts those docs reference
These are versioned with the code and imported/installed by the surfaces per the checklist:
- **`lcc-openapi.yaml`** — the unified OpenAPI 3.0 schema (9 ops: comps `synthesize`/`query` + the 7 read tools,
  Bearer auth). Import into ChatGPT Actions + the Copilot custom connector; set `servers[0].url` to your MCP base URL.
- **`comps-engine-SKILL.md`** — the Cowork skill wrapping the comps engine with the Team Briggs policies.
- **`prompts/`** — the Claude Code prompts behind the build (RPC perf, reconciliation + review queue, Pearland/dedup,
  CMS-link/census, census-writer root cause, Option A HTTP parity, generate-comps action, salesforce_activities fix) —
  provenance + re-runs.

## Superseded (folded into the canonical docs — kept for reference only)
These were an early parallel draft; the canonical Team Briggs docs above are authoritative. Don't update these:
- `SURFACE_CAPABILITY_PARITY.md` → superseded by `Capability_Access_Matrix.md`.
- `comps-surface-setup-guides.md`, `comps-rollout-checklist.md`, `lcc-comps-openapi.yaml` (comps-only) →
  superseded by `MULTI_AI_DEPLOYMENT_CHECKLIST.md` + `lcc-openapi.yaml`.
- `copilot-deal-agent-team-sharing-runbook.md`, `northmarq-claude-project-setup.md` → the no-approval steps are
  now summarized in the checklist's "July 2026 Reconciliation" section; keep these two as the detailed how-to.

## Engine invariants (unchanged, enforced server-side)
Reliable-or-exclude NOI/rent (dialysis + gov); cap rates as decimals; request-aware multi-tenant naming (MOB/MT +
anchor); cap/rent reconciliation flags → dialysis review queue; record-first BOV; `buyer`/`seller`/`financing` out
of comps unless asked; formula-protected columns never written; read tools read-only (`log_memory` never over HTTP).
