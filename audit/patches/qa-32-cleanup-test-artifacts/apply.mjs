#!/usr/bin/env node
// ============================================================================
// LCC QA-32 — clean up QA-31's leaked test artifacts.
// ============================================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { execSync } from 'node:child_process';
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

const TO_REMOVE = [
  'audit/edit-tool-test.js',
  'audit/lcc-newline-test.txt',
  'audit/lcc-trunc-test-virtiofs.txt',
  'audit/lcc-write-test.txt',
];

async function removeFiles(report) {
  for (const rel of TO_REMOVE) {
    const full = resolve(REPO_ROOT, rel);
    if (!await fileExists(full)) {
      report.push([rel, 0, 'already gone']);
      continue;
    }
    if (DRY) {
      report.push([rel, 0, 'would git-rm']);
    } else {
      try {
        execSync(`git rm "${rel}"`, { cwd: REPO_ROOT, stdio: 'pipe' });
        report.push([rel, 0, 'git rm ✓']);
      } catch (err) {
        report.push([rel, 0, 'git rm FAILED: ' + (err.message || err).slice(0, 80)]);
      }
    }
  }
}

async function updateGitignore(report) {
  const path = resolve(REPO_ROOT, '.gitignore');
  let original = '';
  if (await fileExists(path)) {
    original = await readFile(path, 'utf8');
  }
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = '# QA-32: prevent truncation-investigation artifacts from leaking back';
  if (original.includes(sentinel)) {
    report.push(['.gitignore', 0, 'already patched']);
    return;
  }
  const block = N(`

${sentinel}
audit/lcc-*-test*.txt
audit/edit-tool-test.*
`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['.gitignore (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #32 — Clean up QA-31 test artifacts ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-32-cleanup-test-artifacts\`
- **Patch:** \`audit/patches/qa-32-cleanup-test-artifacts/apply.mjs\`
- **Severity:** P3 cleanup.

### Symptom
QA-31's commit showed 12,348 line insertions instead of the ~250 real ones because \`git add -A\` picked up 4 synthetic test files I left behind during the truncation-bug investigation:
- \`audit/edit-tool-test.js\` (0 bytes)
- \`audit/lcc-newline-test.txt\` (3,000 lines)
- \`audit/lcc-trunc-test-virtiofs.txt\` (8,000 lines / 752KB)
- \`audit/lcc-write-test.txt\` (1,000 lines)

The Cowork virtiofs mount blocks \`rm\` from the sandbox, so cleanup couldn't happen in-session. This patch runs Windows-side where unlink is permitted.

### Fix
- \`git rm\` each of the 4 test files (via \`apply.mjs\` execSync calls)
- Add \`.gitignore\` entries for \`audit/lcc-*-test*.txt\` + \`audit/edit-tool-test.*\` to prevent recurrence

### Files removed
- \`audit/edit-tool-test.js\`
- \`audit/lcc-newline-test.txt\`
- \`audit/lcc-trunc-test-virtiofs.txt\`
- \`audit/lcc-write-test.txt\`

### Files changed
- \`.gitignore\` — new audit-test-artifact rules
- \`AUDIT_PROGRESS.md\` — this closeout

No code. No SQL. No Edge Function. Cleanup-only.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-32 — clean up test artifacts ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await removeFiles(report);
  await updateGitignore(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(60) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
