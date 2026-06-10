// ============================================================================
// Property-doc write-back — LCC deliverables → the matched property's folder
// Life Command Center · Phase 2, Slice 2b
//
//   POST /api/property-doc-writeback
//     { domain:'dia'|'gov', property_id, file_name, doc_type, content_base64 }
//
// Closes the bidirectional loop: an LCC-generated deliverable (BOV / OM / client
// memo / master sheet) is written INTO the matched property's own SharePoint
// folder, tagged ` [LCC]` so the folder-feed read path skips re-ingesting our
// own output, and linked to the property via a property_documents row
// (source='lcc_generated', high trust). One entrypoint any producer (app
// exports, Cowork BOV/memo skills) calls — the mechanism, not a specific
// producer.
//
// Doctrine / safety:
//   • Resolve the destination folder confidently or REFUSE (Unit 3) — never a
//     guessed write into the wrong property folder.
//   • NEVER overwrite an existing file — collisions get a ` (YYYY-MM-DD)` suffix.
//   • Tag every file ` [LCC]` so re-ingest classifies it as our work, not intel.
//   • Effect-first / outcome-truthful: a DB write that fails AFTER a successful
//     upload returns the uploaded path (207) so the file isn't lost.
//   • Feature-flagged on SHAREPOINT_UPLOAD_URL — clear 503 until the PA flow is
//     wired (the storage-adapter / find_contacts_by_account rollout pattern).
//
// No new api/*.js — sub-route of intake.js (?_route=property-doc-writeback).
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import { uploadDocToFolder } from '../_shared/storage-adapter.js';
import { resolvePropertyFolder } from '../_shared/property-folder-resolver.js';
import { ensureLccTag, dedupeFileName } from '../_shared/folder-feed-classify.js';

// Accept both the canonical short form and the long form callers may pass.
function normalizeDomain(d) {
  const s = String(d || '').trim().toLowerCase();
  if (s === 'dia' || s === 'dialysis') return 'dialysis';
  if (s === 'gov' || s === 'government') return 'government';
  return null;
}

// List the destination folder's file names so we can de-dup a colliding write.
// Best-effort: a failed/empty listing yields an empty set (no collision known),
// which is safe — the underlying Create-file path never overwrites silently.
async function listFolderFileNames(folderPath, fetchImpl) {
  const listUrl = process.env.SHAREPOINT_LIST_URL;
  if (!listUrl) return new Set();
  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));
  try {
    const res = await doFetch(listUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: String(folderPath).replace(/'/g, "''") }),
    });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep */ }
    if (!res.ok || !json?.ok) return new Set();
    // Tolerant of the verbose OData envelope (sp.d.Files.results) + flat shapes.
    const sp = json?.sp?.d ?? json?.sp ?? json ?? {};
    const rawFiles = sp.Files?.results ?? sp.Files ?? json?.items ?? json?.value ?? [];
    const names = (Array.isArray(rawFiles) ? rawFiles : [])
      .map(it => it.Name || it.name || it.file_name || it.fileName ||
        (it.ServerRelativeUrl || it.serverRelativeUrl || it.path || '').split('/').pop())
      .filter(Boolean);
    return new Set(names);
  } catch {
    return new Set();
  }
}

// Insert the linked property_documents row (source='lcc_generated', high trust).
// Mirrors the enrich attach: tries the source-tagged shape, then degrades to a
// schema without that column so the link is never blocked by column drift.
async function insertLccDocument(domain, propertyId, { fileName, docType, sourceUrl }, dq = domainQuery) {
  const base = {
    property_id:      Number(propertyId),
    file_name:        fileName,
    document_type:    docType || 'om',
    source_url:       sourceUrl || null,
    ingestion_status: 'lcc_generated',
  };
  const attempts = [
    { ...base, source: 'lcc_generated' },  // preferred — record the authoritative channel
    base,                                  // fallback — schema without a source column
  ];
  let lastErr = null;
  for (const payload of attempts) {
    const r = await dq(
      domain, 'POST',
      'property_documents?on_conflict=property_id,file_name',
      payload,
      { Prefer: 'return=representation,resolution=merge-duplicates' }
    ).catch(e => ({ ok: false, status: 0, data: e?.message }));
    if (r.ok) {
      const inserted = Array.isArray(r.data) ? r.data[0] : r.data;
      return { ok: true, document_id: inserted?.document_id || inserted?.id || null };
    }
    lastErr = { status: r.status, detail: r.data };
  }
  const plain = await dq(domain, 'POST', 'property_documents', base)
    .catch(e => ({ ok: false, status: 0, data: e?.message }));
  if (plain.ok) {
    const inserted = Array.isArray(plain.data) ? plain.data[0] : plain.data;
    return { ok: true, document_id: inserted?.document_id || inserted?.id || null };
  }
  return { ok: false, ...lastErr };
}

