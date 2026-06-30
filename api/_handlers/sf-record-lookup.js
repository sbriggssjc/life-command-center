// api/_handlers/sf-record-lookup.js
// ============================================================================
// T4c — ID-based SF record-lookup worker (recover the ~560 the broad crawl
// can't reach)
// ----------------------------------------------------------------------------
// The broad PA Comp crawl is exhausted at 674 comps (the tenant-keyword filter
// can't reach the still-held SF-linked comps that don't match it). This worker
// closes the gap by ID: it computes the comp IDs LCC is MISSING (linked to a
// still-HELD dia/gov listing, not yet in lcc_sf_comp_on_market), fetches each
// one's On_Market_Date__c by Id from Salesforce via the PA record-lookup flow,
// lands them in the retained map, and re-runs the EXISTING reversible
// fill-held-only backfill.
//
//   GET  → dry-run: compute the missing-ID set + batch plan, write NOTHING,
//          POST to no flow.
//   POST → drain: fetch the missing OMDs (gated on SF_RECORD_LOOKUP_URL),
//          upsert the retained map, re-run lcc_apply_on_market_backfill
//          (p_dry_run=false, batch_tag 't4c_recovery_lookup'); report dia/gov
//          updated counts + the still-missing residual.
//
// Reuses (never forks): v_lcc_missing_comp_ids + lcc_upsert_sf_comp_on_market
// (this round's migration), the retained map + v_lcc_on_market_backfill_map +
// the dia/gov lcc_apply_on_market_backfill (T4c recovery). Feature-flagged on
// SF_RECORD_LOOKUP_URL (clear no-op when unset). Reversible under the batch tag.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import {
  isSfRecordLookupConfigured, lookupSfRecordsByIds, normalizeCompRecords, chunk,
} from '../_shared/sf-record-lookup.js';

// view match_domain → domainQuery / backfill canonical key (long-form accepted)
const DOMAINS = ['dialysis', 'government'];

const DEFAULT_OBJECT_TYPE = 'Comp__c';
const DEFAULT_FIELDS = 'Id,On_Market_Date__c,CreatedDate';

/**
 * PURE: decide which missing comp IDs to fetch. A comp is fetchable when it is
 * linked to a listing that is STILL HELD on the domain side (the OMD is only
 * useful to a held listing; fill-held-only makes a non-held fetch wasted SF
 * cost). De-dupes comp IDs across listings/domains.
 *
 * @param {{viewRows:Array<{match_domain,listing_id,sf_comp_id}>,
 *          heldByDomain:Object<string,Set<string>>, domains:string[]}} args
 * @returns {{missingIds:string[], byDomain:Object, totalMissingComps:number}}
 */
export function planMissingCompFetch({ viewRows, heldByDomain, domains }) {
  const scope = new Set(domains && domains.length ? domains : DOMAINS);
  const byDomain = {};
  for (const d of scope) byDomain[d] = { missing_listings: new Set(), held_missing_listings: new Set(), missing_comps_held: new Set(), missing_comps_not_held: new Set() };
  const missingHeld = new Set();   // comp ids whose listing is still held (the fetch set)

  for (const r of (Array.isArray(viewRows) ? viewRows : [])) {
    const dom = r && r.match_domain;
    if (!scope.has(dom)) continue;
    const compId = r.sf_comp_id;
    const listingId = r.listing_id != null ? String(r.listing_id) : null;
    if (!compId || !listingId) continue;
    const dd = byDomain[dom];
    dd.missing_listings.add(listingId);
    const held = heldByDomain && heldByDomain[dom] && heldByDomain[dom].has(listingId);
    if (held) {
      dd.held_missing_listings.add(listingId);
      dd.missing_comps_held.add(compId);
      missingHeld.add(compId);
    } else {
      dd.missing_comps_not_held.add(compId);
    }
  }

  const byDomainOut = {};
  let totalMissing = 0;
  for (const d of scope) {
    const dd = byDomain[d];
    totalMissing += dd.missing_comps_held.size + dd.missing_comps_not_held.size;
    byDomainOut[d] = {
      missing_listings: dd.missing_listings.size,
      held_missing_listings: dd.held_missing_listings.size,
      missing_comps_held: dd.missing_comps_held.size,        // the fetch target
      missing_comps_not_held: dd.missing_comps_not_held.size, // not fetched (listing no longer held)
    };
  }
  return { missingIds: Array.from(missingHeld), byDomain: byDomainOut, totalMissingComps: totalMissing };
}

