# Claude Code (LCC) — CI boot check + fix the deploy gate's own blind spot

Two small hardening units. Both close failure classes observed live on 2026-07-20, not
hypotheticals.

---

## Unit 1 — CI must catch an app that can't boot

### Why (grounded)

`api/intake.js` was un-importable on `main` for roughly four hours:

```
$ node --check api/intake.js
api/intake.js:196
        error: 'Invalid _route. Use: outlook-message, summary, ...'
        ^^^^^
SyntaxError: Unexpected identifier 'error'
```

A merge between PR #1423 (`4ce791a0`, mobile-share) and PR #1425 (`82d7f178`, email
auto-archive) stacked two `error:` properties in the same object literal **without a
comma**. `server.js` imports `api/intake.js` at boot, so every Railway build crash-looped
and Railway correctly kept serving the last healthy container — freezing production at
`c7775934` (PR #1424) while **four subsequent merges silently never shipped**.

**The test suite passed the entire time — 2,042 tests, 0 failures.** Because tests import
individual modules; nothing ever imports the app. This same mechanism is very likely
behind the four earlier incidents misdiagnosed as "the `_route` dispatch regressed off the
build" (#1408, #1410, #1414, #1415) — the routes were never missing from the repo; the
deploys weren't landing.

`test/operations-subroutes.test.mjs` (PR #1415) guards the **repo**, not the **deploy**,
so it structurally cannot catch this. It's worth keeping; it just doesn't cover this.

### What to build

Add a boot check that runs in CI on every PR **and** as an npm script:

- **Minimum:** `node --check` across `server.js`, `api/**/*.js` (including `_handlers/` and
  `_shared/`) — this alone catches the exact failure above. It found `intake.js` as the
  ONLY broken file among ~14 `api/*.js` plus all handlers/shared modules, so it's cheap
  and precise.
- **Better, if it can be made reliable:** actually `import('./server.js')` in a child
  process with a guard env (e.g. `LCC_BOOT_CHECK=1`) so it does not bind a port, hit a
  database, or start crons — then exit 0. This catches import-time failures a syntax check
  misses (bad named export, circular import, module-level throw). **If that can't be made
  hermetic without side effects, ship the `node --check` sweep and say so explicitly
  rather than shipping something that half-works.**
- Wire it as `npm run check:boot`, add it to CI (the same workflow the suite runs in), and
  make it a **blocking** check.

Keep it fast — this must not become a thing people skip.

---

## Unit 2 — the deploy gate can be fooled by caching

### Why (grounded)

`scripts/verify-deploy.mjs` (PR #1430) compares live `/version` to the expected SHA. Today
I fetched `/version` twice and got a **byte-identical response including the timestamp**:

```
{"version":"c7775934820a", ... ,"ts":1784556476141}   ← first read
{"version":"c7775934820a", ... ,"ts":1784556476141}   ← second read, identical ts
```

A cache-busting query param immediately returned the truth:

```
/version?cb=... → {"version":"ae3573b67f84", ... ,"ts":1784558856151}
```

The deploy had already landed. **I nearly reported a current deploy as stale.** The
endpoint sets `Cache-Control: no-store`, but something between (client, proxy, CDN)
served a cached copy anyway.

A gate that can return stale data is a gate that lies — and this one exists specifically
to detect staleness, so the failure is self-defeating.

### What to build

In `scripts/verify-deploy.mjs`:

- Append a unique cache-buster to every request it makes — `/version` **and** each
  critical-route probe (e.g. `?_cb=${Date.now()}-${randomUUID()}`).
- Send `Cache-Control: no-cache` and `Pragma: no-cache` request headers as well. Belt and
  braces — the query param is what actually worked today.
- **Assert freshness, don't assume it:** `/version` returns a `ts`. If two consecutive
  reads return an identical `ts`, that is a cached response, not a live one — fail with a
  clear "got a cached /version response; cannot verify deploy" message rather than
  reporting a possibly-wrong SHA comparison.
- Same treatment for the route probes: a cached 200 could mask a route that is currently
  missing.

---

## Boundaries

Repo/CI only · no DB writes · no production behavior change · no new `api/*.js` · keep
`test/operations-subroutes.test.mjs` (it guards a different thing) · the boot check must
not require network, database, or secrets to run.

## Verify

1. `npm run check:boot` passes on current `main`.
2. **Prove it catches the real bug:** temporarily reintroduce the missing comma in
   `api/intake.js` (two `error:` keys, no separator), confirm `check:boot` **fails**, then
   revert. A guard that can't be shown failing isn't a guard.
3. `npm run verify:deploy` still passes against the current live deploy.
4. **Prove the cache fix:** confirm two consecutive `/version` reads from the script
   return **different** `ts` values (i.e. the cache-buster is working), and that an
   identical-`ts` response is treated as a failure rather than a comparison.

## Note

The parallel account-sync drain (cron `lcc-sf-record-sync-account`, jobid 174) is running
against LCC Opps for the next several hours. This round touches no database, so it's safe
to merge and deploy at any time — a redeploy only interrupts one idempotent tick, which
the next cycle retries.
