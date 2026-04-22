// api/_handlers/intake-promoter.js
// ============================================================================
// Intake Promoter — write matched OM intakes into domain available_listings
// Life Command Center
//
// After the extractor + matcher finish, this takes a confident OM match and
// upserts a row into the matched domain's `available_listings` table so the
// property shows up in the broker's "available for sale" view alongside
// manually-ingested CoStar listings.
//
// Without this, OMs land in staged_intake_items but never flow downstream
// into the domain DBs — which is why Scott's Plano courthouse OM wasn't
// showing up in the available-sales view after ingestion.
//
// Promotion gate:
//   - document_type === 'om'
//   - match.status === 'matched'
//   - match.confidence >= MIN_CONFIDENCE (0.85)
//   - match.domain in { 'government' }   (dialysis has a different schema
//                                          and will be added as a separate
//                                          mapper in v2)
//
// Upsert key: source_listing_ref = intake_id. Re-running extract on an
// intake updates the same listing row rather than inserting duplicates.
// ============================================================================

import { domainQuery } from '../_shared/domain-db.js';
import { normalizeState } from '../_shared/entity-link.js';

const MIN_CONFIDENCE_FOR_AUTO_PROMOTE = 0.85;

// ============================================================================
// GOVERNMENT MAPPER
// ============================================================================
// gov.available_listings expects the columns in the snippet below. Null
// values are fine — the table allows them. We set listing_source to
// 'lcc_intake_om' so these rows are easily distinguishable from the
// costar_sidebar / excel_master entries populated through other paths.

function buildGovListingRow(intakeId, snapshot, match) {
  const state = normalizeState(snapshot.state);

  // Detect Northmarq listings from broker email / firm name.
  const brokerEmail = (snapshot.listing_broker_email || '').toLowerCase();
  const firm        = (snapshot.listing_firm || '').toLowerCase();
  const isNorthmarq = brokerEmail.endsWith('@northmarq.com') || firm.includes('northmarq');

  // Gov stores cap rate as decimal (0.0644 = 6.44%). Extractor emits
  // percentage (6.44). Convert if present.
  const capRateDecimal = snapshot.cap_rate != null
    ? Number(snapshot.cap_rate) / 100
    : null;

  return {
    property_id:        Number(match.property_id),  // gov property_id is bigint
    listing_source:     'lcc_intake_om',
    source_listing_ref: intakeId,
    address:            snapshot.address || null,
    city:               snapshot.city || null,
    state:              state || null,
    square_feet:        snapshot.building_sf != null ? Math.round(snapshot.building_sf) : null,
    asking_price:       snapshot.asking_price || null,
    asking_cap_rate:    capRateDecimal,
    asking_price_psf:   (snapshot.asking_price && snapshot.building_sf)
                          ? Math.round((snapshot.asking_price / snapshot.building_sf) * 100) / 100
                          : snapshot.price_per_sf || null,
    tenant_agency:      snapshot.tenant_name || null,
    annual_rent:        snapshot.annual_rent || null,
    lease_expiration:   snapshot.lease_expiration || null,
    listing_broker:     snapshot.listing_broker || null,
    listing_firm:       snapshot.listing_firm || null,
    broker_email:       snapshot.listing_broker_email || null,
    is_northmarq:       isNorthmarq,
    listing_status:     'active',
    listing_date:       new Date().toISOString().slice(0, 10),  // YYYY-MM-DD
    first_seen_at:      new Date().toISOString(),
    last_seen_at:       new Date().toISOString(),
  };
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Decide whether to promote + do it.
 *
 * @param {string} intakeId — UUID of the staged intake
 * @param {object} snapshot — merged extraction snapshot (from intake-extractor)
 * @param {object} match    — matcher result from matchIntakeToProperty
 * @returns {Promise<{ok: boolean, skipped?: string, status?: number, detail?: any, listing_id?: string}>}
 */
export async function promoteIntakeToDomainListing(intakeId, snapshot, match) {
  // Guard: must be an OM
  if (snapshot?.document_type !== 'om') {
    return { ok: false, skipped: 'not_an_om', document_type: snapshot?.document_type || null };
  }

  // Guard: must be a matched record with enough confidence
  if (!match || match.status !== 'matched') {
    return { ok: false, skipped: 'unmatched' };
  }
  if (typeof match.confidence !== 'number' || match.confidence < MIN_CONFIDENCE_FOR_AUTO_PROMOTE) {
    return {
      ok: false,
      skipped: 'confidence_below_threshold',
      confidence: match.confidence,
      threshold: MIN_CONFIDENCE_FOR_AUTO_PROMOTE,
    };
  }

  // Guard: must be a domain we know how to write to
  if (match.domain !== 'government') {
    return { ok: false, skipped: 'domain_not_supported_yet', domain: match.domain };
  }

  // Guard: we need a property_id to link the listing to
  if (match.property_id == null) {
    return { ok: false, skipped: 'no_property_id' };
  }

  // Build the row and upsert.
  const row = buildGovListingRow(intakeId, snapshot, match);
  const result = await domainQuery(
    'government',
    'POST',
    'available_listings?on_conflict=source_listing_ref',
    row,
    { Prefer: 'return=representation,resolution=merge-duplicates' }
  );

  if (!result.ok) {
    console.error('[intake-promoter] upsert failed:',
      result.status, JSON.stringify(result.data || {}).slice(0, 300));
    return {
      ok: false,
      skipped: 'upsert_failed',
      status: result.status,
      detail: result.data,
    };
  }

  const inserted = Array.isArray(result.data) ? result.data[0] : result.data;
  return {
    ok:          true,
    domain:      'government',
    listing_id:  inserted?.listing_id || null,
    property_id: inserted?.property_id || null,
    updated:     !!inserted,
  };
}
