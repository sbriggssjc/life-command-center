#!/usr/bin/env node
// ============================================================================
// LCC Item #8 Phase B-4 — next-action dispatcher: tenant_drift handlers.
//
// Two more one-click PATCH branches on the sticky next-action bar (dia-only):
//
//   lease_tenant_drift (3,544 NBA rows)
//     "Use lease tenant →"
//     1. Fetch lease_tenant from v_gap_lease_tenant_drift for property.
//     2. asyncConfirm with the proposed value.
//     3. POST /api/admin?_route=resolve-lease-tenant-drift
//        → PATCH properties.tenant = lease_tenant.
//
//   cms_chain_drift:cms_chain_but_property_tenant_null (40 NBA rows)
//     "Use CMS chain →"
//     1. Fetch cms_chain from v_gap_chain_drift for property.
//     2. asyncConfirm.
//     3. POST /api/admin?_route=resolve-cms-chain-drift
//        → PATCH properties.tenant = cms_chain.
//
//   cms_chain_drift:operator_transition_candidate
//     Stays as tab-switch — that variant is judgment-heavy
//     ("verify operator transition: property says X, CMS says Y") and
//     needs human review, not a one-click PATCH.
//
// Both endpoints labeled for ingest_write_failures telemetry hygiene.
//
// Branch: audit/08B4-next-action-tenant-drift
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

// ─── api/admin.js: 2 new sub-routes + 2 handlers ───
async function patchAdminJs(report) {
  const path = resolve(REPO_ROOT, 'api', 'admin.js');
  if (!await fileExists(path)) throw new Error('api/admin.js not found.');

  await replaceUnique(path,
    `    case 'resolve-orphan-sale':     return handleResolveOrphanSale(req, res);
    default:`,
    `    case 'resolve-orphan-sale':     return handleResolveOrphanSale(req, res);
    case 'resolve-lease-tenant-drift': return handleResolveLeaseTenantDrift(req, res);
    case 'resolve-cms-chain-drift':    return handleResolveCmsChainDrift(req, res);
    default:`,
    report, 'api/admin.js (dispatcher cases for tenant-drift)');

  // Add both handlers. Anchor before stripNullsLocal.
  await replaceUnique(path,
    `// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    `// ============================================================================
// RESOLVE LEASE-TENANT DRIFT — Item #8 Phase B-4 (2026-05-18, dia-only)
//
// POST /api/admin?_route=resolve-lease-tenant-drift
//   Body: { property_id }
//   Looks up v_gap_lease_tenant_drift for the property to fetch
//   lease_tenant, then PATCHes dia.properties.tenant = lease_tenant.
// ============================================================================
async function handleResolveLeaseTenantDrift(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const propertyId = Number((req.body || {}).property_id);
  if (!Number.isFinite(propertyId)) return res.status(400).json({ error: 'property_id (number) required' });

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    const driftRes = await domainQuery('dialysis', 'GET',
      'v_gap_lease_tenant_drift?property_id=eq.' + propertyId +
      '&select=property_id,lease_tenant,prop_tenant&limit=1'
    );
    if (!driftRes.ok || !driftRes.data?.length) {
      return res.status(404).json({ error: 'no_active_drift', message: 'No active lease-tenant drift row for this property' });
    }
    const leaseTenant = (driftRes.data[0].lease_tenant || '').trim();
    if (!leaseTenant) {
      return res.status(409).json({ error: 'no_lease_tenant', message: 'Lease has no tenant to apply' });
    }
    const r = await domainQuery('dialysis', 'PATCH',
      'properties?property_id=eq.' + propertyId,
      { tenant: leaseTenant, updated_at: new Date().toISOString() },
      undefined, { label: 'resolveLeaseTenantDrift' });
    if (!r.ok) return res.status(502).json({ error: 'update_failed', detail: r.data });
    return res.status(200).json({ ok: true, property_id: propertyId, tenant: leaseTenant });
  } catch (err) {
    console.error('[resolve-lease-tenant-drift]', err?.message || err);
    return res.status(500).json({ error: 'resolve_failed', message: err?.message });
  }
}

// ============================================================================
// RESOLVE CMS CHAIN DRIFT — Item #8 Phase B-4 (2026-05-18, dia-only)
//
// POST /api/admin?_route=resolve-cms-chain-drift
//   Body: { property_id }
//   Only handles the 'cms_chain_but_property_tenant_null' drift_kind.
//   Looks up v_gap_chain_drift for the property, fetches cms_chain,
//   and PATCHes dia.properties.tenant = cms_chain.
//   The 'operator_transition_candidate' variant is NOT auto-resolvable
//   (needs human judgment between competing tenant values).
// ============================================================================
async function handleResolveCmsChainDrift(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const propertyId = Number((req.body || {}).property_id);
  if (!Number.isFinite(propertyId)) return res.status(400).json({ error: 'property_id (number) required' });

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');
    const driftRes = await domainQuery('dialysis', 'GET',
      'v_gap_chain_drift?property_id=eq.' + propertyId +
      '&drift_kind=eq.cms_chain_but_property_tenant_null' +
      '&select=property_id,cms_chain,prop_tenant,drift_kind&limit=1'
    );
    if (!driftRes.ok || !driftRes.data?.length) {
      return res.status(404).json({ error: 'no_active_drift', message: 'No cms_chain_but_property_tenant_null drift for this property (operator_transition_candidate is not auto-resolvable)' });
    }
    const cmsChain = (driftRes.data[0].cms_chain || '').trim();
    if (!cmsChain) {
      return res.status(409).json({ error: 'no_cms_chain', message: 'CMS chain has no value to apply' });
    }
    const r = await domainQuery('dialysis', 'PATCH',
      'properties?property_id=eq.' + propertyId,
      { tenant: cmsChain, updated_at: new Date().toISOString() },
      undefined, { label: 'resolveCmsChainDrift' });
    if (!r.ok) return res.status(502).json({ error: 'update_failed', detail: r.data });
    return res.status(200).json({ ok: true, property_id: propertyId, tenant: cmsChain });
  } catch (err) {
    console.error('[resolve-cms-chain-drift]', err?.message || err);
    return res.status(500).json({ error: 'resolve_failed', message: err?.message });
  }
}

// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    report, 'api/admin.js (tenant-drift handlers)');
}

// ─── detail.js: extend dispatcher for 2 more gap types ───
async function patchDetailJs(report) {
  const path = resolve(REPO_ROOT, 'detail.js');
  if (!await fileExists(path)) throw new Error('detail.js not found.');

  // 1. Extend dispatch-spec helper.
  await replaceUnique(path,
    `  // Item #8 Phase B-3 (2026-05-18): orphan_sale_owner — one-click backlink
  // of the most-recent sale to the property's current recorded_owner.
  if (t === 'orphan_sale_owner') {
    return { label: 'Backlink sale →', metaSuffix: "attributes sale to property's current owner" };
  }
  // Other gap types: existing tab-switch UX
  return { label: 'Take action →', metaSuffix: 'opens ' + _udNextActionTabForGap(t) };
}`,
    `  // Item #8 Phase B-3 (2026-05-18): orphan_sale_owner — one-click backlink
  // of the most-recent sale to the property's current recorded_owner.
  if (t === 'orphan_sale_owner') {
    return { label: 'Backlink sale →', metaSuffix: "attributes sale to property's current owner" };
  }
  // Item #8 Phase B-4 (2026-05-18): tenant_drift one-click PATCHes (dia-only).
  // lease_tenant_drift: properties.tenant := lease_tenant
  // cms_chain_drift:cms_chain_but_property_tenant_null: properties.tenant := cms_chain
  if (t === 'lease_tenant_drift') {
    return { label: 'Use lease tenant →', metaSuffix: 'patches properties.tenant from active lease' };
  }
  if (t === 'cms_chain_drift:cms_chain_but_property_tenant_null') {
    return { label: 'Use CMS chain →', metaSuffix: 'fills properties.tenant from CMS chain' };
  }
  // cms_chain_drift:operator_transition_candidate stays as tab-switch —
  // it's a judgment call between property tenant and CMS chain.
  // Other gap types: existing tab-switch UX
  return { label: 'Take action →', metaSuffix: 'opens ' + _udNextActionTabForGap(t) };
}`,
    report, 'detail.js (B-4: dispatch-spec helper for tenant_drift)');

  // 2. Extend click handler.
  await replaceUnique(path,
    `  // Item #8 Phase B-3 (2026-05-18): orphan_sale_owner — single-row
  // version of the A-1 bulk backfill. Safety: server-side checks that
  // sale is the most-recent for its property before PATCHing.
  if (t === 'orphan_sale_owner') {
    _udNextActionResolveOrphanSale().catch(e => console.warn('[NextAction] orphan_sale resolve failed:', e?.message));
    return;
  }

  // Default: switch to the tab where this gap lives.`,
    `  // Item #8 Phase B-3 (2026-05-18): orphan_sale_owner — single-row
  // version of the A-1 bulk backfill. Safety: server-side checks that
  // sale is the most-recent for its property before PATCHing.
  if (t === 'orphan_sale_owner') {
    _udNextActionResolveOrphanSale().catch(e => console.warn('[NextAction] orphan_sale resolve failed:', e?.message));
    return;
  }

  // Item #8 Phase B-4 (2026-05-18): tenant_drift handlers (dia-only).
  if (t === 'lease_tenant_drift') {
    _udNextActionResolveLeaseTenantDrift().catch(e => console.warn('[NextAction] lease_tenant resolve failed:', e?.message));
    return;
  }
  if (t === 'cms_chain_drift:cms_chain_but_property_tenant_null') {
    _udNextActionResolveCmsChainDrift().catch(e => console.warn('[NextAction] cms_chain resolve failed:', e?.message));
    return;
  }
  // cms_chain_drift:operator_transition_candidate falls through to tab-switch.

  // Default: switch to the tab where this gap lives.`,
    report, 'detail.js (B-4: click handler tenant_drift dispatch)');

  // 3. Add the two resolve helpers. Anchor right after the orphan_sale helper.
  await replaceUnique(path,
    `window._udNextActionResolveOrphanSale = _udNextActionResolveOrphanSale;`,
    `window._udNextActionResolveOrphanSale = _udNextActionResolveOrphanSale;

// Item #8 Phase B-4 (2026-05-18): lease_tenant_drift resolver (dia-only).
// Fetches lease_tenant from v_gap_lease_tenant_drift, confirms with user,
// POSTs to /api/admin?_route=resolve-lease-tenant-drift, hides the bar.
async function _udNextActionResolveLeaseTenantDrift() {
  const prop = (_udCache && _udCache.property) || {};
  const propertyId = Number(prop.property_id);
  if (!Number.isFinite(propertyId)) {
    if (typeof showToast === 'function') showToast('Missing property_id', 'error');
    return;
  }
  if (_udCache.db !== 'dia') {
    if (typeof showToast === 'function') showToast('Lease-tenant drift only applies to dia properties', 'warn');
    return;
  }

  // Fetch the lease_tenant for this property to preview in the confirm.
  let leaseTenant = null;
  try {
    const r = await diaQuery('v_gap_lease_tenant_drift', '*', {
      filter: 'property_id=eq.' + propertyId,
      limit: 1,
    });
    const rows = Array.isArray(r) ? r : (r?.data || []);
    if (rows.length) leaseTenant = (rows[0].lease_tenant || '').trim();
  } catch (e) {
    if (typeof lccReportError === 'function') lccReportError('Fetch lease-tenant drift row', e);
    return;
  }
  if (!leaseTenant) {
    if (typeof showToast === 'function') showToast('Lease has no tenant to apply', 'warn');
    return;
  }

  let confirmed = true;
  if (typeof asyncConfirm === 'function') {
    confirmed = await asyncConfirm('Set properties.tenant to "' + leaseTenant + '" from the active lease?');
  }
  if (!confirmed) return;

  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
  try {
    const res = await fetch('/api/admin?_route=resolve-lease-tenant-drift', {
      method: 'POST', headers,
      body: JSON.stringify({ property_id: propertyId }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (typeof showToast === 'function') showToast('Updated tenant from lease', 'ok');
  } catch (e) {
    if (typeof lccReportError === 'function') lccReportError('Resolve lease-tenant drift', e);
    return;
  }
  if (_udCache) {
    _udCache.nextAction = null;
    _setUdCache(_udCache);
  }
  const bar = document.getElementById('detailNextActionBar');
  if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
}
window._udNextActionResolveLeaseTenantDrift = _udNextActionResolveLeaseTenantDrift;

// Item #8 Phase B-4 (2026-05-18): cms_chain_drift resolver for the
// 'cms_chain_but_property_tenant_null' variant only (dia-only).
async function _udNextActionResolveCmsChainDrift() {
  const prop = (_udCache && _udCache.property) || {};
  const propertyId = Number(prop.property_id);
  if (!Number.isFinite(propertyId)) {
    if (typeof showToast === 'function') showToast('Missing property_id', 'error');
    return;
  }
  if (_udCache.db !== 'dia') {
    if (typeof showToast === 'function') showToast('CMS chain drift only applies to dia properties', 'warn');
    return;
  }

  let cmsChain = null;
  try {
    const r = await diaQuery('v_gap_chain_drift', '*', {
      filter: 'property_id=eq.' + propertyId + '&drift_kind=eq.cms_chain_but_property_tenant_null',
      limit: 1,
    });
    const rows = Array.isArray(r) ? r : (r?.data || []);
    if (rows.length) cmsChain = (rows[0].cms_chain || '').trim();
  } catch (e) {
    if (typeof lccReportError === 'function') lccReportError('Fetch cms-chain drift row', e);
    return;
  }
  if (!cmsChain) {
    if (typeof showToast === 'function') showToast('No CMS chain value to apply (or this is the operator_transition_candidate variant — needs manual review)', 'warn');
    return;
  }

  let confirmed = true;
  if (typeof asyncConfirm === 'function') {
    confirmed = await asyncConfirm('Set properties.tenant to "' + cmsChain + '" from CMS chain?');
  }
  if (!confirmed) return;

  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
  try {
    const res = await fetch('/api/admin?_route=resolve-cms-chain-drift', {
      method: 'POST', headers,
      body: JSON.stringify({ property_id: propertyId }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (typeof showToast === 'function') showToast('Updated tenant from CMS chain', 'ok');
  } catch (e) {
    if (typeof lccReportError === 'function') lccReportError('Resolve cms-chain drift', e);
    return;
  }
  if (_udCache) {
    _udCache.nextAction = null;
    _setUdCache(_udCache);
  }
  const bar = document.getElementById('detailNextActionBar');
  if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
}
window._udNextActionResolveCmsChainDrift = _udNextActionResolveCmsChainDrift;`,
    report, 'detail.js (B-4: tenant-drift resolve helpers)');
}

