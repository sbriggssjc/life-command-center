#!/usr/bin/env node
// ============================================================================
// LCC Item #8 Phase B-2 — next-action dispatcher: agency_drift handler.
//
// Extends the per-gap_type dispatcher on the sticky next-action bar
// (shipped in #8 Phase B) to handle the agency_drift gap types — the
// next-highest-volume case after the owner-research SoS-opens.
//
// Affected gap_types (gov-only):
//   agency_drift:agency_disagreement                  (808 cases)
//   agency_drift:lease_agency_but_property_agency_null (46 cases)
//
// Workflow:
//   1. Click "Use lease value →" on the bar.
//   2. Browser fetches the row from v_gap_agency_drift for this
//      property to read the lease's tenant_agency / tenant_agency_full.
//   3. asyncConfirm with the proposed new agency value.
//   4. POST to /api/admin?_route=resolve-agency-drift (the endpoint
//      shipped in A-5) with new_agency_canonical + new_agency_full.
//   5. Toast on success; hide the bar (gap resolved, next view of the
//      property will show a different top gap or no gap).
//
// Reuses the resolve endpoint from A-5 — no new backend code needed.
//
// Other gap_types continue with Phase B (SoS open for owner-research)
// or Phase A (tab-switch) behavior.
//
// Branch: audit/08B2-next-action-agency-drift
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

