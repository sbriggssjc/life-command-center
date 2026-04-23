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
 * Normalize a business name for fuzzy comparison: lowercase, strip
 * punctuation, strip entity suffixes (LP/LLC/Inc/Corp/Co/Ltd/LLP/PLLC).
 */
function normalizeBusinessName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,;:'"]/g, ' ')
    .replace(/\b(llc|l\.l\.c\.|lp|l\.p\.|inc|inc\.|corp|corp\.|llp|co|ltd|pllc|the)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score a candidate SF Account against the target owner name. Higher is
 * better. Uses:
 *   - Exact normalized name match: 1.00
 *   - Target is substring of candidate (or vice versa): 0.85
 *   - Shared-token ratio (jaccard on words): 0 .. 0.80
 * Returns 0 for no overlap.
 */
function scoreCandidate(targetNorm, candidateNorm) {
  if (!candidateNorm) return 0;
  if (candidateNorm === targetNorm) return 1.00;
  if (candidateNorm.includes(targetNorm) || targetNorm.includes(candidateNorm)) return 0.85;
  const targetWords = new Set(targetNorm.split(' ').filter(w => w.length > 1));
  const candWords   = new Set(candidateNorm.split(' ').filter(w => w.length > 1));
  if (!targetWords.size || !candWords.size) return 0;
  let shared = 0;
  for (const w of targetWords) if (candWords.has(w)) shared++;
  const jaccard = shared / (targetWords.size + candWords.size - shared);
  return Math.min(0.80, jaccard);
}

/**
 * Find a Salesforce Account by owner name. Returns the best candidate or null.
 * PA flow returns up to 5 LIKE-matched records; we score them against the
 * target name and pick the best. Minimum score to accept: 0.50.
 *
 * @param {string} ownerName
 * @returns {Promise<{ok:boolean, account?:{Id,Name,Type,Industry}|null, reason?:string, candidates_count?:number, score?:number}>}
 */
export async function findSalesforceAccountByName(ownerName) {
  if (!isSalesforceConfigured()) return { ok: false, reason: 'sf_not_configured' };
  if (!ownerName) return { ok: false, reason: 'no_name' };

  const result = await callSfLookupFlow({
    operation: 'find_account_by_name',
    value: String(ownerName).trim(),
  });
  if (!result.ok) return result;

  // Tolerate both shapes while flow evolves:
  //   - { candidates: [array] }  (new preferred)
  //   - { account: {one} }       (legacy)
  let candidates = [];
  if (Array.isArray(result.candidates)) {
    candidates = result.candidates;
  } else if (result.account) {
    candidates = [result.account];
  }
  if (!candidates.length) {
    return { ok: true, account: null, reason: 'no_match' };
  }

  const targetNorm = normalizeBusinessName(ownerName);
  let bestCand = null;
  let bestScore = 0;
  for (const cand of candidates) {
    const candNorm = normalizeBusinessName(cand?.Name);
    const s = scoreCandidate(targetNorm, candNorm);
    if (s > bestScore) { bestScore = s; bestCand = cand; }
  }

  // Minimum confidence to accept: 0.50 — below that we'd rather flag as
  // no_match and let a human decide than auto-link to the wrong Account.
  if (bestScore < 0.50) {
    return {
      ok: true,
      account: null,
      reason: 'no_good_match',
      candidates_count: candidates.length,
      best_candidate_name: bestCand?.Name || null,
      best_candidate_score: bestScore,
    };
  }

  return {
    ok:               true,
    account:          bestCand,
    candidates_count: candidates.length,
    score:            bestScore,
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

  // Email match is exact. If flow returns candidates[], the first is the
  // match (limited to 2 via LIMIT 2). Tolerate legacy {contact: ...} too.
  let picked = null;
  if (Array.isArray(result.candidates) && result.candidates.length) {
    picked = result.candidates[0];
  } else if (result.contact) {
    picked = result.contact;
  }
  return {
    ok:      true,
    contact: picked || null,
    reason:  picked ? undefined : 'no_match',
  };
}
