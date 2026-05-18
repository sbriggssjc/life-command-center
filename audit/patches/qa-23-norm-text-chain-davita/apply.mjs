#!/usr/bin/env node
// ============================================================================
// LCC QA-23 — chain canonicalize_davita_brand into norm_text (dia).
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

async function verifyMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis',
    '20260518210000_dia_qa23_norm_text_chain_davita_brand.sql');
  if (!await fileExists(path)) throw new Error('Migration not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    'CREATE OR REPLACE FUNCTION public.norm_text',
    'ELSE public.canonicalize_davita_brand(base.r)',
    "QA-23 (2026-05-18): chains canonicalize_davita_brand",
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('Migration missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['dia QA-23 migration (norm_text chains DaVita brand)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #23 — norm_text chains DaVita brand canonicalization ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-23-norm-text-chain-davita\`
- **Patch:** \`audit/patches/qa-23-norm-text-chain-davita/apply.mjs\`
- **Migration:** \`supabase/migrations/dialysis/20260518210000_dia_qa23_norm_text_chain_davita_brand.sql\`

### Symptom
QA pass #6 verification opened a DaVita-tenanted dia property and the detail panel header still read "Davita Lakewood Community Dialysis Center" — even though QA-22's properties.tenant backfill went 2,531 bad rows → 0.

### Root cause
v_property_detail__base builds page_title from:
\`\`\`
COALESCE(norm_text(pl.tenant), norm_text(pmc.facility_name),
         norm_text(p.tenant), norm_text(p.address))
\`\`\`
The first two LATERAL-join sources had thousands of "Davita" rows that QA-22 didn't touch (leases.tenant: 2,348, medicare_clinics.facility_name: 6). The QA-19 norm_text trusted mixed-case input as-is, so the bad casing flowed through.

### Fix
Chain \`canonicalize_davita_brand\` onto \`norm_text\`'s output — applies to ALL paths (trusted-mixed-case AND smart-title-case). One function changed; 4 dependent views auto-fixed: v_property_detail, v_lease_detail, v_ownership_current, v_ownership_chain.

### Verified live
Property 38564 v_property_detail.page_title:
- Before: "Davita Lakewood Community Dialysis Center – Lakewood, WA"
- After:  "**DaVita** Lakewood Community Dialysis Center – Lakewood, WA"

### Lesson
When a view's column is built via COALESCE over multiple upstream sources, fixing one source isn't enough. View-level canonicalization (in norm_text) is more robust than chasing each upstream column.

### Files changed
- \`supabase/migrations/dialysis/20260518210000_dia_qa23_norm_text_chain_davita_brand.sql\`
- \`AUDIT_PROGRESS.md\` — this closeout

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-23 — norm_text chains DaVita brand ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyMigration(report);
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
