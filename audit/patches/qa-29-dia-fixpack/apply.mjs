#!/usr/bin/env node
// ============================================================================
// LCC QA-29 — three dia fixes from QA pass #8 Chrome probe.
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
    'QA-29 (2026-05-18): state-name cell was getting 0 width',
    'QA-29 (2026-05-18): filter out estimates for medicare_ids',
    'QA-29 (2026-05-18): bumped the row limit from 250',
    'QA-29 (2026-05-18): stash the TRUE count alongside the row array',
    'QA-29 (2026-05-18): footer uses the true total',
    'window._diaUnprospectedTotal',
    'limit: 1000',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('dialysis.js missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['dialysis.js (3 fixes: top states CSS + estimates dedup + modal footer)', 0, 'verified ✓']);
}

async function verifyGovJs(report) {
  const path = resolve(REPO_ROOT, 'gov.js');
  if (!await fileExists(path)) throw new Error('gov.js not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    'QA-29 (2026-05-18): stash the TRUE count',
    'QA-29 (2026-05-18): footer uses the true total',
    'window._govUnprospectedTotal',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('gov.js missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['gov.js (Unprospected Owners modal footer mirror)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #29 — Dia fixpack from QA pass #8 Chrome probe ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-29-dia-fixpack\`
- **Patch:** \`audit/patches/qa-29-dia-fixpack/apply.mjs\`
- **Severity:** P2 — three small fixes found in QA pass #8 Chrome probe.

### Fix 1 — Top States widget: state names invisible
DOM had "CA"/"TX"/"NY" correctly but the visual card showed blank state cells. Root cause: state-name cell had \`flex:1\` with no min-width while sibling cells took 20+80+50px + 3×8px gaps = 174px fixed, leaving 0px for the flex cell. Fix: shrink bar 80→50px, gap 8→6px, give state cell \`min-width:32px\`.

### Fix 2 — Financial estimates "108.6% of clinics"
The card subtext read "9,273 of 8,535 clinics (108.6%)" — impossible. Live SQL confirmed:
- 9,273 distinct medicare_ids in \`clinic_financial_estimates\`
- 8,535 distinct in \`medicare_clinics\` (current CMS inventory)
- 8,511 overlap; 762 estimates reference clinics that have been removed from CMS

Fix: cross-reference \`best\` against \`diaData.inventoryChanges\` to count only currently-tracked clinics. Post-fix coverage = 8,511 / 8,535 = 99.7%. Stale estimates remain in DB but are excluded from headline.

### Fix 3 — Unprospected Owners modal footer mismatch
Tile headline correctly said "532 of 1232 active owners" but modal footer said "Showing top 100 of 250" because the diaQuery's row-limit (250) was used as the footer denominator. Fix: bumped dia query limit 250→1000, stashed the true count on \`window._diaUnprospectedTotal\`, modal footer now reads "Showing top 100 of 532". Mirrored to gov.js for consistency.

### Files changed
- \`dialysis.js\` — Top States CSS, financial estimates dedup, Unprospected Owners limit + stash + footer
- \`gov.js\` — Unprospected Owners stash + footer mirror
- \`AUDIT_PROGRESS.md\` — this closeout

No SQL changes. No Edge Function changes. No allowlist changes.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-29 — Dia fixpack ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyDiaJs(report);
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
