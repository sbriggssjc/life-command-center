// PR-scanner-3 — gov property public-record coverage sync
//
// v_lcc_ownership_history_lane_split's `county_records_needed` reclassification
// (supabase/migrations/20260912150000_lcc_pr_scanner3_county_records_needed_action.sql)
// reads `lcc_gov_property_record_coverage`, a small LCC-Opps-side mirror of "does
// this gov property carry a trustworthy parcel/tax/deed record". gov's
// parcel_records/tax_records/deed_records live on a separate Supabase project and
// cannot be joined into an LCC Opps view directly (the cross-database constraint
// this repo's CLAUDE.md documents repeatedly) — this module is that mirror's ONE
// writer, keeping the SQL CASE in the view the single owner of the CLASSIFICATION
// decision while this module only ever answers "do we have a record".
//
// "Trustworthy" (measured live 2026-09-12 against the real data, not the
// `ai_gpt4o_presumed` label named in the original spec, which does not exist as a
// literal in gov's tables today):
//   - parcel_records / tax_records: raw_payload->>'source' = 'costar_sidebar'.
//     A NULL source is the AI-extraction echo class ORE Phase A1 documented
//     (owner_name copied from the recorded owner we already fed the prompt,
//     source_url = the assessor portal homepage) — never trustworthy.
//   - deed_records: raw_payload->>'source' IS DISTINCT FROM 'ai_recall_gpt' — the
//     live model-leg tag on this table. deed_parser rows and unstamped legacy
//     rows both carry real OCR/extraction content (per OCR2/PR1) and count.
//
// A property absent from the coverage table means "not yet synced", never "no
// record" — the view's LEFT JOIN treats a NULL has_trustworthy_record as "leave
// the base action alone" (`IS FALSE`, never `= false`), so an unsynced row can
// never be guessed into county_records_needed.

import { domainQuery } from './domain-db.js';
import { opsQuery } from './ops-db.js';

const GOV_MODEL_LEG_SOURCE = 'ai_recall_gpt';
const GOV_TRUSTED_CAPTURE_SOURCE = 'costar_sidebar';
const COVERAGE_TABLE = 'lcc_gov_property_record_coverage';

/** PostgREST `in.()` chunk size — well under the 1000-row response cap. */
const CHUNK_SIZE = 200;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Batch-check gov parcel_records / tax_records / deed_records for a set of
 * property ids and return { [propertyId]: { hasTrustworthyRecord, parcelTrust,
 * taxTrust, deedTrust } }. Read-only against gov; never writes there.
 *
 * @param {Array<number|string>} propertyIds
 * @returns {Promise<{ ok: boolean, error?: string, byId: Record<string, object> }>}
 */
export async function checkGovPropertyTrustworthyRecords(propertyIds, deps = {}) {
  const domainQueryFn = deps.domainQuery || domainQuery;
  const ids = [...new Set((propertyIds || []).map((v) => Number(v)).filter(Number.isFinite))];
  const byId = {};
  for (const id of ids) byId[id] = { parcelTrust: false, taxTrust: false, deedTrust: false };
  if (!ids.length) return { ok: true, byId };

  for (const group of chunk(ids, CHUNK_SIZE)) {
    const idList = group.join(',');

    // Trustworthy parcel captures, and the parcel_id set they carry (tax_records
    // has no property_id of its own — it links via parcel_id).
    const parcelRes = await domainQueryFn(
      'government', 'GET',
      `parcel_records?property_id=in.(${idList})&raw_payload->>source=eq.${GOV_TRUSTED_CAPTURE_SOURCE}&select=property_id,parcel_id`
    );
    if (!parcelRes.ok) {
      return { ok: false, error: `parcel_records read failed (${parcelRes.status})`, byId };
    }
    const trustedParcels = Array.isArray(parcelRes.data) ? parcelRes.data : [];
    const parcelIdToPropertyId = new Map();
    for (const row of trustedParcels) {
      if (row.property_id == null) continue;
      byId[row.property_id] = byId[row.property_id] || { parcelTrust: false, taxTrust: false, deedTrust: false };
      byId[row.property_id].parcelTrust = true;
      if (row.parcel_id != null) parcelIdToPropertyId.set(row.parcel_id, row.property_id);
    }

    // Tax trust requires walking through the property's parcel(s) — including
    // parcels NOT flagged trusted at the parcel level, since a parcel row and
    // its tax row are captured/tagged independently.
    const allParcelsRes = await domainQueryFn(
      'government', 'GET',
      `parcel_records?property_id=in.(${idList})&select=property_id,parcel_id`
    );
    if (allParcelsRes.ok && Array.isArray(allParcelsRes.data)) {
      for (const row of allParcelsRes.data) {
        if (row.property_id != null && row.parcel_id != null) {
          parcelIdToPropertyId.set(row.parcel_id, row.property_id);
        }
      }
    }
    const parcelIds = [...parcelIdToPropertyId.keys()];
    if (parcelIds.length) {
      for (const pchunk of chunk(parcelIds, CHUNK_SIZE)) {
        const taxRes = await domainQueryFn(
          'government', 'GET',
          `tax_records?parcel_id=in.(${pchunk.join(',')})&raw_payload->>source=eq.${GOV_TRUSTED_CAPTURE_SOURCE}&select=parcel_id`
        );
        if (taxRes.ok && Array.isArray(taxRes.data)) {
          for (const row of taxRes.data) {
            const propId = parcelIdToPropertyId.get(row.parcel_id);
            if (propId == null) continue;
            byId[propId] = byId[propId] || { parcelTrust: false, taxTrust: false, deedTrust: false };
            byId[propId].taxTrust = true;
          }
        }
      }
    }

    // Deed trust: any deed_records row whose source is NOT the model leg.
    // PostgREST cannot express `<> 'x' OR IS NULL` as one operator, so fetch
    // every deed for the property set and filter client-side.
    const deedRes = await domainQueryFn(
      'government', 'GET',
      `deed_records?property_id=in.(${idList})&select=property_id,raw_payload`
    );
    if (deedRes.ok && Array.isArray(deedRes.data)) {
      for (const row of deedRes.data) {
        if (row.property_id == null) continue;
        const source = row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload.source : undefined;
        if (source === GOV_MODEL_LEG_SOURCE) continue;
        byId[row.property_id] = byId[row.property_id] || { parcelTrust: false, taxTrust: false, deedTrust: false };
        byId[row.property_id].deedTrust = true;
      }
    }
  }

  for (const id of ids) {
    const rec = byId[id];
    rec.hasTrustworthyRecord = !!(rec.parcelTrust || rec.taxTrust || rec.deedTrust);
  }
  return { ok: true, byId };
}

