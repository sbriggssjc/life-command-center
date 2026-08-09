# Capital Markets Tab Packet Worklog

## Objective
Build the LCC Capital Markets tab so app charts, Excel export data, and report commentary read from one frozen figure packet per `(vertical, quarter)`.

## Instructions And Constraints
- Read `CLAUDE.md` and `.github/AI_INSTRUCTIONS.md` before editing `/api/`.
- Production runs on Railway through `server.js`.
- Prefer sub-routes/actions on existing handlers.
- No chart-logic forks: packet, app, and export should share the same chart payload wherever possible.
- Single writer per store: packet/commentary writes go through `/api/capital-markets`.

## Packet Layer Status
- Initial repo check found `docs/comps-rollout/capital-markets-update-PLAN.md` and skill text specifying `cm_report_snapshots`.
- No implemented `cm_report_snapshots` migration, `get_capmarkets_packet` MCP tool, or packet API action was found.
- Existing chart/export logic lives in `api/capital-markets.js` plus `api/_shared/cm-*`.

## Implementation Plan
1. Add `cm_report_snapshots` and `cm_report_commentary` schema in the dialysis migrations, government-ready by vertical/domain.
2. Add packet API actions to `api/capital-markets.js`: status, freeze-or-fetch, commentary CRUD/generation, and markdown emission.
3. Update `capital-markets.js` to route chart loads through frozen packets for selected quarters, show commentary, and export optional commentary.
4. Add `#/capmarkets` route alias and MCP `get_capmarkets_packet` wrapper.
5. Run targeted tests/checks.

## Progress
- 2026-08-09: Started implementation from existing CM export stack.
