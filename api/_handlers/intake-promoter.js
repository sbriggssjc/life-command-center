// api/_handlers/intake-promoter.js
// ============================================================================
// Intake Promoter — write matched OM intakes into domain databases
// Life Command Center
//
// After the extractor + matcher finish, this takes a confident OM match and
// performs THREE downstream promotions so the data extracted from the OM
// actually flows to the places a broker expects to see it:
//
//   1. DOMAIN available_listings upsert — so the property appears in the
//      broker's "available for sale" view alongside CoStar-sourced listings.
//      Upsert key: source_listing_ref = intake_id.
//
//   2. DOMAIN contacts creation — the listing broker from the OM (name,
//      email, firm) becomes a contact record so they surface in contact
//      lists and can be referenced elsewhere. Check-then-insert by email
//      since legacy data has email duplicates we don't want to disturb.
//
//   3. DOMAIN properties financial update — cap_rate / noi / annual_rent
//      extracted from the OM populate the matched property record, but
//      ONLY when the existing value is null (never overwrite curated data).
//
// Without these bridges, OMs landed in staged_intake_items but data never
// flowed downstream. This is the "fully connected architecture" closure
// for OM ingestion.
//
// Promotion gate:
//   - document_type === 'om'
//   - match.status === 'matched'
//   - match.confidence >= MIN_CONFIDENCE (0.85)
//   - match.domain in { 'government', 'dialysis' }
// ============================================================================

import { domainQuery } from '../_shared/domain-db.js';
import { normalizeState } from '../_shared/entity-link.js';

const MIN_CONFIDENCE_FOR_AUTO_PROMOTE = 0.85;

// Document types that represent on-market listing marketing. Full OMs,
// 1-page broker flyers, and marketing brochures all contain listing-grade
// data (address, tenant, price, cap rate, lease terms, broker) and should
// populate available_listings identically. Comps and lease abstracts are
// deal-adjacent but not listings-of-record; they stay out of this set.
const LISTING_DOCUMENT_TYPES = new Set([
  'om',
  'flyer',
  'marketing_brochure',
]);

// ============================================================================
// 1. AVAILABLE_LISTINGS MAPPERS (per domain)
// ============================================================================

function buildGovListingRow(intakeId, snapshot, match) {
  const state = normalizeState(snapshot.state);
  const brokerEmail = (snapshot.listing_broker_email || '').toLowerCase();
  const firm        = (snapshot.listing_firm || '').toLowerCase();
  const isNorthmarq = brokerEmail.endsWith('@northmarq.com') || firm.includes('northmarq');

  // gov stores cap rate as decimal (0.0644 = 6.44%); extractor emits percentage.
  const capRateDecimal = snapshot.cap_rate != null
    ? Number(snapshot.cap_rate) / 100
    : null;

  return {
    property_id:        Number(match.property_id),
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
    listing_date:       new Date().toISOString().slice(0, 10),
    first_seen_at:      new Date().toISOString(),
    last_seen_at:       new Date().toISOString(),
  };
}

// Dialysis available_listings has a very different shape — price-change-
// tracking oriented, no address/city/state/tenant columns (those live on
// properties). We populate the fields the dia schema has and skip the rest.
function buildDiaListingRow(intakeId, snapshot, match) {
  const capRate = snapshot.cap_rate != null ? Number(snapshot.cap_rate) : null;
  return {
    property_id:        Number(match.property_id),
    listing_broker:     snapshot.listing_broker || null,
    broker_email:       snapshot.listing_broker_email || null,
    initial_price:      snapshot.asking_price || null,
    last_price:         snapshot.asking_price || null,
    current_cap_rate:   capRate,
    initial_cap_rate:   capRate,
    status:             'active',
    listing_date:       new Date().toISOString().slice(0, 10),
    last_seen:          new Date().toISOString().slice(0, 10),
    is_active:          true,
    seller_name:        snapshot.seller_name || null,
    notes:              `Staged from LCC OM intake ${intakeId}`,
  };
}

