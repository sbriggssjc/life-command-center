# Registry — Canonical Map & Consolidation Index

Non-destructive index so nothing is lost and every future build resumes from one place. **Nothing here is
deleted.** Each entry is *canonical* (the source of truth), *reference* (useful, stable, not the rule source),
or *historical* (kept for history; never edit/wire).

## A. Canonical sources — edit ONLY these

| Capability | Canonical source | 
|---|---|
| OS entry point / map | `docs/os/README.md` |
| Global invariants + canon version | `docs/os/canon/00-INDEX.md` |
| Topic rules | `docs/os/canon/*.md` (comps, filing, email-and-routing, logging-and-touchpoints, writing-voice, bov, intake-triage, personal) |
| Surface update procedure | `docs/os/SURFACE-SYNC-PROTOCOL.md` |
| Agent/surface architecture | `docs/os/architecture/connected-agent-architecture.md` + `connected-agent-descriptions.md` |
| Instruction enforcement (render/parity) | `docs/os/RENDER-AND-PARITY.md`, `docs/os/tools/*`, `docs/os/canon/blocks/*`, `docs/os/render.manifest.json` |
| Engine × surface parity | `docs/comps-rollout/SURFACE_CAPABILITY_PARITY.md` |
| Deal Agent component map | `docs/copilot/DEAL-AGENT-SOURCE-OF-TRUTH.md` |
| Deal Agent instructions | `docs/copilot/agent-instructions.md` |
| Engines / data | `mcp/` + `api/` |
| Knowledge (voice/frameworks/personal) | `_AI-Context/Copilot-Context/BRIGGS-*` (SharePoint) |
| Write governance | `WRITE_SURFACE_POLICY.md` |
| Infra topology | `INFRASTRUCTURE.md` |

## B. Reference (stable context; not a rule source)
- `docs/architecture/lcc_intelligent_operating_system_v2.md` — the founding OS vision (informs the canon).
- `copilot_authoritative_architecture_plan.md` — LCC-orchestrates / domains-execute pattern.
- `docs/architecture/copilot_agent_catalog.md` — the 9 logical agent roles (realized as flows unless tool-heavy).
- `docs/comps-rollout/*` setup guides, `northmarq-claude-project-setup.md`, `copilot-deal-agent-team-sharing-runbook.md`.
- `docs/architecture/context_broker_api_spec.md`, `context_packet_schema.md`, `signal_table_schema.sql` — Cortex substrate.

## C. Historical (kept, never edit/wire) — examples
Per `DEAL-AGENT-SOURCE-OF-TRUTH.md`: `declarative-copilot-updated.json`, `ai-plugin.json`, connector v1 swagger,
`copilot/actions/*.yaml`, `docs/setup/*` redirect stubs, any `DealAgent_Instructions.md` from a chat.
General rule: superseded plans/round-logs stay in place as history; if one still claims a live rule, replace its
body with a one-line redirect to the canonical source in §A (the stub pattern).

## D. How to consolidate safely (ongoing, non-destructive)
1. When you find two files asserting the same rule → keep the §A canonical one; turn the other into a redirect
   stub pointing here. Do **not** delete.
2. When you create something new → add it to §A/§B and to `canon/00-INDEX.md` + `SURFACE-SYNC-PROTOCOL.md`.
3. Never let a rule live in two editable places. One source, many renderers.

## E. Open follow-ups (tracked, not yet done)
- ✅ Relocated `connected-agent-*.md` into `docs/os/architecture/`; redirect stubs left in `docs/comps-rollout/`.
- Migrate the live `agent-instructions.md` + ChatGPT persona to CANON markers so `render --write-live` drives
  them (bootstrap in `RENDER-AND-PARITY.md`).
- Rotate `LCC_API_KEY` (parity checklist P1); move to per-surface keys.
- Build the single instruction/policy canon renderers so each surface imports rather than copies (this folder
  is step 1; the renderers/parity test are step 2).
