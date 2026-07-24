# LCC Operating System — START HERE

> **This is the home base for the whole architecture.** Any future chat (Claude, Cowork, Copilot build,
> ChatGPT) starts here — read this file, then `REGISTRY.md`, then the relevant `canon/` module. **Never
> start from scratch, never fork a source, never overwrite canon without bumping its version.**
>
> **Canon version:** see `canon/00-INDEX.md`. **Owner:** Team Briggs / Scott Briggs. **Source of truth:** this repo.

## 1. What this is

The LCC Operating System is one **brain** (LCC engines + data), one **memory** (Cortex), one **instruction &
policy canon** (this folder), and one **knowledge/context set** (BRIGGS-*). Every place you work — Copilot,
Claude Personal, Claude Cowork, Northmarq Claude, ChatGPT — is a **front door** that binds to those, so the
same request on the same topic (work **or** personal) returns a substantially identical result everywhere.

This realizes the vision in `docs/architecture/lcc_intelligent_operating_system_v2.md`: *"LCC is the brain;
Microsoft is where work gets delivered,"* data enters once and routes everywhere, every action feeds memory.

## 2. The consistency contract (the one rule)

**Single-source every capability; every surface and agent binds to it; none forks it.** The number of front
doors and agents is unconstrained — add as many as you like. What stays exactly one is the *source of truth
per capability*. The enemy is **drift** (the same topic handled differently somewhere because instructions or
engines were copied and diverged). Full statement: `architecture/connected-agent-architecture.md` §0.

## 3. The map — where every capability's source lives

| Layer | Source of truth | Notes |
|---|---|---|
| **Brain — engines/data** | `mcp/` + `api/` (this repo) | One implementation each; MCP + HTTP return identical JSON |
| **Memory — Cortex** | `log_memory`/`recall_memory`, `draft_and_log` signals, relationship/email discovery | Write-gated (log_memory Claude/MCP-only) |
| **Instruction & policy canon** | **`docs/os/canon/`** (this folder) | The rules for each topic — the thing surfaces render |
| **Knowledge / context** | `_AI-Context/Copilot-Context/BRIGGS-*` (SharePoint) + `CONTEXT_ROUTER.md` | Voice, frameworks, personal |
| **Surface bindings** | `docs/os/SURFACE-SYNC-PROTOCOL.md` | How each surface renders the canon + how to update them all |
| **Agent/surface architecture** | `docs/os/architecture/connected-agent-*.md` | Orchestrator + specialists |
| **Render & parity (enforcement)** | `docs/os/RENDER-AND-PARITY.md` + `docs/os/tools/` + `canon/blocks/` | Renders canon to surfaces; fails on drift |
| **Deployment truth (one URL)** | `docs/os/architecture/mcp-server-unification.md` + `INFRASTRUCTURE.md` | Phase 1 live — one base URL for Claude/ChatGPT/Copilot |
| **Build status** | `docs/os/BUILD-STATUS.md` | ✅/⏳/📐 for every element — the honest "are we done" |
| **Access & devices** | `docs/os/ACCESS-TOPOLOGY.md` | Devices × storage × surfaces; Cortex + personal reachability; the D-drive island |
| **Office Scripts** | `docs/os/architecture/office-scripts/` | Workbook/cell edits Work IQ can't do (>5 MB); the pro-forma escalation fix |
| **Per-capability parity** | `docs/comps-rollout/SURFACE_CAPABILITY_PARITY.md` | Engine × surface matrix |
| **Deal Agent component map** | `docs/copilot/DEAL-AGENT-SOURCE-OF-TRUTH.md` | Canonical file per Deal Agent component |
| **Everything else (historical/reference)** | `docs/os/REGISTRY.md` | Non-destructive index of all docs |

## 4. How a future chat should begin (do this, in order)

1. Read this README + `canon/00-INDEX.md` (the invariants + version).
2. Read `REGISTRY.md` to find the source of truth for the capability you're touching.
3. Open the relevant `canon/<topic>.md` — that's the single place the rule lives. **Edit there, not on a surface.**
4. If you changed a rule, bump `CANON_VERSION` and run `SURFACE-SYNC-PROTOCOL.md` to push it to every surface.
5. If you built something new, register it (§5) so the next chat finds it.

## 5. How to extend (fold in future work or personal areas seamlessly)

New topics *will* appear — new asset classes, new personal-life domains, new tools. To add one without
breaking anything:

1. **Add a canon module** `canon/<new-topic>.md` using the template in `canon/00-INDEX.md`.
2. **List it** in `canon/00-INDEX.md` and give it a home row in `REGISTRY.md`.
3. **Bind it to surfaces** via `SURFACE-SYNC-PROTOCOL.md` (which artifacts render it).
4. **Bump `CANON_VERSION`.** Done — every surface picks it up through the sync run.

Personal-life areas fold in exactly the same way (see `canon/personal.md`): same brain, same memory, scoped
by which surface/knowledge set loads them.

## 6. Guardrails (so consolidation never loses anything)

- **Nothing is deleted.** `REGISTRY.md` classifies every doc as *canonical*, *reference*, or *historical* —
  historical files stay in place, clearly marked, never edited.
- **One source per capability.** If two files claim the same rule, one is canonical and the other becomes a
  redirect note pointing here (the `DEAL-AGENT-SOURCE-OF-TRUTH.md` stub pattern).
- **Version everything.** Canon carries a version; every rendered surface artifact stamps the version it was
  built from, so drift is visible.
