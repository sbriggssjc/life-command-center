#!/usr/bin/env node
// ============================================================================
// LCC QA-21 — Clamp negative "Xd ago" on Contacts page.
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

async function verifyContactsUiJs(report) {
  const path = resolve(REPO_ROOT, 'contacts-ui.js');
  if (!await fileExists(path)) throw new Error('contacts-ui.js not found at ' + path);
  const src = await readFile(path, 'utf8');
  const sentinels = [
    'QA-21 (2026-05-18): clamp negative deltas',
    "if (days < 0) return 'Recent';",
  ];
  const missing = sentinels.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('contacts-ui.js missing QA-21 sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['contacts-ui.js (relativeDate negative clamp)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #21 — Contacts negative-date clamp ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-21-contacts-negative-date-clamp\`
- **Patch:** \`audit/patches/qa-21-contacts-negative-date-clamp/apply.mjs\`

### Symptom (QA pass #4)
12+ contacts on the Contacts page first-page render showed e.g. "-123d ago", "-189d ago", "-4d ago" for last-activity timestamps. Sync glitches (Salesforce bridge writing a future modified_date or timezone mismatches) were producing future timestamps on contact records.

### Root cause
\`contacts-ui.js\` \`relativeDate(dateStr)\` had:
\`\`\`js
const days = Math.floor((now - d) / (1000 * 60 * 60 * 24));
if (days === 0) return 'Today';
if (days === 1) return 'Yesterday';
if (days < 7) return days + 'd ago';
\`\`\`
When \`d\` is in the future, \`days\` is negative; the third branch returns \`"-123d ago"\` because \`-123 < 7\`.

### Fix
One-line guard at the top of \`relativeDate\`:
\`\`\`js
if (days < 0) return 'Recent';
\`\`\`

### Other freshness helpers — already correct (verified)
- \`formatDate\` (app.js) — handles negatives via "In Xd" / "Tomorrow"
- \`_lccFmtFreshness\` (app.js) — first branch \`< 60000\` ms catches negatives
- \`relDate\` (ops.js) — handles both directions for due-dates
- \`freshnessLabel\` (ops.js) — first branch \`< 5\` min catches negatives

### Files changed
- \`contacts-ui.js\` — relativeDate negative clamp
- \`AUDIT_PROGRESS.md\` — this closeout

### Deferred follow-up
- **QA-22:** investigate the upstream sync writing future timestamps to contact records. Salesforce bridge is the likely culprit; ingest-side guard would prevent the bad data from landing in the first place.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-21 — Contacts negative-date clamp ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyContactsUiJs(report);
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
