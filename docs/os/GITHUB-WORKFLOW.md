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

# 0b. ⚠️ KNOW WHAT YOUR DIRTY FILES ARE. In this repo a dirty tree is the NORMAL state —
#     Cowork writes edits into the working tree continuously, so there are almost always
#     uncommitted changes. Dirtiness itself is fine and usually IS the work you are about
#     to commit.
#
#     The danger is narrower: `git checkout main` and `git pull --rebase` REFUSE to run
#     against a dirty tree, PowerShell carries on to the next command regardless, and you
#     branch off a STALE BASE with nothing announcing it. Three branches were cut that way
#     in one evening; one cost a full merge-resolution cycle across two files.
#
#     So the rule is conditional, not absolute:
#       - Already ON main and up to date?  A dirty tree is FINE — those edits ride onto
#         your new branch, which is normally exactly what you want.
#       - Need to SWITCH or PULL?          Commit or stash FIRST, then confirm the switch
#         and the pull actually succeeded (§4c) before branching.
git status                        # read it; do not skip past it

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

# 4. Open the PR (the URL is printed by the push above), let CI finish, then merge from
#    the GitHub UI once "App boots" AND "npm test" are both green.
#
#    ⚠️ EXPECT A THIRD STEP. Branch protection requires branches to be up to date, so if
#    `main` moved while you were working, the PR shows "This branch is out-of-date with
#    the base branch" and Merge stays disabled EVEN WITH BOTH CHECKS GREEN. That is a
#    normal gate, not an error. Click "Update branch", wait for BOTH CHECKS TO RE-RUN
#    against the new merge (~3 min), then merge. With two audit windows active, `main`
#    usually has moved — treat this as the common path, not the exception.

