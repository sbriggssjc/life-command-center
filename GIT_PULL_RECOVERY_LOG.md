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

## What This Means
- The `HEAD.lock` file should not be removed until those active Git processes are no longer running.
- Even after the lock issue is cleared, `git pull` will still fail until local changes in `index.html` and `sw.js` are either committed, stashed, or discarded.

## Safe Recovery Path
1. End any stuck Git/editor process that is holding the repository lock.
2. Remove `.git/HEAD.lock` only after no Git processes remain.
3. Preserve local work with `git stash push -u` or by committing.
4. Run `git pull --tags origin main`.
5. Reapply local work with `git stash pop` if stashed.

## Notes
- Local diffs indicate user work is present; do not discard changes unless explicitly requested.
