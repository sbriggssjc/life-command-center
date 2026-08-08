// ============================================================================
// Domain Database Helper — query dialysis / government Supabase backends
// Life Command Center
//
// Similar to ops-db.js but targets domain-specific Supabase databases.
// Used by the sidebar pipeline to propagate extracted CRE data into the
// correct domain relational tables.
// ============================================================================

import { fetchWithTimeout, recordWriteFailure } from './ops-db.js';
import { domainSupabaseKey } from './supabase-keys.js';

const DOMAIN_CONFIG = {
  dialysis: { urlEnv: 'DIA_SUPABASE_URL' },
  government: { urlEnv: 'GOV_SUPABASE_URL' },
};

// QA#9 (2026-06-03): callers split between long-form ('dialysis'/'government')
// and short-form ('dia'/'gov') domain identifiers. domainSupabaseKey() already
// accepts both, but DOMAIN_CONFIG was keyed only on the long form, so every
// domainQuery('dia'|'gov', ...) call (e.g. the Review Console domCount helpers)
// fell through to a 503 "database not configured". Normalize here so both forms
// resolve identically.
const DOMAIN_ALIASES = {
  dia: 'dialysis', dialysis: 'dialysis',
  gov: 'government', government: 'government',
};

/**
 * Check if a domain database is configured.
 * @param {'dia'|'dialysis'|'gov'|'government'} domain
 * @returns {{ url: string, key: string } | null}
 */
export function getDomainCredentials(domain) {
  const canonical = DOMAIN_ALIASES[domain];
  const cfg = canonical ? DOMAIN_CONFIG[canonical] : null;
  if (!cfg) return null;
  const url = process.env[cfg.urlEnv];
  const key = domainSupabaseKey(canonical);
  if (!url || !key) return null;
  return { url, key };
}

/**
 * Execute a PostgREST query against a domain Supabase database.
 * Same interface as opsQuery() but routes to the specified domain backend.
 *
 * @param {'dialysis'|'government'} domain
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} method
 * @param {string} path - PostgREST path (e.g., 'properties?address=eq.123+Main+St')
 * @param {object} [body] - Request body for POST/PATCH
 * @param {object} [extraHeaders] - Additional headers (e.g., Prefer for upsert)
 * @returns {{ ok: boolean, status: number, data: any }}
 */