/**
 * Sync the coverage mirror for a set of gov property ids. Reversible/idempotent
 * (a plain upsert on the property_id PK; re-running just refreshes synced_at).
 * Never touches gov — read-only there, write-only on LCC Opps.
 *
 * @param {Array<number|string>} propertyIds
 * @returns {Promise<{ ok: boolean, synced: number, error?: string }>}
 */
export async function syncGovPropertyRecordCoverage(propertyIds, deps = {}) {
  const opsQueryFn = deps.opsQuery || opsQuery;
  const check = await checkGovPropertyTrustworthyRecords(propertyIds, deps);
  if (!check.ok) return { ok: false, synced: 0, error: check.error };

  const rows = Object.entries(check.byId).map(([propertyId, rec]) => ({
    property_id: Number(propertyId),
    has_trustworthy_record: rec.hasTrustworthyRecord,
    parcel_trust: rec.parcelTrust,
    tax_trust: rec.taxTrust,
    deed_trust: rec.deedTrust,
    synced_at: new Date().toISOString(),
  }));
  if (!rows.length) return { ok: true, synced: 0 };

  let synced = 0;
  for (const batch of chunk(rows, CHUNK_SIZE)) {
    const res = await opsQueryFn('POST', `${COVERAGE_TABLE}?on_conflict=property_id`, batch, {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    });
    if (!res.ok) {
      return { ok: false, synced, error: `coverage upsert failed (${res.status}): ${res.data?.message || ''}` };
    }
    synced += batch.length;
  }
  return { ok: true, synced };
}

/**
 * Sync coverage for every gov property currently sitting in the
 * mismatch/all_guarded/county_records_needed part of the ownership-history
 * lane. Bounded (fleet-wide today is ~250 properties) — a full re-check is
 * cheap enough to run whole rather than paged; if the lane grows well past
 * that, page on research_task_id the same way other ticks do.
 *
 * @returns {Promise<{ ok: boolean, checked: number, synced: number, error?: string }>}
 */
export async function syncGovPropertyRecordCoverageForOwnershipLane(deps = {}) {
  const opsQueryFn = deps.opsQuery || opsQuery;
  const res = await opsQueryFn(
    'GET',
    "v_lcc_ownership_history_lane_split?select=source_record_id,domain,action&domain=eq.gov&action=in.(mismatch,all_guarded,county_records_needed)"
  );
  if (!res.ok) return { ok: false, checked: 0, synced: 0, error: res.data?.message || `lane read failed (${res.status})` };
  const ids = (Array.isArray(res.data) ? res.data : [])
    .map((r) => r.source_record_id)
    .filter((v) => v != null && /^\d+$/.test(String(v)));
  const result = await syncGovPropertyRecordCoverage(ids, deps);
  return { ok: result.ok, checked: ids.length, synced: result.synced, error: result.error };
}