# 5. After the merge, if the change touched JS/API code:
git checkout main; git pull --rebase
npm run verify:deploy --wait=180
```

**Branch naming:** `docs/…` · `fix/…` · `feat/…` · `chore/…` · `claude/…` (Claude Code's own).
Anything is acceptable except working directly on `main`.

> ### ⚠️ The numbered steps are a CHECKLIST, not a suggestion — abbreviating it is where the
> ### failures come from
>
> Every loop step above exists because skipping it broke something here. When the sequence gets
> compressed for readability, the step that gets dropped is a guard, and the failure lands on
> whoever runs it:
>
> | dropped step | what happened |
> |---|---|
> | `Remove-Item .git\index.lock` (step 0) | **every** `add` / `commit` / `merge` / `checkout --` failed with *"Another git process seems to be running"* — while `checkout -b` succeeded, so the branch existed and nothing was in it |
> | `git status` after `git pull --rebase` (step 1) | the pull had silently refused on a dirty tree → **three stale-base branches**, one costing a full merge-resolution cycle |
>
> **Paste the whole block, including the lines that look like no-ops.** `Get-Process git` before
> deleting the lock is the one judgement call: **empty output means the lock is stale and safe to
> remove**; a listed process means something is genuinely mid-write and must be closed first.

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

### ⚠️ A green check set goes STALE the moment `main` moves

Branch protection requires branches to be up to date, so two green checks are **not** sufficient
on their own. If `main` advanced while your PR sat there, GitHub shows **"This branch is
out-of-date with the base branch"** and keeps Merge disabled. **This is the gate working, not a
failure** — it is what stops a PR merging green against a base it was never actually tested
against.

**Click "Update branch", then wait for both checks to run AGAIN** against the new merge commit.
Only that second green set describes what will actually land on `main`.

With two audit windows committing, `main` moves often enough that this is the **common path**.
Budget for it: roughly three minutes per re-run, and if `main` moves again during the re-run you
may do it twice. **Merging the moment the first green appears is how PR #1793 shipped a red
suite** — the checks were still running.

## 2a. ⚠️ WHILE `.git/index.lock` IS HELD, `git status` FROM THE SANDBOX IS NOT TRUSTWORTHY

**2026-08-27.** Cowork inspected the repo, reported the working tree as "two modified files plus two
untracked", and drafted a recovery on that basis. The first command failed immediately:

```
docs/claude-code/STATUS.md: needs merge
error: you need to resolve your current index first
```

There was an **unresolved merge already in progress** — `STATUS.md` was `UU` (both modified) — and
the sandbox's `git status` never showed it. With the lock held, git cannot refresh the index, so it
answers from stale state: the `UU` line was simply absent. Every command in the drafted sequence
assumed a clean tree, so the branch was never created, the cherry-pick refused, and a later
`git add -A` re-staged the very conflict markers §2b was written about.

**This is the same class as everything else in this file: a surface that answers confidently
instead of erroring.**

**The rule:** §6 rule 4 permits read-only git from the sandbox — but **not while the lock exists.**
Before trusting any sandbox-read repo state:

```powershell
Remove-Item .git\index.lock -ErrorAction SilentlyContinue   # Windows only; the sandbox cannot
git status                                                  # then read it HERE, not from Cowork
```

**And always read `git status` unfiltered.** The Cowork call that missed this piped through
`grep -v test/fixtures`, which would have hidden a `UU` line even if git had reported one. Filter
the output you *show*, never the output you *judge from*.

**Recovery, when it does happen:** `git reset --hard origin/main` is the right move and it is safe
for committed work — it moves the branch pointer and **does not delete commits**. Anything of value
is still in the reflog (`git log --oneline -1 <sha>`). Losing two documentation notes that can be
rewritten in one turn is cheaper than a bad conflict resolution on a hot file.

## 2b. ⚠️ `git stash pop` after a long gap WILL conflict — and `git add -A` commits the markers

**This happened on 2026-08-27 and reached `main`.** `docs/claude-code/STATUS.md` was merged
carrying `<<<<<<< Updated upstream` / `=======` / `>>>>>>> Stashed changes`.

The sequence that produced it is the one in §2, and it is a **correct** sequence — with one missing
step:

```powershell
git stash -u          # park local edits
git checkout main
git pull --rebase     # ← local main was 10 commits BEHIND
git checkout -b <branch>
git stash pop         # ← conflicted, silently, in the working tree
git add -A            # ← staged the conflict markers
git commit            # ← and committed them
```

**Two things make this near-certain rather than unlucky:**

1. **The longer you were behind, the worse it is.** `STATUS.md` is the most-written file in the
   repo — Cowork and Claude Code both append to it every session. Ten commits of drift means a
   collision on that file is the expected outcome, not the exception.
2. **`git add -A` is the amplifier.** It stages everything including a half-merged file. `git
   commit` does not refuse conflict markers, and neither did any check.

**THE MISSING STEP — do this after every `stash pop`:**

```powershell
git stash pop
git status                       # "Unmerged paths" means STOP and resolve
git diff --check                 # flags whitespace AND leftover conflict markers
git grep -nE '^(<<<<<<< |>>>>>>> |=======$)'   # belt and braces; expect NO output
```

**Resolving a chronological log like `STATUS.md`: keep BOTH sides.** The entries are *additions*,
not alternatives — order them newest-first and delete only the three marker lines.

**⚠️ But do not generalise "keep both" into a rule.** CLAUDE.md records the opposite case: a
conflict resolution that kept both sides of a `setup-node` step produced **two `node-version` keys
in one mapping**, which was structurally invalid, and GitHub could not build a run from the file —
so the required check reported *nothing* and no re-run fixed it. **Ask whether the two sides are
alternatives or additions.** Prose in a log: additions. A key in a mapping: alternatives.

**The guard now enforces the last line of that checklist automatically** —
`test/no-conflict-markers.test.mjs` (shipped 2026-08-27 with the repair for
`docs/architecture/panel-redesign-verification.md`, which carried the same damage from an earlier
merge) fails naming file and line, and runs **even on documentation-only PRs**, which is the only
reason it can see this file at all (§3a, §4b). It landed after this repair, as it had to: it was
red on `STATUS.md` until this repair merged.

## 3a. Documentation-only PRs skip the suite (2026-08-27) — ✅ **PROVEN IN PRODUCTION**

> **The skip path executed for the first time on the `fix/status-conflict-markers` PR and reported
> green in seconds instead of ~3 minutes.** Recorded deliberately, because §6 rule 3 says a CI job
> is not shipped until it has been green once on `main` — and **the skip branch of a conditional
> job is a second code path needing its own first green run.** The PR that *introduced* the skip
> touched `.github/workflows/`, so it correctly ran the full suite and proved nothing about the
> skip itself.
>
> **If `npm test` ever sits at `Expected` on a docs-only PR, revert `test-suite.yml` immediately** —
> that is the `paths-ignore` deadlock arriving by another route.
>
> ⚠️ **The docs-only path is not empty.** `test/no-conflict-markers.test.mjs` still runs on it, and
> must: both committed-marker instances found on 2026-08-27 were `docs/*.md`, and the `STATUS.md`
> one arrived **through a documentation-only PR (#1801)**. A guard that cannot see the population
> it exists for is not a guard. It costs ~1 second and needs no `npm ci`.

Scott: *"only require tests when a substantive change that requires a test gets pushed or merged.
It's not worth the wait for minor or documentation changes."*

`npm test` now decides internally whether the suite is warranted. A PR whose changed files are
**all** documentation reports green in ~15 seconds instead of ~3 minutes.

**⚠️ It is deliberately NOT implemented with `paths-ignore`, and that distinction is the whole
point.** A **required** status check that never runs is not "skipped" — GitHub reports it as
**Expected** forever and the PR becomes unmergeable. Adding `paths-ignore` to a required check is
the most common way to deadlock a protected branch, and it would have re-created the exact
rejection this file was written for. **The job always runs and always reports; only the work inside
it is conditional.**

| | |
|---|---|
| skipped | every changed file matches `docs/`, `*.md`, `LICENSE`, `.github/ISSUE_TEMPLATE/` |
| **runs** | **anything else — the direction is fail-safe.** An unrecognised path runs the suite |
| **runs** | **`.sql` migrations** — several guards assert on SQL/source *content*, so a migration genuinely can turn a test red |
| **runs** | **every push to `main`**, regardless of content — it is the base every branch is cut from |
| **runs even when skipped** | **the conflict-marker guard** (`test/no-conflict-markers.test.mjs`) — committed markers land in *prose*, so exempting docs would blind it to its whole population (§2b, §4b). ~1 s, no `setup-node`, no `npm ci` |

## 3b. ⚠️ `npm test` is NOT a reliable pre-push gate on Windows

**Measured 2026-08-27.** Four test files fail on Scott's Windows machine and **pass on Linux —
59 tests, 0 failures** — including in CI, which is `ubuntu-latest`:

`lease-ocr-backfill` · `sf-deal-promotion` · `sf-file-collector` · `sf-file-discovery`

The cause is platform-native path separators. `scripts/lease-ocr-backfill.mjs:144` ends
`return join(libraryRoot, ...rel.split('/'))`, and `path.join` emits `\` on Windows:

```
actual:   '\Users\scott\Team Briggs - Documents\PROPERTIES\x.pdf'
expected: '/Users/scott/Team Briggs - Documents/PROPERTIES/x.pdf'
```

**The code is correct and the test is over-specified.** `localPathFor` builds a path for the local
filesystem; a backslash on Windows *is* the right answer. The test asserts a POSIX string literal
against a platform-native operation.

**Consequences, both worth internalising:**

1. **§3's advice "run `npm test` locally before you push" does not hold on Windows** — you will see
   red that CI will not. Treat a local failure in one of those four files as environmental until
   proven otherwise, and **check the file name against the list above before debugging.**
2. **The fix is in the tests, not the code:** assert against `path.join(...)` (or normalise
   separators before comparing) so the expectation is platform-native too. Backlog **N12**.

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

**The worst case is the one with no symptom at all, and it was live on `main` for 75 days.**
`docs/architecture/panel-redesign-verification.md` carried the conflict **markers themselves** as
file content — 148 lines of them, committed by `5bbe8c0f`. **Git does not flag this**: there is no
`UU`, because as far as git is concerned the conflict *was* resolved. Prose has no parser, so
nothing else caught it either. In YAML the same mistake made a workflow unrunnable and was
therefore loud; in prose it silently voided half a verification document. **Guard, shipped
2026-08-27:** `test/no-conflict-markers.test.mjs` scans every tracked text file and fails naming
file and line. ⚠️ A bare `=======` is a valid Markdown setext underline, so it is reported **only
inside** a `<<<<<<<`…`>>>>>>>` span — if a file legitimately needs a start-of-line marker, exclude
it **by path** via that test's `ALLOWLIST`; weakening the pattern is how the detector would start
returning comfortable zeros.

**⚠️ And it is a PATTERN, not one file — the guard's very first CI run caught a second, live
instance.** `docs/claude-code/STATUS.md`, described in full in **§2b** (a `git stash pop`, repaired
on `main` in PR #1804). The durable lesson §2b does not carry: its markers read
`<<<<<<< Updated upstream` / `>>>>>>> Stashed changes`, **not** `HEAD` and a sha — so **match on the
marker CHARACTERS, never on the label text after them**, or the stash flavour walks straight past.

**⚠️ The documentation-only skip (§3a) had made this guard blind to exactly the files it exists
for.** **Both instances are `docs/*.md`**, and PR #1801 was itself documentation-only — so the
guard would never have run on the PR that introduced the second one. The docs-only branch of
`test-suite.yml` therefore runs `node --test test/no-conflict-markers.test.mjs` on its own: ~1
second, no `setup-node`, no `npm ci` (node builtins + git only), so the skip still does what it was
added to do. **A guard that cannot see the population it exists for is not a guard.**

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

**⚠️ But do not over-correct into "the tree must always be clean."** That rule would be violated
almost every time it is read — Cowork edits the tree continuously — and **a rule you have to break
daily stops being a rule.** Dirty is fine when you are *already on* an up-to-date `main`: those
edits ride onto the new branch, which is usually the intent. The failure needs **a switch or a
pull that silently refused**.

**The rule: if you must SWITCH or PULL, clear the tree first — then verify twice —**

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
