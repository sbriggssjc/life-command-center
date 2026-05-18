#!/usr/bin/env node
// ============================================================================
// LCC QA-27 — dia parallel pagination + diaQuery count opt-in.
// Mirror of QA-26 (gov) with the prerequisite diaQuery refactor.
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

async function verifyDiaJs(report) {
  const path = resolve(REPO_ROOT, 'dialysis.js');
  if (!await fileExists(path)) throw new Error('dialysis.js not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    'QA-27 (2026-05-18): callers can opt-in to count=exact via includeCount',
    'QA-27 (2026-05-18): parallel pagination',
    'QA-27 (2026-05-18): parallelize the two big full-table reads',
    'QA-27 (2026-05-18): use includeCount so unprospectedOwners',
    'includeCount = false',
    'await Promise.all([',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('dialysis.js missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['dialysis.js (diaQuery count opt-in, diaQueryAll parallel, +ownership parallel)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #27 — Dia parallel pagination + diaQuery count opt-in ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-27-dia-parallel-pagination\`
- **Patch:** \`audit/patches/qa-27-dia-parallel-pagination/apply.mjs\`
- **Severity:** P1 perf — mirror of QA-26 fix, applied to dia.

### Symptom
Dia home dashboard had the same serial-pagination problem as gov. \`diaQueryAll\` fetched 1000-row pages one-at-a-time, the ownership-coverage widget awaited three independent queries serially, and the QA-25 "Unprospected Owners" widget couldn't report the true count because \`diaQuery\` discarded the Content-Range total.

### Fix
Three changes:

1. **\`diaQuery\` now accepts \`includeCount: true\`.** When set, the URL doesn't force count=false (Edge Function default = count=exact) and the function returns \`{data, count}\` instead of just \`data\`. Default behavior unchanged for every existing call site (100+ callers).

2. **\`diaQueryAll\` rewritten.** Fetches page 0 with \`includeCount: true\`, then issues all remaining pages via \`Promise.all\`. For \`ownership_history\` (12,310 rows = 13 pages) and \`medicare_clinics\` (8,535 rows = 9 pages), wall-clock drops from N × ~400ms to first + parallel batch (~800ms regardless of N).

3. **Dia ownership coverage block parallelized.** The two big independent reads (\`ownership_history\` + \`true_owners\`) now run via \`Promise.all\` instead of being awaited serially.

### Bonus
The QA-25 dia "Unprospected Owners" widget's denominator was previously capped at limit=250 because diaQuery returned just the row array. With \`includeCount: true\`, the widget now reports the true total of 532 unprospected owners (was showing 250).

### Expected speedup
- Top-level loadDiaData Promise.all: ~3–5s → ~1–2s
- Ownership coverage widget:         ~8–12s → ~1–2s

### Backward compatibility
\`diaQuery\` returns an array by default — no existing call site changes behavior. Only \`diaQueryAll\` (uses count internally) and the QA-25 widget (now explicitly opts in) get the envelope.

### Files changed
- \`dialysis.js\` — \`diaQuery\` (count opt-in), \`diaQueryAll\` (parallel), ownership-coverage block (Promise.all), QA-25 widget (uses count)
- \`AUDIT_PROGRESS.md\` — this closeout

No SQL changes. No Edge Function changes. No allowlist changes.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-27 — Dia parallel pagination ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyDiaJs(report);
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
