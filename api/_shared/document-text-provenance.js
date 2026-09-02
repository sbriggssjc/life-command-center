// ============================================================================
// OCR2 — document-text OCR provenance: the single owner of the shape AND of the
// merge into property_documents.extracted_data
// Life Command Center
//
// WHY THIS FILE EXISTS
// --------------------
// `extractDocumentText` already computes { method, ocr_tier, ocr_engine,
// ocr_pages, ocr_confidence } on every result, and `document-text.js` already
// returns them on the tick response — then the PATCH persisted only
// { raw_text, ingestion_status } and threw the rest away. Measured 2026-09-02:
// gov 325 deeds with text / 0 with any OCR provenance; dia 182 / 0. The CRE
// lane's sidecar records all four, which is why every number on the CRE side is
// auditable and every number on the deed side has been a guess — and is how an
// unverifiable "all 325 deeds went to gpt-4o" claim reached three documents.
//
// ⚠️ TWO WRITERS, ONE COLUMN, AND ONE OF THEM USED TO REPLACE IT
// --------------------------------------------------------------
// `property_documents.extracted_data` is written by BOTH this provenance write
// and the deed parser. The parser's write (deed-parser.js) was a WHOLESALE
// REPLACE — `extracted_data: { deed_extraction, extracted_at }` — so a
// provenance key written before the parse was destroyed by it, and a later
// re-parse (processOneReparse runs over stored raw_text) would destroy one
// written on an earlier tick. Evidence it is real: on gov all 185 rows carrying
// extracted_data carry EXACTLY those two keys and nothing else, while dia
// carries 10 rows with a third key (r59_backfilled_at, from the one call site
// that already merged) — so a sibling key CAN survive, and on the parser's path
// it did not.
//
// Both call sites therefore go through mergeExtractedData() → the domain RPC,
// which is the SINGLE OWNER of the merge. A third writer added later inherits
// the same guarantee for free.
//
// ⚠️ IT MUST BE AN RPC, NOT APPLICATION LOGIC. PostgREST cannot merge jsonb in a
// PATCH, and a read-then-write from the handler would RACE the deed parser
// inside the same tick. The RPC takes FOR UPDATE on the row.
//
// FAIL-SOFT BY DESIGN: provenance is telemetry about an extraction, never the
// extraction. Every failure returns a NAMED reason and is counted by the caller;
// nothing here throws, and nothing here can lose raw_text.
// ============================================================================

/** The single key this module owns inside extracted_data. */
export const DOC_TEXT_PROVENANCE_KEY = 'document_text';

/** Stamped so a future reader can tell WHICH producer wrote a row's provenance. */
export const DOC_TEXT_EXTRACTOR = 'document-text-tick';

const RPC_BY_DOMAIN = {
  dia: 'dia_merge_document_extracted_data',
  dialysis: 'dia_merge_document_extracted_data',
  gov: 'gov_merge_document_extracted_data',
  government: 'gov_merge_document_extracted_data',
};

/**
 * Resolve the domain's merge RPC. Returns null for an unknown domain rather
 * than guessing a name — a POST to a non-existent RPC 404s and would be
 * indistinguishable from "the migration is not applied".
 */
export function mergeRpcName(domain) {
  return RPC_BY_DOMAIN[String(domain || '').toLowerCase()] || null;
}

const numOrNull = (v) => (Number.isFinite(v) ? v : null);

/**
 * Build the provenance block from an `extractDocumentText` result.
 *
 * ⚠️ NEVER FABRICATES. A field the extractor did not report stays null. In
 * particular a digital `pdf_text` / `office_text` extraction has NO tier and NO
 * engine, and null there means "no OCR was performed", which is a different
 * fact from "OCR ran on an unknown engine" — the audit view groups on both, so
 * inventing a value would silently move a free extraction into a paid bucket.
 *
 * ⚠️ ocr_pages vs page_count are DIFFERENT NUMBERS and both are carried.
 * `ocr_pages` is what we were BILLED for; `page_count` is how long the document
 * is. They were the same until the DOC18 page window split them, and collapsing
 * them records a 141-page lease read to page 50 as a 50-page document.
 */
