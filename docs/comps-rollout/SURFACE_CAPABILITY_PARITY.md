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
| ChatGPT | GPT Action (OpenAPI) | `docs/comps-rollout/lcc-openapi.yaml` (full read + comps; supersedes the comps-only `lcc-comps-openapi.yaml`) |
| Copilot Studio | Custom connector / agent action | same OpenAPI (`lcc-openapi.yaml`); `LCC Deal Agent` package (manual) |
| LCC in-app Copilot | `/api/chat` orchestration | `api/bridge.js`, `api/_shared/ai.js` (separate, broad) |

## Capability × Surface matrix
Legend: ✅ wired · ⬜ gap (should be wired) · ➖ n/a / by design elsewhere · 🔶 wired but doc stale

| Capability | Northmarq Claude | Personal Claude | Cowork | ChatGPT | Copilot Studio | LCC in-app Copilot |
|---|---|---|---|---|---|---|
| search_entities | ✅ MCP | ✅ MCP | ✅ MCP | ✅ `POST /api/search-entities` | ✅ `POST /api/search-entities` | ✅ `/api/entities` |
| get_property_context | ✅ MCP | ✅ MCP | ✅ MCP | ✅ `/api/property-context` | ✅ `/api/property-context` | ✅ |
| get_contact_context | ✅ MCP | ✅ MCP | ✅ MCP | ✅ `/api/contact-context` | ✅ `/api/contact-context` | ✅ |
| get_daily_briefing | ✅ MCP | ✅ MCP | ✅ MCP | ✅ `/api/daily-briefing` | ✅ `/api/daily-briefing` | ✅ |
| get_queue_summary | ✅ MCP | ✅ MCP | ✅ MCP | ✅ `/api/queue-summary` | ✅ `/api/queue-summary` | ✅ |
| get_pipeline_health | ✅ MCP | ✅ MCP | ✅ MCP | ✅ `/api/pipeline-health` | ✅ `/api/pipeline-health` | ✅ |
| recall_memory (read) | ✅ MCP | ✅ MCP | ✅ MCP | ✅ `/api/recall-memory` | ✅ `/api/recall-memory` | ➖ |
| log_memory (WRITE) | ✅ MCP | ✅ MCP | ✅ MCP | ➖ Claude/MCP-only (no HTTP by design) | ➖ Claude/MCP-only | ➖ |
| query_comps | ✅ MCP | ✅ MCP | ✅ MCP | ✅ OpenAPI | ✅ OpenAPI | ⬜ |
| synthesize_comps | ✅ MCP | ✅ MCP | ✅ MCP | ✅ OpenAPI | ✅ OpenAPI | ⬜ |
| generate_comps (workbook) | 🔶 Project action (stale contract) | ✅ MCP | ✅ MCP | ⬜ (prompt 1) | ⬜ (prompt 1) | ➖ |
| generate_bov (workbook) | ✅ Project action | ✅ MCP + skill | ✅ MCP + skill | ⬜ | ⬜ | ➖ |
| LCC orchestration (queue/workflow/sync/writes) | ➖ | ➖ | ➖ | ➖ | 🔶 (agent, partial) | ✅ |

## Gaps → to reach full parity
1. **✅ DONE (Option A, 2026-07) — read tools exposed over HTTP.** The 6 context/ops tools + `recall_memory`
   now have Bearer-authed `/api/*` routes on `mcp/server.js`, each reusing the EXACT same `TOOL_HANDLERS[name]`
   the MCP surface uses (one implementation, zero MCP-vs-HTTP drift — verified byte-identical JSON on `/mcp`
   vs `/api`). `docs/comps-rollout/lcc-openapi.yaml` (this pass) is the single import for ChatGPT + Copilot.
   Routes: `/api/search-entities`, `/api/property-context`, `/api/contact-context`, `/api/daily-briefing`,
   `/api/queue-summary`, `/api/pipeline-health`, `/api/recall-memory`.
   - **Read-only guarantee preserved:** none of the new routes mutate data (each has a one-line read-only
     assertion; `makeReadHttpRoute` throws if handed a non-read-only tool). `log_memory` (the only WRITE tool)
     is intentionally NOT exposed over HTTP — it stays Claude/MCP-only.
   - **Security — single key now has broader read scope.** Auth is unchanged (Bearer `LCC_API_KEY`), but this
     widens the one key's read reach from comps to all context/CRM/pipeline data, so: (a) the pending
     `LCC_API_KEY` rotation (checklist P1) is now HIGHER priority, and (b) **recommended follow-up: per-surface
     API keys** (a distinct token per connector so one leak is scoped + independently revocable). Per-surface
     keys are NOT built in this pass — documented as the roadmap.
   - **Data-governance note (by design, Scott approved Option A):** these routes let ChatGPT (OpenAI) and
     Copilot (Microsoft) receive contact / CRM / pipeline data. This is intentional. If any tool should stay
     Claude-only for PII reasons, gate it behind an env allowlist (e.g. `HTTP_TOOLS_ALLOWLIST`) — the mount
     loop already reads a `READ_ONLY_HTTP_TOOLS` allowlist, so narrowing it is a one-line change.
2. **generate_comps on ChatGPT/Copilot** — `CCP_generate_comps_action_chatgpt_copilot.md` (unify auth + schema;
   append `generateComps`/`generateBov` into `lcc-openapi.yaml` under the same server + Bearer).
3. **Northmarq Project action comps contract is stale** — fix the `/generate-comps` description in
   `claude_project_action.json` (same prompt above).
4. **`mcp/README.md`** — updated this pass to all 12 tools + the `/api/*` read routes in Endpoints.
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

**ChatGPT** — import `lcc-openapi.yaml` (Bearer). This is the full read + comps surface (Option A done); it
carries `searchEntities`, `getPropertyContext`, `getContactContext`, `getDailyBriefing`, `getQueueSummary`,
`getPipelineHealth`, `recallMemory`, `queryComps`, `synthesizeComps`. Set `servers[0].url` to `MCP_BASE_URL`.
(Anyone still on the old comps-only `lcc-comps-openapi.yaml` should re-import `lcc-openapi.yaml` to gain the
read tools; workbook generation is appended by the companion prompt.)

**Copilot Studio** — import the same `lcc-openapi.yaml` as a custom connector; wire into the LCC Deal Agent.
Rich orchestration stays in the in-app Copilot per `copilot_capability_map_lcc.md`.

**LCC in-app Copilot** — already broad; optionally add comps query/synthesize to `/api/chat`'s tool routing so
in-app chat can pull comps too (currently a ⬜).

## Invariants every surface must preserve
Reliable-or-exclude NOI/rent (dialysis + gov); cap rates as decimals; request-aware multi-tenant naming
(MOB/MT + anchor); cap/rent reconciliation flags → dialysis review queue; record-first BOV resolution
(address/id → same workbook); `buyer`/`seller`/`financing` out of comps unless asked; formula-protected
columns never written; all read tools read-only; the WRITE tool (log_memory) is never exposed over HTTP
(Claude/MCP-only); every HTTP surface calls the same tool handler as MCP, so results cannot diverge.
