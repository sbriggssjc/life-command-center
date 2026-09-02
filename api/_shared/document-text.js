// ============================================================================
// Shared document text / OCR foundation — R58 Unit 1
// Life Command Center
//
// The ONE place that turns a property_documents row's bytes into TEXT. Every
// downstream parser (the deed parser — Unit 2, the lease extractor's zero-text
// fallback — Unit 3, and a future rent-roll / dd / bov extractor — Unit 4) reads
// `property_documents.raw_text`; nothing populated it until this module. It is a
// thin reuse layer over the machinery the OM intake pipeline already proved:
//   • digital text  → pdf-parse (the same createRequire dance intake-extractor
//                     uses to dodge pdf-parse 1.1.1's broken-under-ESM debug block)
//   • scanned PDF   → invokeVisionExtractionAI (the SAME gpt-4o vision OCR that
//                     rescued the zero-text Fresenius OM), prompted to transcribe
//                     VERBATIM instead of extracting structured JSON.
//
// Byte source is URL-shape aware so the SAME function serves both channels:
//   • absolute https URL (CoStar CDN deeds — ahprd1cdn.csgpimgs.com/…)  → direct fetch
//   • SharePoint server-relative ref (folder-feed leases)              → Get-file PA flow
//
// Pure-ish + deps-injected so the worker/parsers are unit-testable without the
// network or an OpenAI key. No writes here — callers persist raw_text.
// ============================================================================

import { createRequire } from 'module';
import { fetchSharepointBytes } from './storage-adapter.js';
import { invokeVisionExtractionAI } from './ai.js';
import { sniffOfficeKind, extractOfficeText } from './office-text.js';

// pdf-parse 1.1.1 runs a debug block at import time that throws under pure ESM;
// createRequire defers the require to call time and sidesteps it (the exact
// pattern intake-extractor.js uses).
const nodeRequire = createRequire(import.meta.url);

// Same OCR byte cap the OM extractor uses (~12 MB) so a huge scan can't blow the
// function budget. A doc over the cap is reported needs_ocr (not silently lost).
const OCR_MAX_BYTES = Number(process.env.INTAKE_OCR_MAX_BYTES || 12_000_000);

const FETCH_TIMEOUT_MS = Number(process.env.DOC_TEXT_FETCH_TIMEOUT_MS || 30000);

// UW#6 — a scanned deed/lease often has a thin text layer (a recording stamp,
// a page number, a few OCR-bleed glyphs) that pdf-parse returns as a tiny
// non-empty string. Treating that as "text_extracted" marks the doc done with
// NOTHING and never routes it to OCR (the 32/113-char bug). A PDF whose
// MEANINGFUL (whitespace-stripped) text is below this floor is treated as a
// scanned page → OCR fallback / needs_ocr. Only applies to PDFs; text/* docs
// are taken at face value. 0 disables the floor.
export const DOC_TEXT_MIN_CHARS = Number(process.env.DOC_TEXT_MIN_CHARS || 200);

/** Whitespace-stripped length — the "meaningful char" count the OCR floor uses. */
export function meaningfulTextLen(s) {
  return String(s || '').replace(/\s+/g, '').length;
}