// ─── detail.js: extend dispatcher for agency_drift ───
async function patchDetailJs(report) {
  const path = resolve(REPO_ROOT, 'detail.js');
  if (!await fileExists(path)) throw new Error('detail.js not found.');

  // 1. Extend dispatch-spec helper with the agency_drift case.
  await replaceUnique(path,
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
}`,
    `// Item #8 Phase B (2026-05-18): per-gap_type dispatch spec. Returns
// { label, metaSuffix } so the bar can show the right CTA text and
// destination hint without hard-coding into the renderer.
function _udNextActionDispatchFor(gapType) {
  const t = String(gapType || '');
  if (t === 'missing_recorded_owner' || t === 'llc_research_pending') {
    return { label: 'Open SoS →', metaSuffix: 'opens Secretary of State portal' };
  }
  // Item #8 Phase B-2 (2026-05-18): agency_drift gap_types get an
  // inline "Use lease value" PATCH workflow.
  if (t === 'agency_drift:agency_disagreement') {
    return { label: 'Use lease value →', metaSuffix: 'patches properties.agency from active lease' };
  }
  if (t === 'agency_drift:lease_agency_but_property_agency_null') {
    return { label: 'Fill from lease →', metaSuffix: 'fills properties.agency from active lease' };
  }
  // Other gap types: existing tab-switch UX
  return { label: 'Take action →', metaSuffix: 'opens ' + _udNextActionTabForGap(t) };
}`,
    report, 'detail.js (B-2: dispatch-spec helper for agency_drift)');

  // 2. Extend the click handler with the agency_drift branch.
  //    Insert it BEFORE the existing "Default: switch to the tab" fallback.
  await replaceUnique(path,
    `  if (t === 'missing_recorded_owner' || t === 'llc_research_pending') {
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

  // Default: switch to the tab where this gap lives.`,
    `  if (t === 'missing_recorded_owner' || t === 'llc_research_pending') {
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

  // Item #8 Phase B-2 (2026-05-18): agency_drift gap_types route to a
  // one-click "Use lease value" PATCH that reuses the resolve endpoint
  // from #A-5.
  if (t === 'agency_drift:agency_disagreement' || t === 'agency_drift:lease_agency_but_property_agency_null') {
    _udNextActionResolveAgencyDrift(gapType).catch(e => console.warn('[NextAction] agency_drift resolve failed:', e?.message));
    return;
  }

  // Default: switch to the tab where this gap lives.`,
    report, 'detail.js (B-2: click handler agency_drift dispatch)');

  // 3. Add the resolve helper that orchestrates fetch lease value → confirm
  //    → POST → toast → hide bar. Anchor right after _udNextActionClick.
  await replaceUnique(path,
    `function _udNextActionClick(gapType) {`,
    `// Item #8 Phase B-2 (2026-05-18): orchestrate the agency_drift resolve.
async function _udNextActionResolveAgencyDrift(gapType) {
  const prop = (_udCache && _udCache.property) || {};
  const propertyId = Number(prop.property_id);
  if (!Number.isFinite(propertyId)) {
    if (typeof showToast === 'function') showToast('Could not identify property_id', 'error');
    return;
  }
  if (_udCache.db !== 'gov') {
    if (typeof showToast === 'function') showToast('Agency drift only applies to gov properties', 'warn');
    return;
  }
  const driftKind = String(gapType).replace(/^agency_drift:/, '');

  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;

  // 1. Fetch the v_gap_agency_drift row for this property to get the
  //    lease's tenant_agency / tenant_agency_full.
  let leaseAgency = null;
  let leaseAgencyFull = null;
  try {
    const r = await govQuery('v_gap_agency_drift', '*', {
      filter: 'property_id=eq.' + propertyId + '&drift_kind=eq.' + encodeURIComponent(driftKind),
      limit: 1,
    });
    const rows = Array.isArray(r) ? r : (r?.data || []);
    if (!rows.length) {
      if (typeof showToast === 'function') showToast('No active drift row found — refresh and try again', 'warn');
      return;
    }
    leaseAgency = rows[0].lease_tenant_agency || null;
    leaseAgencyFull = rows[0].lease_tenant_agency_full || null;
  } catch (e) {
    if (typeof lccReportError === 'function') lccReportError('Fetch agency drift row', e);
    return;
  }

  if (!leaseAgency && !leaseAgencyFull) {
    if (typeof showToast === 'function') showToast('Lease has no tenant_agency to apply', 'warn');
    return;
  }

  // 2. Confirm with the user.
  const display = leaseAgencyFull || leaseAgency;
  let confirmed = true;
  if (typeof asyncConfirm === 'function') {
    confirmed = await asyncConfirm('Set properties.agency to "' + display + '" from the lease?');
  }
  if (!confirmed) return;

  // 3. POST to the resolve endpoint shipped in A-5.
  try {
    const res = await fetch('/api/admin?_route=resolve-agency-drift', {
      method: 'POST', headers,
      body: JSON.stringify({
        property_id:          propertyId,
        resolution:           'use_lease',
        new_agency_canonical: leaseAgency || null,
        new_agency_full:      leaseAgencyFull || null,
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (typeof showToast === 'function') showToast('Updated agency from lease', 'ok');
  } catch (e) {
    if (typeof lccReportError === 'function') lccReportError('Resolve agency drift from bar', e);
    return;
  }

  // 4. Hide the bar (the gap is resolved; next view will show whatever
  //    is next-best-action for this property).
  if (_udCache) {
    _udCache.nextAction = null;
    _setUdCache(_udCache);
  }
  const bar = document.getElementById('detailNextActionBar');
  if (bar) {
    bar.style.display = 'none';
    bar.innerHTML = '';
  }
}
window._udNextActionResolveAgencyDrift = _udNextActionResolveAgencyDrift;

function _udNextActionClick(gapType) {`,
    report, 'detail.js (B-2: _udNextActionResolveAgencyDrift helper)');
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

## Closeout — item 8 Phase B-2 ✅ — next-action dispatcher: agency_drift
- **Status:** ✅ DONE.
- **Branch:** \`audit/08B2-next-action-agency-drift\`
- **Patch:** \`audit/patches/08B2-next-action-agency-drift/apply.mjs\`

### What this adds
Extends the per-gap_type dispatcher shipped in Phase B to handle the agency_drift gap_types (gov-only). When a property's top NBA gap is one of:
- \`agency_drift:agency_disagreement\` (808 cases)
- \`agency_drift:lease_agency_but_property_agency_null\` (46 cases)

…the bar's CTA becomes "Use lease value →" / "Fill from lease →" instead of the generic "Take action →". Click → fetches the lease's tenant_agency from \`v_gap_agency_drift\`, asyncConfirms with the proposed value, POSTs to the existing \`resolve-agency-drift\` endpoint shipped in A-5, toasts on success, and hides the bar (drift resolved).

### Why this matters
The Agency Drift widget on the Research page already lets Scott batch-resolve these from a queue view. The bar lets him resolve **as he encounters each property**, without leaving the detail panel — closes the "see the gap → fix the gap" loop in one click.

### Workflow
```
1. Click "Use lease value →" on the bar
2. govQuery('v_gap_agency_drift', filter: property_id=eq.X)
3. asyncConfirm: Set properties.agency to "GSA - Social Security Admin"?
4. POST /api/admin?_route=resolve-agency-drift (from A-5)
5. showToast('Updated agency from lease', 'ok')
6. Hide the bar; clear _udCache.nextAction
```

### Files changed
- \`detail.js\` — 3 anchored edits (dispatch-spec helper, click branch, new resolve helper)
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. Open any gov property whose top gap is \`agency_drift:agency_disagreement\` or \`agency_drift:lease_agency_but_property_agency_null\` (find one via the NBA Home rail).
2. Sticky bar at the bottom shows **"Use lease value →"** or **"Fill from lease →"**.
3. Meta line: "$X.XM value · patches properties.agency from active lease".
4. Click → confirm dialog with the proposed agency value → confirm → toast → bar disappears.
5. On gov Studio:
   \`\`\`sql
   SELECT agency, agency_canonical, agency_full_name, updated_at
     FROM public.properties WHERE property_id = <id>;
   -- agency / agency_canonical / agency_full_name are now the lease values
   -- updated_at is the moment you clicked
   \`\`\`

### Per-action dispatcher coverage after this patch
| Gap type | Button | Action |
|---|---|---|
| missing_recorded_owner | "Open SoS →" | window.open SoS portal (B) |
| llc_research_pending | "Open SoS →" | window.open SoS portal (B) |
| **agency_drift:agency_disagreement** | **"Use lease value →"** | **PATCH via resolve-agency-drift (B-2)** |
| **agency_drift:lease_agency_but_property_agency_null** | **"Fill from lease →"** | **PATCH via resolve-agency-drift (B-2)** |
| lease_tenant_drift | "Take action →" | tab-switch (A) — Phase B-3 candidate |
| orphan_sale_owner | "Take action →" | tab-switch (A) — Phase B-3 candidate |
| stale_active_listing | "Take action →" | tab-switch (A) |
| cms_chain_drift:* | "Take action →" | tab-switch (A) |

### Phase B-3 candidates (deferred)
- **orphan_sale_owner** — one-click most-recent backlink (single-row version of A-1's logic). Needs a new admin sub-route \`resolve-orphan-sale\` that mirrors the safety check from A-1.
- **lease_tenant_drift** — one-click back-fill of \`properties.tenant\` from the active lease (parallels agency_drift).
- **cms_chain_drift:cms_chain_but_property_tenant_null** — one-click "use CMS chain value" (parallels agency_drift but writes \`properties.tenant\` from \`cms_chain\`).

`);
  c = c + appendBlock;
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Item #8 Phase B-2 — next-action dispatcher: agency_drift ===');
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
