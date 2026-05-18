# QA-32 — Clean up test artifacts from QA-31 (P3 cleanup)

**Severity: P3 cleanup.** QA-31 accidentally committed 4 synthetic test
files I left behind during the truncation-bug investigation. Removing them.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-32-cleanup-test-artifacts
node audit/patches/qa-32-cleanup-test-artifacts/apply.mjs --dry
node audit/patches/qa-32-cleanup-test-artifacts/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-32-cleanup-test-artifacts/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-32-cleanup-test-artifacts -m "Merge audit/qa-32-cleanup-test-artifacts"
git push origin main
```

## What gets removed

| File                                  | Size       | Why it existed                                       |
|---------------------------------------|-----------:|------------------------------------------------------|
| `audit/edit-tool-test.js`             | 0 bytes    | Truncated copy of `dialysis.js` from controlled bug reproduction |
| `audit/lcc-newline-test.txt`          | 3,000 lines | Newline-mode write test (LF vs CRLF behavior check) |
| `audit/lcc-trunc-test-virtiofs.txt`   | 8,000 lines / 752 KB | Large-file write test to verify mount supports >500KB writes |
| `audit/lcc-write-test.txt`            | 1,000 lines | Basic Python-write smoke test                       |

All four are synthetic test data — no real code, no documentation, no
configuration. They serve no purpose beyond the investigation that
produced `audit/SANDBOX_TOOLING_NOTES.md`.

## Why they were committed

In the QA-31 session I emptied `audit/edit-tool-test.js` via
`: > <file>` because the virtiofs mount blocks `rm` from this sandbox.
The three `.txt` files I forgot about entirely. When Scott ran
`git add -A` to stage QA-31's patch + doc, the staging picked them up
because they were created during the session and weren't gitignored.

Net result: QA-31's commit shows 12,348 line insertions instead of
the ~250 real lines. Now we'll see a ~12,000-line deletion in QA-32
to balance it out.

## Apply behavior

`apply.mjs` uses `git rm` (via `child_process.execSync`) to stage each
file's deletion. In dry-run mode it reports what would be removed
without touching git. Idempotent — files that don't exist are skipped.

## Files removed

- `audit/edit-tool-test.js`
- `audit/lcc-newline-test.txt`
- `audit/lcc-trunc-test-virtiofs.txt`
- `audit/lcc-write-test.txt`

## Files added

- `audit/patches/qa-32-cleanup-test-artifacts/` — patch package
- `AUDIT_PROGRESS.md` — closeout

Also adds a small `.gitignore` entry for `audit/lcc-*-test*.txt` to
prevent future investigation artifacts from leaking back into the repo.
