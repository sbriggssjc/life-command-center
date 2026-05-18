#!/usr/bin/env node
// ============================================================================
// LCC QA-01 — Allowlist missing-views fix (SHOWSTOPPER).
//
// Discovered during the in-browser QA pass (2026-05-18): every detail-panel
// feature shipped this sprint is SILENTLY BROKEN because the views
// referenced by the new code are not in api/_shared/allowlist.js's
// GOV_READ_TABLES / DIA_READ_TABLES sets. The proxy returns an empty
// {data:[], count:0} (NOT a 4xx) for unlisted views, so the frontend
// gates on `_udCache.completeness == null` and hides the rail without
// any visible error.
//
// Affected views per domain:
//
// GOV:
//   • v_property_completeness   (Item #6 completeness rail)
//   • v_next_best_action         (Item #8 next-action bar — detail panel)
//   • v_gap_agency_drift         (A-5 + B-2 dispatcher)
//   • v_property_value_signal    (referenced via FK by NBA views)
//   • v_gap_orphan_sale_owner    (NBA branch)
//   • llc_research_queue         (NBA branch)
//
// DIA:
//   • v_property_completeness   (Item #6 completeness rail)
//   • v_next_best_action         (Item #8 next-action bar — detail panel)
//   • v_property_value_signal    (NBA value signal)
//   • v_gap_lease_tenant_drift   (B-4 dispatcher)
//   • v_gap_chain_drift          (B-4 dispatcher)
//   • v_gap_orphan_sale_owner    (NBA branch)
//   • llc_research_queue         (NBA branch)
//
// The NBA Home rail works (it routes through /api/admin?_route=next-best-
// action which uses domainQuery server-side, bypassing the allowlist).
// Detail-panel features go through govQuery / diaQuery which hit the
// proxy, hence the silent breakage.
//
// Single file edited. After deploy: completeness rail, next-action bar,
// every per-action dispatcher branch, and the Agency Drift widget will
// actually work in the UI for the first time since they shipped.
//
// Branch: audit/qa-01-allowlist-missing-views
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

