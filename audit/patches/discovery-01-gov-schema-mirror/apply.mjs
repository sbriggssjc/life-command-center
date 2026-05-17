#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Discovery patch #1: gov schema mirror + loans CHECK expansion
// Surfaced by item #5 instrumentation within 2 minutes of going live.
// Branch: audit/discovery-01-gov-schema-mirror
// ============================================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

class EditError extends Error {
  constructor(label, msg) { super(`[${label}] ${msg}`); this.label = label; }
}
function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
function toEol(s, eol) { return s.replace(/\r\n/g, '\n').replace(/\n/g, eol); }
function expectUnique(content, anchor, label) {
  const n = content.split(anchor).length - 1;
  if (n === 0) throw new EditError(label, 'anchor NOT FOUND.');
  if (n > 1)   throw new EditError(label, `anchor matched ${n} times.`);
}
function makeApplier(originalContent) {
  const eol = detectEol(originalContent);
  let content = originalContent;
  return {
    eol, get content(){return content;},
    E(label, before, after) {
      const b = toEol(before, eol);
      const a = toEol(after, eol);
      expectUnique(content, b, label);
      content = content.replace(b, a);
    },
  };
}
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

// ============================================================================
// FILE 1: supabase/migrations/government/20260517180000_gov_schema_mirror_audit_discovery.sql
// (Migration already applied to gov via Supabase MCP at 2026-05-17;
// this commits the .sql to the repo as the historical record.)
// ============================================================================
async function writeMigration(report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', 'government', '20260517180000_gov_schema_mirror_audit_discovery.sql');
  const SQL = `-- ============================================================================
-- Audit-Discovery patch #1 (2026-05-17): gov schema mirror + loans CHECK expansion.
--
-- Surfaced by item #5's ingest_write_failures instrumentation within 2 minutes
-- of going live. Three patterns of silent gov-side writes were running on
-- every CoStar sidebar capture for an unknown duration:
--
--   1. upsertDomainOwners:linkOwnershipToSale (sidebar-pipeline.js:6744)
--      PATCHes ownership_history.sale_id, which existed on dia but not gov.
--   2. upsertDomainOwners:linkSaleToOwner (sidebar-pipeline.js:6684)
--      PATCHes sales_transactions.recorded_owner_id + recorded_owner_name,
--      both existed on dia but not gov.
--   3. upsertDomainLoans:financing (sidebar-pipeline.js:5424)
--      INSERTs gov.loans with loan_type='Refinance' or 'Acquisition' (mapped
--      from CoStar by mapLoanType() — built for dia's CHECK). gov's
--      loans_loan_type_check only allowed bank-product values
--      ('Permanent','CMBS','Fannie','SBA',...), so every loan row was
--      rejected with the CHECK violation.
--
-- This migration closes all three patterns by mirroring the dia columns onto
-- gov + expanding the gov CHECK to include the dia-style event values. A
-- separate JS-level finding (12x 409 on uq_st_property_date_price per
-- capture) needs a sidebar code change to use resolution=merge-duplicates
-- and is tracked separately.
--
-- Already applied to gov (scknotsqkcheojiaewwh) at 2026-05-17 via Supabase
-- MCP. This file commits the migration to the repo as the historical
-- record so any new gov-environment provisioning inherits the schema.
-- ============================================================================

-- ── 1. ownership_history.sale_id ────────────────────────────────────────────
ALTER TABLE public.ownership_history
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales_transactions(sale_id);
CREATE INDEX IF NOT EXISTS ownership_history_sale_id_idx
  ON public.ownership_history (sale_id);

-- ── 2. sales_transactions.recorded_owner_id + recorded_owner_name ──────────
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS recorded_owner_id   uuid REFERENCES public.recorded_owners(recorded_owner_id),
  ADD COLUMN IF NOT EXISTS recorded_owner_name text;
CREATE INDEX IF NOT EXISTS sales_transactions_recorded_owner_id_idx
  ON public.sales_transactions (recorded_owner_id);

-- ── 3. Expand loans_loan_type_check to include 'Refinance' + 'Acquisition' ──
ALTER TABLE public.loans
  DROP CONSTRAINT IF EXISTS loans_loan_type_check;
ALTER TABLE public.loans
  ADD CONSTRAINT loans_loan_type_check
  CHECK (loan_type IS NULL OR loan_type = ANY (ARRAY[
    -- gov bank-product values (kept)
    'Permanent'::text, 'Bridge'::text, 'Construction'::text, 'Mezzanine'::text,
    'CMBS'::text, 'SBA'::text, 'Other'::text, 'HUD_FHA'::text, 'Fannie'::text,
    'Freddie'::text, 'County_Recorded'::text,
    -- dia event values added so sidebar's mapLoanType() stops failing
    'Refinance'::text, 'Acquisition'::text
  ]));
`;
  if (DRY) {
    report.push(['supabase/migrations/government/20260517180000_gov_schema_mirror_audit_discovery.sql', SQL.length, 'dry-run (would create)']);
    return;
  }
  await writeFile(path, SQL, 'utf8');
  report.push(['supabase/migrations/government/20260517180000_gov_schema_mirror_audit_discovery.sql', SQL.length, 'written']);
}

