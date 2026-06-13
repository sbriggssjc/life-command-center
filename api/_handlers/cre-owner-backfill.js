// ============================================================================
// R15 Phase 2 — CRE owner backfill worker
// Life Command Center · sub-route of intake.js (?_route=cre-owner-backfill)
//
//   GET  /api/cre-owner-backfill   — dry-run (lists the eligible queue, no reads)
//   POST /api/cre-owner-backfill   — drain (fetch best doc → extract owner →
//                                    mint+link via the shared guarded path)
//
// Pulls N lcc_cre_properties WHERE owner_entity_id IS NULL that have ≥1 attached
// doc, reads each property's best owner-bearing doc (master > comp > bov > om),
// extracts a candidate owner name (xlsx label scan / PDF AI fallback), and mints
// the owner through the SAME guarded ensureEntityLink path the in-domain register
// uses — so junk/implausible cells never become an entity. A property that
// resolves an owner drops out of the queue; one that can't stays NULL for a later
// tick (idempotent, self-healing).
//
// Boundaries: reads CRE docs + writes CRE owners ONLY. dia/gov pipelines are not
// touched. No scoring/underwriting — Phase 2 adds the OWNER, nothing else.
//
// No new api/*.js — handler lives here, routed through intake.js.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { fetchSharepointBytes } from '../_shared/storage-adapter.js';
import {
  extractCreOwner,
  pickOwnerBearingDoc,
  orderOwnerBearingDocs,
  classifyOwnerDoc,
  debugLabelsForDoc,
} from '../_shared/cre-owner-extract.js';
import { ensureCreOwnerEntity, setCrePropertyOwner, markCreOwnerScanExhausted } from '../_shared/cre-registry.js';

// Fetch the eligible queue: null-owner CRE properties with ≥1 attached doc that
// have NOT been marked owner-scan-exhausted (so a master sheet that structurally
// carries no owner isn't re-fetched/re-scanned every tick — blocker 3).
// `!inner` forces the embed to an inner join so only doc-bearing rows return.
async function fetchEligible(limit) {
  const r = await opsQuery('GET',
    'lcc_cre_properties' +
    '?owner_entity_id=is.null' +
    '&metadata->>owner_scan_exhausted=is.null' +
    '&select=id,tenant_brand,city,state,source_path,metadata,lcc_cre_property_documents!inner(file_name,document_type,source_url)' +
    '&order=id.asc' +
    `&limit=${limit}`);
  if (!r.ok) return { ok: false, status: r.status, detail: r.data };
  const rows = (Array.isArray(r.data) ? r.data : []).map((row) => ({
    id: row.id,
    tenant_brand: row.tenant_brand,
    city: row.city,
    state: row.state,
    metadata: row.metadata || null,
    docs: Array.isArray(row.lcc_cre_property_documents) ? row.lcc_cre_property_documents : [],
  }));
  return { ok: true, rows };
}

/**
 * Backfill the owner for ONE CRE property. Deps injected for testability.
 *
 * Reads the property's owner-bearing docs in priority order (master > comp > bov
 * > om) and tries each until one yields a usable+accepted owner — so an OM/BOV
 * (which carries the seller/owner) is still reached when the dominant master
 * sheet structurally has no owner (blocker 3, case b). When EVERY doc is read but
 * none yields an owner (or all are guard-rejected, or none are readable), the
 * property is marked owner-scan-exhausted so it drops out of the queue (no
 * per-tick re-scan churn). A pure FETCH failure is transient — left un-marked to
 * retry next tick.
 *
 * deps:
 *   fetchBytes   (sourceUrl)                          => { ok, buffer, contentType, detail }
 *   extractOwner ({buffer,contentType,fileName,tenantBrand}) => { name, method }
 *   ensureOwner  (name, ctx)                          => { ok, entityId, reused, skipped }
 *   setOwner     (id, entityId, ctx)                  => { ok, patched }
 *   markExhausted(id, metadata, info)?                => { ok }   (optional)
 */
