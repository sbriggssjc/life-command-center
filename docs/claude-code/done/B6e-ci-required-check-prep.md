# B6e-ci-required-check-prep — make the Dialysis gate REAL: docs-only status + ruff clean, then Scott flips the toggle

**Repo: `Dialysis`.** No database changes. No LCC changes.

**Read first:** `life-command-center/docs/architecture/producer-health-and-ci-enforcement.md` §3
(the 2026-09-02 state) and LCC's `.github/workflows/test-suite.yml` (the docs-only-branch pattern).

## Where this stands

PR #7393 unmasked the pytest line and it is green once on `main` — **3,147 collected / 3,139
passed / 0 failed**, read from the job log of run 33642110673. Good. **But it gates nothing:**
`ci.yml`'s own header says *"CI is NOT a required status check — this repo merges via a local
`git merge` + `git push`"*, and **#7393 itself merged 8 seconds after its test job started.**
*Fails the job* and *blocks the merge* are two different facts. The second is an operator toggle
(Settings → Branches → `main` → required status checks), and **two things must land before Scott
can flip it without breaking the repo.**

## 1. A docs-only change must still REPORT a status

`ci.yml` has `paths-ignore` for `**/*.md`, `docs/**`, `audit/**`, `**/*.txt`. **A skipped run
reports no status, so once `Run Tests` is required every docs-only PR is blocked forever** — LCC
hit exactly this on 2026-08-27 (N9) and solved it with a docs-only branch inside `test-suite.yml`:
a ~1 s job with no `setup-python`, no `pip install`, that runs the one guard that must see docs
(there, the conflict-marker test) and reports under the **same check name**.

Do the same here. The required check must be **one name that always reports**, whichever path a
PR takes. Keep the runner-minute saving: the docs-only branch must not install the requirements.
State in the PR body which check name Scott should require, exactly as GitHub will display it.

⚠️ **Do not remove `paths-ignore` wholesale** — that spends a full 11-minute run on every
markdown edit and is the reason it exists.

## 2. Ruff is masked and RED on `main` today — clear the red, then unmask ONE step

Both ruff steps carry `continue-on-error: true`. Run 33642110673 shows *Lint & Type Check* green
with **11 ruff errors** behind it:

- **`.tmp_source_gap_classify.py`** and **`.tmp_prop_diag.py`** at the repo root — E501 ×6.
  These are committed scratch files. **Delete them** (they are the Dialysis version of the
  root-clutter LCC swept on 2026-08-27; check `git log` for whether anything imports them — nothing
  should).
- **`alias_review.py`** — E402 ×2 (imports not at top), F401 ×2 (`datetime`, `time_utils.utc_now`
  unused). Fix the four lines; do not suppress with `# noqa`.

Then, **in this order and only this far:**

1. Remove `continue-on-error` from **`ruff check`** only. Prove it green on `main`.
2. **Do NOT unmask `ruff format --check` in this PR.** Measure it first: run it locally and report
   the file count it would flag. If it is more than a handful, that is a separate formatting PR,
   and unmasking it now is the *"never green once on `main`"* trap.

⚠️ **Same discipline as the pytest unmask:** clear the red first, one line, green on `main`, then
it counts. Add a guard test in the same shape as the unmask guard (5/5 mutations RED on
`|| echo`) that fails if `continue-on-error: true` reappears on the `ruff check` step — step-
anchored, not file-wide (`producer-health-and-ci-enforcement.md` §3: *"a guard written for an
INSTANCE does not cover the CLASS"*).

## 3. Verify-don't-trust residue from #7393

- **The `exit code 128` gitlink warning.** #7393 removed three `.claude/worktrees/*` gitlinks. Its
  absence has **not** been read from a checkout-step log yet. Read the checkout step of your PR's
  run and quote the result either way.
- **The gate has only ever been seen GREEN.** Before opening the real PR, push a throwaway branch
  with one deliberately failing test and confirm the `Run Tests` job goes RED on the runner. Delete
  the branch. Report the run id. A gate that has never been seen to fail is a claim.

## What NOT to do

- Do not touch `pip-audit`, the secrets grep, or the two `src` imports — those are
  `B6e-ci-mask-security` / `B6e-ci-mask-srcimport` and each has a different blast radius.
- Do not merge before CI finishes. #7393 merged 8 s in; LCC's #1793 merged 58 s in. **Wait for the
  run, read the log, then merge** — this is the last PR that can legitimately merge without the
  gate, so let it be the one that demonstrates the discipline.

## Report back

The required-check name exactly as displayed · the docs-only job's runtime · ruff before/after
counts on `main` (11 → ?) · the `ruff format --check` measured count (not unmasked) · the RED-run
id from the throwaway branch · whether `exit code 128` is gone from checkout · pytest
collected/passed/failed from the log (`executed` must not fall below 3,147).

**Then Scott flips the toggle (`B6e-ci-required-check`), and the B6 CI arc is closed.**
