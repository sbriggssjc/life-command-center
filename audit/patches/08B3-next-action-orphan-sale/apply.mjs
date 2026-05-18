#!/usr/bin/env node
// ============================================================================
// LCC Item #8 Phase B-3 — next-action dispatcher: orphan_sale_owner handler.
//
// Single-row version of the A-1 bulk backfill. When a property's top NBA
// gap is orphan_sale_owner, the sticky bar's button now reads
// "Backlink sale →" and one-click resolves by attributing the sale to
// the property's current recorded_owner — but ONLY when the sale is the
// most-recent for its property (same safety guarantee as A-1).
//
// Endpoint:  POST /api/admin?_route=resolve-orphan-sale
//   Body: { sale_id, property_id, domain: 'government'|'dialysis' }
//   1. Verify sale_id is the most-recent sale for property_id (rank=1).
//      If not, returns 409 with the actual most-recent sale_id so the
//      caller can surface "this is a historical sale" properly.
//   2. Fetch properties.recorded_owner_id. If NULL, returns 409 ("no
//      owner to attribute from").
//   3. PATCH the sale with recorded_owner_id + updated_at.
//   Labeled 'resolveOrphanSale' so the write surfaces correctly in
//   ingest_write_failures.
//
// Remaining gap counts after the A-1 backfill:
//   gov orphan_sale_owner NBA: 1,029  (was 2,373)
//   dia orphan_sale_owner NBA:    31  (was   283)
//
// Branch: audit/08B3-next-action-orphan-sale
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

