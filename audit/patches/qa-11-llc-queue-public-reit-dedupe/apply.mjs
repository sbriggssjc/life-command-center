#!/usr/bin/env node
// ============================================================================
// LCC QA-11 — Public-REIT filter + same-entity dedupe on llc_research_queue.
//
// Already applied live to both projects on 2026-05-18 via Supabase MCP:
//   • dia (zqzrriwuavgrquhisnoa) — 52 rows skipped (10 public + 42 dupes)
//   • gov (scknotsqkcheojiaewwh) — 5 rows skipped (5 public + 0 dupes)
//
// SQL committed at:
//   • supabase/migrations/dialysis/20260518150000_dia_qa11_llc_queue_public_reit_dedupe.sql
//   • supabase/migrations/government/20260518150000_gov_qa11_llc_queue_public_reit_dedupe.sql
//
// This script:
//   1. VERIFIES both migration SQL files are in tree.
//   2. APPENDS the AUDIT_PROGRESS.md closeout.
//
// Branch: audit/qa-11-llc-queue-public-reit-dedupe
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

async function verifyMigration(domain, fname, report) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', domain, fname);
  if (!await fileExists(path)) {
    throw new Error('Migration not found: ' + path);
  }
  const src = await readFile(path, 'utf8');
  const expected = [
    "ADD CONSTRAINT llc_research_queue_status_check",
    "CREATE OR REPLACE FUNCTION public.llc_normalize_name",
    "CREATE OR REPLACE FUNCTION public.llc_is_public_reit",
    "is_public_reit BOOLEAN",
    "GENERATED ALWAYS AS (public.llc_normalize_name(search_name))",
    "skipped_public_reit",
    "skipped_dupe",
    "CREATE TRIGGER llc_research_queue_auto_skip_trg",
  ];
  const missing = expected.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error(domain + '/' + fname + ' missing fragments:\n  - ' + missing.join('\n  - '));
  }
  report.push(['migration SQL (' + domain + '/' + fname + ')', 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #11 — public-REIT filter + llc queue dedupe ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-11-llc-queue-public-reit-dedupe\`
- **Patch:** \`audit/patches/qa-11-llc-queue-public-reit-dedupe/apply.mjs\`
- **Migrations:**
  - \`supabase/migrations/dialysis/20260518150000_dia_qa11_llc_queue_public_reit_dedupe.sql\`
  - \`supabase/migrations/government/20260518150000_gov_qa11_llc_queue_public_reit_dedupe.sql\`

### Symptom
Brandywine Realty Trust (NYSE: BDN) appeared on the live NBA rail as rank #9 + #10, also as "Brandywine Realty Trust JV MSD Partners". Public REITs file with the SEC, not state Secretary-of-State portals — so the queue's "Open SoS →" CTA was a dead end for them. Same-entity rows with different suffix permutations (e.g. "Realty Income Corp" / "Realty Income CORP" / "Realty Income Corporation") also clogged the queue.

### Fix structure
1. Expanded \`llc_research_queue.status\` CHECK constraint to allow \`skipped_public_reit\` and \`skipped_dupe\`.
2. New IMMUTABLE helper functions:
   - \`llc_normalize_name(text)\` — lowercase + strip common entity suffixes + punctuation, collapse whitespace.
   - \`llc_is_public_reit(text)\` — \`LIKE\` match against a curated 37-entry list of public REITs and the two major dialysis operators.
3. New columns on \`llc_research_queue\`:
   - \`is_public_reit BOOLEAN DEFAULT FALSE\`
   - \`normalized_name TEXT GENERATED ALWAYS AS (llc_normalize_name(search_name)) STORED\`
   - Partial index \`llc_research_queue_normalized_idx ON (normalized_name) WHERE normalized_name IS NOT NULL\`.
4. Backfill: status='queued' rows matching the public-REIT list → \`skipped_public_reit\`. Within remaining queued rows, \`row_number() OVER (PARTITION BY normalized_name ORDER BY created_at, queue_id)\` > 1 → \`skipped_dupe\`.
5. BEFORE INSERT/UPDATE trigger \`llc_research_queue_auto_skip_trg\` applies the same logic to future rows.

\`v_next_best_action\` already filters \`status='queued'\`, so the skipped rows are naturally excluded from the NBA rail without view changes.

### Live impact (verified 2026-05-18)
| Domain | queued before | queued after | skipped_public_reit | skipped_dupe |
|---|---|---|---|---|
| dia (zqzrriwuavgrquhisnoa) | 1,267 | **1,215** | 10 | 42 |
| gov (scknotsqkcheojiaewwh) | 254 | **249** | 5 | 0 |
| **Total** | **1,521** | **1,464** | **15** | **42** |

57 dead-end rows removed across both queues. Brandywine Realty Trust no longer enqueued; the Realty Income three-way dupe collapsed to one row.

### Files changed
- \`supabase/migrations/dialysis/20260518150000_dia_qa11_llc_queue_public_reit_dedupe.sql\`
- \`supabase/migrations/government/20260518150000_gov_qa11_llc_queue_public_reit_dedupe.sql\`
- \`AUDIT_PROGRESS.md\` (this closeout)

### Caveats
- Public-REIT list is curated, not exhaustive — extend by appending to the \`VALUES\` list in \`llc_is_public_reit\`.
- Normalizer doesn't strip common abbreviations (Hldgs, Mgmt, Cap Prtnrs, …) so a few collision pairs survive. Fixable iteratively.

### Queued for follow-up
- **P2** Casing/UX nits documented in \`outputs/lcc-qa-pass-2026-05-18.docx\`
- **Optional** SEC EDGAR CTA routing for \`is_public_reit = true\` rows if a user navigates to one by direct lookup.
- **Optional** extend the normalizer with common abbreviations (Hldgs, Mgmt, Cap Prtnrs, etc.).

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-11 — Public-REIT filter + LLC queue dedupe ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyMigration('dialysis',  '20260518150000_dia_qa11_llc_queue_public_reit_dedupe.sql', report);
  await verifyMigration('government', '20260518150000_gov_qa11_llc_queue_public_reit_dedupe.sql', report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(80) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
