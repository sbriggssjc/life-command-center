# Auth Enforcement Rollout — flipping `LCC_ENV=production` safely

> **TL;DR for a single-user deployment:** Nothing *breaks* when you flip
> `LCC_ENV=production` **as long as `LCC_API_KEY` is set first** and you have
> confirmed the frontend is sending `X-LCC-Key`. The probe at
> `/api/diag?kind=auth-ready` lets you verify this *before* committing to the
> flip. DEV MODE is also a perfectly acceptable deliberate choice for a private,
> single-user app — this doc just makes the tradeoff explicit so you can decide.

---

## 1. What "DEV MODE" actually is

The app header shows **DEV MODE** whenever `LCC_ENV` ≠ `production`. The badge is
driven by `/api/admin?_route=auth-config` returning `env: 'development'`.

The behavioral consequence lives in `api/_shared/auth.js → authenticate()`:

| Request shape | `development` (DEV MODE) | `production` / `staging` (enforced) |
|---|---|---|
| Valid Supabase **JWT** (`Authorization: Bearer …`) | ✅ resolved user | ✅ resolved user |
| Valid **`X-LCC-Key`** header | ✅ resolved (owner / automation) | ✅ resolved (owner / automation) |
| **Copilot** passthrough (`?_copilot_path=…`) | ✅ limited scope | ✅ limited scope |
| **No credentials at all** | ✅ **falls through to the first owner** (full owner access) | ❌ **401 `Authentication required`** |

So in DEV MODE, *every unauthenticated request is silently treated as the owner.*
That is the entire risk surface: it is convenient for a single user, and it is a
wide-open door if the deployment is ever network-reachable by anyone else.

## 2. Blast radius when you flip `LCC_ENV=production`

**Which request paths begin returning 401:** every protected handler that calls
`authenticate()` — i.e. essentially the whole API surface (`?_route=me`,
`ops-health`, `diag?kind=env`, the queue/intake/entity/domain endpoints, etc.) —
will return `401` for any request that arrives with **no JWT and no `X-LCC-Key`**.
Today those requests succeed as the owner; after the flip they are rejected.

**What the frontend must send:** one of —
- a Supabase **JWT** in `Authorization: Bearer <jwt>` (after magic-link sign-in), or
- the **`X-LCC-Key`** header. `public/auth.js` installs a global `fetch`
  interceptor that fetches `/api/admin?_route=auth-config`, reads `lcc_api_key`,
  and auto-injects `X-LCC-Key` on every `/api/*` call. **This is the bootstrap
  path that keeps the UI working without an interactive sign-in.**

**`auth-config` stays public and still serves the key:** `handleAuthConfig` in
`api/admin.js` requires no authentication (it must work *before* sign-in) and
returns `lcc_api_key` whenever `LCC_API_KEY` is set in the env. So the frontend
can always bootstrap its credential, even under enforcement. The
auth-readiness probe (below) is likewise public for the same reason.

**Does anything break for the single-user setup?**
- **If `LCC_API_KEY` is set before the flip:** No. The interceptor injects
  `X-LCC-Key`, every `/api/*` call carries it, and enforcement passes. The only
  visible change is the **DEV MODE badge clears**.
- **If you flip `LCC_ENV=production` while `LCC_API_KEY` is empty *and* no JWT
  verification is configured (`OPS_SUPABASE_URL` absent):** **total sign-in
  lockout** — every request 401s with no credential it could present. This is the
  same failure shape as the 2026-05 disk-full outage. **Do not do this.** The
  guard in §4 now logs a loud `console.error` at cold start if you land here, and
  `auth-config` stays reachable so the UI can still try to bootstrap.

## 3. Auth-readiness probe — verify *before* you flip

`GET /api/diag?kind=auth-ready` (public, read-only, no behavior change) reports
how the **current request** would fare under enforcement:

```jsonc
{
  "lcc_env": "development",
  "enforcing": false,
  "has_jwt": false,
  "has_api_key": true,           // X-LCC-Key header present on this request
  "api_key_valid": true,         // …and it matches LCC_API_KEY (constant-time)
  "api_key_configured": true,    // LCC_API_KEY is set in the deploy env
  "is_copilot_path": false,
  "would_pass_in_production": true   // ← the gate. Must be true before flipping.
}
```

Use it from the browser devtools console (so the request carries the same
interceptor-injected headers the app sends):

```js
fetch('/api/diag?kind=auth-ready').then(r => r.json()).then(console.log)
```

If `would_pass_in_production` is `true`, the frontend is already credentialed and
the flip is safe. If it is `false`, **do not flip** — set `LCC_API_KEY` first and
re-check.

> Note: `api_key_valid` is authoritative (validated synchronously against
> `LCC_API_KEY`). `has_jwt` reflects header *presence* only — full JWT validity
> needs an async Supabase round trip — so for the bootstrap path, watch
> `api_key_valid` / `would_pass_in_production`.

## 4. Lockout-prevention guard (code, already shipped)

`api/_shared/auth.js` now runs `detectAuthMisconfig()` once at module load. If
`LCC_ENV ∈ {production, staging}` **and** `LCC_API_KEY` is empty **and**
`OPS_SUPABASE_URL` is absent (no JWT verification possible), it logs:

```
[auth] MISCONFIG: enforcement on but no credential source — every request will 401. …
```

It does **not** silently enforce into a lockout, and it never touches
`auth-config` (which stays public so the frontend can always fetch its key).

## 5. Safe rollout order (Scott's env changes — Railway/Vercel)

These are **env-var changes you make in the deploy dashboard**, not code changes.
Run them in this order:

1. **Set `LCC_API_KEY`** in the deploy env. The dev fallback is still on
   (`LCC_ENV` unchanged), so nothing breaks; the frontend interceptor now starts
   attaching `X-LCC-Key` (it reads the key from `auth-config`).
2. **Confirm readiness.** Open the app, then in devtools run the
   `/api/diag?kind=auth-ready` fetch above (or check the Network tab to see
   `X-LCC-Key` on `/api/*` requests). Require **`would_pass_in_production: true`**.
3. **Only then set `LCC_ENV=production`.** Enforcement turns on, the no-credential
   fallback is disabled, and the **DEV MODE badge clears**. Because step 2 proved
   the request is already credentialed, the UI keeps working.
4. **Rollback:** if anything 401s, **unset `LCC_ENV`** (back to `development`).
   This re-enables the dev fallback immediately — no redeploy of code required.

---

*Added 2026-06-03. Code: `api/_shared/auth.js` (`detectAuthMisconfig`,
`authReadiness`), `api/admin.js` (`handleDiag` `kind=auth-ready` branch).
Tests: `test/auth-misconfig-guard.test.mjs`.*
