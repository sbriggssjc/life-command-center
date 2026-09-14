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
// ⚠️ Since DOC1 a byte-fetch failure is no longer left UNpersisted — it writes a
// dated deferred-retry marker, because oldest-first would otherwise jam on the
// first unfetchable document forever (see writeDeferredMarker).
// ⚠️ Since DOC8/DOC10 `needs_ocr=true` covers two MORE states, and neither is
// terminal: a document longer than Google's synchronous OCR cap
// (`over_docai_page_cap`, no OCR attempted, no spend) and an OCR result too thin
// to be the document (`thin_ocr_result`, which used to be persisted needs_ocr=
// FALSE and read as a covered lease). Both re-admit on their own expiry.
// Deps injected → unit-testable with no network / no OpenAI key.
// ============================================================================

import { opsQuery, isOpsConfigured } from './ops-db.js';
import { extractDocumentText, meaningfulTextLen } from './document-text.js';

export const CRE_DOC_TEXT_VERSION = process.env.CRE_DOC_TEXT_VERSION || 'unit1_v1';

// ---------------------------------------------------------------------------
// DOC10 (2026-09-01) — A THIN OCR RESULT MUST NOT COUNT AS COVERED.
//
// The old rule persisted a thin result with needs_ocr=FALSE and merely tagged
// reason='thin_ocr_result', on the theory that "re-OCR wouldn't recover more."
// That theory was refuted by DOC8: these rows are thin because DocAI 502'd on
// its page cap and gpt-4o returned a fragment — re-OCR through a raised cap
// recovers the whole document.
//
// Worse, the tag was inert. BOTH consumers key on needs_ocr and nothing has ever
// read `reason`: gatherPropertyText admits on `needs_ocr=is.false&raw_text=not.is.null`,
// and v_lcc_cre_bov_ready counts a document covered on `AND NOT t.needs_ocr`. A
// 31-CHARACTER FRAGMENT SATISFIED BOTH — so BOV extract received it as though it
// were the lease, the property read *covered*, and it could never be retried
// because nothing distinguished it from a real extraction. That is a correctness
// defect, and it is worse than failing.
//
// A thin result now writes DOC1's dated negative marker (needs_ocr=true), which
// is invisible to both consumers and re-admits itself after CRE_RETRY_AFTER_HOURS.
// ⚠️ The fragment TEXT is kept, not nulled: it is the only surviving evidence of
// what the expensive tier returned, it is what makes the backfill reversible, and
// needs_ocr=true alone already hides the row from every consumer (verified by
// grepping every read of this table). DOC1's marker nulls raw_text only because a
// byte-fetch failure has no text to keep.
//
// ⚠️ THE FLOOR IS PAGE-AWARE, NOT A FLAT CHAR COUNT — a genuinely short one-page
// document is not thin. But `page_count` is NULL on 79 of 80 sidecar rows and
// `ocr_pages` only exists once DocAI has already succeeded, so a rule keyed on
// either is inert exactly where it is needed. The key that IS available is a
// pdf-parse page count taken at extraction time (pdfPageCountFromBuffer), which
// works on a scanned PDF with no text layer.
//
// Measured over all 22 OCR rows the lane has produced (2026-09-01):
//   - chars-per-page on the 6 DocAI successes: 601 / 1,172 / 1,514 / 2,492 /
//     2,494 / 3,313. The lowest is 3x the 200/page floor.
//   - the 19 gpt-4o rows carry NO page count (DocAI refused before counting), so
//     they fall to the unknown-pages floor. Their char_len distribution has a
//     4x gap with nothing in it: 31, 44, 44, 48, 49, 68, 116, 163, 186, 187,
//     188, 200 ... then 783, 2251, 2670, 3521, 4062, 7014, 8375. A 500 floor
//     sits inside that gap and separates 12 fragments from 7 real extractions.
// The unknown-pages floor is deliberately STRICTER than a known single page:
// "we do not know how long this is" on this lane means DocAI never answered,
// which means we are on the tier measured to produce fragments. The cost of
// being wrong is bounded — the document re-admits in 24 h and DOC8 means the
// next attempt usually gets a page count.
// ---------------------------------------------------------------------------

