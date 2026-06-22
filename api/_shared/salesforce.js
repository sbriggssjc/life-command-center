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

/** Today in YYYY-MM-DD (UTC). */
function todayUtcYmd() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Coerce a date-ish value to YYYY-MM-DD (UTC). Accepts a Date, an ISO
 * timestamp (e.g. a cadence `next_touch_due` of `2026-09-07T00:00:00+00:00`),
 * or an already-formatted date string. Returns null when it can't produce a
 * clean YYYY-MM-DD so the caller can fall back to today.
 */
function normalizeActivityDate(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  // Already a date or timestamp leading with YYYY-MM-DD — take the date portion.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Coerce a flow-error value of ANY shape to a human-readable string. A Power
 * Automate / Salesforce-connector non-2xx body commonly arrives as
 * `{error:{message}}`, `{message}`, or an array of `{message}` — calling
 * `.slice` on those objects throws `TypeError: ... .slice is not a function`,
 * which then masks the real Salesforce error (R52b, 2026-06-21). Always coerce
 * to a string before slicing.
 */
function pickFlowMessage(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.length ? pickFlowMessage(v[0]) : '';
  if (v && typeof v === 'object') {
    return v.message || v.error_description || v.errorMessage || JSON.stringify(v);
  }
  return '';
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
    const detailRaw = pickFlowMessage(json?.error)
      || pickFlowMessage(json?.detail)
      || (typeof text === 'string' ? text : '')
      || '';
    return {
      ok: false,
      reason: 'flow_http_error',
      status: res.status,
      detail: String(detailRaw).slice(0, 500),
    };
  }
  if (!json || json.ok !== true) {
    const detailRaw = pickFlowMessage(json?.detail) || pickFlowMessage(json?.error) || '';
    return {
      ok: false,
      reason: json?.reason || 'flow_reported_failure',
      detail: detailRaw ? String(detailRaw).slice(0, 500) : null,
    };
  }
  return json;
}

export { pickFlowMessage };

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
  // Score every candidate, keep them sorted desc — the caller (Decision Center
  // SF-mapping card) renders the full pick-list so a near-miss on the top-1
  // (e.g. "Boyd Watterson Global" vs an account named "Boyd Watterson Asset
  // Management") is recoverable instead of a dead end.
  const scored = candidates
    .map((cand) => ({
      Id: cand?.Id || cand?.id || null,
      Name: cand?.Name || cand?.name || null,
      Type: cand?.Type || cand?.type || null,
      Industry: cand?.Industry || cand?.industry || null,
      score: scoreCandidate(targetNorm, normalizeBusinessName(cand?.Name)),
    }))
    .filter((c) => c.Id && c.Name)
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 12);
  const bestCand = scored[0] || null;
  const bestScore = bestCand ? bestCand.score : 0;

  // Minimum confidence to AUTO-accept: 0.50 — below that we don't pre-pick an
  // account, but we STILL return the candidate list so the user can choose.
  if (bestScore < 0.50) {
    return {
      ok: true,
      account: null,
      reason: 'no_good_match',
      candidates: top,
      candidates_count: candidates.length,
      best_candidate_name: bestCand?.Name || null,
      best_candidate_score: bestScore,
    };
  }

  return {
    ok:               true,
    account:          bestCand,
    candidates:       top,
    candidates_count: candidates.length,
    score:            bestScore,
  };
}

/**
 * Fetch a Salesforce Account by its 15/18-char Id, to confirm the name before
 * a manual map. Tries a `find_account_by_id` flow operation; tolerates flows
 * that don't implement it (returns ok:false so the UI can map unverified).
 *
 * @param {string} accountId
 * @returns {Promise<{ok:boolean, account?:{Id,Name,Type,Industry}|null, reason?:string}>}
 */
