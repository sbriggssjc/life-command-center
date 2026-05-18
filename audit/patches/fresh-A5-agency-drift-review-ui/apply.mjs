#!/usr/bin/env node
// ============================================================================
// LCC Fresh Audit — Finding A-5: agency-drift review UI.
//
// 807 gov properties have v_gap_agency_drift rows with drift_kind=
// 'agency_disagreement' (the lease record says one tenant agency, the
// properties.agency column says a different one). 204 of those are
// excellent-band properties — closing the disagreement on each one
// finishes a near-complete underwriting in seconds.
//
// Adapts the LLC Research widget pattern (Item #2 Phase B):
//   • GET  /api/admin?_route=agency-drift-queue&limit=15
//   • POST /api/admin?_route=resolve-agency-drift
//   • Widget mounts BELOW the LLC Research widget on the Research page.
//
// Per row: property address + side-by-side agency values + buttons:
//   "Use lease value" — PATCHes properties.agency to the lease tenant's
//                       canonical agency name (closes the drift outright).
//   "Open detail"     — opens the unified property detail panel for
//                       full context (uses existing openUnifiedDetail).
//
// Branch: audit/fresh-A5-agency-drift-review-ui
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

// ─── api/admin.js: two new sub-routes ───
async function patchAdminJs(report) {
  const path = resolve(REPO_ROOT, 'api', 'admin.js');
  if (!await fileExists(path)) throw new Error('api/admin.js not found.');

  await replaceUnique(path,
    `    case 'llc-research-queue':      return handleLlcResearchQueueList(req, res);
    case 'resolve-llc-research':    return handleResolveLlcResearch(req, res);
    default:`,
    `    case 'llc-research-queue':      return handleLlcResearchQueueList(req, res);
    case 'resolve-llc-research':    return handleResolveLlcResearch(req, res);
    case 'agency-drift-queue':      return handleAgencyDriftQueueList(req, res);
    case 'resolve-agency-drift':    return handleResolveAgencyDrift(req, res);
    default:`,
    report, 'api/admin.js (dispatcher cases for agency-drift)');

  // Add the two handler functions. Anchor on the end of handleResolveLlcResearch
  // so they sit next to their conceptual neighbors.
  await replaceUnique(path,
    `// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    `// ============================================================================
// AGENCY DRIFT QUEUE — Fresh audit A-5 (2026-05-18)
//
// GET  /api/admin?_route=agency-drift-queue&limit=15
//   Returns top-N gov v_gap_agency_drift rows where drift_kind=
//   'agency_disagreement', ordered by property value DESC (most
//   valuable disagreement first). Includes property context.
//
// POST /api/admin?_route=resolve-agency-drift
//   Body: { property_id, resolution: 'use_lease', new_agency_canonical?,
//           new_agency_full? }
//   Patches gov.properties.agency / agency_canonical / agency_full_name
//   to the lease tenant value. Closes the drift outright on next view
//   refresh.
// ============================================================================

async function handleAgencyDriftQueueList(req, res) {
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
    );
    if (!gRes.ok) return res.status(502).json({ error: 'queue_fetch_failed', detail: gRes.data });

    const rows = Array.isArray(gRes.data) ? gRes.data : [];
    if (rows.length === 0) return res.status(200).json({ ok: true, items: [], total: 0 });

    // Hydrate property context (address, city, state, completeness_band).
    const propIds = Array.from(new Set(rows.map(r => r.property_id).filter(Boolean)));
    let propsById = {};
    if (propIds.length > 0) {
      const pRes = await domainQuery('government', 'GET',
        'properties?property_id=in.(' + propIds.join(',') + ')' +
        '&select=property_id,address,city,state,completeness_band,completeness_score'
      );
      if (pRes.ok && Array.isArray(pRes.data)) {
        for (const p of pRes.data) propsById[p.property_id] = p;
      }
    }

    const items = rows.map(r => {
      const prop = propsById[r.property_id] || null;
      return {
        property_id:            r.property_id,
        prop_agency:            r.prop_agency,
        prop_agency_canonical:  r.prop_agency_canonical,
        lease_tenant_agency:    r.lease_tenant_agency,
        lease_tenant_agency_full: r.lease_tenant_agency_full,
        property_value:         Number(r.property_value) || 0,
        drift_kind:             r.drift_kind,
        property_address:       prop?.address || null,
        property_city:          prop?.city || null,
        property_state:         prop?.state || null,
        completeness_band:      prop?.completeness_band || null,
        completeness_score:     prop?.completeness_score != null ? Number(prop.completeness_score) : null,
      };
    });

    return res.status(200).json({ ok: true, items, total: items.length });
  } catch (err) {
    console.error('[agency-drift-queue]', err?.message || err);
    return res.status(500).json({ error: 'agency_drift_queue_failed', message: err?.message });
  }
}

