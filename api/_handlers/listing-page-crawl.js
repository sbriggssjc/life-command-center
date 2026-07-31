// ============================================================================
// Listing-page crawl worker — SPEC_forsale_om_and_webpage_ingest.md Part B2
// Life Command Center · route POST /api/listing-page-crawl (mounted in server.js)
//
//   POST /api/listing-page-crawl   { limit? }
//
// Selects DUE external listing/property webpages from
// v_lcc_listing_page_crawl_worklist (registry: public.lcc_listing_web_pages on
// LCC Opps), server-side `fetch`es each (Railway egress is open; the extension
// can't fetch arbitrary broker sites), stores the raw HTML to the private
// 'listing-page-snapshots' bucket, appends a public.lcc_listing_page_snapshots
// row, and updates the registry (last_*, next_crawl_at, consecutive_failures).
//
// Availability is inferred from HTTP status + page-text markers (sold / under
// contract / no longer available / off market / 404-410) — classifyAvailability.
//
// Consumption-Layer discipline:
//   * value-gated to DUE pages only (the worklist view);
//   * capped (limit, default 25);
//   * AUTO-RETIRE — active=false after 5 consecutive failures (reversible: flip
//     active back to true + reset next_crawl_at);
//   * dedup — unchanged HTML (same newest content_hash) skips the storage PUT +
//     snapshot insert, only the registry status is refreshed;
//   * honest counts — the return envelope reports real scanned/crawled/etc.
//   * never throws for one bad page (per-page try/catch).
//
// Proactive AI detail extraction is FLAG-GATED (LISTING_PAGE_PROACTIVE_EXTRACT,
// default OFF; feature_flags_registry) and only runs on genuinely-changed HTML —
// left as a marked TODO stub here (extracted_json stays null).
// ============================================================================

import { createHash } from 'node:crypto';
import { authenticate } from '../_shared/auth.js';
import { opsQuery as defaultOpsQuery } from '../_shared/ops-db.js';

const SNAPSHOT_BUCKET = 'listing-page-snapshots';
const DEFAULT_LIMIT = 25;
const FETCH_TIMEOUT_MS = 15000;
const MAX_CONSECUTIVE_FAILURES = 5;         // auto-retire threshold
const CRAWL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const DAY_MS = 24 * 60 * 60 * 1000;

// Availability page-text markers. Word-boundary anchored so a benign mention
// ("sold-out neighborhood") is less likely to false-trip. Mirrors the
// availability-checker off-market heuristics (kept in plain JS — we do NOT
// import the Deno/TS parser).
const UNAVAILABLE_TEXT_RE =
  /\b(sold|under\s+contract|no\s+longer\s+available|off[\s-]?market|listing\s+(has\s+)?expired|not\s+available)\b/i;

/**
 * Compute the SHA-256 hex digest of a string. Pure. Uses node:crypto
 * (available in the Railway/Node runtime); a Web-Crypto path is unnecessary
 * server-side and keeps this synchronous + trivially testable.
 * @param {string} s
 * @returns {string} 64-char lowercase hex
 */
export function sha256Hex(s) {
  return createHash('sha256').update(String(s ?? ''), 'utf8').digest('hex');
}

/**
 * Classify availability from the HTTP status + HTML body. Pure.
 *   404/410                 -> 'unavailable'
 *   2xx + off-market marker -> 'likely_unavailable'
 *   2xx (no marker)         -> 'available'
 *   anything else           -> 'unknown'
 * @param {number} httpStatus
 * @param {string} html
 * @returns {'unavailable'|'likely_unavailable'|'available'|'unknown'}
 */
export function classifyAvailability(httpStatus, html) {
  const status = Number(httpStatus);
  if (status === 404 || status === 410) return 'unavailable';
  const is2xx = status >= 200 && status < 300;
  if (is2xx) {
    if (UNAVAILABLE_TEXT_RE.test(String(html || ''))) return 'likely_unavailable';
    return 'available';
  }
  return 'unknown';
}

