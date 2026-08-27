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

# 1. Start from current main, on a NAMED branch — never on main itself
git checkout main
git pull --rebase
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

## 4. ~~CURRENT LOCKOUT~~ — ✅ RESOLVED 2026-08-27. Read this section for the lesson, not the status.

**The gate is green and `main` accepts PRs again.** `test-suite.yml` on `main` now pins
**`node-version: '24'`** (one key, single source) via **P196**, and both `ci/test-suite-node-22`
and the docs PR merged cleanly afterwards (#1797).

### ⚠️ Two lessons from how it got fixed, and they are the durable part

**(a) Two audit windows fixed the same infrastructure independently, hours apart.** The automation
window branched `ci/test-suite-node-22`; the app window shipped **P196 pinning Node 24** to `main`
in the same window of time. Same correct diagnosis (three tests import Deno `.ts` modules), two
different Node choices, both defensible. The prompt-numbering convention keeps *filenames* from
colliding and does **nothing** for two windows editing the same config file.
**→ Before opening a PR that touches shared infrastructure — a workflow, `package.json`, a
migration — re-check whether `main` already fixed it:**

```powershell
git fetch origin
git log origin/main --oneline -5 -- <the file>
```

That takes seconds and would have made this branch unnecessary before it was ever pushed.

**(b) ⚠️ A conflict resolution that keeps BOTH sides can produce something structurally invalid,
and no test will catch it.** Resolving `ci/test-suite-node-22` against the new `main` left **two
`node-version` keys in one `setup-node` step** (`'22'` and `'24'`). Each hunk was correct in
isolation and each carried a well-reasoned comment block, so "keep both" felt like the safe,
conservative choice. For a **list** it usually is. For a **key–value mapping it is not** — a
duplicate key is invalid, GitHub could not produce a run from the file, and the required check
therefore **never reported at all.** The PR was not slow or flaky; it was unrunnable.

**The symptom is distinctive and worth recognising: a required check stuck on *"Expected — waiting
for status to be reported"* that no re-run fixes usually means the workflow file itself is
invalid, not that a run is queued.** Re-running cannot help — there is nothing to re-run.
Check the workflow file before hunting for a trigger.

**When resolving a conflict in YAML or JSON, ask whether the two sides are ALTERNATIVES or
ADDITIONS.** Two competing values for one key are alternatives: pick one. Only additions merge.

**And the outcome was to abandon the branch, not repair it** — `main` already carried the fix, so
the right move was closing the PR and deleting the branch. **A branch whose purpose has been
served elsewhere is finished, not broken.**

<details>
<summary>The original lockout, kept for the record</summary>

**`main` cannot accept any PR right now**, because *"npm test"* is required and
`test-suite.yml` **on `main` is pinned to `node-version: '20'`** — and three test files import
Deno `.ts` edge modules that Node 20 cannot load (`ERR_UNKNOWN_FILE_EXTENSION`, 0 tests run). The
check has never been green on `main`. On Node 22 the same suite is **4,606 pass / 0 fail**.

**The fix already exists** on `origin/claude/split-ownership-history-q797uk` — one commit,
`beb3aecd`, touching only `.github/workflows/test-suite.yml` and `CLAUDE.md`.

**Unlock sequence — do this before anything else:**

1. Open a PR from **`claude/split-ownership-history-q797uk`** → `main`.
   Its own workflow file specifies Node 22, and for a `pull_request` event GitHub runs the
   workflow **as it exists in the merge of head into base** — so this PR runs on 22 and should go
   green. (It may need a rebase: `main` has moved on, and `CLAUDE.md` is edited by both audit
   windows, so expect a possible conflict there.)
2. Merge it. `main` is now on Node 22 and the required check can pass.
3. Re-open every other PR — including the docs branch that was rejected — and they will run green.

**If step 1 still fails**, the escape hatch is an admin bypass, or temporarily removing *"npm
test"* from the required list (Settings → Branches → main), merging the fix, and re-adding it.
**Re-add it** — an unenforced check is the badge-people-merge-past failure this rule exists to
close.

</details>

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