async function handleResolveAgencyDrift(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const body = req.body || {};
  const propertyId = Number(body.property_id);
  const resolution = String(body.resolution || '').toLowerCase();
  if (!Number.isFinite(propertyId)) return res.status(400).json({ error: 'property_id (number) required' });
  if (resolution !== 'use_lease') {
    return res.status(400).json({ error: "resolution must be 'use_lease' (only supported value in Phase A)" });
  }

  const patch = {};
  if (body.new_agency_canonical) patch.agency_canonical = String(body.new_agency_canonical).slice(0, 200);
  if (body.new_agency_full)      patch.agency_full_name = String(body.new_agency_full).slice(0, 500);
  if (body.new_agency_canonical) patch.agency          = String(body.new_agency_canonical).slice(0, 200);
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no agency fields to update' });
  }
  patch.updated_at = new Date().toISOString();

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    const r = await domainQuery('government', 'PATCH',
      'properties?property_id=eq.' + propertyId, patch,
      undefined, { label: 'resolveAgencyDrift' });
    if (!r.ok) return res.status(502).json({ error: 'update_failed', detail: r.data });
    return res.status(200).json({ ok: true, property_id: propertyId, patch });
  } catch (err) {
    console.error('[resolve-agency-drift]', err?.message || err);
    return res.status(500).json({ error: 'resolve_failed', message: err?.message });
  }
}

// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    report, 'api/admin.js (agency-drift handlers)');
}

// ─── ops.js: mount the agency-drift widget below LLC widget ───
async function patchOpsJs(report) {
  const path = resolve(REPO_ROOT, 'ops.js');
  if (!await fileExists(path)) throw new Error('ops.js not found.');

  await replaceUnique(path,
    `  // Item #2 Phase B (2026-05-17): mount the LLC research queue widget at
  // the top of the Research page. Fires once per page render; the widget
  // itself owns its refresh button + click-driven updates.
  try {
    if (typeof renderLlcResearchQueueWidget === 'function') {
      await renderLlcResearchQueueWidget(el);
    }
  } catch (e) { console.warn('[ResearchPage] LLC widget render failed:', e?.message); }`,
    `  // Item #2 Phase B (2026-05-17): mount the LLC research queue widget at
  // the top of the Research page. Fires once per page render; the widget
  // itself owns its refresh button + click-driven updates.
  try {
    if (typeof renderLlcResearchQueueWidget === 'function') {
      await renderLlcResearchQueueWidget(el);
    }
  } catch (e) { console.warn('[ResearchPage] LLC widget render failed:', e?.message); }

  // Fresh audit A-5 (2026-05-18): mount the agency-drift review widget
  // BELOW the LLC widget so both are visible on the Research page.
  try {
    if (typeof renderAgencyDriftQueueWidget === 'function') {
      await renderAgencyDriftQueueWidget(el);
    }
  } catch (e) { console.warn('[ResearchPage] agency-drift widget render failed:', e?.message); }`,
    report, 'ops.js (mount agency-drift widget)');
}

