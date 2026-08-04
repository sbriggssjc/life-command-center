# Prompt 33 MCP OAuth Root Mount Worklog

## Objective
Make the MCP OAuth discovery, dynamic client registration, authorization, and token endpoints reachable on the root Railway app (`tranquil-delight`) alongside `/mcp`, so Cowork and Copilot MCP connectors can complete OAuth registration instead of falling through to the SPA.

## Guardrails
- Keep the standalone MCP service working.
- Keep DCR permissive: accept registrations and return `LCC_API_KEY` as `client_secret`.
- Discovery metadata must advertise the tranquil-delight base URL when `MCP_BASE_URL` is set.
- Do not change bearer-token-only `/mcp` auth behavior for existing clients.

## Plan
- Inspect `mcp/server.js` and `server.js` mount order.
- Make OAuth routes explicitly route through `mountLccMcp` path prefixing.
- Add a regression test that mounts MCP on a root Express app with an SPA fallback and proves OAuth routes return JSON.
- Verify syntax and targeted tests.

## Changes
- Updated `mcp/server.js` so `/mcp`, OAuth discovery, `/register`, `/authorize`, and `/oauth/token` all use the `mountLccMcp` `prefixed()` route helper.
- Discovery metadata now builds advertised URLs through shared helpers:
  - `issuer` and `authorization_servers` use `MCP_BASE_URL` or request origin.
  - `resource`, `authorization_endpoint`, `token_endpoint`, and `registration_endpoint` include the mounted route prefix.
- Added `test/mcp-oauth-root-mount.test.mjs`, which mounts MCP before a simulated SPA fallback and verifies:
  - `GET /.well-known/oauth-authorization-server` returns JSON under the tranquil-delight base.
  - `GET /.well-known/oauth-protected-resource` returns the root `/mcp` resource.
  - `POST /register` returns a DCR client with `client_secret = LCC_API_KEY`.

## Verification
- `node --check mcp/server.js`
- `node --test test/mcp-oauth-root-mount.test.mjs`
- `node --test test/mcp-comps-http-route.test.mjs`

## Commit / Push
- Committed to `main`: `ef8cc6a6` (`Round 33: Mount MCP OAuth on root app`).
- Pushed `main` to `origin`.

## Live Verification
- `GET https://tranquil-delight-production-633f.up.railway.app/.well-known/oauth-authorization-server`
  - Returned `200` JSON.
  - `issuer`, `authorization_endpoint`, `token_endpoint`, and `registration_endpoint` all advertised the tranquil-delight base.
- `POST https://tranquil-delight-production-633f.up.railway.app/register`
  - Returned `201` JSON.
  - Returned a `client_id`, a non-empty `client_secret`, `client_secret_expires_at = 0`, and `token_endpoint_auth_method = client_secret_post`.
  - The secret value was intentionally not printed in verification output.
- `GET https://tranquil-delight-production-633f.up.railway.app/version`
  - Still returned `2a623aa2ba6f` after two polls, so Railway had not yet advanced to commit `ef8cc6a6` from this workspace.

## Deployment Notes
- Confirm Railway env on tranquil-delight includes:
  - `MCP_BASE_URL=https://tranquil-delight-production-633f.up.railway.app`
- Redeploy tranquil-delight after merge.
- After redeploy, verify live:
  - `GET /.well-known/oauth-authorization-server` returns JSON, not SPA HTML.
  - `POST /register` returns a client object with `client_secret` equal to `LCC_API_KEY`.
