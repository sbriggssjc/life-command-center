#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #6 Phase B-3 + Item #9 Phase B: list-sort UI +
// completeness chips.
//
// Combined patch because the two items overlap: #9B wanted "Sort by: Value /
// Date / Completeness" toggles on lists, and #6B-3 wanted band chips visible
// in list rows. Same surface area. Ship the building blocks once.
//
// What this delivers:
//
//   1. Generic helpers in app.js (ready for adoption on every list view):
//        • lccCompletenessChip(score, band)  → HTML for a band chip
//        • lccGetListSort(table, defaultKey) → reads localStorage
//        • lccSetListSort(table, key, onChange?) → writes + fires callback
//        • lccSortListByKey(rows, key, specs) → in-memory sort by key
//        • lccRenderSortToggle(table, defaultKey, keys, onChange) → toggle HTML
//
//   2. CSS for the band chip (4 colors) and the sort toggle.
//
//   3. Safe demonstration: the NBA Home rail now renders the completeness
//      chip per row (it already had completeness_band in the payload from
//      Phase B-2). Zero new fetches; zero risk to other surfaces.
//
//   4. Documentation: AUDIT_PROGRESS.md captures the 6-step migration
//      pattern for adopting these helpers on any list tab (gov.js /
//      dialysis.js). Phase C completes the rollout to each tab.
//
// Closes (visibly): the UI half of #9 Phase B + #6 Phase B-3 building
// blocks. Per-tab adoption deferred to Phase C as an explicit punch list.
//
// Branch: audit/06B3-09B-list-sort-ui-completeness-chips
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

// ─── styles.css: add .lcc-cmp-chip + .lcc-sort-toggle ───
async function patchStylesCss(report) {
  const path = resolve(REPO_ROOT, 'styles.css');
  if (!await fileExists(path)) throw new Error('styles.css not found.');

  // Anchor right after the completeness rail block.
  const ANCHOR = `@media (max-width: 720px) {
  .completeness-rail { padding: 6px 10px; gap: 6px; }
  .cr-chip { font-size: 10px; padding: 3px 7px; }
}`;
  const CSS = `

/* Item #6 Phase B-3 / Item #9 Phase B (2026-05-17): list sort + chip helpers */

/* Completeness band chip — usable anywhere a list row needs to surface a
   property's completeness band at a glance. */
.lcc-cmp-chip { display: inline-block; font-size: 9px; font-weight: 800; letter-spacing: 0.4px; padding: 2px 6px; border-radius: 999px; border: 1px solid transparent; text-transform: uppercase; vertical-align: middle; line-height: 1; }
.lcc-cmp-chip-excellent { background: color-mix(in srgb, var(--green, #22c55e) 18%, transparent); color: var(--green, #22c55e); border-color: color-mix(in srgb, var(--green, #22c55e) 45%, transparent); }
.lcc-cmp-chip-good      { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.lcc-cmp-chip-fair      { background: color-mix(in srgb, var(--yellow, #eab308) 18%, transparent); color: var(--yellow, #eab308); border-color: color-mix(in srgb, var(--yellow, #eab308) 45%, transparent); }
.lcc-cmp-chip-poor      { background: color-mix(in srgb, var(--red, #ef4444) 14%, transparent); color: var(--red, #ef4444); border-color: color-mix(in srgb, var(--red, #ef4444) 35%, transparent); }
.lcc-cmp-chip-unknown   { background: var(--s2); color: var(--text3); border-color: var(--border); }
.lcc-cmp-chip[title]    { cursor: help; }

/* Sort toggle — usable in any list tab header. Pairs with lccRenderSortToggle()
   helper in app.js. */
.lcc-sort-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text2); }
.lcc-sort-toggle-label { font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text3); }
.lcc-sort-toggle-group { display: inline-flex; background: var(--s2); border: 1px solid var(--border); border-radius: 8px; padding: 2px; gap: 2px; }
.lcc-sort-toggle-btn { font-size: 11px; padding: 3px 9px; border: 0; background: transparent; color: var(--text2); border-radius: 6px; cursor: pointer; font-weight: 600; }
.lcc-sort-toggle-btn.active { background: var(--accent2); color: #fff; }
.lcc-sort-toggle-btn:hover:not(.active) { background: var(--s1); color: var(--text1); }`;
  const REPLACE = ANCHOR + CSS;
  await replaceUnique(path, ANCHOR, REPLACE, report, 'styles.css (sort toggle + completeness chip)');
}

