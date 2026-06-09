# Claude Code prompt — QA#8: DEV MODE / auth-enforcement posture (decision + lockout-safe guard)

Paste into Claude Code, run from the **life-command-center** repo. **Most of this
is a config decision + an ops action that Scott performs (Vercel/Railway env
vars) — Claude Code's job is to make that flip safe and well-documented, not to
flip it.** End with merge + deploy commands for the code parts.

---

## Context (verified live + in code, 2026-06-03 — don't re-investigate)

The live app header shows **"DEV MODE"** because `LCC_ENV` ≠ `production`. In
`api/_shared/auth.js`, `authenticate()`:
- **development:** when a request has no JWT and no `X-LCC-Key`, it falls through
  a "transitional dev fallback" and returns the **first owner** (full owner
  access) — i.e. every unauthenticated request is treated as the owner.
- **production/staging:** the same no-credential path returns **401** ("Authentication
  required"). The frontend's `auth.js` interceptor auto-injects `X-LCC-Key` from
  `/api/admin?_route=auth-config` (`lcc_api_key`), so the UI keeps working *iff*
  `LCC_API_KEY` is set in the deploy env.

**The risk:** flipping `LCC_ENV=production` **before** `LCC_API_KEY` is set (and
confirmed flowing) 401s every request with no credential to present — a total
sign-in lockout (same failure shape as the May disk-full outage). This is a
single-user private deployment, so DEV MODE may be an *acceptable deliberate*
choice — surface the tradeoff, don't assume.

## Task

### 1. Report the exact blast radius (so Scott can decide)
Document, in the PR description and a short note in `docs/` (or the existing auth
doc), precisely what changes when `LCC_ENV=production`: which request paths begin
returning 401, what the frontend must send (`X-LCC-Key` via the interceptor /
JWT), and confirm `auth-config` still serves `lcc_api_key` so the UI can
bootstrap. State plainly whether anything *breaks* for the single-user setup.

### 2. Lockout-prevention guard (the one real code change)
In `api/_shared/auth.js` (or wherever env is read at module load), if
`LCC_ENV` ∈ {production, staging} **and** `LCC_API_KEY` is empty **and** no
Supabase JWT verification is configured (`OPS_SUPABASE_URL`/anon key absent),
log a loud one-time `console.error('[auth] MISCONFIG: enforcement on but no
credential source — every request will 401')`. Do **not** silently enforce into
a lockout. Keep `auth-config` (the public bootstrap endpoint) reachable
regardless so the frontend can always fetch its key.

### 3. Auth-readiness probe (so the flip is verifiable before committing to it)
Add a tiny read-only check (extend an existing `diag`/health route, e.g.
`admin.js` diagnostics — do **not** add a new `api/*.js`; stay at 12 functions)
that, for the current request, reports `{ has_jwt, has_api_key, would_pass_in_production }`
without changing behavior. This lets Scott confirm, while still in DEV MODE, that
the frontend is already sending `X-LCC-Key` and will survive the flip.

### 4. Document the safe rollout order (for Scott to run)
Spell out the ordered steps (these are **Scott's** env changes in Railway/Vercel,
not Claude Code's):
1. Set `LCC_API_KEY` (frontend starts sending `X-LCC-Key`; dev fallback still on).
2. Hit the readiness probe / check devtools → confirm requests carry `X-LCC-Key`
   and `would_pass_in_production: true`.
3. Only then set `LCC_ENV=production` → enforcement on, DEV MODE badge clears.
4. Rollback = unset `LCC_ENV` (back to development) if anything 401s.

## Verify + ship
- `node --check api/_shared/auth.js api/admin.js`. Function count unchanged (no
  new `api/*.js`). Existing auth tests stay green; add a unit test for the
  misconfig-guard branch.
- The behavior change is guard + probe only — enforcement itself flips via env
  vars Scott sets, in the order above. End with merge + deploy commands.
