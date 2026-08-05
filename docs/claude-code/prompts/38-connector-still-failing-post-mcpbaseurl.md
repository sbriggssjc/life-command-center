# Prompt 38 — LCC connector still errors after MCP_BASE_URL is set — deep-diagnose

## Why (2026-08-04)
Prompt 33 mounted the OAuth flow on tranquil-delight (`ef8cc6a6`, live-verified) and Scott confirms
`MCP_BASE_URL` is set on the service, yet adding the connector in Cowork still shows "error connecting to the
server." So the remaining fault is past both the code mount and the base-URL env.

## Task — instrument and pin the exact failing step
1. Capture the real client flow against `https://tranquil-delight-production-633f.up.railway.app`:
   - `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` — confirm 200 JSON
     with issuer/endpoints all under the tranquil-delight https origin (NOT the SPA, NOT http, NOT an internal host).
   - `POST /register` (DCR) — confirm 201 + client_id/secret.
   - `/authorize` → redirect → `/oauth/token` — confirm a token is issued.
   - `POST /mcp` `initialize` with the bearer — confirm 200 and a protocol version the client accepts.
2. Check the failure modes that survive a correct MCP_BASE_URL: (a) `authorization_servers` array in the
   protected-resource doc not matching the issuer; (b) redirect_uri/allowed-origin rejection for Cowork's
   callback; (c) `initialize` negotiating a protocolVersion the connector rejects; (d) CORS/preflight on the
   well-known or /register from the app origin; (e) trailing-slash / path-prefix mismatch between the advertised
   endpoints and where they're actually mounted.
3. Report the single failing hop with the exact request/response, and the one-line fix.

## Verify
- The Cowork **LCC Deal Intelligence** connector registers and connects without error; `query_comps` is callable.
- Document the true root cause in the OAuth worklog so it's not re-diagnosed.