async function promoteListing(domain, intakeId, snapshot, match) {
  const isGov = domain === 'government';
  const row = isGov
    ? buildGovListingRow(intakeId, snapshot, match)
    : buildDiaListingRow(intakeId, snapshot, match);

  if (isGov) {
    // Gov has a unique index on source_listing_ref — use PostgREST upsert.
    const result = await domainQuery(
      'government',
      'POST',
      'available_listings?on_conflict=source_listing_ref',
      row,
      { Prefer: 'return=representation,resolution=merge-duplicates' }
    );
    return result.ok
      ? { ok: true, listing_id: (Array.isArray(result.data) ? result.data[0] : result.data)?.listing_id || null }
      : { ok: false, status: result.status, detail: result.data };
  }

  // Dialysis has no unique source-ref column. Check-then-insert: find any
  // existing lcc-intake-sourced row for this property and update it in
  // place; otherwise insert a fresh row.
  const existing = await domainQuery(
    'dialysis',
    'GET',
    `available_listings?property_id=eq.${Number(match.property_id)}` +
    `&notes=like.*LCC OM intake*&select=listing_id&limit=1`
  );
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
    const existingId = existing.data[0].listing_id;
    const patchRes = await domainQuery(
      'dialysis',
      'PATCH',
      `available_listings?listing_id=eq.${existingId}`,
      row,
      { Prefer: 'return=representation' }
    );
    return patchRes.ok
      ? { ok: true, listing_id: existingId, updated: true }
      : { ok: false, status: patchRes.status, detail: patchRes.data };
  }
  const insertRes = await domainQuery(
    'dialysis',
    'POST',
    'available_listings',
    row,
    { Prefer: 'return=representation' }
  );
  return insertRes.ok
    ? { ok: true, listing_id: (Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data)?.listing_id || null, inserted: true }
    : { ok: false, status: insertRes.status, detail: insertRes.data };
}

// ============================================================================
// 2. BROKER CONTACT UPSERT (check-then-insert by email)
// ============================================================================

async function promoteBrokerContact(domain, snapshot) {
  const brokerName  = (snapshot.listing_broker || '').trim();
  const brokerEmail = (snapshot.listing_broker_email || '').trim();
  if (!brokerName && !brokerEmail) {
    return { ok: false, skipped: 'no_broker_info' };
  }

  // Gov table columns: name, email, phone, company, title, data_source, role
  //                    (role stored in `contact_type` per our schema peek)
  // Dia table columns: contact_name, contact_email, contact_phone, company, title, role
  const isGov = domain === 'government';
  const emailCol = isGov ? 'email' : 'contact_email';

  // Check if a contact with this email already exists. If so, skip to avoid
  // disturbing curated data; callers can surface a "duplicate detected" if
  // they want to merge.
  if (brokerEmail) {
    const existing = await domainQuery(
      domain,
      'GET',
      `contacts?${emailCol}=ilike.${encodeURIComponent(brokerEmail)}&select=contact_id&limit=1`
    );
    if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
      return { ok: true, skipped: 'existing_contact', contact_id: existing.data[0].contact_id };
    }
  }

  // No existing match → insert a fresh contact.
  const row = isGov
    ? {
        name:            brokerName || brokerEmail || 'Unknown Broker',
        email:           brokerEmail || null,
        company:         snapshot.listing_firm || null,
        title:           'Listing Broker',
        contact_type:    'broker',
        data_source:     'lcc_intake_om',
      }
    : {
        contact_name:    brokerName || brokerEmail || 'Unknown Broker',
        contact_email:   brokerEmail || null,
        company:         snapshot.listing_firm || null,
        title:           'Listing Broker',
        role:            'broker',
      };

  const result = await domainQuery(
    domain,
    'POST',
    'contacts',
    row,
    { Prefer: 'return=representation' }
  );
  if (!result.ok) {
    return { ok: false, skipped: 'insert_failed', status: result.status, detail: result.data };
  }
  const inserted = Array.isArray(result.data) ? result.data[0] : result.data;
  return { ok: true, contact_id: inserted?.contact_id || null, inserted: true };
}

