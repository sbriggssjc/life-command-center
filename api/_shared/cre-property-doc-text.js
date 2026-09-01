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

// ---------------------------------------------------------------------------
// DOC1 (2026-09-01) — the backlog scan had a FIXED WINDOW and no cursor.
//
// fetchEligibleCreDocs read only the newest `cap*4` = 60 registry rows and
// diffed out the ones already extracted. Once those 60 were all done the diff
// was empty FOREVER: `eligible: 0` returned HTTP 200 every 30 minutes over 695
// waiting documents (ids 2 -> 2317), while bov-extract — the lane's only
// consumer — starved. Dead-End playbook Class 12, third instance (P135 fixed
// window, P136 re-checking the same 120 nightly). Same signature every time:
// green cron, honest-looking zero counters, nothing moving.
//
// The scan is now an ASCENDING keyset walk (oldest-first, so it reaches id 2)
// with a PAGE BUDGET (so it terminates). Raising the old constant was refused
// on purpose: it moves the jam to row N+1 and makes it more expensive to see.
// ---------------------------------------------------------------------------

// Page size for the keyset walk. Deliberately well under PostgREST's hard
// 1000-row response cap — a larger stride silently SKIPS rows.
export const CRE_SCAN_PAGE_SIZE = 200;

// Page budget per tick. 12 x 200 = 2,400 registry rows, against a live
// lease/dd/om population of 771 — so a full sweep is ~4 pages and the budget is
// headroom, not a throttle. It exists so the walk can never become unbounded.
const CRE_SCAN_MAX_PAGES = Math.max(1, parseInt(process.env.CRE_DOC_TEXT_SCAN_MAX_PAGES || '12', 10));

