# Git Pull Recovery Log

## Objective
- Resolve the failed `git pull --tags origin main` without losing local work.

## Current Findings
- On 2026-03-30, another commit attempt failed with `fatal: cannot lock ref 'HEAD'` while `.git/HEAD.lock` existed as a 0-byte file created at `2026-03-30 09:32:59` local time.
- A process check for this March 30 recurrence showed three active `git.exe` processes (`93924`, `98956`, `107664`) started at `2026-03-30 10:08:06` local time, alongside a VS Code window titled `git-error-1774883267985 - life-command-center - Visual Studio Code`.
- `git status --short --branch` during this recurrence reports `main...origin/main [ahead 1, behind 2]` with staged `api/sync.js` and unstaged `dialysis.js` plus `styles.css`.
- On 2026-03-27, a later commit failure was caused by a real merge conflict in `gov.js`, not by a lock file.
- `git diff --name-only --diff-filter=U` reported `gov.js` as the only unmerged file.
- The `gov.js` conflict spanned the full file, and the richer side was preserved by keeping the `theirs` block content and removing the conflict markers.
- `node --check gov.js` succeeded after the resolution, `git diff --name-only --diff-filter=U` became empty, and `git commit --dry-run --allow-empty-message --file - --allow-empty` now reports `All conflicts fixed but you are still merging`.
- On 2026-03-27, another commit attempt failed with `fatal: cannot lock ref 'HEAD'` while `.git/HEAD.lock` still existed as a 0-byte file with `CreationTime` and `LastWriteTime` `2026-03-26 20:00:50` local time.
- A process check for this March 27 recurrence showed three active `git.exe` processes (`29216`, `50800`, `55556`) started at `2026-03-27 06:27:48` local time.
- `git status --short --branch` during this recurrence reports `main...origin/main [ahead 1, behind 2]` with staged changes in `LCC_LIVE_INGEST_WORKLOG.md` and `test/live-ingest-normalize.test.js`, plus an unstaged change in `api/_shared/live-ingest-normalize.js`.
- On 2026-03-26, another commit attempt failed with `fatal: cannot lock ref 'HEAD'` while `.git/HEAD.lock` existed as a 0-byte file created at `2026-03-26 15:33:33` local time.
- A process check for this recurrence showed three active `git.exe` processes (`11280`, `24512`, `54352`) started at `2026-03-26 15:39:36` local time.
- `git status --short --branch` still succeeds during this recurrence and reports `main...origin/main [ahead 1]` with staged modifications in `LCC_LIVE_INGEST_WORKLOG.md`, `app.js`, and `styles.css`.
- On 2026-03-26, another GUI-style commit attempt failed with `fatal: cannot lock ref 'HEAD'` while `.git/HEAD.lock` existed as a 0-byte file created at `2026-03-26 14:45:41` local time.
- A process check for that recurrence showed three active `git.exe` processes (`27372`, `34904`, `54584`) started at `2026-03-26 15:21:40` local time.
- `git status --short --branch` still succeeds during this recurrence and currently reports `main...origin/main` with `MM app.js` plus modified worklogs, which means the repository is readable while `HEAD` writes are blocked.
- On 2026-03-26, `app.js` was resolved by keeping the richer `theirs` side of the single remaining Live Ingest conflict block and removing the conflict markers.
- `node --check app.js` succeeded after that resolution.
- `git diff --name-only --diff-filter=U` is now empty.
- `git commit --dry-run --no-edit` now reports `All conflicts fixed but you are still merging`, which confirms the merge blocker has been cleared and only the merge commit remains.
- On 2026-03-26, `git pull --tags origin main` failed with `Pulling is not possible because you have unmerged files`.
- `git diff --name-only --diff-filter=U` now reports a single unresolved file: `app.js`.
- `git status --short --branch` at this point reports `main...origin/main [ahead 1, behind 6]`.
- Additional local changes present during this merge state: `api/data-proxy.js`, `flow-loopnet-backfill.json`, `flow-rcm-backfill.json`, `ops.js`, and `styles.css`.
- A follow-up attempt to resolve `app.js` mechanically was reverted with `git checkout --conflict=merge -- app.js` so the file is back in its original conflict-marker state.
- On 2026-03-26, a later commit attempt failed with `fatal: cannot lock ref 'HEAD': Unable to create ... .git/HEAD.lock: File exists.`
- `.git/HEAD.lock` is 0 bytes with `CreationTime` and `LastWriteTime` `2026-03-26 10:14:26` local time.
- A process check at `2026-03-26 10:20:45` local time showed three active `git.exe` processes (`22892`, `27072`, `36924`) alongside multiple `Code` processes.
- `git status --short --branch` still succeeds during this failure and reports `main...origin/main [ahead 1]`, which indicates the repository remains readable while `HEAD` writes are blocked.
- On 2026-03-26, `git add -A -- .` failed with `fatal: Unable to create ... .git/index.lock: File exists.`
- The current lock file is `.git/index.lock`, not `.git/HEAD.lock`.
- `.git/index.lock` is 0 bytes with `CreationTime` `2026-03-26 10:03:56` and `LastWriteTime` `2026-03-26 10:03:59` local time.
- A process check at `2026-03-26 10:12` local time showed no active `git.exe` process, only `Code` processes.
- Branch state: `main...origin/main [ahead 1, behind 2]`
- Blocking files for pull: `index.html`, `sw.js`
- Additional modified file: `gov.js`
- `index.html` has both staged and unstaged changes.
- `sw.js` has both staged and unstaged changes.
- `.git/HEAD.lock` exists.
- Multiple `git.exe` processes were still running when checked on 2026-03-17.
- On 2026-03-18, a commit/sync attempt failed with `fatal: cannot lock ref 'HEAD'`.
- `.git/HEAD.lock` in this repo is a 0-byte file created at `2026-03-18 09:20:22` local time.
- Ten `git.exe` processes were still present when checked at `2026-03-18 09:26` local time.
- `git status` and `git rev-parse --verify HEAD` still succeed, which suggests the repository is readable and the current blocker is the stale or still-held `HEAD.lock`.
- On a follow-up check at `2026-03-18 09:28:58` local time, three fresh `git.exe` processes were still being spawned while the same `HEAD.lock` remained in place.
- Those stuck `git.exe` processes were terminated and `.git/HEAD.lock` was removed successfully on 2026-03-18.
- A subsequent `git commit --dry-run --allow-empty-message --file - --allow-empty` succeeded, confirming the `HEAD` write lock problem is resolved.
- The `HEAD.lock` issue recurred later on 2026-03-18.
- On the recurrence check, `.git/HEAD.lock` had `CreationTime` `2026-03-18 09:51:15` and `LastWriteTime` `2026-03-18 10:11:11`.
- Three new `git.exe` processes were again present, all started at `2026-03-18 10:21:38` local time.
- After terminating those `git.exe` processes and removing `.git/HEAD.lock`, `git commit --dry-run --allow-empty-message --file - --allow-empty` succeeded again.
- The `HEAD.lock` issue recurred again later on 2026-03-18.
- On this later recurrence, `.git/HEAD.lock` had `CreationTime` `2026-03-18 10:29:02` local time.
- Three fresh `git.exe` processes were again present, all started at `2026-03-18 10:46:35` local time.
- After terminating those processes and removing `.git/HEAD.lock`, Git reported that the repository is in a merge state with all conflicts already fixed.
- The `HEAD.lock` issue recurred again during a `git pull --tags origin main` attempt on 2026-03-18.
- On this recurrence, `.git/HEAD.lock` had `CreationTime` `2026-03-18 11:09:07` local time.
- Three fresh `git.exe` processes were again present, all started at `2026-03-18 11:15:32` local time.
- There was no active `MERGE_HEAD`, `REBASE_HEAD`, or related in-progress Git operation metadata at that time.
- After terminating those processes and removing `.git/HEAD.lock`, the next `git pull --tags origin main` failure in this environment was a network connection error to GitHub, not a ref-lock error.
- The `HEAD.lock` issue recurred again later on 2026-03-18 during another GUI-driven commit attempt.
- On this recurrence, `.git/HEAD.lock` had `CreationTime` `2026-03-18 11:30:56` and `LastWriteTime` `2026-03-18 16:51:58` local time.
- Three fresh `git.exe` processes were again present, all started at `2026-03-18 17:01:54` local time.
- After terminating those processes and removing `.git/HEAD.lock`, Git again reported `All conflicts fixed but you are still merging.`
- The `HEAD.lock` issue recurred again later on 2026-03-18 during another GUI-driven commit attempt.
- On this recurrence, `.git/HEAD.lock` had `CreationTime` `2026-03-18 17:32:17` and `LastWriteTime` `2026-03-18 19:32:56` local time.
- Three fresh `git.exe` processes were again present, all started at `2026-03-18 19:49:54` local time.
- After terminating those processes and removing `.git/HEAD.lock`, `git commit --dry-run --allow-empty-message --file - --allow-empty` succeeded and Git reported the branch was up to date with `origin/main`.
- The `HEAD.lock` issue recurred again later on 2026-03-18 during another GUI-driven commit attempt.
- On this recurrence, `.git/HEAD.lock` had `CreationTime` `2026-03-18 20:09:08` local time.
- Three fresh `git.exe` processes were again present, all started at `2026-03-18 20:26:58` local time.
- After terminating those processes and removing `.git/HEAD.lock`, `git commit --dry-run --allow-empty-message --file - --allow-empty` succeeded again.
- The `HEAD.lock` issue recurred again during a later `git pull --tags origin main` attempt on 2026-03-18.
- On this recurrence, `.git/HEAD.lock` had `CreationTime` `2026-03-18 20:33:35` local time.
- Three fresh `git.exe` processes were again present, all started at `2026-03-18 20:40:28` local time.
- After terminating those processes and removing `.git/HEAD.lock`, the next `git pull --tags origin main` failure in this environment was again GitHub network connectivity, not a ref-lock failure.
- The `HEAD.lock` issue recurred again on 2026-03-19 during another GUI-driven commit attempt.
- On this recurrence, `.git/HEAD.lock` had `CreationTime` `2026-03-19 07:47:51` and `LastWriteTime` `2026-03-19 07:58:51` local time.
- One fresh `git.exe` process was present, started at `2026-03-19 08:02:13` local time.
- After terminating that process and removing `.git/HEAD.lock`, the same `git commit --dry-run --allow-empty-message --file - --allow-empty` no longer failed with a ref-lock error.
- The `HEAD.lock` issue recurred again on 2026-03-19 during a later `git pull --tags origin main` attempt.
- On this recurrence, `.git/HEAD.lock` had `CreationTime` `2026-03-19 08:17:24` local time.
- Three fresh `git.exe` processes were present, all started at `2026-03-19 08:29:26` local time.
- After terminating those processes and removing `.git/HEAD.lock`, the next `git pull --tags origin main` failure in this environment was again GitHub network connectivity, not a ref-lock failure.
- On 2026-03-20, the failure mode changed from `HEAD.lock` to unresolved merge conflicts.
- The repository has active merge metadata (`MERGE_HEAD` and `MERGE_MSG` are present).
- `git diff --name-only --diff-filter=U` reports two unresolved files: `app.js` and `sql/20260320_crm_rollup_sf_tasks_union.sql`.
- Conflict marker locations found:
  - `app.js`: lines `1225`, `1281`, `1332`
  - `sql/20260320_crm_rollup_sf_tasks_union.sql`: lines `2`, `37`, `46`, `59`, `61`, `62`, `67`, `136`, `175`

