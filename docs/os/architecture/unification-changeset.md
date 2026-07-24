# MCP Unification — ready-to-apply changeset + verify-first cutover

> Target: `tranquil-delight` serves the web app **plus** `/mcp` **plus** the bounded AI read/comps routes —
> one base URL for Claude, ChatGPT, Copilot. Single implementation (no second surface). **Apply, test on a
> preview, then cut over per §7. Do not flip production without the curl checks.** Rollback in §8.
> Grounded in the verified code review (`mcp-server-unification.md`). CANON: this is the canonical unification
> spec; the SharePoint handoff is its source.

## Design decisions (capability-preserving)
1. **Single implementation.** Extract the MCP wiring into `mountLccMcp(app)` and call it from BOTH root
   `server.js` (unified) and `mcp/server.js` (standby, identical behavior) — no duplicated route logic.
2. **Namespaced AI read surface.** The bounded HTTP read routes mount under **`/api/ai/*`** on root so they
   never collide with the web app's existing `/api/*` routes. Critically, the web app keeps
   `/api/daily-briefing` (admin, **full**); ChatGPT/Copilot use `/api/ai/daily-briefing` (**bounded**). No
   briefing detail is lost for the app.
3. **Flag-gated cutover.** Root mounts MCP only when `LCC_MOUNT_MCP=1`. Deploying the changed code with the
   flag **off** is a no-op — zero production risk until you enable it on a preview and verify.
4. **Standby stays working** until §9. The live Claude connector keeps functioning throughout.

## 1. `mcp/server.js` — extract a mount function, guard the listener
- Wrap the route registrations (the `/mcp` auth + POST/GET/DELETE, the OAuth endpoints `/.well-known/*`,
  `/register`, `/authorize`, `/oauth/token`, `/health`, `/`, the comps HTTP routes, and the
  `READ_HTTP_ROUTES` loop — currently ~lines 1395–1812) inside:
  ```js
  export function mountLccMcp(app, { apiPrefix = '' } = {}) {
    // ...move every `app.<verb>(...)` route registration here, unchanged...
    // For the AI read/comps HTTP routes, prefix the path so callers can namespace:
    //   app.post(`${apiPrefix}/api/query-comps`, authenticate, __compsRoutes.queryComps)
    //   for (const [p, tool] of Object.entries(READ_HTTP_ROUTES))
    //     app.post(`${apiPrefix}${p}`, authenticate, makeReadHttpRoute(tool));
    // /mcp, OAuth, /health, / stay unprefixed.
  }
  ```
  Keep ALL helpers/state (`TOOL_HANDLERS`, `authenticate`, `makeReadHttpRoute`, `authCodes`, env reads, etc.)
  module-level, above the function — do not move them.
- Replace the bare `app.listen(...)` at the bottom with a guarded standalone entry so importing the module
  does NOT start a server:
  ```js
  const isStandalone = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
  if (isStandalone) {
    app.use(express.json({ limit: '30mb' }));
    app.use(cors());
    mountLccMcp(app);                 // standby: canonical paths, no prefix → identical behavior
    app.listen(PORT, () => console.log(`[MCP] standalone on ${PORT}`));
  }
  ```
  (The standby keeps its exact current routes/behavior — verify with the smoke test in §6.)

## 2. Root `server.js` — mount MCP before the static/SPA/404 block
Insert immediately after the primary handler routes (~line 413, before `/health`), so MCP routes are matched
before `express.static`, the `/api/*` 404 (line 518), and the SPA fallback (line 527):
```js
// ── Unified MCP surface (flag-gated; see docs/os/architecture/unification-changeset.md) ──
if (process.env.LCC_MOUNT_MCP === '1') {
  const { mountLccMcp } = await import('./mcp/server.js');
  mountLccMcp(app, { apiPrefix: '/ai' });   // AI read/comps → /api/ai/*, plus /mcp + OAuth
  console.log('[LCC] MCP surface mounted (/mcp + /api/ai/*)');
}
```
(Root already applies `express.json({limit:'30mb'})` + `cors` globally, so the mount must NOT re-add them —
it doesn't; §1's mount only registers routes.) The web app's existing `/api/daily-briefing` (line 147, full)
is untouched; the bounded one is now `/api/ai/daily-briefing`.

> Note: top-level `await import` requires the file to be an ES module — it is (`"type":"module"`). If your Node
> flags top-level await in the entry, wrap the mount in an async IIFE.