/** Minimum meaningful chars PER PAGE before an OCR result reads as real text. */
const OCR_MIN_CHARS_PER_PAGE = Number(process.env.CRE_OCR_MIN_CHARS_PER_PAGE || 200);

/** Absolute floor when the page count IS known (a 1-page doc is not exempt). */
const OCR_MIN_MEANINGFUL_CHARS = Number(process.env.CRE_OCR_MIN_CHARS || 120);

/** Floor when the page count is UNKNOWN. See the 4x gap measured above. */
const OCR_MIN_CHARS_UNKNOWN_PAGES = Number(process.env.CRE_OCR_MIN_CHARS_UNKNOWN_PAGES || 500);

/**
 * DOC8 — refuse OCR above this many pages rather than falling through to gpt-4o.
 * 30 is Google's synchronous cap in imageless mode (15 without it); the edge
 * function reports the cap in force on its GET health probe, so the two numbers
 * are checkable against each other rather than assumed equal. 0 disables.
 */
export const CRE_OCR_PAGE_CAP = Number(process.env.CRE_OCR_PAGE_CAP || 30);

// ---------------------------------------------------------------------------
// DOC18 (2026-09-02) — the long-document lane.
//
// `over_docai_page_cap` is still written by the ORDINARY drain exactly as DOC8
// wrote it: the pre-flight sees a document longer than one synchronous call can
// serve, spends nothing, and marks it. What DOC18 adds is a SECOND lane that
// picks those markers up and extracts the consumer's window as N cheap sync
// calls (30 from page 1 imageless + 15 per call after that — DOC17's measured
// contract). The ordinary lane is byte-identical: the window is opt-in per
// caller and the eligible/jobs modes never pass it.
//
// TWO CEILING REASONS, ON PURPOSE:
//   `over_docai_page_cap` — the window has NEVER been tried on this document
//                           (the route is off, or the long lane has not reached
//                           it). It is still the right terminal state.
//   `window_failed`       — the window RAN and produced nothing. A different
//                           fact, so the two are countable apart rather than one
//                           bucket that hides which is which.
// Both re-admit on the CEILING expiry for the ordinary lane; both are selected
// by the long lane, oldest-attempt-first.
// ---------------------------------------------------------------------------

/** How far into a long document to extract. 0 disables the whole route. */
export const CRE_OCR_WINDOW_PAGES = Number(process.env.CRE_OCR_WINDOW_PAGES || 50);

/**
 * Its own wall-clock budget, NOT the 22 s tick budget. Three DocAI calls measured
 * 10–20 s EACH (DOC17), so a 50-page window cannot fit in the ordinary tick — see
 * `handleCreDocTextTick`'s `longdoc` mode, which runs ONE document per tick.
 */
export const CRE_OCR_WINDOW_BUDGET_MS = Math.max(
  20000, Number(process.env.CRE_OCR_WINDOW_BUDGET_MS || 110000),
);

/** The meaningful-char floor an OCR result must clear at this page count. */
export function ocrThinFloor(pages) {
  if (Number.isFinite(pages) && pages > 0) {
    return Math.max(OCR_MIN_MEANINGFUL_CHARS, pages * OCR_MIN_CHARS_PER_PAGE);
  }
  return OCR_MIN_CHARS_UNKNOWN_PAGES;
}

/** Is this OCR result too thin to be the document? Pure; 0 floors disable it. */
export function isThinOcrResult({ meaningfulChars, pages } = {}) {
  const floor = ocrThinFloor(pages);
  if (!(floor > 0)) return false;
  return Number(meaningfulChars || 0) < floor;
}

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
export const CRE_RETRY_REASONS = Object.freeze(['fetch_failed', 'extract_error', 'thin_ocr_result']);
export const CRE_RETRY_AFTER_HOURS = Math.max(1, Number(process.env.CRE_DOC_TEXT_RETRY_AFTER_HOURS || 24));
const CRE_RETRY_AFTER_MS = CRE_RETRY_AFTER_HOURS * 3600 * 1000;

