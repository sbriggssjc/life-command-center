// ============================================================================
// Create-from-intake — close the workflow gap (2026-06-04)
// Life Command Center
//
// The review_required pile contains ~613 intakes with a clean extracted address
// that stay unmatched after the improved rematch — they are genuinely-NEW
// properties (e.g. a USPS facility not yet in the gov DB). Until now there was
// no path from a valid extraction to a new property+listing; they sat in
// purgatory forever.
//
// createPropertyFromIntake():
//   1. Re-runs the matcher once (cheap guard against racing the rematch cron —
//      if it now matches, just promote and return that, no double-create).
//   2. Creates the property in the routed domain via the EXISTING sidebar
//      writer (upsertDomainProperty), tagged source=om_intake so forensics can
//      tell these from CoStar captures. Records field provenance
//      (source='om_extraction', confidence 0.6).
//   3. Calls runDownstreamPipeline so the fresh match finds the new property
//      and the FULL existing promotion path runs (listing, lease, contacts,
//      docs). Promotion is NOT reimplemented here.
//
// Multi-address (portfolio) OMs create/match one property per address, mirroring
// the matcher's split — the matcher then attaches the intake to the first and
// records the rest for review.
// ============================================================================

import { opsQuery } from '../_shared/ops-db.js';
import { matchIntakeToProperty, DIALYSIS_KEYWORDS } from './intake-matcher.js';
import { runDownstreamPipeline } from './intake-extractor.js';
import { upsertDomainProperty } from './sidebar-pipeline.js';
import { normalizeState } from '../_shared/entity-link.js';
import { splitMultiAddress } from '../_shared/normalize-street-address.js';
import { firstOf } from '../_shared/intake-classify.js';

// Modest confidence: AI-extracted from an OM, no county-records confirmation.
const OM_CREATE_CONFIDENCE = 0.6;

function pickDomainForTenant(tenant) {
  return tenant && DIALYSIS_KEYWORDS.test(tenant) ? 'dialysis' : 'government';
}

/**
 * Best-effort field_provenance for the freshly-created property row, via
 * lcc_merge_field (source='om_extraction'). Field names are domain-aware so
 * the ledger reflects the actual column written (gov: agency/rba, dia:
 * tenant/building_size). Never blocks the create.
 */
