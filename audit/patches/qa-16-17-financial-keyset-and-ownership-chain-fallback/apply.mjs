#!/usr/bin/env node
// ============================================================================
// LCC QA-16 + QA-17 — dia financial keyset + gov ownership-chain fallback.
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
  const sentinel = 'QA pass #16+17 — financial estimates keyset + ownership-chain fallback ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-16-17-financial-keyset-and-ownership-chain-fallback\`
- **Patch:** \`audit/patches/qa-16-17-financial-keyset-and-ownership-chain-fallback/apply.mjs\`

### Discovery
Surfaced in QA pass #2 (post-QA-15 fresh walkthrough). Console showed two persistent errors on every page reload:

\`\`\`
diaQuery clinic_financial_estimates: HTTP 500 (statement_timeout 57014)
govQuery v_ownership_chain: HTTP 400 (column property_id does not exist)
\`\`\`

### QA-16 — dia clinic_financial_estimates statement_timeout (P0)
36,538 \`is_latest=true\` rows lazy-paginated 1000 at a time using OFFSET. Page 30 alone took 1,356 ms; the last few pages tripped statement_timeout. Frontend already had \`count=false\` set — pure OFFSET-seek cost.

**Fix:**
1. New partial keyset index \`idx_cfe_latest_keyset ON clinic_financial_estimates(estimate_id) WHERE is_latest=true\`.
2. \`dialysis.js\` lazy loader switched from OFFSET to keyset pagination (\`order=estimate_id.asc\`, \`filter2=estimate_id=gt.<last_seen>\`).

**Verified:** representative page now executes in **4.5 ms** (was 1,356 ms — ~300× speedup). Full 37-page load ≈ 170 ms total (was ~24 s and frequently timing out).

### QA-17 — gov v_ownership_chain fallback (P0)
QA-08 fixed \`_udOwnerBeginProspecting\` but missed a second caller in the main fetch path. \`detail.js\` line ~228 had \`leaseNumber ? lease_number=eq.X : mainFilter\` — when \`leaseNumber\` was null and \`db==='gov'\`, fallback was \`property_id=eq.X\`, which 400s on gov (column does not exist).

**Fix:** on gov, no fallback — skip the chain fetch when \`leaseNumber\` is missing and return \`{ data: [], count: 0 }\`. No useful chain rows exist for a non-leased gov property anyway.

### Files changed
- \`supabase/migrations/dialysis/20260518170000_dia_qa16_cfe_latest_keyset_index.sql\`
- \`dialysis.js\` — clinic_financial_estimates keyset pagination
- \`detail.js\` — gov chain fetch fallback
- \`AUDIT_PROGRESS.md\` — this closeout

### Remaining queued from QA pass #2
- **P2** Address full Title-casing — "240 w 5th ave" still appears lowercase in the Agency Drift widget. QA-12 only handled direction suffixes (Se/Sw/Ne/Nw), not the street name.
- **P2** Inbox header reads "100 items" but Metrics says "7,420 needs triage" — header should be "Showing 100 of 7,420" to match Messages convention.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-16 + QA-17 — financial keyset + ownership-chain fallback ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyFile(
    resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis', '20260518170000_dia_qa16_cfe_latest_keyset_index.sql'),
    ['idx_cfe_latest_keyset', 'WHERE is_latest = true'],
    'dia keyset index migration', report);
  await verifyFile(
    resolve(REPO_ROOT, 'dialysis.js'),
    ['QA-16 (2026-05-18): pull estimate_id so we can keyset-paginate',
     "order: 'estimate_id.asc'",
     "params.filter2 = 'estimate_id=gt.'"],
    'dialysis.js (clinic_financial_estimates keyset)', report);
  await verifyFile(
    resolve(REPO_ROOT, 'detail.js'),
    ['QA-17 (2026-05-18): on gov, fall back to NO chain fetch',
     'promises.push(Promise.resolve({ data: [], count: 0 }))'],
    'detail.js (gov chain fetch fallback)', report);
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