// ============================================================================
// 3. PROPERTY FINANCIALS UPDATE (fill-in-blanks only)
// ============================================================================
//
// Only update fields currently null on the property — don't overwrite
// curated data. This is a conservative bridge: if the OM says cap_rate=6.9
// and the property has no cap_rate, populate it. If the property already
// has a cap_rate (from CoStar or a human edit), leave it alone.

async function promotePropertyFinancials(domain, propertyId, snapshot) {
  const pk = 'property_id';
  const patch = {};
  if (snapshot.cap_rate != null) patch.cap_rate = domain === 'government'
    ? Number(snapshot.cap_rate) / 100   // gov stores as decimal
    : Number(snapshot.cap_rate);
  if (snapshot.noi != null)          patch.noi = snapshot.noi;
  if (snapshot.annual_rent != null)  patch.gross_rent = snapshot.annual_rent;  // gov column
  if (!Object.keys(patch).length) {
    return { ok: false, skipped: 'nothing_to_update' };
  }

  // Fetch current values to decide what to patch. Only fill blanks.
  const existing = await domainQuery(
    domain,
    'GET',
    `properties?${pk}=eq.${Number(propertyId)}&select=cap_rate,noi,gross_rent&limit=1`
  );
  if (!existing.ok || !Array.isArray(existing.data) || !existing.data.length) {
    return { ok: false, skipped: 'property_not_found' };
  }
  const current = existing.data[0] || {};
  const filteredPatch = {};
  if (current.cap_rate   == null && patch.cap_rate   != null) filteredPatch.cap_rate   = patch.cap_rate;
  if (current.noi        == null && patch.noi        != null) filteredPatch.noi        = patch.noi;
  if (current.gross_rent == null && patch.gross_rent != null) filteredPatch.gross_rent = patch.gross_rent;
  if (!Object.keys(filteredPatch).length) {
    return { ok: true, skipped: 'all_fields_already_populated', current_values: current };
  }

  const patchRes = await domainQuery(
    domain,
    'PATCH',
    `properties?${pk}=eq.${Number(propertyId)}`,
    filteredPatch
  );
  return patchRes.ok
    ? { ok: true, patched_fields: Object.keys(filteredPatch) }
    : { ok: false, skipped: 'patch_failed', status: patchRes.status, detail: patchRes.data };
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export async function promoteIntakeToDomainListing(intakeId, snapshot, match) {
  // Guard: must be a listing-grade document (OM, flyer, or marketing brochure)
  const docType = snapshot?.document_type || null;
  if (!LISTING_DOCUMENT_TYPES.has(docType)) {
    return { ok: false, skipped: 'not_a_listing_doc', document_type: docType };
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

  // Guard: supported domains only
  if (match.domain !== 'government' && match.domain !== 'dialysis') {
    return { ok: false, skipped: 'domain_not_supported', domain: match.domain };
  }

  // Guard: we need a property_id
  if (match.property_id == null) {
    return { ok: false, skipped: 'no_property_id' };
  }

  // Run all three promotions in parallel. Each has its own try/catch at
  // the domainQuery layer; failures in one don't block the others.
  const [listingResult, contactResult, financialsResult] = await Promise.all([
    promoteListing(match.domain, intakeId, snapshot, match).catch(e => ({ ok: false, error: e?.message })),
    promoteBrokerContact(match.domain, snapshot).catch(e => ({ ok: false, error: e?.message })),
    promotePropertyFinancials(match.domain, match.property_id, snapshot).catch(e => ({ ok: false, error: e?.message })),
  ]);

  return {
    ok:                    listingResult.ok,
    domain:                match.domain,
    listing:               listingResult,
    broker_contact:        contactResult,
    property_financials:   financialsResult,
  };
}
