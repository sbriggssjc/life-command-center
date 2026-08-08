// api/_handlers/sf-cis-ingest.js
// ============================================================================
// Salesforce Closed-IS (CIS) national export → dia_nm_cis_closings ingest.
//
//   POST /api/intake?_route=sf-cis   (mounted as /api/intake-sf-cis)
//   Body: { records: [ { sf_record_id, address, city, state, sold_date,
//                        sold_price, listing_broker, procuring_broker,
//                        deal_name }, ... ] }   (a bare array is also accepted)
//
// A SCHEDULED Salesforce report ("Closed IS", dialysis/medical, ALL owners) is
// pushed by Power Automate to this route. Each row UPSERTS into Dialysis_DB
// `dia_nm_cis_closings` keyed by the SF RECORD ID (idempotency key) — so a
// re-send (or the first-run 2023+ backfill re-run) is a no-op, never a dupe.
//
// The CIS export is Northmarq's OWN closed Investment-Sales book, so it is the
// AUTHORITATIVE attribution layer: v_dia_nm_closing_evidence already UNIONs
// dia_nm_cis_closings, and the `dia_nm_cis_link` SQL step (fired here in real
// time + nightly via cron) resolves each closing to a property + sale and flags
// is_northmarq, so it CERTIFIES in v_dia_nm_attribution_audit automatically.
//
// This handler NEVER matches/flags sales itself — it stages the closing + fires
// the conservative SQL link (fill-blanks, unambiguous-only, reversible). Every
// batch writes an sf_sync_log row (Dialysis_DB). Discipline: idempotent on the
// SF record id, value-gated (never stage a row with no id/date), never fabricate.
// ============================================================================

import { randomUUID } from 'crypto';
import { domainQuery } from '../_shared/domain-db.js';
import { authenticate, requireRole } from '../_shared/auth.js';

const DOMAIN = 'dia';
const MAX_BATCH = 5000;