// Record field provenance for the doc-attach at the TOP of the ladder
// (source='lcc_generated', priority 1, confidence 1.0 — our own authoritative
// work). Best-effort; never blocks the response.
async function recordLccProvenance(domain, { documentId, fileName, docType, sourceUrl, workspaceId, actorId, intakeId }) {
  if (!documentId) return false;
  const targetDb    = domain === 'dialysis' ? 'dia_db' : 'gov_db';
  const tablePrefix = domain === 'dialysis' ? 'dia' : 'gov';
  const fields = { file_name: fileName, document_type: docType || 'om', source_url: sourceUrl };
  let any = false;
  for (const [fieldName, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    try {
      const r = await opsQuery('POST', 'rpc/lcc_merge_field', {
        p_workspace_id:    workspaceId || null,
        p_target_database: targetDb,
        p_target_table:    `${tablePrefix}.property_documents`,
        p_record_pk:       String(documentId),
        p_field_name:      fieldName,
        p_value:           value,
        p_source:          'lcc_generated',
        p_source_run_id:   intakeId || null,
        p_confidence:      1.0,
        p_recorded_by:     actorId || null,
      });
      if (r.ok) any = true;
    } catch { /* best-effort */ }
  }
  return any;
}

/**
 * Core write-back flow. Extracted from the HTTP handler so it can be unit-tested
 * with injectable deps. Returns { status, body }.
 *
 * deps:
 *   resolveFolder   ({domain, propertyId}) => { ok, folder_path, reason }
 *   listNames       (folderPath) => Promise<Set<string>>
 *   uploadDoc       ({folderPath, fileName, bytes}) => { ok, server_relative_url, status, detail }
 *   insertDoc       (domain, propertyId, {fileName, docType, sourceUrl}) => { ok, document_id }
 *   recordProvenance(domain, {...}) => Promise<boolean>
 */
export async function performDocWriteback(
  { domain, propertyId, fileName, docType, contentBase64, workspaceId, actorId, intakeId },
  deps = {}
) {
  const resolveFolder    = deps.resolveFolder    || (a => resolvePropertyFolder(a));
  const listNames        = deps.listNames        || (p => listFolderFileNames(p));
  const uploadDoc        = deps.uploadDoc         || (a => uploadDocToFolder(a));
  const insertDoc        = deps.insertDoc         || ((d, p, a) => insertLccDocument(d, p, a));
  const recordProvenance = deps.recordProvenance  || ((d, a) => recordLccProvenance(d, a));

  // 1. Resolve the destination folder — refuse rather than guess.
  const folder = await resolveFolder({ domain, propertyId });
  if (!folder.ok) {
    return { status: 422, body: { ok: false, reason: folder.reason || 'folder_unresolved' } };
  }

  // 2. [LCC] tag + collision-safe name (never overwrite).
  const tagged    = ensureLccTag(fileName);
  const existing  = await listNames(folder.folder_path).catch(() => new Set());
  const finalName = dedupeFileName(tagged, existing);

  // 3. Upload. On failure write NOTHING to the DB.
  const bytes = Buffer.from(String(contentBase64 || ''), 'base64');
  const up = await uploadDoc({ folderPath: folder.folder_path, fileName: finalName, bytes });
  if (!up.ok) {
    return { status: 502, body: { ok: false, error: 'upload_failed', detail: up.detail || null, upstream_status: up.status ?? null } };
  }
  const serverUrl = up.server_relative_url;

  // 4. Link the property_documents row (effect-first / outcome-truthful).
  const docRes = await insertDoc(domain, propertyId, { fileName: finalName, docType, sourceUrl: serverUrl });
  if (!docRes.ok) {
    // Uploaded but the DB link failed — return the path (207) so it isn't lost.
    return {
      status: 207,
      body: {
        ok: false,
        uploaded: true,
        doc_attach: false,
        server_relative_url: serverUrl,
        file_name: finalName,
        folder_path: folder.folder_path,
        detail: docRes.detail || null,
      },
    };
  }

  // Provenance is non-blocking — a failure here doesn't unset the linked doc.
  const provOk = await recordProvenance(domain, {
    documentId: docRes.document_id, fileName: finalName, docType,
    sourceUrl: serverUrl, workspaceId, actorId, intakeId,
  }).catch(() => false);

  return {
    status: 200,
    body: {
      ok: true,
      uploaded: true,
      doc_attach: true,
      provenance: !!provOk,
      server_relative_url: serverUrl,
      file_name: finalName,
      folder_path: folder.folder_path,
      folder_source: folder.source || null,
      document_id: docRes.document_id,
      domain, property_id: propertyId,
    },
  };
}

// ============================================================================
// HTTP handler
// ============================================================================
export async function handlePropertyDocWriteback(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  // Feature flag — inert with a clear 503 until the PA upload flow is wired.
  if (!process.env.SHAREPOINT_UPLOAD_URL) {
    return res.status(503).json({
      ok: false,
      error: 'not_configured',
      detail: 'SHAREPOINT_UPLOAD_URL (PA "LCC Put Artifact" flow) is not set — write-back is inert until it is wired.',
    });
  }

  const body = req.body || {};
  const domain = normalizeDomain(body.domain);
  const propertyId = body.property_id;
  const fileName = body.file_name;
  const docType = body.doc_type || body.document_type || 'om';
  const contentBase64 = body.content_base64;

  if (!domain) {
    return res.status(400).json({ ok: false, error: "invalid 'domain' — expected 'dia' or 'gov'" });
  }
  if (propertyId == null || String(propertyId).trim() === '') {
    return res.status(400).json({ ok: false, error: "missing 'property_id'" });
  }
  if (!fileName || !String(fileName).trim()) {
    return res.status(400).json({ ok: false, error: "missing 'file_name'" });
  }
  if (!contentBase64 || !String(contentBase64).trim()) {
    return res.status(400).json({ ok: false, error: "missing 'content_base64'" });
  }

  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID
    || null;

  const result = await performDocWriteback({
    domain, propertyId, fileName, docType, contentBase64,
    workspaceId, actorId: user.id || user.user_id || null, intakeId: body.intake_id || null,
  });
  return res.status(result.status).json(result.body);
}
