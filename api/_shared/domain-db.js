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

/**
 * Check if a domain database is configured.
 * @param {'dialysis'|'government'} domain
 * @returns {{ url: string, key: string } | null}
 */
export function getDomainCredentials(domain) {
  const cfg = DOMAIN_CONFIG[domain];
  if (!cfg) return null;
  const url = process.env[cfg.urlEnv];
  const key = domainSupabaseKey(domain);
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
  const headers = {
    'apikey': creds.key,
    'Authorization': `Bearer ${creds.key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...extraHeaders,
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

  // Item #5 (audit/05-provenance-integrity, 2026-05-17): instrument every
  // non-2xx response from a domain DB WRITE (POST / PATCH / PUT / DELETE) so
  // the silent-failure pattern (A-3 / D-3) becomes queryable. GETs are
  // intentionally NOT instrumented — those failures are usually about
  // non-existent rows, not silent corruption. Fire-and-forget: the
  // recordWriteFailure call never throws or blocks the caller. The opts
  // parameter lets callers pass { label, sourceRunId } for triage context.
  if (!res.ok && (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')) {
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

  return { ok: res.ok, status: res.status, data };
}
