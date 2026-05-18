#!/usr/bin/env node
// ============================================================================
// LCC QA-20 — Gov lease filter dropping null-tenant rows.
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

async function verifyDetailJs(report) {
  const path = resolve(REPO_ROOT, 'detail.js');
  if (!await fileExists(path)) throw new Error('detail.js not found at ' + path);
  const src = await readFile(path, 'utf8');
  const sentinels = [
    'QA-20 (2026-05-18): _udIsPlaceholderTenant used to return true for null',
    'function _udIsKnownPlaceholderTenant(t)',
    'if (_udIsKnownPlaceholderTenant(l?.tenant)) continue;',
  ];
  const missing = sentinels.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('detail.js missing QA-20 sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['detail.js (_udFilterAndDedupeLeases null-tenant fix)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #20 — gov lease null-tenant filter fix ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-20-gov-lease-null-tenant-filter\`
- **Patch:** \`audit/patches/qa-20-gov-lease-null-tenant-filter/apply.mjs\`

### Symptom (discovered in QA pass #4)
Every gov property's Rent Roll tab showed "No lease data available for Rent Roll" even when the property had a real GSA lease. Operations tab also showed "AGENCY (SHORT) —". The lease fetch succeeded (HTTP 200, dataLen: 1) but the row was dropped before reaching the cache.

### Root cause
\`_udFilterAndDedupeLeases\` in \`detail.js\` filters out leases where \`_udIsPlaceholderTenant(l.tenant)\` is true. The original function returned \`true\` for \`null\` — which made sense for dia (buyer-estimated rows have placeholder strings in tenant). But gov leases legitimately store the agency in \`guarantor\` / \`tenant_agency\` and leave \`tenant\` itself \`null\`. The filter silently dropped every gov lease row.

### Fix
Split into two predicates:
- \`_udIsPlaceholderTenant\` — null returns true (used by the SORT TIER so real-tenant rows win when both exist).
- \`_udIsKnownPlaceholderTenant\` — null returns false; only flags explicit placeholders (TBD, Unknown, BuyerEst, …). Used by the FILTER so null tenants survive.

### Live verification
| Surface | Before | After |
|---|---|---|
| \`_udCache.leases.length\` on property 3198 | 0 | 1 |
| Rent Roll tab | "No lease data available" | renders the GSA lease |
| Operations tab "AGENCY (SHORT)" | — | GSA |

### Why this slipped past QA passes #1-3
None of the earlier passes clicked through the Rent Roll or Operations tabs — they verified header, completeness rail, next-action bar. The bug was confined to surfaces that only render when those tabs are activated.

Lesson: page-level QA needs to exercise tab clicks too, not just default-open tabs.

### Files changed
- \`detail.js\` — \`_udIsPlaceholderTenant\` split + filter call site update
- \`AUDIT_PROGRESS.md\` — this closeout

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-20 — Gov lease null-tenant filter fix ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyDetailJs(report);
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