/** True for an absolute http(s) URL (a vendor CDN download), false for a SharePoint ref. */
export function isAbsoluteUrl(u) {
  return /^https?:\/\//i.test(String(u || ''));
}

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch the document bytes. Resolution order (UW#6-REV):
 *   1. `storagePath` — bytes in a Supabase Storage bucket (the durable
 *      source-of-record written at sidebar capture time). Tried FIRST because the
 *      CoStar CDN `source_url` carries a short-lived session token that dies
 *      server-side — the whole reason R58's URL-only re-fetch was never drainable.
 *   2. absolute `sourceUrl` — direct vendor download (only works inside the live
 *      token window, e.g. a doc captured moments ago that hasn't been offloaded).
 *   3. SharePoint server-relative ref → the Phase-1 "Get file content" PA flow.
 * Returns { ok, buffer, contentType, via } or { ok:false, status, detail }.
 */
export async function fetchDocBytes({ sourceUrl, storageRef, storagePath, storageGet, fetchImpl } = {}) {
  // 1. Storage-first: durable bytes, always fetchable with the project key.
  if (storagePath && typeof storageGet === 'function') {
    const sg = await storageGet(storagePath);
    if (sg && sg.ok && sg.buffer) {
      return { ok: true, buffer: sg.buffer, contentType: sg.contentType || null, via: 'storage' };
    }
    // Storage miss is recorded but we still try the URL (token may still be live
    // right after capture). A storage row that 404s is a real problem, surfaced
    // via the via/detail on the eventual failure.
  }
  // An absolute vendor URL takes priority — it's the direct download. A bare
  // server-relative ref falls to the SharePoint Get flow.
  if (sourceUrl && isAbsoluteUrl(sourceUrl)) {
    const f = fetchImpl || ((u, o) => fetchWithTimeout(u, o, FETCH_TIMEOUT_MS));
    let r;
    try {
      r = await f(sourceUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (LCC document-text)' } });
    } catch (err) {
      return { ok: false, status: 0, detail: `fetch_threw:${err?.message || err}` };
    }
    if (!r || !r.ok) return { ok: false, status: r?.status || 0, detail: 'fetch_non_ok' };
    const buffer = Buffer.from(await r.arrayBuffer());
    return { ok: true, buffer, contentType: r.headers?.get?.('content-type') || null, via: 'url' };
  }
  const ref = storageRef || sourceUrl;
  if (ref) {
    const sp = await fetchSharepointBytes({
      storageRef: ref,
      fetchImpl: fetchImpl || ((u, o) => fetchWithTimeout(u, o, FETCH_TIMEOUT_MS)),
    });
    if (!sp.ok) return { ok: false, status: sp.status || 0, detail: sp.detail || 'sharepoint_fetch_failed' };
    return { ok: true, buffer: sp.buffer, contentType: sp.contentType || null, via: 'sharepoint' };
  }
  return { ok: false, status: 0, detail: 'no_source_url_or_ref' };
}

/** Digital PDF text via pdf-parse. Returns '' on a scanned (no text layer) PDF or parse error. */
export async function pdfTextFromBuffer(buffer) {
  try {
    const pdfParse = nodeRequire('pdf-parse');
    const parsed = await pdfParse(buffer);
    return (parsed?.text || '').trim();
  } catch (err) {
    console.warn('[document-text] pdf-parse failed:', err?.message);
    return '';
  }
}

/**
 * DOC8 — how many pages does this PDF have? pdf-parse walks the page tree, so it
 * answers for a SCANNED pdf with no text layer too, which is exactly the
 * population that reaches the OCR tiers.
 *
 * ⚠️ This is the only page count anybody has BEFORE spending. The sidecar's
 * `page_count` column is NULL on 79 of 80 rows and `ocr_pages` only exists when
 * DocAI already succeeded — so a rule keyed on either is inert precisely where
 * it is needed. Returns null (never 0) when the count cannot be read: unknown is
 * not zero, and a 0-page PDF is a different, real answer.
 */
export async function pdfPageCountFromBuffer(buffer) {
  try {
    const pdfParse = nodeRequire('pdf-parse');
    const parsed = await pdfParse(buffer);
    const n = Number(parsed?.numpages);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (err) {
    console.warn('[document-text] pdf-parse page count failed:', err?.message);
    return null;
  }
}

/**
 * OCR a scanned PDF to raw VERBATIM text via the vision model (gpt-4o). Reuses
 * the OM pipeline's invokeVisionExtractionAI but with a transcription prompt
 * (not the structured-JSON extraction prompt) so the result is feedable to the
 * regex deed parser / the lease extractor's text prompt. Gated on OPENAI_API_KEY
 * (invokeVisionExtractionAI returns 503 without it) + a byte cap. Never throws.
 */
export async function ocrPdfToText({ buffer, mediaType, ocrImpl } = {}) {
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty_buffer' };
  if (buffer.length > OCR_MAX_BYTES) {
    return { ok: false, reason: 'over_ocr_cap', bytes: buffer.length };
  }
  const base64 = Buffer.from(buffer).toString('base64');
  const prompt =
    'Transcribe ALL text from this document VERBATIM, top to bottom, preserving ' +
    'the reading order. Include every name, number, date, dollar amount, parcel/APN, ' +
    'and recording stamp exactly as written. Do NOT summarize, interpret, or add ' +
    'commentary — output ONLY the raw transcribed text.';
  let r;
  try {
    r = await (ocrImpl || invokeVisionExtractionAI)({
      prompt,
      base64,
      mediaType: mediaType || 'application/pdf',
      filename: 'document.pdf',
    });
  } catch (err) {
    return { ok: false, reason: `ocr_threw:${err?.message || err}` };
  }
  if (!r || !r.ok) return { ok: false, reason: 'ocr_non_ok', status: r?.status || 0 };
  const text =
    r.data?.response ||
    r.data?.content ||
    (typeof r.data === 'string' ? r.data : '') ||
    '';
  const trimmed = String(text).trim();
  if (!trimmed) return { ok: false, reason: 'ocr_empty' };
  return { ok: true, text: trimmed, model: r.data?.model || null };
}

// ---------------------------------------------------------------------------
// UW#4 / UW#4b — tiered OCR for the LEASE path (lease-extractor.js is the only
// caller; the R58 deed path uses ocrPdfToText directly, so it is untouched).
//
// Engine economics (grounded 2026-06-20): gpt-4o vision is the most EXPENSIVE
// OCR path by 6-14× and purpose-built OCR is near-free at our volume. So the
// escalation order is:
//
//   Tier 1 — FREE local engine (Surya / PaddleOCR / ocrmypdf-Tesseract). Runs
//            OUT OF PROCESS on the workstation drainer (the binary isn't in the
//            Railway image and a 50-page scan blows the per-tick budget); it
//            supplies the recovered text via the supplied-`ocrText` path. On the
//            server it is injected (`deps.freeOcr`), off by default.
//   Tier 2 — CHEAP CLOUD (Google Document AI / Azure DI Read, ~$1.50/1k pages).
//            The PREFERRED paid tier — 6-14× cheaper than gpt-4o for no OCR-
//            quality loss. Wired through a config'd HTTP seam (`ocrCloudCheap`,
//            `OCR_CLOUD_OCR_URL`) so no new always-on server dependency / SDK.
//   Tier 3 — gpt-4o vision LAST RESORT, explicit opt-in ONLY
//            (`OCR_CLOUD_PROVIDER=gpt4o` or `OCR_CLOUD_GPT4O_LASTRESORT=true`).
//            Never the default — at our volume it is 6-14× the dedicated OCR.
//
// Default = ZERO SPEND, free-only: with no cheap provider configured AND no
// gpt-4o last-resort flag, the paid tiers are inert and a free miss returns
// ok:false (the workstation free OCR drains the corpus; paid spend is opt-in /
// blessed). This is the deliberate, sized-spend posture for the lease backfill.
//
// Returns { ok, text, tier:'free'|'free_low_conf'|'cloud_cheap'|'cloud',
//           confidence, engine }. `confidence` is 0-100 for the free tier (and
// for cheap-cloud when the provider reports it), null for gpt-4o (no signal),
// so a low-confidence transcription can be FLAGGED rather than trusted blind.
//
// `OCR_FREE_CONFIDENCE_MIN` — below this mean word confidence a free
// transcription is treated as a MISS and escalated; 0 disables the floor.
// `OCR_CLOUD_ESCALATION` — master kill-switch (default on). Set 'false' to force
// a pure-free drain with ZERO paid OCR of any kind.
// `OCR_CLOUD_PROVIDER` — selects the paid tier: google_docai | azure_di |
// webhook (all via OCR_CLOUD_OCR_URL) | gpt4o. Unset (default) ⇒ cheap when an
// OCR_CLOUD_OCR_URL is configured, else NONE (zero spend) — gpt-4o is never
// auto-selected.
// `OCR_CLOUD_OCR_URL` (+ optional `OCR_CLOUD_OCR_KEY`) — the cheap-cloud HTTP
// endpoint (Document AI / Azure DI Read behind a thin flow, the SHAREPOINT_*
// rollout pattern). `OCR_CLOUD_GPT4O_LASTRESORT='true'` allows gpt-4o after a
// cheap-cloud miss.
// ---------------------------------------------------------------------------
const OCR_FREE_CONFIDENCE_MIN = Number(process.env.OCR_FREE_CONFIDENCE_MIN || 55);
const OCR_CLOUD_OCR_TIMEOUT_MS = Number(process.env.OCR_CLOUD_OCR_TIMEOUT_MS || 120000);

/**
 * Cheap-cloud OCR via a config'd HTTP seam (`OCR_CLOUD_OCR_URL`). Point it at a
 * thin Google Document AI / Azure DI Read flow (the same webhook-adapter pattern
 * as SHAREPOINT_FETCH_URL / find_contacts_by_account) so the server takes no new
 * SDK / always-on dependency. POSTs base64 + media_type + provider label; reads
 * back `{ text, confidence?, engine? }`. Returns `cloud_ocr_unconfigured` (a
 * no-op, ZERO spend) when no URL is set — that is the default. Never throws.
 */
export async function ocrCloudCheap({ buffer, mediaType, fetchImpl, pageRange = null } = {}) {
  const url = process.env.OCR_CLOUD_OCR_URL;
  if (!url) return { ok: false, reason: 'cloud_ocr_unconfigured' };
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty_buffer' };
  if (buffer.length > OCR_MAX_BYTES) return { ok: false, reason: 'over_ocr_cap', bytes: buffer.length };
  const provider = String(process.env.OCR_CLOUD_PROVIDER || 'webhook').toLowerCase();
  const f = fetchImpl || ((u, o) => fetchWithTimeout(u, o, OCR_CLOUD_OCR_TIMEOUT_MS));
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OCR_CLOUD_OCR_KEY) headers.Authorization = `Bearer ${process.env.OCR_CLOUD_OCR_KEY}`;
  let r;
  try {
    r = await f(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content_base64: Buffer.from(buffer).toString('base64'),
        // `mime_type` is the documented wrapper field (UW#4c docai-ocr); `media_type`
        // is the original seam field — send both so the wrapper is tolerant.
        mime_type: mediaType || 'application/pdf',
        media_type: mediaType || 'application/pdf',
        provider,
        // DOC18 — the page selector. ABSENT unless a caller asks for one, so the
        // ordinary drain's request body is byte-identical to what it sends today.
        // ⚠️ An unknown body field is IGNORED SILENTLY by the wrapper, and a
        // silently-ignored selector returns pages 1..N and reads as a clean
        // success. That is why the wrapper echoes `page_range_applied` and why
        // the window verifies the PAGE NUMBERS it got back (DOC17: the page
        // numbers are the evidence, not the page count).
        ...(pageRange ? { page_range: pageRange } : {}),
      }),
    });
  } catch (err) {
    return { ok: false, reason: `cloud_ocr_threw:${err?.message || err}` };
  }
  if (!r || !r.ok) return { ok: false, reason: 'cloud_ocr_non_ok', status: r?.status || 0 };
  let data = null;
  try { data = await r.json(); } catch { return { ok: false, reason: 'cloud_ocr_bad_json' }; }
  // The wrapper may report ok:false with a structured reason (e.g. over_page_cap)
  // so the tiered seam can fall through to the gpt-4o last resort.
  // DOC8: an over_page_cap failure carries the page count Google names in its own
  // error ("exceed the limit: 15 got 19"). Nothing was processed, so that is the
  // ONLY count available on this path — carry it rather than discarding it.
  if (data && data.ok === false) {
    return {
      ok: false, reason: data.reason || 'cloud_ocr_failed', status: data.status || 0,
      pages: Number.isFinite(data.pages) ? data.pages : null,
      // ⚠️ DOC18 TRAP 1 — `page_limit` is the MAXIMUM ACHIEVABLE limit, not the one
      // in force. DOC17 row 4: a 30-page selection that is refused because the
      // applicable limit is 15 reports `page_limit: "30"`. It is carried for
      // REPORTING only; nothing in the window route may size a call from it, or it
      // retries the same rejected selection forever.
      page_limit: Number.isFinite(data.page_limit) ? data.page_limit : null,
      // Which mode actually served the call. A first segment planned at 30 pages
      // is only valid when imageless applied; if the processor rejected the field
      // the wrapper falls back and the real cap is 15 (see planPageWindow).
      imageless: typeof data.imageless === 'boolean' ? data.imageless : null,
      page_range_applied: data.page_range_applied ?? null,
    };
  }
  const text = String(data?.text || data?.content || data?.transcription || '').trim();
  if (!text) return { ok: false, reason: 'cloud_ocr_empty' };
  const confidence = typeof data?.confidence === 'number' ? data.confidence : null;
  // pages drives the per-page cost log (Document AI bills per page, UW#4c).
  const pages = Number.isFinite(data?.pages) ? data.pages : null;
  // R58 Unit 4 — per-page text for page-anchored citations (lease clause_refs). The
  // DocAI layout tier can return one text block per page; when the wrapper includes
  // it (`page_texts`/`pages_text`, or a `pages` value that is an ARRAY rather than a
  // count), pass it through as `pageTexts`. Purely additive: null when absent, so the
  // deed/OM callers are unchanged.
  const pageTexts = normalizePageTexts(data?.page_texts || data?.pages_text || (Array.isArray(data?.pages) ? data.pages : null));
  return {
    ok: true, text, confidence, pages, pageTexts, engine: data?.engine || provider,
    // DOC18 — what the wrapper says it applied. null on a build that predates the
    // selector, which is how the window tells "ignored" from "honoured".
    page_range_applied: data?.page_range_applied ?? null,
    imageless: typeof data?.imageless === 'boolean' ? data.imageless : null,
  };
}

