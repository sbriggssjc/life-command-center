#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #8 Phase A: Sticky next-action bar on detail.js.
//
// Companion to the completeness rail (Item #6 Phase A).
//   • Completeness rail (top of panel)  → what is MISSING for this property
//   • Next-action bar  (bottom of panel) → what to DO FIRST right now
//
// Powered by v_next_best_action (already live on dia + gov). For the current
// property, fetch the single top-ranked gap, render it as a sticky bar
// pinned to the bottom of the detail panel. Click anywhere on the bar →
// jump to the tab where that action lives.
//
// Closes audit findings B-9 (no surfaced next action on a record) and
// B-10 (no value-weighted action prompt per record).
//
// Edits:
//   - index.html        sticky next-action bar mount inside detail-panel
//   - styles.css        .next-action-bar + .nab-* styles
//   - detail.js         fetch into parallel Promise.all (idx 7), attach to
//                        _udCache, renderer + click handler, close-detail hook
//   - AUDIT_PROGRESS.md closeout
//
// Branch: audit/08-detail-next-action-bar
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
  // Function callback so JS does NOT expand $-substitution patterns.
  const updated = original.replace(oldN, () => newN);
  const delta = updated.length - original.length;
  report.push([label + ' (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

// ─── index.html: insert next-action bar mount inside detail-panel ───
async function patchIndexHtml(report) {
  const path = resolve(REPO_ROOT, 'index.html');
  if (!await fileExists(path)) throw new Error('index.html not found.');

  const ANCHOR = `  <div class="detail-body" id="detailBody"></div>
</div>`;
  const REPLACE = `  <div class="detail-body" id="detailBody"></div>
  <div class="next-action-bar" id="detailNextActionBar" style="display:none"></div>
</div>`;

  await replaceUnique(path, ANCHOR, REPLACE, report, 'index.html (next-action bar mount)');
}

// ─── styles.css: insert next-action bar styles ───
async function patchStylesCss(report) {
  const path = resolve(REPO_ROOT, 'styles.css');
  if (!await fileExists(path)) throw new Error('styles.css not found.');

  // Anchor immediately after the completeness rail block landed by Item #6.
  const ANCHOR = `@media (max-width: 720px) {
  .completeness-rail { padding: 6px 10px; gap: 6px; }
  .cr-chip { font-size: 10px; padding: 3px 7px; }
}`;
  const NAB_CSS = `

/* Next-action bar — detail panel (Item #8 Phase A, 2026-05-17) */
.next-action-bar { position: sticky; bottom: 0; z-index: 3; background: var(--s1); border-top: 1px solid var(--border); padding: 10px 14px; padding-bottom: calc(10px + var(--safe-bottom, 0px)); display: flex; align-items: center; gap: 10px; cursor: pointer; transition: background 0.15s; }
.next-action-bar:hover { background: color-mix(in srgb, var(--accent2) 6%, var(--s1)); }
.next-action-bar.nab-sev-critical { border-top-color: var(--red, #ef4444); border-top-width: 2px; }
.next-action-bar.nab-sev-high     { border-top-color: var(--orange, #f59e0b); border-top-width: 2px; }
.next-action-bar.nab-sev-medium   { border-top-color: var(--yellow, #eab308); border-top-width: 2px; }
.next-action-bar.nab-sev-low      { border-top-color: var(--text3); }
.nab-label { font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text3); padding-right: 4px; border-right: 1px solid var(--border); margin-right: 4px; }
.nab-sev-chip { font-size: 9px; font-weight: 800; letter-spacing: 0.4px; text-align: center; padding: 2px 5px; border-radius: 4px; border: 1px solid transparent; flex-shrink: 0; }
.nab-sev-critical-chip { background: color-mix(in srgb, var(--red, #ef4444) 18%, transparent); color: var(--red, #ef4444); border-color: color-mix(in srgb, var(--red, #ef4444) 45%, transparent); }
.nab-sev-high-chip     { background: color-mix(in srgb, var(--orange, #f59e0b) 18%, transparent); color: var(--orange, #f59e0b); border-color: color-mix(in srgb, var(--orange, #f59e0b) 45%, transparent); }
.nab-sev-medium-chip   { background: color-mix(in srgb, var(--yellow, #eab308) 18%, transparent); color: var(--yellow, #eab308); border-color: color-mix(in srgb, var(--yellow, #eab308) 45%, transparent); }
.nab-sev-low-chip      { background: var(--s2); color: var(--text2); border-color: var(--border); }
.nab-body { flex: 1; min-width: 0; }
.nab-action-text { font-size: 13px; font-weight: 600; color: var(--text1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nab-meta { font-size: 11px; color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.nab-cta { font-size: 12px; font-weight: 700; color: var(--accent); padding: 4px 10px; border: 1px solid var(--accent); border-radius: 6px; background: transparent; flex-shrink: 0; }
.next-action-bar:hover .nab-cta { background: var(--accent); color: #fff; }
.nab-empty .nab-action-text { color: var(--text2); font-style: italic; }
@media (max-width: 720px) {
  .next-action-bar { padding: 8px 10px; gap: 6px; }
  .nab-action-text { font-size: 12px; }
  .nab-cta { font-size: 11px; padding: 3px 8px; }
}`;
  const REPLACE = ANCHOR + NAB_CSS;
  await replaceUnique(path, ANCHOR, REPLACE, report, 'styles.css (.next-action-bar block)');
}

// ─── detail.js: fetch + renderer + click + cache hooks ───
async function patchDetailJs(report) {
  const path = resolve(REPO_ROOT, 'detail.js');
  if (!await fileExists(path)) throw new Error('detail.js not found.');

  // 1. Add v_next_best_action fetch as Promise.all index 7. Anchor on the
  // completeness fetch block ending.
  await replaceUnique(path,
    `    // Completeness — pulls v_property_completeness for the rail at the top
    // of the detail panel (Item #6 Phase A, 2026-05-17). Best-effort: never
    // blocks the detail render if the view fetch fails.
    if (propFilter) {
      promises.push(qFn('v_property_completeness', '*', { filter: propFilter, limit: 1 }));
    } else {
      promises.push(Promise.resolve([]));
    }

    const settled = await Promise.allSettled(promises);`,
    `    // Completeness — pulls v_property_completeness for the rail at the top
    // of the detail panel (Item #6 Phase A, 2026-05-17). Best-effort: never
    // blocks the detail render if the view fetch fails.
    if (propFilter) {
      promises.push(qFn('v_property_completeness', '*', { filter: propFilter, limit: 1 }));
    } else {
      promises.push(Promise.resolve([]));
    }

    // Next-action — pulls top-ranked gap from v_next_best_action for the
    // sticky action bar at the bottom of the panel (Item #8 Phase A,
    // 2026-05-17). Best-effort: never blocks the detail render.
    if (propFilter) {
      promises.push(qFn('v_next_best_action', '*', {
        filter: propFilter,
        order: 'gap_value.desc.nullslast',
        limit: 1,
      }));
    } else {
      promises.push(Promise.resolve([]));
    }

    const settled = await Promise.allSettled(promises);`,
    report, 'detail.js (Promise.all next-action fetch)');

  // 2. Extract the new row at idx 7. Anchor on the completenessRow extraction.
  await replaceUnique(path,
    `    // Index 6 is the completeness view (Item #6 Phase A). May be empty if
    // the view fetch failed or this is a fallback-only render.
    const completenessRow = safeExtract(6)[0] || null;`,
    `    // Index 6 is the completeness view (Item #6 Phase A). May be empty if
    // the view fetch failed or this is a fallback-only render.
    const completenessRow = safeExtract(6)[0] || null;
    // Index 7 is the top next-action row (Item #8 Phase A). May be empty
    // if the property has no open gaps or the view fetch failed.
    const nextActionRow = safeExtract(7)[0] || null;`,
    report, 'detail.js (next-action extraction)');

  // 3. Attach next-action to _udCache + call renderer alongside the
  // completeness-rail render call.
  await replaceUnique(path,
    `    _setUdCache({ db, ids, property: mergedProperty, leases, ownership, chain, rankings, fallback, entityMeta, completeness: completenessRow, _fallbackOnly: allEmpty });
    // Render the data completeness rail at the top of the detail panel.
    // Best-effort: never throws upward (Item #6 Phase A, 2026-05-17).
    try { _udRenderCompletenessRail(); } catch (e) { console.warn('completeness rail render failed', e); }`,
    `    _setUdCache({ db, ids, property: mergedProperty, leases, ownership, chain, rankings, fallback, entityMeta, completeness: completenessRow, nextAction: nextActionRow, _fallbackOnly: allEmpty });
    // Render the data completeness rail at the top of the detail panel.
    // Best-effort: never throws upward (Item #6 Phase A, 2026-05-17).
    try { _udRenderCompletenessRail(); } catch (e) { console.warn('completeness rail render failed', e); }
    // Render the next-action bar at the bottom of the detail panel.
    // Best-effort: never throws upward (Item #8 Phase A, 2026-05-17).
    try { _udRenderNextActionBar(); } catch (e) { console.warn('next-action bar render failed', e); }`,
    report, 'detail.js (_setUdCache nextAction + render call)');

  // 4. Append the renderer + click handler + close-detail hook. Anchor on the
  // completeness rail block that ends with the close-detail wiring IIFE.
  await replaceUnique(path,
    `// Hide the rail when the panel closes so the next open starts clean.
(function _udWireCompletenessRailClose() {
  if (window._udCompletenessRailWired) return;
  window._udCompletenessRailWired = true;
  const origClose = window.closeDetail;
  if (typeof origClose === 'function') {
    window.closeDetail = function () {
      const rail = document.getElementById('detailCompletenessRail');
      if (rail) { rail.style.display = 'none'; rail.innerHTML = ''; }
      return origClose.apply(this, arguments);
    };
  }
})();`,
    `// Hide the rail when the panel closes so the next open starts clean.
(function _udWireCompletenessRailClose() {
  if (window._udCompletenessRailWired) return;
  window._udCompletenessRailWired = true;
  const origClose = window.closeDetail;
  if (typeof origClose === 'function') {
    window.closeDetail = function () {
      const rail = document.getElementById('detailCompletenessRail');
      if (rail) { rail.style.display = 'none'; rail.innerHTML = ''; }
      const nab = document.getElementById('detailNextActionBar');
      if (nab) { nab.style.display = 'none'; nab.innerHTML = ''; }
      return origClose.apply(this, arguments);
    };
  }
})();

// ============================================================================
// Sticky next-action bar — Item #8 Phase A (2026-05-17)
// Reads _udCache.nextAction (single row from v_next_best_action ordered by
// gap_value DESC). Click anywhere on the bar -> switches to the tab where
// the action lives. Companion to the completeness rail.
// ============================================================================

// Map a gap_type to the detail panel tab where the action is best executed.
function _udNextActionTabForGap(gapType) {
  const t = String(gapType || '');
  if (t === 'missing_recorded_owner') return 'Ownership & CRM';
  if (t === 'llc_research_pending')   return 'Ownership & CRM';
  if (t === 'lease_tenant_drift')     return 'Rent Roll';
  if (t === 'orphan_sale_owner')      return 'Deal History';
  if (t === 'stale_active_listing')   return 'Overview';
  if (t.startsWith('cms_chain_drift:')) return 'Operations';
  return 'Overview';
}

function _udFormatNabValue(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '';
  const sign = '$';
  if (v >= 1e9) return sign + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return sign + (v / 1e6).toFixed(v >= 10e6 ? 0 : 1) + 'M';
  if (v >= 1e3) return sign + Math.round(v / 1e3) + 'K';
  return sign + Math.round(v);
}

function _udRenderNextActionBar() {
  const bar = document.getElementById('detailNextActionBar');
  if (!bar) return;
  const next = _udCache && _udCache.nextAction;
  if (!next || !next.gap_type) {
    // No open gap for this property — hide the bar (the completeness rail
    // up top already handles the "fully populated" state).
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  const sev = String(next.gap_severity || 'low').toLowerCase();
  const action = String(next.suggested_action || '').trim()
    || String(next.gap_label || '').trim()
    || 'Open next action';
  const valStr = _udFormatNabValue(next.gap_value);
  const tab = _udNextActionTabForGap(next.gap_type);
  const meta = [];
  if (valStr) meta.push(valStr + ' value');
  meta.push('opens ' + tab);
  const metaText = meta.join(' · ');

  const parts = [];
  parts.push('<span class="nab-label">Next action</span>');
  parts.push('<span class="nab-sev-chip nab-sev-' + esc(sev) + '-chip">' + esc(sev.toUpperCase()) + '</span>');
  parts.push('<div class="nab-body">');
  parts.push(  '<div class="nab-action-text" title="' + esc(action) + '">' + esc(action) + '</div>');
  parts.push(  '<div class="nab-meta">' + esc(metaText) + '</div>');
  parts.push('</div>');
  parts.push('<button type="button" class="nab-cta" onclick="event.stopPropagation();_udNextActionClick(&quot;' + esc(next.gap_type) + '&quot;)">Take action →</button>');

  bar.className = 'next-action-bar nab-sev-' + esc(sev);
  bar.onclick = function () { _udNextActionClick(next.gap_type); };
  bar.innerHTML = parts.join('');
  bar.style.display = '';
}
window._udRenderNextActionBar = _udRenderNextActionBar;

function _udNextActionClick(gapType) {
  const tab = _udNextActionTabForGap(gapType);
  if (typeof switchUnifiedTab === 'function' && tab) {
    switchUnifiedTab(tab);
  }
  // Telemetry hook reserved — not wired in Phase A.
  console.debug('[NextAction] click', gapType, '-> tab', tab);
}
window._udNextActionClick = _udNextActionClick;`,
    report, 'detail.js (next-action renderer + handler)');
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

## Closeout — item 8 Phase A — Sticky next-action bar on detail.js
- **Status:** ✅ DONE
- **Branch:** \`audit/08-detail-next-action-bar\`
- **Patch:** \`audit/patches/08-detail-next-action-bar/apply.mjs\`
- **Closes:** B-9 (no surfaced next action on a record) + B-10 (no value-weighted action prompt per record).

### What this adds
- Sticky horizontal bar pinned to the bottom of every property detail panel.
- Shows the property's single top-ranked open gap from \`v_next_best_action\`:
  severity chip, suggested action text, value estimate, and the tab where the
  action lives.
- Click anywhere on the bar (or the "Take action →" button) → switches to the
  relevant tab so Scott can act inline.
- Auto-hides when the property has no open gap (the completeness rail at the
  top handles the "fully populated" state).
- Border-top color stripe matches severity (CRIT red / HIGH orange / MED
  yellow / LOW grey).

### Companion to Item #6
- **Completeness rail** (top of panel) — what's *missing* for this property.
- **Next-action bar** (bottom of panel) — what to *do first* right now.
- Together they sandwich the property data and give a constant action prompt.

### Gap type → tab mapping
\`\`\`
missing_recorded_owner   → Ownership & CRM
llc_research_pending     → Ownership & CRM
lease_tenant_drift       → Rent Roll
orphan_sale_owner        → Deal History
stale_active_listing     → Overview
cms_chain_drift:*        → Operations
\`\`\`

### Files changed
- \`index.html\` — bar mount inside \`#detailPanel\`
- \`styles.css\` — \`.next-action-bar\` + \`.nab-*\` (sticky bottom + severity colors)
- \`detail.js\` — fetch \`v_next_best_action\` (idx 7 in parallel Promise.all),
  attach to \`_udCache\`, renderer + click handler, close-detail hook
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. \`grep -c "v_next_best_action" detail.js\` → 1 or more
2. \`grep -c "_udRenderNextActionBar" detail.js\` → 3 or more (definition + window export + call site)
3. \`grep -c "next-action-bar" index.html\` → 1
4. \`grep -c ".nab-cta" styles.css\` → 1 or more
5. Smoke: open a property with a missing recorded owner. Sticky bar appears
   at the bottom of the panel with the "Research recorded owner for ..."
   text and a "Take action →" button. Click → Ownership & CRM tab activates.

### Deferred to follow-ups
- Per-action inline workflows (e.g., open SoS lookup directly from the bar
  for \`missing_recorded_owner\` rather than just routing to the tab).
- Render multi-step action sequences for properties with several queued gaps.
- "Mark complete" affordance on the bar that records the action in
  \`activity_events\` and re-fetches the next-action.

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
  console.log('\n=== LCC Audit Sprint — Item #8 Phase A (next-action bar) ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchIndexHtml(report);
  await patchStylesCss(report);
  await patchDetailJs(report);
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
