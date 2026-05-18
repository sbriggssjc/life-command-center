#!/usr/bin/env node
// ============================================================================
// LCC QA-33 — hotfix: agency_canonical to SELECT + revert QA-26 parallel pagination.
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

async function verifyGovJs(report) {
  const path = resolve(REPO_ROOT, 'gov.js');
  if (!await fileExists(path)) throw new Error('gov.js not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    "'agency,agency_canonical,agency_full_name,government_type,'",
    'QA-33 (2026-05-18): reverted to serial pagination',
    'QA-33 (2026-05-18): reverted to sequential awaits',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('gov.js missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  // Sanity check — QA-26 parallel-batch markers should be GONE
  const unwanted = [
    'parallelize page fetches. Was serial',
    'parallel pagination — same fix as govQueryAll',
    'parallelize the three independent table reads',
  ];
  const stillPresent = unwanted.filter(s => src.includes(s));
  if (stillPresent.length > 0) {
    throw new Error('QA-26 parallel-pagination markers still present (revert incomplete):\n  - ' + stillPresent.join('\n  - '));
  }
  report.push(['gov.js (agency_canonical SELECT + revert parallel-pagination)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #33 — Hotfix: agency_canonical in SELECT + revert QA-26 parallel pagination ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-33-agency-canonical-select-and-revert-parallel\`
- **Patch:** \`audit/patches/qa-33-agency-canonical-select-and-revert-parallel/apply.mjs\`
- **Severity:** P1 hotfix.

### Symptom 1 — QA-24 is dead code
Chrome verification (2026-05-18) found the Agency Breakdown chart still showing the pre-QA-24 fragmented state: VA in 3 buckets, SSA split, USDA split. Live JS probe: every VA row has \`agency: "VETERANS AFFAIRS"\` and \`agency_canonical\` field absent entirely from the payload.

### Diagnosis 1
The properties SELECT in \`_loadPaginatedQuery('properties', ...)\` lists ~30 columns. \`agency_canonical\` is not one of them. The QA-24 frontend change uses \`p.agency_canonical || p.agency\` in groupBy — \`p.agency_canonical\` is always \`undefined\`, so the chart groups by raw \`.agency\`.

### Fix 1
Added \`'agency_canonical'\` to the SELECT (between \`agency\` and \`agency_full_name\`). One-line change. The QA-24 SQL migration stays — \`agency_canonical\` is correctly populated in the DB for every property.

### Symptom 2 — QA-26 parallel pagination is a perf regression
Live timings on gov dashboard (2026-05-18):
- \`govConnected = true\`: ~3 s
- \`govDataLoaded = true\` (Phase 1): ~18 s (was supposed to be ~1.5 s)
- Full load (Phase 2 + ownership coverage): **~194 s**
- Browser unresponsive mid-load — screenshot tool timed out for ~60 s

### Diagnosis 2
QA-26 issued ~60 concurrent HTTP requests at startup. Overwhelms Vercel edge worker pool, Supabase PostgREST connection pool, and the browser's response-parsing thread.

### Fix 2
Reverted three pieces:
- \`govQueryAll\` → serial while-loop with 120s timeout fuse
- \`_loadPaginatedQuery\` → serial while-loop
- Ownership-coverage block → sequential awaits

Slower than parallel-when-it-works, but predictable. A throttled-parallel approach (concurrency=4) is the better long-term fix — captured as follow-up.

### Not in this patch
- QA-24 SQL migration stays (still correct)
- QA-25/28/29/30 unaffected
- QA-27 (dia parallel) NOT reverted yet — need to probe dia separately

### Files changed
- \`gov.js\` — \`agency_canonical\` to SELECT; revert parallel-pagination helpers and ownership-coverage block
- \`AUDIT_PROGRESS.md\` — this closeout

No SQL. No Edge Function. No allowlist changes.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-33 — hotfix: agency_canonical SELECT + revert QA-26 ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyGovJs(report);
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
