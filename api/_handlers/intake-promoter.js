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
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
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
// Cap rate stored as decimal (0.0918) per chk_*_cap_rate_range check
// constraints (valid range 0.005–0.30).
function buildDiaListingRow(intakeId, snapshot, match) {
  const capRateDecimal = snapshot.cap_rate != null
    ? Number(snapshot.cap_rate) / 100
    : null;
  return {
    property_id:        Number(match.property_id),
    listing_broker:     snapshot.listing_broker || null,
    broker_email:       snapshot.listing_broker_email || null,
    initial_price:      snapshot.asking_price || null,
    last_price:         snapshot.asking_price || null,
    current_cap_rate:   capRateDecimal,
    initial_cap_rate:   capRateDecimal,
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
  // Dialysis properties schema has no cap_rate/noi/rent columns (those
  // live on leases/sales_transactions in that domain). Nothing to do.
  if (domain !== 'government') {
    return { ok: true, skipped: `property_financials_not_supported_for_${domain}` };
  }

  // Gov properties has gross_rent + noi (but NOT cap_rate — cap is
  // stored on available_listings / sales_transactions / view-computed).
  // Build the patch from whatever the snapshot has, then filter to
  // only fields currently null on the property so we don't overwrite
  // curated data.
  const patch = {};
  if (snapshot.noi != null)          patch.noi        = Number(snapshot.noi);
  if (snapshot.annual_rent != null)  patch.gross_rent = Number(snapshot.annual_rent);
  if (!Object.keys(patch).length) {
    return { ok: false, skipped: 'nothing_to_update' };
  }

  const existing = await domainQuery(
    'government',
    'GET',
    `properties?property_id=eq.${Number(propertyId)}&select=noi,gross_rent&limit=1`
  );
  if (!existing.ok) {
    return {
      ok: false,
      skipped: 'property_lookup_failed',
      status: existing.status,
      detail: existing.data,
    };
  }
  if (!Array.isArray(existing.data) || !existing.data.length) {
    return { ok: false, skipped: 'property_not_found', property_id: propertyId };
  }
  const current = existing.data[0] || {};
  const filteredPatch = {};
  if (current.noi        == null && patch.noi        != null) filteredPatch.noi        = patch.noi;
  if (current.gross_rent == null && patch.gross_rent != null) filteredPatch.gross_rent = patch.gross_rent;
  if (!Object.keys(filteredPatch).length) {
    return { ok: true, skipped: 'all_fields_already_populated', current_values: current };
  }

  const patchRes = await domainQuery(
    'government',
    'PATCH',
    `properties?property_id=eq.${Number(propertyId)}`,
    filteredPatch
  );
  return patchRes.ok
    ? { ok: true, patched_fields: Object.keys(filteredPatch) }
    : { ok: false, skipped: 'patch_failed', status: patchRes.status, detail: patchRes.data };
}

// ============================================================================
// 4. UNIFIED CONTACT SYNC (cross-domain broker entry for hot-contact briefings)
// ============================================================================
//
// Daily briefing's "hot contacts" section queries lcc_opps.unified_contacts
// not the domain contacts tables. After the domain contact is created we
// also upsert a unified_contacts row linking back via gov_contact_id or
// dia_contact_id so the broker shows up in briefings immediately.
//
// Uniqueness is on LOWER(email) WHERE email IS NOT NULL (partial unique
// index), which PostgREST can't target with on_conflict — so we use a
// check-then-insert-or-patch pattern.

async function promoteUnifiedContact(domain, snapshot, domainContactId) {
  const email = (snapshot.listing_broker_email || '').trim();
  const name  = (snapshot.listing_broker || '').trim();
  if (!email) {
    return { ok: false, skipped: 'no_email_no_unified_contact' };
  }

  // Split "First Last" into first/last (best-effort; keeps full_name intact).
  let firstName = null, lastName = null;
  if (name) {
    const parts = name.split(/\s+/);
    firstName = parts[0] || null;
    lastName  = parts.length > 1 ? parts.slice(1).join(' ') : null;
  }

  // Link column differs per domain — gov_contact_id or dia_contact_id.
  const linkCol = domain === 'government' ? 'gov_contact_id' : 'dia_contact_id';

  const existing = await opsQuery('GET',
    `unified_contacts?email=ilike.${encodeURIComponent(email)}&select=unified_id,${linkCol}&limit=1`
  );

  if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
    const row = existing.data[0];
    // Row exists. If the domain link isn't set yet, patch it. Otherwise
    // leave the row alone — curated data wins.
    if (!row[linkCol] && domainContactId) {
      const patchRes = await opsQuery('PATCH',
        `unified_contacts?unified_id=eq.${pgFilterVal(row.unified_id)}`,
        { [linkCol]: domainContactId }
      );
      return patchRes.ok
        ? { ok: true, unified_id: row.unified_id, linked: true }
        : { ok: false, skipped: 'link_patch_failed', status: patchRes.status, detail: patchRes.data };
    }
    return { ok: true, unified_id: row.unified_id, skipped: 'already_linked' };
  }

  // No existing unified_contacts row — insert a fresh one.
  const row = {
    contact_class: 'broker',
    first_name:    firstName,
    last_name:     lastName,
    full_name:     name || email,
    email,
    company_name:  snapshot.listing_firm || null,
    title:         'Listing Broker',
    contact_type:  'broker',
    [linkCol]:     domainContactId || null,
  };
  const insertRes = await opsQuery('POST', 'unified_contacts', row, { Prefer: 'return=representation' });
  if (!insertRes.ok) {
    return { ok: false, skipped: 'insert_failed', status: insertRes.status, detail: insertRes.data };
  }
  const inserted = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  return { ok: true, unified_id: inserted?.unified_id || null, inserted: true };
}

