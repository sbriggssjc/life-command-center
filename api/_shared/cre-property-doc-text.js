// ============================================================================
// CRE property-document TEXT sidecar — R58 "Unit 4", Step 2A
// Life Command Center · LCC Opps (xengecqvemvfknjvbvrq)
//
// The CRE registry (`lcc_cre_property_documents`, folder-feed-classified: 444
// leases / 250 dd / 67 om …) carries NO raw_text — so every access point that
// wanted a lease abstracted had to re-OCR the PDF itself (this session's lesson:
// Cowork fell back to vision because nothing had persisted the text). This worker
// closes that: it turns a registry doc's bytes → text via the shared Unit-1
// foundation (`extractDocumentText`) exactly ONCE and persists it to the
// `lcc_cre_property_document_text` sidecar, so Unit 4 / comps / OM / any caller
// reuse the SAME extraction.
//
// It is the CRE-side twin of api/_handlers/document-text.js (which drains the
// DOMAIN dbs' `property_documents.raw_text` for the deed/OM pipeline). Same OCR
// engine, different store: this one writes the CRE sidecar via `opsQuery`.
//
// TIER RULE (spec 2A): leases/DD force `ocrTiered:true` and PREFER the DocAI
// `cloud_cheap` layout tier — it returns page-anchored text, which is what fills
// the abstract's clause_refs PAGE column. gpt-4o vision is transcription-only
// last resort (no page anchors) and never the lease default.
//
// SAFE / IDEMPOTENT: upsert keyed on (document_id, extractor_version); a filled
// row drops out of the queue. A scanned doc with no OCR available is recorded
// needs_ocr=true (terminal-this-pass, sized for the OCR follow-up), NOT an error.
// A transient byte-fetch failure is left UNpersisted so a later tick retries.
// Deps injected → unit-testable with no network / no OpenAI key.
// ============================================================================

import { opsQuery, isOpsConfigured } from './ops-db.js';
import { extractDocumentText, meaningfulTextLen } from './document-text.js';

export const CRE_DOC_TEXT_VERSION = process.env.CRE_DOC_TEXT_VERSION || 'unit1_v1';

// A successful OCR whose MEANINGFUL text is below this floor is almost certainly a
// blank/near-blank scan or a cover page (prod finding: a lease that fell through to
// gpt-4o returned 48 chars and was marked "done"). We still persist it (re-OCR
// wouldn't recover more), but tag reason='thin_ocr_result' so Unit 4 treats it as
// citation-risk / review rather than trusting it. 0 disables. Digital text uses the
// upstream DOC_TEXT_MIN_CHARS floor already; this covers the OCR path.
const OCR_MIN_MEANINGFUL_CHARS = Number(process.env.CRE_OCR_MIN_CHARS || 120);

// Doc types this worker extracts by default (the ones Unit 4 consumes). A comp
// export or a finished master workbook doesn't need a text sidecar.
export const CRE_TEXT_DOCTYPES = new Set(['lease', 'dd', 'om']);

/**
 * Split a flat OCR/text blob into a page array when the layout tier didn't give
 * us one. DocAI/Azure layout returns real per-page text (preferred, page-anchored
 * for clause_refs); for a digital pdf-parse result we fall back to form-feed
 * (\f, which pdf-parse emits between pages) so a page number is still available.
 * Returns [] when we truly can't tell pages apart (single-page or unknown).
 */
export function derivePages(text, providedPages) {
  if (Array.isArray(providedPages) && providedPages.length) {
    return providedPages.map((p, i) => ({
      page: Number(p.page || p.page_number || i + 1),
      text: String(p.text || p.content || ''),
    }));
  }
  const t = String(text || '');
  if (!t) return [];
  if (t.includes('\f')) {
    return t.split('\f').map((chunk, i) => ({ page: i + 1, text: chunk.trim() }));
  }
  return [];
}

/**
 * Read ONE CRE registry row → build the sidecar payload. Pure over its deps
 * (extract fn + a bytes source); no DB writes. Returns the row to upsert plus an
 * `outcome` label. Split out so it is trivially unit-testable.
 *
 * Outcomes: text_extracted | ocr | needs_ocr | fetch_failed | skip_type
 */