async function recordCreateProvenance({ workspaceId, intakeId, domain, propertyId, actorId }, fields) {
  const targetDatabase = domain === 'government' ? 'gov_db' : 'dia_db';
  const targetTable     = domain === 'government' ? 'gov.properties' : 'dia.properties';
  const promises = [];
  for (const [fieldName, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    promises.push(
      opsQuery('POST', 'rpc/lcc_merge_field', {
        p_workspace_id:    workspaceId || null,
        p_target_database: targetDatabase,
        p_target_table:    targetTable,
        p_record_pk:       String(propertyId),
        p_field_name:      fieldName,
        p_value:           value,
        p_source:          'om_extraction',
        p_source_run_id:   intakeId || null,
        p_confidence:      OM_CREATE_CONFIDENCE,
        p_recorded_by:     actorId || null,
      }).catch(() => null)
    );
  }
  await Promise.allSettled(promises);
}

/**
 * Create a property (or per-address properties) from a review_required intake
 * and run the full promotion path.
 *
 * @param {string} intakeId
 * @param {object} ctx — { workspaceId, actorId, trigger ('manual'|'auto') }
 * @returns {object} { ok, matched, created[], match_result, promotion_result }
 */
export async function createPropertyFromIntake(intakeId, ctx = {}) {
  const out = { intake_id: intakeId, created: [], matched: false };

  // 1. Load staged item + full extraction snapshot.
  const itemRes = await opsQuery('GET',
    `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}` +
    `&select=intake_id,status,workspace_id,raw_payload&limit=1`);
  if (!itemRes.ok || !itemRes.data?.length) {
    return { ok: false, error: 'intake_not_found' };
  }
  const item = itemRes.data[0];
  const workspaceId = ctx.workspaceId || item.workspace_id || null;
  const seedData = item.raw_payload?.seed_data || null;

  const exRes = await opsQuery('GET',
    `staged_intake_extractions?intake_id=eq.${encodeURIComponent(intakeId)}` +
    `&select=extraction_snapshot&order=created_at.desc&limit=1`);
  let snapshot = (exRes.ok && Array.isArray(exRes.data) && exRes.data.length)
    ? exRes.data[0].extraction_snapshot : null;
  if (!snapshot || typeof snapshot !== 'object') {
    // Fall back to the trimmed summary so we still have address/city/state.
    const ext = item.raw_payload?.extraction_result || {};
    snapshot = {
      address: ext.address || null,
      addresses: Array.isArray(ext.addresses) ? ext.addresses : null,
      city: ext.city || null,
      state: ext.state || null,
      tenant_name: ext.tenant_name || null,
      document_type: ext.document_type || null,
      asking_price: ext.asking_price ?? null,
      cap_rate: ext.cap_rate ?? null,
    };
  }

  // 2. Guard: need at least one street address to create from.
  const pairs = splitMultiAddress(
    snapshot.addresses ?? snapshot.address,
    snapshot.tenant_names ?? snapshot.tenant_name
  ).filter(p => p.address);
  if (!pairs.length) {
    return { ok: false, error: 'no_address',
      detail: 'extraction has no street address to create a property from' };
  }

  // 3. Race guard: re-run the matcher once. If the rematch cron already
  //    created/matched the property, just promote what exists and return —
  //    never double-create.
  try {
    const preMatch = await matchIntakeToProperty(intakeId, snapshot);
    if (preMatch?.status === 'matched' && preMatch?.property_id != null) {
      const downstream = await runDownstreamPipeline(intakeId, snapshot, {
        workspaceId, actorId: ctx.actorId || null, seedData,
      });
      return {
        ok: true,
        intake_id: intakeId,
        matched: true,
        created: [],
        note: 'already_matched_no_create',
        match_result: downstream?.match_result || preMatch,
        promotion_result: downstream?.promotion_result || null,
      };
    }
  } catch (err) {
    out.prematch_error = String(err?.message || err).slice(0, 200);
  }

  // 4. Create a property per address using the existing sidebar writer.
  const state = normalizeState(snapshot.state);
  for (const pair of pairs) {
    const tenant = pair.tenant || firstOf(snapshot.tenant_name) || null;
    const domain = pickDomainForTenant(tenant);
    const entity = {
      address: pair.address,
      city:    snapshot.city || null,
      state,
      zip:     snapshot.zip_code || null,
      county:  snapshot.county || null,
    };
    const metadata = {
      address:            pair.address,
      city:               snapshot.city || null,
      state,
      zip_code:           snapshot.zip_code || null,
      tenant_name:        tenant,
      primary_tenant:     tenant,
      square_footage:     snapshot.building_sf || null,
      sf_leased:          snapshot.sf_leased || null,
      year_built:         snapshot.year_built || null,
      annual_rent:        snapshot.annual_rent || null,
      noi:                snapshot.noi || null,
      lease_commencement: snapshot.lease_commencement || null,
      lease_expiration:   snapshot.lease_expiration || null,
      // Tag brand-new rows so forensics can distinguish OM-created properties
      // from CoStar captures (upsertDomainProperty injects this at INSERT only).
      _source_tag:        'om_intake',
    };

    let propertyId = null;
    try {
      propertyId = await upsertDomainProperty(domain, entity, metadata);
    } catch (err) {
      out.created.push({ address: pair.address, domain, ok: false,
        error: String(err?.message || err).slice(0, 200) });
      continue;
    }
    if (!propertyId) {
      out.created.push({ address: pair.address, domain, ok: false,
        error: 'upsert_returned_null' });
      continue;
    }
    out.created.push({ address: pair.address, domain, property_id: String(propertyId), ok: true });

    const provFields = domain === 'government'
      ? { address: pair.address, city: snapshot.city || null, state, agency: tenant, rba: snapshot.building_sf || null }
      : { address: pair.address, city: snapshot.city || null, state, tenant, building_size: snapshot.building_sf || null };
    await recordCreateProvenance(
      { workspaceId, intakeId, domain, propertyId, actorId: ctx.actorId || null },
      provFields
    ).catch(() => {});
  }

  const created = out.created.filter(c => c.ok && c.property_id);
  if (!created.length) {
    return { ok: false, error: 'create_failed', created: out.created };
  }

  // 5. Re-run the downstream pipeline. The matcher now finds the freshly-
  //    created property by exact address and the FULL existing promotion path
  //    runs (listing, lease, contacts, docs). Promotion is NOT reimplemented.
  const downstream = await runDownstreamPipeline(intakeId, snapshot, {
    workspaceId, actorId: ctx.actorId || null, seedData,
  });
  out.match_result     = downstream?.match_result || null;
  out.promotion_result = downstream?.promotion_result || null;
  out.matched          = downstream?.match_result?.status === 'matched';

  // 6. Stamp the create on raw_payload for forensics + AUTO-mode idempotency.
  try {
    const cur = await opsQuery('GET',
      `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}&select=raw_payload&limit=1`);
    const curPayload = cur.ok && cur.data?.length ? (cur.data[0].raw_payload || {}) : {};
    await opsQuery('PATCH',
      `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}`,
      { raw_payload: {
          ...curPayload,
          autocreated: {
            at: new Date().toISOString(),
            by: ctx.trigger || 'manual',
            properties: created.map(c => ({ domain: c.domain, property_id: c.property_id })),
          },
        } });
  } catch { /* best-effort */ }

  return { ok: true, ...out };
}
