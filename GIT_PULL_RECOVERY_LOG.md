# Git Pull Recovery Log

## Objective
- Resolve the failed `git pull --tags origin main` without losing local work.

## Current Findings
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

## What This Means
- The `HEAD.lock` file should not be removed until those active Git processes are no longer running.
- Even after the lock issue is cleared, `git pull` will still fail until local changes in `index.html` and `sw.js` are either committed, stashed, or discarded.
- Because `app.js` and `sw.js` currently show `MM`, there is staged and unstaged local work that must be preserved during recovery.
- The remaining sync blocker is now branch divergence plus local staged/unstaged changes, not the `HEAD.lock` error itself.
- The recurring lock strongly suggests an external Git client is repeatedly starting a commit/sync flow and leaving orphaned `git.exe` processes behind.

## Safe Recovery Path
1. End any stuck Git/editor process that is holding the repository lock.
2. Remove `.git/HEAD.lock` only after no Git processes remain.
3. Preserve local work with `git stash push -u` or by committing.
4. Run `git pull --tags origin main`.
5. Reapply local work with `git stash pop` if stashed.
6. Retry the original sync or commit flow after the lock and local divergence are cleared.

## Latest Status
- `HEAD.lock` has been removed.
- Git can now prepare a commit again.
- Current branch state is now `main...origin/main [behind 2]`.
- Current staged changes are `app.js`, `gov.js`, and `sw.js`.
- Current unstaged changes are `app.js`, `detail.js`, and `sw.js`.

## Likely Cause
- The repeated command shape matches a GUI-driven Git sync/commit flow rather than a manual CLI command.
- Because no custom hooks or `core.editor` setting were found in this repository, the most likely source is the active Git client integration rather than repo-local Git configuration.

## Notes
- Local diffs indicate user work is present; do not discard changes unless explicitly requested.
