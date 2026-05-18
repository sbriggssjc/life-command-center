#!/usr/bin/env node
// ============================================================================
// LCC QA-06 — Dia NBA v_next_best_action timeout fix (P0).
//
// The fix is a Supabase migration that materializes v_property_value_signal,
// already applied live to project zqzrriwuavgrquhisnoa via Supabase MCP on
// 2026-05-18. SQL committed at:
//   supabase/migrations/dialysis/20260518130000_dia_qa06_mv_property_value_signal.sql
//
// This script:
//   1. VERIFIES the migration SQL file is in tree (the source of truth).
//   2. APPENDS a closeout block to AUDIT_PROGRESS.md.
//
// Branch: audit/qa-06-dia-nba-mv-property-value-signal
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

async function verifyMigrationSql(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'dialysis',
    '20260518130000_dia_qa06_mv_property_value_signal.sql');
  if (!await fileExists(path)) {
    throw new Error(
      'Migration SQL not found at ' + path + '\n' +
      'This patch is incomplete without it.'
    );
  }
  const src = await readFile(path, 'utf8');
  const expected = [
    'CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_property_value_signal',
    'CREATE UNIQUE INDEX IF NOT EXISTS mv_property_value_signal_pkey',
    'CREATE OR REPLACE VIEW public.v_property_value_signal',
    'refresh-mv-property-value-signal',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('Migration SQL missing expected fragments:\n  - ' + missing.join('\n  - '));
  }
  report.push(['migration SQL (dia/20260518130000_dia_qa06_mv_property_value_signal.sql)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #6 — dia v_next_best_action timeout fix ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-06-dia-nba-mv-property-value-signal\`
- **Patch:** \`audit/patches/qa-06-dia-nba-mv-property-value-signal/apply.mjs\`
- **Migration:** \`supabase/migrations/dialysis/20260518130000_dia_qa06_mv_property_value_signal.sql\`

### Symptom
Home NBA rail header read "⚠ partial · 10 shown · 65 total open" — only gov rows were rendering. Cross-domain fan-out via \`/api/admin?_route=next-best-action\` returned \`by_domain.dialysis.ok=false, status=500, error="canceling statement due to statement timeout"\` (Postgres error code 57014).

### Root cause
\`v_next_best_action\` UNIONs six gap branches and LEFT JOINs each one to \`v_property_value_signal\`. \`v_property_value_signal\` was a regular VIEW with four correlated subqueries per property (sales_transactions / available_listings / leases lookups + a nested curr_cap subquery). For 15,219 properties × 6 union branches that's ~365K subquery executions per call. EXPLAIN ANALYZE timing:

| Node | Time |
|---|---|
| Limit (final) | 75,133 ms |
| Subquery scan on v_property_value_signal × 6 branches | 8-10s each |
| Seq Scan on properties × 5 | 8-10s each |
| Seq Scan on available_listings looped 13,715× | 9,700 ms |
| **Execution Time** | **75,141 ms** |

\`authenticated\` role statement_timeout was below that, so the request was killed mid-flight.

### Fix
Materialize \`v_property_value_signal\`:
- New: \`mv_property_value_signal\` (matview, body identical to old view).
- New: \`mv_property_value_signal_pkey\` unique index on \`property_id\` (required for \`REFRESH … CONCURRENTLY\`).
- Redefine \`v_property_value_signal\` via \`CREATE OR REPLACE VIEW\` as \`SELECT … FROM mv_property_value_signal\` — keeps OID, so \`v_next_best_action\` and any other consumers don't need any change.
- Schedule \`refresh-mv-property-value-signal\` cron at \`50 6 * * *\` (between existing 06:10 and 06:40 refreshes). Uses \`CONCURRENTLY\` so readers aren't blocked.

### After (verified live, 2026-05-18)
| Metric | Before | After |
|---|---|---|
| \`EXPLAIN ANALYZE\` execution | 75,141 ms | **632 ms** |
| Plan cost estimate | 69,770,697 | 19,919 |
| \`/api/admin?_route=next-best-action\` round-trip | timeout | **141 ms** |
| Home rail header | "10 shown · 65 total open · ⚠ partial" | **"10 shown · 130 total open"** |
| Home rail \`by_domain.dialysis.ok\` | \`false\` (57014) | \`true\` |

### Caveats
- \`rev_value\` is now refreshed once daily at 06:50 UTC. Acceptable for a sort key in the NBA queue (gap weights are coarse bands at $1M/$3M/$5M/$10M, not exact dollars).
- On-demand refresh available: \`REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_property_value_signal;\`
- Storage cost: ~450 KB (one row per property × ~30 bytes).

### Files changed
- \`supabase/migrations/dialysis/20260518130000_dia_qa06_mv_property_value_signal.sql\` — applied live via MCP, this commit ships the SQL to the repo as the historical record
- \`AUDIT_PROGRESS.md\` — this closeout

### Queued for follow-up (separate patches)
- **P0** \`govQuery('property_intel')\` 403 — gov has no \`property_intel\` table, only \`v_property_intel\`
- **P0** \`govQuery('v_ownership_chain')\` 400 — gov view has no \`property_id\` column
- **P1** "Open Activities" stat conflict (Home vs Pipeline vs Metrics)
- **P1** Sync error count: Pipeline header vs Metrics tile vs Sync Health page disagree
- **P1** Public REITs + same-entity duplicates in \`llc_research_queue\`
- **P2** Casing/UX nits captured in the QA report

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-06 — dia v_next_best_action timeout fix ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyMigrationSql(report);
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
