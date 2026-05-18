#!/usr/bin/env node
// ============================================================================
// LCC Item #8 Phase B — per-action inline workflows on next-action bar.
//
// Phase A shipped the sticky bar with a generic "Take action →" button that
// switches to the relevant tab for the gap. Phase B makes the button do
// the right thing per gap_type. Focused scope: the two owner-research
// gap types where the right action is "open SoS portal":
//
//   missing_recorded_owner  → "Open SoS →"
//                            window.open() to the property's state SoS
//                            portal, biased with the property address.
//
//   llc_research_pending    → "Open SoS →"
//                            window.open() to the queue's guessed-state
//                            SoS portal, biased with the LLC search name
//                            (which is in next.gap_label).
//
// All other gap_types continue to use the Phase A tab-switch fallback.
// The button label updates dynamically; the meta line reflects the
// destination ("opens Secretary of State portal" vs "opens X tab").
//
// Reuses _lccSosPortalUrl helper from #2B (LLC Research widget) when
// available; falls through to a Google search query for unmapped states.
//
// Branch: audit/08B-next-action-per-action-workflows
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

// ─── detail.js: gap-aware button + dispatcher ───
async function patchDetailJs(report) {
  const path = resolve(REPO_ROOT, 'detail.js');
  if (!await fileExists(path)) throw new Error('detail.js not found.');

  // 1. Replace the bar render to use a dynamic button label + meta text.
  await replaceUnique(path,
    `  const sev = String(next.gap_severity || 'low').toLowerCase();
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
  parts.push('<button type="button" class="nab-cta" onclick="event.stopPropagation();_udNextActionClick(&quot;' + esc(next.gap_type) + '&quot;)">Take action →</button>');`,
    `  const sev = String(next.gap_severity || 'low').toLowerCase();
  const action = String(next.suggested_action || '').trim()
    || String(next.gap_label || '').trim()
    || 'Open next action';
  const valStr = _udFormatNabValue(next.gap_value);
  // Item #8 Phase B (2026-05-18): dispatch UX by gap_type. The button
  // label + meta destination both reflect what clicking the button
  // will actually do, instead of the generic "Take action" + tab name.
  const dispatch = _udNextActionDispatchFor(next.gap_type);
  const meta = [];
  if (valStr) meta.push(valStr + ' value');
  meta.push(dispatch.metaSuffix);
  const metaText = meta.join(' · ');

  const parts = [];
  parts.push('<span class="nab-label">Next action</span>');
  parts.push('<span class="nab-sev-chip nab-sev-' + esc(sev) + '-chip">' + esc(sev.toUpperCase()) + '</span>');
  parts.push('<div class="nab-body">');
  parts.push(  '<div class="nab-action-text" title="' + esc(action) + '">' + esc(action) + '</div>');
  parts.push(  '<div class="nab-meta">' + esc(metaText) + '</div>');
  parts.push('</div>');
  parts.push('<button type="button" class="nab-cta" onclick="event.stopPropagation();_udNextActionClick(&quot;' + esc(next.gap_type) + '&quot;)">' + esc(dispatch.label) + '</button>');`,
    report, 'detail.js (next-action bar dynamic button label + meta)');

  // 2. Add the dispatch-spec helper.
  await replaceUnique(path,
    `function _udFormatNabValue(n) {`,
    `// Item #8 Phase B (2026-05-18): per-gap_type dispatch spec. Returns
// { label, metaSuffix } so the bar can show the right CTA text and
// destination hint without hard-coding into the renderer.
function _udNextActionDispatchFor(gapType) {
  const t = String(gapType || '');
  if (t === 'missing_recorded_owner' || t === 'llc_research_pending') {
    return { label: 'Open SoS →', metaSuffix: 'opens Secretary of State portal' };
  }
  // Other gap types: existing tab-switch UX
  return { label: 'Take action →', metaSuffix: 'opens ' + _udNextActionTabForGap(t) };
}

function _udFormatNabValue(n) {`,
    report, 'detail.js (dispatch-spec helper)');

  // 3. Replace the click handler to dispatch by gap_type.
  await replaceUnique(path,
    `function _udNextActionClick(gapType) {
  const tab = _udNextActionTabForGap(gapType);
  if (typeof switchUnifiedTab === 'function' && tab) {
    switchUnifiedTab(tab);
  }
  // Telemetry hook reserved — not wired in Phase A.
  console.debug('[NextAction] click', gapType, '-> tab', tab);
}
window._udNextActionClick = _udNextActionClick;`,
    `function _udNextActionClick(gapType) {
  // Item #8 Phase B (2026-05-18): dispatch by gap_type. SoS-portal opens
  // for owner-research gaps; everything else falls through to tab-switch.
  const t = String(gapType || '');

  if (t === 'missing_recorded_owner' || t === 'llc_research_pending') {
    // Pull state + search context from the cached property + next-action row.
    const prop = (_udCache && _udCache.property) || {};
    const fallback = (_udCache && _udCache.fallback) || {};
    const next = (_udCache && _udCache.nextAction) || {};
    const state = prop.state || fallback.state || '';
    // For missing_recorded_owner the gap_label is the address; for
    // llc_research_pending it's the LLC search_name. Either way it's the
    // string we want to bias the SoS / Google search toward.
    const searchName = String(next.gap_label || '').replace(/\\s*\\[\\d+\\s*dup records\\]\\s*$/, '').trim()
      || prop.recorded_owner_name
      || prop.address
      || '';
    // Reuse the SoS portal map from #2B (LLC widget); fall back to Google.
    let url;
    if (typeof _lccSosPortalUrl === 'function') {
      url = _lccSosPortalUrl(state, searchName);
    } else {
      const q = encodeURIComponent('"' + searchName + '" ' + (state ? state + ' ' : '') + 'secretary of state LLC filing');
      url = 'https://www.google.com/search?q=' + q;
    }
    try { window.open(url, '_blank', 'noopener'); } catch (e) {
      console.warn('[NextAction] window.open failed:', e?.message);
    }
    console.debug('[NextAction] click', gapType, '-> SoS portal', url);
    return;
  }

  // Default: switch to the tab where this gap lives.
  const tab = _udNextActionTabForGap(gapType);
  if (typeof switchUnifiedTab === 'function' && tab) {
    switchUnifiedTab(tab);
  }
  console.debug('[NextAction] click', gapType, '-> tab', tab);
}
window._udNextActionClick = _udNextActionClick;`,
    report, 'detail.js (next-action click dispatcher)');
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

## Closeout — item 8 Phase B ✅ — per-action inline workflows
- **Status:** ✅ DONE.
- **Branch:** \`audit/08B-next-action-per-action-workflows\`
- **Patch:** \`audit/patches/08B-next-action-per-action-workflows/apply.mjs\`

### What this adds
The sticky next-action bar's button is now gap_type-aware. Phase A always said "Take action →" and switched to a tab; Phase B shows the right verb and does the right thing:

| Gap type | Button label | Action on click |
|---|---|---|
| \`missing_recorded_owner\` | **"Open SoS →"** | \`window.open()\` to the property's state SoS portal, biased with the property address |
| \`llc_research_pending\` | **"Open SoS →"** | \`window.open()\` to the queue's guessed-state SoS portal, biased with the LLC search_name |
| all others | "Take action →" | switch to the relevant tab (unchanged) |

The meta line under the action text also updates: "opens Secretary of State portal" for owner-research gaps vs "opens Rent Roll tab" (or whichever tab) for others.

### How it works
Two helpers added to \`detail.js\`:
- \`_udNextActionDispatchFor(gapType)\` → returns \`{ label, metaSuffix }\` so the renderer doesn't hard-code per-type CTA text.
- \`_udNextActionClick(gapType)\` → dispatches: SoS portal open via \`_lccSosPortalUrl()\` (from #2B's LLC widget) for owner-research gaps; otherwise falls through to existing tab-switch.

Search name extraction strips the \`[N dup records]\` annotation from \`gap_label\` so the SoS query isn't polluted by the dedupe metadata. State pulled from \`_udCache.property.state\` or \`_udCache.fallback.state\`.

### Files changed
- \`detail.js\` — 3 anchored edits (label/meta render + dispatch helper + click handler)
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. Hard-reload, open any gov property with \`missing_recorded_owner\` as its top gap.
2. The sticky bar at the bottom now shows **"Open SoS →"** instead of "Take action →".
3. Meta line: "$X.XM value · opens Secretary of State portal".
4. Click → a new tab opens at the state's SoS search portal (CA / DE / NY / etc. mapped; Google fallback for unmapped states).
5. Open a property whose top gap is \`lease_tenant_drift\` or \`stale_active_listing\` — bar still says "Take action →" and the tab-switch flow is unchanged.

### Phase C continuations (deferred)
- Per-action workflows for the remaining gap types:
  - \`agency_drift:*\` — reuse the resolve-agency-drift endpoint for one-click PATCH from the bar
  - \`orphan_sale_owner\` — one-click most-recent backlink (single-row version of A-1)
  - \`lease_tenant_drift\` — one-click back-fill of \`properties.tenant\` from active lease
  - \`cms_chain_drift:*\` — one-click "use CMS chain value"

`);
  c = c + appendBlock;
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Item #8 Phase B — next-action per-action workflows ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchDetailJs(report);
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