export function buildTextProvenance(ext, opts = {}) {
  if (!ext || typeof ext !== 'object') return null;
  const p = {
    method: ext.method || null,
    ocr_tier: ext.ocr_tier || null,
    ocr_engine: ext.ocr_engine || null,
    ocr_pages: numOrNull(ext.ocr_pages),
    ocr_confidence: numOrNull(ext.ocr_confidence),
    page_count: numOrNull(ext.page_count),
    text_len: numOrNull(ext.text_len),
    ocr_attempted: ext.ocr_attempted === true,
    extractor: opts.extractor || DOC_TEXT_EXTRACTOR,
    extracted_at: opts.extractedAt || new Date().toISOString(),
  };
  // Only present on a DOC18 windowed extract. Absent (not false/0) on every
  // other path, so "this row was never windowed" and "this row was windowed and
  // covered everything" stay distinguishable.
  if (ext.partial_extract) {
    p.partial_extract = true;
    p.pages_covered = numOrNull(ext.pages_covered);
    p.page_ranges = ext.page_ranges || null;
  }
  if (ext.via) p.via = ext.via;
  if (ext.thin_text_layer) p.thin_text_layer = true;
  return p;
}

/**
 * Merge a top-level patch into property_documents.extracted_data via the domain
 * RPC. The ONLY sanctioned way to write that column.
 *
 * @returns {{ok:boolean, reason?:string, keys_written?:string[], keys_skipped?:string[]}}
 */
export async function mergeExtractedData(domain, documentId, patch, opts = {}, deps = {}) {
  const q = deps.domainQuery;
  if (typeof q !== 'function') return { ok: false, reason: 'no_domain_query' };
  if (documentId == null) return { ok: false, reason: 'no_document_id' };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, reason: 'patch_not_object' };
  }
  const rpc = mergeRpcName(domain);
  if (!rpc) return { ok: false, reason: 'unknown_domain' };

  let r;
  try {
    r = await q(domain, 'POST', `rpc/${rpc}`, {
      p_document_id: documentId,
      p_patch: patch,
      p_ingestion_status: opts.ingestionStatus ?? null,
      p_fill_blanks: opts.fillBlanks === true,
    });
  } catch (err) {
    return { ok: false, reason: `rpc_threw:${err?.message || err}` };
  }
  if (!r || !r.ok) {
    // Name the transport failure distinctly from the RPC's own refusal. A 404
    // here means the migration has not been applied on this domain — a deploy
    // fact, not a data fact, and it must not read as "nothing to write".
    return { ok: false, reason: `rpc_non_ok:${r?.status ?? 'no_status'}`, detail: r?.data ?? null };
  }
  // PostgREST returns a scalar-returning function's value directly, but wraps it
  // in a single-row array under some Accept negotiations. Accept both.
  const body = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!body || body.ok !== true) {
    return { ok: false, reason: body?.reason || 'rpc_refused', detail: body ?? null };
  }
  return {
    ok: true,
    keys_written: body.keys_written || [],
    keys_skipped: body.keys_skipped || [],
  };
}

/**
 * Persist the OCR provenance for one extracted document.
 *
 * fill-blanks by DEFAULT: an existing `document_text` block is never overwritten,
 * so a re-parse or a retroactive pass cannot rewrite the record of what actually
 * read the document the first time.
 */
export async function writeTextProvenance(domain, documentId, ext, opts = {}, deps = {}) {
  const provenance = buildTextProvenance(ext, opts);
  if (!provenance) return { ok: false, reason: 'no_extract_result' };
  return mergeExtractedData(
    domain,
    documentId,
    { [DOC_TEXT_PROVENANCE_KEY]: provenance },
    { fillBlanks: opts.fillBlanks !== false, ingestionStatus: opts.ingestionStatus ?? null },
    deps,
  );
}
