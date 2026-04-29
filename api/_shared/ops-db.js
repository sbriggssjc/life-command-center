// ============================================================================
// Ops Database Helper — shared Supabase PostgREST client for canonical tables
// Life Command Center — Phase 2
// ============================================================================

// Boot-time loud warning if the LCC Opps creds are missing. Without this,
// the 2026-04-24 outage (OPS_SUPABASE_KEY missing from Vercel Production
// env) surfaced ONLY as 503 errors with no log trail — every requireOps()
// call returned 503 JSON but nothing ever threw or logged. This module is
// imported by every API handler, so this warning fires on every cold start
// when any of the three Supabase creds is absent.
(function warnOnMissingCreds() {
  const missing = [];
  if (!process.env.OPS_SUPABASE_URL) missing.push('OPS_SUPABASE_URL');
  if (!process.env.OPS_SUPABASE_KEY) missing.push('OPS_SUPABASE_KEY');
  if (!process.env.GOV_SUPABASE_URL) missing.push('GOV_SUPABASE_URL');
  if (!process.env.GOV_SUPABASE_KEY) missing.push('GOV_SUPABASE_KEY');
  if (!process.env.DIA_SUPABASE_URL) missing.push('DIA_SUPABASE_URL');
  if (!process.env.DIA_SUPABASE_KEY) missing.push('DIA_SUPABASE_KEY');
  if (missing.length) {
    console.warn(`[ops-db] WARN: missing env vars on cold start: ${missing.join(', ')} — requests will 503 until these are set + redeployed`);
  }
})();

function opsUrl() {
  return process.env.OPS_SUPABASE_URL;
}

function opsKey() {
  return process.env.OPS_SUPABASE_KEY;
}

export function isOpsConfigured() {
  return !!(opsUrl() && opsKey());
}

const VALID_COUNT_MODES = new Set(['exact', 'estimated', 'planned', 'none']);

/**
 * Execute a query against the ops Supabase database.
 *
 * @param {string} method - HTTP method (GET, POST, PATCH, DELETE)
 * @param {string} path - PostgREST path (e.g., 'entities?id=eq.xxx')
 * @param {object} [body] - Request body for POST/PATCH
 * @param {object} [opts] - Options object:
 *   - opts.headers: extra HTTP headers (overrides defaults like Prefer)
 *   - opts.countMode: GET-only — 'exact' | 'estimated' | 'planned' | 'none'
 *       Default 'exact'. Use 'estimated' for paginated lists where the
 *       header pager just needs an approximate total. Use 'none' for
 *       single-row reads where result.count is never consumed (saves the
 *       second COUNT(*) trip on UNION/joined views).
 *
 *   For backward compatibility, a flat headers object (no countMode/headers
 *   keys) passed as the 4th arg is still treated as headers. New code
 *   should use the explicit { headers, countMode } shape.
 *
 * @returns {{ ok: boolean, status: number, data: any, count?: number }}
 */
export async function opsQuery(method, path, body, opts = {}) {
  const OPS_URL = opsUrl();
  const OPS_KEY = opsKey();
  if (!OPS_URL || !OPS_KEY) {
    return { ok: false, status: 503, data: { error: 'Ops database not configured' } };
  }

  // Detect new-style opts (has countMode or headers key) vs legacy headers obj.
  const isOptsShape = opts && typeof opts === 'object'
    && (Object.prototype.hasOwnProperty.call(opts, 'countMode')
      || Object.prototype.hasOwnProperty.call(opts, 'headers'));
  const extraHeaders = isOptsShape ? (opts.headers || {}) : opts;
  const rawCountMode = isOptsShape ? opts.countMode : undefined;
  const countMode = VALID_COUNT_MODES.has(rawCountMode) ? rawCountMode : 'exact';

  let defaultPrefer;
  if (method === 'GET') {
    defaultPrefer = countMode === 'none' ? null : `count=${countMode}`;
  } else {
    defaultPrefer = 'return=representation';
  }

  const url = `${OPS_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': OPS_KEY,
    'Authorization': `Bearer ${OPS_KEY}`,
    'Content-Type': 'application/json',
    ...(defaultPrefer ? { Prefer: defaultPrefer } : {}),
    ...extraHeaders
  };

  const fetchOpts = { method, headers };
  if (body && (method === 'POST' || method === 'PATCH')) {
    fetchOpts.body = JSON.stringify(body);
  }

  const res = await fetchWithTimeout(url, fetchOpts, 8000);
  const text = await res.text();

  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  let count = 0;
  const contentRange = res.headers.get('content-range');
  if (contentRange) {
    const match = contentRange.match(/\/(\d+)/);
    if (match) count = parseInt(match[1], 10);
  }

  return { ok: res.ok, status: res.status, data, count };
}

export async function logPerfMetric(workspaceId, userId, metricType, endpoint, durationMs, metadata) {
  if (!isOpsConfigured()) return { ok: false, status: 503, data: { error: 'Ops database not configured' } };
  try {
    return await opsQuery('POST', 'perf_metrics', {
      workspace_id: workspaceId || null,
      user_id: userId || null,
      metric_type: metricType,
      endpoint,
      duration_ms: Math.max(0, Math.round(durationMs || 0)),
      metadata: metadata || {}
    });
  } catch {
    return { ok: false, status: 500, data: { error: 'Failed to log perf metric' } };
  }
}

/**
 * Build pagination query params.
 * @param {object} query - Express-style query object with limit, offset, order
 * @returns {string} - Query string fragment like '&limit=50&offset=0&order=created_at.desc'
 */
export function paginationParams(query) {
  const limit = Math.min(Math.max(parseInt(query.limit) || 50, 1), 500);
  const offset = Math.max(parseInt(query.offset) || 0, 0);
  const rawOrder = query.order || 'created_at.desc';
  // Sanitize order: allow only alphanumeric, dots, commas, underscores (PostgREST order syntax)
  const order = /^[a-zA-Z0-9_.,]+$/.test(rawOrder) ? rawOrder : 'created_at.desc';
  return `&limit=${limit}&offset=${offset}&order=${order}`;
}

/** Encode a user-supplied value for safe use in PostgREST filter strings */
export function pgFilterVal(v) { return encodeURIComponent(String(v)); }

/**
 * Require ops DB or send 503.
 * Returns true if ops is NOT configured (handler should return).
 */
export function requireOps(res) {
  if (!isOpsConfigured()) {
    res.status(503).json({ error: 'Ops database not configured. Set OPS_SUPABASE_URL and OPS_SUPABASE_KEY.' });
    return true;
  }
  return false;
}

/**
 * Wrap an async handler with top-level error handling.
 * Catches unhandled errors and returns a structured 500 response
 * instead of crashing the serverless function.
 *
 * Usage:
 *   import { withErrorHandler } from './_shared/ops-db.js';
 *   export default withErrorHandler(async (req, res) => { ... });
 */
/**
 * Fetch with an AbortController-based timeout.
 * Prevents serverless functions from hanging past Vercel's execution limit.
 * @param {string} url
 * @param {object} [opts] - fetch options
 * @param {number} [timeoutMs=8000] - timeout in milliseconds (default 8s, under Vercel Hobby 10s limit)
 * @returns {Promise<Response>}
 */
export function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export function withErrorHandler(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (err) {
      console.error(`[LCC API Error] ${req.method} ${req.url}:`, err.message || err);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal server error',
          message: process.env.LCC_ENV === 'development' ? err.message : undefined
        });
      }
    }
  };
}