// ─── app.js: widget render + load + actions ───
async function patchAppJs(report) {
  const path = resolve(REPO_ROOT, 'app.js');
  if (!await fileExists(path)) throw new Error('app.js not found.');

  // Append the widget code after the LLC Research helpers (after
  // _lccLlcResearchMarkNoMatch / window export).
  await replaceUnique(path,
    `async function _lccLlcResearchMarkNoMatch(queue_id) {
  let confirmed = true;
  if (typeof asyncConfirm === 'function') {
    confirmed = await asyncConfirm('Mark this LLC as "no match"? It will not appear in the queue again.');
  }
  if (!confirmed) return;
  const out = await _lccLlcResearchResolve(queue_id, 'no_match', {});
  if (out.ok && typeof showToast === 'function') showToast('Marked no_match', 'ok');
  const el = document.getElementById('researchContent');
  if (el) renderLlcResearchQueueWidget(el);
}
window._lccLlcResearchMarkNoMatch = _lccLlcResearchMarkNoMatch;`,
    `async function _lccLlcResearchMarkNoMatch(queue_id) {
  let confirmed = true;
  if (typeof asyncConfirm === 'function') {
    confirmed = await asyncConfirm('Mark this LLC as "no match"? It will not appear in the queue again.');
  }
  if (!confirmed) return;
  const out = await _lccLlcResearchResolve(queue_id, 'no_match', {});
  if (out.ok && typeof showToast === 'function') showToast('Marked no_match', 'ok');
  const el = document.getElementById('researchContent');
  if (el) renderLlcResearchQueueWidget(el);
}
window._lccLlcResearchMarkNoMatch = _lccLlcResearchMarkNoMatch;

// ============================================================================
// AGENCY DRIFT QUEUE WIDGET — Fresh audit A-5 (2026-05-18)
//
// Mirrors the LLC Research widget. Lists gov properties where the lease's
// tenant_agency disagrees with properties.agency, ordered by property
// value DESC. Each row shows both values side-by-side with a "Use lease
// value" button that PATCHes the property to the lease value.
// ============================================================================

async function loadAgencyDriftQueue(limit) {
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
window.loadAgencyDriftQueue = loadAgencyDriftQueue;

async function renderAgencyDriftQueueWidget(parentEl) {
  if (!parentEl) return;
  let widget = parentEl.querySelector('.lcc-agency-drift-widget');
  if (!widget) {
    widget = document.createElement('div');
    widget.className = 'lcc-agency-drift-widget lcc-llc-research-widget';
    // Mount after the LLC widget (if present) so the order is LLC → drift.
    const llc = parentEl.querySelector('.lcc-llc-research-widget:not(.lcc-agency-drift-widget)');
    if (llc && llc.nextSibling) parentEl.insertBefore(widget, llc.nextSibling);
    else if (llc) parentEl.appendChild(widget);
    else parentEl.insertBefore(widget, parentEl.firstChild);
  }
  widget.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  const snap = await loadAgencyDriftQueue(15);
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
}
window.renderAgencyDriftQueueWidget = renderAgencyDriftQueueWidget;

async function _lccAgencyDriftUseLease(property_id, leaseCanonical, leaseFull) {
  let confirmed = true;
  if (typeof asyncConfirm === 'function') {
    confirmed = await asyncConfirm('Set this property.agency to "' + (leaseCanonical || leaseFull || '(blank)') + '"?');
  }
  if (!confirmed) return;
  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
  try {
    const r = await fetch('/api/admin?_route=resolve-agency-drift', {
      method: 'POST', headers,
      body: JSON.stringify({
        property_id, resolution: 'use_lease',
        new_agency_canonical: leaseCanonical || null,
        new_agency_full:      leaseFull || null,
      }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (typeof showToast === 'function') showToast('Updated agency from lease', 'ok');
  } catch (e) {
    if (typeof lccReportError === 'function') lccReportError('Resolve agency drift', e);
    else console.warn('[AgencyDrift] resolve failed:', e.message);
  }
  const el = document.getElementById('researchContent');
  if (el) renderAgencyDriftQueueWidget(el);
}
window._lccAgencyDriftUseLease = _lccAgencyDriftUseLease;

function _lccAgencyDriftOpenDetail(property_id) {
  if (typeof openUnifiedDetail === 'function') {
    try { openUnifiedDetail('gov', { property_id: Number(property_id) }, {}, null); return; }
    catch (e) { console.warn('[AgencyDrift] openUnifiedDetail failed:', e.message); }
  }
  if (typeof navTo === 'function') navTo('pageGov');
}
window._lccAgencyDriftOpenDetail = _lccAgencyDriftOpenDetail;`,
    report, 'app.js (agency-drift widget)');
}

