#!/usr/bin/env node
// ============================================================================
// LCC QA-31 — sandbox tooling notes (Edit-tool truncation workaround doc).
// Doc-only patch: appends a closeout to AUDIT_PROGRESS.md.
// ============================================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf   = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
function toEol(s, eol) { return s.replace(/\r\n/g, '\n').replace(/\n/g, eol); }
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function verifyDoc(report) {
  const path = resolve(REPO_ROOT, 'audit', 'SANDBOX_TOOLING_NOTES.md');
  if (!await fileExists(path)) throw new Error('SANDBOX_TOOLING_NOTES.md not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    'Edit tool truncates files >~500KB on virtiofs mounts',
    'Confirmed reproduction (2026-05-18)',
    'Workaround for files',
    'mcp__workspace__bash',
    'git show HEAD:<file>',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('SANDBOX_TOOLING_NOTES.md missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['audit/SANDBOX_TOOLING_NOTES.md (truncation workaround doc)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #31 — sandbox tooling notes (Edit-tool truncation doc) ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-31-sandbox-tooling-notes\`
- **Patch:** \`audit/patches/qa-31-sandbox-tooling-notes/apply.mjs\`
- **Doc:** \`audit/SANDBOX_TOOLING_NOTES.md\`
- **Severity:** P3 doc.

### Symptom
During QA-29 the Cowork Edit tool silently truncated dialysis.js (615KB) and gov.js (506KB), each by 9,369+ bytes from the end. The truncation included the QA-25 modal handler that was already deployed and working live. Caught only because apply.mjs sentinel checks failed.

### Diagnosis (confirmed 2026-05-18)
The Cowork sandbox exposes Windows C:\\ to the Linux VM via virtiofs/FUSE. The Edit tool's atomic-write pattern is unreliable on this mount for files >~500KB: edit content is applied correctly, but trailing bytes are silently dropped.

Reproduced in controlled test:
- File: dialysis.js, 614,710 bytes / 10,928 lines
- Operation: one Edit tool call adding 15 chars near line 10920
- Result: file size unchanged at 614,710 bytes, lost 3 lines from end, tail truncated mid-string

### Workaround
Documented in \`audit/SANDBOX_TOOLING_NOTES.md\`:
- For files >500KB, route edits through Python via \`mcp__workspace__bash\` instead of Edit tool. Python writes are reliable on this mount (tested with 752KB writes).
- Post-edit verification: \`wc -l\` + \`tail -3\` must show valid content.
- Recovery: \`git show HEAD:<file> > <file>\` (regular git checkout fails because the mount blocks unlinks).

### Files changed
- \`audit/SANDBOX_TOOLING_NOTES.md\` — new documentation
- \`audit/patches/qa-31-sandbox-tooling-notes/\` — patch package
- \`AUDIT_PROGRESS.md\` — this closeout

No code. No SQL. No Edge Function. No allowlist changes. Doc-only.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-31 — sandbox tooling notes ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyDoc(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(70) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
