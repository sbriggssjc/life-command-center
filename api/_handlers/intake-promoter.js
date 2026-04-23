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
import { normalizeState, ensureEntityLink, normalizeCanonicalName } from '../_shared/entity-link.js';
import { isSalesforceConfigured, findSalesforceAccountByName, findSalesforceContactByEmail } from '../_shared/salesforce.js';

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

function buildGovListingRow(intakeId, snapshot, match, artifact) {
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
    // Link back to the Supabase Storage object that seeded this listing
    // so the dashboard can render a one-click "View OM" button via
    // /api/intake/artifact?storage_path=...
    intake_artifact_path: artifact?.storage_path || null,
    intake_artifact_type: snapshot.document_type || null,
  };
}

// Dialysis available_listings has a very different shape — price-change-
// tracking oriented, no address/city/state/tenant columns (those live on
// properties). We populate the fields the dia schema has and skip the rest.
// Cap rate stored as decimal (0.0918) per chk_*_cap_rate_range check
// constraints (valid range 0.005–0.30).
function buildDiaListingRow(intakeId, snapshot, match, artifact) {
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
    intake_artifact_path: artifact?.storage_path || null,
    intake_artifact_type: snapshot.document_type || null,
  };
}

async function promoteListing(domain, intakeId, snapshot, match) {
  const isGov = domain === 'government';

  // Look up the first staged artifact so we can link intake_artifact_path
  // back to the listing — gives the dashboard a one-click "View OM" path.
  // One extra GET but it's cheap; runs alongside the domain upsert.
  let artifact = null;
  try {
    const artLookup = await opsQuery('GET',
      `staged_intake_artifacts?intake_id=eq.${pgFilterVal(intakeId)}` +
      `&select=storage_path,file_name,mime_type&order=created_at.asc&limit=1`
    );
    if (artLookup.ok && Array.isArray(artLookup.data) && artLookup.data.length) {
      artifact = artLookup.data[0];
    }
  } catch { /* artifact link is nice-to-have, not critical */ }

  const row = isGov
    ? buildGovListingRow(intakeId, snapshot, match, artifact)
    : buildDiaListingRow(intakeId, snapshot, match, artifact);

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
  // NOTE: full_name is a GENERATED column (computed from first_name +
  // last_name by Postgres) — omit it from the insert or PostgREST
  // returns 428C9 "cannot insert a non-DEFAULT value into generated column".
  // NOTE: contact_class has a CHECK constraint — only 'business' or
  // 'personal' are allowed. Brokers are business contacts; the broker
  // role lives on contact_type instead.
  const row = {
    contact_class: 'business',
    first_name:    firstName,
    last_name:     lastName,
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
  const result = { ok: true, unified_id: inserted?.unified_id || null, inserted: true };

  // Best-effort Salesforce Contact lookup — runs only if SF is configured.
  // Populates unified_contacts.sf_contact_id + (if we have a domain contact)
  // the gov/dia contacts.sf_contact_id so existing SF-aware code paths see
  // the broker.
  if (isSalesforceConfigured()) {
    try {
      const sfRes = await findSalesforceContactByEmail(email);
      if (sfRes.ok && sfRes.contact?.Id) {
        const sfId = sfRes.contact.Id;
        const sfAccountId = sfRes.contact.AccountId || null;
        // Patch the unified_contacts row we just created
        const patchUnified = await opsQuery('PATCH',
          `unified_contacts?unified_id=eq.${pgFilterVal(inserted.unified_id)}`,
          {
            sf_contact_id: sfId,
            ...(sfAccountId ? { sf_account_id: sfAccountId } : {}),
            sf_last_synced: new Date().toISOString(),
          }
        );
        // Patch the domain contact if we have one
        if (domainContactId) {
          await domainQuery(
            domain,
            'PATCH',
            `contacts?contact_id=eq.${encodeURIComponent(domainContactId)}`,
            { sf_contact_id: sfId, sf_last_synced: new Date().toISOString() }
          ).catch(() => {});
        }
        result.sf_linked = {
          sf_contact_id: sfId,
          sf_account_id: sfAccountId,
          sf_name: sfRes.contact.Name || null,
          unified_patched: patchUnified.ok,
        };
      } else {
        result.sf_linked = { reason: sfRes.reason || 'sf_contact_not_found' };
      }
    } catch (err) {
      result.sf_linked = { error: err?.message };
    }
  } else {
    result.sf_linked = { reason: 'sf_not_configured' };
  }

  return result;
}

// ============================================================================
// 4b. CONTACT MERGE QUEUE CHECK
// ============================================================================
//
// After inserting a brand-new unified_contact for the broker, scan for
// potential duplicates of this same person already in the system under
// a different email/form. Focuses on the two cheap signals that catch the
// majority of real-world broker variants:
//
//   - Same full_name (case-insensitive) with different email
//     ("Geoffrey Ficke" at Colliers as a personal email vs corporate)
//   - Same last_name + company_name with a fuzzy first-name match
//     ("Geoff Ficke" vs "Geoffrey Ficke" at Colliers)
//
// Writes candidates to government.contact_merge_queue (shared table used
// by the existing contacts triage UI at operations.js:1855). match_score
// >= 0.85 gets queued. This runs fire-and-forget on a best-effort basis —
// a failure here does not block promotion.

async function checkBrokerMergeCandidates(unifiedId, snapshot) {
  if (!unifiedId) return { ok: false, skipped: 'no_unified_id' };
  const fullName = (snapshot.listing_broker || '').trim();
  const email    = (snapshot.listing_broker_email || '').trim().toLowerCase();
  const company  = (snapshot.listing_firm || '').trim();

  if (!fullName && !email) {
    return { ok: false, skipped: 'insufficient_signals' };
  }

  // Parse first/last name for comparison.
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || null;
  const lastName  = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;

  // Pull candidate unified_contacts to check against — cap the pool at
  // 50 to keep this fast. Prefer rows with matching last_name or
  // matching company, which is where real duplicates cluster.
  const filters = [];
  if (lastName) filters.push(`last_name=ilike.${encodeURIComponent(lastName)}`);
  else if (fullName) filters.push(`full_name=ilike.${encodeURIComponent(fullName)}`);
  else if (company) filters.push(`company_name=ilike.${encodeURIComponent(company)}`);
  filters.push(`unified_id=neq.${pgFilterVal(unifiedId)}`);
  filters.push('select=unified_id,full_name,first_name,last_name,email,company_name');
  filters.push('limit=50');

  const candidates = await opsQuery('GET', `unified_contacts?${filters.join('&')}`);
  if (!candidates.ok || !Array.isArray(candidates.data) || !candidates.data.length) {
    return { ok: true, candidates_found: 0 };
  }

  const queued = [];
  for (const cand of candidates.data) {
    let score  = 0;
    let reason = '';

    // 1. Exact email match (shouldn't happen since we skip that case in
    //    promoteUnifiedContact, but defensive)
    if (email && (cand.email || '').toLowerCase() === email) {
      score = 1.0;
      reason = 'duplicate_email';
    }
    // 2. Exact full-name match (different email or record)
    else if (fullName && (cand.full_name || '').toLowerCase().trim() === fullName.toLowerCase().trim()) {
      score = 0.90;
      reason = 'exact_name_match';
    }
    // 3. Same last_name + company (fuzzy first-name signal)
    else if (lastName && (cand.last_name || '').toLowerCase() === lastName.toLowerCase()
          && company && (cand.company_name || '').toLowerCase().includes(company.toLowerCase())) {
      // If first-names also share the same initial letter it's a stronger
      // signal (Geoff / Geoffrey both start with G).
      const candFirst = (cand.first_name || '').toLowerCase();
      const myFirst   = (firstName || '').toLowerCase();
      if (candFirst && myFirst && candFirst[0] === myFirst[0]) {
        score = 0.85;
        reason = 'name_company_initial_match';
      }
    }

    if (score >= 0.85 && reason) {
      // Insert into the shared contact_merge_queue (lives on gov DB per
      // existing convention in contacts-handler.js). contact_a / contact_b
      // are unified_ids.
      const insertRes = await domainQuery('government', 'POST', 'contact_merge_queue', {
        contact_a:    unifiedId,
        contact_b:    cand.unified_id,
        match_score:  score,
        match_reason: reason,
        status:       'pending',
      });
      if (insertRes.ok) {
        queued.push({ unified_id: cand.unified_id, reason, score });
      }
    }
  }

  return { ok: true, candidates_found: candidates.data.length, queued };
}

// ============================================================================
// 4c. OWNER RESOLUTION (property.recorded_owner_id / true_owner_id + SF flag)
// ============================================================================
//
// The OM rarely spells out a seller for government properties (build-to-
// suits are negotiated; buyer never sees the full title chain on page 1).
// What the gov property row DOES have is `assessed_owner` (from public
// records) and `notes` (often "GSA Lessor: <entity>"). Use those as the
// signal. Try to:
//
//   - If property.true_owner_id is null: ILIKE-match property.assessed_owner
//     against public.true_owners.name / canonical_name → link if found.
//   - If property.recorded_owner_id is null: same approach against
//     recorded_owners.
//   - Whether or not we resolved, surface the owner's sf_account_id to
//     the caller so triage UI can flag "owner needs SF link" when null.
//
// This runs only for gov matches today. Dialysis has different owner
// structures (operator + landlord separation) that need their own mapper.

async function resolveOwnerLinks(match, snapshot) {
  if (match.domain !== 'government') {
    return { ok: true, skipped: `owner_resolution_not_implemented_for_${match.domain}` };
  }
  const propertyId = Number(match.property_id);

  // Pull current owner state + assessed_owner from the property
  const propRes = await domainQuery(
    'government',
    'GET',
    `properties?property_id=eq.${propertyId}&select=recorded_owner_id,true_owner_id,assessed_owner,notes&limit=1`
  );
  if (!propRes.ok || !Array.isArray(propRes.data) || !propRes.data.length) {
    return { ok: false, skipped: 'property_not_found' };
  }
  const prop = propRes.data[0];

  // Signal for resolution: prefer snapshot.seller_name (OM said so), then
  // property.assessed_owner (public records), then parse property.notes
  // ("GSA Lessor: X"). Normalize to a single best-guess name.
  let ownerName = (snapshot?.seller_name || '').trim()
               || (prop.assessed_owner || '').trim();
  if (!ownerName && typeof prop.notes === 'string') {
    const m = prop.notes.match(/(?:GSA\s+Lessor|Lessor|Owner)\s*:\s*([^\n,;]+)/i);
    if (m) ownerName = m[1].trim();
  }

  const result = {
    ok: true,
    owner_name_used: ownerName || null,
    recorded_owner: { already_linked: !!prop.recorded_owner_id },
    true_owner:     { already_linked: !!prop.true_owner_id },
    sf_sync_flags:  [],
  };
  if (!ownerName) {
    result.skipped = 'no_owner_signal';
    return result;
  }

  // Normalize the owner name for fuzzy matching:
  //   - strip commas (break PostgREST's or=() comma parsing)
  //   - strip trailing entity suffixes that vary between records
  //     ("TEXAS GSA HOLDINGS, LP" ~ "TEXAS GSA HOLDINGS LP" ~ "TEXAS GSA HOLDINGS")
  //   - collapse whitespace
  // Then use wildcard ilike so rows with slightly different suffixes still
  // match. We do TWO separate queries (name + canonical_name) rather than
  // one or=(...) with commas — the PostgREST or= parser treats unescaped
  // commas as condition separators and breaks on names like
  // "TEXAS GSA HOLDINGS, LP".
  const coreName = ownerName
    .replace(/,/g, ' ')
    .replace(/\b(LLC|L\.L\.C\.|LP|L\.P\.|INC|INC\.|CORP|CORP\.|LLP|CO|LTD|PLLC)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const pattern = `*${coreName}*`;
  const lookupOwner = async (table, pkCol, idCol) => {
    // Run two ilike queries — one on name, one on canonical_name —
    // then de-dupe by primary key.
    const [byName, byCanon] = await Promise.all([
      domainQuery('government', 'GET',
        `${table}?name=ilike.${encodeURIComponent(pattern)}&select=${pkCol},name,sf_account_id&limit=5`
      ),
      domainQuery('government', 'GET',
        `${table}?canonical_name=ilike.${encodeURIComponent(pattern)}&select=${pkCol},name,sf_account_id&limit=5`
      ),
    ]);
    const rows = [];
    const seen = new Set();
    for (const r of (byName.data || [])) { if (!seen.has(r[pkCol])) { seen.add(r[pkCol]); rows.push(r); } }
    for (const r of (byCanon.data || [])) { if (!seen.has(r[pkCol])) { seen.add(r[pkCol]); rows.push(r); } }
    return rows;
  };

  // ---- Try true_owner first (typically the money-party behind the LP/LLC)
  if (!prop.true_owner_id) {
    const toRows = await lookupOwner('true_owners', 'true_owner_id', 'true_owner_id');
    const toLookup = { ok: true, data: toRows };
    if (toLookup.ok && Array.isArray(toLookup.data) && toLookup.data.length) {
      const best = toLookup.data[0];
      const patchRes = await domainQuery(
        'government',
        'PATCH',
        `properties?property_id=eq.${propertyId}`,
        { true_owner_id: best.true_owner_id }
      );
      result.true_owner = {
        already_linked:  false,
        resolved_id:     best.true_owner_id,
        resolved_name:   best.name,
        sf_account_id:   best.sf_account_id || null,
        patched:         patchRes.ok,
      };
      if (!best.sf_account_id) {
        result.sf_sync_flags.push({
          kind: 'true_owner',
          owner_id: best.true_owner_id,
          name: best.name,
          reason: 'no_sf_account_id — surface for manual SF match',
        });
      }
    } else {
      result.true_owner.lookup = 'no_match';
    }
  } else {
    // Already linked — surface the SF sync status
    const existing = await domainQuery(
      'government',
      'GET',
      `true_owners?true_owner_id=eq.${encodeURIComponent(prop.true_owner_id)}&select=true_owner_id,name,sf_account_id&limit=1`
    );
    if (existing.ok && existing.data?.length) {
      const row = existing.data[0];
      result.true_owner.resolved_name = row.name;
      result.true_owner.sf_account_id = row.sf_account_id || null;
      if (!row.sf_account_id) {
        result.sf_sync_flags.push({
          kind: 'true_owner',
          owner_id: row.true_owner_id,
          name: row.name,
          reason: 'pre_linked_but_no_sf_account_id',
        });
      }
    }
  }

  // ---- recorded_owner: same pattern
  if (!prop.recorded_owner_id) {
    const roRows = await lookupOwner('recorded_owners', 'recorded_owner_id', 'recorded_owner_id');
    const roLookup = { ok: true, data: roRows };
    if (roLookup.ok && Array.isArray(roLookup.data) && roLookup.data.length) {
      const best = roLookup.data[0];
      const patchRes = await domainQuery(
        'government',
        'PATCH',
        `properties?property_id=eq.${propertyId}`,
        { recorded_owner_id: best.recorded_owner_id }
      );
      result.recorded_owner = {
        already_linked:  false,
        resolved_id:     best.recorded_owner_id,
        resolved_name:   best.name,
        sf_account_id:   best.sf_account_id || null,
        patched:         patchRes.ok,
      };
      if (!best.sf_account_id) {
        result.sf_sync_flags.push({
          kind: 'recorded_owner',
          owner_id: best.recorded_owner_id,
          name: best.name,
          reason: 'no_sf_account_id — surface for manual SF match',
        });
      }
    } else {
      result.recorded_owner.lookup = 'no_match';
    }
  } else {
    const existing = await domainQuery(
      'government',
      'GET',
      `recorded_owners?recorded_owner_id=eq.${encodeURIComponent(prop.recorded_owner_id)}&select=recorded_owner_id,name,sf_account_id&limit=1`
    );
    if (existing.ok && existing.data?.length) {
      const row = existing.data[0];
      result.recorded_owner.resolved_name = row.name;
      result.recorded_owner.sf_account_id = row.sf_account_id || null;
      if (!row.sf_account_id) {
        result.sf_sync_flags.push({
          kind: 'recorded_owner',
          owner_id: row.recorded_owner_id,
          name: row.name,
          reason: 'pre_linked_but_no_sf_account_id',
        });
      }
    }
  }

  // ---- Salesforce account link: best-effort. For every sf_sync_flag
  //      that represents an owner with no sf_account_id, try to find a
  //      matching SF Account by name and PATCH the owner row. Only runs
  //      when SF is configured — otherwise we leave the flags in place
  //      for manual triage.
  result.sf_lookup = { configured: isSalesforceConfigured(), attempted: 0, linked: 0, failures: [] };
  if (isSalesforceConfigured()) {
    for (const flag of result.sf_sync_flags) {
      result.sf_lookup.attempted += 1;
      try {
        const sfRes = await findSalesforceAccountByName(flag.name);
        if (sfRes.ok && sfRes.account?.Id) {
          const table = flag.kind === 'true_owner' ? 'true_owners' : 'recorded_owners';
          const pk    = flag.kind === 'true_owner' ? 'true_owner_id' : 'recorded_owner_id';
          const patchRes = await domainQuery(
            'government',
            'PATCH',
            `${table}?${pk}=eq.${encodeURIComponent(flag.owner_id)}`,
            { sf_account_id: sfRes.account.Id, sf_last_synced: new Date().toISOString() }
          );
          if (patchRes.ok) {
            flag.sf_linked      = true;
            flag.sf_account_id  = sfRes.account.Id;
            flag.sf_account_name = sfRes.account.Name;
            result.sf_lookup.linked += 1;
          } else {
            result.sf_lookup.failures.push({
              owner_id: flag.owner_id,
              name: flag.name,
              stage: 'patch',
              status: patchRes.status,
              detail: patchRes.data,
            });
          }
        } else if (sfRes.reason) {
          flag.sf_lookup_result = sfRes.reason;
        }
      } catch (err) {
        result.sf_lookup.failures.push({
          owner_id: flag.owner_id,
          name: flag.name,
          stage: 'lookup_exception',
          error: err?.message,
        });
      }
    }
  }

  return result;
}

// ============================================================================
// 5. LCC ENTITY LINK (cross-domain handle for sidebar timeline)
// ============================================================================
//
// When an OM matches a gov/dia property, there may or may not be an LCC
// entity already representing it. The sidebar timeline + context-retrieve
// APIs all key off `entity_id` on activity_events / action_items — so if
// we don't have an entity we're invisible to the sidebar.
//
// ensureEntityLink (from entity-link.js) creates or fetches an LCC entity
// keyed by (source_system, external_id) in external_identities. Creating
// one for the matched property gives us a stable UUID the rest of the
// platform can refer to, and future intakes that hit the same property
// find this entity via lccNativeMatch before touching the domain DB.

async function promoteLccEntity(workspaceId, actorId, snapshot, match) {
  if (!workspaceId) return { ok: false, skipped: 'no_workspace' };
  if (match.domain !== 'government' && match.domain !== 'dialysis') {
    return { ok: true, skipped: 'lcc_entity_not_needed_for_domain', domain: match.domain };
  }

  // sourceSystem mirrors the pattern used by sidebar-pipeline when it
  // creates entities from CoStar DOM scrapes (gov_db / dia_db).
  const sourceSystem = match.domain === 'government' ? 'gov_db' : 'dia_db';
  const externalId   = String(match.property_id);

  const result = await ensureEntityLink({
    workspaceId,
    userId:       actorId,
    sourceSystem,
    sourceType:   'property',
    externalId,
    domain:       match.domain,
    seedFields: {
      address:  snapshot.address || null,
      city:     snapshot.city || null,
      state:    normalizeState(snapshot.state) || null,
      zip:      snapshot.zip_code || null,
      asset_type: snapshot.property_type || null,
      description: snapshot.tenant_name
        ? `${snapshot.tenant_name}${snapshot.listing_firm ? ` — listed by ${snapshot.listing_firm}` : ''}`
        : null,
      domain: match.domain,
    },
    metadata: {
      // Preserve the back-reference to the domain property so downstream
      // lookups can bridge LCC entity → domain-DB property. Matches the
      // sidebar-pipeline convention for CoStar-sourced entities.
      domain_property_id: match.property_id,
      bridge_source:      'intake_promoter',
    },
  });

  if (!result.ok) {
    return { ok: false, skipped: 'ensure_link_failed', detail: result };
  }
  return {
    ok:           true,
    entity_id:    result.entity?.id || result.entityId || null,
    created:      !!result.createdEntity,
    identity_created: !!result.createdIdentity,
  };
}

// ============================================================================
// 6. ACTIVITY EVENT (property-scoped timeline entry)
// ============================================================================
//
// Drops a row in lcc_opps.activity_events so the property's timeline/feed
// surfaces the OM ingestion. entity_id links to the LCC entity ONLY if
// there is one for the matched property — for gov/dia matches we don't
// auto-create an LCC entity, so entity_id stays null and property_id
// is stored in metadata for anyone who wants to filter/display.

async function promoteActivityEvent(intakeId, workspaceId, actorId, snapshot, match, listingResult, lccEntityId) {
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

  // entity_id handles both LCC-native matches (match.property_id is the
  // LCC entity UUID) and gov/dia matches that just had an LCC entity
  // auto-created via promoteLccEntity. Fall back to null if we have
  // neither (shouldn't happen in production but guards the NOT NULL).
  const entityId = match.domain === 'lcc'
    ? match.property_id
    : (lccEntityId || null);

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

  // ---- Normalize match: if this is an LCC-native match but the entity
  //      represents a gov/dia property, hydrate back to that domain so
  //      downstream promotions still update the correct records. Without
  //      this, the second-and-later ingestions for the same property get
  //      matched to the LCC entity and then skipped entirely.
  //
  //      Two lookup paths, in order of preference:
  //        1. entity.metadata.domain_property_id (if a prior promoter run
  //           wrote it there)
  //        2. external_identities row where entity_id matches and
  //           source_system is 'gov_db'/'dia_db' (authoritative back-ref
  //           set by ensureEntityLink regardless of metadata)
  let effectiveMatch = match;
  if (match.domain === 'lcc' && match.property_id) {
    const entityLookup = await opsQuery('GET',
      `entities?id=eq.${encodeURIComponent(match.property_id)}&select=id,domain,metadata&limit=1`
    );
    if (entityLookup.ok && Array.isArray(entityLookup.data) && entityLookup.data.length) {
      const ent = entityLookup.data[0];
      let domainProp = ent.metadata?.domain_property_id || null;
      let domain = ent.domain;

      // Fallback: look up the external_identity for this entity if
      // metadata doesn't carry the domain property_id.
      if (!domainProp) {
        const idLookup = await opsQuery('GET',
          `external_identities?entity_id=eq.${encodeURIComponent(match.property_id)}` +
          `&source_system=in.(gov_db,dia_db)` +
          `&select=source_system,external_id&limit=1`
        );
        if (idLookup.ok && Array.isArray(idLookup.data) && idLookup.data.length) {
          const row = idLookup.data[0];
          domainProp = row.external_id;
          if (!domain || domain === 'lcc') {
            domain = row.source_system === 'gov_db' ? 'government' : 'dialysis';
          }
        }
      }

      if (domainProp && (domain === 'government' || domain === 'dialysis')) {
        effectiveMatch = {
          ...match,
          domain,
          property_id:  Number.isFinite(Number(domainProp)) ? Number(domainProp) : domainProp,
          reason:       `${match.reason}_via_lcc_bridge`,
          lcc_entity_id: match.property_id,  // preserve the LCC entity UUID
        };
      }
    }
  }

  // Guard: supported domains only (now applied against effectiveMatch)
  if (effectiveMatch.domain !== 'government' && effectiveMatch.domain !== 'dialysis') {
    return {
      ok: false,
      skipped: 'domain_not_supported',
      domain: effectiveMatch.domain,
      original_match_domain: match.domain,
    };
  }

  // Guard: we need a property_id
  if (effectiveMatch.property_id == null) {
    return { ok: false, skipped: 'no_property_id' };
  }

  // Use effectiveMatch from here on so the rest of the code is unchanged.
  match = effectiveMatch;

  // Run the three domain-DB promotions in parallel — each is independent
  // and has its own try/catch.
  const [listingResult, contactResult, financialsResult] = await Promise.all([
    promoteListing(match.domain, intakeId, snapshot, match).catch(e => ({ ok: false, error: e?.message })),
    promoteBrokerContact(match.domain, snapshot).catch(e => ({ ok: false, error: e?.message })),
    promotePropertyFinancials(match.domain, match.property_id, snapshot).catch(e => ({ ok: false, error: e?.message })),
  ]);

  // LCC-entity bridge + unified-contact sync + owner resolution run in
  // parallel — none depends on the others. Owner resolution also happens
  // in domain DB (gov for now); activity_event later references the
  // entity and listing but not owner.
  const [lccEntityResult, unifiedContactResult, ownerResolutionResult] = await Promise.all([
    promoteLccEntity(context.workspaceId, context.actorId, snapshot, match)
      .catch(e => ({ ok: false, error: e?.message })),
    promoteUnifiedContact(match.domain, snapshot, contactResult?.contact_id || null)
      .catch(e => ({ ok: false, error: e?.message })),
    resolveOwnerLinks(match, snapshot)
      .catch(e => ({ ok: false, error: e?.message })),
  ]);

  // Merge-queue check + activity_event both depend on the LCC-side results
  // above. Run them in parallel now that we have everything we need.
  const lccEntityId = lccEntityResult?.entity_id || null;
  const unifiedId   = unifiedContactResult?.unified_id || null;
  const [mergeCheckResult, activityEventResult] = await Promise.all([
    // Only check merges when we just INSERTED a fresh unified_contact
    // (not when we found an existing linked one — those are already
    // the canonical version).
    unifiedContactResult?.inserted
      ? checkBrokerMergeCandidates(unifiedId, snapshot)
          .catch(e => ({ ok: false, error: e?.message }))
      : Promise.resolve({ ok: false, skipped: 'contact_pre_existing' }),
    promoteActivityEvent(intakeId, context.workspaceId, context.actorId, snapshot, match, listingResult, lccEntityId)
      .catch(e => ({ ok: false, error: e?.message })),
  ]);

  return {
    ok:                    listingResult.ok,
    domain:                match.domain,
    listing:               listingResult,
    broker_contact:        contactResult,
    property_financials:   financialsResult,
    lcc_entity:            lccEntityResult,
    unified_contact:       unifiedContactResult,
    owner_resolution:      ownerResolutionResult,
    merge_check:           mergeCheckResult,
    activity_event:        activityEventResult,
  };
}