// DOC8 — a CEILING, not a transient. `over_docai_page_cap` says the document is
// longer than the synchronous OCR can serve; nothing about tomorrow changes that,
// so re-admitting it daily would park the 15-row batch on documents we already
// know we cannot process. It still EXPIRES — the same marker mechanism, a
// different expiry — so the lane self-clears if the cap is raised again or an
// async/batch tier is added, rather than becoming a permanent tombstone nobody
// revisits. Re-admission costs a byte fetch and a pdf-parse: ZERO OCR spend.
export const CRE_CEILING_REASONS = Object.freeze(['over_docai_page_cap', 'window_failed']);
export const CRE_CEILING_RETRY_AFTER_HOURS = Math.max(1, Number(process.env.CRE_DOC_TEXT_CEILING_RETRY_AFTER_HOURS || 720));
const CRE_CEILING_RETRY_AFTER_MS = CRE_CEILING_RETRY_AFTER_HOURS * 3600 * 1000;

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
      // DOC8: above Google's synchronous cap, stop with a named marker instead of
      // paying gpt-4o for a fragment. Opt-in per caller; the deed lane does not
      // set it and is unchanged.
      ocrPageCap: deps.ocrPageCap ?? CRE_OCR_PAGE_CAP,
      // DOC18: only the LONG-DOCUMENT lane sets this. Absent for the ordinary
      // eligible/jobs drain, which therefore behaves exactly as it does today.
      ocrPageWindow: deps.ocrPageWindow ?? null,
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
    const reason = ext.reason || 'no_text_layer';
    return {
      // DOC8: the over-cap refusal gets its OWN outcome so the tick can count it.
      // Folding it into `needs_ocr` would hide the whole point of the pre-flight —
      // "we did not spend on this, and here is exactly why" — in a bucket that
      // also holds "there is no text layer and no OCR is configured."
      outcome: reason === 'over_docai_page_cap' ? 'over_page_cap'
        : (reason === 'window_failed' ? 'window_failed' : 'needs_ocr'),
      row: {
        ...base,
        raw_text: null,
        method: null,
        needs_ocr: true,
        thin_text_layer: !!ext.thin_text_layer,
        char_len: 0,
        // The page count is the whole finding on an over-cap row; record it.
        page_count: Number.isFinite(ext.page_count) ? ext.page_count : null,
        reason,
      },
      // DOC18: WHY the window produced nothing (a failed segment, the byte cap, an
      // ignored selector). ⚠️ It rides the TICK RESPONSE, never the sidecar row —
      // there is no such column, and a payload key the table does not have 400s
      // every write with PGRST204. Never used to size a retry (trap 1).
      window_reason: ext.window_reason || null,
    };
  }

  // Per-page text for clause_refs page anchors. Unit 1 currently returns a page
  // COUNT (ext.ocr_pages) from the DocAI layout tier but not the per-page array —
  // so we accept any of the field names Unit 1 / the DocAI wrapper would carry it
  // under when that passthrough lands, and fall back to form-feed splitting.
  const providedPages = ext.pages || ext.ocr_page_texts || ext.page_texts || null;
  const pages = derivePages(ext.text, providedPages);

  // ── DOC10 — the thin-OCR FLOOR (was a tag nothing read; now a marker) ──────
  // Page count, best available: what the extractor learned (DocAI's own count, or
  // the count the cheap tier reported before refusing) then the derived pages.
  // null means UNKNOWN, never 0 — ocrThinFloor treats the two differently.
  const knownPages = Number.isFinite(ext.ocr_pages) ? ext.ocr_pages
    : (Number.isFinite(ext.page_count) ? ext.page_count : (pages.length || null));
  const meaningful = meaningfulTextLen(ext.text);
  // ⚠️ The thin floor keys on the pages we actually READ (`knownPages` prefers
  // ocr_pages), which is right: "is this text too thin to be what we extracted".
  const thinOcr = ext.method === 'ocr' && isThinOcrResult({ meaningfulChars: meaningful, pages: knownPages });

  // ⚠️ DOC18 — BUT THE PERSISTED `page_count` IS THE DOCUMENT'S LENGTH, AND THE
  // TWO USED TO BE THE SAME NUMBER. Before the window they were: DocAI either
  // read the whole document or refused it. A windowed extract reads 50 pages of
  // 141, so `knownPages` (50) is the billed count and writing it to `page_count`
  // would record a 141-page lease as 141 -> 50 and erase the very fact that makes
  // it a partial. `ocr_pages` = what we were BILLED for; `page_count` = how long
  // the document is. Caught by the DOC18 guard, not by reading the code.
  const documentPages = Number.isFinite(ext.page_count) ? ext.page_count : knownPages;

  // ── DOC18 — THE THIRD STATE: complete for the consumer, incomplete for the
  // document. A 141-page lease read to page 50 is a PARTIAL. It is NOT a ceiling
  // marker (needs_ocr stays false, so both consumers can read the text it DOES
  // have) and it does NOT re-admit (the scan only re-admits needs_ocr rows), but
  // it must never read as complete coverage — hence the columns and the reason.
  const windowed = ext.ocr_tier === 'cloud_cheap_window';
  const partial = windowed && !!ext.partial_extract;

  return {
    // A thin OCR result is NOT an extraction, so it does not report as one.
    outcome: thinOcr ? 'thin_ocr'
      : (partial ? 'partial_window' : (ext.method === 'ocr' ? 'ocr' : 'text_extracted')),
    row: {
      ...base,
      // ⚠️ The fragment is KEPT. needs_ocr=true alone hides it from both
      // consumers (gatherPropertyText requires needs_ocr=is.false AND
      // raw_text=not.is.null; v_lcc_cre_bov_ready requires NOT needs_ocr), and
      // keeping it is what makes the marker auditable and reversible.
      raw_text: ext.text,
      method: ext.method || null,
      ocr_tier: ext.ocr_tier || null,
      ocr_engine: ext.ocr_engine || null,
      ocr_confidence: typeof ext.ocr_confidence === 'number' ? ext.ocr_confidence : null,
      ocr_pages: Number.isFinite(ext.ocr_pages) ? ext.ocr_pages : (pages.length || null),
      page_count: documentPages,
      pages: pages.length ? pages : null,
      thin_text_layer: !!ext.thin_text_layer,
      char_len: ext.text.length,
      // THE FIX. A thin result now carries DOC1's dated negative marker, so it is
      // invisible to BOTH consumers and re-admits itself after CRE_RETRY_AFTER_HOURS
      // — instead of a 31-character fragment reading as a covered lease forever.
      needs_ocr: thinOcr,
      // gpt-4o transcription (tier 'cloud') has no page anchors; a thin OCR result
      // is low-confidence; a windowed extract stops at the consumer's window.
      // Either way, tag it so Unit 4 flags citation risk.
      reason: thinOcr ? 'thin_ocr_result'
        : (partial ? 'partial_page_window'
          : (ext.ocr_tier === 'cloud' ? 'no_page_anchors_gpt4o' : null)),
      // ⚠️ THESE KEYS ARE ADDED ONLY ON A WINDOWED EXTRACT. The ordinary drain's
      // payload is byte-identical to today's, so if the additive migration has
      // not landed yet its writes cannot 400 on PGRST204 — the deploy-ordering
      // rule with a belt as well as braces.
      ...(windowed ? {
        pages_covered: Number.isFinite(ext.pages_covered) ? ext.pages_covered : null,
        page_ranges: Array.isArray(ext.page_ranges) ? ext.page_ranges : null,
        partial_extract: partial,
      } : {}),
    },
    // Tick telemetry only — never persisted.
    window: windowed ? {
      calls: ext.window_calls ?? null,
      target_pages: ext.window_target_pages ?? null,
      pages_covered: ext.pages_covered ?? null,
      page_ranges: ext.page_ranges ?? null,
      page_gaps: ext.page_gaps ?? null,
      duplicate_pages: ext.duplicate_pages ?? null,
      incomplete: !!ext.window_incomplete,
      replanned: !!ext.window_replanned,
    } : null,
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
    // DOC8/DOC10: how long the document is, distinct from how many pages we were
    // BILLED for. It is the whole finding on an over-cap row and it is what the
    // thin floor keyed on, so the tick must be able to show it.
    page_count: built.row.page_count ?? null,
    needs_ocr: !!built.row.needs_ocr,
    reason: built.row.reason || null,
    // DOC18 — the honest shape of a long-document extract.
    window_reason: built.window_reason || null,
    pages_covered: built.row.pages_covered ?? null,
    page_ranges: built.row.page_ranges ?? null,
    partial_extract: !!built.row.partial_extract,
    window: built.window || null,
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
  const ceilingStaleBefore = now - CRE_CEILING_RETRY_AFTER_MS;

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
      // Two expiries, ONE mechanism. A transient marker (fetch_failed / extract_error
      // / thin_ocr_result) re-admits after CRE_RETRY_AFTER_HOURS; a CEILING marker
      // (over_docai_page_cap — the document is longer than the synchronous OCR can
      // serve) re-admits after CRE_CEILING_RETRY_AFTER_HOURS, so a known-unservable
      // document cannot occupy the 15-row batch every 30 minutes forever while still
      // self-clearing if the cap or the tiering changes.
      const readmitAfter = sc.needs_ocr && CRE_CEILING_REASONS.includes(sc.reason)
        ? ceilingStaleBefore
        : (sc.needs_ocr && CRE_RETRY_REASONS.includes(sc.reason) ? staleBefore : null);
      const stale = readmitAfter != null && Date.parse(sc.extracted_at || 0) < readmitAfter;
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
 * DOC18 — THE LONG-DOCUMENT QUEUE. Sidecar rows the ordinary drain has already
 * marked as beyond one synchronous call, joined back to their registry rows.
 *
 * ⚠️ ORDERED BY `extracted_at` ASC, AND THAT IS THE CURSOR. A window attempt that
 * produces nothing REFRESHES the marker's `extracted_at` (writeDeferredMarker),
 * so the head of this queue rotates instead of re-selecting the same unservable
 * document every tick — the P135/P136 class, third-hand: *what makes a target
 * stop being selected?* Here the answer is "it was attempted", recorded as a
 * date, not "it produced output". A document the window SUCCEEDS on leaves the
 * queue permanently, because the sidecar flips to needs_ocr = false.
 *
 * Selects BOTH ceiling reasons: `over_docai_page_cap` (never attempted) and
 * `window_failed` (attempted, nothing came back). Never touches a filled row.
 */
export async function fetchOverCapCreDocs({ limit = 1, version } = {}, deps = {}) {
  const q = deps.opsQuery || opsQuery;
  const ver = version || CRE_DOC_TEXT_VERSION;
  const cap = Math.min(25, Math.max(1, limit));

  const side = await q('GET',
    `lcc_cre_property_document_text?select=document_id,page_count,reason,extracted_at,char_len` +
    `&extractor_version=eq.${encodeURIComponent(ver)}` +
    `&needs_ocr=is.true&reason=in.(${CRE_CEILING_REASONS.join(',')})` +
    `&order=extracted_at.asc&limit=${cap}`,
    null, { countMode: 'none' });
  if (!side.ok || !Array.isArray(side.data)) {
    return { ok: false, status: side.status, detail: side.data, stage: 'ceiling_probe' };
  }
  if (!side.data.length) return { ok: true, rows: [], markers: [] };

  const ids = side.data.map((r) => r.document_id);
  const reg = await q('GET',
    `lcc_cre_property_documents?select=id,cre_property_id,file_name,document_type,source_url,source` +
    `&id=in.(${ids.join(',')})`,
    null, { countMode: 'none' });
  // FAIL CLOSED (the fetchEligibleCreDocs rule): a failed registry read must not
  // be reported as an empty queue, or a stalled lane reads exactly like a drained one.
  if (!reg.ok || !Array.isArray(reg.data)) {
    return { ok: false, status: reg.status, detail: reg.data, stage: 'registry_lookup' };
  }
  const byId = new Map(reg.data.map((r) => [r.id, r]));
  // Preserve the marker's oldest-first order; a marker whose registry row has
  // disappeared is reported, never silently dropped.
  const rows = [];
  const missing = [];
  for (const m of side.data) {
    const r = byId.get(m.document_id);
    if (r) rows.push({ ...r, _marker: m });
    else missing.push(m.document_id);
  }
  return { ok: true, rows, markers: side.data, registry_missing: missing };
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
