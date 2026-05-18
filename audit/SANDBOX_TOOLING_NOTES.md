# Sandbox Tooling Notes

Operational notes for Claude sessions working on this repo from the
Cowork sandbox (virtiofs mount on Windows).

## Edit tool truncates files >~500KB on virtiofs mounts (CONFIRMED 2026-05-18)

**Severity: HIGH.** The `Edit` tool can silently truncate the END of
large files (`>~500KB`) on the virtiofs/FUSE mount that exposes Windows
C:\ to the Linux sandbox. The edit itself is applied correctly, but the
file's last N bytes are dropped, where N can range from ~30 bytes (1 edit)
to ~9,000+ bytes (multiple edits compound).

### How it manifests
- `Edit` returns success
- `Read` shows the file in its (correct) post-edit state
- But `wc -l` and `wc -c` on disk show the file is SHORTER
- `tail` shows the file ends mid-line (no closing brace, mid-string, etc.)
- `git status` may or may not surface the discrepancy

### Confirmed reproduction (2026-05-18)
1. File: `dialysis.js`, 614,710 bytes / 10,928 lines
2. Edit tool: replace one string near line 10920 (+15 chars)
3. After: 614,710 bytes (unchanged size, not +15) / 10,925 lines / tail truncated mid-string

Earlier in the same session, ~7 sequential edits caused cumulative damage
of 9,369 bytes (183 lines lost) from `dialysis.js` and 196 lines from
`gov.js`. The lost content was the **end of the file** in both cases.

### Detection
After ANY Edit tool call to a large file, verify integrity:
```bash
wc -l <file> ; wc -c <file>
tail -3 <file>   # must end with valid code, not mid-line
```

If the line count dropped, file was truncated. Restore from `git`:
```bash
git show HEAD:<file> > <file>   # NOTE: regular checkout may fail due to
                                # virtiofs unlink permissions; this raw
                                # write does work
```

### Workaround for files >~500KB
**Don't use the Edit tool.** Use Python via `mcp__workspace__bash`:

```python
python3 << 'PYEOF'
with open('<path>', 'r') as f:
    src = f.read()
old = '''<exact old string>'''
new = '''<exact new string>'''
assert old in src, "Pattern not found"
assert src.count(old) == 1, "Pattern ambiguous"
src = src.replace(old, new)
with open('<path>', 'w') as f:
    f.write(src)
import os
print(f'Wrote {os.path.getsize("<path>")} bytes')
PYEOF
```

Python writes are reliable on this mount — tested with 752KB writes,
exact byte counts preserved including LF newlines.

### Other related mount quirks

- **`git checkout -- <file>`** can fail with "Operation not permitted"
  because git tries to unlink the working file first, and the mount
  blocks unlinks from this sandbox. Workaround: redirect from
  `git show HEAD:<file>` instead.
- **`rm` on mounted files** fails with same error. Workaround: truncate
  to 0 bytes via `: > <file>`.
- **Line endings**: this mount preserves whatever Python writes (LF or
  CRLF). It does NOT auto-convert. But Windows-side git may re-convert
  on next checkout via `core.autocrlf` settings.

### Files large enough to be at risk in this repo (as of 2026-05-18)
- `dialysis.js` — 615 KB
- `gov.js` — 506 KB
- `app.js` — likely large too, check before editing
- `ops.js` — likely large too
- `detail.js` — likely large too

When in doubt: `wc -c <file>` first. If >500KB, route edits through
Python.

### Files that are safe with Edit
- `*.md`, `*.sql`, `*.json`, smaller `.js` files all <500KB
- The audit patch READMEs / apply.mjs / COMMIT_MSG.txt — all small

## Recovery checklist if truncation occurs

1. **Don't commit immediately.** Check `git diff <file>` — if you see
   massive deletions you didn't make, you've been truncated.
2. **Don't `git checkout`** — likely to fail.
3. Use `git show HEAD:<file> > <file>` to restore.
4. Re-apply intended edits via Python.
5. Verify `wc -l` matches HEAD before staging.
