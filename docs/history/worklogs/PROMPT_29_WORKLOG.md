# Prompt 29 Worklog - Comps Pull and Export Polish

## Objective

Polish comps pull/export logic using existing DB fields only: collapse duplicate sale events, map listing/export fields that already exist, normalize bumps/options display, and keep appraisal primary rows within a subject-relative cap band while excluding obvious economic errors.

## Instructions / Constraints

- Follow `CLAUDE.md`, `LCC-OS.md`, `docs/os/README.md`, `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`, and `.github/AI_INSTRUCTIONS.md`.
- Keep `mcp/comps-tools.js` as the shared engine for MCP, ChatGPT HTTP, and Copilot routes.
- Do not fabricate missing data. Leave truly absent fields blank / "Not on file" at presentation layers.
- This prompt is export/pull logic only; source-coverage remediation belongs to prompt 30.

## Plan

- Strengthen sale-event dedupe around property IDs, sale dates, buyer, price, and portfolio/allocation notes.
- Map on-market, DOM inputs, initial/last/current price and cap fields through workbook rows for both Sold and On Market sheets.
- Normalize bumps and renewal options consistently in rows that feed workbook export.
- Replace coarse appraisal high-cap handling with configurable subject-relative primary cap band and explicit low/high error exclusions.
- Verify with focused node tests.

## Progress

- Read project instructions and comps diagnosis.
- Located shared implementation in `mcp/comps-tools.js` and existing tests in `test/comps-bounded-output.test.mjs` / `test/comps-reconciliation.test.mjs`.
- Patched sale-event dedupe to use property ID + sale month + buyer/price/portfolio allocation fingerprints while preserving genuine repeat sales.
- Patched appraisal mode to keep primary sold comps in a configurable subject-relative cap band, count real out-of-band comps as secondary, and exclude obvious low/high cap or broken price/NOI rows.
- Patched workbook row mapping for sold/on-market listing dates, initial/current/last price and cap fields, and normalized bumps/options.
- Added cap aliases to the workbook generator so mapped cap values are written when the matching template column is not formula-protected.

## Verification

- `node --test test\comps-bounded-output.test.mjs test\comps-reconciliation.test.mjs test\mcp-comps-http-route.test.mjs`
  - Result: 36 tests passing.
- `.venv\Scripts\python.exe -m py_compile bov-generator\comps_generator.py`
  - Result: passed.

## Notes

- Tests cover Pembroke-style duplicate collapse, repeat-sale appraisal selection, sold on-market date and DOM input mapping, on-market field population, 19% listing exclusion, normalized `2%/yr` and `(2) 5-yr` display, and a 6.00% subject primary cap band of 5.50%-6.75%.
- The code still does not fabricate missing source fields; prompt 30 remains the source-coverage program.