// Page through a domain's still-held listing ids (PostgREST caps at 1000/resp).
// "Held" = a listing whose on_market_date is still unrecovered: the original T4c
// `unestablished` set PLUS the R2-D `date_uncertain` set (T9d FIX moved the SF-comp
// listings there). Both are fill-only-when-blank targets for a recovered OMD, so
// fetching their comps' OMDs is never wasted SF cost.
async function loadHeldListingIds(domain) {
  const ids = new Set();
  let offset = 0;
  for (let page = 0; page < 50; page++) {   // 50k cap — far above any held set
    const r = await domainQuery(domain, 'GET',
      `available_listings?on_market_date_source=in.(unestablished,date_uncertain)&select=listing_id&limit=1000&offset=${offset}`);
    if (!r.ok || !Array.isArray(r.data)) return { ok: false, status: r.status, detail: r.data };
    for (const row of r.data) if (row && row.listing_id != null) ids.add(String(row.listing_id));
    if (r.data.length < 1000) break;
    offset += 1000;
  }
  return { ok: true, ids };
}

// Build the backfill payload for one domain from v_lcc_on_market_backfill_map.
async function buildBackfillPayload(domain) {
  const rows = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const r = await opsQuery('GET',
      `v_lcc_on_market_backfill_map?match_domain=eq.${encodeURIComponent(domain)}&limit=1000&offset=${offset}`);
    if (!r.ok || !Array.isArray(r.data)) return { ok: false, status: r.status, detail: r.data };
    for (const m of r.data) {
      const omd = m.on_market_date || m.created_date_fallback || null;
      if (!omd) continue;   // never write a NULL date
      rows.push({
        listing_id: String(m.listing_id),
        on_market_date: String(omd).slice(0, 10),
        source: m.on_market_date ? 'sf_on_market_date' : 'sf_created_date',
        confidence: m.on_market_date ? 'high' : 'low',
        sf_comp_id: m.sf_comp_id || null,
      });
    }
    if (r.data.length < 1000) break;
    offset += 1000;
  }
  return { ok: true, rows };
}

