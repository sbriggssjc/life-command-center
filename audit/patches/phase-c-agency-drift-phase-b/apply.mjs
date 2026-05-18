#!/usr/bin/env node
// ============================================================================
// LCC Phase C — Agency-drift widget Phase B: null-property handler + toggle.
//
// A-5 shipped the "Disagreement" mode (808 cases). Phase B extends the
// same widget to handle the smaller-but-easier
// 'lease_agency_but_property_agency_null' case (46 properties on gov):
// the lease's tenant_agency is populated but properties.agency is NULL —
// pure fill-in with no judgment call required.
//
// Three small changes:
//
//   1. GET /api/admin?_route=agency-drift-queue accepts a new `kind`
//      query param. Default 'agency_disagreement' (preserves A-5
//      behavior); new value 'lease_agency_but_property_agency_null'
//      switches the filter.
//
//   2. The widget header gets a 2-button toggle ("Disagreement" /
//      "Missing") that switches between the two modes. Active mode is
//      remembered for the page session (localStorage `lcc.adrift.kind`).
//
//   3. Card render diverges by mode:
//      - Disagreement (existing): side-by-side chips + "Use lease value"
//      - Missing: single "Property: blank" placeholder + lease chip +
//        "Fill in from lease" button (POST is the same endpoint).
//
// Branch: audit/phase-c-agency-drift-phase-b
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

// ─── api/admin.js: accept kind param ───
async function patchAdminJs(report) {
  const path = resolve(REPO_ROOT, 'api', 'admin.js');
  if (!await fileExists(path)) throw new Error('api/admin.js not found.');

  await replaceUnique(path,
    `async function handleAgencyDriftQueueList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const limit = Math.min(parseInt(req.query.limit, 10) || 15, 100);

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    const gRes = await domainQuery('government', 'GET',
      'v_gap_agency_drift' +
      '?drift_kind=eq.agency_disagreement' +
      '&select=property_id,prop_agency,prop_agency_canonical,lease_tenant_agency,lease_tenant_agency_full,property_value,drift_kind' +
      '&order=property_value.desc.nullslast' +
      '&limit=' + limit
    );`,
    `async function handleAgencyDriftQueueList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const limit = Math.min(parseInt(req.query.limit, 10) || 15, 100);
  // Phase B (2026-05-18): \`kind\` chooses between the two drift_kind
  // surfaces. Default preserves A-5 behavior.
  const ALLOWED_KINDS = new Set(['agency_disagreement', 'lease_agency_but_property_agency_null']);
  const kind = ALLOWED_KINDS.has(String(req.query.kind || '')) ? String(req.query.kind) : 'agency_disagreement';

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    const gRes = await domainQuery('government', 'GET',
      'v_gap_agency_drift' +
      '?drift_kind=eq.' + encodeURIComponent(kind) +
      '&select=property_id,prop_agency,prop_agency_canonical,lease_tenant_agency,lease_tenant_agency_full,property_value,drift_kind' +
      '&order=property_value.desc.nullslast' +
      '&limit=' + limit
    );`,
    report, 'api/admin.js (agency-drift kind param)');

  // Return the kind in the response so the UI knows which mode.
  await replaceUnique(path,
    `    return res.status(200).json({ ok: true, items, total: items.length });
  } catch (err) {
    console.error('[agency-drift-queue]', err?.message || err);
    return res.status(500).json({ error: 'agency_drift_queue_failed', message: err?.message });
  }
}`,
    `    return res.status(200).json({ ok: true, items, total: items.length, kind });
  } catch (err) {
    console.error('[agency-drift-queue]', err?.message || err);
    return res.status(500).json({ error: 'agency_drift_queue_failed', message: err?.message });
  }
}`,
    report, 'api/admin.js (agency-drift kind in response)');
}

