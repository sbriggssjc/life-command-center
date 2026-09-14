# Prompt 38 — LCC connector still errors after MCP_BASE_URL is set

## Symptom
Prompt 33 mounted the OAuth flow on tranquil-delight (`ef8cc6a6`, live-verified) and `MCP_BASE_URL`
is set on the Railway service, yet adding the **LCC Deal Intelligence** connector in Cowork still
shows *"error connecting to the server."* The fault is past both the code mount and the base-URL env.

## How this was diagnosed
The sandbox egress policy blocks the tranquil-delight Railway host (proxy `403` to CONNECT — an org
policy denial, not routed around), so the live URL could not be curled from here. Instead the **exact
Cowork/Claude OAuth client flow was replayed locally against the real `mcp/server.js`** (mounted on an
Express app in front of an SPA catch-all, mirroring the root `server.js`), with `MCP_BASE_URL` set to
the tranquil-delight origin. Every hop the task lists was exercised.

### Result — the happy path already works
| Hop | Result |
|---|---|
| `GET /.well-known/oauth-protected-resource` | 200 JSON, `authorization_servers` = issuer ✓ |
| `GET /.well-known/oauth-authorization-server` | 200 JSON, all endpoints under the tranquil-delight https origin ✓ |
| issuer ↔ authorization_servers match | ✓ (both `https://tranquil-delight-production-633f.up.railway.app`) |
| `POST /register` (DCR) | 201 + `client_id`/`client_secret` ✓ |
| `GET /authorize` → 302 redirect with `code` + `state` | ✓ |
| `POST /oauth/token` (PKCE, public client) | 200, bearer token issued ✓ |
| `POST /mcp` initialize with bearer | 200, `protocolVersion` negotiates to the client's `2025-06-18` ✓ |

So discovery-doc contents, DCR, PKCE, token issuance, and protocol negotiation are all correct. The
Prompt-33 fix is sound. The failure is in a hop Prompt 33 never tested.

## Root cause — the single failing hop
**The connector's discovery request lands on the SPA, not the metadata handler.**

The MCP resource is mounted at **`/mcp`**. Per **RFC 9728 §3.1** (the discovery mechanism the MCP
Authorization spec, 2025-06-18, adopts), a protected resource whose identifier has a **path component**
publishes its metadata at the **path-suffixed** well-known URL:

```
https://tranquil-delight-…up.railway.app/.well-known/oauth-protected-resource/mcp
                                                                              ^^^^ resource path suffix
```

Prompt 33 only registered the **bare** `/.well-known/oauth-protected-resource` (no `/mcp` suffix).
A spec-compliant client (Cowork/Claude) requests the **suffixed** URL, which was not a mounted route,
so it **fell through to the SPA catch-all (`app.get('*')`) and returned `200 text/html` (index.html)**.
The connector tries to parse that HTML as JSON, fails, and reports *"error connecting to the server."*

Reproduced locally (before the fix):
```
GET /.well-known/oauth-protected-resource/mcp
  -> 200 text/html   <!DOCTYPE html><html>SPA index</html>     ← the bug
GET /.well-known/oauth-protected-resource       (bare, mounted)
  -> 200 application/json  {"resource":"…/mcp", "authorization_servers":[…]}
```

This maps to the task's failure mode **(e): path-prefix mismatch between the advertised endpoints and
where they're actually mounted.** It survives a correct `MCP_BASE_URL` and the Prompt-33 mount because
Prompt 33 verified the *bare* path only; the suffixed path is what the client actually hits.

**Secondary gap (also fixed):** an unauthenticated `POST /mcp` returned `401` with **no
`WWW-Authenticate` header**. RFC 9728 §5.1 / the MCP auth spec require the resource to advertise the
protected-resource metadata URL via `WWW-Authenticate: Bearer resource_metadata="…"` on the 401 — this
is the header the client reads to *bootstrap* discovery. Without it, a strict client has no anchor to
begin the OAuth flow even before the suffixed-path issue.

## One-line fix
Serve the well-known metadata on **both** the bare and the `/mcp`-suffixed paths, and add the
`WWW-Authenticate` discovery header to the `/mcp` 401. In `mcp/server.js`:

- `app.get([ '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp' ], …)`
  (same handler; ditto for `oauth-authorization-server`).
- `authenticate()` now sets `WWW-Authenticate: Bearer resource_metadata="${MCP_BASE_URL}/.well-known/oauth-protected-resource"` on the 401.

## Verification (local replay of the real code, `MCP_BASE_URL` = tranquil-delight)
```
suffixed protected-resource: 200 application/json  {"resource":"…/mcp", …}   ← now JSON, was SPA HTML
suffixed auth-server:        200 application/json  {"issuer":"…", …}
bare protected-resource:     200 application/json  {"resource":"…/mcp", …}
401 WWW-Authenticate:        401 Bearer resource_metadata="…/.well-known/oauth-protected-resource"
```
Full happy path (DCR → authorize → token → initialize) still passes; `initialize` negotiates the
client's `2025-06-18`. `node --check mcp/server.js` clean.

Regression tests added to `test/mcp-oauth-root-mount.test.mjs` (now 6/6): the suffixed
protected-resource + auth-server URLs return JSON (not the SPA), and the unauthenticated `/mcp` 401
carries the `WWW-Authenticate: resource_metadata=…` header.

## Post-deploy live verification (run after the Railway redeploy of merged `main`)
On a network with tranquil-delight egress:
```
curl -s https://tranquil-delight-production-633f.up.railway.app/.well-known/oauth-protected-resource/mcp   # expect 200 JSON
curl -si -X POST https://tranquil-delight-production-633f.up.railway.app/mcp \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'      # expect 401 + WWW-Authenticate: resource_metadata=…
```
Then add the **LCC Deal Intelligence** connector in Cowork — it should register and connect without
error, and `query_comps` should be callable.

## Deploy note
Code-only change → ships on a Railway redeploy of merged `main`. `MCP_BASE_URL` must remain set on
tranquil-delight (unchanged from Prompt 33).