// ─── api/admin.js: new sub-route + handler ───
async function patchAdminJs(report) {
  const path = resolve(REPO_ROOT, 'api', 'admin.js');
  if (!await fileExists(path)) throw new Error('api/admin.js not found.');

  await replaceUnique(path,
    `    case 'agency-drift-queue':      return handleAgencyDriftQueueList(req, res);
    case 'resolve-agency-drift':    return handleResolveAgencyDrift(req, res);
    case 'write-failures-rollup':   return handleWriteFailuresRollup(req, res);
    default:`,
    `    case 'agency-drift-queue':      return handleAgencyDriftQueueList(req, res);
    case 'resolve-agency-drift':    return handleResolveAgencyDrift(req, res);
    case 'write-failures-rollup':   return handleWriteFailuresRollup(req, res);
    case 'resolve-orphan-sale':     return handleResolveOrphanSale(req, res);
    default:`,
    report, 'api/admin.js (dispatcher case for resolve-orphan-sale)');

  // Add the handler. Anchor right before the local stripNulls helper.
  await replaceUnique(path,
    `// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    `// ============================================================================
// RESOLVE ORPHAN SALE — Item #8 Phase B-3 (2026-05-18)
//
// POST /api/admin?_route=resolve-orphan-sale
//   Body: { sale_id, property_id, domain: 'government'|'dialysis' }
//
// Single-row version of the A-1 bulk backfill. Attributes one specific
// orphan sale to its property's current recorded_owner_id, BUT only when
// the sale is the most-recent for its property (same safety check as A-1).
//
// Earlier sales need ownership_history resolution and are out of scope —
// returns 409 with the actual most-recent sale_id so the UI can explain
// why the attribution was refused.
// ============================================================================
async function handleResolveOrphanSale(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;

  const body = req.body || {};
  const saleId     = body.sale_id;
  const propertyId = Number(body.property_id);
  const domain     = String(body.domain || '').toLowerCase();
  if (!saleId)                     return res.status(400).json({ error: 'sale_id required' });
  if (!Number.isFinite(propertyId)) return res.status(400).json({ error: 'property_id (number) required' });
  if (!['government', 'dialysis'].includes(domain)) {
    return res.status(400).json({ error: "domain must be 'government' or 'dialysis'" });
  }

  try {
    const { domainQuery } = await import('./_shared/domain-db.js');

    // 1. Find the most-recent sale for this property. Order by sale_date
    //    DESC NULLS LAST, then sale_id DESC as a deterministic tiebreaker
    //    (matches the A-1 ordering).
    const rankRes = await domainQuery(domain, 'GET',
      'sales_transactions?property_id=eq.' + propertyId +
      '&order=sale_date.desc.nullslast,sale_id.desc' +
      '&select=sale_id&limit=1'
    );
    if (!rankRes.ok || !rankRes.data?.length) {
      return res.status(404).json({ error: 'no sales for this property' });
    }
    const mostRecentId = rankRes.data[0].sale_id;
    if (String(mostRecentId) !== String(saleId)) {
      return res.status(409).json({
        error: 'not_most_recent_sale',
        message: 'Earlier sales need ownership_history resolution. Only the most-recent sale per property can be auto-backlinked.',
        most_recent_sale_id: mostRecentId,
      });
    }

    // 2. Fetch the property's current recorded_owner_id.
    const propRes = await domainQuery(domain, 'GET',
      'properties?property_id=eq.' + propertyId + '&select=recorded_owner_id,recorded_owner_name&limit=1'
    );
    if (!propRes.ok || !propRes.data?.length) {
      return res.status(404).json({ error: 'property not found' });
    }
    const ownerId = propRes.data[0].recorded_owner_id;
    const ownerName = propRes.data[0].recorded_owner_name;
    if (!ownerId) {
      return res.status(409).json({
        error: 'no_owner_to_attribute',
        message: 'Property has no recorded_owner_id yet. Resolve missing_recorded_owner first.',
      });
    }

    // 3. PATCH the sale.
    const r = await domainQuery(domain, 'PATCH',
      'sales_transactions?sale_id=eq.' + encodeURIComponent(saleId),
      { recorded_owner_id: ownerId, updated_at: new Date().toISOString() },
      undefined, { label: 'resolveOrphanSale' });
    if (!r.ok) return res.status(502).json({ error: 'update_failed', detail: r.data });

    return res.status(200).json({
      ok: true, sale_id: saleId, property_id: propertyId,
      recorded_owner_id: ownerId, recorded_owner_name: ownerName || null,
    });
  } catch (err) {
    console.error('[resolve-orphan-sale]', err?.message || err);
    return res.status(500).json({ error: 'resolve_failed', message: err?.message });
  }
}

// Local stripNulls — admin.js doesn't import the sidebar-pipeline version
// to avoid pulling its full dependency tree just for one helper.
function stripNullsLocal(obj) {`,
    report, 'api/admin.js (handleResolveOrphanSale)');
}

// ─── detail.js: extend dispatcher for orphan_sale_owner ───
async function patchDetailJs(report) {
  const path = resolve(REPO_ROOT, 'detail.js');
  if (!await fileExists(path)) throw new Error('detail.js not found.');

  // 1. Extend dispatch-spec helper with the orphan_sale_owner case.
  await replaceUnique(path,
    `  // Item #8 Phase B-2 (2026-05-18): agency_drift gap_types get an
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
    `  // Item #8 Phase B-2 (2026-05-18): agency_drift gap_types get an
  // inline "Use lease value" PATCH workflow.
  if (t === 'agency_drift:agency_disagreement') {
    return { label: 'Use lease value →', metaSuffix: 'patches properties.agency from active lease' };
  }
  if (t === 'agency_drift:lease_agency_but_property_agency_null') {
    return { label: 'Fill from lease →', metaSuffix: 'fills properties.agency from active lease' };
  }
  // Item #8 Phase B-3 (2026-05-18): orphan_sale_owner — one-click backlink
  // of the most-recent sale to the property's current recorded_owner.
  if (t === 'orphan_sale_owner') {
    return { label: 'Backlink sale →', metaSuffix: "attributes sale to property's current owner" };
  }
  // Other gap types: existing tab-switch UX
  return { label: 'Take action →', metaSuffix: 'opens ' + _udNextActionTabForGap(t) };
}`,
    report, 'detail.js (B-3: dispatch-spec helper for orphan_sale_owner)');

  // 2. Extend the click handler with the orphan_sale_owner branch.
  //    Insert BEFORE the agency_drift branch's "return" so handlers stack.
  await replaceUnique(path,
    `  // Item #8 Phase B-2 (2026-05-18): agency_drift gap_types route to a
  // one-click "Use lease value" PATCH that reuses the resolve endpoint
  // from #A-5.
  if (t === 'agency_drift:agency_disagreement' || t === 'agency_drift:lease_agency_but_property_agency_null') {
    _udNextActionResolveAgencyDrift(gapType).catch(e => console.warn('[NextAction] agency_drift resolve failed:', e?.message));
    return;
  }

  // Default: switch to the tab where this gap lives.`,
    `  // Item #8 Phase B-2 (2026-05-18): agency_drift gap_types route to a
  // one-click "Use lease value" PATCH that reuses the resolve endpoint
  // from #A-5.
  if (t === 'agency_drift:agency_disagreement' || t === 'agency_drift:lease_agency_but_property_agency_null') {
    _udNextActionResolveAgencyDrift(gapType).catch(e => console.warn('[NextAction] agency_drift resolve failed:', e?.message));
    return;
  }

  // Item #8 Phase B-3 (2026-05-18): orphan_sale_owner — single-row
  // version of the A-1 bulk backfill. Safety: server-side checks that
  // sale is the most-recent for its property before PATCHing.
  if (t === 'orphan_sale_owner') {
    _udNextActionResolveOrphanSale().catch(e => console.warn('[NextAction] orphan_sale resolve failed:', e?.message));
    return;
  }

  // Default: switch to the tab where this gap lives.`,
    report, 'detail.js (B-3: click handler orphan_sale dispatch)');

  // 3. Add the resolve helper. Anchor right after the agency_drift helper.
  await replaceUnique(path,
    `window._udNextActionResolveAgencyDrift = _udNextActionResolveAgencyDrift;`,
    `window._udNextActionResolveAgencyDrift = _udNextActionResolveAgencyDrift;

// Item #8 Phase B-3 (2026-05-18): single-row version of the A-1 bulk
// orphan-sale backfill. Triggered from the next-action bar when the top
// gap is orphan_sale_owner.
async function _udNextActionResolveOrphanSale() {
  const prop = (_udCache && _udCache.property) || {};
  const next = (_udCache && _udCache.nextAction) || {};
  const propertyId = Number(prop.property_id);
  // gap_pk for orphan_sale_owner IS the sale_id (text-form per the view).
  const saleId = next.gap_pk || null;
  const domain = _udCache && _udCache.db === 'dia' ? 'dialysis' :
                 (_udCache && _udCache.db === 'gov' ? 'government' : null);

  if (!Number.isFinite(propertyId) || !saleId || !domain) {
    if (typeof showToast === 'function') showToast('Missing property_id / sale_id / domain', 'error');
    return;
  }

  let confirmed = true;
  if (typeof asyncConfirm === 'function') {
    confirmed = await asyncConfirm("Backlink this sale to the property's current recorded_owner? Only works for the most-recent sale per property; earlier sales need ownership_history resolution.");
  }
  if (!confirmed) return;

  const headers = { 'Content-Type': 'application/json' };
  if (LCC_USER.workspace_id) headers['x-lcc-workspace'] = LCC_USER.workspace_id;
  try {
    const res = await fetch('/api/admin?_route=resolve-orphan-sale', {
      method: 'POST', headers,
      body: JSON.stringify({ sale_id: saleId, property_id: propertyId, domain }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (payload && payload.error === 'not_most_recent_sale') {
        if (typeof showToast === 'function') {
          showToast('Earlier sale — needs ownership_history resolution (most-recent sale_id: ' + payload.most_recent_sale_id + ')', 'warn');
        }
      } else if (payload && payload.error === 'no_owner_to_attribute') {
        if (typeof showToast === 'function') {
          showToast('Property has no recorded_owner yet — resolve missing_recorded_owner first', 'warn');
        }
      } else {
        throw new Error('HTTP ' + res.status);
      }
      return;
    }
    if (typeof showToast === 'function') showToast('Sale backlinked to owner', 'ok');
  } catch (e) {
    if (typeof lccReportError === 'function') lccReportError('Resolve orphan sale from bar', e);
    return;
  }

  // Hide the bar; the gap is resolved.
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
window._udNextActionResolveOrphanSale = _udNextActionResolveOrphanSale;`,
    report, 'detail.js (B-3: _udNextActionResolveOrphanSale helper)');
}

// ─── AUDIT_PROGRESS.md ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  // NOTE: avoid triple-backtick markdown fences inside this template literal
  // — they were the source of the syntax error in B-2 the first time.
  const appendBlock = N(`

## Closeout — item 8 Phase B-3 ✅ — next-action dispatcher: orphan_sale_owner
- **Status:** ✅ DONE.
- **Branch:** \`audit/08B3-next-action-orphan-sale\`
- **Patch:** \`audit/patches/08B3-next-action-orphan-sale/apply.mjs\`

### What this adds
Single-row version of the A-1 bulk orphan-sale backfill, wired to the sticky next-action bar. When a property's top NBA gap is \`orphan_sale_owner\`, the bar's CTA reads "Backlink sale →" instead of "Take action →". Click → confirm → PATCH → toast → bar hides.

Safety mirrors A-1: the new admin endpoint verifies that the sale_id is the most-recent for its property before PATCHing. If not, returns 409 with the actual most-recent sale_id so the UI can explain why ("Earlier sale — needs ownership_history resolution; most-recent sale_id: X"). Also returns a friendly error if the property has no \`recorded_owner_id\` yet (resolve \`missing_recorded_owner\` first).

### New endpoint
\`POST /api/admin?_route=resolve-orphan-sale\` with body \`{ sale_id, property_id, domain }\`. Labeled \`resolveOrphanSale\` for telemetry.

### Remaining gap counts (after A-1)
- gov \`orphan_sale_owner\` NBA: 1,029
- dia \`orphan_sale_owner\` NBA: 31

Each row can now be closed in 2 clicks from the property's detail panel as Scott navigates the NBA queue.

### Files changed
- \`api/admin.js\` — dispatcher case + \`handleResolveOrphanSale\` handler
- \`detail.js\` — 3 anchored edits (dispatch spec, click branch, resolve helper)
- \`AUDIT_PROGRESS.md\` — this closeout

### Per-action dispatcher coverage after this patch
- missing_recorded_owner → "Open SoS →" (B)
- llc_research_pending → "Open SoS →" (B)
- agency_drift:agency_disagreement → "Use lease value →" (B-2)
- agency_drift:lease_agency_but_property_agency_null → "Fill from lease →" (B-2)
- **orphan_sale_owner → "Backlink sale →"** (B-3, this patch)
- lease_tenant_drift → "Take action →" (tab-switch, candidate for B-4)
- stale_active_listing → "Take action →" (tab-switch)
- cms_chain_drift:* → "Take action →" (tab-switch, candidate for B-4)

`);
  c = c + appendBlock;
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Item #8 Phase B-3 — next-action dispatcher: orphan_sale_owner ===');
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
