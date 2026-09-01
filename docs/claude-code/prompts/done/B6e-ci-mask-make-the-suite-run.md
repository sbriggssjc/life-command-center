# B6e-ci-mask — Dialysis CI runs ZERO tests. Make the suite run, then unmask one line.

**Repo: `Dialysis` only.** No DB work. No LCC changes.

## The finding, and why it is now actionable

This was filed on 2026-09-01 as *"`|| echo` masks pytest, so 3,042 tests cannot fail a merge."*
**Reading the job log instead of the badge made it sharper and worse:**

```
!!!!! Interrupted: 5 errors during collection !!!!!
======== 1 warning, 5 errors in 18.16s ========
Tests completed (some may have been skipped)     ← the mask
→ job conclusion: success
```

**pytest aborts at COLLECTION. Not one test executes** — on pull requests and on every sampled `main`
run. So:

- The "3,042 tests" figure is tests **collected in a healthy local run**, never tests CI has
  attempted.
- **Every mutation-verified guard in this repo has never run in CI** — including the 31 + 34 shipped
  with PR1a/PR1b two hours ago.
- 🎯 **One of the five erroring files is `test_b6e_pipefail_workflow_guard.py` — the pipefail guard
  itself.** The repo has the detector, it is muzzled, *and* it cannot load.
- The five fail on `flask` / `geopy` environment issues and **none belongs to a recently changed
  module**, so this is pre-existing and not introduced by any current work.

**That measurement is what this prompt exists to act on.** The sequence below was already the agreed
one; it was blocked only on not knowing what was red.

## The sequence — strict, and the unmask is LAST

⚠️ **Do NOT start by removing the `|| echo`.** Turning a never-enforced suite into a merge gate in
one step is the documented *"a NEW CI job is not shipped until it has been green once on `main`"*
trap — it produces a badge people learn to merge past, which is the exact failure this is meant to
close.

### Step 1 — make the suite collect

Fix or quarantine the **5 collection errors**. Name each one and say which it is:

- **Fix** where it is a genuine missing dependency (add it to `requirements`/`requirements-dev` —
  the PyYAML precedent from B6e-fred: *a guard that cannot import is a guard that does not run*).
- **Quarantine** where the module needs an environment CI has no business holding (a real service,
  a credential). Quarantine means an explicit, **named** skip with a reason — never a deletion and
  never a broad `--ignore` that could swallow future files.

⚠️ **`test_b6e_pipefail_workflow_guard.py` must end up RUNNING, not quarantined.** It is the guard
for this very class; leaving it unloadable would make this exercise self-defeating.

**Report: the 5 files, the cause of each, and the disposition of each.**

### Step 2 — measure the truth on `main`

With collection fixed, run the full suite **on `main`** and report **pass / fail / skip / error**.
This number has never existed. ⚠️ **Expect it to be non-zero-failing and do not treat that as a
setback** — it is the whole point of measuring before gating.

### Step 3 — fix or quarantine what is red

Same discipline: fix real failures, quarantine with a named reason what genuinely cannot run in CI,
and **report the residue**. Do not mass-skip to reach green.

### Step 4 — unmask ONE line

**Only the cheapest check first: the import.** Lines ~137–138 carry
`python -c "import src.main" 2>/dev/null || echo` — **exactly the check that would have caught
FRED's `ModuleNotFoundError: postgrest`** during 25 days of green badges over a dead producer.
Remove the mask on that one line only. Leave the pytest line, `pip-audit` and the secrets grep
masked for a follow-up.

⚠️ **A newly unmasked check must be green on `main` before it counts.** If it goes red, that is a
real finding — report it, do not re-mask it.

## Guardrails

- **Grep for the masking SHAPE, not one spelling** — `|| echo`, `| tee` without `pipefail`,
  `2>/dev/null`, `continue-on-error`, `exit 0`. Report every instance you find with its line, even
  the ones you do not touch.
- **Do not touch the LCC repo or any database.**
- **Verify on tests EXECUTED, never on the job conclusion.** The conclusion has been `success`
  throughout this entire defect.
- Nothing here changes application behaviour. If a "fix" requires changing `src/`, stop and report
  instead — that is a different change with a different blast radius.

## Report back

The five errors and their dispositions; the first true `main` suite numbers; what stayed red; which
line was unmasked and whether it is green; the full inventory of remaining masking idioms; and
anything the sweep turns up that outranks the task.
