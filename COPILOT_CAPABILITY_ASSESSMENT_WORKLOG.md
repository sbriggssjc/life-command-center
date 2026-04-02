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
