# Claude Code queue — STATUS  (updated 2026-08-03, session 2i)

## Open (in `prompts/`)
| # | Prompt | Priority | State |
|---|--------|----------|-------|
| 22 | MCP server unification + protocol bump | P0 | **code DONE + committed `ddd9d49e`; DEPLOY-PENDING (Scott: env vars on tranquil-delight + redeploy)** |
| 21 | Copilot Studio -> /mcp connect + publish | P1 | **blocked on 22 deploy** (then Scott connects + publishes to M365) |
| 19 | Run census demographics backfill | P1 | **PAUSED per Scott** — awaiting a working key from census.gov |
| 18 | Recurring PA flow failures | P1 | code DONE; tenant PA flows now handled (see below) |

## THE ONE THING THAT UNBLOCKS EVERYTHING: deploy `ddd9d49e` to tranquil-delight
Prompt 22 mounted `/mcp` + OAuth + the 9 bounded `/api/*` read/comps routes onto the root app (`server.js:162`,
before the `/api/*` 404 handler at `server.js:559`), and bumped `initialize` to negotiate `>= 2025-03-26`.
Locally verified (19 tools, 401/echo, check:boot passes). **Not deployed.** Deploying it fixes, in one step:
- **ChatGPT** "Unknown API route" on comps (the GPT's comps call falls through to the 559 handler today —
  confirmed in this session's re-import test chat). Import itself succeeded (prompt 20 trim worked).
- **Copilot Studio** MCP (`/mcp` becomes live at the canonical URL) → prompt 21 Part 2.
- **The 2-server drift** ("fixes land on the server ChatGPT never calls").

**Scott's deploy checklist:** set on the `tranquil-delight` Railway service —
`OPS_SUPABASE_URL/KEY`, `GOV_SUPABASE_URL/KEY`, `PRIMARY_WORKSPACE_ID`, `LCC_API_KEY`, `MCP_BASE_URL` + OAuth —
then redeploy. Live-verify: `POST /mcp` initialize → 200 w/ Bearer (not 404); the 9 `/api/*` → 200; ChatGPT
"Government comps in Texas, last 12 months" returns real comps; then connect Copilot.

## Power Automate (tenant) — RESOLVED by Scott
Retired flows (Unflag Completed Email Tasks, To Do Sync) are **Off**. The sole remaining active To Do flow is
**LCCToDoCompletionPoll** (30-min recurrence): GET/POST `tranquil-delight/api/webhooks/todo-completion-poll`
(route live at `server.js:266` → `api/sync.js`; design in `docs/architecture/flows/todo-completion-poll.md`),
reads staged worklist, reconciles MS To Do + Outlook (resolve msg id → move → flag), reports completion.
Reviewed this session — well-formed and consistent with the documented design; healthy. Health surface should
green out as the retired rows age off.

## This session (2i) processed
- **Prompt 22 response** — code landed + committed `ddd9d49e`; deploy-pending. Response -> done/.
- **ChatGPT re-import test** — GPT correctly refuses to fabricate; blocked only by "Unknown API route" = the
  un-deployed unification (same fix as 22). Not a new issue.
- **LCCToDoCompletionPoll flow** — reviewed; healthy; it's the consolidation of the two retired flows.

## Needs Scott (not code)
- **Deploy `ddd9d49e`** to tranquil-delight (env vars + redeploy) — unblocks ChatGPT + Copilot. ← top priority.
- **Copilot Studio** connect + publish (prompt 21 Part 2) — after the deploy.
- **Census:** paused; obtain a working key from census.gov, then resume prompt 19.

## Done (in `done/`)
01-14, 16, 17, 20, 07; session 2i: prompt-22 response. 15 RETIRED.

## Migrations applied live by Cowork (Supabase MCP)
#710 field_source_priority · relocation+competition (Dialysis) · lcc_health_surface (connector_type::text) ·
lcc_contact_property_deal_reverse_reads.

## Process: see `README.md`.