// ─── styles.css: small additions on top of the LLC widget reuse ───
async function patchStylesCss(report) {
  const path = resolve(REPO_ROOT, 'styles.css');
  if (!await fileExists(path)) throw new Error('styles.css not found.');

  // Anchor right after the LLC widget block ends (the mobile breakpoint).
  const ANCHOR = `@media (max-width: 720px) {
  .lcc-llc-research-row { grid-template-columns: 24px 1fr; gap: 8px; padding: 8px; }
  .lcc-llc-research-actions { grid-column: 1 / -1; padding-top: 6px; }
  .lcc-llc-research-btn { font-size: 10px; padding: 4px 8px; }
}`;
  const CSS = `

/* Agency drift widget — Fresh audit A-5 (2026-05-18) */
.lcc-agency-drift-widget .lcc-llc-research-title { color: var(--accent); }
.lcc-agency-drift-versus { display: flex; align-items: center; gap: 8px; font-size: 11px; margin-top: 3px; flex-wrap: wrap; }
.lcc-agency-drift-versus-prop  { color: var(--text2); padding: 2px 7px; background: color-mix(in srgb, var(--red, #ef4444) 12%, var(--s1)); border: 1px solid color-mix(in srgb, var(--red, #ef4444) 35%, transparent); border-radius: 999px; }
.lcc-agency-drift-versus-arrow { color: var(--text3); font-weight: 700; }
.lcc-agency-drift-versus-lease { color: var(--text1); padding: 2px 7px; background: color-mix(in srgb, var(--green, #22c55e) 14%, var(--s1)); border: 1px solid color-mix(in srgb, var(--green, #22c55e) 38%, transparent); border-radius: 999px; font-weight: 600; }`;
  const REPLACE = ANCHOR + CSS;
  await replaceUnique(path, ANCHOR, REPLACE, report, 'styles.css (agency-drift widget)');
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

## Fresh audit A-5 ✅ — agency-drift review UI
- **Status:** ✅ DONE — the last fresh-audit finding.
- **Branch:** \`audit/fresh-A5-agency-drift-review-ui\`
- **Patch:** \`audit/patches/fresh-A5-agency-drift-review-ui/apply.mjs\`

### What this adds
A second widget on the Research page (below LLC Research) that surfaces the 807 gov agency_drift:agency_disagreement cases — properties where \`properties.agency\` disagrees with the active lease's \`tenant_agency\`. Of those, 204 are excellent-band; closing each one finishes a near-complete underwriting in seconds.

**Per row layout:**
- Property address + city + state
- Side-by-side chips: \`property.agency\` (red-tinted) vs \`lease.tenant_agency\` (green-tinted)
- Value chip + completeness band chip
- Two actions:
  - **"Use lease value"** — async-confirm prompt → PATCH \`gov.properties.agency / agency_canonical / agency_full_name\` to the lease tenant value. The drift naturally resolves on the next view refresh.
  - **"Open detail"** — opens the unified property detail panel (\`openUnifiedDetail('gov', { property_id })\`) for full context.

### Two new admin sub-routes
- \`GET /api/admin?_route=agency-drift-queue&limit=15\` — top-N rows from \`v_gap_agency_drift?drift_kind=eq.agency_disagreement\` joined with property context, ordered by \`property_value DESC\`.
- \`POST /api/admin?_route=resolve-agency-drift\` — body \`{ property_id, resolution:'use_lease', new_agency_canonical?, new_agency_full? }\`. Patches three columns on the property. Labeled \`resolveAgencyDrift\` for telemetry.

### Files changed
- \`api/admin.js\` — 2 sub-routes + 2 handlers
- \`ops.js\` — second mount call inside renderResearchPage
- \`app.js\` — widget render + load + 2 actions
- \`styles.css\` — \`.lcc-agency-drift-*\` styles (mostly reuses LLC widget classes)
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification (post-Railway redeploy)
1. Open the LCC app → More drawer → **Research**. Two widgets stacked: LLC Research at top, Agency Drift below.
2. Each agency-drift card shows side-by-side red/green chips for the two agency values. Click **Use lease value** → toast confirms; row disappears; backend PATCH'd the property.
3. SQL spot-check on gov:
   \`\`\`sql
   SELECT count(*) FROM public.v_gap_agency_drift WHERE drift_kind='agency_disagreement';
   -- After resolving a few rows, expect this count to drop.
   \`\`\`

### Fresh audit punch list — fully closed
- A-1 ✅ orphan sale backfill (1,596 NBA gaps closed)
- A-2 ✅ sales POST labeled
- A-3 ✅ label + fix unlabeled writers (426/24h closed)
- A-4 ✅ loans status normalized + CHECK loosened
- **A-5 ✅** agency-drift review UI

### Phase C / follow-up backlog (unchanged from prior closeout)
- **Item #3 Phase C** — external enrichment pipeline for 13,131 NULL-owner properties (SoS / county / commercial API).
- **Item #8 Phase B** — per-action inline workflows on the next-action bar.
- **Sort/chip helper adoption per tab** — sales, listings, portfolio, prospects, ops, loans.
- **pushProvenance gating sweep** — adopt the gating pattern across remaining ~30 call sites.
- **client_errors consumption** — migrate ~50 ad-hoc \`console.warn + showToast\` sites to \`lccReportError\`.
- **ingest_write_failures admin dashboard** — Settings widget showing recent failure rates.
- **Agency-drift Phase B** — bulk mode ("Resolve all where lease + property_canonical share root word"), 'lease_agency_but_property_agency_null' handler (the easier sibling of disagreement).

`);
  c = c + appendBlock;
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Fresh Audit A-5 — agency-drift review UI ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchAdminJs(report);
  await patchOpsJs(report);
  await patchAppJs(report);
  await patchStylesCss(report);
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
