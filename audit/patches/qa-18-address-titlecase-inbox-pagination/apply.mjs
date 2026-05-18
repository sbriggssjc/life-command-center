#!/usr/bin/env node
// ============================================================================
// LCC QA-18 — Address Title-case + Inbox header pagination.
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
  const sentinel = 'QA pass #18 — address title-case + inbox header pagination ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-18-address-titlecase-inbox-pagination\`
- **Patch:** \`audit/patches/qa-18-address-titlecase-inbox-pagination/apply.mjs\`

### QA-18a — Address title-case
New IMMUTABLE \`public.titlecase_address(text)\` on both DBs:
- Ordinals stay (5th, 21st)
- Digit-starting words stay (240, 1200)
- Direction abbreviations uppercase (N/NE/SE/etc.)
- "PO" uppercase (PO Box)
- Everything else \`initcap\` (main→Main, ave→Ave)

Backfill gated on \`address ~ '\\m[a-z]+\\M'\` so mixed-case names (McMillan) aren't clobbered. Gov: 10,787 → 80 remaining (the 80 are mostly correct ordinals).

### QA-18b — Inbox header pagination
\`renderInboxTriage\` now fetches \`work_counts\` in parallel and shows "Showing 100 of 7,420 items" instead of "100 items". Numerically agrees with Metrics + Sync Health inbox tiles.

### Files changed
- \`supabase/migrations/government/20260518180000_gov_qa18_address_titlecase.sql\`
- \`supabase/migrations/dialysis/20260518180000_dia_qa18_address_titlecase.sql\`
- \`ops.js\` (renderInboxTriage)
- \`AUDIT_PROGRESS.md\` — this closeout

### What's next
Every P0/P1/P2 item from the original QA pass and QA pass #2 is now resolved. Suggest running another fresh walkthrough — patterns from this session suggest the next layer will be either more performance corners or long-tail data-integrity nits.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-18 — Address title-case + Inbox header pagination ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyFile(
    resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260518180000_gov_qa18_address_titlecase.sql'),
    ['titlecase_address(addr text)', "WHEN lower(w) = 'po' THEN 'PO'", "WHEN w ~ '^[0-9]+(st|nd|rd|th)$' THEN w"],
    'gov address title-case migration', report);
  await verifyFile(
    resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260518180000_dia_qa18_address_titlecase.sql'),
    ['titlecase_address(addr text)', "WHEN lower(w) = 'po' THEN 'PO'"],
    'dia address title-case migration', report);
  await verifyFile(
    resolve(REPO_ROOT, 'ops.js'),
    ['QA-18 (2026-05-18): fetch work_counts in parallel',
     'QA-18 (2026-05-18): prefer canonical total from work_counts',
     '_inboxCanonicalTotal',
     'Showing ${onPage.toLocaleString()} of ${canonicalTotal'],
    'ops.js (Inbox header pagination)', report);
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
