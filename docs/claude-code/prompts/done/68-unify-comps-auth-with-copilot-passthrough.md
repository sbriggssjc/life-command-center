# Prompt 68 — Fix comps on Copilot: route comps through the same auth path as every other connector tool

## Why (Copilot Phase 1 smoke test, 2026-08-07)

On the Copilot LCC Deal Agent, briefing and queue work but **comps fail with `ConnectorAuthorizationError`**. Root
cause is an auth-model split between two sets of routes:

- The working tools (briefing, queue, etc.) hit `/api/copilot/{category}/:action`, which runs `operationsHandler` →
  the shared `authenticate()` (`api/_shared/auth.js`). That function has a **Copilot M365 passthrough**: when a
  request carries `req.query._copilot_path` it is allowed through **without validating `LCC_API_KEY`** (auth is
  trusted at the M365 layer, returns a `_copilot_plugin` user). So these tools succeed regardless of the
  connection's credential — they never check it.
- The comps tools hit **flat routes** — `/api/synthesize-comps` and `/api/query-comps` (`api/query-comps.js`,
  `queryCompsHandler`) and `/api/comps` (`api/comps.js`, `compsHandler`). Those handlers use a **bespoke strict
  gate**: `providedKey !== LCC_API_KEY → 401`. They are the ONLY tools that actually validate the connection's
  credential — and the Copilot connection isn't sending a matching `LCC_API_KEY`, so they 401 → surfaced as
  `ConnectorAuthorizationError`.

Comps is the odd one out: it depends on a key the other 19 tools don't. The fix is to put the Copilot comps calls on
the **same passthrough auth** as the rest of the connector, while keeping the flat routes **keyed** for the ChatGPT
and MCP surfaces (which send a real `LCC_API_KEY` and must stay authenticated).

## Task

1. **Add copilot-namespaced comps routes** in `server.js` (same pattern as the other `/api/copilot/{category}/:action`
   routes — set `_copilot_path` so `authenticate()`'s passthrough applies), delegating to the existing comps
   handlers. Preserve however `queryCompsHandler` distinguishes synthesize vs query today (it's mounted at BOTH
   `/api/synthesize-comps` and `/api/query-comps` — replicate that same signal on the namespaced routes):
   - `POST /api/copilot/comps/synthesize-comps` → `_copilot_path='synthesize-comps'` → `queryCompsHandler` (synthesize mode)
   - `POST /api/copilot/comps/query-comps`     → `_copilot_path='query-comps'`     → `queryCompsHandler` (query mode)
   - `POST /api/copilot/comps/generate-comps`  → `_copilot_path='generate-comps'`  → `compsHandler`
   Leave the existing flat routes (`/api/synthesize-comps`, `/api/query-comps`, `/api/comps`) mounted and unchanged.

2. **Switch the comps handlers to the shared `authenticate()`** (`api/query-comps.js`, `api/comps.js`): replace the
   inline `providedKey !== LCC_API_KEY → 401` gate with `const user = await authenticate(req, res); if (!user) return;`
   (the same call `operationsHandler` uses). Net effect:
   - Copilot-namespaced call (has `_copilot_path`, no valid key) → passthrough → **allowed** (same as briefing/queue).
   - ChatGPT / MCP on the flat routes (send a valid `LCC_API_KEY` via `Authorization: Bearer` or `X-LCC-Key`) →
     `authenticate()` accepts → **allowed**, unchanged.
   - Anonymous flat-route call in production → still `401` (no security downgrade on the keyed routes).
   For `comps.js`, keep `BOV_API_KEY` exactly as-is — it stays entirely server-side for the outbound call to the BOV
   service; this change is only about the INBOUND caller auth.
   While here, **harden the bearer parse** so a doubled prefix can't bite: strip a repeated leading `Bearer ` (e.g.
   `^(Bearer\s+)+`) wherever the handlers read the token, in case a connection value was entered as `Bearer <key>`
   under a scheme that also prepends `Bearer `.

3. **Point the v2 (Copilot) spec's comps ops at the namespaced paths** in `generateSwagger2Spec`
   (`api/_shared/action-schemas.js`): `SynthesizeComps` → `/api/copilot/comps/synthesize-comps`, `QueryComps` →
   `/api/copilot/comps/query-comps`, `GenerateComps` → `/api/copilot/comps/generate-comps`. Keep the operationIds,
   summaries, and input/output schemas identical (so the connector's operation identities don't change — only their
   paths). **Do NOT touch** `generateChatGptSpec` or the flat comps route registrations — ChatGPT and MCP keep using
   the keyed flat routes.

4. **Tests**: extend the v2-slim guardrail test so the three comps ops now resolve under `/api/copilot/comps/*`
   (still present, still unique operationIds, still no dispatch gateway / no `/compat/`). Add/adjust a test that a
   copilot-namespaced comps request (has `_copilot_path`, no key) authenticates via the passthrough, and that a flat
   comps request with no credentials still 401s in production. Confirm the ChatGPT curated spec's comps ops are
   unchanged (flat paths).

## Verify

- On Copilot: `SynthesizeComps`, `QueryComps`, and `GenerateComps` return data (ranked comp set / workbook link) with
  **no `ConnectorAuthorizationError`**.
- ChatGPT and the MCP comps tools are unchanged and still work (they send a real `LCC_API_KEY` to the flat routes).
- Guardrail + auth tests pass. Code-only → **redeploy `tranquil-delight` AND the standalone MCP**. Then the connector
  needs one swagger update (comps op paths changed; operationIds are the same, so the agent's comps tools rebind —
  no re-add) + republish.

## Faster alternative to try first (no deploy)

Because the working tools ride the passthrough, we never confirmed the connection's key is valid. If the **LCC
Intelligence connection is API-Key auth**, check its stored value for a **doubled `Bearer`** (entering `Bearer <key>`
under a scheme that also prepends `Bearer ` yields `Bearer Bearer <key>`, which the strict gate rejects while the
passthrough ignores). Correcting the connection value to the plain current `LCC_API_KEY` may fix comps immediately
with no redeploy. Land prompt 68 regardless — it removes comps' dependence on a credential the other 19 tools don't
need, and hardens the parse.
