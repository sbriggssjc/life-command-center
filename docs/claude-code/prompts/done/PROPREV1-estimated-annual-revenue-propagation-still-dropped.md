# PROPREV1 — `properties.estimated_annual_revenue` propagation still 100% dropped after CFE-RUNAWAY's claimed fix

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the same
convention as `CFE-RUNAWAY-cms-financial-estimates-repair.md` and
`RATINGS-INSERT-COLLISION-cms-ratings-upsert.md` — the code lives in the other repo, this repo just
tracks the ask and the response.

## 0. Why this is next

CFE-RUNAWAY (PR #7398) and RATINGS-INSERT-COLLISION are both merged. A fresh run was triggered, ran
for about an hour, and was cut short mid-flight when the CFE-RUNAWAY-fix-follow-up PR's merge
auto-deployed and restarted the container (`Stopping Container`, expected). **The core stability fixes
are holding**: a 27-second excerpt from just before the stop shows every `supabase_execute_wrapper`
call at `count=1` (no full-table probes recurring) and zero `ratings`/`circuit_open`/`duplicate key`
mentions. But that same excerpt surfaced a new problem in a fix that was already claimed done: the
`properties.estimated_annual_revenue` propagation CFE-RUNAWAY's own response said it fixed ("client
now threaded through") is **still failing, 100% of the time, in production**, even though CFE-RUNAWAY
reported 8 new passing tests pinning it. That gap between "tests pass" and "still broken live" is
itself worth explaining, not just patching over.

## 1. What is measured

From a Railway log excerpt (`3a084723-add6-4923-b790-2f1e3a8d35d2`, 2026-09-10 16:27:02–16:27:29 UTC,
27 seconds, ending in `Stopping Container`):

- `INFO:src.propagation_utils:Propagating to properties: {'estimated_annual_revenue': <value>}`
  immediately followed every time by
  `WARNING:src.utils_shared:[schema_guard] Dropped invalid fields for properties:
  estimated_annual_revenue (live check kept: none)`.
- **This pair repeated 54 times in 27 seconds — 54/54, a 100% drop rate.** Every occurrence's
  "live check kept" value was literally `none` — not "kept some other fields but dropped this one,"
  but the live check returning **nothing** every single time.
- For comparison, the five already-decided-intentional `facility_patient_counts` field-drop warnings
  (`payer_mix_assumptions`, `medicare_share_assumed`, `medicaid_share_assumed`,
  `commercial_share_assumed`, `revenue_medicaid`) also appear 56× each in the same window — **those are
  expected and correct, per the CFE-RUNAWAY decision already made; do not re-litigate them.** Only
  `estimated_annual_revenue` on `properties` is the problem here.
- No full-table probes, no `ratings` circuit-breaker activity, no statement timeouts anywhere in this
  window — CFE-RUNAWAY and RATINGS-INSERT-COLLISION both appear to be holding. Confirm that read is
  right, but it is not this prompt's main job.

**Working hypothesis, to confirm not assume:** either (a) the client-threading fix CFE-RUNAWAY reported
did not actually land as described in the merged code, or (b) it landed but the live schema check it
depends on is failing for an unrelated reason (a stale/incorrect table name, a permissions issue on
the live query, an exception being swallowed and treated as "kept: none" instead of surfacing), or
(c) the 8 new tests that were reported passing don't actually exercise this code path the way
production does (e.g., they mock the live check instead of hitting it, so a real live-check failure
mode was never covered).

## 2. Units

**Unit 1 — trace the exact call.** Find `[schema_guard]`'s live-check function (likely in
`utils_shared.py`, alongside where CFE-RUNAWAY's client-threading fix was reported to land) and the
call path from wherever `properties` gets propagated to for `estimated_annual_revenue`. State file:line
for both the live-check function and its caller.

**Unit 2 — explain why "kept: none" happens every time.** Confirm which of the three hypotheses above
(or another) is actually true. Reproduce the failure if possible rather than guessing from the log
alone — call the same live-check path directly (or as close to it as the test setup allows) and see
what it actually returns and why.

**Unit 3 — verify or redo CFE-RUNAWAY's fix.** If the client-threading change from PR #7398 is present
in the code but not working, fix the real cause found in Unit 2. If it is NOT present as described
(i.e., the merged code doesn't match the transcript's account of the fix), say that plainly — don't
paper over a discrepancy between what was reported and what actually shipped.

**Unit 4 — explain the test gap.** CFE-RUNAWAY reported 8 new tests passing that were meant to pin
this exact fix. If they're passing while production still fails 100% of the time, the tests are not
exercising the real failure path. Identify why, and add (or fix) a test that would have caught this —
one that exercises the actual live-check call, not a mock that assumes it succeeds.

**Unit 5 — confirm the fix live, not just in tests.** After the fix, verify against Dialysis_DB
directly (or the closest available equivalent) that a `properties` row's `estimated_annual_revenue`
actually gets written on the next propagation attempt — the same kind of live confirmation this session
did for CFE-RUNAWAY and RATINGS-INSERT-COLLISION's Postgres-level checks, not just a green test suite.

## Out of scope

- The five `facility_patient_counts` field drops — already decided, do not reopen.
- Any change to `clinic_financial_estimates`'s write path itself (CFE-RUNAWAY) or `ratings`'s upsert
  path (RATINGS-INSERT-COLLISION) — both already fixed and confirmed holding in this same log window;
  touch them only if Unit 1 shows this bug shares a helper with one of them.
- No `life-command-center` code changes — entirely in `Dialysis`.

## Verify on

- Unit 1: exact file:line for the live-check function and its caller.
- Unit 2: a stated, confirmed root cause for the 100% "kept: none" result — not a guess.
- Unit 3: fix in place; explicit statement on whether CFE-RUNAWAY's original fix was present/absent/
  broken in the merged code.
- Unit 4: the test gap explained, and a new or corrected test that fails without the fix and passes
  with it, exercising the real live-check path.
- Unit 5: a live check (not just tests) showing `estimated_annual_revenue` actually lands on a
  `properties` row after a propagation attempt.
- This repo's own test suite green, same invocation as the prior two fixes
  (`--ignore=tests/integration/`).