// ─── app.js: filter toggle + mode-aware render ───
async function patchAppJs(report) {
  const path = resolve(REPO_ROOT, 'app.js');
  if (!await fileExists(path)) throw new Error('app.js not found.');

  // 1. loadAgencyDriftQueue accepts a kind param
  await replaceUnique(path,
    `async function loadAgencyDriftQueue(limit) {
  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
  try {
    const r = await fetch('/api/admin?_route=agency-drift-queue&limit=' + (limit || 15), { headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    if (typeof lccReportError === 'function') {
      lccReportError('Load agency-drift queue', e, { tier: 'warn' });
    }
    return { ok: false, items: [], total: 0 };
  }
}
window.loadAgencyDriftQueue = loadAgencyDriftQueue;`,
    `function _lccGetAgencyDriftKind() {
  try {
    const stored = localStorage.getItem('lcc.adrift.kind');
    if (stored === 'agency_disagreement' || stored === 'lease_agency_but_property_agency_null') return stored;
  } catch (_) {}
  return 'agency_disagreement';
}

function _lccSetAgencyDriftKind(kind) {
  if (!['agency_disagreement', 'lease_agency_but_property_agency_null'].includes(kind)) return;
  try { localStorage.setItem('lcc.adrift.kind', kind); } catch (_) {}
  const el = document.getElementById('researchContent');
  if (el) renderAgencyDriftQueueWidget(el);
}
window._lccSetAgencyDriftKind = _lccSetAgencyDriftKind;

async function loadAgencyDriftQueue(limit, kind) {
  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
  const k = kind || _lccGetAgencyDriftKind();
  try {
    const r = await fetch('/api/admin?_route=agency-drift-queue&kind=' + encodeURIComponent(k) + '&limit=' + (limit || 15), { headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    if (typeof lccReportError === 'function') {
      lccReportError('Load agency-drift queue', e, { tier: 'warn' });
    }
    return { ok: false, items: [], total: 0, kind: k };
  }
}
window.loadAgencyDriftQueue = loadAgencyDriftQueue;`,
    report, 'app.js (loadAgencyDriftQueue + kind helpers)');

  // 2. Header gets a filter toggle; rows render mode-aware.
  await replaceUnique(path,
    `  const snap = await loadAgencyDriftQueue(15);
  if (!snap || !snap.ok) {
    widget.innerHTML = '<div class="widget-error"><div class="err-msg">Agency-drift queue unavailable.</div><button class="retry-btn" onclick="(async()=>{const el=document.getElementById(&quot;researchContent&quot;);if(el)await renderAgencyDriftQueueWidget(el);})()">Retry</button></div>';
    return;
  }

  const items = Array.isArray(snap.items) ? snap.items : [];
  const parts = [];
  parts.push('<div class="lcc-llc-research-header">');
  parts.push(  '<div class="lcc-llc-research-title">Agency Drift Queue <span class="lcc-llc-research-count">' + items.length + '</span></div>');
  parts.push(  '<button type="button" class="nba-refresh-btn" title="Refresh" onclick="(async()=>{const el=document.getElementById(&quot;researchContent&quot;);if(el)await renderAgencyDriftQueueWidget(el);})()">↻</button>');
  parts.push('</div>');

  if (items.length === 0) {
    parts.push('<div class="lcc-llc-research-empty">No agency disagreements found. Clean.</div>');
    widget.innerHTML = parts.join('');
    return;
  }

  parts.push('<div class="lcc-llc-research-list">');
  items.forEach((row, idx) => {
    const propId = Number(row.property_id);
    const propAddr = [row.property_address, row.property_city, row.property_state].filter(Boolean).join(', ');
    const valStr = _lccFormatLlcValue(row.property_value);
    const propAgency = String(row.prop_agency_canonical || row.prop_agency || '(blank)').trim();
    const leaseAgency = String(row.lease_tenant_agency_full || row.lease_tenant_agency || '(blank)').trim();
    const cmpChip = (row.completeness_band || row.completeness_score != null)
      ? lccCompletenessChip(row.completeness_score, row.completeness_band)
      : '';
    parts.push('<div class="lcc-llc-research-row lcc-agency-drift-row" data-property-id="' + propId + '">');
    parts.push(  '<div class="lcc-llc-research-rank">#' + (idx + 1) + '</div>');
    parts.push(  '<div class="lcc-llc-research-body">');
    parts.push(    '<div class="lcc-llc-research-name">' + esc(propAddr || 'property #' + propId) + '</div>');
    parts.push(    '<div class="lcc-agency-drift-versus">');
    parts.push(      '<span class="lcc-agency-drift-versus-prop"  title="properties.agency">' + esc(propAgency) + '</span>');
    parts.push(      '<span class="lcc-agency-drift-versus-arrow">vs</span>');
    parts.push(      '<span class="lcc-agency-drift-versus-lease" title="lease.tenant_agency">' + esc(leaseAgency) + '</span>');
    parts.push(    '</div>');
    parts.push(    '<div class="lcc-llc-research-meta">');
    parts.push(      '<span class="lcc-llc-research-val">' + esc(valStr) + '</span>');
    if (cmpChip) parts.push(cmpChip);
    parts.push(    '</div>');
    parts.push(  '</div>');
    parts.push(  '<div class="lcc-llc-research-actions">');
    parts.push(    '<button type="button" class="lcc-llc-research-btn lcc-llc-research-btn-primary" onclick="_lccAgencyDriftUseLease(' + propId + ', &quot;' + esc(row.lease_tenant_agency || '') + '&quot;, &quot;' + esc(row.lease_tenant_agency_full || '') + '&quot;)">Use lease value</button>');
    parts.push(    '<button type="button" class="lcc-llc-research-btn" onclick="_lccAgencyDriftOpenDetail(' + propId + ')">Open detail</button>');
    parts.push(  '</div>');
    parts.push('</div>');
  });
  parts.push('</div>');

  widget.innerHTML = parts.join('');
}`,
    `  const kind = _lccGetAgencyDriftKind();
  const snap = await loadAgencyDriftQueue(15, kind);
  if (!snap || !snap.ok) {
    widget.innerHTML = '<div class="widget-error"><div class="err-msg">Agency-drift queue unavailable.</div><button class="retry-btn" onclick="(async()=>{const el=document.getElementById(&quot;researchContent&quot;);if(el)await renderAgencyDriftQueueWidget(el);})()">Retry</button></div>';
    return;
  }

  const items = Array.isArray(snap.items) ? snap.items : [];
  const isMissingMode = (snap.kind || kind) === 'lease_agency_but_property_agency_null';
  const parts = [];
  parts.push('<div class="lcc-llc-research-header">');
  parts.push(  '<div class="lcc-llc-research-title">Agency Drift Queue <span class="lcc-llc-research-count">' + items.length + '</span></div>');
  parts.push(  '<div class="lcc-adrift-controls">');
  // Phase B (2026-05-18): kind filter — Disagreement (808) / Missing (46).
  parts.push(    '<div class="lcc-sort-toggle-group" style="display:inline-flex">');
  parts.push(      '<button type="button" class="lcc-sort-toggle-btn' + (kind === 'agency_disagreement' ? ' active' : '') + '" onclick="_lccSetAgencyDriftKind(&quot;agency_disagreement&quot;)">Disagreement</button>');
  parts.push(      '<button type="button" class="lcc-sort-toggle-btn' + (kind === 'lease_agency_but_property_agency_null' ? ' active' : '') + '" onclick="_lccSetAgencyDriftKind(&quot;lease_agency_but_property_agency_null&quot;)">Missing</button>');
  parts.push(    '</div>');
  parts.push(    '<button type="button" class="nba-refresh-btn" title="Refresh" onclick="(async()=>{const el=document.getElementById(&quot;researchContent&quot;);if(el)await renderAgencyDriftQueueWidget(el);})()">↻</button>');
  parts.push(  '</div>');
  parts.push('</div>');

  if (items.length === 0) {
    parts.push('<div class="lcc-llc-research-empty">' + (isMissingMode ? 'No properties with missing agency. Clean.' : 'No agency disagreements found. Clean.') + '</div>');
    widget.innerHTML = parts.join('');
    return;
  }

  parts.push('<div class="lcc-llc-research-list">');
  items.forEach((row, idx) => {
    const propId = Number(row.property_id);
    const propAddr = [row.property_address, row.property_city, row.property_state].filter(Boolean).join(', ');
    const valStr = _lccFormatLlcValue(row.property_value);
    const propAgency = String(row.prop_agency_canonical || row.prop_agency || '').trim();
    const leaseAgency = String(row.lease_tenant_agency_full || row.lease_tenant_agency || '(blank)').trim();
    const cmpChip = (row.completeness_band || row.completeness_score != null)
      ? lccCompletenessChip(row.completeness_score, row.completeness_band)
      : '';
    const primaryLabel = isMissingMode ? 'Fill in from lease' : 'Use lease value';
    parts.push('<div class="lcc-llc-research-row lcc-agency-drift-row" data-property-id="' + propId + '">');
    parts.push(  '<div class="lcc-llc-research-rank">#' + (idx + 1) + '</div>');
    parts.push(  '<div class="lcc-llc-research-body">');
    parts.push(    '<div class="lcc-llc-research-name">' + esc(propAddr || 'property #' + propId) + '</div>');
    parts.push(    '<div class="lcc-agency-drift-versus">');
    if (isMissingMode) {
      parts.push(    '<span class="lcc-agency-drift-versus-prop lcc-agency-drift-blank" title="properties.agency is NULL">(blank)</span>');
    } else {
      parts.push(    '<span class="lcc-agency-drift-versus-prop"  title="properties.agency">' + esc(propAgency || '(blank)') + '</span>');
    }
    parts.push(      '<span class="lcc-agency-drift-versus-arrow">' + (isMissingMode ? '←' : 'vs') + '</span>');
    parts.push(      '<span class="lcc-agency-drift-versus-lease" title="lease.tenant_agency">' + esc(leaseAgency) + '</span>');
    parts.push(    '</div>');
    parts.push(    '<div class="lcc-llc-research-meta">');
    parts.push(      '<span class="lcc-llc-research-val">' + esc(valStr) + '</span>');
    if (cmpChip) parts.push(cmpChip);
    parts.push(    '</div>');
    parts.push(  '</div>');
    parts.push(  '<div class="lcc-llc-research-actions">');
    parts.push(    '<button type="button" class="lcc-llc-research-btn lcc-llc-research-btn-primary" onclick="_lccAgencyDriftUseLease(' + propId + ', &quot;' + esc(row.lease_tenant_agency || '') + '&quot;, &quot;' + esc(row.lease_tenant_agency_full || '') + '&quot;)">' + esc(primaryLabel) + '</button>');
    parts.push(    '<button type="button" class="lcc-llc-research-btn" onclick="_lccAgencyDriftOpenDetail(' + propId + ')">Open detail</button>');
    parts.push(  '</div>');
    parts.push('</div>');
  });
  parts.push('</div>');

  widget.innerHTML = parts.join('');
}`,
    report, 'app.js (agency-drift widget toggle + missing mode)');
}

