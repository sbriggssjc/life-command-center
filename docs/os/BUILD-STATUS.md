# Build Status — where the OS architecture actually stands

One honest answer to "are we done?" Legend: ✅ built/live · ⏳ built in repo, pending a manual apply ·
📐 designed/specced, not built · 🚫 excluded by decision · 🔮 roadmap. Last updated: 2026-07-24.

## Foundation (the consistency contract)
- ✅ **Canon** — `docs/os/canon/` (8 topic modules + blocks) is the single source of the rules.
- ✅ **Render + parity enforcement** — `tools/render-surfaces.mjs` + `check-parity.mjs`; tested (green when
  synced, non-zero exit on drift).
- ✅ **OS home + registry + start-here pointers** — `README.md`, `REGISTRY.md`, root `LCC-OS.md`, banners in
  `CLAUDE.md`/`AGENTS.md`.

## Surfaces (canon-bound)
- ✅ **Copilot** — `agent-instructions.md` canon-migrated; **published** by Scott.
- ✅ **ChatGPT** — persona canon-migrated (parity ✓); ⏳ paste into the GPT.
- ⏳ **Northmarq Claude** (Project prompt), **Personal Claude** / **Cowork** (skills) — bundles generated in
  `surfaces/`; sync (paste) pending.
- ✅ **LCC in-app** (`/api/chat`) — unchanged by design (the brain's own front door).

## Unification (one URL for every surface)
- ✅ **Phase 1 LIVE** — `api/ai-read.js` proxy + `server.js` routes + openapi briefing path; ChatGPT/Copilot
  reach all 9 ops on one base URL; Claude connector unchanged.
- 🔮 **Phase 2** — collapse into a single service, retire the standby (`architecture/unification-changeset.md`).

## Copilot agent structure (tools + specialists)
- ✅ **LCC Intelligence connector** — live (comps, property, briefing, drafts, memory).
- ✅ **Work IQ SharePoint** — present in the Deal Agent (DLP passed). ⏳ apply the least-privilege enable set +
  pin the Team Briggs site via Inputs + end-user auth (`connected-agent-descriptions.md` / the tool list).
- 📐 **Document Files Agent** & **Document Assembly Agent** — routing descriptions + instructions are
  paste-ready (`connected-agent-descriptions.md`). ⏳ create them in Studio and connect to the orchestrator.
- ✅ **Orchestrator delegation block** — added to `agent-instructions.md` (marked "activate when specialists
  exist"). ⏳ publish alongside creating the specialists.
- ✅ **Office Script** for the pro-forma escalation fix — `architecture/office-scripts/apply-lease-escalation.ts`
  (+ wiring README). ⏳ load into Office Scripts + build the Power Automate flow.
- 🚫 **Work IQ Mail / Teams** — excluded (email/comms stay on the LCC path).
- 🔮 **Work IQ Word/User/Calendar, Azure AI Document Intelligence, Approvals, a `Sites.Selected` Graph app** —
  scoped as roadmap.

## Connected-agent model (task agents connected to the Deal Agent)
- ✅ **Settled & documented** — orchestrator + specialists *only* for tool-heavy capabilities; the 9 catalog
  roles stay as flows. Reconciled under "one brain, unlimited front doors."
- ⏳ **Built** — the two specialists' Studio creation (yours) is the remaining step; everything they need is specced.

## Cortex (memory) & personal
- ✅ **Cortex** — server-side, device-agnostic; reachable on every surface; write-gated (`log_memory` Claude/MCP-only).
- ✅ **Personal binding** — `canon/personal.md` (same brain/memory/voice, scoped off team surfaces).
- ✅ **Access/device topology** — `ACCESS-TOPOLOGY.md` maps devices × storage × surfaces; flags the D-drive
  island; gives the personal-project homing rules.

## Consolidation & hygiene
- ✅ **Graveyard** — superseded files moved to `_superseded/` with an index; back-compat items documented.
- ⏳ **SharePoint `_WORKFLOW` deployment docs** (4) — correct via Copilot in-tenant now that Phase 1 is live.
- ⏳ **`LCC_API_KEY` rotation** — deferred to the end (threaded through Power Automate flows).

## What "done" needs (remaining)
1. Manual surface applies: paste ChatGPT persona; sync Northmarq/Personal/Cowork bundles.
2. Create the 2 Copilot specialists in Studio + publish the delegation block; apply the Work IQ least-privilege config.
3. Load the Office Script + build its Power Automate flow.
4. `git push` the repo; triage D-drive files; home the personal projects (`ACCESS-TOPOLOGY.md`).
5. Correct the 4 SharePoint deployment docs; (last) rotate `LCC_API_KEY`.
6. Optional: unification Phase 2.
