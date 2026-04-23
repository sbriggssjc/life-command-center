// api/_shared/salesforce.js
// ============================================================================
// Salesforce REST helper — READ-ONLY account/contact lookup for LCC owner
// resolution. Uses OAuth 2.0 Client Credentials flow against a Connected App.
//
// ENV VARS EXPECTED (all required for this module to function; absence is
// handled gracefully by callers — they just get `skipped: sf_not_configured`):
//
//   SF_INSTANCE_URL         — e.g. "https://northmarq.my.salesforce.com"
//   SF_CLIENT_ID            — Connected App consumer key
//   SF_CLIENT_SECRET        — Connected App consumer secret
//   SF_TOKEN_ENDPOINT       — optional override, defaults to
//                             "{SF_INSTANCE_URL}/services/oauth2/token"
//   SF_API_VERSION          — optional, defaults to "60.0"
//
// One access token is cached per lambda cold-start (tokens live ~2 hours
// on Salesforce side; cold starts are much more frequent than that so we
// don't bother with refresh). Failed requests return {ok:false, detail}
// rather than throwing — callers should treat SF lookups as best-effort.
// ============================================================================

import { fetchWithTimeout } from './ops-db.js';

let _cachedToken     = null;
let _cachedTokenAt   = 0;
const TOKEN_TTL_MS   = 90 * 60 * 1000;  // 90 min (well under SF's 120 min)

export function isSalesforceConfigured() {
  return !!(
    process.env.SF_INSTANCE_URL &&
    process.env.SF_CLIENT_ID &&
    process.env.SF_CLIENT_SECRET
  );
}

/**
 * Fetch an OAuth access token via client-credentials grant. Cached for
 * the lifetime of the lambda (cold starts issue a fresh one).
 */
async function getAccessToken() {
  if (_cachedToken && (Date.now() - _cachedTokenAt) < TOKEN_TTL_MS) {
    return { ok: true, access_token: _cachedToken };
  }
  if (!isSalesforceConfigured()) {
    return { ok: false, reason: 'sf_not_configured' };
  }
  const tokenUrl = process.env.SF_TOKEN_ENDPOINT ||
    `${process.env.SF_INSTANCE_URL.replace(/\/+$/, '')}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
  }).toString();

  const res = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }, 10000);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok || !json?.access_token) {
    return {
      ok: false,
      reason: 'token_mint_failed',
      status: res.status,
      detail: json?.error_description || json?.error || text.slice(0, 300),
    };
  }
  _cachedToken   = json.access_token;
  _cachedTokenAt = Date.now();
  return { ok: true, access_token: _cachedToken };
}

/**
 * Run a SOQL query against the authenticated SF org.
 * Returns { ok, records, totalSize } on success, or { ok:false, reason, detail }.
 */
async function soqlQuery(soql) {
  const token = await getAccessToken();
  if (!token.ok) return token;

  const apiVersion = process.env.SF_API_VERSION || '60.0';
  const base = process.env.SF_INSTANCE_URL.replace(/\/+$/, '');
  const url = `${base}/services/data/v${apiVersion}/query?q=${encodeURIComponent(soql)}`;

  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/json',
    },
  }, 15000);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }

  // Token may have expired mid-lambda — one-shot retry on 401.
  if (res.status === 401) {
    _cachedToken = null;
    const retryToken = await getAccessToken();
    if (!retryToken.ok) return retryToken;
    const retryRes = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${retryToken.access_token}`,
        Accept: 'application/json',
      },
    }, 15000);
    const retryText = await retryRes.text();
    let retryJson = null;
    try { retryJson = retryText ? JSON.parse(retryText) : null; } catch { /* */ }
    if (!retryRes.ok) {
      return { ok: false, reason: 'query_failed_after_retry', status: retryRes.status, detail: retryText.slice(0, 300) };
    }
    return { ok: true, records: retryJson?.records || [], totalSize: retryJson?.totalSize || 0 };
  }

  if (!res.ok) {
    return { ok: false, reason: 'query_failed', status: res.status, detail: text.slice(0, 300) };
  }
  return { ok: true, records: json?.records || [], totalSize: json?.totalSize || 0 };
}

/**
 * Escape a single-quoted string literal for SOQL. SOQL only interprets
 * backslash and single-quote inside '...'; other chars pass through.
 */
function soqlEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ============================================================================
// PUBLIC LOOKUPS (what the promoter / owner-resolution call)
// ============================================================================

/**
 * Find a Salesforce Account by owner name. Uses a LIKE query so
 * "TEXAS GSA HOLDINGS, LP" matches accounts named with or without the
 * trailing LP/LLC/Inc. Returns the best candidate (highest text-length
 * similarity) or null.
 *
 * @param {string} ownerName
 * @returns {Promise<{ok: boolean, account?: {Id,Name,Type,Industry}, reason?: string}>}
 */
export async function findSalesforceAccountByName(ownerName) {
  if (!isSalesforceConfigured()) return { ok: false, reason: 'sf_not_configured' };
  if (!ownerName) return { ok: false, reason: 'no_name' };

  // Strip entity suffixes / punctuation to broaden the LIKE match.
  const core = String(ownerName)
    .replace(/,/g, ' ')
    .replace(/\b(LLC|L\.L\.C\.|LP|L\.P\.|INC|INC\.|CORP|CORP\.|LLP|CO|LTD|PLLC)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!core) return { ok: false, reason: 'no_core_name' };

  const escaped = soqlEscape(core);
  const soql = `SELECT Id, Name, Type, Industry FROM Account WHERE Name LIKE '%${escaped}%' LIMIT 5`;
  const result = await soqlQuery(soql);
  if (!result.ok) return result;
  if (!result.records.length) return { ok: true, account: null, reason: 'no_match' };

  // Pick the record whose Name has the smallest length (usually the
  // most canonical — e.g. "TEXAS GSA HOLDINGS, LP" over
  // "BOYD GREENVILLE TEXAS GSA, LLC" if both match).
  const best = [...result.records].sort((a, b) => (a.Name || '').length - (b.Name || '').length)[0];
  return { ok: true, account: best, total_matches: result.records.length };
}

/**
 * Find a Salesforce Contact by email (exact, case-insensitive). Used
 * for broker contact SF linking.
 */
export async function findSalesforceContactByEmail(email) {
  if (!isSalesforceConfigured()) return { ok: false, reason: 'sf_not_configured' };
  if (!email) return { ok: false, reason: 'no_email' };

  const escaped = soqlEscape(email);
  const soql = `SELECT Id, FirstName, LastName, Name, Email, AccountId, Title
                FROM Contact WHERE Email = '${escaped}' LIMIT 2`;
  const result = await soqlQuery(soql);
  if (!result.ok) return result;
  if (!result.records.length) return { ok: true, contact: null, reason: 'no_match' };
  return { ok: true, contact: result.records[0] };
}
