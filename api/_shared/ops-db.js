// ============================================================================
// Ops Database Helper — shared Supabase PostgREST client for canonical tables
// Life Command Center — Phase 2
// ============================================================================

function opsUrl() {
  return process.env.OPS_SUPABASE_URL;
}

function opsKey() {
  return process.env.OPS_SUPABASE_KEY;
}

export function isOpsConfigured() {
  return !!(opsUrl() && opsKey());
}

/**
 * Execute a query against the ops Supabase database.
 * @param {string} method - HTTP method (GET, POST, PATCH, DELETE)
 * @param {string} path - PostgREST path (e.g., 'entities?id=eq.xxx')
 * @param {object} [body] - Request body for POST/PATCH
 * @param {object} [extraHeaders] - Additional headers
 * @returns {{ ok: boolean, status: number, data: any, count?: number }}
 */
export async function opsQuery(method, path, body, extraHeaders = {}) {
  const OPS_URL = opsUrl();
  const OPS_KEY = opsKey();
  if (!OPS_URL || !OPS_KEY) {
    return { ok: false, status: 503, data: { error: 'Ops database not configured' } };
  }

  const url = `${OPS_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': OPS_KEY,
    'Authorization': `Bearer ${OPS_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'GET' ? 'count=exact' : 'return=representation',
    ...extraHeaders
  };

  const opts = { method, headers };
  if (body && (method === 'POST' || method === 'PATCH')) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetchWithTimeout(url, opts, 8000);
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