// ─── app.js: helpers + NBA rail integration ───
async function patchAppJs(report) {
  const path = resolve(REPO_ROOT, 'app.js');
  if (!await fileExists(path)) throw new Error('app.js not found.');

  // 1. Add the generic helpers right after the lccReportError block (which
  //    ends with window.lccErrorBuffer).
  await replaceUnique(path,
    `window.lccFlushErrors = _lccFlushClientErrors;
window.lccErrorBuffer = () => _lccErrBuffer.slice();`,
    `window.lccFlushErrors = _lccFlushClientErrors;
window.lccErrorBuffer = () => _lccErrBuffer.slice();

// ============================================================================
// LIST SORT + COMPLETENESS CHIPS — Item #6 Phase B-3 + Item #9 Phase B
// (2026-05-17)
//
// Generic helpers for any list tab to adopt. See AUDIT_PROGRESS.md item-6-B-3
// closeout for the per-tab migration pattern.
// ============================================================================

/** Render a colored band chip for a completeness score/band. Pure HTML. */
function lccCompletenessChip(scoreOrBand, maybeBand) {
  // Tolerate both shapes:  (score, band)  or  ({score, band})  or  (band)
  let score = null, band = null;
  if (typeof scoreOrBand === 'object' && scoreOrBand !== null) {
    score = scoreOrBand.score != null ? scoreOrBand.score : scoreOrBand.completeness_score;
    band  = scoreOrBand.band  != null ? scoreOrBand.band  : scoreOrBand.completeness_band;
  } else if (typeof scoreOrBand === 'string' && !maybeBand) {
    band = scoreOrBand;
  } else {
    score = scoreOrBand;
    band  = maybeBand;
  }
  const b = String(band || 'unknown').toLowerCase();
  const cls = ['excellent', 'good', 'fair', 'poor'].includes(b) ? b : 'unknown';
  const text = b === 'unknown' ? '—' : b.toUpperCase();
  const tip = score != null
    ? 'Completeness ' + score + '/100 · ' + b
    : 'Completeness: ' + b;
  return '<span class="lcc-cmp-chip lcc-cmp-chip-' + cls + '" title="' + esc(tip) + '">' + esc(text) + '</span>';
}
window.lccCompletenessChip = lccCompletenessChip;

/** Read the user's sort preference for a given table (defaults to defaultKey). */
function lccGetListSort(table, defaultKey) {
  try {
    const stored = localStorage.getItem('lcc.sort.' + table);
    if (stored) return stored;
  } catch (_) {}
  return defaultKey || 'value';
}
window.lccGetListSort = lccGetListSort;

/** Persist a sort preference + fire a callback (typically a re-render). */
function lccSetListSort(table, key, onChange) {
  try { localStorage.setItem('lcc.sort.' + table, key); } catch (_) {}
  if (typeof onChange === 'function') {
    try { onChange(key); } catch (e) { console.warn('[lccSetListSort] onChange threw:', e); }
  }
}
window.lccSetListSort = lccSetListSort;

/**
 * In-memory sort. \`specs\` is { key: { field, dir, nulls } | (a,b) => number }.
 * Pass a function for custom compare; otherwise field+dir+nulls drives a
 * stable sort. Returns a new array (does not mutate input).
 *
 * Example specs:
 *   {
 *     value:       { field: 'sold_price', dir: 'desc', nulls: 'last' },
 *     date:        { field: 'sale_date',  dir: 'desc', nulls: 'last' },
 *     completeness:{ field: 'completeness_score', dir: 'desc', nulls: 'last' }
 *   }
 */
function lccSortListByKey(rows, key, specs) {
  if (!Array.isArray(rows) || !specs || !specs[key]) return rows ? rows.slice() : [];
  const spec = specs[key];
  if (typeof spec === 'function') return rows.slice().sort(spec);
  const field = spec.field;
  const dir   = (spec.dir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const nulls = (spec.nulls || 'last').toLowerCase(); // 'last' | 'first'
  return rows.slice().sort((a, b) => {
    const av = a == null ? null : a[field];
    const bv = b == null ? null : b[field];
    const an = av == null || av === '' || (typeof av === 'number' && isNaN(av));
    const bn = bv == null || bv === '' || (typeof bv === 'number' && isNaN(bv));
    if (an && bn) return 0;
    if (an) return nulls === 'first' ? -1 : 1;
    if (bn) return nulls === 'first' ?  1 : -1;
    // Numeric vs string comparisons handled naturally by JS:
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });
}
window.lccSortListByKey = lccSortListByKey;

/**
 * Render the sort-toggle DOM. \`keys\` is an array of \`{ key, label }\` pairs.
 * \`onChangeFnName\` is the global function name to call when the user picks
 * a different sort (must be on window). Returns HTML — caller injects into
 * their tab header.
 *
 * Example:
 *   lccRenderSortToggle('gov_sales_comps', 'value',
 *     [{key:'value',label:'Value'},{key:'date',label:'Date'},{key:'completeness',label:'Completeness'}],
 *     'onGovSalesSortChange');
 */
function lccRenderSortToggle(table, defaultKey, keys, onChangeFnName) {
  const active = lccGetListSort(table, defaultKey);
  const parts = [];
  parts.push('<div class="lcc-sort-toggle" data-lcc-sort-table="' + esc(table) + '">');
  parts.push(  '<span class="lcc-sort-toggle-label">Sort</span>');
  parts.push(  '<div class="lcc-sort-toggle-group">');
  for (const k of (keys || [])) {
    const isActive = k.key === active ? ' active' : '';
    const fn = String(onChangeFnName || '').replace(/[^A-Za-z0-9_$]/g, '');
    const click = fn
      ? ' onclick="lccSetListSort(&quot;' + esc(table) + '&quot;, &quot;' + esc(k.key) + '&quot;, window.' + fn + ')"'
      : ' onclick="lccSetListSort(&quot;' + esc(table) + '&quot;, &quot;' + esc(k.key) + '&quot;)"';
    parts.push(  '<button type="button" class="lcc-sort-toggle-btn' + isActive + '" data-lcc-sort-key="' + esc(k.key) + '"' + click + '>' + esc(k.label || k.key) + '</button>');
  }
  parts.push(  '</div>');
  parts.push('</div>');
  return parts.join('');
}
window.lccRenderSortToggle = lccRenderSortToggle;`,
    report, 'app.js (sort + chip helpers)');

  // 2. Surface the completeness chip in the NBA Home rail. The view already
  //    returns row.completeness_band (Phase B-2). Add the chip to the
  //    tag-stack column so it appears alongside the severity + domain tags.
  await replaceUnique(path,
    `    parts.push('<div class="nba-row nba-sev-' + esc(sev) + '"' + clickAttr + '>');
    parts.push(  '<div class="nba-rank">#' + (row.rank || (idx + 1)) + '</div>');
    parts.push(  '<div class="nba-tag-stack">');
    parts.push(    '<span class="nba-sev-chip nba-sev-' + esc(sev) + '-chip">' + esc(sev.toUpperCase()) + '</span>');
    parts.push(    '<span class="nba-domain-tag ' + dom.cls + '">' + dom.code + '</span>');
    parts.push(  '</div>');`,
    `    parts.push('<div class="nba-row nba-sev-' + esc(sev) + '"' + clickAttr + '>');
    parts.push(  '<div class="nba-rank">#' + (row.rank || (idx + 1)) + '</div>');
    parts.push(  '<div class="nba-tag-stack">');
    parts.push(    '<span class="nba-sev-chip nba-sev-' + esc(sev) + '-chip">' + esc(sev.toUpperCase()) + '</span>');
    parts.push(    '<span class="nba-domain-tag ' + dom.cls + '">' + dom.code + '</span>');
    // Item #6 Phase B-3 (2026-05-17): completeness band chip — surfaces which
    // properties are near-finished underwritings so Scott can prioritize
    // those gap closures visually (already weighted in the rank via B-2).
    if (row.completeness_band || row.completeness_score != null) {
      parts.push(  lccCompletenessChip(row.completeness_score, row.completeness_band));
    }
    parts.push(  '</div>');`,
    report, 'app.js (NBA rail: completeness chip integration)');
}

