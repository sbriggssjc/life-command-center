// ============================================================================
// Document byte-capture notify — UW#6-REV
// Life Command Center · sub-route of intake.js (?_route=document-notify)
//
//   POST /api/intake/document-notify
//     { domain, property_id, doctype, file_name, source_url?, content_hash,
//       storage_path, storage_bucket }
//
// The sidebar already PUT the document bytes to the domain's retained
// `property-documents` Storage bucket via the signed URL from prepare-upload
// (Path C). This endpoint records the POINTER on `property_documents` in the
// correct DOMAIN DB so the deep-parser (document-text-tick) can read durable
// bytes — closing the gap that R58's URL-only re-fetch could never bridge
// (CoStar CDN tokens die server-side).
//
// Idempotent on (property_id, content_hash) — the unique index added by the
// UW#6-REV migration — so the same doc captured twice is one row. When the
// sidebar already wrote a url_captured row (same property_id + file_name), this
// ATTACHES the bytes to it rather than minting a duplicate.
//
// Server RE-VALIDATES the doctype (the sidebar's classification isn't always
// clean — a "?" unknown is filed as `other`, never mis-routed).
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { domainQuery } from '../_shared/domain-db.js';

const DOMAIN_NORM = { dia: 'dialysis', dialysis: 'dialysis', gov: 'government', government: 'government' };
const KNOWN_DOCTYPES = new Set(['deed', 'lease', 'om', 'dd', 'master', 'bov', 'brochure', 'comp', 'survey', 'other']);

/** Re-validate the sidebar doctype; an unknown/"?" is filed as `other` (triage), never mis-routed. */
export function normalizeNotifyDoctype(d) {
  const v = String(d || '').toLowerCase().trim();
  return KNOWN_DOCTYPES.has(v) ? v : 'other';
}

/**
 * Core (deps-injected for tests). Writes / attaches the storage pointer on
 * property_documents in the right domain DB.
 * Outcomes: attached (existing row) | created (new row) | idempotent (already
 * had this content_hash) | error.
 */
export async function performDocumentNotify(args, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const { domain: rawDomain, property_id, doctype, file_name, source_url, content_hash, storage_path, storage_bucket } = args || {};

  const domain = DOMAIN_NORM[String(rawDomain || '').toLowerCase()];
  if (!domain) return { ok: false, status: 400, error: 'bad_domain' };
  if (property_id == null || property_id === '') return { ok: false, status: 400, error: 'missing_property_id' };
  if (!storage_path) return { ok: false, status: 400, error: 'missing_storage_path' };
  if (!content_hash) return { ok: false, status: 400, error: 'missing_content_hash' };

  const dt = normalizeNotifyDoctype(doctype);
  const fileName = file_name || String(storage_path).split('/').pop() || 'document';
  const bucket = storage_bucket || 'property-documents';

  const ptr = {
    storage_path,
    storage_bucket: bucket,
    content_hash,
    document_type: dt,
    ingestion_status: 'bytes_captured',
  };

  // 1. Already recorded this exact content for this property? → idempotent no-op.
  const existingByHash = await q(domain, 'GET',
    `property_documents?property_id=eq.${encodeURIComponent(property_id)}` +
    `&content_hash=eq.${encodeURIComponent(content_hash)}` +
    `&select=document_id,storage_path&limit=1`);
  if (existingByHash.ok && existingByHash.data?.[0]?.storage_path) {
    return { ok: true, status: 200, outcome: 'idempotent', document_id: existingByHash.data[0].document_id, domain, doctype: dt };
  }

  // 2. Sidebar already wrote a url_captured row for this file? → ATTACH the bytes.
  const existingByName = await q(domain, 'GET',
    `property_documents?property_id=eq.${encodeURIComponent(property_id)}` +
    `&file_name=eq.${encodeURIComponent(fileName)}&select=document_id,storage_path&limit=1`);
  const target = (existingByName.ok && existingByName.data?.[0]) || null;
  if (target?.document_id) {
    const patch = { ...ptr };
    if (source_url) patch.source_url = source_url;   // keep the original URL for reference
    const upd = await q(domain, 'PATCH',
      `property_documents?document_id=eq.${target.document_id}`, patch, { Prefer: 'return=representation' });
    if (!upd.ok) return { ok: false, status: 502, error: 'attach_failed', detail: upd.data };
    return { ok: true, status: 200, outcome: 'attached', document_id: target.document_id, domain, doctype: dt };
  }

  // 3. No existing row → INSERT (idempotent on the (property_id, content_hash)
  //    unique index; a racing duplicate merges instead of erroring).
  const row = {
    property_id,
    file_name: fileName,
    source_url: source_url || null,
    ...ptr,
  };
  const ins = await q(domain, 'POST',
    'property_documents?on_conflict=property_id,content_hash', row,
    { Prefer: 'return=representation,resolution=merge-duplicates' });
  if (!ins.ok) return { ok: false, status: 502, error: 'insert_failed', detail: ins.data };
  const inserted = Array.isArray(ins.data) ? ins.data[0] : ins.data;
  return { ok: true, status: 200, outcome: 'created', document_id: inserted?.document_id ?? null, domain, doctype: dt };
}

export async function handleDocumentNotify(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await authenticate(req, res);
  if (!user) return;
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await performDocumentNotify(body);
  return res.status(result.status || (result.ok ? 200 : 400)).json(result);
}
