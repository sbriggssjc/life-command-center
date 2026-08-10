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
- 2026-08-09: Verified packet/tab code is present in `HEAD` for `api/capital-markets.js`, `capital-markets.js`, `app.js`, and packet/commentary migrations.
- 2026-08-09: Added MCP `get_capmarkets_packet` wrapper in `mcp/server.js`.
- 2026-08-09: Resolved existing conflict markers in `api/_shared/cm-excel-export.js` while preserving the methodology-note constants and the `commentary` workbook parameter.
- 2026-08-09: Verification passed: `node --check api/capital-markets.js`, `node --check api/_shared/cm-excel-export.js`, `node --check capital-markets.js`, `node --check app.js`, `node --check mcp/server.js`, and targeted CM tests.
- 2026-08-09: Production follow-up after live screenshot showed `/api/capital-markets?action=packet...` returning 501. Root cause: Railway redeploy shipped JS but the Dialysis_DB packet tables had not been applied. Applied `supabase/migrations/dialysis/20260809_cm_report_packets_and_commentary.sql` to linked Dialysis_DB (`zqzrriwuavgrquhisnoa`), verified `packet_status` returns `built: true`, and froze Q2-2026 dialysis packet snapshot `94437ab8-824e-4c42-ac3e-360709d36310` with 38 charts.
- 2026-08-09: Scott applied the same packet/commentary migration to Government DB (`scknotsqkcheojiaewwh`) and relinked the local Supabase project back to Dialysis_DB. Verified live Railway `packet_status&vertical=gov` returns `built: true`.
- 2026-08-09: New live screenshot showed the app still rendering old/incomplete chart output. Root cause: frozen packets were assembled through the lightweight dashboard `fetchQuarterly()` path, while the workbook uses the richer export assembly path with display_from crops, as-of clamps, reconstruction, monthly master_m overrides, synthetic chart composition, and modeled rent handling. Added an internal export payload path (`format=payload`) and changed packet freezing to call that same export assembly source. The app now requests packet-backed server PNGs through `action=packet_images` and displays those export-rendered images in chart cards instead of rebuilding browser Chart.js versions for normal charts. Fixed the quarter selector so rerendering preserves the selected as-of quarter.
- 2026-08-09: Follow-up screenshot still showed worksheet charts looking wrong in-app and one card stuck on `Loading export chart...`. Root causes: the app requested every PNG in one large batch, so one or more QuickChart failures left cards stuck, and the two-column grid compressed worksheet-sized chart images to half-width. Changed the app to render one chart per row at worksheet width and fetch chart images per-card with bounded concurrency, so each chart updates independently and failures show an explicit per-chart fallback message.
- 2026-08-09: Third screenshot showed the app still using the legacy QuickChart interpretation rather than the latest Excel native chart definitions (example: `bid_ask_spread`). Added a native-spec image adapter: migrated native Excel templates now build the same `buildInjectionSpec()` inputs as the workbook and translate those specs to Chart.js for app PNGs, with QuickChart legacy rendering only as fallback. Exported read-only chart column/tab-name accessors from `cm-excel-export.js` for this shared path. Fixed a shared native `bid_ask_spread` null-coercion bug where `Number(null)` forced a 0% axis floor; null Last Ask/Spread now stay null, so both Excel and app fit the cap axis to the actual plotted Last Ask/Achieved levels.
- 2026-08-10: Investigated government export screenshot showing blank x-axis lead-in on `bid_ask_spread`. Live `cm_gov_bid_ask_spread_m` coverage has rows back to 1997, but first non-null spread/last-ask/achieved values begin 2007-08-31 and full-year coverage begins 2008, so this is not a deeper data-pull gap. Root cause: native chart trim was year-granular; the density gate returned 2007 and chart ranges started Jan-2007, leaving Jan-Jul blank categories. Added exact-period trimming for bid-ask native specs plus a partial-year regression test.
- 2026-08-10: Investigated government `cap_rate_by_credit` screenshot. Live coverage: quarterly view has Federal 117/117 quarters (1997-03→2026-03), State 77 quarters (2004-12→2025-09), Municipal 29 quarters (2014-12→2023-03); monthly view has Federal 351 months, State 230 months, Municipal 84 months. Recent TTM counts show Municipal falls below the n>=2 gate after 2023-03 except a few isolated rows, and 2023+ unclassified cap-eligible rows mostly lack both `government_type` and `agency`, so this is primarily a source-data/enrichment gap, not a chart pull failure. Fixed chart brand styling: Municipal line/markers now use dark gray instead of green/peridot in native Excel and PNG renderer.
- 2026-08-10: Saved a future exploratory prompt at `docs/capital-markets/CLAUDE_CODE_PROMPT_gov_credit_tier_ingestion_propagation.md` to investigate gov deal ingestion/propagation for `government_type`, `agency`, classifier drift, State/Municipal coverage, and safe remediation options.
