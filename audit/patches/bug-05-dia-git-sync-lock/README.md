# Bug #5 — Dia repo git sync error / VS Code locked file

Standard `.git/index.lock` cleanup. No code patch — just the recovery
procedure that's worked on the LCC repo earlier in the sprint.

## Recovery

Run from PowerShell **in the Dialysis repo root** (not the LCC repo):

```powershell
# 1. Locate the dia repo. If you have a separate "dialysis" folder under your
#    workspace, cd into it. Otherwise list candidates:
Get-ChildItem -Path C:\Users\scott -Recurse -Filter ".git" -Hidden -Directory `
  -Depth 4 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName

# 2. Close VS Code entirely (so its Git extension releases file handles).

# 3. Remove any stale lock files in the dia repo:
cd C:\path\to\dialysis-repo
Get-ChildItem -Path .git -Recurse -Filter "*.lock*" -Force | Remove-Item -Force

# 4. If "fatal: another git process seems to be running" persists:
#    a. Check for orphan git processes:
Get-Process git -ErrorAction SilentlyContinue | Stop-Process -Force
#    b. Re-list locks:
Get-ChildItem -Path .git -Recurse -Filter "*.lock*" -Force

# 5. Sanity check:
git status
git fetch
git pull --ff-only
```

## VS Code-specific gotchas

- **Git extension keeps file handles open.** If `git status` works from
  PowerShell but VS Code's Source Control panel shows "git not available"
  or "index lock," close VS Code, run step 3 above, reopen.
- **"Sync" button greyed out.** Usually means there's a merge conflict or
  detached HEAD. `git status` from PowerShell will tell you.
- **Multiple workspace folders.** If your VS Code workspace contains
  several git repos (e.g. LCC + Dialysis side by side), the lock might be
  on the OTHER repo. Check the bottom-left status bar for which repo is
  active.

## If none of the above fixes it

Paste the exact error message from VS Code's Source Control panel
("Show output" → Git extension log). The text in there usually names the
file holding the lock.
