# Prompt 28 Worklog - Comps Workbook Hotfix and Appraisal Quality

## Objective

Fix the ChatGPT one-shot comps workbook failure and improve appraisal-mode workbook quality for dialysis sales comps:
sold/on-market counts, field completeness, broken-record exclusion, cap-rate math, subject cap anchoring, and ranking discipline.

## Instructions / Constraints

- Follow `CLAUDE.md` and `.github/AI_INSTRUCTIONS.md` for `/api` and Railway routing conventions.
- Keep the shared comps engine as the source of truth across MCP, ChatGPT HTTP routes, and Copilot.
- Do not fabricate comp data. Exclude broken economics from the primary set; keep higher-cap legitimate comps out of primary appraisal support.

## Changes Made

- `mcp/server.js`: imported `enforceHttpResponseSize` so `/api/comps` one-shot HTTP responses no longer throw `ReferenceError`.
- `mcp/comps-tools.js`:
  - Added richer template/workbook row mapping for `land`, `year_built` / `built`, `lease_expiration`, `expenses` / `lease_type`, `bumps`, `renewal_options`, `chairs`, `patients`, and listing price/date fields.
  - Added appraisal-mode sold primary filtering for implausible caps, sale price below 10x NOI, portfolio/allocation sale wording, and high-cap market-range rows above the subject cap by more than 200 bps.
  - Recomputed cap stats from the reliable sold primary set using NOI / sold price and added weighted average to the returned range object.
  - Increased appraisal-mode cap proximity scoring weight and penalized rows far above the subject cap.
  - Added explicit cap parsing from request text and a The Villages subject cap anchor at 6.00%.
  - Changed one-shot appraisal workbook generation to run sold and on-market as independent passes so on-market listings no longer consume sold comp slots.
- Tests:
  - Extended `test/comps-bounded-output.test.mjs` for independent sold/on-market counts, field preservation, outlier/dedupe exclusion, subject cap, and weighted cap stats.
  - Added `test/mcp-comps-http-route.test.mjs` to exercise the real mounted `/api/comps` route and verify a one-shot request returns 200 instead of the prior ReferenceError.

## Verification

- `node --test test\comps-bounded-output.test.mjs test\comps-reconciliation.test.mjs test\mcp-comps-http-route.test.mjs`
- Result: 31 tests passing.

## Notes

- The code now returns a `secondary_market_range` count in metadata for excluded appraisal-mode sold candidates.
- The current workbook payload still uses the existing `sold` and `on_market` sheets. A distinct workbook section for secondary market-range sales would require template/service support if the generator does not already recognize such a sheet.