export async function buildDocTextRow(regRow, deps = {}) {
  const extract = deps.extractDocumentText || extractDocumentText;
  const docType = String(regRow.document_type || '').toLowerCase();

  // Lease/DD get the page-anchored tiered OCR; OM too (its DD facts feed real_estate).
  const ocrTiered = deps.ocrTiered !== false;

  const ext = await extract(
    {
      sourceUrl: regRow.source_url || null,
      storageRef: regRow.storage_ref || regRow.source_url || null,
      storagePath: regRow.storage_path || null,
      mediaType: null,
      allowOcr: deps.allowOcr !== false,
      ocrTiered,
    },
    deps, // storageGet / fetchImpl / freeOcr / cloudCheapOcr / ocrImpl all pass through
  );

  if (!ext.ok) {
    // Transient — do NOT persist; a later tick retries the byte fetch.
    return { outcome: 'fetch_failed', reason: ext.reason || 'fetch_failed', detail: ext.detail || null };
  }

  const base = {
    document_id: regRow.id,
    cre_property_id: regRow.cre_property_id ?? null,
    document_type: regRow.document_type || null,
    extractor_version: deps.version || CRE_DOC_TEXT_VERSION,
    extracted_at: new Date().toISOString(),
  };

  if (ext.needs_ocr || !ext.text) {
    return {
      outcome: 'needs_ocr',
      row: {
        ...base,
        raw_text: null,
        method: null,
        needs_ocr: true,
        thin_text_layer: !!ext.thin_text_layer,
        char_len: 0,
        reason: ext.reason || 'no_text_layer',
      },
    };
  }

  // Per-page text for clause_refs page anchors. Unit 1 currently returns a page
  // COUNT (ext.ocr_pages) from the DocAI layout tier but not the per-page array —
  // so we accept any of the field names Unit 1 / the DocAI wrapper would carry it
  // under when that passthrough lands, and fall back to form-feed splitting.
  const providedPages = ext.pages || ext.ocr_page_texts || ext.page_texts || null;
  const pages = derivePages(ext.text, providedPages);

  // Thin-OCR guard: a near-empty OCR result is flagged (not silently trusted).
  const meaningful = meaningfulTextLen(ext.text);
  const thinOcr = ext.method === 'ocr' && OCR_MIN_MEANINGFUL_CHARS > 0 && meaningful < OCR_MIN_MEANINGFUL_CHARS;

  return {
    outcome: ext.method === 'ocr' ? 'ocr' : 'text_extracted',
    row: {
      ...base,
      raw_text: ext.text,
      method: ext.method || null,
      ocr_tier: ext.ocr_tier || null,
      ocr_engine: ext.ocr_engine || null,
      ocr_confidence: typeof ext.ocr_confidence === 'number' ? ext.ocr_confidence : null,
      ocr_pages: Number.isFinite(ext.ocr_pages) ? ext.ocr_pages : (pages.length || null),
      page_count: pages.length || null,
      pages: pages.length ? pages : null,
      thin_text_layer: !!ext.thin_text_layer,
      char_len: ext.text.length,
      needs_ocr: false,
      // gpt-4o transcription (tier 'cloud') has no page anchors; a thin OCR result
      // is low-confidence. Either way, tag it so Unit 4 flags citation risk.
      reason: thinOcr ? 'thin_ocr_result' : (ext.ocr_tier === 'cloud' ? 'no_page_anchors_gpt4o' : null),
    },
  };
}

/**
 * Fetch a single registry row by id (id is bigint on lcc_cre_property_documents).
 */
async function fetchRegistryRow(documentId, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const r = await q('GET',
    `lcc_cre_property_documents?id=eq.${encodeURIComponent(documentId)}` +
    '&select=id,cre_property_id,file_name,document_type,source_url,source&limit=1',
    null, { countMode: 'none' });
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  return r.data[0];
}

/**
 * Is there already a sidecar for this (document, version)? Returns 'done' when a
 * non-needs_ocr sidecar exists (skip re-extract), 'needs_ocr' when one exists but
 * is still awaiting OCR (re-attempt is allowed), or null when absent.
 */
async function sidecarStatus(documentId, version, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const r = await q('GET',
    `lcc_cre_property_document_text?select=needs_ocr&document_id=eq.${encodeURIComponent(documentId)}` +
    `&extractor_version=eq.${encodeURIComponent(version)}&limit=1`,
    null, { countMode: 'none' });
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  return r.data[0].needs_ocr ? 'needs_ocr' : 'done';
}

/**
 * Upsert the sidecar row on (document_id, extractor_version). merge-duplicates so
 * a re-run overwrites the prior extraction for that version rather than erroring.
 */
async function upsertSidecar(row, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  return q('POST',
    'lcc_cre_property_document_text?on_conflict=document_id,extractor_version',
    row,
    { Prefer: 'return=minimal,resolution=merge-duplicates' });
}

/**
 * THE 2A worker. Extract-once for one CRE registry document.
 *   1. load the registry row (source_url / SharePoint ref)
 *   2. Unit-1 extractDocumentText (tiered OCR for lease/dd/om)
 *   3. upsert the sidecar (or record needs_ocr; leave transient failures alone)
 *
 * Idempotent on (document_id, extractor_version). Never throws.
 * Returns { ok, outcome, document_id, text_len?, ocr_tier?, reason? }.
 *
 * @param {number} documentId  lcc_cre_property_documents.id (bigint)
 */