export async function backfillOneProperty(prop, deps) {
  const { fetchBytes, extractOwner, ensureOwner, setOwner, markExhausted } = deps;
  const docs = orderOwnerBearingDocs(prop.docs);
  if (!docs.length) {
    await markExhausted?.(prop.id, prop.metadata, { reason: 'no_readable_doc' });
    return { cre_property_id: prop.id, status: 'no_readable_doc' };
  }

  // tenantBrand is threaded to the mint boundary as a NEGATIVE signal — the
  // tenant is never the owner (R15 Phase 2c).
  const ctx = { workspaceId: prop.workspaceId, actorId: prop.actorId, tenantBrand: prop.tenant_brand };
  let sawRead = false;
  let lastRejected = null;
  let lastNoOwner = null;
  let lastFetchDetail = null;

  for (const doc of docs) {
    const fetched = await fetchBytes(doc.source_url).catch((e) => ({ ok: false, detail: e?.message }));
    if (!fetched?.ok || !fetched.buffer) {
      lastFetchDetail = fetched?.detail || null;
      continue; // transient — try the next doc
    }
    sawRead = true;

    const ext = await extractOwner({
      buffer: fetched.buffer, contentType: fetched.contentType,
      fileName: doc.file_name, tenantBrand: prop.tenant_brand,
    }).catch((e) => ({ name: null, method: 'extract_error', error: e?.message }));
    const name = ext?.name ? String(ext.name).trim() : null;
    if (!name) {
      lastNoOwner = { method: ext?.method || null, file_name: doc.file_name };
      continue; // no owner in this doc — fall through to the next
    }

    // Mint through the SHARED guarded path — junk / implausible-person / federal
    // anti-pattern is rejected here, so a bad cell never becomes an entity.
    const owner = await ensureOwner(name, ctx).catch((e) => ({ ok: false, skipped: e?.message }));
    if (!owner?.ok || !owner.entityId) {
      lastRejected = { skipped: owner?.skipped || null, owner_name: name, method: ext.method, file_name: doc.file_name };
      continue; // a later doc may carry a cleaner owner
    }

    const set = await setOwner(prop.id, owner.entityId, ctx).catch((e) => ({ ok: false, patched: false, detail: e?.message }));
    if (!set?.ok) {
      return { cre_property_id: prop.id, status: 'set_failed', owner_entity_id: owner.entityId, owner_name: name };
    }
    return {
      cre_property_id: prop.id,
      status: set.patched ? 'owner_set' : 'already_set',
      owner_entity_id: owner.entityId,
      owner_name: name,
      reused: !!owner.reused,
      reused_domain: owner.reused_domain || null,
      method: ext.method,
      file_name: doc.file_name,
    };
  }

  // No doc yielded a usable+accepted owner.
  if (lastRejected) {
    await markExhausted?.(prop.id, prop.metadata, { reason: 'owner_rejected', ...lastRejected });
    return { cre_property_id: prop.id, status: 'owner_rejected', ...lastRejected };
  }
  if (sawRead) {
    await markExhausted?.(prop.id, prop.metadata, { reason: 'no_owner_found', ...(lastNoOwner || {}) });
    return { cre_property_id: prop.id, status: 'no_owner_found', ...(lastNoOwner || {}) };
  }
  // Every doc failed to fetch → transient; don't mark exhausted (retry next tick).
  return { cre_property_id: prop.id, status: 'fetch_failed', detail: lastFetchDetail };
}

const PROD_DEPS = {
  fetchBytes: (sourceUrl) => fetchSharepointBytes({ storageRef: sourceUrl }),
  extractOwner: (a) => extractCreOwner(a),
  ensureOwner: (name, ctx) => ensureCreOwnerEntity(name, ctx),
  setOwner: (id, entityId, ctx) => setCrePropertyOwner(id, entityId, ctx),
  markExhausted: (id, metadata, info) => markCreOwnerScanExhausted(id, metadata, info),
};

