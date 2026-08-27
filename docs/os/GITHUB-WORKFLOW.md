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

## 5. Common errors, and what they actually mean

| message | cause | fix |
|---|---|---|
| `Required status check "npm test" is expected` | you pushed **directly to `main`** | open a PR (§2) |
| `cannot pull with rebase: You have unstaged changes` | a dirty working tree | `git stash` → pull → `git stash pop`, or commit them first |
| `The upstream branch of your current branch does not match the name of your current branch` | your local branch has a different name from its upstream | `git push origin HEAD` (same-named branch) — **never `HEAD:main`** |
| `warning: … CRLF will be replaced by LF` | **not a defect.** `.gitattributes` already normalises to LF. Windows editors write CRLF; git converts on the way in, exactly as configured | ignore it |
| `Unable to create '.git/index.lock'` | a Windows git process holds the lock; **the sandbox cannot delete it** | `Remove-Item .git\index.lock` from PowerShell |
| CI red on your PR | **check the base branch first** — it may already be red on `main` | if `main` is red it is not your PR; see §4 |

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
