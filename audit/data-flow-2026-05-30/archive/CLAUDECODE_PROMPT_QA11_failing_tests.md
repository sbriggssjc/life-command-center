# Claude Code prompt — QA#11: fix or quarantine the 4 pre-existing failing tests

Paste into Claude Code, run from the **life-command-center** repo. End with merge
+ deploy commands.

---

## Context (surfaced during the QA#5 work, 2026-06-03)

On a clean tree (verified via `git stash`), the full suite is **243 pass / 4
fail**, and the 4 failures pre-date the recent QA work — they're unrelated to it
but leave the suite permanently red, which masks real regressions in CI and made
the QA#5 verification noisier. The 4 failing test files:

- `cm-export-bundle-audit`
- `cm-native-chart-injector`
- `raw-write-guardrail`
- `rca-parser`

## Task

Get the suite to **green**. For each of the 4 failing tests:

1. Run it in isolation, read the actual failure (assertion vs throw vs
   missing-fixture vs import error).
2. Classify the root cause:
   - **Stale test** — it asserts behavior/output that was intentionally changed
     or a feature that was removed/renamed (the `cm-*` capital-markets export +
     chart tests and `rca-parser` are likely candidates if those modules
     evolved). → Update the test to the current contract, or delete/quarantine
     it with a one-line comment explaining why.
   - **Real bug** — the code is wrong and the test correctly catches it (pay
     attention to `raw-write-guardrail`, since a broken write-guard test could
     mean a real safety gap). → Fix the code, keep the test.
3. Prefer **fixing or correcting** over deleting. If a test is genuinely
   obsolete, quarantine it (skip with a documented reason) rather than leaving
   it red — and note any that you skip in the PR so they're not forgotten.

Be explicit in the PR about which of the 4 were stale-test fixes vs real-code
fixes vs quarantined, with the reason for each — that classification is the main
deliverable (it tells us whether any was hiding a real bug).

## Verify + ship
- Full suite green (or green-with-documented-skips): run the repo's test command
  and report the final pass/skip/fail tally.
- No production code behavior change unless a real bug was found (call those out
  specifically).
- Function count unchanged. End with merge + deploy commands.
