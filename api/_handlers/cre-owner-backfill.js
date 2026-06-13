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
import { extractCreOwner, pickOwnerBearingDoc } from '../_shared/cre-owner-extract.js';
import { ensureCreOwnerEntity, setCrePropertyOwner } from '../_shared/cre-registry.js';

// Fetch the eligible queue: null-owner CRE properties with ≥1 attached doc.
// `!inner` forces the embed to an inner join so only doc-bearing rows return.
async function fetchEligible(limit) {
  const r = await opsQuery('GET',
    'lcc_cre_properties' +
    '?owner_entity_id=is.null' +
    '&select=id,tenant_brand,city,state,source_path,lcc_cre_property_documents!inner(file_name,document_type,source_url)' +
    '&order=id.asc' +
    `&limit=${limit}`);
  if (!r.ok) return { ok: false, status: r.status, detail: r.data };
  const rows = (Array.isArray(r.data) ? r.data : []).map((row) => ({
    id: row.id,
    tenant_brand: row.tenant_brand,
    city: row.city,
    state: row.state,
    docs: Array.isArray(row.lcc_cre_property_documents) ? row.lcc_cre_property_documents : [],
  }));
  return { ok: true, rows };
}

/**
 * Backfill the owner for ONE CRE property. Deps injected for testability.
 *
 * deps:
 *   fetchBytes   (sourceUrl)            => { ok, buffer, contentType, detail }
 *   extractOwner ({buffer,contentType,fileName}) => { name, method }
 *   ensureOwner  (name, ctx)            => { ok, entityId, skipped }
 *   setOwner     (id, entityId, ctx)    => { ok, patched }
 */
export async function backfillOneProperty(prop, deps) {
  const { fetchBytes, extractOwner, ensureOwner, setOwner } = deps;
  const doc = pickOwnerBearingDoc(prop.docs);
  if (!doc) return { cre_property_id: prop.id, status: 'no_readable_doc' };

  const fetched = await fetchBytes(doc.source_url).catch((e) => ({ ok: false, detail: e?.message }));
  if (!fetched?.ok || !fetched.buffer) {
    return { cre_property_id: prop.id, status: 'fetch_failed', detail: fetched?.detail || null, file_name: doc.file_name };
  }

  const ext = await extractOwner({ buffer: fetched.buffer, contentType: fetched.contentType, fileName: doc.file_name })
    .catch((e) => ({ name: null, method: 'extract_error', error: e?.message }));
  const name = ext?.name ? String(ext.name).trim() : null;
  if (!name) {
    return { cre_property_id: prop.id, status: 'no_owner_found', method: ext?.method || null, file_name: doc.file_name };
  }

  // Mint through the SHARED guarded path — junk / implausible-person / federal
  // anti-pattern is rejected here, so a bad cell never becomes an entity.
  const owner = await ensureOwner(name, { workspaceId: prop.workspaceId, actorId: prop.actorId })
    .catch((e) => ({ ok: false, skipped: e?.message }));
  if (!owner?.ok || !owner.entityId) {
    return { cre_property_id: prop.id, status: 'owner_rejected', skipped: owner?.skipped || null, owner_name: name, method: ext.method };
  }

  const set = await setOwner(prop.id, owner.entityId, { workspaceId: prop.workspaceId, actorId: prop.actorId })
    .catch((e) => ({ ok: false, patched: false, detail: e?.message }));
  if (!set?.ok) {
    return { cre_property_id: prop.id, status: 'set_failed', owner_entity_id: owner.entityId, owner_name: name };
  }
  return {
    cre_property_id: prop.id,
    status: set.patched ? 'owner_set' : 'already_set',
    owner_entity_id: owner.entityId,
    owner_name: name,
    method: ext.method,
  };
}

const PROD_DEPS = {
  fetchBytes: (sourceUrl) => fetchSharepointBytes({ storageRef: sourceUrl }),
  extractOwner: (a) => extractCreOwner(a),
  ensureOwner: (name, ctx) => ensureCreOwnerEntity(name, ctx),
  setOwner: (id, entityId, ctx) => setCrePropertyOwner(id, entityId, ctx),
};

export async function handleCreOwnerBackfill(req, res, deps = PROD_DEPS) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
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
