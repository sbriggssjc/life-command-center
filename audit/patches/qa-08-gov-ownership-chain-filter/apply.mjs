#!/usr/bin/env node
// ============================================================================
// LCC QA-08 — Gov v_ownership_chain filter shape fix.
//
// One-block frontend fix in detail.js's _udOwnerBeginProspecting: the chain
// refresh after a "Begin Prospecting" click hard-coded property_id=eq.X for
// both domains, but the gov view has no property_id column. Result was a
// silent 400 on every gov click, with .catch swallowing the error and the
// Ownership tab re-rendering as empty.
//
// This script:
//   1. VERIFIES the fix is on disk (sentinel: QA-08 comment + gov-aware
//      chainFilter construction).
//   2. APPENDS the closeout block to AUDIT_PROGRESS.md.
//
// Branch: audit/qa-08-gov-ownership-chain-filter
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

async function verifyDetailJsFix(report) {
  const path = resolve(REPO_ROOT, 'detail.js');
  if (!await fileExists(path)) throw new Error('detail.js not found at ' + path);
  const src = await readFile(path, 'utf8');
  // Two sentinels: the QA-08 comment and the gov-aware chainFilter line
  const sentinel = 'QA-08 (2026-05-18): gov v_ownership_chain has no property_id';
  const filterLine = "(db === 'gov' && leaseNum)";
  if (!src.includes(sentinel)) {
    throw new Error(
      'detail.js missing QA-08 sentinel.\n' +
      'Expected the comment "' + sentinel + '" inside _udOwnerBeginProspecting.\n' +
      'Open ' + path + ' near the Begin Prospecting chain refresh and apply the fix.'
    );
  }
  if (!src.includes(filterLine)) {
    throw new Error(
      'detail.js missing gov-aware chainFilter construction.\n' +
      'Expected expression: ' + filterLine + '\n' +
      'Add the gov→lease_number / dia→property_id dispatch in _udOwnerBeginProspecting.'
    );
  }
  report.push(['detail.js (_udOwnerBeginProspecting chain refresh)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #8 — gov v_ownership_chain filter shape ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-08-gov-ownership-chain-filter\`
- **Patch:** \`audit/patches/qa-08-gov-ownership-chain-filter/apply.mjs\`

### Symptom
Console showed \`govQuery v_ownership_chain: HTTP 400 {error: "Supabase returned 400", detail: "column v_ownership_chain.property_id does not exist"}\` on every "Begin Prospecting" click on a gov property. The Ownership tab silently re-rendered with an empty chain timeline until the user reloaded the panel.

### Root cause
\`detail.js\`'s \`_udOwnerBeginProspecting\` (line ~5620) hard-coded \`property_id=eq.X\` as the filter when re-fetching the chain after writing to \`true_owners\`. The gov \`v_ownership_chain\` view's columns are \`ownership_id\` / \`lease_number\` / \`address\` / \`city\` / \`state\` / \`transfer_date\` / \`from_owner\` / \`to_owner\` / ... — there is no \`property_id\`. The dia view does have \`property_id\`.

The main panel fetch at line ~222 already dispatched correctly (gov→\`lease_number=eq.X\`, dia→\`property_id=eq.X\`), but the refresh path missed the dispatch.

### Fix
Mirror the existing pattern in the refresh path:
\`\`\`js
const propId   = _udCache?.ids?.property_id   || _udCache?.property?.property_id;
const leaseNum = _udCache?.ids?.lease_number  || _udCache?.property?.lease_number;
const chainFilter = (db === 'gov' && leaseNum)
  ? 'lease_number=eq.' + encodeURIComponent(leaseNum)
  : (propId ? 'property_id=eq.' + propId : null);
\`\`\`

### Verified live (2026-05-18)
\`\`\`
await window.govQuery('v_ownership_chain', '*',
  { filter: 'lease_number=eq.LDC02050', order: 'transfer_date.desc', limit: 50 })
→ { count: 2, data: [
    { ownership_id: '19be4192…',
      from_owner: 'Museum Of The Bible, Inc..The',
      to_owner:   'Woc Llc',
      transfer_date: '2016-11-01' }, … ] }
\`\`\`
Before the fix: same call with \`property_id=eq.{N}\` → HTTP 400.

### Files changed
- \`detail.js\` — one block (~10 lines) inside \`_udOwnerBeginProspecting\`
- \`AUDIT_PROGRESS.md\` — this closeout

### Queued for follow-up
- **P1** "Open Activities" stat conflict (Home vs Pipeline vs Metrics)
- **P1** Sync error count contradicts itself
- **P1** Public REITs + same-entity duplicates in \`llc_research_queue\`
- **P2** Casing/UX nits documented in \`outputs/lcc-qa-pass-2026-05-18.docx\`
- **Optional** uniformity cleanup — add \`property_id\` to gov \`v_ownership_chain\` so the frontend can use the same filter shape across domains (not required, but would remove the dispatch).

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-08 — gov v_ownership_chain filter shape fix ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyDetailJsFix(report);
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