// ─── styles.css: blank-chip variant + controls container ───
async function patchStylesCss(report) {
  const path = resolve(REPO_ROOT, 'styles.css');
  if (!await fileExists(path)) throw new Error('styles.css not found.');

  const ANCHOR = `.lcc-agency-drift-versus-lease { color: var(--text1); padding: 2px 7px; background: color-mix(in srgb, var(--green, #22c55e) 14%, var(--s1)); border: 1px solid color-mix(in srgb, var(--green, #22c55e) 38%, transparent); border-radius: 999px; font-weight: 600; }`;
  const CSS = `

/* Agency drift Phase B (2026-05-18): "Missing" mode + filter toggle */
.lcc-agency-drift-blank { font-style: italic; color: var(--text3) !important; background: var(--s2) !important; border-color: var(--border) !important; }
.lcc-adrift-controls { display: inline-flex; align-items: center; gap: 8px; }`;
  const REPLACE = ANCHOR + CSS;
  await replaceUnique(path, ANCHOR, REPLACE, report, 'styles.css (agency-drift Phase B)');
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

## Phase C — Agency-drift widget Phase B ✅
- **Status:** ✅ DONE.
- **Branch:** \`audit/phase-c-agency-drift-phase-b\`
- **Patch:** \`audit/patches/phase-c-agency-drift-phase-b/apply.mjs\`

### What this adds
Extends the agency-drift widget from A-5 to handle the second drift_kind on gov:
\`lease_agency_but_property_agency_null\` (46 properties where the lease has tenant_agency but \`properties.agency\` is NULL — pure fill-in, no judgment call required).

The widget header gets a filter toggle:
- **Disagreement** (808 cases, default) — side-by-side red/green chips, "Use lease value"
- **Missing** (46 cases) — italic "(blank)" placeholder + green lease chip, "Fill in from lease"

Active mode is persisted in \`localStorage.lcc.adrift.kind\`. The POST resolve endpoint is reused unchanged — both modes patch the same fields.

### Files changed
- \`api/admin.js\` — accept \`kind\` query param + echo in response
- \`app.js\` — \`_lccGetAgencyDriftKind\` / \`_lccSetAgencyDriftKind\` helpers + mode-aware render
- \`styles.css\` — \`.lcc-agency-drift-blank\` + \`.lcc-adrift-controls\`
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. Open Research page. Agency Drift widget shows a "Disagreement | Missing" toggle in its header.
2. Click **Missing** → widget reloads with up to 15 NULL-property rows. Each shows italic "(blank)" + green lease chip + "Fill in from lease" button.
3. Click **Fill in from lease** on a row → confirm → row disappears.
4. SQL spot-check on gov:
   \`\`\`sql
   SELECT count(*) FROM public.v_gap_agency_drift
    WHERE drift_kind = 'lease_agency_but_property_agency_null';
   -- Drops with each resolution.
   \`\`\`

### Live counts (verified 2026-05-18)
- \`agency_disagreement\`: 808
- \`lease_agency_but_property_agency_null\`: 46
- (7,293 NULL drift_kind rows are not surfaced — they're properties with non-disagreeing data)

`);
  c = c + appendBlock;
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Phase C — Agency-drift widget Phase B ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchAdminJs(report);
  await patchAppJs(report);
  await patchStylesCss(report);
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
