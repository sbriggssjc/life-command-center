#!/usr/bin/env node
// ============================================================================
// LCC QA-30 — canonicalize_agency expansion (FBI hyphen + FCC).
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
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government',
    '20260518240000_gov_qa30_canonicalize_agency_fbi_hyphen_fcc.sql');
  if (!await fileExists(path)) throw new Error('Migration not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    'CREATE OR REPLACE FUNCTION public.canonicalize_agency',
    'federal\\s+bureau[\\s-]+(of[\\s-]+)?investigation',
    'fcc|federal\\s+communications\\s+commission',
    'QA-30 (2026-05-18)',
    'UPDATE public.properties',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('Migration missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['gov QA-30 migration (FBI hyphen + FCC)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #30 — canonicalize_agency expansion (FBI hyphen + FCC) ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-30-canonicalizer-fbi-fcc\`
- **Patch:** \`audit/patches/qa-30-canonicalizer-fbi-fcc/apply.mjs\`
- **Migration:** \`supabase/migrations/government/20260518240000_gov_qa30_canonicalize_agency_fbi_hyphen_fcc.sql\`
- **Severity:** P3 cleanup.

### Symptom
QA-28's Chrome probe found three federal misses the post-QA-24 canonicalizer didn't catch:
- "Federal Bureau-Investigation" (1 prop) — hyphen separator, no "of"
- "Federal Communications Commission" (1 prop) — FCC not in canonicalizer map
- "FCC" (2 props) — FCC not in canonicalizer map

### Fix
Two regex changes in \`canonicalize_agency()\`:
- **FBI broadened**: \`federal\\s+bureau\\s+of\\s+investigation\` → \`federal\\s+bureau[\\s-]+(of[\\s-]+)?investigation\` (accepts space or hyphen; "of" optional)
- **FCC added**: new line \`\\m(fcc|federal\\s+communications\\s+commission)\\M\` → 'FCC'

Re-canonicalization UPDATE applied to \`properties.agency_canonical\`.

### Verified live
- "Federal Bureau-Investigation" (1) → FBI
- "FCC" (2) → FCC
- "Federal Communications Commission" (1) → FCC

FBI bucket gained 1 property. FCC is a new canonical agency category with 3 properties.

### Out of scope
"Federal Building" (1 prop) — ambiguous (could be GSA-managed building or building name not tenant agency). Single property, left as raw string.

### Files changed
- \`supabase/migrations/government/20260518240000_gov_qa30_canonicalize_agency_fbi_hyphen_fcc.sql\`
- \`AUDIT_PROGRESS.md\` — this closeout

No frontend. No Edge Function. No allowlist changes. Migration applied live via Supabase MCP on 2026-05-18.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-30 — canonicalize_agency expansion (FBI hyphen + FCC) ===');
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
