# Copilot Capability Assessment Worklog (LCC)

## Chat Objective
- Produce a repository-specific Copilot capability assessment for `life-command-center` in `copilot_capability_map_lcc.md`.
- Determine whether LCC should be the primary Copilot-facing orchestration and interaction layer across the broader multi-repo system.

## Instructions Captured
- Be concrete and repo-specific.
- Prefer existing code paths over hypothetical redesigns.
- Do not invent endpoints or modules.
- Explicitly separate what should remain in backend repos vs what should be orchestrated in LCC.

## Design/Approach
- Inventory live code surfaces first: `api/*`, `_shared/*`, primary UI modules, schema, and tests.
- Build a capability/action catalog from implemented routes and workflows.
- Classify each action by autonomy safety, confirmation requirement, and Microsoft surface fit.
- Recommend cross-repo routing boundaries based on current integration points.

## Progress Updates
- 2026-04-02: Located core repo structure and deployment routing (`vercel.json`).
- 2026-04-02: Confirmed LCC exposes orchestration APIs for sync, queue, workflows, admin, entities, contacts, domains, and bridge/chat.
- 2026-04-02: Began extracting action-level details from `api/sync.js` and `api/workflows.js`.
- 2026-04-02: Completed endpoint/workflow inventory across `api/*` and `_shared/*`; mapped frontend invocation paths from `app.js`, `ops.js`, `gov.js`, `detail.js`, and `contacts-ui.js`.
- 2026-04-02: Authored final deliverable `copilot_capability_map_lcc.md` with required 12 sections and concrete action catalog.
- 2026-04-02: Imported cross-repo synthesis reference doc into LCC: `copilot_authoritative_architecture_plan.md`.
- 2026-04-02: Created architecture blueprint and companion placeholders under `docs/architecture/`:
  - `copilot_operating_system_blueprint.md`
  - `copilot_action_registry.md`
  - `copilot_wave1_build_plan.md`
  - `copilot_agent_catalog.md`
- 2026-04-02: Implemented Wave 1 Outlook -> Intake -> Team Visibility orchestration assets:
  - Added read-only Teams formatting endpoint: `api/intake-summary.js`
  - Added flow documentation: `docs/architecture/outlook_intake_team_visibility_workflow.md`
  - Added Power Automate definition templates:
    - `flow-outlook-intake-to-teams.json`
    - `flow-outlook-intake-button-to-teams.json`
- 2026-04-02: Hardened Outlook event semantics for deterministic single-message intake:
  - Added `POST /api/intake-outlook-message` (`api/intake-outlook-message.js`)
  - Updated intake summary correlation parsing for new deterministic IDs
  - Updated workflow doc with current-vs-hardened guidance
  - Added Adaptive Card template and hardened flow template:
    - `docs/architecture/teams_outlook_intake_adaptive_card.json`
    - `flow-outlook-intake-to-teams-hardened.json`
- 2026-04-02: Completed Vercel env secret usage audit and auth recommendation:
  - Added `docs/architecture/vercel_secret_usage_audit.md`
  - Audited usage/fallback/failure modes for WebEx, OPS, GOV, and DIA env vars
  - Documented existing inbound auth pattern (`LCC_API_KEY` + `X-LCC-Key`) and Power Automate recommendation

## What Is Working
- Consolidated API architecture exists with route rewrites and action multiplexing.
- Existing cross-domain key/env model already references GOV and DIA backends.
- Workflow and sync modules already implement many orchestration primitives needed for Copilot actions.

## What Is Missing / Unknown Yet
- No code changes were made to runtime behavior in this pass; this was an architecture/capability assessment only.
- One notable functional gap identified during audit: contacts UI issues `send_teams/send_webex/send_sms` actions but handler routing in `api/contacts.js` does not expose those actions.

## Next Steps
- Review and approve the boundary recommendation (LCC as Copilot entry/routing/review layer; domain write authority remains in GovernmentProject and DialysisProject).
- If approved, convert the action catalog into an implementation checklist for Copilot connectors/tooling.
