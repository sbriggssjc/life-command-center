# Prompt 105 — Permanent line-ending fix (.gitattributes + one-time renormalize)

Grounding: this repo has NO `.gitattributes`, and `core.autocrlf` is unset/false, so when a Windows editor or
the Surface sync tool rewrites files to CRLF, git sees the ENTIRE tree as modified (LF committed vs CRLF
working). This has caused a repo-wide "everything modified" churn that blocks pulls and forces stash/discard
gymnastics — it has bitten the sync THREE times (2026-08-13/14). Fix it once, at the repo level, so git always
stores LF and the working tree is consistent regardless of platform/editor.

**This is a repo-hygiene commit — run it on a CLEAN tree (right after a sync), as its OWN commit/PR, not tangled
with feature work. The renormalize touches many files; that one-time diff IS the fix.**

## Do

1. **Add a root `.gitattributes`:**
   ```gitattributes
   # Normalize all text to LF in the repo; check out LF on every platform.
   * text=auto eol=lf

   # Explicit text types (belt-and-suspenders)
   *.js    text eol=lf
   *.mjs   text eol=lf
   *.ts    text eol=lf
   *.json  text eol=lf
   *.md    text eol=lf
   *.sql   text eol=lf
   *.sh    text eol=lf
   *.yml   text eol=lf
   *.yaml  text eol=lf
   *.css   text eol=lf
   *.html  text eol=lf

   # Windows-only scripts keep CRLF (if any exist)
   *.ps1   text eol=crlf
   *.bat   text eol=crlf
   *.cmd   text eol=crlf

   # Binary — never touch
   *.docx  binary
   *.xlsx  binary
   *.xlsm  binary
   *.pptx  binary
   *.pdf   binary
   *.png   binary
   *.jpg   binary
   *.jpeg  binary
   *.gif   binary
   *.ico   binary
   *.woff  binary
   *.woff2 binary
   *.zip   binary
   ```
   (Adjust the binary list to whatever binary extensions actually exist in the repo — grep/check first; don't
   drop a type that's present.)

2. **Renormalize in one commit:** on a clean tree,
   ```
   git add --renormalize .
   git status            # should show the line-ending normalization staged
   git commit -m "chore: normalize line endings to LF (.gitattributes); stop CRLF churn"
   ```
   `--renormalize` re-stages every file applying the new eol rule: files with ONLY eol differences collapse to
   LF and stop showing as modified; genuine content is untouched. Do NOT hand-edit file contents.

3. **Sanity-check** a few representative files afterward (`git show HEAD --stat | head`, and confirm a known file
   like `.gitignore` now has LF in both index and working tree). Confirm no `.ps1`/`.bat` got flipped to LF.

## Acceptance
- `.gitattributes` committed at repo root.
- One renormalize commit; after it, a fresh `git status` on the same machine is clean (no phantom "modified").
- Binary files (docx/xlsx/pptx/png) are UNCHANGED (verify none appear in the renormalize diff).
- Note in the commit body: after this lands and everyone re-pulls, the CRLF-churn class is gone; if a Windows
  machine still shows churn, run `git rm --cached -r . && git reset --hard` once to refresh the working tree to
  the normalized state (documented, not automatic).

One PR, own commit. Commit with the repo Co-Authored-By + Claude-Session trailer. **Do not bundle any feature
change into this PR** — it must be a pure, reviewable line-ending normalization so the diff is auditable.