/** Coerce a per-page OCR payload into [{page:int, text:string}] (or null). */
export function normalizePageTexts(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = [];
  raw.forEach((p, i) => {
    if (p == null) return;
    if (typeof p === 'string') { out.push({ page: i + 1, text: p }); return; }
    const text = String(p.text ?? p.content ?? p.layout?.text ?? '');
    out.push({ page: Number(p.page ?? p.page_number ?? p.pageNumber ?? i + 1), text });
  });
  return out.length ? out : null;
}

/** Which paid tier the cheap-vs-gpt4o policy selects (telemetry-only, no I/O). */
export function cloudOcrProviderMode() {
  const p = String(process.env.OCR_CLOUD_PROVIDER || '').toLowerCase();
  if (p === 'gpt4o' || p === 'openai' || p === 'gpt-4o') return 'gpt4o';
  if (p === 'google_docai' || p === 'azure_di' || p === 'webhook' || p === 'cheap') return 'cheap';
  // Unlabeled: a configured cheap URL is the preferred paid tier; else none.
  if (process.env.OCR_CLOUD_OCR_URL) return 'cheap';
  return 'none';
}

// ---------------------------------------------------------------------------
// DOC18 (2026-09-02) — THE THREE-CALL SYNC WINDOW.
//
// DOC17 probed a real 316-page PDF through this same processor, seven arms, and
// settled the contract this section encodes:
//
//   whole document, no selector, imageless off   ❌ "30 got 316"
//   individualPageSelector [31..45]  (15 pp)     ✅ 200 · pages [31..45] · 65,297 chars
//   fromStart 15  (positive control)             ✅ 200 · pages [1..15]
//   individualPageSelector [31..61]  (31 pp)     ❌ "30 got 31"   <- refused for being 31,
//                                                                    NOT for being part of 316
//   individualPageSelector [31..60]  (30 pp)     ❌ "in non-imageless mode … limit: 15 got 30"
//   individualPageSelector [31..60]  imageless   ❌ "At most 15 pages in one call please."
//   fromStart 30, imageless                      ✅ 200 · pages [1..30] · 151,776 chars
//
// THE RULE: **30 pages per call contiguously from page 1 (imageless); 15 pages
// per call anywhere else.** The document's total page count never enters the
// arithmetic. So the consumer's window is reached with N cheap SYNCHRONOUS
// calls — no GCS bucket, no IAM grant, no LRO job table, no confidentiality
// decision (that is DOC14, and this route exists to make it unnecessary).
//
// ⚠️ TRAP 3 (DOC17 §3): the base limit is 15 and the BASELINE arm reported 30.
// Reading only that one arm concludes the base cap is 30 and produces a route
// that fails on EVERY non-page-1 call. These two constants come from the
// seven-arm table above, not from any single error's metadata — one error's
// metadata is not a limits table.
// ---------------------------------------------------------------------------

