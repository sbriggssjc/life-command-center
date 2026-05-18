#!/usr/bin/env node
// ============================================================================
// LCC QA-02 — Allowlist (Edge Function) + completeness-rail null-crash fix.
//
// Closes the SHOWSTOPPER discovered during the 2026-05-18 in-browser QA pass.
// The previous QA-01 patch fixed api/_shared/allowlist.js — but that's the
// EXPRESS path, not the deployed Vercel path. Production routes:
//
//   browser  ──► /api/gov-query                           (Vercel rewrite)
//            ──► /api/admin?_route=edge-data&_source=gov  (handleEdgeDataProxy)
//            ──► supabase.co/functions/v1/data-query      (Edge Function)
//
// The allowlist that mattered was inside the Edge Function. Its
// GOV_READ_TABLES / DIA_READ_TABLES were missing every sprint-era view.
//
// The Edge Function fix is ALREADY DEPLOYED LIVE (v14 on project
// zqzrriwuavgrquhisnoa). This script:
//   1. VERIFIES the source-of-truth file matches the deployed state
//      (refuses to proceed if the on-disk source has regressed).
//   2. VERIFIES the QA-04 detail.js null-filter is on disk.
//   3. APPLIES a one-line comment to api/admin.js near DATA_QUERY_EDGE_URL
//      so the next person doesn't deploy to the wrong Supabase project
//      (LCC Opps vs Dialysis_DB — both host a `data-query` function).
//   4. APPENDS the QA-02/QA-04 closeout block to AUDIT_PROGRESS.md.
//
// Idempotent: re-running with --apply is a no-op once everything is in place.
//
// Branch: audit/qa-02-allowlist-edge-rail-fix
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
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0; let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
async function replaceUnique(path, oldStr, newStr, report, label) {
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const oldN = toEol(oldStr, eol);
  const newN = toEol(newStr, eol);
  const occ = countOccurrences(original, oldN);
  if (occ === 0) {
    // Maybe it's already applied — check for the new content
    if (original.includes(toEol(newStr, eol))) {
      report.push([label, 0, 'already applied']);
      return;
    }
    throw new Error(label + ': anchor not found in ' + path);
  }
  if (occ > 1) throw new Error(label + ': anchor matched ' + occ + ' times in ' + path);
  if (oldN === newN) { report.push([label, 0, 'no changes']); return; }
  const updated = original.replace(oldN, () => newN);
  const delta = updated.length - original.length;
  report.push([label + ' (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

// ─── 1. VERIFY: supabase/functions/data-query/index.ts has QA-02 sentinel ──
async function verifyEdgeFunctionSource(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'functions', 'data-query', 'index.ts');
  if (!await fileExists(path)) throw new Error('Edge Function source not found at ' + path);
  const src = await readFile(path, 'utf8');
  const sentinel = 'QA-02 (2026-05-18): SHOWSTOPPER fix';
  const expectedViews = [
    'v_property_completeness', 'v_next_best_action', 'v_property_value_signal',
    'v_gap_agency_drift', 'v_gap_orphan_sale_owner', 'llc_research_queue',
    'v_gap_lease_tenant_drift', 'v_gap_chain_drift',
  ];
  const missing = expectedViews.filter(v => !src.includes(`"${v}"`));
  if (missing.length > 0) {
    throw new Error(
      'Edge Function source MISSING expected views: ' + missing.join(', ') + '\n' +
      'The deployed Edge Function (v14 on zqzrriwuavgrquhisnoa) has these views in its\n' +
      'allowlist. The on-disk source must match deploy, or the next CI build will regress.\n' +
      'Open ' + path + ' and add them to both GOV_READ_TABLES and DIA_READ_TABLES.'
    );
  }
  if (!src.includes(sentinel)) {
    report.push(['data-query/index.ts (QA-02 sentinel)', 0, 'views present, sentinel comment missing — acceptable']);
  } else {
    report.push(['data-query/index.ts (QA-02 sentinel)', 0, 'verified ✓']);
  }
}

// ─── 2. VERIFY: detail.js has QA-04 null-filter ─────────────────────────────
async function verifyDetailJsFilter(report) {
  const path = resolve(REPO_ROOT, 'detail.js');
  if (!await fileExists(path)) throw new Error('detail.js not found at ' + path);
  const src = await readFile(path, 'utf8');
  if (!src.includes('missing = missing.filter(f => f && typeof f === \'object\' && f.key)')) {
    throw new Error(
      'detail.js MISSING QA-04 null-filter on missing_fields[].\n' +
      'Without it, _udRenderCompletenessRail throws "Cannot read properties of null (reading \'key\')"\n' +
      'because v_property_completeness returns positional nulls for fields that ARE populated.\n' +
      'Open ' + path + ' near _udRenderCompletenessRail and add:\n' +
      "  missing = missing.filter(f => f && typeof f === 'object' && f.key);\n" +
      'just before `const top = missing.slice(0, 6);`.'
    );
  }
  report.push(['detail.js (QA-04 null-filter)', 0, 'verified ✓']);
}

// ─── 3. APPLY: comment in api/admin.js near DATA_QUERY_EDGE_URL ────────────
async function patchAdminJsComment(report) {
  const path = resolve(REPO_ROOT, 'api', 'admin.js');
  if (!await fileExists(path)) throw new Error('api/admin.js not found.');
  await replaceUnique(path,
    `// EDGE FUNCTION PROXIES — Phase 4b: Pure edge-first routing
// No local fallback — edge functions are the source of truth
// ============================================================================

const DATA_QUERY_EDGE_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/data-query';`,
    `// EDGE FUNCTION PROXIES — Phase 4b: Pure edge-first routing
// No local fallback — edge functions are the source of truth
//
// QA-02 (2026-05-18) reminder: the LIVE data-query Edge Function is on
// the Dialysis_DB project (zqzrriwuavgrquhisnoa), NOT on LCC Opps
// (xengecqvemvfknjvbvrq) which also has a data-query function. When
// updating the allowlist in supabase/functions/data-query/index.ts, the
// redeploy target is the project in the URL below. Deploying to the
// wrong project will silently no-op against production traffic.
// ============================================================================

const DATA_QUERY_EDGE_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/data-query';`,
    report, 'api/admin.js (DATA_QUERY_EDGE_URL project note)');
}

// ─── 4. APPLY: AUDIT_PROGRESS.md closeout ──────────────────────────────────
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #2 — Edge Function allowlist + rail null-crash ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-02-allowlist-edge-rail-fix\`
- **Patch:** \`audit/patches/qa-02-allowlist-edge-rail-fix/apply.mjs\`

### Discovery (2026-05-18 in-browser QA pass)
After QA-01 (the Express-side allowlist fix) merged, the detail panel
was still broken in production. Re-tracing the request showed the
frontend calls \`/api/gov-query\`, which \`vercel.json\` rewrites to
\`/api/admin?_route=edge-data&_source=gov\`, which proxies to
\`https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/data-query\`.
The Edge Function has its OWN allowlist (\`supabase/functions/data-query/index.ts\`)
which was missing every sprint-era view. QA-01 fixed the wrong file.

### What was actually deployed
Edge Function v14 to project \`zqzrriwuavgrquhisnoa\`, with these added
to both \`GOV_READ_TABLES\` and \`DIA_READ_TABLES\`:

| View | Used by |
|---|---|
| v_property_completeness | Item #6 completeness rail |
| v_next_best_action | Item #8 next-action bar (detail panel) |
| v_property_value_signal | NBA value FK |
| v_gap_agency_drift | A-5 widget + #8 B-2 dispatcher (gov only) |
| v_gap_lease_tenant_drift | #8 B-4 dispatcher (dia only) |
| v_gap_chain_drift | #8 B-4 dispatcher (dia only) |
| v_gap_orphan_sale_owner | NBA orphan branch |
| llc_research_queue | NBA llc branch |

### QA-04 — completeness-rail null-crash (paired fix)
Once the cache populated, the rail still didn't render. Root cause was
in \`detail.js\`: \`v_property_completeness\` returns \`missing_fields\` as a
positional array (one slot per catalog field). Fields the property HAS
populated are encoded as \`null\` rather than dropped. The chip renderer
read \`f.key\` without filtering, crashing on the first null. Fixed with
\`missing = missing.filter(f => f && typeof f === 'object' && f.key)\`.

### Three-layer verification (captured live)
- **SQL** (Supabase MCP): \`v_property_completeness\` returns 17,459 rows for gov.
- **PostgREST** (anon): row visible for property_id=3198.
- **Frontend pre-fix** (\`govQuery\` via fetch interceptor): \`403 Read access denied for table: v_property_completeness\`.
- **Frontend post-deploy**: \`_udCache.completeness = {score:57, band:"fair", missing_fields:[…6 fields…]}\`, \`_udCache.nextAction = {gap_type:"missing_recorded_owner", gap_value:990M}\`.
- **Rail render**: 6 chips ("Recorded owner +14", "Tenant agency +10", "RBA +8", "Latest sale price +5", "Federal headcount +3", "Build-to-suit flag +3").
- **NAB render**: "Research recorded owner for 1200 New Jersey Ave SE", CTA "Open SoS →", meta "$990M value · opens Secretary of State portal".

### Files changed
- \`supabase/functions/data-query/index.ts\` — already in tree (matches deployed v14 state)
- \`detail.js\` — QA-04 null-filter (line ~1321)
- \`api/admin.js\` — one-line comment near \`DATA_QUERY_EDGE_URL\` so the next person doesn't redeploy to the wrong Supabase project
- \`AUDIT_PROGRESS.md\` — this closeout

### Why QA-01's edits to api/_shared/allowlist.js are no-ops in prod
\`api/_shared/allowlist.js\` belongs to the Express server (Railway path).
The deployed Vercel frontend calls \`/api/gov-query\` which goes through
\`api/admin.js\` → Edge Function. \`allowlist.js\` is never imported on that
code path. QA-01's edits don't hurt — but they also don't fix prod.
Worth a future cleanup pass to either retire the Express stack or
factor the allowlists out of both into a shared JSON.

### Queued for separate patches
- **P0** dia \`v_next_best_action\` Postgres 57014 timeout
- **P0** \`govQuery('property_intel')\` (gov has no such table; use \`v_property_intel\`)
- **P0** \`govQuery('v_ownership_chain')\` with \`property_id\` filter (column doesn't exist on gov)
- **P1** "Open Activities" stat reconciliation across Home / Pipeline / Metrics
- **P1** Sync error count contradicts itself (Pipeline vs Metrics vs Sync Health)
- **P1** Public REITs in \`llc_research_queue\` (Brandywine Realty Trust at NBA #9 + #10)
- **P1** Same-entity duplicates in \`llc_research_queue\`
- **P2** Casing: "Dod", "Ave Se", lowercase "townebank" cluster label
- **P2** Calendar zero-duration events ("5:40 AM – 5:40 AM")
- **P2** Home inbox cards lack inline actions
- **P2** AI Copilot FAB has no visible label / aria-label

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-02 — Edge Function allowlist + rail null-crash ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyEdgeFunctionSource(report);
  await verifyDetailJsFilter(report);
  await patchAdminJsComment(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(60) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
