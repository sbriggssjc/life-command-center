# Claude Code prompt — QA#5 + QA#7: fetch-layer resilience (503 retries + de-dupe) + treasury last-good

Paste into Claude Code, run from the **life-command-center** repo. Touches
`auth.js` (the global fetch interceptor) + `api/admin.js` (`handleTreasury`).
No overlap with QA#1–#4 files. (Your harness will use its provisioned branch —
that's fine; just end with the merge + deploy commands.)

---

## Context (verified live 2026-06-03 — don't re-investigate)

On a single page load the network panel showed:
- `/api/admin?_route=auth-config` → one **200** and one **503**
- `/api/treasury` and `/api/treasury?history=true&years=1` → **503s**
- `/api/queue-v2?view=work_counts` fired **3×**; `auth-config`, `treasury`,
  `review-counts` each fired **2×**.

Findings:
- `handleAuthConfig` (`api/admin.js`) is a synchronous 200-only function — it
  **cannot** emit 503. `handleTreasury` returns **500** (not 503) when all
  upstream sources fail. So the **503s are platform transients** (Railway/Vercel
  cold-start / concurrency), not handler bugs — the right fix is client-side
  retry, which also covers any future transient endpoint.
- The duplicate calls are independent callers firing the same GET concurrently
  on load — fixable by coalescing in-flight identical GETs.
- `handleTreasury` fetches `home.treasury.gov` (XML→CSV→fiscaldata fallbacks)
  and returns 500 if every source fails; it has no last-good fallback, so a
  treasury.gov outage blanks the widget.

## Task

### 1. (QA#5) Retry transient 5xx in the global fetch interceptor — `auth.js`
In the `window.fetch` patch (the IIFE ending `return _originalFetch.call(window,
input, init);`, ~line 439) and/or the `apiFetch` helper (~line 150), wrap the
final dispatch so that for **GET** `/api/` requests only (method undefined or
`'GET'`), a response status in **{502, 503, 504}** or a network throw is retried
with backoff: up to **2 retries**, ~**250ms then ~600ms** (small jitter ok).
Never retry non-GET (no double POST/PATCH). Return the last response/throw if
retries are exhausted. Keep all existing header-injection behavior intact.

### 2. (QA#7) Coalesce in-flight identical GETs — `auth.js`
Add a module-level `Map` of in-flight promises keyed by `method + ' ' + url`
(GET `/api/` only). If an identical request is already in flight, return the
same promise (clone the Response per consumer, e.g. `.then(r => r.clone())`) so
the 3× `work_counts` / 2× `auth-config` / 2× `treasury` collapse to one network
call. Delete the key when the promise settles. Combine with the retry wrapper so
a coalesced request still benefits from retry. Don't coalesce non-GET.

### 3. (QA#5) Treasury last-good cache — `api/admin.js handleTreasury`
Add a module-level `let _treasuryCache = { latest: null, history: {} }`. On a
successful return, store the payload (keyed by `history`+`years`). On the failure
paths (currently `return res.status(500)...` and the `catch`), if a cached
last-good payload exists, return it **200** with an added `stale: true` (and
`as_of` from the cached date) instead of 500, so the widget degrades to the last
known rate rather than erroring. Keep the existing `Cache-Control` SWR header.

## Verify + ship
- `node --check auth.js api/admin.js`. Function count unchanged.
- After deploy, reload Today a few times: `auth-config` / `treasury` /
  `work_counts` should each show **one** request per load, transient 503s should
  no longer surface a broken widget, and a forced treasury failure should return
  `stale: true` data rather than 500.
- Add/extend a small test if the repo has a client-test harness; otherwise note
  manual verification steps in the PR.
- End with the merge + deploy commands (Vercel/Railway picks up `auth.js` +
  `admin.js` on push to main).

## Not in this prompt (your call, Scott)
- **DEV MODE / auth posture (QA#8):** the live header shows "DEV MODE" because
  `LCC_ENV` isn't `production` and `LCC_API_KEY` may be unset. That's an env/config
  decision, not code — decide whether prod should enforce auth and set the env
  vars if so. Flagging, not fixing here.