export async function handleCreOwnerBackfill(req, res, deps = PROD_DEPS) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const debugLabels = dryRun && String(req.query.debug || '') === 'labels';
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '15', 10)));
  const tickBudgetMs = Math.max(5000, parseInt(process.env.CRE_OWNER_TICK_BUDGET_MS || '22000', 10));
  const workspaceId = req.query.workspace_id
    || req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID
    || null;
  const actorId = user.id || user.user_id || null;

  const eligible = await fetchEligible(limit);
  if (!eligible.ok) {
    return res.status(502).json({ error: 'list_failed', detail: eligible.detail });
  }

  // ---- Diagnostic: ?debug=labels (blocker 3) -------------------------------
  // Dump the non-empty cells / owner-label hits / scan verdict for a few real
  // master sheets so we can see whether the owner IS present under a missed
  // label (case a → extend the label set) or master sheets structurally carry
  // no owner (case b → already handled: the multi-doc fallback prefers OM/BOV
  // and the exhausted-marker stops the per-tick re-scan). Read-only; never mints.
  if (debugLabels) {
    const sample = Math.min(5, Math.max(1, parseInt(req.query.sample || '3', 10)));
    if (!process.env.SHAREPOINT_FETCH_URL) {
      return res.status(200).json({ mode: 'debug_labels', note: 'sharepoint_fetch_not_configured', eligible: eligible.rows.length });
    }
    const items = [];
    for (const prop of eligible.rows.slice(0, sample)) {
      // Prefer an xlsx (master/comp) doc — that is the layout we need to see.
      const xlsx = orderOwnerBearingDocs(prop.docs).find((d) => classifyOwnerDoc({ fileName: d.file_name }) === 'xlsx');
      const doc = xlsx || pickOwnerBearingDoc(prop.docs);
      if (!doc) { items.push({ cre_property_id: prop.id, note: 'no_readable_doc' }); continue; }
      const fetched = await deps.fetchBytes(doc.source_url).catch((e) => ({ ok: false, detail: e?.message }));
      if (!fetched?.ok || !fetched.buffer) {
        items.push({ cre_property_id: prop.id, file_name: doc.file_name, fetch_failed: true, detail: fetched?.detail || null });
        continue;
      }
      const dump = await debugLabelsForDoc({ buffer: fetched.buffer, contentType: fetched.contentType, fileName: doc.file_name })
        .catch((e) => ({ error: e?.message || 'debug_failed' }));
      items.push({ cre_property_id: prop.id, tenant_brand: prop.tenant_brand, file_name: doc.file_name, document_type: doc.document_type, ...dump });
    }
    return res.status(200).json({ mode: 'debug_labels', eligible: eligible.rows.length, sampled: items.length, items });
  }

  const result = {
    mode: dryRun ? 'dry_run' : 'drain',
    eligible: eligible.rows.length,
    scanned: 0,
    owner_set: 0,
    already_set: 0,
    owner_rejected: 0,
    no_owner_found: 0,
    no_readable_doc: 0,
    fetch_failed: 0,
    set_failed: 0,
    items: [],
  };

  if (dryRun) {
    // No byte fetch / AI on a GET probe — just report what WOULD be read.
    for (const prop of eligible.rows) {
      const doc = pickOwnerBearingDoc(prop.docs);
      result.items.push({
        cre_property_id: prop.id,
        tenant_brand: prop.tenant_brand,
        doc: doc ? { file_name: doc.file_name, document_type: doc.document_type } : null,
      });
    }
    return res.status(200).json(result);
  }

  // Drain needs to read SharePoint bytes. Without the Get flow it can't extract
  // an owner — return cleanly (graceful no-op), the same posture as the rest of
  // the folder-feed channel.
  if (!process.env.SHAREPOINT_FETCH_URL) {
    return res.status(200).json({ ...result, note: 'sharepoint_fetch_not_configured' });
  }

  const deadline = Date.now() + tickBudgetMs;
  for (const prop of eligible.rows) {
    if (Date.now() > deadline) break;
    prop.workspaceId = workspaceId;
    prop.actorId = actorId;
    const r = await backfillOneProperty(prop, deps);
    result.scanned++;
    if (Object.prototype.hasOwnProperty.call(result, r.status)) result[r.status]++;
    result.items.push(r);
  }

  return res.status(200).json(result);
}
