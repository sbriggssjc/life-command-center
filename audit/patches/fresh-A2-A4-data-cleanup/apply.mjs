#!/usr/bin/env node
// ============================================================================
// LCC Fresh Audit — Findings A-2 + A-4 combined data cleanup.
//
// A-2 — sales_transactions 409 conflicts on uq_st_property_date_price
//   Diagnosis: 269 rows in ingest_write_failures over 24h were
//   sales_transactions POST → 409 → recovered by the existing
//   409-recovery branch at sidebar-pipeline.js:4717. The recovery
//   path works, but the initial domainQuery() POST didn't pass a
//   label, so the recovered failure is anonymized in the log —
//   making A-3 (the "579 unlabeled 400s" finding) noisier than it
//   needs to be.
//   Fix: pass a label to the sales POST so the recovery cases are
//   filterable. Doesn't change behavior; cleans up telemetry.
//
// A-4 — gov.loans status NULL rejected by loans_status_check
//   Diagnosis: 54 silent 4xx/24h on upsertDomainLoans:financing.
//   The CoStar parser often returns no parsable status (loan_status
//   text blob) → writer's \`const status = fin.loan_status || null\`
//   sets status=null → stripNulls removes it from the payload →
//   PostgREST inserts default NULL → loans_status_check rejects
//   because NULL is not in the allowed list.
//
//   Two-part fix:
//   1. SQL: expand loans_status_check to allow NULL (defensive).
//      Unknown-status loans no longer reject the whole row.
//   2. JS: add mapLoanStatus() normalizer that maps CoStar-style
//      text ("Outstanding", "Paid Off", "Foreclosure", etc.) to
//      the allowed enum. Apply at the writer.
//
// Both halves of A-4 already applied: CHECK expanded via MCP at
// 2026-05-18; the writer normalization ships in this patch.
//
// Branch: audit/fresh-A2-A4-data-cleanup
// ============================================================================

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
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
  if (occ === 0) throw new Error(label + ': anchor not found in ' + path);
  if (occ > 1)  throw new Error(label + ': anchor matched ' + occ + ' times in ' + path);
  if (oldN === newN) { report.push([label, 0, 'no changes']); return; }
  const updated = original.replace(oldN, () => newN);
  const delta = updated.length - original.length;
  report.push([label + ' (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}
async function writeFileEnsuringDir(path, content, report, label) {
  if (DRY) { report.push([label, content.length, 'dry-run']); return; }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  report.push([label, content.length, 'written']);
}

// ─── Migration: gov loans_status_check allow NULL ───
async function writeGovMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260518110000_gov_loans_status_check_allow_null.sql');
  const SQL = `-- ============================================================================
-- Fresh audit A-4 (gov, 2026-05-18): expand loans_status_check to allow NULL.
--
-- Today's CHECK:
--   CHECK (status = ANY (ARRAY['active','paid_off','matured','defaulted',
--                              'refinanced','assumed']))
-- After Discovery #1 (loans CHECK expansion shipped earlier), this list is
-- correct for known statuses. But writers that lack a parsable status from
-- the source (CoStar's text blob is often unparseable) send NULL → CHECK
-- rejects the whole row. 54 silent 4xx/24h observed in ingest_write_failures.
--
-- Defensive fix: allow NULL. sidebar-pipeline.js gets a mapLoanStatus()
-- normalizer (paired in this patch) so we set the right value when we can.
-- ============================================================================
ALTER TABLE public.loans DROP CONSTRAINT IF EXISTS loans_status_check;

ALTER TABLE public.loans
  ADD CONSTRAINT loans_status_check
  CHECK (status IS NULL OR status = ANY (ARRAY['active','paid_off','matured','defaulted','refinanced','assumed']));

COMMENT ON CONSTRAINT loans_status_check ON public.loans IS
  'Fresh audit A-4 (2026-05-18): allow NULL so unknown-status loans don''t '
  'reject the whole row. sidebar-pipeline.js mapLoanStatus() normalizes when '
  'possible; unrecognized inputs fall through as NULL.';
`;
  await writeFileEnsuringDir(path, SQL, report,
    'supabase/migrations/government/20260518110000_gov_loans_status_check_allow_null.sql');
}

// ─── sidebar-pipeline.js: mapLoanStatus + apply + sales POST label ───
async function patchSidebarPipeline(report) {
  const path = resolve(REPO_ROOT, 'api', '_handlers', 'sidebar-pipeline.js');
  if (!await fileExists(path)) throw new Error('sidebar-pipeline.js not found.');

  // 1. Add mapLoanStatus helper + apply to the gov status assignment.
  await replaceUnique(path,
    `    const status     = fin.loan_status || null;`,
    `    const status     = mapLoanStatus(fin.loan_status);`,
    report, 'sidebar-pipeline.js (A-4: apply mapLoanStatus to gov writer)');

  // 2. Define mapLoanStatus. Anchor on a stable nearby function defn —
  //    mapLoanType is defined elsewhere; let's insert before const isCmbs.
  //    Use the unique line that ends with the term_years assignment.
  await replaceUnique(path,
    `    const termYr     = Number.isFinite(fin.term_years)  ? fin.term_years  : null;`,
    `    const termYr     = Number.isFinite(fin.term_years)  ? fin.term_years  : null;
    // Fresh audit A-4 (2026-05-18): inline normalizer for CoStar-style
    // loan status text. Mapped to the loans_status_check allowed enum.
    // Unknown / unparseable inputs return null (loans_status_check now
    // allows NULL after the paired migration).
    function mapLoanStatus(raw) {
      if (raw == null) return null;
      const s = String(raw).toLowerCase();
      if (!s.trim()) return null;
      if (/(outstanding|current|active|performing|open|in\\s*good\\s*standing)/.test(s)) return 'active';
      if (/(paid[\\s_-]*off|paid[\\s_-]*in[\\s_-]*full|closed[\\s_-]*paid|satisfied)/.test(s)) return 'paid_off';
      if (/matured|mature[d]?/.test(s)) return 'matured';
      if (/(default|delinquent|foreclos|reo|non[\\s_-]*performing|distressed)/.test(s)) return 'defaulted';
      if (/(refinanced|refi'?d|paid[\\s_-]*by[\\s_-]*refi)/.test(s)) return 'refinanced';
      if (/(assumed|assumption)/.test(s)) return 'assumed';
      // Common CoStar headers we DO see: "Loan Status:OutstandingLoan Type:..."
      // — try once more on a substring after "Loan Status:" prefix.
      const m = s.match(/loan\\s*status[:\\s]+([a-z][a-z\\s]+?)(?:loan|\\d|$)/);
      if (m && m[1]) {
        const inner = m[1].trim();
        if (/outstanding|current|active|performing/.test(inner)) return 'active';
        if (/paid/.test(inner)) return 'paid_off';
        if (/matur/.test(inner)) return 'matured';
        if (/default|delinquent|foreclos/.test(inner)) return 'defaulted';
        if (/refi/.test(inner)) return 'refinanced';
        if (/assum/.test(inner)) return 'assumed';
      }
      return null;
    }`,
    report, 'sidebar-pipeline.js (A-4: define mapLoanStatus)');

  // 3. A-2: add label to the sales_transactions POST so the 269/24h
  //    "labelless 409 → recovered" log entries become identifiable.
  await replaceUnique(path,
    `    } else {
      // Create new
      const result = await domainQuery(domain, 'POST', 'sales_transactions', saleData);

      // Discovery patch #2 (audit/discovery-02-sales-409-dedupe, 2026-05-17):`,
    `    } else {
      // Create new
      // Fresh audit A-2 (2026-05-18): label the POST so the 409-recovery
      // log entries surface in ingest_write_failures as recoverable
      // (vs. anonymous 4xx in the unlabeled bucket).
      const result = await domainQuery(domain, 'POST', 'sales_transactions', saleData,
        { label: 'upsertDomainSales:initialInsert' });

      // Discovery patch #2 (audit/discovery-02-sales-409-dedupe, 2026-05-17):`,
    report, 'sidebar-pipeline.js (A-2: label sales POST)');
}

// ─── AUDIT_PROGRESS.md ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Fresh audit A-2 + A-4 ✅ — sales POST label + loans status normalization
- **Status:** ✅ DONE.
- **Branch:** \`audit/fresh-A2-A4-data-cleanup\`
- **Patch:** \`audit/patches/fresh-A2-A4-data-cleanup/apply.mjs\`

### A-2 (sales_transactions 409 anonymization)
Diagnosis: 269 ingest_write_failures rows over 24h were sales_transactions POST → 409 conflicts on \`uq_st_property_date_price\`. The 409-recovery branch (sidebar-pipeline.js:4717) ALREADY catches and resolves them via lookup + PATCH — the existing recovery code is correct. BUT the initial POST was unlabeled, so the recovered failures showed up in the log as anonymous 4xx, contributing to the 579 "unlabeled errors" bucket (A-3).

Fix: pass \`{ label: 'upsertDomainSales:initialInsert' }\` to the POST. Behavior unchanged; failures now have an identifiable label.

### A-4 (loans_status_check rejecting NULL status)
Diagnosis: 54 silent \`upsertDomainLoans:financing\` 4xx/24h. Root cause: CoStar's loan_status text blob is often unparseable → writer assigns \`status = fin.loan_status || null\` → \`stripNulls\` removes the NULL from payload → PostgREST inserts default NULL → \`loans_status_check\` rejects because NULL wasn't in the allowed enum.

Two-part fix:
1. **SQL** (applied via MCP): expand \`loans_status_check\` to allow NULL. Unknown-status loans no longer reject the whole row.
2. **JS** (this patch): add \`mapLoanStatus()\` inline helper. Maps CoStar-style text → enum:
   - "Outstanding / Current / Active / Performing / Open" → \`active\`
   - "Paid Off / Paid in Full / Closed-Paid / Satisfied" → \`paid_off\`
   - "Matured" → \`matured\`
   - "Default / Delinquent / Foreclosure / REO / Non-Performing / Distressed" → \`defaulted\`
   - "Refinanced / Refi'd" → \`refinanced\`
   - "Assumed / Assumption" → \`assumed\`
   - Unrecognized → \`null\` (defensive — falls through to the NULL-allowed CHECK)
   - Plus a substring fallback that strips the "Loan Status:" prefix from CoStar's concatenated header before the regex match.

### Files changed
- \`supabase/migrations/government/20260518110000_gov_loans_status_check_allow_null.sql\` (already applied via MCP)
- \`api/_handlers/sidebar-pipeline.js\` — mapLoanStatus helper + apply + sales POST label
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. \`grep -c "mapLoanStatus" api/_handlers/sidebar-pipeline.js\` → 2 or more (definition + call site)
2. \`grep -c "upsertDomainSales:initialInsert" api/_handlers/sidebar-pipeline.js\` → 1
3. After deploy + a fresh CoStar capture of any gov property with a loan:
   \`\`\`sql
   -- On LCC Opps:
   SELECT label, http_status, count(*)
     FROM public.ingest_write_failures
    WHERE occurred_at > now() - interval '1 hour'
      AND (label = 'upsertDomainLoans:financing'
        OR label = 'upsertDomainSales:initialInsert')
    GROUP BY 1, 2 ORDER BY 1, 2;
   -- Expected: 0 rows for 'upsertDomainLoans:financing' (status normalizes
   -- or NULL is now allowed). Any 'upsertDomainSales:initialInsert' rows
   -- with http_status=409 are EXPECTED — they're the 409 recoveries now
   -- properly labeled.
   \`\`\`

### Fresh-audit punch list status (after this patch)
- A-1 ✅ orphan sale backfill
- A-2 ✅ sales POST labeled
- A-3 📋 unlabeled 400 errors triage (next)
- A-4 ✅ loans status normalized + CHECK loosened
- A-5 📋 agency-drift review UI

`);

  c = c + appendBlock;
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Fresh Audit A-2 + A-4 — data cleanup ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await writeGovMigration(report);
  await patchSidebarPipeline(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(85) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