/** Pages per call when the selection starts at page 1 AND imageless mode applied. */
export const DOCAI_FIRST_SEGMENT_PAGES = 30;

/** Pages per call for any selection that does NOT start at page 1. THE BASE LIMIT. */
export const DOCAI_RANGE_SEGMENT_PAGES = 15;

// How far into a document it is worth spending. ⚠️ NOT a round number somebody
// liked: it is DERIVED from the consumer. `bov-extract.js` slices the lease text
// at LEASE_TEXT_SLICE_CHARS (90,000) and this corpus runs ~1,800 chars/page, so
// ~50 pages IS the whole useful window and every page past it is money the
// consumer throws away. `test/doc18-three-call-sync-extract.test.mjs` binds the
// two: if the consumer's slice moves and this does not, that guard goes RED.
export const OCR_CORPUS_CHARS_PER_PAGE = Number(process.env.OCR_CORPUS_CHARS_PER_PAGE || 1800);
export const OCR_WINDOW_TARGET_PAGES = Number(process.env.CRE_OCR_WINDOW_PAGES || 50);

/**
 * Plan the calls for a page window. Segment 1 is `fromStart` (the ONLY shape
 * measured to carry 30 pages); every later segment is an explicit page list of
 * at most DOCAI_RANGE_SEGMENT_PAGES.
 *
 * `totalPages` null (unknown) plans the full target — a document shorter than
 * the plan simply returns fewer pages on the last call, which the caller reads
 * from the PAGE NUMBERS rather than assuming.
 *
 * Pure. No I/O, no spend. 141 pages at target 50 ⇒ [1-30] [31-45] [46-50].
 */
export function planPageWindow(totalPages, {
  targetPages = OCR_WINDOW_TARGET_PAGES,
  firstSegmentPages = DOCAI_FIRST_SEGMENT_PAGES,
  segmentPages = DOCAI_RANGE_SEGMENT_PAGES,
} = {}) {
  const target = Math.floor(Number(targetPages));
  if (!Number.isFinite(target) || target < 1) return [];
  const total = Number.isFinite(totalPages) && totalPages > 0 ? Math.floor(totalPages) : null;
  const last = total == null ? target : Math.min(total, target);
  const first = Math.max(1, Math.floor(Number(firstSegmentPages) || 1));
  const rest = Math.max(1, Math.floor(Number(segmentPages) || 1));
  const segments = [];
  let from = 1;
  while (from <= last && segments.length < 64) {
    const size = from === 1 ? first : rest;
    const to = Math.min(last, from + size - 1);
    segments.push({ from, to, pages: to - from + 1, from_start: from === 1 });
    from = to + 1;
  }
  return segments;
}