/** True when an availability verdict means the page is (likely) gone. */
function isUnavailable(availability) {
  return availability === 'unavailable' || availability === 'likely_unavailable';
}

/**
 * Default fetch impl — a bounded (AbortController), browser-ish GET.
 * Returns a Response-like object; callers read `.ok`, `.status`, `.text()`.
 */
async function defaultFetchImpl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': CRAWL_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Default storage PUT — upload bytes to the LCC Opps 'listing-page-snapshots'
 * bucket via the storage REST API (mirrors artifact-storage.js
 * uploadArtifactToStorage: apikey + Bearer service key, x-upsert). Returns
 * { ok, status?, detail? }.
 */
async function defaultStoragePut(bucket, path, bytes, contentType) {
  const OPS_URL = process.env.OPS_SUPABASE_URL;
  const OPS_KEY = process.env.OPS_SUPABASE_KEY;
  if (!OPS_URL || !OPS_KEY) return { ok: false, status: 503, detail: 'ops storage not configured' };
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  const url = `${OPS_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': OPS_KEY,
        'Authorization': `Bearer ${OPS_KEY}`,
        'Content-Type': contentType || 'text/html; charset=utf-8',
        'x-upsert': 'true',
      },
      body: bytes,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, status: res.status, detail: String(detail).slice(0, 200) };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, detail: err?.message?.slice(0, 200) || 'storage_put_error' };
  }
}

/**
 * Core (deps-injected for tests).
 * @param {object} args   { limit? }
 * @param {object} deps   { opsQuery, fetchImpl, storagePut, now }
 * @returns {Promise<{ok, scanned, crawled, unchanged, unavailable, retired, failures:[]}>}
 */
export async function performListingPageCrawl(args = {}, deps = {}) {
  const q = deps.opsQuery || defaultOpsQuery;
  const fetchImpl = deps.fetchImpl || defaultFetchImpl;
  const storagePut = deps.storagePut || defaultStoragePut;
  const now = deps.now || (() => new Date());

  const limit = Math.min(Math.max(parseInt(args.limit, 10) || DEFAULT_LIMIT, 1), 200);

  const result = {
    ok: true,
    scanned: 0,
    crawled: 0,
    unchanged: 0,
    unavailable: 0,
    retired: 0,
    failures: [],
  };

  // 1. Select DUE pages from the worklist view (actionable-only, soonest-due).
  const due = await q('GET',
    `v_lcc_listing_page_crawl_worklist?select=id,domain,property_id,url,last_availability,consecutive_failures,next_crawl_at&limit=${limit}`);
  if (!due.ok) {
    return { ...result, ok: false, error: 'worklist_query_failed', detail: due.data };
  }
  const pages = Array.isArray(due.data) ? due.data : [];
  result.scanned = pages.length;

  for (const page of pages) {
    // Per-page isolation — one bad page never aborts the sweep.
    try {
      await crawlOnePage(page, { q, fetchImpl, storagePut, now, result });
    } catch (err) {
      result.failures.push({ id: page?.id ?? null, url: page?.url ?? null, error: err?.message?.slice(0, 200) || 'crawl_error' });
    }
  }

  return result;
}

/** Crawl a single registry page + update its row. Mutates `ctx.result`. */
async function crawlOnePage(page, ctx) {
  const { q, fetchImpl, storagePut, now, result } = ctx;
  const nowDate = now();
  const nowIso = nowDate.toISOString();

  let resp = null;
  let fetchError = null;
  try {
    resp = await fetchImpl(page.url);
  } catch (err) {
    fetchError = err;
  }

  const httpStatus = resp ? Number(resp.status) : null;
  // Treat a transport error OR a 5xx as a FAILURE (transient — retry sooner,
  // count toward auto-retire). 4xx (incl. 404/410) is a REAL crawl outcome
  // (the page's availability), not a transient failure.
  const isFailure = !!fetchError || (httpStatus != null && httpStatus >= 500);

  if (isFailure) {
    const nextFailures = (Number(page.consecutive_failures) || 0) + 1;
    const retire = nextFailures >= MAX_CONSECUTIVE_FAILURES;
    const patch = {
      last_crawled_at: nowIso,
      last_http_status: httpStatus,
      consecutive_failures: nextFailures,
      next_crawl_at: new Date(nowDate.getTime() + DAY_MS).toISOString(),
    };
    if (retire) patch.active = false;   // auto-retire (reversible)
    await q('PATCH', `lcc_listing_web_pages?id=eq.${encodeURIComponent(page.id)}`, patch, { headers: { Prefer: 'return=minimal' } });
    if (retire) result.retired += 1;
    result.failures.push({
      id: page.id, url: page.url, http_status: httpStatus,
      error: fetchError ? (fetchError.message?.slice(0, 200) || 'fetch_error') : `http_${httpStatus}`,
      consecutive_failures: nextFailures, retired: retire,
    });
    return;
  }

  // Success (2xx/3xx/4xx). Read the body + classify.
  let html = '';
  try { html = await resp.text(); } catch { html = ''; }
  const contentHash = sha256Hex(html);
  const byteSize = Buffer.byteLength(html, 'utf8');
  const availability = classifyAvailability(httpStatus, html);
  if (isUnavailable(availability)) result.unavailable += 1;

  // Dedup: is the newest existing snapshot for this page already this hash?
  const prior = await q('GET',
    `lcc_listing_page_snapshots?page_id=eq.${encodeURIComponent(page.id)}&select=content_hash&order=fetched_at.desc&limit=1`);
  const priorHash = (prior.ok && Array.isArray(prior.data) && prior.data[0]) ? prior.data[0].content_hash : null;
  const unchanged = priorHash != null && priorHash === contentHash;

  let storagePath = null;
  if (unchanged) {
    result.unchanged += 1;
  } else {
    // Store the raw HTML + append a snapshot row.
    storagePath = `${page.domain}/${page.property_id != null ? page.property_id : 'na'}/${page.id}/${contentHash}.html`;
    const put = await storagePut(SNAPSHOT_BUCKET, storagePath, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');

    // Proactive AI detail extraction — FLAG-GATED + changed-content only.
    // TODO(Part B2 follow-on): when LISTING_PAGE_PROACTIVE_EXTRACT === 'true',
    // feed the fetched HTML to the existing OM/detail extractor and store the
    // structured result in `extracted_json`. Left inert here (no AI wired).
    let extractedJson = null;
    if (process.env.LISTING_PAGE_PROACTIVE_EXTRACT === 'true') {
      // extractedJson = await extractListingDetail(html, page); // not wired yet
      extractedJson = null;
    }

    await q('POST',
      'lcc_listing_page_snapshots?on_conflict=page_id,content_hash',
      {
        page_id: page.id,
        fetched_at: nowIso,
        http_status: httpStatus,
        content_hash: contentHash,
        storage_bucket: put.ok ? SNAPSHOT_BUCKET : null,
        storage_path: put.ok ? storagePath : null,
        byte_size: byteSize,
        availability,
        extracted_json: extractedJson,
        notes: put.ok ? null : `storage_put_failed:${put.status || ''} ${put.detail || ''}`.slice(0, 200),
      },
      { headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' } });
    result.crawled += 1;
  }

  // Update the registry: reset failures, re-schedule.
  const nextDays = availability === 'available' ? 7 : 3;
  await q('PATCH', `lcc_listing_web_pages?id=eq.${encodeURIComponent(page.id)}`, {
    last_crawled_at: nowIso,
    last_http_status: httpStatus,
    last_availability: availability,
    consecutive_failures: 0,
    next_crawl_at: new Date(nowDate.getTime() + nextDays * DAY_MS).toISOString(),
  }, { headers: { Prefer: 'return=minimal' } });
}

export async function handleListingPageCrawl(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  // Accept limit from body or query.
  const limit = body.limit ?? (req.query && req.query.limit);
  const result = await performListingPageCrawl({ limit });
  return res.status(result.ok ? 200 : 502).json(result);
}