// The DEFERRED-RETRY marker reasons. See writeDeferredMarker: a byte-fetch
// failure persisted NOTHING, so oldest-first would jam on the first unfetchable
// document. These rows self-exclude, then expire.
export const CRE_RETRY_REASONS = Object.freeze(['fetch_failed', 'extract_error']);
export const CRE_RETRY_AFTER_HOURS = Math.max(1, Number(process.env.CRE_DOC_TEXT_RETRY_AFTER_HOURS || 24));
const CRE_RETRY_AFTER_MS = CRE_RETRY_AFTER_HOURS * 3600 * 1000;

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
 * THE NEGATIVE MARKER (DOC1). Verified on the code path, not from the table:
 * `extractDocumentText` has exactly ONE `ok:false` return and it is
 * `fetch_failed` (document-text.js:361). EVERY post-fetch failure —
 * `ocr_non_ok`, `over_ocr_cap`, `office_unreadable`, `thin_ocr_result` — comes
 * back `ok:true` with needs_ocr and DOES persist a sidecar row, which is what
 * makes those self-exclude. A byte-fetch failure persisted nothing at all.
 *
 * Under the old newest-60 window that was invisible. Under an oldest-first scan
 * it is a poison pill: the unfetchable document sits at the head of the queue
 * and is re-selected every tick, forever (P136 — "a worker that leaves no trace
 * on an empty target cannot page past it"). All 771 CRE documents are SharePoint
 * server-relative refs fetched through the PA flow, so one unset env var would
 * jam the whole lane on row one.
 *
 * So we record the fact we have: ATTEMPTED, COULD NOT FETCH, AT THIS TIME.
 *   - `needs_ocr = true`, `raw_text = null` — invisible to BOTH consumers:
 *     gatherPropertyText filters `needs_ocr=is.false&raw_text=not.is.null`, and
 *     v_lcc_cre_bov_ready counts a doc covered only `AND NOT t.needs_ocr`.
 *   - DATED via `extracted_at`, and deliberately NOT terminal: the eligible scan
 *     re-admits it after CRE_RETRY_AFTER_HOURS, so the exclusion clears by itself
 *     when the SharePoint flow comes back or the file reappears. Each retry
 *     refreshes the timestamp, which is what makes the cursor advance instead of
 *     re-trying the same head every 30 minutes.
 *   - The `mode=jobs` lane is unaffected: sidecarStatus only short-circuits on
 *     'done', so a marker row still re-extracts on demand.
 *
 * NEVER overwrites a filled sidecar (the `deps.force` path could otherwise
 * clobber good text with a marker), and never throws.
 */
async function writeDeferredMarker(regRow, reason, deps = {}) {
  if (deps.deferMarkers === false) return false;
  const version = deps.version || CRE_DOC_TEXT_VERSION;
  const existing = await sidecarStatus(regRow.id, version, deps).catch(() => null);
  if (existing === 'done') return false;   // never clobber extracted text
  const up = await upsertSidecar({
    document_id: regRow.id,
    cre_property_id: regRow.cre_property_id ?? null,
    document_type: regRow.document_type || null,
    extractor_version: version,
    extracted_at: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
    raw_text: null,
    method: null,
    needs_ocr: true,
    char_len: 0,
    reason,
  }, deps).catch(() => null);
  return !!(up && up.ok);
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
    // Same jam risk as fetch_failed below: an exception persisted nothing, so the
    // row returns to the head of an oldest-first queue every tick. Mark it dated
    // (24 h) rather than terminal — a genuinely transient throw costs one day of
    // delay; a permanent lane jam costs the whole backlog.
    const marked = await writeDeferredMarker(regRow, 'extract_error', deps);
    return {
      ok: false, outcome: 'error', document_id: documentId,
      reason: err?.message || String(err),
      retry_marked: marked, retry_after_hours: CRE_RETRY_AFTER_HOURS,
    };
  }

  if (built.outcome === 'fetch_failed') {
    // Byte fetch failed — the ONLY ok:false extractDocumentText returns. Persist a
    // DATED, EXPIRING negative marker (see writeDeferredMarker) so the scan can
    // page past it, and re-admit it after CRE_RETRY_AFTER_HOURS. The `detail`
    // (why it failed) rides the tick response and the cron's stored HTTP body,
    // not the sidecar row — the row records that and when, never a guess.
    const marked = await writeDeferredMarker(regRow, 'fetch_failed', deps);
    return {
      ok: false, outcome: 'fetch_failed', document_id: documentId,
      reason: built.reason, detail: built.detail,
      retry_marked: marked, retry_after_hours: CRE_RETRY_AFTER_HOURS,
    };
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
 * have NO usable sidecar yet at the current version.
 *
 * ⚠️ DOC1 — this used to read the newest `cap*4` rows and diff them. That window
 * saturated and `eligible` was 0 forever over 695 documents. It is now an
 * ASCENDING KEYSET WALK: oldest id first (so it reaches the bottom of the
 * backlog), `id=gt.<cursor>` per page (so it never re-reads a page), bounded by
 * CRE_SCAN_MAX_PAGES (so it terminates). It stops as soon as it has `cap` rows.
 *
 * Oldest-first is safe from a poison pill BECAUSE every terminal outcome writes a
 * sidecar row and the one that does not — a byte-fetch failure — now writes a
 * dated deferred-retry marker (writeDeferredMarker). Those markers are the only
 * sidecar rows this scan re-admits, and only once they are stale; a `done`,
 * `ocr_non_ok` or `over_ocr_cap` row stays excluded exactly as before, so nothing
 * re-bills DocAI for an outcome we already have.
 *
 * The forward lane is unchanged — freshly-registered docs arrive through the
 * `cre.doc.text` enrichment job (cron 169, mode=jobs). This is the BACKLOG lane
 * (cron 167, `lcc-cre-doc-text-backfill`), which is what oldest-first is for.
 *
 * Returns { ok, rows, scan_pages, scan_rows, scan_capped, scan_exhausted,
 *           scan_lowest_id, scan_highest_id, retry_admitted }.
 * ⚠️ Read `scan_capped` before reading `eligible: 0` as an empty queue.
 */
export async function fetchEligibleCreDocs({ limit = 15, doctype = null, version } = {}, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const ver = version || CRE_DOC_TEXT_VERSION;
  const cap = Math.min(100, Math.max(1, limit));
  const pageSize = Math.max(1, deps.scanPageSize || CRE_SCAN_PAGE_SIZE);
  const maxPages = Math.max(1, deps.scanMaxPages || CRE_SCAN_MAX_PAGES);
  const now = deps.now ? deps.now() : Date.now();
  const staleBefore = now - CRE_RETRY_AFTER_MS;

  const typeFilter = doctype && doctype !== 'all'
    ? `&document_type=eq.${encodeURIComponent(doctype)}`
    : `&document_type=in.(${[...CRE_TEXT_DOCTYPES].join(',')})`;

  const rows = [];
  let cursor = 0;          // keyset: the highest registry id examined so far
  let pages = 0;
  let scannedRows = 0;
  let lowestId = null;
  let highestId = null;
  let retryAdmitted = 0;
  let exhausted = false;

  while (pages < maxPages && rows.length < cap) {
    const reg = await q('GET',
      `lcc_cre_property_documents?select=id,cre_property_id,file_name,document_type,source_url,source` +
      `${typeFilter}&id=gt.${cursor}&order=id.asc&limit=${pageSize}`,
      null, { countMode: 'none' });
    if (!reg.ok || !Array.isArray(reg.data)) {
      return { ok: false, status: reg.status, detail: reg.data, stage: 'registry_page', scan_pages: pages };
    }
    pages++;
    if (!reg.data.length) { exhausted = true; break; }

    const ids = reg.data.map((r) => r.id);
    cursor = ids[ids.length - 1];
    scannedRows += ids.length;
    if (lowestId == null) lowestId = ids[0];
    highestId = cursor;

    const side = await q('GET',
      `lcc_cre_property_document_text?select=document_id,needs_ocr,reason,extracted_at` +
      `&extractor_version=eq.${encodeURIComponent(ver)}&document_id=in.(${ids.join(',')})`,
      null, { countMode: 'none' });
    // ⚠️ FAIL CLOSED. The old code treated a failed sidecar probe as "nothing is
    // done" and handed every row to the drain — which re-OCRs filled documents
    // and bills DocAI per page a second time. There is no spend guard that halts
    // a tick, so an unreadable probe must stop the scan, not widen it.
    if (!side.ok || !Array.isArray(side.data)) {
      return { ok: false, status: side.status, detail: side.data, stage: 'sidecar_probe', scan_pages: pages };
    }
    const byId = new Map(side.data.map((r) => [r.document_id, r]));

    for (const r of reg.data) {
      if (rows.length >= cap) break;
      const sc = byId.get(r.id);
      if (!sc) { rows.push(r); continue; }
      const stale = sc.needs_ocr
        && CRE_RETRY_REASONS.includes(sc.reason)
        && Date.parse(sc.extracted_at || 0) < staleBefore;
      if (stale) { rows.push(r); retryAdmitted++; }
    }

    if (reg.data.length < pageSize) { exhausted = true; break; }
  }

  return {
    ok: true,
    rows,
    scan_pages: pages,
    scan_rows: scannedRows,
    // TRUE only when the PAGE BUDGET stopped a still-unfinished walk. A short
    // batch with scan_capped=false really is an empty queue; with it true,
    // `eligible` is a FLOOR, not a total.
    scan_capped: !exhausted && rows.length < cap,
    scan_exhausted: exhausted,
    scan_lowest_id: lowestId,
    scan_highest_id: highestId,
    retry_admitted: retryAdmitted,
  };
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

export const __private = { fetchRegistryRow, upsertSidecar, sidecarStatus, writeDeferredMarker };
