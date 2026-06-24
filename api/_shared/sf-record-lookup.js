// api/_shared/sf-record-lookup.js
// ============================================================================
// T4c — ID-based Salesforce record lookup (Power Automate flow proxy)
// ----------------------------------------------------------------------------
// WHY A NEW FLOW: the existing SF_LOOKUP_WEBHOOK_URL flow is the tenant-keyword
// Comp crawl (`Get Comps` ... Tenant_Name2__c contains(...)) — it tops out at
// 674 comps and can't reach the still-held SF-linked comps that don't match the
// keyword filter. This flow fetches EXACT records by Id. The connector filter is
// OData (eq / gt / contains / or) — NO `IN` (that was the Get_Deals bug). So an
// ID lookup is an `Id eq 'x' or Id eq 'y' ...` chain, NOT `Id IN (...)`.
//
// LCC owns the OData filter STRING (so the PA flow stays trivial + the syntax is
// unit-tested here, not hand-built in PA). The flow holds the SF OAuth.
//
// ENV:
//   SF_RECORD_LOOKUP_URL — full SAS-signed URL of the PA "SF -> LCC: Record
//                          Lookup by ID" flow HTTP trigger (the `?sig=` IS the
//                          authentication — treat the whole URL as a secret).
//
// AUTH: the endpoint is Azure SAS-signed and REFUSES any additional auth scheme
// ("must be authenticated only by Shared Access scheme"). So the POST sends ONLY
// Content-Type + the JSON body — NO Authorization / X-* auth header.
//
// FLOW CONTRACT (what LCC posts / what PA returns):
//   POST <SF_RECORD_LOOKUP_URL>   (Content-Type: application/json only)
//   { "object_type": "Comp__c",
//     "fields": "Id,On_Market_Date__c,CreatedDate",
//     "filter": "Id eq 'a1Y...' or Id eq 'a1Y...' or ...",
//     "request_id": "<uuid for idempotency/logging>" }
//   Success: { "ok": true, "records": [ { "Id": "a1Y...",
//                "On_Market_Date__c": "2026-01-22", "CreatedDate": "..." }, ... ] }
//   (also tolerated: a bare `{ records: [...] }`, the OData `{ value: [...] }`
//    shape, or `{ ok:false, reason }` so a structured failure is reported, never
//    fabricated.)
//
// REUSABILITY: object_type + fields are parameters so the SAME worker + flow can
// later serve property / listing / company lookups — LCC computes which Ids it
// needs for any object and fetches exactly those. v1 targets Comp__c.
// On_Market_Date__c; nothing here hardcodes it.
// ============================================================================

import { fetchWithTimeout } from './ops-db.js';

export function isSfRecordLookupConfigured() {
  return !!process.env.SF_RECORD_LOOKUP_URL;
}

/** Split an array into chunks of at most n (n>=1). */
export function chunk(arr, n) {
  const size = Math.max(1, Number(n) || 1);
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Build an OData `Id eq '...' or Id eq '...'` filter for a batch of ids.
 * NEVER `Id IN (...)` — this connector's filter doesn't support IN.
 * Salesforce ids are [A-Za-z0-9]{15,18} (no quotes possible), but we strip any
 * non-alphanumeric defensively and drop empties so a malformed id can't break
 * the filter string. Returns '' for an empty/garbage batch.
 */
export function buildOdataIdFilter(ids, field = 'Id') {
  const clean = (Array.isArray(ids) ? ids : [])
    .map((v) => String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean);
  if (!clean.length) return '';
  return clean.map((id) => `${field} eq '${id}'`).join(' or ');
}

async function callRecordLookupFlow(body, fetchImpl) {
  const url = process.env.SF_RECORD_LOOKUP_URL;
  // An injected fetch (tests) doesn't need the real URL; production does.
  if (!url && !fetchImpl) return { ok: false, reason: 'sf_record_lookup_not_configured' };
  const f = fetchImpl || ((u, o, t) => fetchWithTimeout(u, o, t));
  // The flow URL is an Azure SAS-signed endpoint: its `?sig=` IS the
  // authentication and the endpoint REFUSES any additional auth scheme ("must
  // be authenticated only by Shared Access scheme"). So send ONLY
  // Content-Type + the JSON body — never an Authorization or X-* auth header.
  const headers = { 'Content-Type': 'application/json' };

  let res;
  try {
    res = await f(url || 'http://sf-record-lookup.invalid', { method: 'POST', headers, body: JSON.stringify(body) }, 20000);
  } catch (e) {
    return { ok: false, reason: 'flow_fetch_error', detail: String((e && e.message) || e).slice(0, 300) };
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }

  if (!res.ok) {
    return { ok: false, reason: 'flow_http_error', status: res.status, detail: (typeof text === 'string' ? text : '').slice(0, 300) };
  }
  // Tolerate { ok:true, records }, a bare { records }, or the OData { value }.
  const records = Array.isArray(json?.records) ? json.records
                : Array.isArray(json?.value) ? json.value
                : Array.isArray(json) ? json
                : null;
  if (records == null) {
    return { ok: false, reason: (json && json.reason) || 'flow_no_records', detail: json ? null : (text || '').slice(0, 300) };
  }
  return { ok: true, records };
}

/**
 * Map raw SF Comp records to the retained-map upsert shape. Tolerant of the
 * Id / id casing and a null/empty date. Only the comp Id is required.
 */
export function normalizeCompRecords(records) {
  const out = [];
  for (const r of (Array.isArray(records) ? records : [])) {
    const id = r && (r.Id || r.id);
    if (!id) continue;
    const omdRaw = r.On_Market_Date__c ?? r.on_market_date ?? null;
    const cdRaw = r.CreatedDate ?? r.created_date ?? null;
    out.push({
      sf_comp_id: String(id),
      on_market_date: omdRaw ? String(omdRaw).slice(0, 10) : null,   // date portion
      created_date: cdRaw ? String(cdRaw).slice(0, 10) : null,
    });
  }
  return out;
}

/**
 * Fetch SF records by id in OData-or-chained batches. Deps-injected fetch for
 * tests. Returns { ok, records, batches_run, batches_failed, errors }.
 *
 * @param {{objectType:string, fields:string, ids:string[], batchSize?:number,
 *          requestIdSeed?:string, fetchImpl?:Function, deadline?:number}} args
 */
export async function lookupSfRecordsByIds({ objectType, fields, ids, batchSize = 100, requestIdSeed = 't4c', fetchImpl, deadline = 0 } = {}) {
  if (!isSfRecordLookupConfigured() && !fetchImpl) return { ok: false, reason: 'sf_record_lookup_not_configured' };
  const batches = chunk(Array.isArray(ids) ? ids : [], batchSize);
  const records = [];
  const errors = [];
  let run = 0, failed = 0, stopped = false;
  for (let i = 0; i < batches.length; i++) {
    if (deadline && Date.now() > deadline) { stopped = true; break; }
    const filter = buildOdataIdFilter(batches[i]);
    if (!filter) continue;
    const r = await callRecordLookupFlow({
      object_type: objectType, fields, filter,
      request_id: `${requestIdSeed}-${i}`,
    }, fetchImpl);
    run++;
    if (r.ok) {
      for (const rec of r.records) records.push(rec);
    } else {
      failed++;
      errors.push({ batch: i, reason: r.reason, status: r.status || null, detail: r.detail || null });
    }
  }
  return { ok: failed === 0, records, batches_run: run, batches_failed: failed, batches_total: batches.length, budget_stopped: stopped, errors };
}