// ─── api/_shared/allowlist.js: add missing views to GOV + DIA reads ───
async function patchAllowlist(report) {
  const path = resolve(REPO_ROOT, 'api', '_shared', 'allowlist.js');
  if (!await fileExists(path)) throw new Error('allowlist.js not found.');

  // 1. Add gov reads. Anchor on the last existing entry block (Capital Markets).
  await replaceUnique(path,
    `  'cm_nm_broker_patterns',
  'cm_view_registry',
  'cm_period_anchor',
]);`,
    `  'cm_nm_broker_patterns',
  'cm_view_registry',
  'cm_period_anchor',
  // QA-01 (2026-05-18): SHOWSTOPPER fix. These views were created during
  // the audit sprint (Items #4, #6, #8, A-5) but never added to the
  // allowlist — every detail-panel feature was silently returning {data:[]}.
  'v_property_completeness',
  'v_next_best_action',
  'v_property_value_signal',
  'v_gap_agency_drift',
  'v_gap_orphan_sale_owner',
  'llc_research_queue',
]);`,
    report, 'allowlist.js (GOV_READ_TABLES: add sprint-era views)');

  // 2. Add dia reads. Anchor on the last existing entry block.
  await replaceUnique(path,
    `  // Data quality triage views (Phase 2.x)
  'v_data_quality_summary',
  'v_data_quality_issues',
  'v_property_merge_candidates',
]);`,
    `  // Data quality triage views (Phase 2.x)
  'v_data_quality_summary',
  'v_data_quality_issues',
  'v_property_merge_candidates',
  // QA-01 (2026-05-18): SHOWSTOPPER fix. These views were created during
  // the audit sprint (Items #4, #6, #8, A-1, B-3, B-4) but never added
  // to the allowlist — every detail-panel feature was silently returning
  // {data:[]} for dia properties.
  'v_property_completeness',
  'v_next_best_action',
  'v_property_value_signal',
  'v_gap_lease_tenant_drift',
  'v_gap_chain_drift',
  'v_gap_orphan_sale_owner',
  'llc_research_queue',
]);`,
    report, 'allowlist.js (DIA_READ_TABLES: add sprint-era views)');
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

## QA pass #1 — allowlist showstopper ✅
- **Status:** ✅ DONE.
- **Branch:** \`audit/qa-01-allowlist-missing-views\`
- **Patch:** \`audit/patches/qa-01-allowlist-missing-views/apply.mjs\`

### Discovery
Discovered during the in-browser QA pass (2026-05-18). After opening the deployed app and clicking into a property's NBA row, the completeness rail and next-action bar were both rendered as DOM elements but \`display: none\` because \`_udCache.completeness\` and \`_udCache.nextAction\` were both \`null\`.

Tracing back: the frontend's \`govQuery('v_property_completeness', ...)\` returned \`{data:[], count:0}\`. At the SQL level, the view returns 1 row for the same property (verified via MCP). At PostgREST level, the view permits \`anon\` + \`authenticated\` reads (verified via \`SET LOCAL ROLE\`).

Root cause: the proxy layer in \`api/_shared/allowlist.js\` enforces a hard allowlist of table/view names. Unlisted names get a silent empty response (NOT a 4xx, so \`lccReportError\` doesn't fire). Every view created during the sprint was missing from the allowlist.

### Affected views (both domains)
| View | Used by | Domain |
|---|---|---|
| v_property_completeness | Item #6 completeness rail | gov + dia |
| v_next_best_action | Item #8 next-action bar (detail panel) | gov + dia |
| v_property_value_signal | NBA value FK | gov + dia |
| v_gap_agency_drift | A-5 widget + #8 B-2 dispatcher | gov |
| v_gap_lease_tenant_drift | #8 B-4 dispatcher | dia |
| v_gap_chain_drift | #8 B-4 dispatcher | dia |
| v_gap_orphan_sale_owner | NBA orphan branch | gov + dia |
| llc_research_queue | NBA llc branch | dia |

### Why the NBA Home rail still worked
The Home rail uses \`/api/admin?_route=next-best-action\` which calls \`domainQuery\` server-side, **bypassing the allowlist**. That code path is the one with the working DB access. The detail-panel features and per-property lookups use \`govQuery\` / \`diaQuery\` browser-side → hit the proxy → hit the allowlist → silent empty.

### Fix
Single file edit: adds the 6–7 missing views to \`GOV_READ_TABLES\` + \`DIA_READ_TABLES\` in \`api/_shared/allowlist.js\`.

After Railway redeploys:
- The completeness rail will populate on every property detail panel.
- The next-action bar will populate on every property detail panel.
- Per-action workflows (B / B-2 / B-3 / B-4) will be able to look up source values before PATCHing.
- The Agency Drift widget on the Research page will populate.

### Files changed
- \`api/_shared/allowlist.js\` — 2 additions (gov + dia READ allowlists)
- \`AUDIT_PROGRESS.md\` — this closeout

### Other QA findings (queued, not in this patch)
- **NBA dia query times out** (Postgres 57014 statement_timeout). Home rail's \`/api/admin\` cross-domain fan-out shows \`"by_domain":{"dialysis":{"ok":false,"status":500,"error":"canceling statement due to statement timeout"}}\`. The user sees only gov rows + a "⚠ partial" indicator. The v_next_best_action view on dia needs query-plan tuning (likely the LEFT JOIN to v_property_value_signal × 5,000+ rows + the agency-drift-style window functions). Tracked separately.
- **"Open Activities = 0" vs "View all 7396 items"** — Home page stat-card vs My Work list count disagree. One of them is wrong.
- **LLC research queue contains public REITs** (Brandywine Realty Trust appears as #9 + #10 on the NBA rail). SoS portal lookups will return nothing for these. Need either (a) a REIT/public-company filter, or (b) the "Open SoS" button knowing to redirect to SEC EDGAR for known public entities.
- **Same entity duplicated in queue** ("Brandywine Realty Trust" #9 vs "Brandywine Realty Trust JV MSD Partners" #10) — needs LLC-name dedupe.
- **Agency: "Dod"** mixed-case (should be DOD / DoD).
- **Detail panel header wraps awkwardly** ("General / Services / Administration / – Arlington, VA" on 4 lines).
- **Inbox cards** (Home + Inbox page) have only "Open in Outlook ↗" — no inline "Mark processed" / "Promote to property" actions. Forces a tab-switch per email.

`);
  c = c + appendBlock;
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC QA-01 — allowlist missing-views fix (SHOWSTOPPER) ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchAllowlist(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(75) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
