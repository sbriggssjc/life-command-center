# TEST-NET-LEAK — make `npm test` hermetic

**Status:** shipped 2026-09-09.

## What was wrong

`npm test` reached production 14 times per run. Measured two ways (both recorded in
`docs/claude-code/STATUS.md`, 2026-09-09 entry):

1. Dialysis_DB `function_edge_logs`, 24h: 19 bursts of exactly 14 `POST 400
   …/functions/v1/ai-copilot/chat` in 3-minute windows from rotating GitHub-runner (Azure)
   addresses, plus 71 from a developer machine.
2. A local run of the full suite under a `fetch`-logging shim: 5,563 tests, 0 failures, and
   exactly 14 live calls — `test/lease-extractor.test.mjs` (8), `test/dossier-generator.test.mjs`
   (6), all to the live `ai-copilot/chat` edge function.

**Cause:** both files assumed *"no AI key in the test env → the extractor throws"*, but
`api/_shared/ai.js`'s `invokeChatProvider` defaults `AI_EXTRACTION_PRIMARY` to `edge`, and that
route needs no key — it just POSTs to the live edge function. The 400 is swallowed by the
extraction fallback chain (`invokeExtractionAI`) before the assertion sees a difference, so the
network round trip was invisible to every test that "expected the AI to fail."

## What shipped

- **`test/_helpers/net-guard.mjs`** — wraps `globalThis.fetch`, throws on any call to a
  non-loopback host (an explicit blocklist for the three `*.supabase.co` project refs / Railway /
  Salesforce / OpenAI / Anthropic hosts, plus a catch-all for anything else non-loopback). Loaded
  via `--import` in `package.json`'s `test` script, ahead of every test file. Also sets
  `LCC_HERMETIC_TESTS=1` as a belt-and-suspenders flag.
- **`api/_shared/ai.js`** — `invokeChatProvider` now refuses the `edge` route *before* any fetch
  when `NODE_TEST_CONTEXT` (node's own `--test` marker) or `LCC_HERMETIC_TESTS` is set, returning
  the same `{ ok:false, status:400, data:{error:...} }` shape a real provider failure would —
  callers' error handling (`AI provider error ${status}`) runs identically. The retry-after-backoff
  loop in `invokeExtractionAI` also skips its 35s sleep under the same flag (a timing optimization
  — the guard above is what actually keeps it off the network either way).
- **`test/hermetic-suite.test.mjs`** — pins the `--import` wiring in `package.json`, a positive
  control that `invokeChatProvider` never touches `fetch` under the flag, and that the guard's
  blocked-host rule still covers `*.supabase.co` outright.
- **No change** to `lease-extractor.test.mjs` or `dossier-generator.test.mjs` — their existing
  assertions (`assert.rejects(..., /AI provider error|.../)` and "analysis omitted on any
  failure") already describe *provider failure*, not *network absence*, so they pass unmodified
  once the seam returns a deterministic failure instead of a real (or guard-thrown) exception.

## Verified

- Red run (guard only, before the `ai.js` seam): exactly the 4 `assert.rejects` cases in
  `lease-extractor.test.mjs` failed, all on the guard's own thrown error — the predicted
  population, nothing else.
- Green run (guard + seam): both files pass in full, 0 live calls.
- `test/hermetic-suite.test.mjs`: all assertions pass, including the fetch-not-called positive
  control.
- Full suite: see the merge commit / PR CI run for the final pass count — `npm test` must show 0
  live calls and the same pass count as `main` plus the new guard tests.

## Out of scope (see PLANNED-BACKLOG.md)

- **COPILOT-CHAT-OPEN** — the edge function itself accepts unauthenticated `POST /chat`. Separate
  unit; needs a caller inventory before gating it (browser clients call it directly today).
- Refactoring any other test file's `fetch` handling.
- Changing `AI_EXTRACTION_PRIMARY`'s default or any Railway env.

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QUoS9FcmKDFb8tBn9uThSR
