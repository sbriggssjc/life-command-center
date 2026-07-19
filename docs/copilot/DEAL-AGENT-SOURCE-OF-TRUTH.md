# LCC Deal Agent — Source of Truth & Maintenance
**One agent:** "LCC Deal Agent" (Copilot Studio). **One connector:** "LCC Intelligence"
(Power Platform custom connector). **Start here for any Deal Agent change.** This index names the
single canonical file for each component so we never fork versions again.
Last reconciled: July 2026.

## Canonical sources — edit ONLY these
| Component | Canonical file (repo `life-command-center/`) | How the change reaches the agent |
|---|---|---|
| **Instructions** | `docs/copilot/agent-instructions.md` | Paste everything **below the `---`** into Copilot Studio → LCC Deal Agent → **Instructions** → Publish. |
| **Tools / actions** | `copilot/lcc-deal-intelligence.connector.v2.swagger.json` (Swagger 2.0, "LCC Deal Intelligence" v2.1.0) | Update the **"LCC Intelligence"** custom connector from this file (Power Platform → Custom connectors → import/update), then the agent's **Tools** pick it up. |
| **Knowledge** | `_AI-Context/Copilot-Context/`: `BRIGGS-SYSTEM-PROMPT.md`, `BRIGGS-MASTER-CONTEXT.md`, `BRIGGS-WRITING-VOICE.md`, `BRIGGS-CRE-FRAMEWORKS.md`, `BRIGGS-BD-PLAYBOOK.md`, `BRIGGS-PERSONAL-CONTEXT.md` (+ add `CONTEXT_ROUTER.md`) | Copilot Studio → **Knowledge** → the SharePoint copies; re-sync on change. |
| **Backend the tools call** | `life-command-center` repo (deployed to `tranquil-delight-production-633f.up.railway.app`) | Code deploy; `/openapi.json` is generated from it. |

## Legacy / superseded — DO NOT edit or wire into the agent (kept for history only)
- `_AI-Context/Copilot-Context/declarative-copilot-updated.json` — its `instructions` are a
  **stale, shorter copy** of `agent-instructions.md`; its `actions` point to `ai-plugin.json`
  (a different, plugin-style path). Not the live agent's instructions.
- `_AI-Context/Copilot-Context/ai-plugin.json` → `…/openapi.json` — legacy plugin-style
  integration; **superseded by the "LCC Intelligence" custom connector.** Do not attach both.
- `copilot/lcc-deal-intelligence.connector.v1.swagger.json` — superseded by **v2**.
- `copilot/actions/*.yaml` — old per-action drafts.
- `_AI-Context/Copilot-Context/lcc-copilot-integration-plan.md` — a July-2026 planning doc; parts
  are stale (e.g., "ai-plugin.json is missing"). Historical only.
- Any `DealAgent_Instructions.md` delivered in a chat — extracted from the stale manifest; ignore.

## Update protocol (keep it to these steps)
1. **Instructions** change → edit `agent-instructions.md` → paste below the `---` into Studio → Publish.
2. **Tool/action** change → edit the **v2 swagger** → update the "LCC Intelligence" connector → (add the backend endpoint in the repo if it's a new action).
3. **Knowledge** change → edit the `BRIGGS-*.md` → re-sync in Studio Knowledge.
4. **One agent, one connector — never create a second.** If Studio ever shows a duplicate agent or connector, delete the copy, don't edit it.

## Known open item — per-user reads (Phase 3)
Backend `ai-copilot` v70 resolves `user_email → lcc_users → assigned_to/owner_id`. The v2
connector currently exposes **`assigned_to`** (not `user_email`). For per-user briefings/queues,
either bind the Teams user's name to `assigned_to`, or add a `user_email` parameter to the v2
swagger and the backend spec. See `_WORKFLOW/SPEC_Multi_User_Enablement.md` and
`_WORKFLOW/PATCH_Phase3_PerUserReads.md`.