// ─── AUDIT_PROGRESS.md: closeout + migration pattern ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 6 Phase B-3 + item 9 Phase B — list sort UI + completeness chip helpers
- **Status:** ✅ DONE (building blocks). Per-tab adoption tracked as Phase C with a clear punch list below.
- **Branch:** \`audit/06B3-09B-list-sort-ui-completeness-chips\`
- **Patch:** \`audit/patches/06B3-09B-list-sort-ui-completeness-chips/apply.mjs\`
- **Closes:** the building-block half of #6 Phase B-3 + #9 Phase B. The two items overlap (a sort toggle whose options include completeness, a chip showing the band), so they ship as one patch.

### What this delivers

**1. Generic helpers in \`app.js\`** (ready for adoption on every list view):
- \`lccCompletenessChip(score, band)\` — returns colored chip HTML (excellent/good/fair/poor/unknown).
- \`lccGetListSort(table, defaultKey)\` — reads localStorage \`lcc.sort.<table>\`.
- \`lccSetListSort(table, key, onChange?)\` — persists + fires re-render callback.
- \`lccSortListByKey(rows, key, specs)\` — in-memory stable sort. Specs declarative \`{ field, dir, nulls }\` or a custom compare fn.
- \`lccRenderSortToggle(table, defaultKey, keys, onChangeFnName)\` — toggle DOM.

**2. CSS** for the chip (4 band colors + unknown) and the sort toggle (button group with active state).

**3. Safe demonstration** — the NBA Home rail now renders the completeness chip per row. The view already returns \`completeness_band\` + \`completeness_score\` (Phase B-2 exposure), so zero new fetches. Excellent-band properties get a green chip, fair-band yellow, poor-band red, etc.

### Per-tab migration pattern (Phase C punch list)

Each list tab adopts in 6 steps:

\`\`\`js
// 1. After lazy-load, store the raw array on a domain-scoped state object
//    (e.g. govData.salesTransactions). Already in place for most tabs.

// 2. Define a sort-specs map for this table. Keys are user-facing sort
//    options; values describe how to sort.
const SALES_SORT_SPECS = {
  value:        { field: 'sold_price',          dir: 'desc', nulls: 'last' },
  date:         { field: 'sale_date',           dir: 'desc', nulls: 'last' },
  completeness: { field: 'completeness_score',  dir: 'desc', nulls: 'last' },
};

// 3. Before rendering the table, sort by the active key.
const sortKey = lccGetListSort('gov_sales_transactions', 'value');
const rowsSorted = lccSortListByKey(govData.salesTransactions, sortKey, SALES_SORT_SPECS);

// 4. Inject the toggle into the tab header. Provide the re-render callback
//    name as a string (it must be on window).
const toggleHtml = lccRenderSortToggle(
  'gov_sales_transactions', 'value',
  [{key:'value',label:'Value'},{key:'date',label:'Date'},{key:'completeness',label:'Completeness'}],
  'renderGovSales'  // existing render fn — needs to read the new sort key
);

// 5. Render the completeness chip in the row HTML where appropriate.
//    Most tables: a small column at the right of the address/title.
'<td>' + lccCompletenessChip(row.completeness_score, row.completeness_band) + '</td>'

// 6. Ensure the underlying SELECT includes completeness_score + completeness_band
//    (they're cheap — indexed since B-1).
\`\`\`

**Punch list (per-tab adoption, Phase C):**
| Tab | DB | Default sort | Status |
|---|---|---|---|
| Sales transactions | both | value | 📋 pending |
| Available listings | both | date  | 📋 pending |
| Portfolio properties | gov | value | 📋 pending |
| Prospect leads | gov | priority_score | 📋 pending |
| Operations / CMS table | dia | value | 📋 pending |
| Loans | both | value | 📋 pending |

### Files changed
- \`app.js\` — 5 helpers (~140 lines) + NBA rail integration (4 lines)
- \`styles.css\` — \`.lcc-cmp-chip\` (5 variants) + \`.lcc-sort-toggle\` (group + buttons)
- \`AUDIT_PROGRESS.md\` — this closeout + migration pattern

### Verification
1. \`grep -c "lccCompletenessChip" app.js\` → 3 or more (definition + window export + NBA call site)
2. \`grep -c "lccRenderSortToggle" app.js\` → 2 or more (definition + window export)
3. \`grep -c ".lcc-cmp-chip" styles.css\` → 6 or more (base + 4 band variants + unknown)
4. Hard-reload the app → land on Home → NBA rail shows a band chip next to each domain tag. Top excellent-band rows show green chips; fair-band yellow; poor-band red.
5. From devtools: \`lccCompletenessChip(87, 'good')\` returns an HTML string with the right classes.

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
  console.log('\n=== LCC Audit Sprint — Item #6 Phase B-3 + Item #9 Phase B ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchStylesCss(report);
  await patchAppJs(report);
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
