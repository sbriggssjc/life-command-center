# B6e-ci-openpyxl — clear the 55, then the unmask becomes possible

**Repo: `Dialysis` only.** No DB work. No LCC changes.

**Read first:** `docs/architecture/producer-health-and-ci-enforcement.md` §3 in
`life-command-center` (canonical).

## Where this stands

PR #7389 did what B6e-ci-mask asked and the milestone is real — **the suite ran for the first time
in this repo's history**:

| | before (`73f1418`) | after (`fd724a5`) |
|---|---|---|
| collected | 3,110 / **5 errors** | **3,128 / 0 errors** |
| **executed** | **0** | **3,128** |
| duration | 22 s | 6 m 12 s |

**3,065 passed · 55 failed · 7 skipped · 1 xfailed.** The import check is unmasked and green on a
real runner, so it is a genuine gate.

⚠️ **But the state this leaves is MEASURED, NOT ENFORCED, and it is sharper than the old one.** The
pytest line is still masked, so **55 real failures sit on `main` and still cannot fail a merge.**
Previously nobody could mistake the badge for a gate; now the job runs 3,128 real tests, reports red,
and merges green. **Step 3 was never finished — the PR merged ~2 minutes after the result first
existed.** This prompt finishes it.

## Unit 1 — the openpyxl cluster (~12 of 55)

The largest cluster is one class: **`openpyxl` leaking as a stub across modules.**

```
AttributeError: module 'openpyxl' has no attribute 'load_workbook'    ×5
RuntimeError: work_product_base requires openpyxl; install it         ×2   ← it IS installed
TypeError: 'DummyWorksheet' object does not support item assignment   ×3
TypeError: isinstance() arg 2 must be a type                          ×2   ← a stub class reaching isinstance
```

⚠️ **This is the same cross-module stub-pollution class already fixed one module over in #7389**, and
the `conftest` snapshot mechanism added there is designed for exactly this shape — adding `openpyxl`
to the snapshot lists is plausibly a near-one-line fix for a large slice.

- **Fix the pollution, do not fix the symptoms.** Twelve individual test patches would leave the
  mechanism live for the next module. *The hazard travels with the technique.*
- ⚠️ **Verify the fix does not simply hide the tests.** Report `collected` and `executed` before and
  after — a "fix" that reduces the failure count by reducing what runs is the defect this whole arc
  is about.

## Unit 2 — the remainder

The rest look like genuine logic failures: `test_financial_ground_truth` rate assertions,
`test_cmbs_propagator`, `test_clinic_history` dedupe, plus 2 known
`test_handle_natural_language_query` drifts.

- **Fix what is a real bug. Quarantine with a NAMED reason what genuinely cannot run in CI.**
- ⚠️ **Do not mass-skip to reach green** — and **report the residue honestly.** A red count that
  stays red is the *input to the unmask decision*, not a failure of this task. If 20 of these are
  real product bugs, say so; that is a finding, not a setback.
- ⚠️ **For each failure, establish whether the TEST or the CODE is wrong before changing either.**
  Twice in this arc a red test was stale and the code was correct; "fixing" the code would have been
  the expensive error.

## Unit 3 — `timeout-minutes`

`ci.yml` has none, so an unbounded job inherits the **6-hour** default on every PR. Now sizeable
against real evidence: the test job measured **6 m 12 s**, so ~20 minutes is well clear.
⚠️ **This is only safe now that the duration is MEASURED** — a timeout on a job of unknown duration
is a guess. (LCC already carries it on all 7 workflows.)

## Explicitly NOT in this change

**Do not remove the `|| echo` from the pytest line.** That is **B6e-ci-unmask**, and it comes
*after* the red is cleared — unmasking with 55 known failures makes the gate red on day one, which
is the documented *"a NEW CI job is not shipped until it has been green once on `main`"* trap and
produces exactly the badge people learn to merge past. **The import check is the model: unmask one
line, prove it green on `main`, then it counts.**

Also still masked and queued behind that: `pip-audit`, and the secrets grep
(`continue-on-error: true`).

## Report back

`collected` / `executed` / pass / fail before and after; which failures were fixed vs quarantined and
the named reason for each quarantine; how many of the remainder are genuine product bugs; whether the
openpyxl fix was the conftest mechanism or something else; and anything the sweep turns up that
outranks the task.

**Verify on tests EXECUTED and on the pass/fail split, never on the job conclusion** — it has read
`success` throughout this entire defect.
