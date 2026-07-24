# LCC Deal Agent — Source of Truth & Maintenance
**One agent:** "LCC Deal Agent" (Copilot Studio). **One connector:** "LCC Intelligence"
(Power Platform custom connector). **Start here for any Deal Agent change.** This index names the
single canonical file for each component so we never fork versions again.
Last reconciled: July 2026 (comps flow added; stale setup/ instruction copies collapsed to stubs).

## Canonical sources — edit ONLY these
| Component | Canonical file (repo `life-command-center/`) | How the change reaches the agent |
|---|---|---|
| **Instructions** | `docs/copilot/agent-instructions.md` | Paste everything **below the `---`** into Copilot Studio → LCC Deal Agent → **Instructions** → Publish. **NOTE:** the `## Canon — shared rules` region (`CANON:BEGIN…END`) is GENERATED from `docs/os/canon` — do not hand-edit it; change the block in `docs/os/canon/blocks/`, bump `CANON_VERSION`, run `docs/os/tools/render-surfaces.mjs --write-live`, then paste & Publish. See `docs/os/RENDER-AND-PARITY.md`. |
| **Tools / actions** | `copilot/lcc-deal-intelligence.connector.v2.swagger.json` (Swagger 2.0, "LCC Deal Intelligence" v2.1.0) | Update the **"LCC Intelligence"** custom connector from this file (Power Platform → Custom connectors → import/update), then the agent's **Tools** pick it up. |
| **Comps action (new)** | Add `QueryComps` + `SynthesizeComps` to the v2 swagger above. Engine = shared `mcp/comps-tools.js` (`runComps`). Contract: `docs/comps-tools/openapi_comps.yaml`. | The comps flow in `agent-instructions.md` calls these. **Open item (below):** the backend endpoint currently lives on the MCP server, not the connector's host — must be reconciled before the connector can reach it. |
| **Knowledge** | `_AI-Context/Copilot-Context/`: `BRIGGS-SYSTEM-PROMPT.md`, `BRIGGS-MASTER-CONTEXT.md`, `BRIGGS-WRITING-VOICE.md`, `BRIGGS-CRE-FRAMEWORKS.md`, `BRIGGS-BD-PLAYBOOK.md`, `BRIGGS-PERSONAL-CONTEXT.md` (+ add `CONTEXT_ROUTER.md`) | Copilot Studio → **Knowledge** → the SharePoint copies; re-sync on change. |
| **Backend the tools call** | `life-command-center` repo (deployed to `tranquil-delight-production-633f.up.railway.app`) | Code deploy; `/openapi.json` is generated from it. |

## Legacy / superseded — DO NOT edit or wire into the agent (kept for history only)
- `_AI-Context/Copilot-Context/declarative-copilot-updated.json` — its `instructions` are a
  **stale, shorter copy** of `agent-instructions.md`; its `actions` point to `ai-plugin.json`
  (a different, plugin-style path). Not the live agent's instructions.
- `_AI-Context/Copilot-Context/ai-plugin.json` → `…/openapi.json` — legacy plugin-style
  integration; **superseded by the "LCC Intelligence" custom connector.** Do not attach both.
- `_superseded/copilot/lcc-deal-intelligence.connector.v1.swagger.json` — superseded by **v2**; moved to the `_superseded/` graveyard (see `_superseded/README.md`).
- `copilot/actions/*.yaml` — old per-action drafts.
- `_AI-Context/Copilot-Context/lcc-copilot-integration-plan.md` — a July-2026 planning doc; parts
  are stale (e.g., "ai-plugin.json is missing"). Historical only.
- Any `DealAgent_Instructions.md` delivered in a chat — extracted from the stale manifest; ignore.
- `docs/setup/copilot-studio-agent-instructions.md` and `docs/setup/copilot-agent-instructions.md` — **now redirect stubs** (were April-2026 forks). They point back to `agent-instructions.md`; do not edit or paste from them.
- `docs/setup/gpt-actions-system-prompt.txt` — the **ChatGPT** surface persona (a different surface, not the Copilot Deal Agent). Keep its core rules in sync with `agent-instructions.md` when they change.

## Update protocol (keep it to these steps)
1. **Instructions** change → edit `agent-instructions.md` → paste below the `---` into Studio → Publish.
2. **Tool/action** change → edit the **v2 swagger** → update the "LCC Intelligence" connector → (add the backend endpoint in the repo if it's a new action).
3. **Knowledge** change → edit the `BRIGGS-*.md` → re-sync in Studio Knowledge.
4. **One agent, one connector — never create a second.** If Studio ever shows a duplicate agent or connector, delete the copy, don't edit it.

## Comps action backend placement — RECONCILED (pending deploy + connector re-import)
Done: `/api/query-comps` + `/api/synthesize-comps` added to the **`tranquil-delight` backend**
(`api/query-comps.js`, a thin proxy that authenticates the connector's `X-LCC-Key` and forwards to
`GOV_API_URL` = the MCP server, which owns the shared `comps-tools.js` engine). `QueryComps` +
`SynthesizeComps` added to the v2 swagger. One connector, one host — no second connector created.
Claude uses the same engine via its MCP `query_comps` tool, so parity holds by construction.

To activate on Copilot: (1) commit + push → main app redeploys on `tranquil-delight`; confirm
`LCC_API_KEY` and `GOV_API_URL` are set there; (2) re-import the v2 swagger into the "LCC Intelligence"
custom connector (Power Platform → update); (3) add the `QueryComps`/`SynthesizeComps` actions to the
agent's Tools; (4) paste the updated `agent-instructions.md` into Studio → Instructions → Publish.

## Known open item — per-user reads (Phase 3)
Backend `ai-copilot` v70 resolves `user_email → lcc_users → assigned_to/owner_id`. The v2
connector currently exposes **`assigned_to`** (not `user_email`). For per-user briefings/queues,
either bind the Teams user's name to `assigned_to`, or add a `user_email` parameter to the v2
swagger and the backend spec. See `_WORKFLOW/SPEC_Multi_User_Enablement.md` and
`_WORKFLOW/PATCH_Phase3_PerUserReads.md`.