export async function runPropertyDocText(documentId, deps = {}) {
  if (documentId == null) return { ok: false, outcome: 'no_document_id' };

  // Idempotency guard: skip a doc that already has a fresh (non-needs_ocr) sidecar
  // at this version — so the forward `jobs` lane and the backlog `eligible` sweep
  // can run together without ever re-OCRing the same document (DocAI bills per
  // page). `deps.force` re-extracts anyway (a re-OCR after a source replacement).
  if (!deps.force && !deps.registryRow) {
    const existing = await sidecarStatus(documentId, deps.version || CRE_DOC_TEXT_VERSION, deps);
    if (existing === 'done') {
      return { ok: true, outcome: 'already_extracted', document_id: documentId };
    }
  }

  const regRow = deps.registryRow || (await fetchRegistryRow(documentId, deps));
  if (!regRow) return { ok: false, outcome: 'not_found', document_id: documentId };

  let built;
  try {
    built = await buildDocTextRow(regRow, deps);
  } catch (err) {
    return { ok: false, outcome: 'error', document_id: documentId, reason: err?.message || String(err) };
  }

  if (built.outcome === 'fetch_failed') {
    // Transient — surfaced but NOT persisted, so the row stays eligible.
    return { ok: false, outcome: 'fetch_failed', document_id: documentId, reason: built.reason, detail: built.detail };
  }

  const up = await upsertSidecar(built.row, deps).catch((e) => ({ ok: false, detail: e?.message }));
  if (!up || !up.ok) {
    return { ok: false, outcome: 'persist_failed', document_id: documentId, detail: up?.detail || up?.data || null };
  }

  return {
    ok: true,
    outcome: built.outcome,
    document_id: documentId,
    cre_property_id: regRow.cre_property_id ?? null,
    document_type: regRow.document_type || null,
    text_len: built.row.char_len || 0,
    ocr_tier: built.row.ocr_tier || null,
    ocr_engine: built.row.ocr_engine || null,
    ocr_pages: built.row.ocr_pages ?? null,
    needs_ocr: !!built.row.needs_ocr,
    reason: built.row.reason || null,
  };
}

/**
 * The eligible queue for a drain tick: registry docs of an extractable type that
 * have NO sidecar yet at the current version (LEFT-JOIN-absent). Implemented as
 * two cheap PostgREST reads (candidate registry ids, then the sidecar ids already
 * present) diffed in JS — no view / RPC dependency, mirrors claimPendingJobs.
 *
 * Returns { ok, rows } where rows are registry rows ready for runPropertyDocText.
 */
export async function fetchEligibleCreDocs({ limit = 15, doctype = null, version } = {}, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const ver = version || CRE_DOC_TEXT_VERSION;
  const cap = Math.min(100, Math.max(1, limit));

  const typeFilter = doctype && doctype !== 'all'
    ? `&document_type=eq.${encodeURIComponent(doctype)}`
    : `&document_type=in.(${[...CRE_TEXT_DOCTYPES].join(',')})`;

  // Candidate registry rows (newest first), over-fetch so we can drop already-done.
  const reg = await q('GET',
    `lcc_cre_property_documents?select=id,cre_property_id,file_name,document_type,source_url,source` +
    `${typeFilter}&order=id.desc&limit=${cap * 4}`,
    null, { countMode: 'none' });
  if (!reg.ok || !Array.isArray(reg.data)) return { ok: false, status: reg.status, detail: reg.data };
  if (!reg.data.length) return { ok: true, rows: [] };

  const ids = reg.data.map((r) => r.id);
  const idIn = ids.join(',');
  // Which of those already have a sidecar at this version?
  const side = await q('GET',
    `lcc_cre_property_document_text?select=document_id&extractor_version=eq.${encodeURIComponent(ver)}` +
    `&document_id=in.(${idIn})`,
    null, { countMode: 'none' });
  const done = new Set(side.ok && Array.isArray(side.data) ? side.data.map((r) => r.document_id) : []);

  const rows = reg.data.filter((r) => !done.has(r.id)).slice(0, cap);
  return { ok: true, rows };
}

/**
 * Enqueue the 2A job for a freshly-registered lease/DD/OM doc. The document id is
 * bigint, but enrichment_jobs.target_id is uuid — so the id rides in `external_id`
 * (text). Reuses the same enrichment_jobs lane the deed/classify flow uses.
 * Returns the job id or null (never throws). Guarded to the extractable types.
 */
export async function enqueueCreDocText({ documentId, crePropertyId, documentType, workspaceId, priority = 55 }, deps = {}) {
  const enqueue = deps.enqueueEnrichmentJob;
  if (typeof enqueue !== 'function') return null;
  const dt = String(documentType || '').toLowerCase();
  if (!CRE_TEXT_DOCTYPES.has(dt)) return null;
  if (!documentId) return null;
  return enqueue({
    workspaceId,
    jobType: 'cre.doc.text',
    externalId: String(documentId),
    targetKind: 'cre_property',
    payload: { document_id: documentId, cre_property_id: crePropertyId ?? null, document_type: dt },
    priority,
  });
}

export const __private = { fetchRegistryRow, upsertSidecar, sidecarStatus };