export async function domainQuery(domain, method, path, body, extraHeaders = {}, opts = {}) {
  const creds = getDomainCredentials(domain);
  if (!creds) {
    return { ok: false, status: 503, data: { error: `${domain} database not configured` } };
  }

  const url = `${creds.url}/rest/v1/${path}`;

  // QA#9 (2026-06-03): merge the caller's Prefer header with our default
  // instead of letting the spread clobber it. Callers that want a row count
  // pass `Prefer: count=exact`; before this merge that dropped our default
  // `return=representation` and — combined with no Content-Range parsing below
  // — silently lost the count. PostgREST accepts a comma-separated Prefer list.
  // We only inject the default `return=representation` when the caller didn't
  // already specify a `return=` directive, so explicit `return=minimal` write
  // callers aren't given a contradictory pair.
  const { Prefer: callerPrefer, prefer: callerPreferLc, ...restHeaders } = extraHeaders || {};
  const supplied = callerPrefer || callerPreferLc;
  const preferTokens = [];
  if (!supplied || !/\breturn=/.test(supplied)) preferTokens.push('return=representation');
  if (supplied) preferTokens.push(supplied);

  const headers = {
    'apikey': creds.key,
    'Authorization': `Bearer ${creds.key}`,
    'Content-Type': 'application/json',
    'Prefer': preferTokens.join(', '),
    ...restHeaders,
  };

  const fetchOpts = { method, headers };
  if (body && (method === 'POST' || method === 'PATCH')) {
    fetchOpts.body = JSON.stringify(body);
  }

  // Round 76ep (2026-04-29): bumped from 8s → 30s after a propagation_error
  // on 6606 Stadium Dr Zephyrhills (rich capture: 3 sales + 4 brokers + 4 owner
  // contacts) timed out a domain PATCH at 8s. The error stack traced cleanly
  // via Round 76ea's diagnostic capture: AbortError → fetchWithTimeout in
  // domainQuery → domainPatch. 8s was reasonable when these were lightweight
  // single-row PATCHes; complex multi-record updates need more headroom.
  // 30s aligns with Round 76cw's pg_net timeout bump and is well under
  // Vercel's 60s function ceiling, so genuine failures still fail fast.
  const res = await fetchWithTimeout(url, fetchOpts, 30000);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  // QA#9 (2026-06-03): parse PostgREST's Content-Range so callers that asked
  // for `Prefer: count=exact` get the total back. Header looks like
  // `0-0/1234` (or `*/0`); take the integer after the slash. Left undefined
  // when no count was requested (header is `*/*` / absent), so non-count GETs
  // are unaffected.
  let count;
  const contentRange = res.headers.get('content-range');
  if (contentRange) {
    const m = contentRange.match(/\/(\d+)\s*$/);
    if (m) count = parseInt(m[1], 10);
  }

  // Item #5 (audit/05-provenance-integrity, 2026-05-17): instrument every
  // non-2xx response from a domain DB WRITE (POST / PATCH / PUT / DELETE) so
  // the silent-failure pattern (A-3 / D-3) becomes queryable. GETs are
  // intentionally NOT instrumented — those failures are usually about
  // non-existent rows, not silent corruption. Fire-and-forget: the
  // recordWriteFailure call never throws or blocks the caller. The opts
  // parameter lets callers pass { label, sourceRunId } for triage context.
  if (!res.ok && (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')) {
    // Prompt 81: callers that fold an EXPECTED collision/FK into a dedup path
    // (R37 dedup-respect) pass opts.suppressFailureCodes so the handled,
    // recoverable Postgres error (e.g. 23505 duplicate, 23503 dangling FK) is
    // NOT recorded as an ingest_write_failure — it is a normal re-ingest
    // outcome, not a silent-corruption signal. Only genuinely unhandled
    // failures keep polluting the failure surface.
    const suppress = opts && Array.isArray(opts.suppressFailureCodes);
    const pgCode = (data && typeof data === 'object' && !Array.isArray(data))
      ? data.code
      : (Array.isArray(data) && data[0] && typeof data[0] === 'object' ? data[0].code : null);
    if (!(suppress && pgCode && opts.suppressFailureCodes.includes(pgCode))) {
      recordWriteFailure({
        domain,
        method,
        path,
        status: res.status,
        errorDetail: data,
        fields: body && typeof body === 'object' && !Array.isArray(body)
          ? Object.keys(body)
          : null,
        label:        opts && opts.label        || null,
        sourceRunId:  opts && opts.sourceRunId  || null,
        callerFile:   opts && opts.callerFile   || 'domain-db.js',
      }).catch(() => { /* recording is best-effort */ });
    }
  }

  return { ok: res.ok, status: res.status, data, count };
}

// ============================================================================
// Prompt 81 (item 3): FK-parent existence guard for domain writes.
//
// property_documents (and other child tables) carry a FK to
// properties(property_id). Several doc-write paths pass a property_id that was
// bridged from an asset external_identity or a raw request body without ever
// confirming the parent row exists — a dangling id then aborts the INSERT with
// 23503 (property_documents_property_id_fkey), ~488 dia + 10 gov failures.
//
// This returns TRUE only when the parent property row is present. Callers use
// it to SKIP the child write (and record it as an expected/recoverable
// condition) instead of hard-aborting with an FK violation. A GET that itself
// errors returns `null` (unknown) so the caller can choose to proceed rather
// than silently drop a write on a transient read failure.
//
// Best-effort per-invocation memoisation keeps a burst of doc writes for the
// same property from re-querying properties for every file.
// ============================================================================
export async function domainPropertyExists(domain, propertyId, cache) {
  if (propertyId === null || propertyId === undefined || propertyId === '') return null;
  const key = `${domain}:${propertyId}`;
  if (cache && cache.has(key)) return cache.get(key);
  let result = null;
  try {
    const r = await domainQuery(domain, 'GET',
      `properties?property_id=eq.${encodeURIComponent(propertyId)}&select=property_id&limit=1`
    );
    if (r.ok) result = !!(r.data && r.data.length);
    // Non-ok GET → leave result null (unknown); don't assert absence on a
    // transient read error.
  } catch { result = null; }
  if (cache && result !== null) cache.set(key, result);
  return result;
}
