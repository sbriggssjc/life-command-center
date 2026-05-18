#!/usr/bin/env node
// ============================================================================
// LCC QA-07 — Mirror property_intel to gov so pipeline-stage persists.
//
// Already applied live on 2026-05-18:
//   1. Migration to scknotsqkcheojiaewwh (gov):
//      supabase/migrations/government/20260518140000_gov_qa07_property_intel.sql
//   2. Edge Function v15 deploy to zqzrriwuavgrquhisnoa adding
//      property_intel to GOV_READ_TABLES + GOV_WRITE_TABLES.
//
// This script:
//   1. VERIFIES the gov migration SQL is in tree.
//   2. VERIFIES supabase/functions/data-query/index.ts has property_intel in
//      both gov sets (matches deployed v15).
//   3. APPENDS the closeout block to AUDIT_PROGRESS.md.
//
// Branch: audit/qa-07-gov-property-intel
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
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government',
    '20260518140000_gov_qa07_property_intel.sql');
  if (!await fileExists(path)) {
    throw new Error('Migration SQL not found at ' + path);
  }
  const src = await readFile(path, 'utf8');
  const expected = [
    'CREATE TABLE IF NOT EXISTS public.property_intel',
    'pipeline_stage',
    'ENABLE ROW LEVEL SECURITY',
    'GRANT SELECT ON public.property_intel TO anon',
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error('Migration SQL missing expected fragments:\n  - ' + missing.join('\n  - '));
  }
  report.push(['migration SQL (government/20260518140000_gov_qa07_property_intel.sql)', 0, 'verified ✓']);
}

async function verifyEdgeFunctionSource(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'functions', 'data-query', 'index.ts');
  if (!await fileExists(path)) {
    throw new Error('Edge Function source not found at ' + path);
  }
  const src = await readFile(path, 'utf8');
  // Look for property_intel inside both gov sets — split at the marker
  // boundary so we don't accidentally count the DIA mention.
  const govReadIdx = src.indexOf('const GOV_READ_TABLES');
  const govWriteIdx = src.indexOf('const GOV_WRITE_TABLES');
  const diaReadIdx = src.indexOf('const DIA_READ_TABLES');
  if (govReadIdx < 0 || govWriteIdx < 0 || diaReadIdx < 0) {
    throw new Error('Could not locate GOV_READ_TABLES / GOV_WRITE_TABLES / DIA_READ_TABLES anchors in ' + path);
  }
  const govReadBlock = src.substring(govReadIdx, govWriteIdx);
  const govWriteBlock = src.substring(govWriteIdx, diaReadIdx);
  if (!govReadBlock.includes('"property_intel"')) {
    throw new Error(
      '`property_intel` not found in GOV_READ_TABLES block of ' + path + '.\n' +
      'Deployed Edge Function v15 has it — on-disk source must match. Add:\n' +
      '  // QA-07 (2026-05-18): property_intel mirrored to gov for pipeline-stage\n' +
      '  "property_intel",\n' +
      'inside the GOV_READ_TABLES Set.'
    );
  }
  if (!govWriteBlock.includes('"property_intel"')) {
    throw new Error(
      '`property_intel` not found in GOV_WRITE_TABLES block of ' + path + '.\n' +
      'Deployed Edge Function v15 has it — on-disk source must match. Add:\n' +
      '  // QA-07 (2026-05-18): pipeline-stage writes upsert property_intel\n' +
      '  "property_intel",\n' +
      'inside the GOV_WRITE_TABLES Set.'
    );
  }
  report.push(['data-query/index.ts (GOV_READ_TABLES + GOV_WRITE_TABLES)', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #7 — gov property_intel mirror ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-07-gov-property-intel\`
- **Patch:** \`audit/patches/qa-07-gov-property-intel/apply.mjs\`
- **Migration:** \`supabase/migrations/government/20260518140000_gov_qa07_property_intel.sql\`

### Symptom
Console showed \`govQuery property_intel: HTTP 403 {error: Read access denied for table: property_intel}\` on every gov property detail panel open. The pipeline-stage chip click on gov properties looked like it worked (in-memory pill flipped color, "Pipeline stage → X" toast fired, SF opportunity upsert went out), but the next reload reverted to the heuristic-inferred stage.

### Root cause
The frontend pipeline-stage feature in \`detail.js\` was always written to be domain-agnostic — \`_udRenderPipelinePill\`, \`_udHydratePipelineStage\`, and \`_udAdvancePipelineStage\` dispatch on \`_udCache.db\`. But the original 2026-04-16 \`property_intel\` migration explicitly says "Target: Dialysis domain Supabase". The table never existed on the gov database, and \`property_intel\` was never in \`GOV_READ_TABLES\` / \`GOV_WRITE_TABLES\`.

### Fix
1. Created \`property_intel\` on gov (\`scknotsqkcheojiaewwh\`) mirroring the dia schema — primary key on \`property_id\`, index on \`pipeline_stage\`, RLS enabled, anon SELECT policy, authenticated SELECT/INSERT/UPDATE grant.
2. Added \`property_intel\` to both \`GOV_READ_TABLES\` and \`GOV_WRITE_TABLES\` in the Edge Function.
3. Redeployed as Edge Function v15 on \`zqzrriwuavgrquhisnoa\`.

### Verified live (2026-05-18)
- \`window.govQuery('property_intel', 'property_id,pipeline_stage', { filter: 'property_id=eq.3198', limit: 1 })\` → \`{count: 0, dataLen: 0}\` (no more 403; empty because nothing has been persisted yet).
- \`window.diaQuery('property_intel', …)\` continues to work unchanged.
- Console errors per gov detail open: 1× 403 → 0.

### Files changed
- \`supabase/migrations/government/20260518140000_gov_qa07_property_intel.sql\` — applied live via MCP
- \`supabase/functions/data-query/index.ts\` — \`property_intel\` added to both gov sets (matches deployed v15)
- \`AUDIT_PROGRESS.md\` — this closeout

### Queued for follow-up
- **P0** \`govQuery('v_ownership_chain')\` 400 — gov view has no \`property_id\` column
- **P1** "Open Activities" stat conflict
- **P1** Sync error count contradicts itself
- **P1** Public REITs + same-entity duplicates in \`llc_research_queue\`
- **P2** Casing/UX nits documented in \`outputs/lcc-qa-pass-2026-05-18.docx\`

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-07 — gov property_intel mirror ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyMigrationSql(report);
  await verifyEdgeFunctionSource(report);
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