// Real-time link is best-effort + idempotent; the nightly `dia-nm-cis-link`
// cron is the backstop. Env-disableable.
function realtimeLinkEnabled() {
  return String(process.env.CIS_LINK_REALTIME ?? 'true').toLowerCase() !== 'false';
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

/** Parse a numeric price from "$1,234,567" / "1234567" / number. */
function parsePrice(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Normalize a date to ISO YYYY-MM-DD; return null if unparseable. */
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); // M/D/YYYY (SF report default)
  if (us) {
    const mm = String(us[1]).padStart(2, '0');
    const dd = String(us[2]).padStart(2, '0');
    return `${us[3]}-${mm}-${dd}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** State → 2-letter upper (leaves non-2-char values as trimmed upper). */
function normState(v) {
  const s = firstNonEmpty(v);
  return s ? String(s).trim().toUpperCase().slice(0, 2) : null;
}

/**
 * Map one raw SF report row (accepts SF managed-package field names AND friendly
 * snake/camel names — PA sends whichever the report/flow exposes) → the
 * dia_nm_cis_closings row shape. Returns null when the value-gate fails
 * (no SF record id, or no address AND no deal name — never stage a blank).
 */
export function mapCisRecord(rec) {
  if (!rec || typeof rec !== 'object') return null;

  const sfRecordId = firstNonEmpty(
    rec.sf_record_id, rec.sfRecordId, rec.record_id, rec.recordId, rec.Id, rec.id,
  );
  if (!sfRecordId) return null; // idempotency key is mandatory

  const address = firstNonEmpty(
    rec.address, rec.Address, rec.normalized_address, rec.property_address,
    rec.propertyAddress, rec.Property_Address_sjc__c, rec.Street__c,
  );
  const dealName = firstNonEmpty(
    rec.deal_name, rec.dealName, rec.Name, rec.deal, rec.Opportunity_Name,
  );
  // value gate: an address OR a deal name must exist, plus a sale date.
  const soldDate = parseDate(firstNonEmpty(
    rec.sold_date, rec.soldDate, rec.sale_date, rec.saleDate, rec.close_date,
    rec.closeDate, rec.CloseDate,
  ));
  if (!address && !dealName) return null;
  if (!soldDate) return null;

  return {
    sf_record_id: String(sfRecordId),
    normalized_address: address ? String(address).trim() : null,
    city: firstNonEmpty(rec.city, rec.City, rec.City_sjc__c) || null,
    state: normState(firstNonEmpty(rec.state, rec.State, rec.State_sjc__c)),
    sold_date: soldDate,
    sold_price: parsePrice(firstNonEmpty(
      rec.sold_price, rec.soldPrice, rec.sale_price, rec.price, rec.Deal_Price__c,
    )),
    listing_broker: firstNonEmpty(
      rec.listing_broker, rec.listingBroker, rec.listing_broker_name, rec.L_Broker,
    ) || null,
    procuring_broker: firstNonEmpty(
      rec.procuring_broker, rec.procuringBroker, rec.buyer_broker, rec.P_Broker,
    ) || null,
    broker: firstNonEmpty(
      rec.broker, rec.listing_broker, rec.listingBroker, rec.deal_team, rec.dealTeam,
    ) || null,
    deal_name: dealName ? String(dealName).trim() : null,
    source: 'cis_export',
    raw: rec,
  };
}

/**
 * Core: map + upsert a CIS batch into dia_nm_cis_closings, then (best-effort)
 * fire the SQL link. Deps injected for unit testing.
 *
 * @param {Array<object>} records — raw SF report rows
 * @param {object} ctx — { importBatch, runLink? }
 * @param {object} deps — { domainQuery, now? }
 */
export async function processCisBatch(records, ctx = {}, deps = {}) {
  const dq = deps.domainQuery || domainQuery;
  const importBatch = ctx.importBatch
    || `cis_${(deps.now ? deps.now() : new Date()).toISOString().slice(0, 10)}`;

  const summary = {
    total: Array.isArray(records) ? records.length : 0,
    staged: 0,
    skipped_invalid: 0,
    import_batch: importBatch,
    link: { triggered: false },
    errors: [],
  };

  if (!Array.isArray(records) || records.length === 0) return summary;

  const rows = [];
  for (const rec of records) {
    const mapped = mapCisRecord(rec);
    if (!mapped) { summary.skipped_invalid += 1; continue; }
    mapped.import_batch = importBatch;
    rows.push(mapped);
  }

  if (rows.length > 0) {
    // Idempotent UPSERT on the SF record id. return=minimal keeps the response
    // small (a full-history backfill is thousands of rows).
    const up = await dq(
      DOMAIN, 'POST',
      'dia_nm_cis_closings?on_conflict=sf_record_id',
      rows,
      { Prefer: 'resolution=merge-duplicates,return=minimal' },
    );
    if (!up || !up.ok) {
      summary.errors.push({ stage: 'upsert', status: up?.status, detail: up?.data });
    } else {
      summary.staged = rows.length;
    }
  }

  // sf_sync_log ledger (Dialysis_DB) — one row per ingest batch, mirrors the
  // dia_nm_broker_backfill / dia_nm_cis_link self-labeling pattern.
  try {
    await dq(DOMAIN, 'POST', 'sf_sync_log', [{
      sync_id: randomUUID(),
      sync_type: 'dia_nm_cis_ingest',
      sf_object_type: 'closed_is',
      status: summary.errors.length ? 'error' : 'success',
      error_message: summary.errors.length ? JSON.stringify(summary.errors).slice(0, 2000) : null,
      payload: {
        import_batch: importBatch,
        total: summary.total,
        staged: summary.staged,
        skipped_invalid: summary.skipped_invalid,
      },
    }], { Prefer: 'return=minimal' });
  } catch (err) {
    summary.errors.push({ stage: 'sf_sync_log', detail: err?.message || String(err) });
  }

  // Real-time link/certify (best-effort; nightly cron is the backstop).
  if (ctx.runLink !== false && realtimeLinkEnabled() && summary.staged > 0) {
    try {
      const lr = await dq(DOMAIN, 'POST', 'rpc/dia_nm_cis_link',
        { p_dry_run: false, p_batch_tag: importBatch }, { Prefer: 'return=representation' });
      summary.link = { triggered: true, ok: !!(lr && lr.ok), result: lr?.data };
    } catch (err) {
      summary.link = { triggered: true, ok: false, error: err?.message || String(err) };
    }
  }

  return summary;
}

export async function handleSfCisIngest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  if (!requireRole(user, 'operator', workspaceId)) {
    return res.status(403).json({ error: 'Operator role required' });
  }

  const body = req.body || {};
  const records = Array.isArray(body) ? body
    : Array.isArray(body.records) ? body.records
    : Array.isArray(body.rows) ? body.rows
    : null;

  if (!records) {
    return res.status(400).json({ error: 'Body must be an array or { records: [...] }' });
  }
  if (records.length > MAX_BATCH) {
    return res.status(413).json({ error: `Batch too large (${records.length} > ${MAX_BATCH})` });
  }

  const importBatch = firstNonEmpty(body.import_batch, body.importBatch, req.query.import_batch);
  const summary = await processCisBatch(records, { importBatch }, {});

  const status = summary.errors.length ? 207 : 200;
  return res.status(status).json({ ok: summary.errors.length === 0, ...summary });
}