// ============================================================================
// 5. ACTIVITY EVENT (property-scoped timeline entry)
// ============================================================================
//
// Drops a row in lcc_opps.activity_events so the property's timeline/feed
// surfaces the OM ingestion. entity_id links to the LCC entity ONLY if
// there is one for the matched property — for gov/dia matches we don't
// auto-create an LCC entity, so entity_id stays null and property_id
// is stored in metadata for anyone who wants to filter/display.

async function promoteActivityEvent(intakeId, workspaceId, actorId, snapshot, match, listingResult) {
  if (!workspaceId || !actorId) {
    return { ok: false, skipped: 'no_workspace_or_actor' };
  }

  const docTypeLabel =
      snapshot?.document_type === 'om'                 ? 'Offering Memo'
    : snapshot?.document_type === 'flyer'              ? 'Broker Flyer'
    : snapshot?.document_type === 'marketing_brochure' ? 'Marketing Brochure'
    : 'Listing document';
  const brokerPart = snapshot?.listing_broker
    ? ` from ${snapshot.listing_broker}${snapshot.listing_firm ? ' (' + snapshot.listing_firm + ')' : ''}`
    : '';
  const addressPart = snapshot?.address ? ` for ${snapshot.address}` : '';

  const title = `${docTypeLabel} received${addressPart}`;
  const body  = `Staged from LCC OM intake${brokerPart}. Auto-matched to ${match.domain} property ${match.property_id} (${match.reason}, confidence ${match.confidence}).`;

  // entity_id is the LCC entity UUID if the matched domain is 'lcc'; null
  // for gov/dia matches (they don't have LCC entities yet).
  const entityId = match.domain === 'lcc' ? match.property_id : null;

  const row = {
    workspace_id: workspaceId,
    actor_id:     actorId,
    visibility:   'shared',
    category:     'system',
    title,
    body,
    entity_id:    entityId,
    source_type:  'intake_om',
    domain:       match.domain || null,
    metadata: {
      intake_id:         intakeId,
      document_type:     snapshot?.document_type || null,
      match_reason:      match.reason || null,
      match_domain:      match.domain || null,
      match_property_id: match.property_id || null,
      match_confidence:  match.confidence || null,
      listing_id:        listingResult?.listing_id || null,
      listing_firm:      snapshot?.listing_firm || null,
      listing_broker:    snapshot?.listing_broker || null,
      broker_email:      snapshot?.listing_broker_email || null,
    },
    occurred_at: new Date().toISOString(),
  };

  const result = await opsQuery('POST', 'activity_events', row, { Prefer: 'return=representation' });
  if (!result.ok) {
    return { ok: false, skipped: 'insert_failed', status: result.status, detail: result.data };
  }
  const inserted = Array.isArray(result.data) ? result.data[0] : result.data;
  return { ok: true, activity_event_id: inserted?.id || null };
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export async function promoteIntakeToDomainListing(intakeId, snapshot, match, context = {}) {
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

  // Run the three domain-DB promotions in parallel — each is independent
  // and has its own try/catch. After those, run the two LCC-opps-side
  // follow-ups (unified_contacts sync + activity_event) sequentially
  // because the unified contact sync needs the domain contact_id from
  // the broker-contact result.
  const [listingResult, contactResult, financialsResult] = await Promise.all([
    promoteListing(match.domain, intakeId, snapshot, match).catch(e => ({ ok: false, error: e?.message })),
    promoteBrokerContact(match.domain, snapshot).catch(e => ({ ok: false, error: e?.message })),
    promotePropertyFinancials(match.domain, match.property_id, snapshot).catch(e => ({ ok: false, error: e?.message })),
  ]);

  // LCC-side follow-ups run in parallel after domain promotions settle.
  const domainContactId = contactResult?.contact_id || null;
  const [unifiedContactResult, activityEventResult] = await Promise.all([
    promoteUnifiedContact(match.domain, snapshot, domainContactId)
      .catch(e => ({ ok: false, error: e?.message })),
    promoteActivityEvent(intakeId, context.workspaceId, context.actorId, snapshot, match, listingResult)
      .catch(e => ({ ok: false, error: e?.message })),
  ]);

  return {
    ok:                    listingResult.ok,
    domain:                match.domain,
    listing:               listingResult,
    broker_contact:        contactResult,
    property_financials:   financialsResult,
    unified_contact:       unifiedContactResult,
    activity_event:        activityEventResult,
  };
}
