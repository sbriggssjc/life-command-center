#!/usr/bin/env node
// ============================================================================
// LCC QA-22 — Daily Briefing sync-errors + DaVita branding + Pipeline pager.
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
  const sentinel = 'QA pass #22 — Daily Briefing + DaVita + Pipeline pager ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-22-daily-briefing-davita-pager\`
- **Patch:** \`audit/patches/qa-22-daily-briefing-davita-pager/apply.mjs\`
- **Migration:** \`supabase/migrations/dialysis/20260518200000_dia_qa22_davita_brand_casing.sql\`

### (a) Daily Briefing + Home team-pulse: Sync Errors 0
Same root cause as QA-10 but on a different render path. \`loadDailyBriefingData\` now fetches \`/api/sync?action=health\` in parallel and stashes \`summary.error\` on \`window._lccLiveSyncErrors\`. Both the Daily Briefing "Sync Errors" db-kpi tile AND the Home team-pulse "Sync Errors" pulse-card now prefer the live value. Team-pulse gate also updated so the widget shows when only the live count is non-zero.

### (b) "Davita" → "DaVita" branding (data fix, dia)
\`properties.tenant\` had 2,531 rows with "Davita" prefix + 115 with all-caps "DAVITA". New \`canonicalize_davita_brand(text)\` helper + backfill + BEFORE INSERT/UPDATE trigger. Live verified: 2,531 → 0 bad rows; canonical "DaVita" count 1,798 → 4,329.

### (c) Pipeline My Work pager mismatch
Pager key \`/api/queue?view=my_work\` didn't match the actual fetch URL \`/api/queue?view=my_work&limit=100\` — pulled stale total from another slot ("Page 1 of 298 (7432 items)" alongside a "0 items" list). Fixed the key + only render the pager when \`opsMyWorkData.length >= 100\`.

### Summary — sync-error display
After QA-22 every surface agrees on \`summary.error\` (1 today):
- Pipeline banner, Sync Health tile, Metrics tile (QA-10)
- Daily Briefing tile, Home team-pulse (QA-22, this patch)

### Files changed
- \`supabase/migrations/dialysis/20260518200000_dia_qa22_davita_brand_casing.sql\`
- \`app.js\` — \`loadDailyBriefingData\` + Daily Briefing tile + team-pulse pulse-card + team-pulse gate
- \`ops.js\` — Pipeline My Work pager key + threshold guard
- \`AUDIT_PROGRESS.md\` — this closeout

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-22 — Daily Briefing + DaVita + Pipeline pager ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyFile(
    resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260518200000_dia_qa22_davita_brand_casing.sql'),
    ['canonicalize_davita_brand', 'properties_tenant_brand_canonicalize_trg'],
    'dia DaVita migration', report);
  await verifyFile(
    resolve(REPO_ROOT, 'app.js'),
    ['QA-22 (2026-05-18): also fetch live sync-health',
     'window._lccLiveSyncErrors = syncData?.summary?.error',
     'QA-22 (2026-05-18): prefer the live sync-health',
     'QA-22 (2026-05-18): prefer live connector-status count',
     'QA-22 (2026-05-18): also gate on live sync-health'],
    'app.js (sync-errors render fixes + team-pulse gate)', report);
  await verifyFile(
    resolve(REPO_ROOT, 'ops.js'),
    ["QA-22 (2026-05-18): renderMyWork's actual fetch URL",
     "paginationHTML('/api/queue?view=my_work&limit=100'"],
    'ops.js (Pipeline pager key fix)', report);
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
