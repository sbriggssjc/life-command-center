# SIDEBAR4-c — every sidebar Update is followed by a Re-run request from the side panel itself

Backlog: `SIDEBAR4-c`. Evidence was measured on LCC Opps on 2026-09-23, after Scott reloaded the extension to 1.0.55.

## Measured

SIDEBAR4 added `metadata._pipeline_run_log`, and 1.0.55 stamps `X-LCC-Request-Id` (a `crypto.randomUUID()`) on every `apiCall`.

- **Lewistown MT** (`920 NE Main St`):
  - `entities.patch` run, request `8a6e001c-b505-4f90-8207-81ec0e24a3f5`, requested 21:10:27.830 UTC.
  - `action.process_sidebar_extraction` run, request `79acf84d-d9c1-42f1-af69-b436eafbfae5`, requested **21:10:28.546** (0.7 s later), `coalesced: true`.
- The same PATCH → process pair, 0.5–1.0 s apart, shows on all 5 entities updated on 2026-09-22 (Ellijay GA, 2101 NW Hawthorne, Springfield OH, Hoffman Estates IL, Minden LA).
- A deliberate Re-run looks different. Yucca Valley CA: the process request came 10 minutes after the PATCH, `coalesced: false`.
- Both requests carry UUIDs, so both came from the side panel's `apiCall`. The only `process_sidebar_extraction` call site in the extension is the Re-run button's click handler (`extension/sidepanel.js` ~1689). No `.click()` or `dispatchEvent` exists in the extension.

**Leading hypothesis (verify, don't assume): a layout-shift misclick.**
1. The Update button (`#updateLccBtn`, rendered inside `loadPropertyTab` ~1644, wired in `wirePropertyActions` ~2523) changes its label from "Update LCC with CoStar Data" to "Updating…" on click.
2. The button shrinks, and the Re-run button appended next to it (~1666) slides under the cursor.
3. The second click of a double-click, or a quick confirm click, then lands on Re-run.

Separately: `2727 Washington Avenue, St. Louis` (`entities.post`, 21:45:30 UTC) carried a **non-UUID** id (`TqW_wvnlQ7eZ-8sCCYBc-A`, a Railway edge id). Some save path posts to `/api/entities` without going through `apiCall`: a content script (`content/rca.js` says it posts to the same endpoint), `background.js`, or a CREXi path. Find it.

## Ask

1. Confirm or refute the layout-shift hypothesis by reading the render/wire code. If a headless DOM check is feasible in the test harness, simulate a double-click.
2. Fix it without dropping real Re-runs:
   - While any property action is in flight, disable **all** sibling action buttons (Update, Save, Re-run, Verify).
   - Give the buttons a stable width, or keep the label length, so nothing moves under the cursor.
   - Keep the server's SIDEBAR4 coalescer as the backstop. Don't remove it.
3. Route the non-`apiCall` save path through `apiCall`, or give it the same `X-LCC-Request-Id` stamping, so every capture is traceable.
4. Bump the manifest version, since Scott must reload the extension.
5. Tests: a DOM-level test that a second click during an in-flight Update does not reach the Re-run handler, and a grep/AST guard that every extension `fetch` to `/api/entities` carries the request-id header. Include a mutation that turns each red.

## Do not touch

- The server-side single-flight (`serializeSidebarRun`) and the SIDEBAR4 unique index.

## Done means

- The backlog row `SIDEBAR4-c` is updated.
- After merge: Railway redeploy (both services), extension reload, then one Update. The run log should show a single run.
