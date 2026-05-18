#!/usr/bin/env node
// ============================================================================
// LCC QA-28 — filter private-business "Federal" entities from Agency Breakdown
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
    'QA-28 (2026-05-18): private "Federal" name detector',
    'function _govIsPrivateFederalNamedEntity(',
    'QA-28 (2026-05-18): also exclude private businesses',
    'QA-28 (2026-05-18): skip private businesses with "Federal"',
    "_govIsPrivateFederalNamedEntity(p.agency)",
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('gov.js missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['gov.js (private-Federal name filter + Agency Breakdown rollup)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #28 — Private "Federal" name filter on Agency Breakdown ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-28-private-federal-name-filter\`
- **Patch:** \`audit/patches/qa-28-private-federal-name-filter/apply.mjs\`
- **Severity:** P2 cleanup.

### Symptom
After QA-24's canonicalization, the Agency Breakdown chart's TOP entries were correct (VA ranked #1) but the long tail had ~826 properties polluting the bottom rows under names like "Campco Federal Credit Union" (162 props), "10 Federal Self Storage" (154), "First Federal Lakewood" (141). These are private businesses with "Federal" in the name, not federal tenants.

### Diagnosis
13 distinct non-federal "Federal" strings live on gov (2026-05-18). The canonicalize_agency() function correctly returned NULL for all of them, but the frontend fell back to the raw .agency string — so they appeared in the chart as their own buckets.

### Fix
Pure frontend change in \`gov.js\`:

1. \`_govIsPrivateFederalNamedEntity(name)\` helper — case-insensitive regex:
   - \`federal credit union\`
   - \`federal savings\` / \`federal bank\`
   - \`^first federal\`
   - \`self storage\` / \`self-storage\` anywhere
   - \`^<digits> federal\` (covers "10 Federal Self Storage")
   - \`^federal way\` (Federal Way is a WA city name)

2. Agency Breakdown \`forEach\` rolls private-named rows into the Unknown bucket instead of the long-tail chart.

3. \`distinctAgencies\` count excludes the same private names.

826 properties filtered out of the breakdown. Three remaining legitimate-federal misses noted for future canonicalizer expansion (FBI hyphen variant, FCC, Federal Building).

### Why filter, not delete?
Properties remain in the database — only the breakdown chart filters them. Other surfaces (sales comps, ownership history) still use the data normally. Reversible.

### Out of scope
- Canonicalizer fixes for FBI/FCC/Federal Building (single-property each, future pass)
- Ingest-side \`is_private_entity\` column (premature at 826 rows)

### Files changed
- \`gov.js\` — \`_govIsPrivateFederalNamedEntity\` helper + Agency Breakdown filter
- \`AUDIT_PROGRESS.md\` — this closeout

No SQL changes. No Edge Function changes. No allowlist changes.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-28 — Private "Federal" name filter ===');
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