## What This Means
- The sync blocker has moved from lock files to a real content merge in `app.js`.
- The repository should not be pulled again until `app.js` is resolved, staged, and the in-progress merge is completed with a commit.
- This recurrence matches the earlier pattern where a GUI-driven commit flow leaves orphaned `git.exe` processes behind and blocks `HEAD` updates.
- `.git/HEAD.lock` should not be removed until those active `git.exe` processes are terminated.
- The current blocker is a stale index lock file left behind by an interrupted staging operation.
- Because no `git.exe` process is active, removing `.git/index.lock` is the safe next step.
- The `HEAD.lock` file should not be removed until those active Git processes are no longer running.
- Even after the lock issue is cleared, `git pull` will still fail until local changes in `index.html` and `sw.js` are either committed, stashed, or discarded.
- Because `app.js` and `sw.js` currently show `MM`, there is staged and unstaged local work that must be preserved during recovery.
- The remaining sync blocker is now branch divergence plus local staged/unstaged changes, not the `HEAD.lock` error itself.
- The recurring lock strongly suggests an external Git client is repeatedly starting a commit/sync flow and leaving orphaned `git.exe` processes behind.
- The current Git client is likely trying to create the merge commit and getting interrupted or orphaned before it can finish, which explains why the same `HEAD.lock` error keeps returning on a commit command.
- Even when the lock is cleared, a pull cannot be completed cleanly until local staged/unstaged work is either committed or stashed.
- In this Codex environment, outbound GitHub access is also currently blocked, so pull verification from here is limited without escalation.