// ── HTTP entrypoint ─────────────────────────────────────────────────────────
export async function handleSfRecordLookupTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST (drain) only' });
  }
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit || '1000', 10)));      // max comp IDs to fetch this tick
  // <=20/batch by default: a 100-Id `eq ... or ...` SOQL overruns the synchronous
  // PA flow's response window (502 NoResponse). Override via ?batch_size= (1..100)
  // with NO redeploy. Batches run sequentially (concurrency 1) — overlapping calls
  // to the sync flow also risk NoResponse.
  const batchSize = Math.min(100, Math.max(1, parseInt(req.query.batch_size || '20', 10)));
  const objectType = String(req.query.object_type || DEFAULT_OBJECT_TYPE);                 // reusable seam
  const fields = String(req.query.fields || DEFAULT_FIELDS);
  const requested = String(req.query.domain || 'both').toLowerCase();
  const domains = requested === 'both' ? DOMAINS
    : DOMAINS.filter((d) => d === requested || d.slice(0, 3) === requested); // accept dia/gov too
  const deadline = Date.now() + parseInt(process.env.SF_RECORD_LOOKUP_BUDGET_MS || '22000', 10);

  const result = {
    mode: dryRun ? 'dry_run' : 'apply',
    object_type: objectType,
    domains,
    by_domain: {},
    totals: {},
  };

  // 1) Compute the LCC-derivable missing set (one paged read; ~730 rows today).
  const viewRows = [];
  {
    let offset = 0;
    for (let page = 0; page < 50; page++) {
      const r = await opsQuery('GET',
        `v_lcc_missing_comp_ids?select=match_domain,listing_id,sf_comp_id&limit=1000&offset=${offset}`);
      if (!r.ok || !Array.isArray(r.data)) {
        return res.status(502).json({ error: 'failed_to_load_missing_comp_ids', status: r.status, detail: r.data });
      }
      viewRows.push(...r.data);
      if (r.data.length < 1000) break;
      offset += 1000;
    }
  }

  // 2) Narrow to still-held listings, domain-side.
  const heldByDomain = {};
  for (const d of domains) {
    const h = await loadHeldListingIds(d);
    if (!h.ok) { result.by_domain[d] = { error: h.detail || ('held_load_failed:' + h.status) }; continue; }
    heldByDomain[d] = h.ids;
  }

  const plan = planMissingCompFetch({ viewRows, heldByDomain, domains });
  for (const d of domains) if (!result.by_domain[d]) result.by_domain[d] = plan.byDomain[d] || {};
  const fetchIds = plan.missingIds.slice(0, limit);
  const batchPlan = chunk(fetchIds, batchSize);

  result.totals = {
    missing_comps_total: plan.totalMissingComps,            // LCC-derivable (held + not-held)
    missing_comps_held: plan.missingIds.length,             // the fetch target (still-held)
    would_fetch: fetchIds.length,                           // capped by ?limit
    batches: batchPlan.length,
    batch_size: batchSize,
    capped: fetchIds.length < plan.missingIds.length,
  };

  if (dryRun) {
    result.sample_ids = fetchIds.slice(0, 10);
    result.flow_configured = isSfRecordLookupConfigured();
    return res.status(200).json(result);
  }

  // ── DRAIN ──────────────────────────────────────────────────────────────────
  if (!isSfRecordLookupConfigured()) {
    return res.status(503).json({
      error: 'sf_record_lookup_not_configured',
      message: 'Set SF_RECORD_LOOKUP_URL (the PA "SF -> LCC: Record Lookup by ID" flow) to drain. Dry-run (GET) works without it.',
      ...result,
    });
  }

  if (!fetchIds.length) {
    result.fetched = 0; result.landed = 0; result.backfill = {};
    return res.status(200).json(result);
  }

  // 2a) Fetch the missing OMDs by Id (OData eq/or chain, <=100/batch).
  const lookup = await lookupSfRecordsByIds({
    objectType, fields, ids: fetchIds, batchSize,
    requestIdSeed: 't4c-' + new Date().toISOString().slice(0, 10), deadline,
  });
  result.lookup = {
    ok: lookup.ok, batches_run: lookup.batches_run, batches_failed: lookup.batches_failed,
    batches_total: lookup.batches_total, budget_stopped: !!lookup.budget_stopped,
    records: Array.isArray(lookup.records) ? lookup.records.length : 0,
  };
  if (lookup.errors && lookup.errors.length) result.lookup.errors = lookup.errors.slice(0, 5);

  // 2b) Land them in the retained map (reuse the harvest ON CONFLICT semantics).
  const rows = normalizeCompRecords(lookup.records);
  if (rows.length) {
    const up = await opsQuery('POST', 'rpc/lcc_upsert_sf_comp_on_market', { p_rows: rows });
    const u = Array.isArray(up.data) ? up.data[0] : up.data;
    result.landed = up.ok ? (u && (u.upserted ?? u.UPSERTED) || rows.length) : 0;
    result.landed_with_omd = up.ok ? (u && (u.with_omd ?? u.WITH_OMD)) ?? null : null;
    if (!up.ok) result.landed_error = up.data;
  } else {
    result.landed = 0;
    result.fetched_with_omd = 0;
  }
  result.fetched = rows.length;
  result.fetched_with_omd = rows.filter((r) => r.on_market_date).length;

  // 3) Re-run the EXISTING reversible fill-held-only backfill per domain.
  result.backfill = {};
  for (const d of domains) {
    if (result.by_domain[d] && result.by_domain[d].error) continue;
    const pay = await buildBackfillPayload(d);
    if (!pay.ok) { result.backfill[d] = { error: pay.detail || ('payload_failed:' + pay.status) }; continue; }
    if (!pay.rows.length) { result.backfill[d] = { matched: 0, updated: 0, residual_payload: 0 }; continue; }
    const bf = await domainQuery(d, 'POST', 'rpc/lcc_apply_on_market_backfill', {
      p_rows: pay.rows, p_dry_run: false, p_batch_tag: 't4c_recovery_lookup',
    });
    const row = Array.isArray(bf.data) ? bf.data[0] : bf.data;
    result.backfill[d] = bf.ok
      ? { matched: row?.matched ?? null, would_update: row?.would_update ?? null, updated: row?.updated ?? null, skipped_not_held: row?.skipped_not_held ?? null, payload_rows: pay.rows.length }
      : { error: bf.data, payload_rows: pay.rows.length };
  }

  // 4) Residual: still-held missing comps NOT recovered this tick (no OMD in SF,
  //    or capped/over-budget). Honest — held, never fabricated.
  const recoveredOmd = new Set(rows.filter((r) => r.on_market_date).map((r) => r.sf_comp_id));
  result.residual = {
    still_missing_after_tick: Math.max(0, plan.missingIds.length - recoveredOmd.size),
    no_omd_in_sf: rows.filter((r) => !r.on_market_date).length,
    capped_deferred: Math.max(0, plan.missingIds.length - fetchIds.length),
  };

  return res.status(200).json(result);
}
