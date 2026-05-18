# QA-31 — Sandbox tooling notes (Edit tool truncation workaround)

**Severity: P3 documentation.** During QA-29 I encountered a silent
truncation bug when using the Cowork `Edit` tool on `dialysis.js`
(615 KB) and `gov.js` (506 KB). The bug almost caused QA-29 to ship a
corrupted file. I reproduced the bug in a controlled test and wrote
up the findings + workaround. This patch commits the documentation so
future sessions inherit the knowledge.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-31-sandbox-tooling-notes
node audit/patches/qa-31-sandbox-tooling-notes/apply.mjs --dry
node audit/patches/qa-31-sandbox-tooling-notes/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-31-sandbox-tooling-notes/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-31-sandbox-tooling-notes -m "Merge audit/qa-31-sandbox-tooling-notes"
git push origin main
```

## What the bug is

The Cowork sandbox exposes `C:\` to the Linux VM via virtiofs/FUSE.
The `Edit` tool's atomic-write pattern is unreliable on this mount for
files >~500KB: the edit content is applied correctly, but the file's
last ~30 to ~9,000 bytes are silently dropped.

**Confirmed reproduction (2026-05-18):**
- File: `dialysis.js`, 614,710 bytes / 10,928 lines
- Operation: one `Edit` tool call adding 15 chars near line 10920
- Result: file size 614,710 bytes (unchanged!), 3 lines lost from end,
  tail truncated mid-string

During QA-29 itself, ~7 sequential edits compounded to drop 183 lines
(9,369 bytes) from `dialysis.js`, including the entire QA-25 modal
handler that was already deployed and working live. I caught it before
committing only because the apply.mjs sentinel check failed on the
missing modal-handler text.

## What the doc contains

`audit/SANDBOX_TOOLING_NOTES.md` covers:

- The bug's symptoms and how to detect it (post-edit `wc -l` + `tail` check)
- The Python-via-bash workaround for large files
- Other related mount quirks (`git checkout` and `rm` blocked by
  no-unlink permission)
- List of currently-at-risk files in this repo
- Recovery checklist if truncation does occur

## Why a patch, not just `git add`

Keeping the audit-patch pattern intact: every change ships through
`apply.mjs` so AUDIT_PROGRESS.md gets a tracked closeout entry. The
apply step is minimal here (only updates AUDIT_PROGRESS.md — the doc
itself is already on disk and committed via `git add -A`), but
preserves the audit trail.

## Files changed

- `audit/SANDBOX_TOOLING_NOTES.md` — new documentation file
- `audit/patches/qa-31-sandbox-tooling-notes/` — patch package
- `AUDIT_PROGRESS.md` — closeout entry

No code changes. No SQL. No migrations. No Edge Function.
