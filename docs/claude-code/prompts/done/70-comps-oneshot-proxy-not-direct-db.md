# Prompt 70 — Fix GenerateComps one-shot on tranquil-delight: proxy to the engine, don't hit the DB directly

## Why (Copilot Phase 1, 2026-08-07 — `ConnectorRequestFailure` on the workbook)

With the roster fixed, Copilot now correctly routes "build the comps workbook" to `GenerateComps`, but it returns
**`ConnectorRequestFailure`** — a 502 from tranquil-delight's one-shot handler.

Root cause is an architecture mismatch introduced by prompt 69. **tranquil-delight is a proxy service — it has no
direct database access.** Its comps routes forward to the engine service:
- `api/query-comps.js` (`SynthesizeComps` / `QueryComps`) **proxies** to `MCP_BASE` (`GOV_API_URL`, default
  `https://life-command-center-production.up.railway.app`), which owns `comps-tools.js` and the DB. That's why
  `SynthesizeComps` works on Copilot.
- `api/comps.js` row-mode proxies template rows to the BOV builder (`BOV_SERVICE_URL` = pacific-love). It even
  documents itself as "the WORKBOOK generator **proxy**."

But prompt 69's **one-shot branch** in `api/comps.js` calls `runGenerateCompsFromRequest(payload, { govQuery,
diaQuery }, postCompsToBov)` with **direct DB adapters** (`diaQuery`/`govQuery` → `api/_shared/domain-db.js::
domainQuery`, which needs `DIA_SUPABASE_URL` / `GOV_SUPABASE_URL`). tranquil-delight doesn't have those, so
`domain-db.js` returns 503 *"<domain> database not configured"* → `runGenerateCompsFromRequest` throws →
`res.status(502) 'Could not build comps workbook: …'`. The prompt-69 test passed only because it **mocked** the
domain queries, hiding the missing-env reality.

Evidence the engine + renderer + BOV build are all fine: the **MCP engine one-shot works perfectly** — a one-shot
`generate_comps` for *"dialysis sales comps … 1050 Old Camp Rd, The Villages, FL"* returns the clean appraiser
workbook (17 sold + 12 on-market; cap range 5.29%–7.08%; median 6.13%; wavg 6.12%; subject hydrated to property_id
31964 @ **6.75%**, `_hydrated:true`, `_cap_default:false`). Only tranquil-delight's direct-DB one-shot fails.

## Task

Make `api/comps.js`'s one-shot `request` branch a **proxy to the engine's one-shot** — the same pattern
`api/query-comps.js` already uses — instead of hitting the DB directly. This restores tranquil-delight's proxy role,
keeps a single renderer (on the engine), and needs no DB env on tranquil-delight.

1. In `api/comps.js`, replace the one-shot branch body: when a natural-language `request` is present and no rows,
   **forward the request to `${MCP_BASE}/api/comps`** (the engine's working one-shot; `MCP_BASE` from `GOV_API_URL`,
   same base `api/query-comps.js` uses), and return the engine's JSON response (`{ status, filename, download_url,
   counts, cap_rate_range, … }`) verbatim. Mirror `api/query-comps.js`'s upstream call exactly:
   - same `MCP_BASE` resolution,
   - same upstream auth headers it sends to the engine (reuse that helper / header construction — do not invent a new
     auth scheme),
   - a generous timeout (the engine synthesizes + builds; keep the existing 180s `AbortSignal.timeout`),
   - pass the caller's `request` (and any optional one-shot fields like `include_on_market` /
     `include_unreliable_noi` / `limit` / `name` / `client`) straight through.
   On upstream non-2xx or non-JSON, surface a 502 with the engine's status/detail (like the row-mode error paths at
   the bottom of the file already do).
2. **Remove** the now-unused direct-DB pieces from the one-shot path: the `diaQuery`/`govQuery` adapters and the
   `runGenerateCompsFromRequest(...)` call in `api/comps.js` (and the `domain-db.js` import if nothing else in the
   file uses it). Do NOT change `mcp/comps-tools.js` — the engine keeps `runGenerateCompsFromRequest` and remains the
   one true renderer; tranquil-delight simply proxies to it.
3. **Row-mode stays unchanged** — structured `comp_type` + rows still proxy directly to `BOV_SERVICE_URL`
   (pacific-love) as today. Inbound auth stays on `authenticate()` (prompt 68). `BOV_API_KEY` is still used only by
   row-mode's direct BOV build; the one-shot no longer needs it on tranquil-delight (the engine holds it).
4. **Tests:** rewrite the one-shot test to assert the **proxy** behavior — a one-shot `{ request: … }` POST forwards
   to `${MCP_BASE}/api/comps` (mock that upstream) and returns its `download_url`; on upstream 5xx it returns 502.
   Keep the row-mode-still-builds and neither-request-nor-rows→400 assertions. Remove the mock of `domain-db`/
   `runGenerateCompsFromRequest` in this handler's test (no longer that path).

## Verify

- On Copilot: *"Build the dialysis comps workbook for the appraiser on the DaVita at 1050 Old Camp Rd, The Villages,
  FL"* → `GenerateComps` returns a **download link + counts** (17 sold + 12 on-market, caps 5.29%–7.08%, subject
  hydrated @ 6.75%), **no `ConnectorRequestFailure`** — matching the MCP one-shot output byte-for-byte (same engine).
- `SynthesizeComps` / `QueryComps` unchanged (already proxy to the engine). Row-mode `generate_comps` unchanged.
- MCP `generate_comps` and ChatGPT comps unchanged.
- Tests green (one-shot proxy, row-mode direct, 400 guard). Code-only → **redeploy `tranquil-delight`** (the standalone
  MCP already works; redeploy it too only for parity). **No connector re-import** (paths/operationIds unchanged).

## Note

This also means tranquil-delight does NOT need `DIA_SUPABASE_URL` / `GOV_SUPABASE_URL` — comps data stays owned by the
engine service, consistent with `SynthesizeComps`/`QueryComps`. (Setting those DB vars on tranquil-delight would be a
config-only stopgap, but it spreads DB credentials to the proxy tier and may still miss Salesforce-staged comps the
engine has — the proxy fix is the correct, complete one.)
