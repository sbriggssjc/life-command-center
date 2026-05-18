#!/usr/bin/env node
// ============================================================================
// LCC QA-12 — P2 omnibus.
//
// Verifies sentinels for: address direction-caps migration (both DBs),
// FAB aria-label, Calendar zero-duration filter, Detail panel header dedupe
// (two sites), Data Quality cluster filter + Title-case.
//
// Branch: audit/qa-12-p2-omnibus
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
  const sentinel = 'QA pass #12 — P2 omnibus ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-12-p2-omnibus\`
- **Patch:** \`audit/patches/qa-12-p2-omnibus/apply.mjs\`

### What shipped
1. **Address direction-suffix canonicalization (DATA FIX, both DBs)**
   - New \`public.canonicalize_address_directions(text)\` IMMUTABLE helper, BEFORE INSERT/UPDATE trigger on \`properties.address\`.
   - Backfilled: gov 710 rows, dia 450 rows. Property 3198 now reads "1200 New Jersey Ave SE".
2. **AI Copilot FAB accessibility** — \`#copilotFab\` gained \`aria-label="Open AI Copilot"\`.
3. **Calendar zero-duration events** — \`renderCalendarFull\` now renders \`start_time === end_time\` events as "Task @ 5:40 AM" instead of "5:40 AM – 5:40 AM".
4. **Detail panel header — duplicated city** — both header render sites in \`detail.js\` now suppress the subtitle when the title already embeds it ("Washington, DC" was appearing twice).
5. **Data Quality duplicate-candidate cluster cleanup** — \`ops.js\` filters parse-debris clusters (canonical_name=null + all members are 2-letter state codes) and Title-cases the cluster label.

### Files changed
- \`supabase/migrations/government/20260518160000_gov_qa12_address_direction_caps.sql\`
- \`supabase/migrations/dialysis/20260518160000_dia_qa12_address_direction_caps.sql\`
- \`index.html\` (FAB aria-label)
- \`app.js\` (Calendar zero-duration render)
- \`detail.js\` (header dedupe, two sites)
- \`ops.js\` (Data Quality cluster filter + Title-case)
- \`AUDIT_PROGRESS.md\` (this closeout)

### Deferred P2s (separate follow-ups)
- Home Inbox cards inline actions (currently only "Open in Outlook ↗"; Inbox PAGE has full action set)
- Messages page inline actions
- Research page LLC + Agency Drift widgets

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-12 — P2 omnibus ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyFile(
    resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260518160000_gov_qa12_address_direction_caps.sql'),
    ['canonicalize_address_directions', 'properties_address_caps_trg', "regexp_replace(coalesce(addr, ''),"],
    'gov address direction-caps migration', report);
  await verifyFile(
    resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260518160000_dia_qa12_address_direction_caps.sql'),
    ['canonicalize_address_directions', 'properties_address_caps_trg'],
    'dia address direction-caps migration', report);
  await verifyFile(
    resolve(REPO_ROOT, 'index.html'),
    ['aria-label="Open AI Copilot"'],
    'index.html (FAB aria-label)', report);
  await verifyFile(
    resolve(REPO_ROOT, 'app.js'),
    ['QA-12 (2026-05-18): events with identical start_time', 'Task @ '],
    'app.js (Calendar zero-duration render)', report);
  await verifyFile(
    resolve(REPO_ROOT, 'detail.js'),
    ['QA-12 (2026-05-18): page_title often embeds the city already',
     'QA-12 (2026-05-18): drop the city subtitle when the title already'],
    'detail.js (header dedupe x2)', report);
  await verifyFile(
    resolve(REPO_ROOT, 'ops.js'),
    ['QA-12 (2026-05-18): Title-case the cluster label', '_qaIsParseDebris', '_qaTitleCase'],
    'ops.js (Data Quality cluster cleanup)', report);
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
