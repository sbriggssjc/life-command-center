# Railway Healthcheck Investigation - 2026-08-10

## Objective

Investigate three consecutive Railway deployment failures for tranquil-delight / LCC, reported as health check failures, and identify which of the three most recent PRs caused the break.

## Instructions And Constraints

- Follow `CLAUDE.md`: production runs on Railway, `server.js` is the `/api/*` routing source of truth, and `railway.json` defines the deploy health check.
- Do not modify `/api/` without first reading `.github/AI_INSTRUCTIONS.md`.
- Use the attached Railway logs at `C:\Users\scott\Downloads\logs.1786390578190.json`.

## Current Findings

- Railway config uses `railway.json` healthcheck path `/health` with a 300s timeout.
- `server.js` defines unauthenticated `/health` before the SPA fallback and logs startup on `app.listen()`.
- Attached logs show known-good LCC deployment `96ac7e2a-f40d-41a1-ac0e-67fcd2a837e2` started at `2026-08-10T18:09:03Z`, logged `[LCC] Server running on port 8080`, and exposed `/health`.
- Three later LCC deployments in the log fail before Express starts:
  - `b987104c-2cb6-4f03-a43b-6dc3c0a78be3` at `2026-08-10T18:11:52Z`
  - `b2880f96-8aac-4b00-ade0-6a9aa67912a5` at `2026-08-10T19:21:27Z`
  - `d9243768-4f48-407a-b74e-5b70774ebffd` at `2026-08-10T19:26:21Z`
- All three fail with `SyntaxError: Unexpected token 'return'` in `file:///app/api/_shared/cm-native-chart-injector.js:4824`.
- Local `node --check api/_shared/cm-native-chart-injector.js` reproduces the same parse failure.
- The broken block has two `return [` statements inside the same `series: (() => { ... })()` function. PR #1686 inserted the `hostFor`/`hosts` return block but left the original lower `return [` in place.
- PR validation by git content:
  - `006fa6d4` / PR #1685: `node --check` passes.
  - `dd42f5f3` / PR #1686: `node --check` fails at line 4824.
  - `0b3b0086` / PR #1687: `node --check` still fails at line 4824.

## Next Steps

- Root cause is PR #1686, with PR #1687 preserving the parse error.
- Minimal repair: edit `api/_shared/cm-native-chart-injector.js` so the bid-ask `series` IIFE has exactly one return path matching the intended latest chart behavior, then run `node --check api/_shared/cm-native-chart-injector.js` and the focused `cm-native-chart-injector` test.

## Fix Applied

- Removed the stale five-series host branch and duplicate `return [` from `api/_shared/cm-native-chart-injector.js`.
- Kept the intended final bid-ask behavior: two dash-tick series, solid `upDownBars` spread band, and Peak-only data label on Achieved.
- Cleaned stale five-series expectations from `test/cm-native-chart-injector.test.mjs`.

## Verification

- `node --check api/_shared/cm-native-chart-injector.js` passed.
- `node --check test/cm-native-chart-injector.test.mjs` passed.
- `node scripts/check-boot.mjs` passed: all 208 server/API files parse and `server.js` imports cleanly.
- `node --test test/cm-native-chart-injector.test.mjs` passed: 208 pass, 1 skipped, 0 failed.
