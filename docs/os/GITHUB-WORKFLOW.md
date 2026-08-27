# GitHub workflow — how work reaches `main` (and why your push was rejected)

> **The one-line rule: `main` is protected. You cannot push to it. Every change goes
> branch → PR → CI green → merge.**
>
> This changed on **2026-08-27**, when *"npm test"* became a **required status check**. Every
> habit from before that date — `git push origin <branch>:main`, committing straight onto `main`,
> merging a PR while CI is still running — is now either blocked or unsafe. This file is the
> standard.

---

## 1. Why the push failed

```
remote: - Required status check "npm test" is expected.
! [remote rejected] publish-c868140 -> main (push declined due to repository rule violations)
```

`git push origin publish-c868140:main` is a **direct push to `main`**. A required status check
cannot run on a direct push — there is no pull request for it to attach to — so the rule engine
rejects it before anything else happens. **This is not a transient error and retrying will never
work.** The fix is not a different push command; it is a pull request.

## 2. The standard loop

```powershell
cd $env:USERPROFILE\life-command-center

# 0. Never leave a lock behind (the sandbox cannot delete it; only Windows can)
Remove-Item .git\index.lock -ErrorAction SilentlyContinue

# 0b. ⚠️ CLEAR THE TREE FIRST. In this repo a dirty tree is the NORMAL state, not an
#     exception — Cowork writes edits into the working tree continuously, so there are
#     almost always uncommitted changes when you start. Both `git checkout main` and
#     `git pull --rebase` REFUSE to run against one, and PowerShell keeps going to the
#     next command anyway, so you end up branching off a stale base without noticing.
#     This has caused three separate stale-base branches. Commit or stash, then verify:
git status                        # must be "nothing to commit, working tree clean"

# 1. Start from current main, on a NAMED branch — never on main itself
git checkout main
git pull --rebase
git status        # ⚠️ MUST say "up to date with origin/main". If it says "behind by N",
                  #    the pull FAILED (usually a dirty tree) — fix that first. Branching
                  #    off a stale base is how a branch ends up conflicting (§4c).
git checkout -b docs/<short-topic>        # or fix/… feat/… chore/…

# 2. Commit
git add -A
git commit -m "<what changed and why>"

# 3. Push the BRANCH (not to main)
git push -u origin HEAD

# 4. Open the PR (the URL is printed by the push above), let CI finish,
#    then merge from the GitHub UI once "App boots" AND "npm test" are both green.

# 5. After the merge, if the change touched JS/API code:
git checkout main; git pull --rebase
npm run verify:deploy --wait=180
```

