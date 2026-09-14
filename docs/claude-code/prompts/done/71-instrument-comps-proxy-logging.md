# Prompt 71 — Instrument the comps workbook path so the failing hop is visible in logs (diagnostic)

## Why (Copilot Phase 1, 2026-08-07 — `ConnectorRequestFailure` on GenerateComps, cause not yet visible)

Copilot's `GenerateComps` one-shot fails with `ConnectorRequestFailure` even with the service stable and on the
merged prompt-70 code. The chain is Copilot → tranquil-delight `api/comps.js` one-shot **proxy** →
`${MCP_BASE}/api/comps` (engine) → `runGenerateCompsFromRequest` → BOV build. The workbook builds fine when called
directly (MCP tool one-shot ≈ 4s, clean 17+12 set), so the failure is somewhere on this proxied path.

The blocker to diagnosing: **neither the proxy nor the engine `/api/comps` handler logs anything** — both just
return a 502 body on error, so no exported log shows which hop failed or how long it took. This prompt adds
lightweight logging (no behavior change) so ONE more test produces a definitive line.

## Task — logging only, no behavior change

1. **`api/comps.js`** — instrument the one-shot proxy branch (the `if (request && !hasRows)` block that fetches
   `${MCP_BASE}/api/comps`):
   - Before the fetch: `console.log('[comps-proxy] one-shot → POST', `${MCP_BASE}/api/comps`, 'reqLen=' + request.length)`.
   - Capture `const t0 = Date.now()` before the fetch. After it resolves:
     `console.log('[comps-proxy] upstream status=' + upstream.status + ' in ' + (Date.now()-t0) + 'ms')`.
   - On upstream non-2xx (before returning 502): `console.error('[comps-proxy] upstream FAILED status=' +
     upstream.status + ' detail=' + text.slice(0,300))`.
   - In the `catch` around the fetch (covers the 180s `AbortSignal.timeout` / network errors):
     `console.error('[comps-proxy] fetch error after ' + (Date.now()-t0) + 'ms: ' + (e?.name||'') + ' ' + (e?.message||e))`.
   - Also log the MCP_BASE resolution once at module load or first use so we can confirm the target:
     `console.log('[comps-proxy] MCP_BASE=' + MCP_BASE)`.
2. **`mcp/server.js`** — instrument the `/api/comps` POST handler (the inline `app.post(prefixed("/api/comps"), …)`
   around line 2049):
   - On entry: `console.log('[api/comps] hit; hasRequest=' + !!String(payload.request||'').trim() + ' hasRows=' +
     (Array.isArray(payload.sold)||Array.isArray(payload.on_market)||Array.isArray(payload.comps)))`.
   - Wrap the one-shot `runGenerateCompsFromRequest` call with timing: on success
     `console.log('[api/comps] one-shot ok in ' + ms + 'ms; error=' + !!result.error)`, and in the outer `catch`
     `console.error('[api/comps] one-shot threw after ' + ms + 'ms: ' + (e?.message||e))`.
   - (Auth failures surface as the connector/`authenticate` returning 401 before this handler — that's fine, the
     proxy's `upstream status=401` line will show it. No change to auth.)
3. No other changes. Do NOT alter the proxy target, auth, timeouts, or the row-mode path. Keep it purely additive
   logging. Existing tests stay green (they don't assert on console output).

## Verify

- Code compiles; existing comps/route/auth tests still pass.
- Code-only → **redeploy `tranquil-delight` AND the engine (life-command-center-production / standalone MCP)** so
  both sets of logs are live.
- After redeploy, retest on Copilot: *"Build the dialysis comps workbook for the appraiser on the DaVita at 1050 Old
  Camp Rd, The Villages, FL."* Then pull logs and grep:
  - **tranquil-delight** for `[comps-proxy]` — shows `MCP_BASE`, the upstream status, and elapsed ms (or a fetch
    error / timeout after Nms).
  - **engine** for `[api/comps]` — shows whether the engine received the proxied call and whether the one-shot ran,
    succeeded, or threw (and how long).
- Those two lines pinpoint the hop: proxy never fired / wrong MCP_BASE / upstream 401 (auth) / upstream 5xx (engine
  threw) / timeout (elapsed near Copilot's limit). Report the lines back and the real fix follows directly.
