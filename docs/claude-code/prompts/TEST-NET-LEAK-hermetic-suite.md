# TEST-NET-LEAK — make `npm test` hermetic: it currently reaches production 14 times per run

> **Measured 2026-09-09, two ways.** (1) Dialysis_DB `function_edge_logs`, 24 h: **19 bursts of exactly 14
> `POST | 400 | …/functions/v1/ai-copilot/chat` inside 3-minute windows, each from a different Azure address** —
> GitHub-hosted runners — plus 71 of the same from one developer machine (UA `node`). Burst times line up with the
> day's PR CI runs. (2) The full suite run locally under a `fetch` shim that logs any call to a real host:
> 5,563 tests, 0 failures, and **exactly 14 live calls** — `test/lease-extractor.test.mjs` → 8,
> `test/dossier-generator.test.mjs` → 6, all to `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/chat`.
> **Cause:** both files assume "no AI key in the test env → the extractor throws", but `api/_shared/ai.js`
> `invokeChatProvider` defaults `AI_EXTRACTION_PRIMARY` to `edge`, and the edge route needs **no key** — it POSTs
> to the live function with no `Authorization` header. The 400 is swallowed by the fallback chain and the
> assertion sees the expected throw; the network round trip is invisible. Backlog **TEST-NET-LEAK**; sibling
> **COPILOT-CHAT-OPEN** (the function accepts that POST from anyone — separate unit, not this one).

**Repo:** `life-command-center` · **Code: tests + one guarded seam in `api/_shared/ai.js`. No DB, no migration,
no deploy, no change to any edge function.** Branch → PR → `App boots` + `npm test` green → merge.

**Read first:** `api/_shared/ai.js` lines ~770–800 (the Prompt 61 #4 root-cause note and `AI_EXTRACTION_PRIMARY`)
and ~920–950 (`invokeChatProvider`'s fetch) · `test/lease-extractor.test.mjs` ~line 832–880 (the "AI (no key in
test) throws" assumptions) · `test/dossier-generator.test.mjs` ~line 50 · `test/marketing-reassign.test.mjs`
(`stubFetch`/`restore` — the pattern already in the suite) · `docs/claude-code/STATUS.md` 2026-09-09 TEST-NET-LEAK
entry.

---

## Unit 1 — prove it before touching it (the shim, in-repo)

Add `test/_helpers/net-guard.mjs`: wraps `globalThis.fetch` and **throws** (does not log) on any URL whose host
matches `*.supabase.co`, `*.railway.app`, `login.salesforce.com`, `*.salesforce.com`, `api.openai.com`,
`api.anthropic.com`, or a non-loopback `http(s)://` host in general — with an allowlist for `localhost`/`127.0.0.1`
and the fake hosts tests already use (`pa.test.local`, etc.). Message names the test file and URL. Wire it via
`NODE_OPTIONS=--import` in `package.json`'s `test` script (**check the other window's CI changes first:**
`git log origin/main -5 -- package.json .github/workflows/test-suite.yml` — J13a-ci-docs-only touches the same
workflow).

**Run the suite once with the guard on and paste the two failures.** That red run is the deliverable's positive
control — the fix in Unit 2 must turn exactly those red, and nothing else.

## Unit 2 — fix at the seam, not by deleting assertions

- `test/lease-extractor.test.mjs` and `test/dossier-generator.test.mjs`: make the "AI throws" cases deterministic
  by stubbing `fetch` (the `marketing-reassign` pattern) or by setting `AI_EXTRACTION_PRIMARY=openai` with no
  `OPENAI_API_KEY` in the test's env **and** asserting the error message they already match
  (`/AI provider error|no_json_in_ai_response|fetch failed/`) — whichever keeps the assertion meaning. The
  assertion must still be about the extractor's behaviour on provider failure, not about a network being absent.
- `api/_shared/ai.js`: add a **narrow** refusal — when `process.env.NODE_TEST_CONTEXT` is set (node's own marker
  under `--test`) or `LCC_HERMETIC_TESTS=1`, `invokeChatProvider` returns the same `{ ok:false, status:400 }` shape
  it returns for an unsupported provider, with `data.error: 'edge route disabled in test'`, **before** any fetch.
  Default behaviour in production unchanged; the flag is not read anywhere else. Positive control: a test that
  sets the flag and asserts no fetch happened.

## Unit 3 — keep it un-recurrable

The Unit 1 guard stays on in `npm test` permanently (this is the J13a-guard shape again: a test, not a sweep).
Add one test file `test/hermetic-suite.test.mjs` that documents the guard and asserts the host list contains the
three project refs (`xengecqvemvfknjvbvrq`, `zqzrriwuavgrquhisnoa`, `scknotsqkcheojiaewwh`) so a new project cannot
be added without the guard learning it.

## Unit 4 — docs

- `CLAUDE.md` footguns: one bullet — *a test that "expects the AI to throw" may be proving the network is up;
  the suite is hermetic by guard since 2026-09-09.*
- `docs/os/PLANNED-BACKLOG.md`: TEST-NET-LEAK → ✅ with the red-run paste and the post-fix count (must be 0);
  COPILOT-CHAT-OPEN unchanged (link back).
- STATUS entry; response `docs/claude-code/responses/TEST-NET-LEAK-hermetic-suite.response.md`.

---

## Out of scope — say so

- Gating `ai-copilot` itself, or changing `AI_EXTRACTION_PRIMARY`'s default (COPILOT-CHAT-OPEN; needs the caller
  inventory and Scott's Railway env read first).
- Any other test that stubs `fetch` correctly today — do not refactor them.
- The 400 itself (why the edge function rejects extraction prompts is Prompt 61 #4's territory).

## Verify on

- The red run with the guard on shows **exactly** the two files above and no others; the green run shows 0 live
  calls (paste both).
- `npm test` duration does not grow by more than the guard's overhead (state before/after).
- No edge function, migration, or Railway env touched.
