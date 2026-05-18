#!/usr/bin/env node
// ============================================================================
// LCC QA-19 — norm_text rewrite: preserve abbreviations, trust mixed case.
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

async function verifyFile(path, sentinels, label, report) {
  if (!await fileExists(path)) throw new Error(label + ' not found at ' + path);
  const src = await readFile(path, 'utf8');
  const missing = sentinels.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error(label + ' missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push([label, 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #19 — norm_text preserves abbreviations ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-19-norm-text-preserve-abbreviations\`
- **Patch:** \`audit/patches/qa-19-norm-text-preserve-abbreviations/apply.mjs\`

### Symptom (discovered in QA pass #3)
Detail panel header on property 3198 read "1200 New Jersey Ave Se – Washington, DC" — the "Se" should be "SE". The underlying \`properties.address\` had been canonicalized to "1200 New Jersey Ave SE" by QA-12. But \`v_property_detail\` wraps the address column in \`norm_text(p.address)\`, and norm_text was doing \`initcap(trim(s))\` — clobbering the SE back to Se on every read.

Same pattern in \`v_lease_detail\`, \`v_ownership_current\`, \`v_ownership_chain\`. Four views silently undoing the QA-12+QA-18 canonicalization at read time.

### Fix
Redefine \`norm_text\` with a two-branch policy:
1. Mixed-case input → trust the upstream, just trim.
2. All-upper or all-lower → smart title-case using the same logic as \`titlecase_address\` from QA-18, with an expanded abbreviation preserve-set (direction codes + ~50 federal agency acronyms + dia-specific codes on the dia migration).

### Regression tests (verified live on gov)
- "1200 NEW JERSEY AVE SE" → "1200 New Jersey Ave SE"
- "1200 New Jersey Ave SE" → "1200 New Jersey Ave SE" (untouched)
- "GSA HEADQUARTERS"        → "GSA Headquarters"
- "po box 123"              → "PO Box 123"
- "WASHINGTON"              → "Washington"

### Live verification
Detail panel header on property 3198: "1200 New Jersey Ave Se – Washington, DC" → "**1200 New Jersey Ave SE – Washington, DC**".

### Lesson
When canonicalizing column data, audit every consuming view for read-time normalization helpers (norm_text, initcap, lower, upper, custom canonicalizers) — they will silently override column-level fixes. The QA-12 + QA-18 column backfills were correct; the read-time wrapper was the actual bug.

### Files changed
- \`supabase/migrations/government/20260518190000_gov_qa19_norm_text_preserve_abbreviations.sql\`
- \`supabase/migrations/dialysis/20260518190000_dia_qa19_norm_text_preserve_abbreviations.sql\`
- \`AUDIT_PROGRESS.md\` — this closeout

Both migrations applied live via Supabase MCP on 2026-05-18.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-19 — norm_text preserves abbreviations ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyFile(
    resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260518190000_gov_qa19_norm_text_preserve_abbreviations.sql'),
    ['CREATE OR REPLACE FUNCTION public.norm_text',
     "WHEN t.v <> upper(t.v) AND t.v <> lower(t.v) THEN t.v",
     "'GSA','IRS','DOJ'"],
    'gov norm_text migration', report);
  await verifyFile(
    resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260518190000_dia_qa19_norm_text_preserve_abbreviations.sql'),
    ['CREATE OR REPLACE FUNCTION public.norm_text',
     "'DVA','FMC','NPI'"],
    'dia norm_text migration', report);
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