**Branch naming:** `docs/…` · `fix/…` · `feat/…` · `chore/…` · `claude/…` (Claude Code's own).
Anything is acceptable except working directly on `main`.

## 3. ⛔ Wait for CI. Do not merge early.

**PR #1793 was merged 58 seconds after it was opened, before CI finished, carrying a red suite.**
A required check only protects you if you let it run. Both checks must be green:

| check | workflow | what it proves |
|---|---|---|
| **App boots** | `boot-check.yml` | `node --check` sweep + a real `server.js` import — the app starts |
| **npm test** | `test-suite.yml` | the full suite (**4,606** tests) passes |

**Run `npm test` locally before you push.** The suite is fully offline — no secrets, no network,
no database — so a red CI run is almost always reproducible on your machine in less time than the
round trip.

## 4. The Node-version lockout — RESOLVED 2026-08-27

> **Re-measured and rewritten. The section that stood here described a lockout that has since been
> unlocked, and its recommended escape hatch — temporarily removing *"npm test"* from the required
> list — is exactly the failure this rule exists to close. Left uncorrected it would have cost the
> next reader real time, which is why the doctrine says to fix a dated blocker in the same change
> that re-measures it.**

**What happened.** *"npm test"* became a required check while `test-suite.yml` was pinned to
`node-version: '20'`. Four test files import Deno `.ts` edge modules directly:

```
test/availability-checker-parsers.test.js  → supabase/functions/availability-checker/parsers.ts
test/sf-deal-promotion.test.mjs            → supabase/functions/_shared/sf-deal-promotion.ts
test/sf-file-collector.test.mjs            → .ts
test/sf-file-discovery.test.mjs            → .ts
```

Node 22.18+ and Node 24 strip TypeScript types natively, so these resolve. Node 20 has no TS
support and throws `ERR_UNKNOWN_FILE_EXTENSION` at module load. The required check was therefore
red from its first execution — **7 runs, 7 failures**, including the workflow's own PR.

**The tell was the test COUNT, not the failure text.** CI reported **4,568 tests / 868 suites**
against **4,621 / 883** locally. A failing assertion never changes how many tests exist; a module
that cannot load does. Diagnose any future version-skew failure on this check by comparing the
counts first.

**Resolved** by commit `2883d95` ("P196: run required test gate on Node 24"), which pins
`node-version: '24'` — the repository's development/runtime baseline. It reached `main` inside
PR #1795 rather than the dedicated PR #1796, which was closed unmerged. Note the earlier
prescription in this section pointed at a *different* fix on
`claude/split-ownership-history-q797uk` pinning Node 22; that branch's version is not what landed.

**`package.json` still declares `"engines": { "node": ">=20.0.0" }`, which is false for the test
suite** — it needs ≥22.18 to load at all. Whether the *application* still runs on Node 20 is a
separate, unmeasured question that affects the Railway runtime, so the field has deliberately not
been changed. Do not "fix" it without measuring the app.

**Never resolve a red required check by un-requiring it.** An unenforced check is the
badge-people-merge-past failure. Fix the check.

### ⚠️ 4a. Two audit windows fixed this same file independently — check `main` first

The automation window branched `ci/test-suite-node-22` while the app window shipped **P196 pinning
Node 24** to `main`, hours apart. Same correct diagnosis, two defensible Node choices, one wasted
branch. **The prompt-numbering convention keeps *filenames* from colliding and does nothing for
two windows editing the same config file.**

**Before opening a PR that touches shared infrastructure — a workflow, `package.json`, a
migration — check whether `main` already fixed it:**

```powershell
git fetch origin
git log origin/main --oneline -5 -- <the file>
```

Seconds, and it would have made that branch unnecessary before it was pushed. **This rule was
then broken by the session that wrote it** — the §4 rewrite above collided with `574a9bff` doing
the same job. Read that as evidence the check has to be a habit, not a good intention.

### ⚠️ 4b. A conflict resolution that keeps BOTH sides can be structurally invalid

Resolving `ci/test-suite-node-22` against the new `main` left **two `node-version` keys in one
`setup-node` step** (`'22'` and `'24'`). Each hunk was correct in isolation and each carried a
reasoned comment block, so "keep both" felt like the conservative choice. For a **list** it
usually is. For a **key–value mapping it is not** — a duplicate key is invalid, GitHub could not
build a run from the file, and the required check **never reported at all.** The PR was not slow
or flaky; it was unrunnable.

**Distinctive symptom worth memorising: a required check stuck on *"Expected — waiting for status
to be reported"* that no re-run fixes usually means the workflow file itself is invalid, not that
a run is queued.** Re-running cannot help — there is nothing to re-run. Read the file before
hunting for a trigger.

**When resolving a conflict in YAML or JSON, ask whether the two sides are ALTERNATIVES or
ADDITIONS.** Two competing values for one key are alternatives — pick one. Only additions merge.
*(This section is itself an addition, folded onto the account above rather than replacing it.)*

**And the outcome was to abandon the branch, not repair it** — `main` already carried the fix, so
the right move was closing the PR and deleting the branch. **A branch whose purpose has been
served elsewhere is finished, not broken.**

### ⚠️ 4c. Verify the branch base actually updated

`git pull --rebase` **fails silently into your next command** when the tree is dirty
(`cannot pull with rebase: You have unstaged changes`), and so does `git checkout main`
(`Your local changes … would be overwritten`). PowerShell runs the next command regardless, so
`git checkout -b` cuts the branch from a **stale base** and nothing announces it.

**This has now happened three times in one evening** — the first produced a 4-commits-behind
branch that conflicted on two files and cost a full merge-resolution cycle.

**Why it keeps happening here specifically:** Cowork writes edits into the working tree
continuously, so **a dirty tree is this repo's normal state**, not an occasional slip. A procedure
that assumes a clean tree will fail most of the time it is run.

**The rule: clear the tree BEFORE switching, and verify twice —**

```powershell
git status                 # (1) before switching: "working tree clean"
git checkout main
git pull --rebase
git status                 # (2) after pulling: "up to date with origin/main", NOT "behind by N"
git checkout -b <branch>
```

If either check fails, stop and fix it — do not run the next command. **A stale-base branch is
cheap to prevent and expensive to unwind.**


**Status note for whoever reads this next:** the gate has now been **green on `main`**, which is
the bar rule §6.3 sets for a new CI job. It is no longer a badge; it is a gate.

## 5. Common errors, and what they actually mean

| message | cause | fix |
|---|---|---|
| `Required status check "npm test" is expected` | you pushed **directly to `main`** | open a PR (§2) |
| `cannot pull with rebase: You have unstaged changes` | a dirty working tree | `git stash` → pull → `git stash pop`, or commit them first |
| `The upstream branch of your current branch does not match the name of your current branch` | your local branch has a different name from its upstream | `git push origin HEAD` (same-named branch) — **never `HEAD:main`** |
| `warning: … CRLF will be replaced by LF` | **not a defect.** `.gitattributes` already normalises to LF. Windows editors write CRLF; git converts on the way in, exactly as configured | ignore it |
| `Unable to create '.git/index.lock'` | a Windows git process holds the lock; **the sandbox cannot delete it** | `Remove-Item .git\index.lock` from PowerShell |
| CI red on your PR | **check the base branch first** — it may already be red on `main` | if `main` is red it is not your PR; see §4 |
| A required check stuck on *"Expected — waiting for status to be reported"*, and **re-running does nothing** | usually **the workflow file is invalid**, so no run can be produced — commonly a conflict resolution that kept both sides of a key (see §4b) | read the workflow file; fix the file, not the trigger |
| You are about to PR a fix to shared infra (workflow, `package.json`, a migration) | the other audit window may have already fixed it | `git fetch origin && git log origin/main --oneline -5 -- <file>` **before** you push (§4a) |

## 6. Rules that are not negotiable

1. **Never push to `main`.** Not with `:main`, not with force, not "just this once for a docs
   change." The protection exists because a red suite merged silently once already.
2. **Never merge before both checks are green.** A check you outrun is a check you do not have.
3. **A new CI job is not shipped until it has been green once on `main`.** A job red on every run
   is a badge people learn to merge past — which is precisely how `test-suite.yml` shipped broken.
4. **Never run git from the Cowork sandbox.** The `.git/index.lock` is held by Scott's Windows
   process. Cowork hands over PowerShell; Scott runs it. Read-only git (`log`, `merge-base`,
   `diff`) from the sandbox is fine and encouraged.
5. **"Merged" is not "running."** JS ships on a Railway redeploy; SQL migrations are live
   immediately. After a merge that touched `/api/` or the SPA, run `npm run verify:deploy` and
   confirm live `/version` moved. Three assist lanes silently wrote nothing for a day because
   their fixes merged **after** a deploy cutoff.

## 7. Who merges

Scott merges. Claude Code opens PRs and never approves or merges its own. Cowork never runs git at
all — it drafts the PowerShell and Scott executes it.
