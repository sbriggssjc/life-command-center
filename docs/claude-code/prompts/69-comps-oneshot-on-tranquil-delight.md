# Prompt 69 — Add one-shot `request` mode to the tranquil-delight comps workbook route (fix Copilot GenerateComps 400)

## Why (Copilot Phase 1, 2026-08-07 — comps workbook)

With comps auth fixed (prompt 68), Copilot's `GenerateComps` now reaches the server but returns
**`ConnectorActionBadRequest` (400)** for a one-shot request like *"build the dialysis comps workbook for the
appraiser at 1050 Old Camp Rd, The Villages, FL."*

Root cause: there are **two implementations** of the comps workbook route.
- The **standalone MCP** registers its own `/api/comps` handler that supports **one-shot mode** — pass `request`,
  the server runs synthesize and builds the Briggs workbook server-side (logic in `mcp/comps-tools.js`; the MCP
  `generate_comps` tool at `mcp/server.js:684` uses it). This is why `generate_comps` works through the MCP.
- **tranquil-delight** (`server.js`) routes `/api/comps` — and now `/api/copilot/comps/generate-comps` (prompt 68) —
  to **`api/comps.js`**, which is **row-mode only**: it reads `payload.comp_type` and requires
  `sold`/`on_market` (sales) or `comps` (lease) rows, and returns **400** otherwise
  (`api/comps.js` ~lines 51–60: *"Payload must include comp_type"* / *"No comp rows supplied"*). It has no
  one-shot `request` path.

So the Copilot connector (which hits tranquil-delight) sends `{ request: "build the workbook…" }` with no rows →
`api/comps.js` 400s. This is also the pre-existing failing test `test/mcp-comps-http-route.test.mjs` (the HTTP comps
route returns 400 in the sandbox).

## Task

Give tranquil-delight's comps workbook handler the **same one-shot `request` mode** the MCP already has, reusing the
**shared renderer** — do NOT fork a second workbook builder (canon: "ONE renderer — the only acceptable comps
workbook comes from the shared generate_comps/populate_comps path into the Briggs template").

1. In `api/comps.js` (`compsHandler`): before the row-mode validation that 400s, add a **one-shot branch** — when
   `payload.request` (or `body.request`) is present and no explicit rows are supplied:
   - Run the same synthesize-then-build path the MCP uses. Prefer importing/reusing the existing shared one-shot
     implementation in `mcp/comps-tools.js` (the function that synthesizes a ranked set, maps to `template_comps`,
     and returns the workbook + `cap_rate_range` — around `mcp/comps-tools.js:2432–2491`) so tranquil-delight and the
     MCP produce a **byte-identical** workbook. If a direct import across the `api/` ↔ `mcp/` trees isn't clean,
     extract the one-shot core into a shared module both import — but keep it a single implementation.
   - Appraisal defaults match the MCP one-shot (`include_on_market` and `include_unreliable_noi` default true in
     appraisal mode; the engine applies the appraisal cap discipline on the DISPLAYED rows).
   - Then build the workbook through the EXISTING `api/comps.js` path that posts template rows to the BOV service
     (`X-API-Key: BOV_API_KEY`) and returns `{ status, filename, download_url, … }`. Return only the download link +
     compact counts (no raw rows through the connector), per canon.
   - Dialysis is detected from the request text by the engine (as in the MCP one-shot) — no need for the caller to
     pass `vertical`.
2. Keep **row-mode exactly as-is** (structured `comp_type` + rows still builds directly, no synthesize) so ChatGPT's
   and any existing row-mode callers are unchanged.
3. Auth unchanged from prompt 68: the handler already calls `authenticate()`; one-shot from Copilot arrives on
   `/api/copilot/comps/generate-comps` (passthrough), ChatGPT/MCP arrive on the flat `/api/comps` route with a key.
4. `BOV_API_KEY` stays server-side and required for the outbound BOV build (unchanged).
5. **Tests:** turn the pre-existing `test/mcp-comps-http-route.test.mjs` 400 into a passing assertion — a one-shot
   `{ request: "dialysis sales comps …" }` POST returns 200 with a `download_url` (mock the BOV call as the suite
   does elsewhere). Add a guard that row-mode still works and that a request with neither `request` nor rows still
   400s. Confirm the workbook rows come from the shared renderer (same `template_comps` shape).

## Verify

- On Copilot: *"Build the dialysis comps workbook for the appraiser on the DaVita at 1050 Old Camp Rd, The Villages,
  FL"* → `GenerateComps` returns a **download link + compact counts**, no `ConnectorActionBadRequest`. The set is the
  disciplined appraiser set (subject hydrates to property_id 31964 @ 6.75% because the street address is present; all
  displayed caps ≤ subject + 35 bps; no sub-4.5% / no-price rows) — matching the known-good ~17 sold + 12 on-market
  baseline.
- MCP `generate_comps` one-shot and ChatGPT comps are unchanged (same renderer).
- Row-mode `generate_comps` still builds directly.
- `test/mcp-comps-http-route.test.mjs` now passes; guardrail + auth tests still green. Code-only → **redeploy
  `tranquil-delight` AND the standalone MCP**. No connector re-import needed (paths/operationIds unchanged from
  prompt 68).

## Follow-ups (separate, not this prompt)

- `SynthesizeComps` *display*: steer appraisal-flavored plain-language requests to `GenerateComps`, and force
  verbatim render of the engine `markdown` (or a compact markdown-first payload) so the agent can't re-render the raw
  185-row support array with above-subject caps.
- Address-less subject hydration: make "the DaVita in The Villages, FL" (no street number) resolve to property_id
  31964 instead of a place-default 6% cap.
