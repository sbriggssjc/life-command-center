#!/usr/bin/env node
// ============================================================================
// LCC QA-26 — gov dashboard parallel pagination.
//
// Pure frontend refactor: govQueryAll and _loadPaginatedQuery now fetch
// page 0 with count=exact, then issue all remaining pages via Promise.all.
// Also parallelized the ownership-coverage block (3 independent queries
// awaited serially -> Promise.all).
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

async function verifyGovJs(report) {
  const path = resolve(REPO_ROOT, 'gov.js');
  if (!await fileExists(path)) throw new Error('gov.js not found at ' + path);
  const src = await readFile(path, 'utf8');
  const expected = [
    'QA-26 (2026-05-18): parallelize page fetches',
    'QA-26 (2026-05-18): parallel pagination',
    'QA-26 (2026-05-18): parallelize the three independent table reads',
    'await Promise.all([',
    'ptResSettled',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('gov.js missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push(['gov.js (parallel pagination + parallel ownership-coverage)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #26 — Gov dashboard parallel pagination ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-26-gov-parallel-pagination\`
- **Patch:** \`audit/patches/qa-26-gov-parallel-pagination/apply.mjs\`
- **Severity:** P1 perf — 8–14s page-render delay on gov home dashboard.

### Symptom
Gov home dashboard displayed "loading..." for 8–14 seconds before becoming usable. Multiple widgets resolved only after long async waits even though the database queries themselves were fast (sub-100ms).

### Diagnosis
Phase 1 in \`loadGovData\` was Promise.all'd at the top level — \`prospect_leads\`, \`properties\`, \`available_listings\` all started simultaneously — but each individual paginated query was internally fetching pages SERIALLY at 1000 rows/page. For \`properties\` (17,472 rows = 18 pages) at ~400ms round-trip each, that's ~7s of latency.

\`EXPLAIN ANALYZE\` on the full properties query with the same big column set and ORDER BY: **95ms DB execution time**. The remaining ~7s was pure round-trip latency through the Edge Function + PostgREST.

Live table sizes (2026-05-18):
\`\`\`
properties         17,472  18 pages
prospect_leads     11,516  12 pages
ownership_history  13,508  14 pages
sales_transactions  7,706   8 pages
true_owners        14,099  15 pages
\`\`\`

### Fix
\`govQueryAll\` and \`_loadPaginatedQuery\` now:
1. Fetch page 0 with \`count=exact\` (returns total via Content-Range)
2. Issue all remaining pages in parallel via \`Promise.all\`
3. Wall-clock = first_page + slowest_parallel_page (~800ms-1.2s) instead of N_pages × ~400ms (~5-7s)

Also parallelized the ownership-coverage block in \`renderGovOverview\` which awaited three independent queries serially: \`ownership_history\`, \`true_owners\`, and QA-25 \`v_prospect_targets\`. All three now run via \`Promise.all\` with a settled-result wrapper on the prospect query so a 403 falls back cleanly to the legacy metric.

### Expected speedup
- Phase 1 (first paint):  ~7–8s → ~1.0–1.5s
- Phase 2 (background):   ~6–10s → ~1–2s
- Ownership coverage:     ~12–18s → ~1.5–2s

### Risks considered
- 18 concurrent HTTP requests at launch: Supabase doesn't rate-limit a single auth token meaningfully; acceptable.
- DB sort repeated 18× in parallel: ~1.7s of DB CPU across 18 backends, brief spike. Net wall-clock win is worth it.
- Original 120s total-time fuse removed from govQueryAll; per-request 30s abort in \`govQuery\` still applies.

### Out of scope
Dia side has the same serial pattern but \`diaQuery\` hardcodes \`count=false\` in its URL builder. The same fix on dia requires refactoring \`diaQuery\` first. Separate patch.

### Files changed
- \`gov.js\` — \`govQueryAll\`, \`_loadPaginatedQuery\`, ownership-coverage block
- \`AUDIT_PROGRESS.md\` — this closeout

No SQL changes. No Edge Function changes. No allowlist changes.

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-26 — Gov dashboard parallel pagination ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
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
