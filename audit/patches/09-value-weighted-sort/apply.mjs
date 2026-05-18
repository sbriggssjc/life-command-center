#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #9 Phase A: Value-weighted sort on every list.
//
// Closes audit finding B-3 (HIGH): list views default to chronological /
// insertion-order sorts, burying the highest-value records under recent
// noise. Phase A fixes the highest-traffic CRE list defaults so brokers
// see the biggest deals + most valuable holdings first.
//
// Edits:
//   - gov.js — sales_transactions order
//       sale_date.desc → sold_price.desc.nullslast,sale_date.desc.nullslast
//
//   - gov.js — portfolioProperties (currently has NO explicit order,
//     defaults to insertion order). Add value-weighted cascade:
//       estimated_value.desc.nullslast,
//       gross_rent.desc.nullslast,
//       rba.desc.nullslast
//
//   - dialysis.js — sales_transactions order
//       sale_date.desc.nullslast →
//       sold_price.desc.nullslast,sale_date.desc.nullslast
//
//   - AUDIT_PROGRESS.md — closeout
//
// Lists deliberately NOT changed in Phase A (each kept for documented reasons):
//   - available_listings: 'fresh first' is explicit intent (comment in
//     gov.js explains the OM-staging UX). Keeps date primary.
//   - prospect_leads: already sorted by priority_score.desc — value-weighted.
//   - ownership_history: already sorted by estimated_value.desc.
//   - chronological tables (events, snapshots, ingestion_log, etc.):
//     date sort is correct by nature; not in scope for value re-weighting.
//
// Phase B follow-ups (deferred):
//   - "Sort by completeness" toggle on every list (paired with Item #6).
//   - Per-user sort preference persistence in localStorage.
//   - Value column visible + clickable to switch sort direction.
//   - v_sales_comps / lease comps lists get the same treatment.
//
// Branch: audit/09-value-weighted-sort
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
  if (occ === 0) throw new Error(label + ': anchor not found in ' + path);
  if (occ > 1)  throw new Error(label + ': anchor matched ' + occ + ' times in ' + path);
  if (oldN === newN) { report.push([label, 0, 'no changes']); return; }
  const updated = original.replace(oldN, () => newN);
  const delta = updated.length - original.length;
  report.push([label + ' (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

// ─── gov.js: sales_transactions + portfolioProperties ───
async function patchGovJs(report) {
  const path = resolve(REPO_ROOT, 'gov.js');
  if (!await fileExists(path)) throw new Error('gov.js not found.');

  // 1. sales_transactions sort — bump sold_price to primary, sale_date as
  //    tiebreaker. The biggest comps surface first regardless of date.
  await replaceUnique(path,
    `      _loadPaginatedQuery('sales_transactions',
        '*',
        { order: 'sale_date.desc' }
      )`,
    `      _loadPaginatedQuery('sales_transactions',
        '*',
        // Value-weighted sort (Item #9 Phase A, 2026-05-17): biggest comps
        // surface first. Tiebreaker on sale_date keeps recency where prices
        // are equal/null.
        { order: 'sold_price.desc.nullslast,sale_date.desc.nullslast' }
      )`,
    report, 'gov.js (sales_transactions sort)');

  // 2. portfolioProperties — currently has NO order clause. Add value-weighted
  //    cascade so the most-valuable government properties appear at the top.
  await replaceUnique(path,
    `      _loadPaginatedQuery('properties',
        // Identifier + research handles + financials + intel signals.
        // Intel card needs all of these; the auto-resolve sweep keys on
        // intel_status + the no-handle bucket. Round 76em.
        'property_id,lease_number,location_code,address,city,state,zip_code,' +
        'agency,agency_full_name,government_type,' +
        'rba,sf_leased,year_built,year_renovated,land_acres,' +
        'lease_commencement,lease_expiration,firm_term_remaining,term_remaining,firm_term_years,total_term_years,' +
        'gross_rent,gross_rent_psf,noi,noi_psf,estimated_value,' +
        'recorded_owner_id,true_owner_id,assessed_owner,latest_deed_grantee,latest_deed_date,latest_sale_price,' +
        'investment_score,deal_grade,agency_risk_level,location_tier,' +
        'intel_status,status,data_source'
      ),`,
    `      _loadPaginatedQuery('properties',
        // Identifier + research handles + financials + intel signals.
        // Intel card needs all of these; the auto-resolve sweep keys on
        // intel_status + the no-handle bucket. Round 76em.
        'property_id,lease_number,location_code,address,city,state,zip_code,' +
        'agency,agency_full_name,government_type,' +
        'rba,sf_leased,year_built,year_renovated,land_acres,' +
        'lease_commencement,lease_expiration,firm_term_remaining,term_remaining,firm_term_years,total_term_years,' +
        'gross_rent,gross_rent_psf,noi,noi_psf,estimated_value,' +
        'recorded_owner_id,true_owner_id,assessed_owner,latest_deed_grantee,latest_deed_date,latest_sale_price,' +
        'investment_score,deal_grade,agency_risk_level,location_tier,' +
        'intel_status,status,data_source',
        // Value-weighted sort (Item #9 Phase A, 2026-05-17): most valuable
        // gov holdings surface first. Falls back through gross_rent, then
        // RBA so properties missing a value still rank by rent/size.
        { order: 'estimated_value.desc.nullslast,gross_rent.desc.nullslast,rba.desc.nullslast' }
      ),`,
    report, 'gov.js (portfolioProperties value sort)');
}

// ─── dialysis.js: sales_transactions ───
async function patchDialysisJs(report) {
  const path = resolve(REPO_ROOT, 'dialysis.js');
  if (!await fileExists(path)) throw new Error('dialysis.js not found.');

  // sales_transactions sort — same treatment as gov.
  await replaceUnique(path,
    `    const batch = await diaQuery('sales_transactions', select, {
      order: 'sale_date.desc.nullslast',
      limit: 1000,
      offset: pg * 1000,
    });`,
    `    const batch = await diaQuery('sales_transactions', select, {
      // Value-weighted sort (Item #9 Phase A, 2026-05-17): biggest comps
      // surface first. Tiebreaker on sale_date keeps recency where prices
      // are equal/null.
      order: 'sold_price.desc.nullslast,sale_date.desc.nullslast',
      limit: 1000,
      offset: pg * 1000,
    });`,
    report, 'dialysis.js (sales_transactions sort)');
}

// ─── AUDIT_PROGRESS.md: append closeout entry ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 9 Phase A — Value-weighted sort on lists
- **Status:** ✅ DONE (Phase A) / ⏸️ DEFERRED (Phase B: sort UI + per-user persistence)
- **Branch:** \`audit/09-value-weighted-sort\`
- **Patch:** \`audit/patches/09-value-weighted-sort/apply.mjs\`
- **Closes:** B-3 (HIGH) — list defaults to chronological sort, burying valuable records.

### Default sort changes
| List | Before | After |
|---|---|---|
| gov sales_transactions | sale_date.desc | sold_price.desc.nullslast, sale_date.desc.nullslast |
| gov portfolioProperties | (no order, insertion order) | estimated_value.desc.nullslast, gross_rent.desc.nullslast, rba.desc.nullslast |
| dia sales_transactions | sale_date.desc.nullslast | sold_price.desc.nullslast, sale_date.desc.nullslast |

### Why these three
- The first list a broker scans on either domain is the comps tab. Sorting comps by transaction date buries the biggest sales under recent retail-level deals. Bumping sold_price to primary makes the highest-impact comps the first thing you see.
- gov portfolioProperties had no explicit order at all — properties came back in insertion order (effectively random for legacy data). The value cascade surfaces holdings with the largest estimated_value first, falling back through gross_rent, then RBA so partially-populated rows still rank meaningfully.

### Lists deliberately NOT changed in Phase A
| List | Reason |
|---|---|
| gov available_listings | "Fresh-first" sort is explicit per existing comment — freshly staged OMs (with NULL asking_price) should surface for review. Keeps listing_date primary. |
| prospect_leads | Already sorts by priority_score.desc — value-weighted by design. |
| ownership_history | Already sorts by estimated_value.desc. |
| gsa_lease_events / gsa_snapshots / research_queue_outcomes | Chronological by nature; date sort is correct. |

### Files changed
- \`gov.js\` — sales_transactions + portfolioProperties sort
- \`dialysis.js\` — sales_transactions sort
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. \`grep -c "sold_price.desc.nullslast" gov.js dialysis.js\` → 2 or more total
2. \`grep -c "estimated_value.desc.nullslast" gov.js\` → 1 or more
3. Smoke: open the Government → Sales tab. Top row is now the biggest sale in dollar terms (not the most recent). Same on Dialysis → Sales.
4. Smoke: open Government → portfolio (or wherever portfolioProperties surfaces). Top rows are now properties with the highest estimated_value (e.g., the largest government holdings, not whichever was inserted first).

### Deferred to Phase B
- Per-list sort UI ("Sort by: Value · Date · Completeness") — closes the second half of B-15 originally paired with Item #6.
- localStorage sort-preference persistence keyed by table.
- Value column visible + clickable to toggle sort direction.
- v_sales_comps / lease comps lists get the same treatment.

`);

  const preflightAnchor = N('\n# Sprint preflight — 2026-05-17\n');
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, () => appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }
  if (c === original) { report.push(['AUDIT_PROGRESS.md', 0, 'no changes']); return; }
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Audit Sprint — Item #9 Phase A (value-weighted sort) ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchGovJs(report);
  await patchDialysisJs(report);
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
