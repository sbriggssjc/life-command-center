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
export async function ocrCloudCheap({ buffer, mediaType, fetchImpl } = {}) {
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
        media_type: mediaType || 'application/pdf',
        provider,
      }),
    });
  } catch (err) {
    return { ok: false, reason: `cloud_ocr_threw:${err?.message || err}` };
  }
  if (!r || !r.ok) return { ok: false, reason: 'cloud_ocr_non_ok', status: r?.status || 0 };
  let data = null;
  try { data = await r.json(); } catch { return { ok: false, reason: 'cloud_ocr_bad_json' }; }
  const text = String(data?.text || data?.content || data?.transcription || '').trim();
  if (!text) return { ok: false, reason: 'cloud_ocr_empty' };
  const confidence = typeof data?.confidence === 'number' ? data.confidence : null;
  return { ok: true, text, confidence, engine: data?.engine || provider };
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
  if (mode === 'cheap' || deps.cloudCheapOcr) {
    const cc = await (deps.cloudCheapOcr || ocrCloudCheap)({ buffer, mediaType, fetchImpl: deps.fetchImpl });
    if (cc && cc.ok && cc.text) {
      return { ok: true, text: cc.text, tier: 'cloud_cheap', confidence: cc.confidence ?? null, engine: cc.engine || 'cloud_ocr' };
    }
    cheapReason = cc?.reason || 'cloud_ocr_failed';
  }

  // Tier 3 — gpt-4o vision LAST RESORT. Explicit opt-in only; never the default.
  const allowGpt4o = mode === 'gpt4o'
    || String(process.env.OCR_CLOUD_GPT4O_LASTRESORT || '').toLowerCase() === 'true';
  if (allowGpt4o) {
    const c = await (deps.ocrPdfToText || ocrPdfToText)({ buffer, mediaType, ocrImpl: deps.ocrImpl });
    if (c && c.ok && c.text) return { ok: true, text: c.text, tier: 'cloud', confidence: null, engine: c.model || 'gpt-4o-vision' };
    return { ok: false, reason: c?.reason || 'ocr_failed' };
  }

  return { ok: false, reason: cheapReason };
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
export async function extractDocumentText({ sourceUrl, storageRef, storagePath, mediaType, allowOcr = true } = {}, deps = {}) {
  const fetched = await (deps.fetchDocBytes || fetchDocBytes)({
    sourceUrl, storageRef, storagePath, storageGet: deps.storageGet, fetchImpl: deps.fetchImpl,
  });
  if (!fetched.ok) {
    return { ok: false, reason: 'fetch_failed', status: fetched.status || 0, detail: fetched.detail || null };
  }
  const fetchedVia = fetched.via || null;
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
    return { ok: true, text, method, text_len: text.length, ocr_attempted: false, via: fetchedVia };
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
