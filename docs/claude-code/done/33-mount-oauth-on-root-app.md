# Prompt 33 — Mount the MCP OAuth flow on the root app (fixes Cowork/Copilot connector "couldn't register")

## Root cause (found 2026-08-04)
The OAuth discovery + `/register` + `/authorize` + `/oauth/token` routes are registered on the standalone `app` in
`mcp/server.js` (~lines 1725-1822) but are **outside `mountLccMcp`** (line 1481). So when the root `server.js` calls
`mountLccMcp(app)`, `/mcp` + read routes mount on **tranquil-delight** but the OAuth endpoints do NOT — they fall
through to the SPA. Cowork's plugin connector (and Copilot's MCP) do OAuth (DCR): they hit `/register` on
tranquil-delight, get SPA/404, and fail with "Couldn't register with lcc's sign-in service."

## Fix
1. Move (or duplicate) the OAuth discovery (`/.well-known/oauth-protected-resource`,
   `/.well-known/oauth-authorization-server`) + `/register` + `/authorize` + `/oauth/token` route registrations
   INTO `mountLccMcp(app, …)` so they mount on the root app alongside `/mcp`. Keep the standalone service working.
2. Ensure **`MCP_BASE_URL=https://tranquil-delight-production-633f.up.railway.app`** on the tranquil-delight service
   so the discovery metadata advertises the correct issuer/endpoints (it's read at 1726/1736).
3. The DCR stays permissive (accepts any registration, returns `LCC_API_KEY` as client_secret) — unchanged.

## Verify
- `GET /.well-known/oauth-authorization-server` on tranquil-delight → JSON (issuer + authorize/token/register all
  under the tranquil-delight base), NOT the SPA.
- `POST /register` → a client object with `client_secret` = `LCC_API_KEY`.
- The Cowork **LCC Deal Intelligence** plugin connector registers without the OAuth error; Copilot MCP too.
- Redeploy tranquil-delight after.

## Note
This also retro-fixes the earlier Copilot MCP OAuth path. Bearer-header-only clients (Claude Code CLI) were
unaffected; Cowork/Copilot require the OAuth flow to be reachable.