export async function getSalesforceAccountById(accountId) {
  if (!isSalesforceConfigured()) return { ok: false, reason: 'sf_not_configured' };
  const id = String(accountId || '').trim();
  if (!/^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/.test(id)) return { ok: false, reason: 'bad_id_shape' };
  const result = await callSfLookupFlow({ operation: 'find_account_by_id', value: id });
  if (!result || result.ok !== true) {
    return { ok: false, reason: result?.reason || 'lookup_failed' };
  }
  let acct = null;
  if (result.account) acct = result.account;
  else if (Array.isArray(result.candidates) && result.candidates.length) acct = result.candidates[0];
  if (!acct || !(acct.Id || acct.id)) return { ok: true, account: null, reason: 'no_match' };
  return {
    ok: true,
    account: {
      Id: acct.Id || acct.id,
      Name: acct.Name || acct.name || null,
      Type: acct.Type || acct.type || null,
      Industry: acct.Industry || acct.industry || null,
    },
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

/**
 * List Salesforce Contacts on a given Account (the mapped buyer-parent account),
 * so the buy-side cadence can be attached to the right person. Uses the
 * `find_contacts_by_account` flow op; tolerant of flows that don't implement it
 * (returns ok:false so the caller can fall back to entity-graph candidates).
 *
 * @param {string} accountId — 15/18-char SF Account Id
 * @returns {Promise<{ok:boolean, contacts?:Array<{Id,Name,Title,Email}>, reason?:string}>}
 */
export async function getSalesforceContactsByAccount(accountId) {
  if (!isSalesforceConfigured()) return { ok: false, reason: 'sf_not_configured' };
  const id = String(accountId || '').trim();
  if (!/^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/.test(id)) return { ok: false, reason: 'bad_account_id' };
  const result = await callSfLookupFlow({ operation: 'find_contacts_by_account', value: id });
  if (!result || result.ok !== true) return { ok: false, reason: result?.reason || 'lookup_failed' };
  const rows = Array.isArray(result.contacts) ? result.contacts
            : Array.isArray(result.candidates) ? result.candidates : [];
  const contacts = rows
    .map((c) => ({
      Id: c?.Id || c?.id || null,
      Name: c?.Name || c?.name || null,
      Title: c?.Title || c?.title || null,
      Email: c?.Email || c?.email || null,
    }))
    .filter((c) => c.Id && c.Name);
  return { ok: true, contacts };
}

/**
 * Create a Salesforce Task (Activity) on a Contact — NOT a standard SF
 * Opportunity record (R16, 2026-06-09). In NorthMarq's org there is no
 * Opportunity object: an "opportunity" is an OPEN Task on a Contact whose
 * custom NMType picklist = "Opportunity" (signals a seller prospect). Buyers /
 * brokers / to-dos are a Task with NMType blank or another value. This matches
 * the codebase's ORIGINAL design — migration
 * `20260423250000_sf_sync_queue_expand_kinds.sql` documents `create_opportunity
 * = create a Task with NMType=Opportunity`. The R5/R7 helper had drifted to a
 * real-Opportunity payload (account_id / stage_name / amount); it never
 * succeeded live (no matching PA case), so this is a clean correction.
 *
 * This is a WRITE op, so the Power Automate flow needs a `create_opportunity`
 * case (the operation string is kept so the PA Switch + the sf_sync_queue enum
 * — which already use it — don't need to change). Tolerant of flows that don't
 * implement it yet — returns ok:false reason='unsupported'/'unavailable' so the
 * caller can leave the work pending and report honestly.
 *
 * FLOW CONTRACT (what LCC posts / what PA returns):
 *   POST <SF_LOOKUP_WEBHOOK_URL>
 *   { "operation": "create_opportunity",
 *     "who_id": "003...",            // SF Contact Id (WhoId) — REQUIRED
 *     "subject": "Boyd Watterson Global — Government Buyer",
 *     "nm_type": "Opportunity",      // seller prospect; OMITTED for buyers
 *     "status": "Open",
 *     "activity_date": "2026-09-07", // optional; PA defaults to today
 *     "what_id": "001...",           // optional Account (WhatId) for context
 *     "idempotency_key": "<lcc bd_opportunity id>" }  // PA SHOULD upsert on this
 *   Success: { "ok": true, "task": { "Id": "00T..." } }  // accepts opportunity{Id} too
 *   Not implemented: { "ok": false, "reason": "unsupported" } (or HTTP 4xx)
 *
 * @param {{whoId?:string, who_id?:string, subject:string, nmType?:string|null,
 *          status?:string, activityDate?:string, whatId?:string,
 *          idempotencyKey?:string}} task
 * @returns {Promise<{ok:boolean, task?:{Id}|null, reason?:string, detail?:any}>}
 */
export async function createSalesforceTask(task) {
  if (!isSalesforceConfigured()) return { ok: false, reason: 'sf_not_configured' };
  const whoId = String(task?.whoId || task?.who_id || '').trim();
  const subject = String(task?.subject || '').trim();
  if (!/^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/.test(whoId)) return { ok: false, reason: 'bad_who_id' };
  if (!subject) return { ok: false, reason: 'no_subject' };

  const body = { operation: 'create_opportunity', who_id: whoId, subject };
  // NMType: "Opportunity" for seller prospects; OMIT/empty for buyers (a blank
  // NMType is a plain buy-side touchpoint, never an "Opportunity").
  const nmType = (task?.nmType != null) ? String(task.nmType).trim() : '';
  if (nmType) body.nm_type = nmType;
  body.status = task?.status ? String(task.status) : 'Open';
  // ActivityDate (Task Due Date): ALWAYS send a clean YYYY-MM-DD, never null.
  // PA's date field rejected a typed default expression (saved it as literal
  // text → runtime failure), so LCC owns the value and PA just inserts the
  // token. Use the caller's date (the cadence `next_touch_due`) when supplied
  // (accepts `activityDate` or the snake_case `activity_date` alias); otherwise
  // default to today (UTC). (R16b, 2026-06-10.)
  const rawActivityDate = (task?.activityDate != null) ? task.activityDate
                        : (task?.activity_date != null) ? task.activity_date
                        : null;
  body.activity_date = normalizeActivityDate(rawActivityDate) || todayUtcYmd();
  const whatId = task?.whatId ? String(task.whatId).trim() : '';
  if (whatId && /^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/.test(whatId)) body.what_id = whatId;
  if (task?.idempotencyKey) body.idempotency_key = String(task.idempotencyKey);

  const result = await callSfLookupFlow(body);
  if (!result || result.ok !== true) {
    return { ok: false, reason: result?.reason || 'lookup_failed', detail: result?.detail || null };
  }
  // Accept the Task shape {task:{Id}} and the legacy {opportunity:{Id}} for
  // back-compat while the PA flow case is being built.
  const t = result.task || result.opportunity || result.record || null;
  const id = t ? (t.Id || t.id) : null;
  if (!id) return { ok: false, reason: result.reason || 'no_task_returned' };
  return { ok: true, task: { Id: id } };
}

/**
 * Back-compat thin alias: seller-prospect convenience that defaults
 * `nmType:'Opportunity'`. Prefer calling createSalesforceTask directly with an
 * explicit nmType. Returns the same `{ok, task:{Id}}` shape.
 *
 * @param {{whoId?:string, who_id?:string, subject:string, nmType?:string|null,
 *          status?:string, activityDate?:string, whatId?:string,
 *          idempotencyKey?:string}} task
 */
export async function createSalesforceOpportunity(task) {
  const nmType = (task && task.nmType !== undefined) ? task.nmType : 'Opportunity';
  return createSalesforceTask(Object.assign({}, task, { nmType }));
}

/**
 * Split a full name into {firstName, lastName} for Salesforce (Contact.LastName
 * is REQUIRED). Last token is LastName; everything before is FirstName. A
 * single-token name becomes the LastName (SF requires it).
 */
function splitContactName(name) {
  const t = String(name || '').trim().replace(/\s+/g, ' ');
  if (!t) return { firstName: null, lastName: null };
  const toks = t.split(' ');
  if (toks.length === 1) return { firstName: null, lastName: toks[0] };
  return { firstName: toks.slice(0, -1).join(' '), lastName: toks[toks.length - 1] };
}

/**
 * UPSERT a Salesforce Contact by email — the OUT half of the contact loop (R52).
 * Contacts flow IN (CoStar/SF pull) and opportunities flow OUT today, but a
 * captured/resolved contact is never pushed to the CRM. This pushes one,
 * upsert-by-email so Salesforce is never duplicated: the PA flow's SOQL finds an
 * existing Contact by Email and UPDATEs it, else INSERTs (mirrors the
 * create_opportunity rollout — Scott wires the PA `upsert_contact` case).
 *
 * Tolerant of flows that don't implement it yet — returns ok:false
 * reason='unsupported'/'unavailable' so the worker leaves the row pending and
 * reports honestly (same posture as createSalesforceTask). Never throws here;
 * the worker only writes the identity mirror on ok + a returned Id.
 *
 * FLOW CONTRACT (what LCC posts / what PA returns):
 *   POST <SF_LOOKUP_WEBHOOK_URL>
 *   { "operation": "upsert_contact",
 *     "email": "geoff.ficke@colliers.com",  // the upsert key — REQUIRED
 *     "first_name": "Geoff", "last_name": "Ficke", "name": "Geoff Ficke",
 *     "phone": "(408) 459-8476",
 *     "company": "Colliers International",   // → Contact firm context (optional)
 *     "account_id": "001...",               // link to the owner's SF Account (optional)
 *     "mailing_street": "...", "mailing_city": "...",
 *     "mailing_state": "...", "mailing_postal_code": "...",
 *     "idempotency_key": "<lcc entity id>" }
 *   Success: { "ok": true, "created": true|false,
 *              "contact": { "Id": "003...", "Email": "...",
 *                           "MailingStreet": "...", "MailingCity": "...",
 *                           "MailingState": "...", "MailingPostalCode": "...",
 *                           "Phone": "..." } }
 *   Not implemented: { "ok": false, "reason": "unsupported" } (or HTTP 4xx)
 *
 * @param {{name?:string, email:string, phone?:string, company?:string,
 *          accountId?:string, address?:string, city?:string, state?:string,
 *          zip?:string, idempotencyKey?:string}} contact
 * @returns {Promise<{ok:boolean, contact?:object|null, created?:boolean, reason?:string, detail?:any}>}
 */
export async function upsertSalesforceContact(contact) {
  if (!isSalesforceConfigured()) return { ok: false, reason: 'sf_not_configured' };
  const email = String(contact?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, reason: 'no_email' };

  const { firstName, lastName } = splitContactName(contact?.name);
  if (!lastName) return { ok: false, reason: 'no_name' };

  const body = { operation: 'upsert_contact', email, last_name: lastName };
  if (firstName) body.first_name = firstName;
  if (contact?.name) body.name = String(contact.name).trim();
  if (contact?.phone) body.phone = String(contact.phone).trim();
  if (contact?.company) body.company = String(contact.company).trim();
  const accountId = contact?.accountId ? String(contact.accountId).trim() : '';
  if (accountId && /^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/.test(accountId)) body.account_id = accountId;
  if (contact?.address) body.mailing_street = String(contact.address).trim();
  if (contact?.city) body.mailing_city = String(contact.city).trim();
  if (contact?.state) body.mailing_state = String(contact.state).trim();
  if (contact?.zip) body.mailing_postal_code = String(contact.zip).trim();
  if (contact?.idempotencyKey) body.idempotency_key = String(contact.idempotencyKey);

  const result = await callSfLookupFlow(body);
  if (!result || result.ok !== true) {
    return { ok: false, reason: result?.reason || 'lookup_failed', detail: result?.detail || null };
  }
  const c = result.contact || result.record || null;
  const id = c ? (c.Id || c.id) : null;
  if (!id) return { ok: false, reason: result.reason || 'no_contact_returned' };
  return { ok: true, contact: c, created: result.created !== false ? !!result.created : false };
}

/**
 * UPSERT a Salesforce Account by name (R52c, 2026-06-21). Scott's org requires
 * every Contact to be tied to a Company (the Account object is relabeled
 * "Company"; Contact.AccountId is required), so the writeback can't INSERT a
 * Contact without first establishing its Account. This finds an Account by an
 * EXACT Name match (Top 1) and returns it, else CREATEs one with just the Name
 * (verified in SF: Name is the only required Account field). Same flow-op
 * rollout pattern as upsert_contact — Scott wires the PA `upsert_account` case.
 *
 * Tolerant of flows that don't implement it yet — returns ok:false
 * reason='unsupported'/'unavailable' so the worker leaves the row pending and
 * reports honestly (never throws; the worker only attaches the contact + mirrors
 * the account identity on ok + a returned Id).
 *
 * FLOW CONTRACT (what LCC posts / what PA returns):
 *   POST <SF_LOOKUP_WEBHOOK_URL>
 *   { "operation": "upsert_account",
 *     "name": "Next Generation Capital LLC",   // the find-or-create key — REQUIRED
 *     "idempotency_key": "<lcc owner/person entity id>" }
 *   Success existing: { "ok": true, "created": false, "account": { "Id": "001...", "Name": "..." } }
 *   Success created:  { "ok": true, "created": true,  "account": { "Id": "001...", "Name": "..." } }
 *   Not implemented:  { "ok": false, "reason": "unsupported" } (or HTTP 4xx)
 *
 * @param {{name:string, idempotencyKey?:string}} account
 * @returns {Promise<{ok:boolean, accountId?:string, created?:boolean, account?:object|null, reason?:string, detail?:any}>}
 */
export async function upsertSalesforceAccount(account) {
  if (!isSalesforceConfigured()) return { ok: false, reason: 'sf_not_configured' };
  const name = String(account?.name || '').trim();
  if (!name) return { ok: false, reason: 'no_name' };

  const body = { operation: 'upsert_account', name };
  if (account?.idempotencyKey) body.idempotency_key = String(account.idempotencyKey);

  const result = await callSfLookupFlow(body);
  if (!result || result.ok !== true) {
    return { ok: false, reason: result?.reason || 'lookup_failed', detail: result?.detail || null };
  }
  const a = result.account || result.record || null;
  const id = a ? (a.Id || a.id) : null;
  if (!id) return { ok: false, reason: result.reason || 'no_account_returned' };
  return { ok: true, accountId: id, account: a, created: result.created === true };
}