// ============================================================================
// FILE 2: AUDIT_PROGRESS.md — log the discoveries
// ============================================================================
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  let c = original;

  const appendBlock = N(`

## Discovery patch #1 — gov schema mirror + loans CHECK expansion (2026-05-17)
- **Trigger:** Item #5 instrumentation (\`ingest_write_failures\`) went live ~17:55 UTC. Within 2 minutes, 48 silent-write failures landed across 5 distinct patterns. Three are fixed by this discovery patch.
- **Branch:** \`audit/discovery-01-gov-schema-mirror\`
- **Patch:** \`audit/patches/discovery-01-gov-schema-mirror/apply.mjs\`
- **Migration applied via Supabase MCP** on gov (\`scknotsqkcheojiaewwh\`) at 2026-05-17 18:05 UTC. Verified: all 3 columns + expanded CHECK present.

### Fixes (live on gov)
| Pattern | Fix |
|---|---|
| 14x 400 on \`sales_transactions.recorded_owner_id\`/\`recorded_owner_name\` (column not found) | Added both columns to gov (UUID FK to recorded_owners + text). |
| 10x 400 on \`ownership_history.sale_id\` (column not found) | Added column to gov (UUID FK to sales_transactions). |
| 2-10x 400 on \`loans.loan_type\` CHECK violation | Expanded gov's \`loans_loan_type_check\` to include 'Refinance' and 'Acquisition' (dia's event vocabulary) alongside gov's existing product taxonomy. |

### Still open (tracked as separate items)
- **12x 409 on \`sales_transactions\` uq_st_property_date_price** per gov capture. JS-level fix: sidebar sales POST needs \`on_conflict=property_id,sale_date,sold_price\` + \`Prefer: resolution=merge-duplicates\`. Tracked as Task #23.
- **D-13 ownership_research_queue column-schema mismatch.** Tracked in item #5 Phase B (Task #21).

### Why this happened
A-5-class schema drift: dia and gov are sibling Supabase projects with their own migration lineage. A migration that added \`ownership_history.sale_id\` + \`sales_transactions.recorded_owner_id\` + \`sales_transactions.recorded_owner_name\` to dia was never mirrored to gov. Same story for the loans CHECK: the dia constraint was authored when only 'Refinance'/'Acquisition' values were needed; gov's was authored later with a richer product vocabulary that doesn't overlap. Both drifts were invisible because of the silent-write loop (audit finding A-3), which item #5 just fixed.

### Verification (live)
\`\`\`sql
-- On gov (scknotsqkcheojiaewwh) — all should return true
SELECT col, exists FROM (VALUES
  ('ownership_history.sale_id'),
  ('sales_transactions.recorded_owner_id'),
  ('sales_transactions.recorded_owner_name')
) AS expected(col)
JOIN LATERAL (
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND (table_name||'.'||column_name)=col)
) AS check(exists) ON true;

-- On LCC Opps: silent-failure counts should DROP after next sidebar capture
SELECT label, count(*) AS n
FROM v_ingest_write_failures_recent
WHERE occurred_at > now() - interval '15 minutes'
GROUP BY label ORDER BY n DESC;
\`\`\`

`);

  const preflightAnchor = N(`\n# Sprint preflight — 2026-05-17\n`);
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }

  if (c === original) {
    report.push(['AUDIT_PROGRESS.md', 0, 'no changes']);
    return;
  }
  const delta = c.length - original.length;
  report.push([`AUDIT_PROGRESS.md (${eol === '\r\n' ? 'CRLF' : 'LF'})`, delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log(`\n=== LCC Audit Sprint — Discovery #1: gov schema mirror ===`);
  console.log(`Mode: ${DRY ? 'DRY-RUN (no writes)' : 'APPLY (will write files)'}\n`);
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error(`Could not find package.json at ${REPO_ROOT}.`);
  }
  const report = [];
  await writeMigration(report);
  await updateAuditProgress(report);
  console.log(`--- ${DRY ? 'DRY-RUN' : 'APPLY'} SUMMARY ---`);
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log(`  ${file.padEnd(80)}  ${sign}${delta} bytes  (${note})`);
  }
  if (DRY) {
    console.log(`\n✓ Dry-run complete. Re-run with --apply.\n`);
    console.log(`  node audit/patches/discovery-01-gov-schema-mirror/apply.mjs --apply\n`);
  } else {
    console.log(`\n✓ Apply complete. Next:\n`);
    console.log(`  git add -A`);
    console.log(`  git commit -F audit/patches/discovery-01-gov-schema-mirror/COMMIT_MSG.txt\n`);
  }
}
main().catch(err => { console.error(`\n❌ FAILED: ${err.message}\n`); process.exit(1); });