## Safe Recovery Path
1. Confirm there is no active `git.exe` process.
2. Remove `.git/index.lock`.
3. Retry `git add -A -- .` to confirm the index is writable again.
4. If the lock immediately returns, stop any Git-enabled editor sync flow and repeat the process check before removing it again.
1. End any stuck Git/editor process that is holding the repository lock.
2. Remove `.git/HEAD.lock` only after no Git processes remain.
3. Preserve local work with `git stash push -u` or by committing.
4. Run `git pull --tags origin main`.
5. Reapply local work with `git stash pop` if stashed.
6. Retry the original sync or commit flow after the lock and local divergence are cleared.

## Latest Status
- `HEAD.lock` has been removed.
- Git can now prepare a commit again.
- Current branch state is `main...origin/main [ahead 1, behind 2]`.
- Current staged clean change is `api/_shared/allowlist.js`.
- Current unmerged files are `app.js` and `sql/20260320_crm_rollup_sf_tasks_union.sql`.

## Likely Cause
- The repeated command shape matches a GUI-driven Git sync/commit flow rather than a manual CLI command.
- Because no custom hooks or `core.editor` setting were found in this repository, the most likely source is the active Git client integration rather than repo-local Git configuration.
- The active Git client is most likely retrying a merge-conclusion commit from the UI and leaving a stale `HEAD.lock` behind whenever that flow hangs or gets interrupted.
- The most recent recurrence happened even after the branch returned to a normal up-to-date state, which further points to the Git client integration itself rather than merge state as the root cause of the recurring stale lock.
- The current recurrence happened in a simple staged-delete/untracked-replacement state, which again indicates the lock issue is independent of the content changes and tied to the Git client workflow.

## Notes
- Local diffs indicate user work is present; do not discard changes unless explicitly requested.
