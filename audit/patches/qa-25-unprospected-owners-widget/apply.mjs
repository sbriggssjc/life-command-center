#!/usr/bin/env node
// ============================================================================
// LCC QA-25 — Unprospected Owners widget (reframe + actionable).
//
// Two coupled fixes for the misleading "Missing SF Link 97%" widget:
//   (a) Two new views: v_prospect_targets on gov + dia. Returns owners that
//       own >=1 property with no SF link, ordered by prop_count. Dia
//       version also excludes is_operator_not_owner=TRUE.
//   (b) Frontend reframe (gov.js + dialysis.js): widget renamed to
//       "Unprospected Owners", numerator + denominator filtered to
//       active owners (>=1 property), card clickable to a top-100 modal.
//   (c) Edge Function allowlist: v_prospect_targets added to both
//       GOV_READ_TABLES and DIA_READ_TABLES.
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

async function verifyMigration(report, kind, file, sentinels) {
  const path = resolve(REPO_ROOT, 'supabase', 'migrations', kind, file);
  if (!await fileExists(path)) throw new Error('Migration not found at ' + path);
  const src = await readFile(path, 'utf8');
  const missing = sentinels.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error(kind + ' migration missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push([kind + ' QA-25 migration (v_prospect_targets)', 0, 'verified ✓']);
}

async function verifyFile(report, relPath, sentinels, label) {
  const path = resolve(REPO_ROOT, relPath);
  if (!await fileExists(path)) throw new Error(relPath + ' not found at ' + path);
  const src = await readFile(path, 'utf8');
  const missing = sentinels.filter(s => !src.includes(s));
  if (missing.length > 0) {
    throw new Error(relPath + ' missing sentinels:\n  - ' + missing.join('\n  - '));
  }
  report.push([label, 0, 'verified ✓']);
}

async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  const sentinel = 'QA pass #25 — Unprospected Owners widget (gov + dia) ✅';
  if (original.includes(sentinel)) {
    report.push(['AUDIT_PROGRESS.md', 0, 'already applied']);
    return;
  }
  const block = N(`

## ${sentinel}
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-25-unprospected-owners-widget\`
- **Patch:** \`audit/patches/qa-25-unprospected-owners-widget/apply.mjs\`
- **Migrations:**
  - \`supabase/migrations/dialysis/20260518230000_dia_qa25_v_prospect_targets.sql\`
  - \`supabase/migrations/government/20260518230000_gov_qa25_v_prospect_targets.sql\`
- **Edge Function:** data-query v16 (v_prospect_targets added to both allowlists)
- **Severity:** P2 — misleading dashboard metric; not a data bug.

### Symptom
"Missing SF Link" widget on the Gov dashboard read 97% (13,675 of 14,106 true_owners). Dia read 79% (2,722 of 3,422). The number looked like a data-quality alarm but was misleading on two axes.

### Two layered problems
**(a) Stub pollution.** The widget counted ALL true_owners — including owners that own zero properties. Live distribution (2026-05-18):
- Gov: 6,303 of 14,106 (44.7%) are zero-prop stubs
- Dia: 2,580 of 3,422 (75.4%) are zero-prop stubs

These are residue from the LLC research queue and property merges/deletes. They inflate the denominator without representing anything actionable.

**(b) Wrong frame.** "Missing SF Link" implies the link exists in SF and the join broke. It doesn't. The dia \`salesforce_accounts\` table (5,004 rows) is Scott's CRM contact book, NOT a universe of property owners:
- Exact-name matches between 2,722 unlinked dia owners and 5,004 SF accounts: **0**
- Best pg_trgm fuzzy similarity for top 18 unlinked owners by prop count: **0.23 – 0.55** (every match is a different company)
- Gov has no salesforce_accounts table at all

The owners aren't "missing a link." They're unprospected BD targets — SMBC Leasing (104 props), Elliott Bay Capital (65), MassMutual (57), Realty Income Corporation (25), AR Global (24), Vereit (19), Healthcare Realty Trust (7); Boyd Watterson Global (31), Prologis L.P. (24), Highwoods Realty (21), GPT Properties Trust (16), etc.

### Fix (omnibus)
1. **\`v_prospect_targets\` view** (gov + dia): owners with ≥1 property and no SF link, ordered by prop count. Dia version excludes \`is_operator_not_owner = TRUE\` (operators like DaVita aren't prospects).
2. **Widget reframe** (gov.js + dialysis.js): "Missing SF Link" → "Unprospected Owners". Numerator and denominator both filtered to active owners (≥1 property). Subtext: "active owners — click to view BD targets". Card is clickable.
3. **Prospect modal**: clicking the card opens a top-100 sortable list with owner, property count, state, and contact status. Each row is a high-value BD target.
4. **Edge Function v16**: \`v_prospect_targets\` added to GOV_READ_TABLES and DIA_READ_TABLES.

### Verified live
- Dia view returned top 10 with SMBC Leasing 104 props leading
- Gov view returned top 10 with Boyd Watterson Global 31 props leading
- Edge Function deployed to dia project (zqzrriwuavgrquhisnoa) at v16

### Lesson
When a dashboard metric reads like a data-quality alarm but the underlying matching can't possibly succeed (no source-of-truth table to match against, zero exact + zero fuzzy hits), the metric is the bug, not the data. Reframing the widget into an actionable BD list converts the same number from a complaint into a queue.

### Out of scope
- Auto-archive zero-prop stubs (6,303 gov + 2,580 dia) after a grace period.
- Two-way SF sync — "Create SF account" CTA from the modal.
- Gov-side \`salesforce_accounts\` table (mirror from SF).

### Files changed
- \`supabase/migrations/dialysis/20260518230000_dia_qa25_v_prospect_targets.sql\`
- \`supabase/migrations/government/20260518230000_gov_qa25_v_prospect_targets.sql\`
- \`supabase/functions/data-query/index.ts\` — both allowlists updated
- \`dialysis.js\` — widget reframe + \`_diaShowProspectTargets()\` modal handler
- \`gov.js\` — widget reframe + \`_govShowProspectTargets()\` modal handler
- \`AUDIT_PROGRESS.md\` — this closeout

`);
  const updated = original + block;
  const delta = updated.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-25 — Unprospected Owners widget ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await verifyMigration(report, 'dialysis',
    '20260518230000_dia_qa25_v_prospect_targets.sql',
    ['CREATE OR REPLACE VIEW public.v_prospect_targets',
     'salesforce_id IS NULL',
     'is_operator_not_owner',
     'QA-25 (2026-05-18']);
  await verifyMigration(report, 'government',
    '20260518230000_gov_qa25_v_prospect_targets.sql',
    ['CREATE OR REPLACE VIEW public.v_prospect_targets',
     'sf_account_id IS NULL',
     'QA-25 (2026-05-18']);
  await verifyFile(report,
    'supabase/functions/data-query/index.ts',
    ['QA-25 (2026-05-18): v_prospect_targets',
     '"v_prospect_targets"'],
    'data-query/index.ts (v_prospect_targets in allowlists)');
  await verifyFile(report,
    'dialysis.js',
    ['Unprospected Owners (QA-25 2026-05-18)',
     '_diaShowProspectTargets',
     'window._diaTopUnprospected'],
    'dialysis.js (widget reframe + modal handler)');
  await verifyFile(report,
    'gov.js',
    ['Unprospected Owners (QA-25 2026-05-18)',
     '_govShowProspectTargets',
     'window._govTopUnprospected',
     'Unprospected Owners'],
    'gov.js (widget reframe + modal handler)');
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
