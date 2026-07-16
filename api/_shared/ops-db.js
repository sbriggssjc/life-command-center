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
  if (!process.env.GOV_SUPABASE_SERVICE_KEY && !process.env.GOV_SUPABASE_KEY) {
    missing.push('GOV_SUPABASE_SERVICE_KEY|GOV_SUPABASE_KEY');
  }
  if (!process.env.DIA_SUPABASE_URL) missing.push('DIA_SUPABASE_URL');
  if (!process.env.DIA_SUPABASE_SERVICE_KEY && !process.env.DIA_SUPABASE_KEY) {
    missing.push('DIA_SUPABASE_SERVICE_KEY|DIA_SUPABASE_KEY');
  }
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

  // Detect new-style opts (has countMode / headers / timeoutMs key) vs legacy
  // headers obj.
  const isOptsShape = opts && typeof opts === 'object'
    && (Object.prototype.hasOwnProperty.call(opts, 'countMode')
      || Object.prototype.hasOwnProperty.call(opts, 'headers')
      || Object.prototype.hasOwnProperty.call(opts, 'timeoutMs'));
  const extraHeaders = isOptsShape ? (opts.headers || {}) : opts;
  const rawCountMode = isOptsShape ? opts.countMode : undefined;
  const countMode = VALID_COUNT_MODES.has(rawCountMode) ? rawCountMode : 'exact';
  // Per-call fetch timeout. Default 8s as before; heavy aggregate views (e.g.
  // v_priority_queue_enriched, ~5-7s to materialize) need more headroom so a
  // slow-but-successful read isn't aborted into a blanket 500. (R6 hotfix.)
  const timeoutMs = isOptsShape && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
    ? opts.timeoutMs : 8000;

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

  const res = await fetchWithTimeout(url, fetchOpts, timeoutMs);
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

/**
 * Single choke point for creating `entity_relationships` rows (R41 graph
 * hygiene). A self-relationship (`from_entity_id === to_entity_id`) is never
 * meaningful — an entity can't own / purchase / sell / be associated with
 * itself — so it is SKIPPED before it reaches the DB. This mirrors the DB
 * CHECK `chk_entity_relationships_no_self_loop`; the JS guard means well-behaved
 * writers never even attempt the insert. Every edge writer routes through here.
 *
 * @param {object} row - entity_relationships row (must carry from_entity_id /
 *   to_entity_id; workspace_id / relationship_type / metadata as usual)
 * @param {object} [opts] - opsQuery opts (e.g. { Prefer: 'return=minimal' })
 * @returns {Promise<{ ok: boolean, status?: number, data?: any, skipped?: string }>}
 *   On a self-loop returns `{ ok: false, skipped: 'self_loop' }` (no DB call).
 */
export async function insertEntityRelationship(row, opts) {
  const from = row ? row.from_entity_id : null;
  const to = row ? row.to_entity_id : null;
  if (from == null || to == null) {
    return { ok: false, status: 400, skipped: 'missing_endpoint' };
  }
  if (String(from) === String(to)) {
    return { ok: false, skipped: 'self_loop' };
  }
  return opsQuery('POST', 'entity_relationships', row, opts);
}

/**
 * Resolve the primary/oldest workspace id — the account-wide fallback used when
 * a producer/worker has NO explicit workspace context. Mirrors the inline
 * `workspaces?select=id&order=created_at.asc&limit=1` pattern already repeated in
 * research-task.js (createResearchTask), owner-contact-enrich.js and admin.js —
 * made a single source of truth here so paths that mint an entity (which requires
 * a NON-NULL entities.workspace_id) never 23502 on a null workspace.
 *
 * Returns null when no workspace exists or the query fails; the caller decides
 * how to handle a null (an account always carries ≥1 workspace in practice).
 *
 * @param {object} [deps] - { opsQuery } injectable for tests
 * @returns {Promise<string|null>}
 */
export async function resolvePrimaryWorkspaceId(deps = {}) {
  const q = deps.opsQuery || opsQuery;
  try {
    const wr = await q('GET', 'workspaces?select=id&order=created_at.asc&limit=1');
    if (wr && wr.ok && Array.isArray(wr.data) && wr.data[0]) return wr.data[0].id;
  } catch (_e) { /* soft — caller handles null */ }
  return null;
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
      // Log the stack trace, not just the message — the previous form
      // collapsed everything to a single line, making intermittent issues
      // hard to diagnose from Vercel function logs.
      console.error(
        `[LCC API Error] ${req.method} ${req.url}:`,
        err?.stack || err?.message || err
      );
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal server error',
          message: process.env.LCC_ENV === 'development' ? err?.message : undefined
        });
      }
    }
  };
}

// ============================================================================
// Item #5 (audit/05-provenance-integrity, 2026-05-17):
// Record a non-2xx response from a domain DB write to the
// ingest_write_failures table on LCC Opps. Fire-and-forget — never throws,
// never blocks the caller. Closes audit finding A-3 / D-3.
//
// Wired automatically into every POST/PATCH/PUT/DELETE made via domainQuery
// (api/_shared/domain-db.js). Callers can also invoke it directly if they
// already have an error context to record.
//
// Recording is intentionally best-effort:
//   • LCC Opps unreachable → write is dropped, original caller is unaffected.
//   • opsQuery throws       → caught and logged, never re-raised.
//   • Recursive recording   → impossible: opsQuery talks to LCC Opps, not
//                              dia/gov, so its failures don't trigger this.
// ============================================================================
export async function recordWriteFailure({
  domain, method, path, status, errorDetail, fields, label, sourceRunId, callerFile
} = {}) {
  try {
    if (!isOpsConfigured()) return;
    // Extract record PK from PostgREST filter pattern: =eq.<value>
    let recordPk = null;
    const m = String(path || '').match(/=eq\.([^&]+)/i);
    if (m) {
      try { recordPk = decodeURIComponent(m[1]).substring(0, 120); }
      catch { recordPk = m[1].substring(0, 120); }
    }
    // Cap path length so a runaway query string can't bloat the table.
    const truncatedPath = String(path || '').substring(0, 500);
    // Cap error_detail size. PostgREST bodies are normally <1KB but be safe.
    let safeDetail = errorDetail;
    if (errorDetail !== null && errorDetail !== undefined) {
      try {
        const s = JSON.stringify(errorDetail);
        if (s.length > 5000) {
          safeDetail = { _truncated: true, preview: s.substring(0, 5000) };
        }
      } catch {
        safeDetail = { _stringified: String(errorDetail).substring(0, 5000) };
      }
    }
    await opsQuery('POST', 'ingest_write_failures', {
      domain:            domain || null,
      method:            method || null,
      path:              truncatedPath || null,
      record_pk:         recordPk,
      http_status:       typeof status === 'number' ? status : null,
      error_detail:      safeDetail || null,
      fields_attempted:  Array.isArray(fields) ? fields : null,
      label:             label || null,
      source_run_id:     sourceRunId || null,
      caller_file:       callerFile || null,
    }, { 'Prefer': 'return=minimal' });
  } catch (err) {
    // Never propagate — recording is telemetry, not control flow.
    console.warn('[recordWriteFailure] internal error (suppressed):', err?.message || err);
  }
}
