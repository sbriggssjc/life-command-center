# LCC AI Surface Capability Parity

**Goal:** every AI surface exposes the same skills and capabilities, backed by the same shared engines, so a
request resolves to the same data and the same deliverable no matter where it's asked. This is the master map;
update it whenever a capability or surface changes.

## Engines (source of truth — one implementation each)
| Engine | Where | Backs |
|---|---|---|
| Comps engine | `mcp/comps-tools.js` | query_comps, synthesize_comps (+ HTTP mirrors) |
| Comps workbook | `bov-generator/comps_generator.py` → `/generate-comps` | generate_comps |
| BOV workbook | `bov-generator/` → `/generate-bov` (record-first resolver) | generate_bov |
| Context/ops tools | `mcp/server.js` | search_entities, get_property_context, get_contact_context, get_daily_briefing, get_queue_summary, get_pipeline_health, log_memory, recall_memory |
| LCC orchestration | `api/*` (queue, workflows, entities, sync, apply-change) | the in-app Copilot (`/api/chat`) — see `copilot_capability_map_lcc.md` |

## Surfaces & how each is configured
| Surface | Mechanism | Config artifact(s) |
|---|---|---|
| Northmarq Claude (team Project) | MCP connector + Project action + Project prompt | `{MCP_BASE_URL}/mcp`; `bov-generator/claude_project_action.json`; `NORTHMARQ_PROJECT_PROMPT.md` |
| Personal Claude | MCP connector + personal skills | `{MCP_BASE_URL}/mcp`; `~/.claude/skills/*` |
| Claude Cowork | MCP tools + Cowork skills | MCP tools; `docs/comps-rollout/comps-engine-SKILL.md`, briggs-comps, bov-underwriting, cms-npi-analysis, bov-government |
| ChatGPT | GPT Action (OpenAPI) | `docs/comps-rollout/lcc-comps-openapi.yaml` (+ BOV/comps generation) |
| Copilot Studio | Custom connector / agent action | same OpenAPI; `LCC Deal Agent` package (manual) |
| LCC in-app Copilot | `/api/chat` orchestration | `api/bridge.js`, `api/_shared/ai.js` (separate, broad) |

## Capability × Surface matrix
Legend: ✅ wired · ⬜ gap (should be wired) · ➖ n/a / by design elsewhere · 🔶 wired but doc stale

| Capability | Northmarq Claude | Personal Claude | Cowork | ChatGPT | Copilot Studio | LCC in-app Copilot |
|---|---|---|---|---|---|---|
| search_entities | ✅ MCP | ✅ MCP | ✅ MCP | ⬜ no HTTP route | ⬜ no HTTP route | ✅ `/api/entities` |
| get_property_context | ✅ MCP | ✅ MCP | ✅ MCP | ⬜ | ⬜ | ✅ |
| get_contact_context | ✅ MCP | ✅ MCP | ✅ MCP | ⬜ | ⬜ | ✅ |
| get_daily_briefing | ✅ MCP | ✅ MCP | ✅ MCP | ⬜ | ⬜ | ✅ |
| get_queue_summary | ✅ MCP | ✅ MCP | ✅ MCP | ⬜ | ⬜ | ✅ |
| get_pipeline_health | ✅ MCP | ✅ MCP | ✅ MCP | ⬜ | ⬜ | ✅ |
| log_memory / recall_memory | ✅ MCP | ✅ MCP | ✅ MCP | ⬜ | ⬜ | ➖ |
| query_comps | ✅ MCP | ✅ MCP | ✅ MCP | ✅ OpenAPI | ✅ OpenAPI | ⬜ |
| synthesize_comps | ✅ MCP | ✅ MCP | ✅ MCP | ✅ OpenAPI | ✅ OpenAPI | ⬜ |
| generate_comps (workbook) | 🔶 Project action (stale contract) | ✅ MCP | ✅ MCP | ⬜ (prompt 1) | ⬜ (prompt 1) | ➖ |
| generate_bov (workbook) | ✅ Project action | ✅ MCP + skill | ✅ MCP + skill | ⬜ | ⬜ | ➖ |
| LCC orchestration (queue/workflow/sync/writes) | ➖ | ➖ | ➖ | ➖ | 🔶 (agent, partial) | ✅ |

## Gaps → to reach full parity
1. **ChatGPT/Copilot have comps only.** The 10 context/ops/memory tools + BOV/comps workbook have **no HTTP
   routes**, so non-Claude surfaces can't reach them. Decide the boundary:
   - **Option A (recommended): expose the read tools over HTTP.** Add `/api/*` routes on `mcp/server.js` that
     call the same tool handlers (search_entities, get_property_context, get_contact_context, get_daily_briefing,
     get_queue_summary, get_pipeline_health), and extend the OpenAPI so ChatGPT + Copilot reach them too. Memory
     tools optional. → true parity on read capabilities.
   - **Option B: keep ChatGPT/Copilot comps+BOV-focused**, and route rich orchestration through the LCC in-app
     Copilot (which already has queue/workflow/entity/sync). Document that boundary so it's intentional, not an omission.
2. **generate_comps on ChatGPT/Copilot** — `CCP_generate_comps_action_chatgpt_copilot.md` (unify auth + schema).
3. **Northmarq Project action comps contract is stale** — fix the `/generate-comps` description in
   `claude_project_action.json` (same prompt above).
4. **`mcp/README.md` lists only 6 tools** — update to all 12 + refresh the AI Surface Comparison (done in this pass).
5. **`NORTHMARQ_PROJECT_PROMPT.md`** — add a comps section mirroring the BOV record-first §3P (text in the playbook below).
6. **Cowork skill** — install `comps-engine-SKILL.md` (source in `docs/comps-rollout/`).

## Per-surface update playbook (to apply the same capabilities everywhere)
**Northmarq Claude (team Project)**
- MCP connector already exposes all 12 tools — confirm the Project has the connector added.
- Update `claude_project_action.json` `/generate-comps` description to the real contract (prompt 1).
- Add to `NORTHMARQ_PROJECT_PROMPT.md` a comps clause: *"For comps, call `synthesize_comps` with the request text
  (or `query_comps` with filters); the engine applies reliable-or-exclude, MOB/MT naming, and reconciliation
  flags. To deliver a workbook, pass the returned rows to `generate_comps` (vertical: 'dialysis' for CHAIRS/
  PATIENTS). Never include buyer/seller unless asked. Surface any `flagged_for_review` comps."*

**Personal Claude** — MCP connector covers all tools; ensure personal skills (briggs-comps, bov-underwriting,
cms-npi-analysis, bov-government) are current; add the `comps-engine` skill if desired.

**Cowork** — install `comps-engine` skill; other skills already present.

**ChatGPT** — import `lcc-comps-openapi.yaml` (Bearer). After Option A + prompt 1, re-import to gain the read
tools + workbook generation.

**Copilot Studio** — import the same OpenAPI as a custom connector; wire into the LCC Deal Agent. Rich
orchestration stays in the in-app Copilot per `copilot_capability_map_lcc.md`.

**LCC in-app Copilot** — already broad; optionally add comps query/synthesize to `/api/chat`'s tool routing so
in-app chat can pull comps too (currently a ⬜).

## Invariants every surface must preserve
Reliable-or-exclude NOI/rent (dialysis + gov); cap rates as decimals; request-aware multi-tenant naming
(MOB/MT + anchor); cap/rent reconciliation flags → dialysis review queue; record-first BOV resolution
(address/id → same workbook); `buyer`/`seller`/`financing` out of comps unless asked; formula-protected
columns never written; all read tools read-only.
