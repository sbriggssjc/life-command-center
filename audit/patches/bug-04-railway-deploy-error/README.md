# Bug #4 — Railway deploy error

Triage diagnostic — **no code patch yet**. I don't have Railway MCP access,
so I can't pull build/runtime logs directly. This doc captures the most
likely causes given the stack (`railway.json` + `nixpacks.toml` + `server.js`)
and the diagnostic steps Scott should walk to confirm.

## Stack as built

- **Builder:** Nixpacks, forced to Node provider by `nixpacks.toml` (without
  this file the `supabase/functions/*.ts` files would have made Nixpacks
  auto-detect Deno and ship a no-Node image).
- **Start command:** `node server.js` (via `npm run start` or the explicit
  `start:railway` script).
- **Healthcheck:** `GET /health` → returns instant `{status:'ok',ts:...}`
  (no DB call). 300s timeout, max 5 restart retries on failure.
- **Engine:** Node >= 20 (set in `package.json#engines`).

## Most likely failure modes — in order of probability

### 1. **Healthcheck pass, but the app crashes shortly after boot from an unhandled rejection in a startup-time DB call.**
   `server.js` registers `process.on('unhandledRejection', ...)` but only
   logs — the process keeps running. However, if an `import` chain hits a
   top-level `await` that fails (e.g. an early DB ping in any of the
   imported handlers), Railway sees the container exit and triggers the
   restart loop.

   **Check:** Railway Deploy → Logs tab → look for `[LCC] FATAL` lines
   right after the "ready on port" line.

### 2. **`flag_removed_at` errors cascading into degraded handler responses on first user request.**
   Bug #1's missing column makes `api/sync.js` throw on every flagged-email
   load. If Railway is also doing a deep-probe (not just `/health` but
   `/api/*` warm-up), the deploy gets stuck waiting for a healthy 200 from
   a handler that's silently 500-ing.

   **Mitigation:** Apply bug-01 patch first → re-deploy → see if the error
   clears on its own.

### 3. **A `path-to-regexp` parser error from a malformed Express route.**
   Express 4.21 + tightened path-to-regexp can reject paths like `'*'` if
   used in the wrong context. `server.js:265` registers `app.get('*', ...)`
   which is the recommended SPA-fallback form — should be fine in 4.21,
   but if `express` was bumped past 5.0 by an `^4.19.0` resolution drift,
   this will throw at boot.

   **Check:** Railway Deploy → Logs → look for `TypeError: Missing parameter
   name` or `pathToRegexpError` near boot. If present, lock `express` to
   `4.19.x` in `package.json` and redeploy.

### 4. **LCC Opps connection pool exhaustion.**
   I observed multiple `Connection terminated due to connection timeout`
   errors via Supabase MCP during this triage, isolated to LCC Opps (dia
   + gov were instant). If `api/_shared/ops-db.js` is leaking connections
   under the silent-write storm (218+ failures observed earlier), Railway
   may see the API stall on first DB call.

   **Check:** Supabase Dashboard → LCC Opps → Settings → Database → Connection
   Pooler. Look at active connections vs pool max. If at cap, restart the
   pooler.

### 5. **Health timeout from slow `/health` response.**
   `/health` itself doesn't call the DB, so this is unlikely — but worth
   eliminating. If the response time on `/health` is >100ms, something is
   wrong with the event loop.

## Diagnostic commands

```bash
# 1. Pull the most recent failed deploy
railway logs --service tranquil-delight --deployment <id>

# 2. Or via dashboard:
#    Project → Service → Deployments → click the failing one → "View Logs"

# 3. Test the healthcheck against the latest URL:
curl -i https://<railway-domain>/health
# Expect: HTTP/1.1 200 OK and instant {"status":"ok","ts":...}

# 4. Confirm Express version Railway actually installed
railway run "node -e 'console.log(require(\"express/package.json\").version)'"
```

## When you have the logs

Paste the failing deploy's log output (or even just the last 50 lines) and
I can write the actual code/config patch in a few minutes. Without logs
this is guesswork.