// ─── AUDIT_PROGRESS.md ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  // NOTE: avoid triple-backtick markdown fences inside this template literal.
  const appendBlock = N(`

## Closeout — item 8 Phase B-4 ✅ — tenant_drift handlers
- **Status:** ✅ DONE.
- **Branch:** \`audit/08B4-next-action-tenant-drift\`
- **Patch:** \`audit/patches/08B4-next-action-tenant-drift/apply.mjs\`

### What this adds
Two more one-click PATCH branches on the sticky next-action bar (dia-only). Both write to \`dia.properties.tenant\` from an authoritative source:

- **\`lease_tenant_drift\`** (3,544 NBA rows) → "Use lease tenant →" — pulls \`lease_tenant\` from \`v_gap_lease_tenant_drift\` and PATCHes \`properties.tenant\`.
- **\`cms_chain_drift:cms_chain_but_property_tenant_null\`** (40 NBA rows) → "Use CMS chain →" — pulls \`cms_chain\` from \`v_gap_chain_drift\` and PATCHes \`properties.tenant\`.

The \`cms_chain_drift:operator_transition_candidate\` variant (~2,522 rows) STAYS as tab-switch — that one's a judgment call between two competing tenant values (property says X, CMS says Y) and shouldn't be auto-resolved.

### New endpoints
- \`POST /api/admin?_route=resolve-lease-tenant-drift\` body \`{ property_id }\`. Label: \`resolveLeaseTenantDrift\`.
- \`POST /api/admin?_route=resolve-cms-chain-drift\` body \`{ property_id }\`. Filters server-side on \`drift_kind=cms_chain_but_property_tenant_null\` so accidental calls on the transition variant return 404. Label: \`resolveCmsChainDrift\`.

### Files changed
- \`api/admin.js\` — dispatcher cases + 2 new handlers
- \`detail.js\` — dispatch-spec helper extension + 2 click branches + 2 resolve helpers
- \`AUDIT_PROGRESS.md\` — this closeout

### Per-action dispatcher coverage after this patch
- missing_recorded_owner → "Open SoS →" (B)
- llc_research_pending → "Open SoS →" (B)
- agency_drift:agency_disagreement → "Use lease value →" (B-2)
- agency_drift:lease_agency_but_property_agency_null → "Fill from lease →" (B-2)
- orphan_sale_owner → "Backlink sale →" (B-3)
- **lease_tenant_drift → "Use lease tenant →"** (B-4, this patch)
- **cms_chain_drift:cms_chain_but_property_tenant_null → "Use CMS chain →"** (B-4, this patch)
- cms_chain_drift:operator_transition_candidate → "Take action →" (tab-switch, intentional)
- stale_active_listing → "Take action →" (tab-switch)

### Auto-resolvable gap coverage by domain (after this patch)
- **dia**: missing_recorded_owner (SoS open) + llc_research_pending (SoS open) + orphan_sale_owner (backlink) + lease_tenant_drift (PATCH) + cms_chain_drift:null_tenant (PATCH) = 5 of 6 dia gap types one-click resolvable. Only operator_transition_candidate stays as tab-switch.
- **gov**: missing_recorded_owner (SoS open) + llc_research_pending (SoS open) + agency_drift:* (PATCH × 2) + orphan_sale_owner (backlink) = 5 of 5 gov gap types covered. Stale_active_listing stays as tab-switch (the "re-verify" action is judgment-heavy).

`);
  c = c + appendBlock;
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Item #8 Phase B-4 — next-action dispatcher: tenant_drift ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchAdminJs(report);
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
