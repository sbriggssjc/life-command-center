// api/_shared/salesforce.js
// ============================================================================
// Salesforce READ-ONLY lookup — Power Automate flow proxy
//
// WHY POWER AUTOMATE: Scott's Salesforce org requires SSO to authenticate
// and he does not have admin rights to register a Connected App for the
// Client Credentials OAuth flow. Instead, a Power Automate flow authenticates
// via its built-in Salesforce connector (which uses the org's SSO token),
// executes the query on our behalf, and returns the result to LCC over
// HTTP. Same pattern as the Teams Alerts webhook — LCC POSTs a tiny JSON,
// PA does the work.
//
// ENV VAR:
//   SF_LOOKUP_WEBHOOK_URL — the full signed URL of the PA flow's HTTP
//                          trigger (includes ?sig=... — treat as a secret).
//
// FLOW CONTRACT (what LCC posts / what PA returns):
//
//   POST <SF_LOOKUP_WEBHOOK_URL>
//   Body: {
//     "operation": "find_account_by_name" | "find_contact_by_email",
//     "value":     "TEXAS GSA HOLDINGS" | "geoff.ficke@colliers.com"
//   }
//
//   Expected success response (PA 200):
//   {
//     "ok": true,
//     "operation": "find_account_by_name",
//     "account":   { "Id": "001...", "Name": "...", "Type": null, "Industry": null }
//     // OR "contact": { "Id": "003...", "Name": "...", "Email": "...", "AccountId": "001..." }
//   }
//   If no match: { "ok": true, "account": null, "reason": "no_match" }
//   If error:    { "ok": false, "reason": "...", "detail": "..." }
// ============================================================================

import { fetchWithTimeout } from './ops-db.js';

export function isSalesforceConfigured() {
  return !!process.env.SF_LOOKUP_WEBHOOK_URL;
}

async function callSfLookupFlow(body) {
  const url = process.env.SF_LOOKUP_WEBHOOK_URL;
  if (!url) return { ok: false, reason: 'sf_not_configured' };

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 15000);

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }

  if (!res.ok) {
    return {
      ok: false,
      reason: 'flow_http_error',
      status: res.status,
      detail: (json?.error || json?.detail || text || '').slice(0, 300),
    };
  }
  if (!json || json.ok !== true) {
    return {
      ok: false,
      reason: json?.reason || 'flow_reported_failure',
      detail: json?.detail || null,
    };
  }
  return json;
}

/**
 * Find a Salesforce Account by owner name. Returns the best candidate or null.
 * The PA flow handles LIKE matching + suffix stripping.
 *
 * @param {string} ownerName
 * @returns {Promise<{ok:boolean, account?:{Id,Name,Type,Industry}|null, reason?:string}>}
 */
export async function findSalesforceAccountByName(ownerName) {
  if (!isSalesforceConfigured()) return { ok: false, reason: 'sf_not_configured' };
  if (!ownerName) return { ok: false, reason: 'no_name' };
  const result = await callSfLookupFlow({
    operation: 'find_account_by_name',
    value: String(ownerName).trim(),
  });
  if (!result.ok) return result;
  // Normalize — flow returns `account` (found) or `account: null` + `reason`.
  return {
    ok:       true,
    account:  result.account || null,
    reason:   result.reason || (result.account ? undefined : 'no_match'),
  };
}

/**
 * Find a Salesforce Contact by email. Returns the matching contact or null.
 *
 * @param {string} email
 * @returns {Promise<{ok:boolean, contact?:{Id,Name,Email,AccountId,...}|null, reason?:string}>}
 */
export async function findSalesforceContactByEmail(email) {
  if (!isSalesforceConfigured()) return { ok: false, reason: 'sf_not_configured' };
  if (!email) return { ok: false, reason: 'no_email' };
  const result = await callSfLookupFlow({
    operation: 'find_contact_by_email',
    value: String(email).trim().toLowerCase(),
  });
  if (!result.ok) return result;
  return {
    ok:       true,
    contact:  result.contact || null,
    reason:   result.reason || (result.contact ? undefined : 'no_match'),
  };
}
