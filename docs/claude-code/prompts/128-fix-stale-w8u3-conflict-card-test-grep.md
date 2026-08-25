# Prompt 128 — Fix the stale source-grep in `w8-u3-conflict-card` test (one-liner)

**Status:** DRAFT 2026-08-24 (Cowork; CC diagnosed this during P127, offered the fix, out of P127 scope)

Grounding: `test/w8-u3-conflict-card.test.mjs`, `api/admin.js` (the `out.total` line for the U3 conflict-card
count). This is the lone remaining full-suite failure and it is a **stale test, not a code bug** — it fails
identically on `HEAD~1` and reads a file the recent work never touched.

## The defect

The test greps `api/admin.js` for the literal
```
out.total = (u3OpenCnt || 0) + (u3ConfCnt || 0)
```
but **Prompt 89's null-guard rewrote that line** to
```
out.total = (u3OpenCnt == null && u3ConfCnt == null) ? null : (u3OpenCnt || 0) + (u3ConfCnt || 0)
```
so the literal grep no longer matches and the test fails. The runtime behavior is correct; only the test's
assertion is stale. Same class as the `</table>` stale-assertion CC fixed in the P126 signature test and the
recurring "a test that slices/greps source breaks when the source moves" footgun in CLAUDE.md.

## The ask

1. **Fix the assertion to test BEHAVIOR, not source text.** Rather than re-pin the new literal (which will rot
   again the next time the line changes), assert the actual contract: the U3 conflict-card total is `null` when
   both counts are null/absent, and the numeric sum otherwise. If a source-shape check must remain, match on a
   stable structural token, not the exact expression.
2. **Verify:** the targeted test passes, and confirm the full suite is green **by the state delta, not the
   `node --test` exit code** (P127's lesson — exit 0 was returned over a real failure; read the actual
   pass/fail list). No other test should change.

## Close-out
- Test-only change; no runtime code, no migration, ships with the next redeploy of `main` (nothing waits on
  it). Note in STATUS that the full suite is now clean.