## 3. `package.json` (root) — add the MCP deps
Merge into `dependencies`: `"@modelcontextprotocol/sdk": "latest"` (only if `mcp/server.js` imports it;
the JSON-RPC handler is hand-rolled — grep first and omit if unused) and `"node-fetch": "^3.3.2"` (only if
the shared modules import it rather than global `fetch`; Node ≥20 has global fetch — prefer omitting). Keep
`express`/`cors` (already present). **Verify with `npm ci` locally before deploy.**

## 4. Env vars on `tranquil-delight` (copy from the MCP service)
`OPS_SUPABASE_URL/KEY`, `GOV_SUPABASE_URL/KEY`, `DIA_SUPABASE_URL/KEY` (if used), `LCC_PRIMARY_WORKSPACE_ID`,
`LCC_API_KEY`, `MCP_BASE_URL` (= `https://tranquil-delight-production-633f.up.railway.app`), plus any
`LCC_API_BASE`/OAuth settings. Set `LCC_MOUNT_MCP=1` **only after** the smoke test.

## 5. `docs/comps-rollout/lcc-openapi.yaml` — point at one URL, namespace the read paths
- `servers[0].url: https://tranquil-delight-production-633f.up.railway.app`
- Prefix the 7 read operations' paths with `/api/ai` (e.g. `getDailyBriefing` → `/api/ai/daily-briefing`,
  `searchEntities` → `/api/ai/search-entities`, …). Comps (`queryComps`/`synthesizeComps`) already resolve at
  `/api/query-comps`/`/api/synthesize-comps` on root — keep those, or move them under `/api/ai` too for
  consistency (then also expose them via the prefixed mount). Re-import into ChatGPT Actions + the Copilot
  connector. Claude connector = same base + `/mcp`.

## 6. Smoke test the standby refactor (before any prod change)
On the MCP service (or locally `node mcp/server.js`): `GET /health` → rich shape; `POST /mcp` initialize →
200; a `tools/call` for `get_pipeline_health` → data. Confirms §1 didn't change standby behavior.

## 7. Cutover (guided; run the curls, don't assume)
1. Deploy the changed code to `tranquil-delight` with `LCC_MOUNT_MCP` **unset** → verify the web app + existing
   `/api/*` are unchanged (nothing should differ; the mount is off).
2. Set env vars (§4), then `LCC_MOUNT_MCP=1`, redeploy.
3. Verify on `tranquil-delight`:
   - `GET /health` → still `{status:"ok"}` (root health; the MCP `/health` is only on the standby's `/` — root
     keeps its own). `GET /mcp` → 405 (not 404). `POST /mcp` initialize → 200 or 401 (not "Cannot POST /mcp").
   - Each `POST /api/ai/<op>` → 200 and serialized length **< 45,000**; `/api/ai/daily-briefing` →
     `source:'briefing_intel_snapshot'`.
   - `POST /api/daily-briefing` (web app) → still the **full** admin briefing (unchanged).
4. Re-import `lcc-openapi.yaml` (§5) → ChatGPT "today's briefing" returns a real briefing, **no
   ResponseTooLargeError**; all 9 ops resolve.
5. Point the Claude connector at `tranquil-delight/mcp`; confirm full (unbounded) payloads. (Keep the standby
   connector until this passes.)

## 8. Rollback
Set `LCC_MOUNT_MCP=0` (or unset) and redeploy — instantly reverts root to web-app-only; ChatGPT/Copilot
temporarily repoint to the standby MCP domain (stopgap) while diagnosing. The standby was never touched.

## 9. Retire the second server (only after §7 passes for days)
Point `GOV_API_URL`/any `MCP_BASE_URL` consumers at `tranquil-delight`; move the Claude connector; then stop
the standby Railway service (or keep as warm standby but delete it from the docs as a *required* URL). Update
`MULTI_AI_DEPLOYMENT_CHECKLIST.md`, `CONTEXT_ROUTER.md`, `Capability_Access_Matrix.md`,
`AI_ECOSYSTEM_GUIDE_v2.md` (REGISTRY §F) so no doc names two servers again.

## Capability checklist (nothing lost)
Web-app full briefing ✓ (untouched) · comps ✓ (already live) · 6 read ops ✓ (now on root, bounded) · `/mcp`
for Claude ✓ · OAuth discovery ✓ · bounded briefing for ChatGPT ✓ · one base URL ✓ · single implementation ✓.