/** Collapse a sorted list of page numbers into inclusive [from,to] ranges. */
export function pageNumbersToRanges(pages) {
  const sorted = [...new Set((pages || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  const ranges = [];
  for (const n of sorted) {
    const tail = ranges[ranges.length - 1];
    if (tail && n === tail[1] + 1) tail[1] = n;
    else ranges.push([n, n]);
  }
  return ranges;
}

/** The page numbers present between min and max that were NOT returned. */
export function pageGaps(pages) {
  const sorted = [...new Set((pages || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  if (sorted.length < 2) return [];
  const missing = [];
  for (let n = sorted[0]; n <= sorted[sorted.length - 1]; n++) if (!sorted.includes(n)) missing.push(n);
  return pageNumbersToRanges(missing);
}

/**
 * THE ROUTE. Extract the consumer's page window from a document that is longer
 * than one synchronous call can serve, as N cheap calls concatenated IN PAGE
 * ORDER into one contiguous text.
 *
 * It calls the CHEAP TIER DIRECTLY (`ocrCloudCheap`), never `ocrPdfToTextTiered`,
 * so ⛔ **gpt-4o is unreachable from this path by construction** — measured at
 * 9.3× less text on exactly this class of document (DOC8/DOC9).
 *
 * ⚠️ THE SEAM IS ASSEMBLED BY PAGE NUMBER, NOT BY BLOB. Document AI returns the
 * REAL page numbers for a selected range (DOC17 read `[31..45]` back), so the
 * concatenation is a map keyed on page number:
 *   • duplication is structurally impossible — a page number is seen once
 *   • a gap is DETECTED and reported (`page_gaps`) rather than inferred from a
 *     plausible total length, which is not evidence of a clean seam
 *   • `pages_covered` and `page_ranges` describe what came BACK, never what was
 *     asked for
 *
 * ⚠️ AND IT VERIFIES THE SELECTOR WAS HONOURED. An unknown body field is ignored
 * SILENTLY by the wrapper, and a silently-ignored selector returns pages 1..N —
 * which reads as a clean success and would make every segment a duplicate of the
 * first. A segment whose returned page numbers fall outside the range requested
 * is rejected as `page_range_ignored`.
 *
 * ⚠️ PARTIAL SUCCESS IS KEPT, NEVER DISCARDED. If segment 3 of 3 fails we return
 * pages 1–45 and say so (`window_incomplete`). Throwing away pages already paid
 * for is what makes the next attempt double-charge.
 *
 * ⚠️ NOTHING HERE SIZES A CALL FROM AN ERROR'S `page_limit` (DOC17 trap 1: it
 * reports the MAXIMUM ACHIEVABLE limit, not the one in force — a 30-page refusal
 * whose applicable limit is 15 says `page_limit: "30"`, and a caller that acts on
 * it retries the same rejected selection forever). The ONE re-plan this function
 * performs keys on `imageless`, a fact about what the wrapper SENT.
 *
 * Returns { ok, text, pageTexts, pages_covered, page_ranges, page_gaps,
 *           partial, window_incomplete, calls, segments, confidence, reason? }.
 * Never throws.
 */
export async function ocrCloudCheapWindow(
  { buffer, mediaType, totalPages = null, targetPages = OCR_WINDOW_TARGET_PAGES, fetchImpl, deadline = null } = {},
  deps = {},
) {
  const call = deps.cloudCheapOcr || ocrCloudCheap;
  const budgetLeft = () => deadline == null || Date.now() < deadline;

  let plan = planPageWindow(totalPages, { targetPages });
  if (!plan.length) return { ok: false, reason: 'window_target_zero', calls: 0, segments: [] };

  const segments = [];
  let calls = 0;
  let replanned = false;

  for (let i = 0; i < plan.length; i++) {
    const seg = plan[i];
    if (!budgetLeft()) { segments.push({ ...seg, ok: false, reason: 'window_budget_exhausted' }); break; }
    const pageRange = seg.from_start ? { from_start: seg.pages } : { from: seg.from, to: seg.to };
    let r;
    try {
      r = await call({ buffer, mediaType, fetchImpl, pageRange });
    } catch (err) {
      r = { ok: false, reason: `window_call_threw:${err?.message || err}` };
    }
    calls++;

    if (r && r.ok && r.text) {
      // The selector must have been HONOURED. Page numbers are the evidence.
      const nums = (r.pageTexts || []).map((p) => Number(p.page)).filter((n) => Number.isFinite(n));
      const outside = nums.filter((n) => n < seg.from || n > seg.to);
      if (nums.length && outside.length) {
        segments.push({ ...seg, ok: false, reason: 'page_range_ignored', pages_returned: nums.length, outside: outside.slice(0, 5) });
        break;   // a wrapper that ignores the selector cannot serve any later segment either
      }
      segments.push({
        ...seg, ok: true,
        pages_returned: nums.length || (Number.isFinite(r.pages) ? r.pages : null),
        chars: r.text.length,
        confidence: typeof r.confidence === 'number' ? r.confidence : null,
        page_range_applied: r.page_range_applied ?? null,
        _text: r.text,
        _pageTexts: r.pageTexts || null,
      });
      continue;
    }

    // ── The ONE re-plan, and it keys on `imageless`, never on `page_limit`. ──
    // A first segment of 30 pages is only servable when imageless mode applied.
    // If the processor rejected the field the wrapper silently fell back and the
    // real cap is 15 — replan the whole window at the base limit, once.
    if (i === 0 && !replanned && r && r.imageless === false && r.reason === 'over_page_cap') {
      replanned = true;
      plan = planPageWindow(totalPages, { targetPages, firstSegmentPages: DOCAI_RANGE_SEGMENT_PAGES });
      segments.push({ ...seg, ok: false, reason: 'replanned_imageless_unavailable' });
      i = -1;                     // restart the loop over the new plan
      segments.length = 0;        // the restarted plan owns the segment log
      continue;
    }

    segments.push({ ...seg, ok: false, reason: r?.reason || 'window_call_failed', status: r?.status ?? null });
    // A failed segment stops the walk: the pages after it are not reachable in
    // page order anyway, and continuing spends money for a text that would have
    // a hole in the middle.
    break;
  }

  // ── Assemble by PAGE NUMBER. Duplication cannot survive a Map. ──
  const pageTexts = [];
  const seen = new Set();
  const parts = [];
  let duplicates = 0;
  let blobSegments = 0;
  let confidence = null;
  for (const seg of segments) {
    if (!seg.ok) continue;
    if (typeof seg.confidence === 'number') confidence = confidence == null ? seg.confidence : Math.min(confidence, seg.confidence);
    if (seg._pageTexts && seg._pageTexts.length) {
      for (const p of seg._pageTexts) {
        const n = Number(p.page);
        if (!Number.isFinite(n)) continue;
        if (seen.has(n)) { duplicates++; continue; }
        seen.add(n);
        const t = String(p.text || '');
        pageTexts.push({ page: n, text: t });
        parts.push({ order: n, text: t });
      }
    } else if (seg._text) {
      // The wrapper returned no per-page anchors for this segment. Keep the text
      // (it is what we paid for) ordered by the range it was asked for, and say
      // so — a blob segment is why `pages_covered` can be a floor.
      blobSegments++;
      parts.push({ order: seg.from - 0.5, text: seg._text });
    }
  }
  parts.sort((a, b) => a.order - b.order);
  pageTexts.sort((a, b) => a.page - b.page);
  const text = parts.map((p) => p.text).filter((t) => t && t.trim()).join('\n\n').trim();

  const okSegments = segments.filter((s) => s.ok).length;
  const failed = segments.find((s) => !s.ok && s.reason !== 'replanned_imageless_unavailable');
  const coveredPages = [...seen];
  const pagesCovered = coveredPages.length
    || segments.filter((s) => s.ok).reduce((n, s) => n + (s.pages || 0), 0);

  if (!text) {
    return {
      ok: false,
      reason: failed?.reason || 'window_empty',
      calls, segments: segments.map(stripSegmentText), replanned,
      target_pages: targetPages, total_pages: totalPages,
    };
  }

  return {
    ok: true,
    text,
    pageTexts: pageTexts.length ? pageTexts : null,
    engine: 'google_docai',
    confidence,
    calls,
    replanned,
    segments: segments.map(stripSegmentText),
    pages_covered: pagesCovered,
    page_ranges: pageNumbersToRanges(coveredPages),
    page_gaps: pageGaps(coveredPages),
    duplicate_pages: duplicates,
    blob_segments: blobSegments,
    target_pages: targetPages,
    total_pages: totalPages,
    // The window did not reach the target it planned for — a segment failed or
    // the budget ran out. Distinct from `partial`, which is about the DOCUMENT.
    window_incomplete: !!failed || okSegments < segments.filter((s) => s.reason !== 'replanned_imageless_unavailable').length,
    // Complete for the consumer, incomplete for the document (DOC18 §2/§5).
    partial: Number.isFinite(totalPages) ? totalPages > pagesCovered : true,
    window_failed_reason: failed?.reason || null,
  };
}

function stripSegmentText(seg) {
  const { _text, _pageTexts, ...rest } = seg;
  return rest;
}

export async function ocrPdfToTextTiered({ buffer, mediaType } = {}, deps = {}) {
  const cloudEnabled = String(process.env.OCR_CLOUD_ESCALATION ?? 'true').toLowerCase() !== 'false';

  // Tier 1 — free local engine. Injected; unconfigured by default on the server.
  if (deps.freeOcr) {
    let f;
    try { f = await deps.freeOcr({ buffer, mediaType }); }
    catch (err) { f = { ok: false, reason: `free_ocr_threw:${err?.message || err}` }; }
    if (f && f.ok && f.text) {
      const conf = typeof f.confidence === 'number' ? f.confidence : null;
      const passesFloor = conf == null || OCR_FREE_CONFIDENCE_MIN <= 0 || conf >= OCR_FREE_CONFIDENCE_MIN;
      if (passesFloor) {
        return { ok: true, text: f.text, tier: 'free', confidence: conf, engine: f.engine || 'tesseract' };
      }
      // Recovered free text but below the floor: escalate when allowed, else
      // return it tagged low-confidence (better than nothing on a pure-free run).
      if (!cloudEnabled) {
        return { ok: true, text: f.text, tier: 'free_low_conf', confidence: conf, engine: f.engine || 'tesseract' };
      }
    }
  }

  if (!cloudEnabled) return { ok: false, reason: 'free_ocr_unavailable_cloud_disabled' };

  const mode = cloudOcrProviderMode();

  // Tier 2 — CHEAP CLOUD (preferred paid). Attempted when a cheap provider is
  // configured (mode==='cheap') or an adapter is injected (tests). gpt-4o is NOT
  // reached here — that is the whole point of UW#4b.
  let cheapReason = 'cloud_ocr_unconfigured';
  let cheapPages = null;
  let cheapPageLimit = null;
  if (mode === 'cheap' || deps.cloudCheapOcr) {
    const cc = await (deps.cloudCheapOcr || ocrCloudCheap)({ buffer, mediaType, fetchImpl: deps.fetchImpl });
    if (cc && cc.ok && cc.text) {
      return { ok: true, text: cc.text, tier: 'cloud_cheap', confidence: cc.confidence ?? null, pages: cc.pages ?? null, pageTexts: cc.pageTexts ?? null, engine: cc.engine || 'cloud_ocr' };
    }
    cheapReason = cc?.reason || 'cloud_ocr_failed';
    // DOC8: when the cheap tier refused on the page cap it told us the real page
    // count. gpt-4o never returns one, so this is the only chance to learn it —
    // carry it out on BOTH the success-elsewhere and the total-failure paths.
    cheapPages = Number.isFinite(cc?.pages) ? cc.pages : null;
    cheapPageLimit = Number.isFinite(cc?.page_limit) ? cc.page_limit : null;
  }

  // Tier 3 — gpt-4o vision LAST RESORT. Explicit opt-in only; never the default.
  const allowGpt4o = mode === 'gpt4o'
    || String(process.env.OCR_CLOUD_GPT4O_LASTRESORT || '').toLowerCase() === 'true';
  if (allowGpt4o) {
    const c = await (deps.ocrPdfToText || ocrPdfToText)({ buffer, mediaType, ocrImpl: deps.ocrImpl });
    if (c && c.ok && c.text) {
      return {
        ok: true, text: c.text, tier: 'cloud', confidence: null, engine: c.model || 'gpt-4o-vision',
        // NOT the pages gpt-4o read (it reports none) — the pages the CHEAP tier
        // counted before refusing. Labelled so nobody reads it as a spend figure.
        pages: null, cheap_reason: cheapReason, cheap_pages: cheapPages, cheap_page_limit: cheapPageLimit,
      };
    }
    return { ok: false, reason: c?.reason || 'ocr_failed', cheap_reason: cheapReason, cheap_pages: cheapPages };
  }

  return { ok: false, reason: cheapReason, cheap_pages: cheapPages, cheap_page_limit: cheapPageLimit };
}

/**
 * The Unit-1 core: fetch bytes → extract text (digital first, OCR fallback on a
 * zero-text PDF when allowed). Deps injected for testing.
 *
 * Returns:
 *   { ok:true, text, method:'pdf_text'|'text_decode'|'binary_decode'|'ocr', text_len, ocr_attempted, ocr_ok? }
 *   { ok:true, text:'', text_len:0, needs_ocr:true, reason }   — scanned PDF, OCR off/failed/over-cap
 *   { ok:false, reason, status, detail }                        — byte fetch failed (transient → retry)
 *
 * `needs_ocr` is a TRUTHFUL terminal-this-pass state, distinct from a transient
 * fetch failure (ok:false), so the worker can record it vs. leave it for retry.
 */
export async function extractDocumentText(
  {
    sourceUrl, storageRef, storagePath, mediaType, allowOcr = true, ocrTiered = false,
    minChars = DOC_TEXT_MIN_CHARS,
    // DOC8 — refuse OCR above this many PDF pages instead of falling through to
    // gpt-4o. null (the default) is OFF, so every existing caller — the deed lane
    // included — behaves byte-identically. Only the CRE worker opts in.
    ocrPageCap = null,
    // DOC18 — above `ocrPageCap`, extract the CONSUMER'S WINDOW as N cheap sync
    // calls instead of stopping at the marker. null (the default) is OFF, so
    // every existing caller — the ordinary CRE drain and the deed lane included —
    // is byte-identical. Pass `true`, or `{ targetPages, deadline }`.
    ocrPageWindow = null,
  } = {},
  deps = {},
) {
  const fetched = await (deps.fetchDocBytes || fetchDocBytes)({
    sourceUrl, storageRef, storagePath, storageGet: deps.storageGet, fetchImpl: deps.fetchImpl,
  });
  if (!fetched.ok) {
    return { ok: false, reason: 'fetch_failed', status: fetched.status || 0, detail: fetched.detail || null };
  }
  const fetchedVia = fetched.via || null;
  const buffer = fetched.buffer;
  const ct = (fetched.contentType || mediaType || '').toLowerCase();
  // Office docs FIRST, sniffed from BYTES (2026-08-12): the SharePoint PA flow
  // often reports application/pdf for xlsx/docx, which used to route office
  // bytes into the PDF branch → pdf-parse miss → the OCR tiers (Document AI
  // 400s on non-PDF bytes + a wasted gpt-4o fallback). A PK/OLE buffer can
  // never be a PDF, so this pre-branch is safe regardless of contentType.
  const officeKindEarly = sniffOfficeKind(buffer, sourceUrl || storageRef || '');
  if (officeKindEarly) {
    const office = extractOfficeText({ buffer, fileName: sourceUrl || storageRef || '' });
    if (office.ok && office.text) {
      return { ok: true, text: office.text, method: 'office_text', text_len: office.text.length, ocr_attempted: false, via: fetchedVia };
    }
    return {
      ok: true, text: '', method: null, text_len: 0, ocr_attempted: false,
      needs_ocr: true, reason: office.reason || 'office_unreadable',
    };
  }

  const isPdf = /pdf/i.test(ct) || (buffer && buffer[0] === 0x25 && buffer[1] === 0x50); // %P
  const isText = /^text\//i.test(ct) || ct === 'message/rfc822';

  let text = '';
  let method = null;
  if (isPdf) {
    text = await (deps.pdfTextFromBuffer || pdfTextFromBuffer)(buffer);
    method = text ? 'pdf_text' : null;
  } else if (isText) {
    text = Buffer.from(buffer).toString('utf8').trim();
    method = 'text_decode';
  } else {
    // Unknown binary: best-effort ASCII salvage (matches lease-extractor).
    // (docx/xlsx never reach here — the office pre-branch above returns first.)
    text = Buffer.from(buffer).toString('utf8').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ').trim();
    method = text ? 'binary_decode' : null;
  }

  // UW#6 — a PDF whose MEANINGFUL text is below the floor is a scanned page with
  // a thin junk text layer (recording stamp / page number / OCR bleed). Discard
  // it so the row routes to OCR instead of being marked done with ~nothing. The
  // floor is PDF-only (text/* + binary salvage are taken at face value); a 0
  // floor disables it.
  const floor = Number.isFinite(minChars) ? minChars : DOC_TEXT_MIN_CHARS;
  const thinTextLayer = isPdf && text && floor > 0 && meaningfulTextLen(text) < floor;
  if (thinTextLayer) { text = ''; method = null; }

  if (text && text.length > 0) {
    return { ok: true, text, method, text_len: text.length, ocr_attempted: false, via: fetchedVia };
  }

  // Zero-text (or sub-floor) PDF → OCR fallback (the scanned-deed / scanned-lease
  // case). UW#6: `ocrTiered` routes deeds through the UW#4/#4b free-first tiered
  // OCR (Surya/Paddle → cheap cloud → gpt-4o LAST RESORT) instead of gpt-4o
  // direct — the same expensive-engine avoidance the lease path uses.
  if (isPdf && allowOcr) {
    // ── DOC8 PAGE PRE-FLIGHT ────────────────────────────────────────────────
    // Google's synchronous OCR caps at 30 pages in imageless mode. Above it,
    // DocAI 502s `over_page_cap` and — measured on 19 live rows — gpt-4o returns
    // a fragment (avg 1,579 chars, 63% under 500, minimum 31) that DOC10's floor
    // then rejects anyway. So spending on it buys nothing.
    //
    // ⚠️ This does NOT remove the gpt-4o tier. It remains the last resort for
    // every document under the cap where the cheap tier fails for any other
    // reason. What it removes is the SILENT fall-through on the one class where
    // gpt-4o is known to fail: an over-cap document now stops with a NAMED,
    // DATED marker instead (DOC1's mechanism), so it is countable and re-admits
    // itself if the cap or the tiering ever changes.
    const pageCap = Number.isFinite(ocrPageCap) && ocrPageCap > 0 ? ocrPageCap : null;
    if (pageCap) {
      const pre = await (deps.pdfPageCount || pdfPageCountFromBuffer)(buffer);
      if (Number.isFinite(pre) && pre > pageCap) {
        // ── DOC18 — THE THREE-CALL SYNC WINDOW ────────────────────────────
        // Opt-in per caller. When it is off this branch is byte-identical to
        // DOC8's, which is what keeps the ordinary under-cap drain and the
        // marker itself exactly as they are today.
        const win = ocrPageWindow === true ? {}
          : (ocrPageWindow && typeof ocrPageWindow === 'object' ? ocrPageWindow : null);
        let windowReason = null;
        if (win) {
          const w = await (deps.ocrCloudCheapWindow || ocrCloudCheapWindow)({
            buffer,
            mediaType: ct || 'application/pdf',
            totalPages: pre,
            targetPages: Number.isFinite(win.targetPages) && win.targetPages > 0
              ? win.targetPages : OCR_WINDOW_TARGET_PAGES,
            deadline: Number.isFinite(win.deadline) ? win.deadline : null,
            fetchImpl: deps.fetchImpl,
          }, deps);
          if (w && w.ok && w.text) {
            return {
              ok: true, text: w.text, method: 'ocr', text_len: w.text.length,
              ocr_attempted: true, ocr_ok: true, via: fetchedVia,
              ocr_tier: 'cloud_cheap_window', ocr_engine: w.engine || 'google_docai',
              ocr_confidence: typeof w.confidence === 'number' ? w.confidence : null,
              // BILLED pages == pages actually returned, never the document length.
              ocr_pages: w.pages_covered,
              // The document's TRUE length. A 141-page lease read to page 50 is a
              // PARTIAL: complete for the consumer, incomplete for the document.
              page_count: pre,
              pages: w.pageTexts && w.pageTexts.length ? w.pageTexts : null,
              pages_covered: w.pages_covered,
              page_ranges: w.page_ranges,
              page_gaps: w.page_gaps,
              duplicate_pages: w.duplicate_pages,
              window_calls: w.calls,
              window_target_pages: w.target_pages,
              window_incomplete: !!w.window_incomplete,
              window_replanned: !!w.replanned,
              partial_extract: !!w.partial,
              thin_text_layer: thinTextLayer || undefined,
            };
          }
          // ⛔ NEVER gpt-4o from here (measured at 9.3x less text on exactly this
          // class, DOC8/DOC9). A failed window falls to the marker, carrying why.
          windowReason = w?.reason || 'window_failed';
        }
        return {
          ok: true, text: '', method: null, text_len: 0,
          ocr_attempted: !!win, needs_ocr: true,
          // DOC18: `over_docai_page_cap` still means "we did not try"; a window
          // that ran and produced nothing is a DIFFERENT fact and gets its own
          // reason, so the two are countable apart.
          reason: win ? 'window_failed' : 'over_docai_page_cap',
          window_reason: windowReason,
          page_count: pre, ocr_page_cap: pageCap,
          thin_text_layer: thinTextLayer || undefined,
        };
      }
    }

    let ocr;
    if (ocrTiered) {
      ocr = await (deps.ocrPdfToTextTiered || ocrPdfToTextTiered)({ buffer, mediaType: ct || 'application/pdf' }, deps);
    } else {
      ocr = await (deps.ocrPdfToText || ocrPdfToText)({ buffer, mediaType: ct || 'application/pdf', ocrImpl: deps.ocrImpl });
    }
    if (ocr.ok && ocr.text) {
      return {
        ok: true, text: ocr.text, method: 'ocr', text_len: ocr.text.length,
        ocr_attempted: true, ocr_ok: true, via: fetchedVia,
        ocr_tier: ocr.tier || null, ocr_engine: ocr.engine || ocr.model || null,
        ocr_pages: ocr.pages ?? null,   // UW#4c — per-page cost telemetry
        // DOC8: gpt-4o reports no page count, but the cheap tier counted the
        // document before refusing it. Distinct field — `ocr_pages` is what we
        // were BILLED for, `page_count` is how long the document is.
        page_count: Number.isFinite(ocr.pages) ? ocr.pages : (Number.isFinite(ocr.cheap_pages) ? ocr.cheap_pages : null),
        pages: ocr.pageTexts ?? null,   // R58 Unit 4 — per-page text for clause_ref page anchors
        thin_text_layer: thinTextLayer || undefined,
      };
    }
    return {
      ok: true, text: '', method: null, text_len: 0, ocr_attempted: true, ocr_ok: false,
      needs_ocr: true, reason: ocr.reason || 'ocr_failed', thin_text_layer: thinTextLayer || undefined,
      // DOC8: the cheap tier's refusal carries a real page count; keep it.
      page_count: Number.isFinite(ocr.cheap_pages) ? ocr.cheap_pages : null,
    };
  }

  return {
    ok: true, text: '', method: null, text_len: 0, ocr_attempted: false,
    needs_ocr: true, reason: thinTextLayer ? 'thin_text_layer_no_ocr' : 'no_text_layer',
    thin_text_layer: thinTextLayer || undefined,
  };
}
