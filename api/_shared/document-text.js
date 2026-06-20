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

// pdf-parse 1.1.1 runs a debug block at import time that throws under pure ESM;
// createRequire defers the require to call time and sidesteps it (the exact
// pattern intake-extractor.js uses).
const nodeRequire = createRequire(import.meta.url);

// Same OCR byte cap the OM extractor uses (~12 MB) so a huge scan can't blow the
// function budget. A doc over the cap is reported needs_ocr (not silently lost).
const OCR_MAX_BYTES = Number(process.env.INTAKE_OCR_MAX_BYTES || 12_000_000);

const FETCH_TIMEOUT_MS = Number(process.env.DOC_TEXT_FETCH_TIMEOUT_MS || 30000);

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
 * Fetch the document bytes. Absolute URLs are fetched directly (CoStar CDN deed
 * PDFs are public/signed download links); a SharePoint server-relative ref goes
 * through the Phase-1 "Get file content" PA flow. Returns
 * { ok, buffer, contentType } or { ok:false, status, detail }.
 */
export async function fetchDocBytes({ sourceUrl, storageRef, fetchImpl } = {}) {
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
    return { ok: true, buffer, contentType: r.headers?.get?.('content-type') || null };
  }
  const ref = storageRef || sourceUrl;
  if (ref) {
    const sp = await fetchSharepointBytes({
      storageRef: ref,
      fetchImpl: fetchImpl || ((u, o) => fetchWithTimeout(u, o, FETCH_TIMEOUT_MS)),
    });
    if (!sp.ok) return { ok: false, status: sp.status || 0, detail: sp.detail || 'sharepoint_fetch_failed' };
    return { ok: true, buffer: sp.buffer, contentType: sp.contentType || null };
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
export async function extractDocumentText({ sourceUrl, storageRef, mediaType, allowOcr = true } = {}, deps = {}) {
  const fetched = await (deps.fetchDocBytes || fetchDocBytes)({
    sourceUrl, storageRef, fetchImpl: deps.fetchImpl,
  });
  if (!fetched.ok) {
    return { ok: false, reason: 'fetch_failed', status: fetched.status || 0, detail: fetched.detail || null };
  }
  const buffer = fetched.buffer;
  const ct = (fetched.contentType || mediaType || '').toLowerCase();
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
    // Unknown binary (docx/xlsx): best-effort ASCII salvage (matches lease-extractor).
    text = Buffer.from(buffer).toString('utf8').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ').trim();
    method = text ? 'binary_decode' : null;
  }

  if (text && text.length > 0) {
    return { ok: true, text, method, text_len: text.length, ocr_attempted: false };
  }

  // Zero-text PDF → OCR fallback (the scanned-deed / scanned-lease case).
  if (isPdf && allowOcr) {
    const ocr = await (deps.ocrPdfToText || ocrPdfToText)({
      buffer, mediaType: ct || 'application/pdf', ocrImpl: deps.ocrImpl,
    });
    if (ocr.ok && ocr.text) {
      return { ok: true, text: ocr.text, method: 'ocr', text_len: ocr.text.length, ocr_attempted: true, ocr_ok: true };
    }
    return { ok: true, text: '', method: null, text_len: 0, ocr_attempted: true, ocr_ok: false, needs_ocr: true, reason: ocr.reason || 'ocr_failed' };
  }

  return { ok: true, text: '', method: null, text_len: 0, ocr_attempted: false, needs_ocr: true, reason: 'no_text_layer' };
}
