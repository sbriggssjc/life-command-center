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
import { estimateOmCreatedDate } from '../_shared/om-date-estimate.js';
import { canonicalizeTenant } from '../_shared/tenant-canonical.js';

const MIN_CONFIDENCE_FOR_AUTO_PROMOTE = 0.85;

// ============================================================================
// FIELD-LEVEL PROVENANCE RECORDER (Phase 2.1, 2026-04-25)
// ============================================================================
//
// Calls public.lcc_merge_field on LCC Opps for each (table, field) the
// promoter writes from an OM. Records source='om_extraction' against the
// shared field_source_priority registry. enforce_mode=record_only across
// the board today, so this is observation-only — every actual UPDATE in
// the rest of this file still happens unchanged. When a field's
// enforce_mode is later flipped to 'warn' or 'strict', callers should
// inspect the returned decision before performing their UPDATE.
//
// Sources used:
//   - 'om_extraction'  — AI-extracted from any OM PDF (email or sidebar)
//   - 'lease_document' — would be used by a future signed-lease ingester
//   - 'derived_from_rent' — computed cap rates / projections
// See docs/architecture/data_quality_self_learning_loop.md and
// supabase/migrations/20260425210000_lcc_field_provenance_and_priority.sql.

const OM_EXTRACTION_DEFAULT_CONFIDENCE = 0.7; // AI-extracted, no per-field score

/**
 * Record one field's provenance via lcc_merge_field. Best-effort —
 * a failure here NEVER blocks the actual write. Return the decision
 * envelope so callers can opt into honoring it later.
 */
async function recordFieldProvenance(args) {
  const {
    workspaceId, targetDatabase, targetTable, recordPk, fieldName,
    value, source, sourceRunId, confidence, recordedBy,
  } = args;
  if (value === undefined || value === null) return null;
  if (!targetTable || !recordPk || !fieldName || !source) return null;
  try {
    const res = await opsQuery('POST', 'rpc/lcc_merge_field', {
      p_workspace_id:     workspaceId || null,
      p_target_database:  targetDatabase,
      p_target_table:     targetTable,
      p_record_pk:        String(recordPk),
      p_field_name:       fieldName,
      p_value:            value,
      p_source:           source,
      p_source_run_id:    sourceRunId || null,
      p_confidence:       confidence ?? null,
      p_recorded_by:      recordedBy || null,
    });
    if (!res.ok) {
      // Don't spam logs on first deploy if the function isn't there yet.
      return null;
    }
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    return row || null;
  } catch (err) {
    // Best-effort — never block a real write on provenance recording.
    console.warn('[provenance] recordFieldProvenance failed:', err?.message);
    return null;
  }
}

/**
 * Record provenance for a batch of OM-derived fields on a single row.
 *
 * @param {object} ctx
 * @param {string} ctx.targetDatabase  - 'dia_db' | 'gov_db' | 'lcc_opps'
 * @param {string} ctx.targetTable     - e.g. 'dia.properties'
 * @param {string|number} ctx.recordPk - the row's pk (UUID, integer, etc.)
 * @param {string} ctx.intakeId        - source_run_id; ties back to staged_intake_items
 * @param {string} ctx.workspaceId
 * @param {string} ctx.actorId
 * @param {Object<string, *>} fieldValues - { field_name: value }
 * @param {Object<string, number>} [perFieldConfidence] - optional override
 */
async function recordOmFieldsProvenance(ctx, fieldValues, perFieldConfidence = {}) {
  if (!ctx?.targetTable || !ctx?.recordPk) return;
  const promises = [];
  for (const [fieldName, value] of Object.entries(fieldValues)) {
    if (value === undefined || value === null) continue;
    promises.push(recordFieldProvenance({
      workspaceId:    ctx.workspaceId,
      targetDatabase: ctx.targetDatabase,
      targetTable:    ctx.targetTable,
      recordPk:       ctx.recordPk,
      fieldName,
      value,
      source:         'om_extraction',
      sourceRunId:    ctx.intakeId,
      confidence:     perFieldConfidence[fieldName] ?? OM_EXTRACTION_DEFAULT_CONFIDENCE,
      recordedBy:     ctx.actorId,
    }));
  }
  // Best-effort — race them in parallel, don't await failure.
  await Promise.allSettled(promises);
}

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

// ── Doctype normalization (Bug Z fix, 2026-04-27) ────────────────────────
// The extractor returns document_type values that vary across AI providers
// and prompt versions: 'om', 'OM', 'offering_memorandum', 'offering memorandum',
// 'broker package', 'broker_package', 'flyer', 'marketing_flyer', etc.
// The promoter's LISTING_DOCUMENT_TYPES set only had the 3 canonical short
// forms, so 25 of 30 OMs in the 24-48h audit window were rejected at the
// `not_a_listing_doc` guard. Normalize at the boundary so any variant of
// "OM" maps back to 'om', etc.
const DOCTYPE_ALIASES = {
  // OM variants
  'om':                    'om',
  'offering_memorandum':   'om',
  'offering memorandum':   'om',
  'offering-memorandum':   'om',
  'offering':              'om',
  'broker_package':        'om',
  'broker package':        'om',
  'investment_memorandum': 'om',
  'investment memorandum': 'om',
  // Flyer variants
  'flyer':                 'flyer',
  'broker_flyer':          'flyer',
  'broker flyer':          'flyer',
  'marketing_flyer':       'flyer',
  'marketing flyer':       'flyer',
  'one_pager':             'flyer',
  'one pager':             'flyer',
  'one-pager':             'flyer',
  // Brochure variants
  'marketing_brochure':    'marketing_brochure',
  'marketing brochure':    'marketing_brochure',
  'brochure':              'marketing_brochure',
};

/**
 * Normalize a document_type string to its canonical short form.
 * Returns the input unchanged if no alias matches (so non-listing types
 * like 'lease_abstract', 'rent_roll', 'unknown', etc. flow through and
 * get rejected by the LISTING_DOCUMENT_TYPES guard normally).
 */
function normalizeDocType(dt) {
  if (!dt || typeof dt !== 'string') return dt;
  const key = dt.toLowerCase().trim();
  // Tolerate common typos / extra punctuation
  const dedup = key.replace(/r{2,}/g, 'r').replace(/[.,]/g, '');
  return DOCTYPE_ALIASES[key] || DOCTYPE_ALIASES[dedup] || key;
}

/**
 * Heuristic: classify an extraction snapshot as listing-grade when
 * `document_type` is null/unknown but the snapshot carries the signals
 * a listing usually has (asking price + tenant + at least one of cap
 * rate / building SF / lease term). Used as a fallback in
 * promoteIntakeToDomainListing so that low-quality classification doesn't
 * block obviously-promotable deals (Bug Z follow-up, 2026-04-27).
 */
function snapshotLooksLikeListing(snapshot) {
  if (!snapshot) return false;
  const hasPrice  = Number(snapshot.asking_price) > 0;
  const hasCap    = Number(snapshot.cap_rate) > 0
                 || (typeof snapshot.cap_rate === 'string' && /\d/.test(snapshot.cap_rate));
  const hasNoi    = Number(snapshot.noi) > 0;
  const hasTenant = !!(snapshot.tenant_name || snapshot.primary_tenant);
  const supportingFields = [
    snapshot.cap_rate,
    snapshot.building_sf,
    snapshot.lease_term_years,
    snapshot.lease_expiration,
    snapshot.noi,
  ].filter(v => v != null && v !== '').length;
  // Original heuristic (Bug Z, 2026-04-27): asking_price + tenant + ≥1
  // supporting field. Round 76ej.d (2026-05-04) extension: also accept
  // (cap_rate OR noi) + tenant + lease_expiration. CREXi listing
  // captures often arrive with asking_price scrubbed (broker requires
  // an NDA before showing the price) but always carry a stated cap
  // rate, NOI, tenant, and lease expiration — that combination is
  // unambiguously an active listing and should promote.
  if (hasPrice && hasTenant && supportingFields >= 1) return true;
  if ((hasCap || hasNoi) && hasTenant && snapshot.lease_expiration) return true;
  return false;
}

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

  // Round 76u (2026-04-27): infer OM date from lease metadata when the OM
  // doesn't have its own date. close_listing_on_sale uses listing_date <=
  // sale_date as a guard; using today() instead of the inferred date
  // accidentally protects OM listings from being closed by older sales.
  const omEst = estimateOmCreatedDate(snapshot);
  const listingDate = (omEst.confidence !== 'unknown' && omEst.om_created_estimate)
    ? omEst.om_created_estimate
    : new Date().toISOString().slice(0, 10);

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
    listing_date:       listingDate,
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

  // Round 76u (2026-04-27): infer OM date from lease metadata. Same as gov.
  const omEst = estimateOmCreatedDate(snapshot);
  const listingDate = (omEst.confidence !== 'unknown' && omEst.om_created_estimate)
    ? omEst.om_created_estimate
    : new Date().toISOString().slice(0, 10);

  // Bug G fix (2026-04-25): denormalize price_per_sf onto the listing row
  // so the Sales/Available table's Price/SF column populates without a
  // join through the leases view. Prefer extraction-supplied (most
  // accurate; the OM usually states the figure verbatim) and fall back
  // to ask_price / building_sf when the extractor missed it.
  let pricePerSf = null;
  if (snapshot.price_per_sf != null && Number(snapshot.price_per_sf) > 0) {
    pricePerSf = Number(snapshot.price_per_sf);
  } else if (snapshot.asking_price && snapshot.building_sf) {
    const askPrice = Number(snapshot.asking_price);
    const sf       = Number(snapshot.building_sf);
    if (askPrice > 0 && sf > 0) {
      pricePerSf = Math.round((askPrice / sf) * 100) / 100;
    }
  }

  return {
    property_id:        Number(match.property_id),
    listing_broker:     snapshot.listing_broker || null,
    broker_email:       snapshot.listing_broker_email || null,
    initial_price:      snapshot.asking_price || null,
    last_price:         snapshot.asking_price || null,
    price_per_sf:       pricePerSf,
    current_cap_rate:   capRateDecimal,
    initial_cap_rate:   capRateDecimal,
    status:             'active',
    listing_date:       listingDate,
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
    // Gov has TWO unique indexes on available_listings:
    //   1. source_listing_ref (one row per intake)
    //   2. (property_id, listing_source, listing_status, listing_date)
    //      — only one active LCC-sourced listing per property per day.
    //
    // PostgREST on_conflict= only handles a single index. If multiple OMs
    // for the same property land on the same day, the first inserts cleanly
    // via on_conflict=source_listing_ref, but subsequent inserts blow up
    // with 23505 against the second index.
    //
    // Fix: detect that specific 23505, look up the existing listing, and
    // PATCH it with only the non-null fields from the new row. This turns
    // "3 OMs for one property on one day" into "1 row, progressively
    // enriched as each OM arrives" — which is the behavior we actually
    // want for broker updates, corrections, and re-sends.
    const result = await domainQuery(
      'government',
      'POST',
      'available_listings?on_conflict=source_listing_ref',
      row,
      { Prefer: 'return=representation,resolution=merge-duplicates' }
    );
    if (result.ok) {
      return { ok: true, listing_id: (Array.isArray(result.data) ? result.data[0] : result.data)?.listing_id || null };
    }

    const isDupKeyOnDateIndex =
      result.status === 409 &&
      result.data?.code === '23505' &&
      /property_source_status_date_uniq/.test(String(result.data?.message || ''));

    if (!isDupKeyOnDateIndex) {
      return { ok: false, status: result.status, detail: result.data };
    }

    // Look up the existing row that blocked us
    const existingRes = await domainQuery(
      'government',
      'GET',
      `available_listings?property_id=eq.${row.property_id}` +
      `&listing_source=eq.${encodeURIComponent(row.listing_source)}` +
      `&listing_status=eq.${encodeURIComponent(row.listing_status)}` +
      `&listing_date=eq.${encodeURIComponent(row.listing_date)}` +
      `&select=listing_id&limit=1`
    );
    if (!existingRes.ok || !existingRes.data?.length) {
      return { ok: false, status: 500, detail: { error: 'lookup_existing_failed_after_23505', primary_error: result.data } };
    }
    const existingId = existingRes.data[0].listing_id;

    // PATCH only the non-null fields so a later OM enriches the row
    // without clobbering curated data from the first one. Skip
    // source_listing_ref (that's the first insert's intake_id, keep it)
    // and first_seen_at (only update last_seen_at).
    const patchRow = Object.fromEntries(
      Object.entries(row).filter(([k, v]) => v != null && k !== 'source_listing_ref' && k !== 'first_seen_at')
    );
    patchRow.last_seen_at = new Date().toISOString();

    const patchRes = await domainQuery(
      'government',
      'PATCH',
      `available_listings?listing_id=eq.${encodeURIComponent(existingId)}`,
      patchRow,
      { Prefer: 'return=representation' }
    );
    return patchRes.ok
      ? { ok: true, listing_id: existingId, merged_into_existing: true }
      : { ok: false, status: patchRes.status, detail: patchRes.data, stage: 'patch_after_23505' };
  }

  // Dialysis has no unique source-ref column. Pre-Round-76eg this branch
  // looked up prior rows with `notes ILIKE '%LCC OM intake%'`, which only
  // dedups against rows previously written by THIS code path — sidebar
  // verify-auto-create / scraper / manual rows were invisible and a
  // parallel duplicate would land. Round 76eg widens the dedup to "any
  // active listing for this property" so all ingestion paths converge on
  // a single canonical row, matching the new partial unique index.
  const activeExisting = await domainQuery(
    'dialysis',
    'GET',
    `available_listings?property_id=eq.${Number(match.property_id)}` +
    `&is_active=eq.true&select=listing_id&order=listing_date.desc.nullslast&limit=1`
  );
  let existingId = null;
  if (activeExisting.ok && Array.isArray(activeExisting.data) && activeExisting.data.length) {
    existingId = activeExisting.data[0].listing_id;
  } else {
    // Fall back to the most recent inactive non-sold row — typically a
    // Stale or Withdrawn listing that this OM is reviving.
    const dormantExisting = await domainQuery(
      'dialysis',
      'GET',
      `available_listings?property_id=eq.${Number(match.property_id)}` +
      `&is_active=eq.false&status=not.in.(Sold,sold,Closed,closed)` +
      `&select=listing_id,sold_date,sale_transaction_id` +
      `&order=listing_date.desc.nullslast&limit=1`
    );
    const dormant = dormantExisting.ok && Array.isArray(dormantExisting.data)
      ? dormantExisting.data[0]
      : null;
    if (dormant && !dormant.sold_date && !dormant.sale_transaction_id) {
      existingId = dormant.listing_id;
    }
  }
  if (existingId != null) {
    // PATCH only non-null fields so a fresh OM enriches existing curated
    // data without clobbering it. The DB trigger fn_listing_close_if_sold
    // will re-Sold the row if a recent sale event already exists, so we
    // don't need to second-guess that here.
    const patchRow = Object.fromEntries(
      Object.entries(row).filter(([, v]) => v != null)
    );
    const patchRes = await domainQuery(
      'dialysis',
      'PATCH',
      `available_listings?listing_id=eq.${existingId}`,
      patchRow,
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

// Bug H fix (2026-04-25): when an OM lists multiple brokers as a single
// comma-joined string ("Kevin Boeve, James Taylor" with paired emails),
// split into separate contact rows so each broker is a first-class CRM
// entity. Returns an array of {name, email} pairs. Falls back to a single
// pair when the lengths don't match (uneven counts → unsafe to split).
function splitBrokerPairs(rawName, rawEmail) {
  const names  = String(rawName  || '').split(',').map(s => s.trim()).filter(Boolean);
  const emails = String(rawEmail || '').split(',').map(s => s.trim()).filter(Boolean);
  if (names.length > 1 && names.length === emails.length) {
    return names.map((n, i) => ({ name: n, email: emails[i] }));
  }
  // Uneven or single-broker input → leave as a single combined record.
  return [{ name: rawName || null, email: rawEmail || null }];
}

async function promoteBrokerContact(domain, snapshot, match) {
  const brokerName  = (snapshot.listing_broker || '').trim();
  const brokerEmail = (snapshot.listing_broker_email || '').trim();
  if (!brokerName && !brokerEmail) {
    return { ok: false, skipped: 'no_broker_info' };
  }

  const pairs = splitBrokerPairs(brokerName, brokerEmail);
  // Multi-broker case: recurse for each pair, return primary + additional_ids.
  if (pairs.length > 1) {
    const results = [];
    for (const pair of pairs) {
      const subSnapshot = {
        ...snapshot,
        listing_broker:       pair.name,
        listing_broker_email: pair.email,
      };
      // eslint-disable-next-line no-await-in-loop -- sequential to avoid email-uniqueness races
      const r = await promoteBrokerContact(domain, subSnapshot, match);
      results.push(r);
    }
    const successes = results.filter(r => r.ok);
    if (!successes.length) {
      return { ok: false, skipped: 'all_split_inserts_failed', results };
    }
    return {
      ok: true,
      contact_id: successes[0].contact_id || null,
      additional_contact_ids: successes.slice(1).map(r => r.contact_id).filter(Boolean),
      split_count: successes.length,
      property_id: match?.property_id || null,
    };
  }

  // Gov table columns: name, email, phone, company, title, data_source,
  //                    contact_type, property_id
  // Dia table columns: contact_name, contact_email, contact_phone, company,
  //                    title, role, property_id
  const isGov = domain === 'government';
  const emailCol = isGov ? 'email' : 'contact_email';

  // Resolve the property_id so the contact is filterable from the detail
  // pane's "contacts for this property" lookup. Without this link, a freshly
  // ingested OM leaves 0 contacts visible on the property even though the
  // broker row exists (2026-04-23 Plano diagnosis: contact_count=0 on
  // property 12971 despite Geoff Ficke being in gov.contacts).
  const propertyId = match?.property_id || null;

  // Check if a contact with this email already exists. If so, ONLY backfill
  // property_id when missing — don't overwrite curated fields.
  if (brokerEmail) {
    const existing = await domainQuery(
      domain,
      'GET',
      `contacts?${emailCol}=ilike.${encodeURIComponent(brokerEmail)}&select=contact_id,property_id&limit=1`
    );
    if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
      const row0 = existing.data[0];
      if (propertyId && !row0.property_id) {
        await domainQuery(
          domain,
          'PATCH',
          `contacts?contact_id=eq.${encodeURIComponent(row0.contact_id)}`,
          { property_id: propertyId }
        ).catch(() => {});
      }
      return { ok: true, skipped: 'existing_contact', contact_id: row0.contact_id, property_id: propertyId };
    }
  }

  // No existing match → insert a fresh contact, now including property_id
  // so the detail-pane contacts lookup (property_id=eq.X) returns it.
  const row = isGov
    ? {
        name:            brokerName || brokerEmail || 'Unknown Broker',
        email:           brokerEmail || null,
        company:         snapshot.listing_firm || null,
        title:           'Listing Broker',
        contact_type:    'broker',
        data_source:     'lcc_intake_om',
        property_id:     propertyId,
      }
    : {
        contact_name:    brokerName || brokerEmail || 'Unknown Broker',
        contact_email:   brokerEmail || null,
        company:         snapshot.listing_firm || null,
        title:           'Listing Broker',
        role:            'broker',
        property_id:     propertyId,
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
  return { ok: true, contact_id: inserted?.contact_id || null, inserted: true, property_id: propertyId };
}

// ============================================================================
// 3. PROPERTY FINANCIALS UPDATE (fill-in-blanks only)
// ============================================================================
//
// Only update fields currently null on the property — don't overwrite
// curated data. This is a conservative bridge: if the OM says cap_rate=6.9
// and the property has no cap_rate, populate it. If the property already
// has a cap_rate (from CoStar or a human edit), leave it alone.

// Dialysis-side property back-write — narrower than gov because the
// dia.properties schema has no cap_rate/noi/gross_rent/rba columns. We
// fill year_built, lot_sf, lease_commencement when NULL, and refresh
// anchor_rent + anchor_rent_date + anchor_rent_source whenever the OM's
// lease commencement is newer than the property's recorded anchor date.
async function promoteDiaPropertyFromOm(propertyId, snapshot) {
  const existing = await domainQuery(
    'dialysis',
    'GET',
    `properties?property_id=eq.${Number(propertyId)}` +
    `&select=tenant,year_built,lot_sf,building_size,land_area,lease_commencement,anchor_rent,anchor_rent_date,anchor_rent_source,parcel_number&limit=1`
  );
  if (!existing.ok || !Array.isArray(existing.data) || !existing.data.length) {
    return { ok: false, skipped: 'property_not_found', property_id: propertyId };
  }
  const current = existing.data[0];
  const patch = {};

  // tenant — only fill if NULL/empty. Properties imported from CSV often
  // had tenant left blank; the OM extraction is the first authoritative
  // source for the operator name. Bug Z follow-up (2026-04-27): the audit
  // surfaced 35389 (Vital Smiles) and 35380 (DB Biologics) with tenant=NULL
  // despite their OMs clearly stating the tenant — promoteDiaPropertyFromOm
  // never patched the column.
  const tenantStr = canonicalizeTenant((snapshot.tenant_name || snapshot.primary_tenant || '').trim());
  if ((current.tenant == null || current.tenant === '') && tenantStr.length >= 2 && tenantStr.length < 200) {
    patch.tenant = tenantStr;
  }

  // year_built — only fill if NULL, range-validate
  const yb = parseInt(snapshot.year_built, 10);
  if (current.year_built == null && Number.isFinite(yb) && yb >= 1800 && yb <= new Date().getFullYear() + 2) {
    patch.year_built = yb;
  }

  // parcel_number — only fill if NULL, normalized to a trimmed string
  const parcel = snapshot.parcel_number != null ? String(snapshot.parcel_number).trim() : null;
  if (current.parcel_number == null && parcel) {
    patch.parcel_number = parcel;
  }

  // lot_sf — fill when NULL or 0 (existing data sometimes has 0.0 placeholders)
  const lotSf = snapshot.lot_sf != null ? Number(snapshot.lot_sf) : null;
  if (
    (current.lot_sf == null || Number(current.lot_sf) === 0) &&
    Number.isFinite(lotSf) && lotSf > 0 && lotSf < 100_000_000
  ) {
    patch.lot_sf = Math.round(lotSf);
  }

  // building_size (RBA) — Round 76bk (2026-04-28). Previously missing from
  // the dia property back-write. Audit found 0% propagation for building_sf
  // despite 34% of recent OM extractions capturing it. Same conservative
  // rule: only fill when NULL or 0 (matches Round 76ba zero-to-NULL trigger
  // semantics). Reasonable upper bound 5M sf to reject extraction errors.
  const buildingSf = snapshot.building_sf != null ? Number(snapshot.building_sf) : null;
  if (
    (current.building_size == null || Number(current.building_size) === 0) &&
    Number.isFinite(buildingSf) && buildingSf > 100 && buildingSf < 5_000_000
  ) {
    patch.building_size = Math.round(buildingSf);
  }

  // land_area (acres) — convert lot_sf to acres if no acres given, fill if NULL
  const lotAcres = snapshot.land_acres != null ? Number(snapshot.land_acres) : null;
  if (
    (current.land_area == null || Number(current.land_area) === 0) &&
    Number.isFinite(lotAcres) && lotAcres > 0 && lotAcres < 10000
  ) {
    patch.land_area = lotAcres;
  } else if (
    (current.land_area == null || Number(current.land_area) === 0) &&
    Number.isFinite(lotSf) && lotSf > 0
  ) {
    patch.land_area = Math.round((lotSf / 43560) * 100) / 100;  // sf to acres
  }

  // lease_commencement — only fill if NULL
  const commencement = snapshot.lease_commencement || null;
  if (current.lease_commencement == null && commencement) {
    patch.lease_commencement = commencement;
  }

  // anchor_rent / anchor_rent_date / anchor_rent_source — refresh when the
  // OM's commencement strictly post-dates the recorded anchor. The
  // dia v_sales_comps view's rent projection rolls forward from the
  // anchor (CLAUDE.md), so a stale anchor pollutes downstream comps.
  const annualRent = snapshot.annual_rent != null ? Number(snapshot.annual_rent) : null;
  if (commencement && Number.isFinite(annualRent) && annualRent > 0) {
    const omIsNewer =
      current.anchor_rent_date == null ||
      String(commencement) > String(current.anchor_rent_date);
    if (omIsNewer) {
      patch.anchor_rent        = annualRent;
      patch.anchor_rent_date   = commencement;
      patch.anchor_rent_source = 'om_confirmed';
    }
  }

  if (!Object.keys(patch).length) {
    return { ok: true, skipped: 'all_fields_already_populated_or_curated', current_values: current };
  }

  const patchRes = await domainQuery(
    'dialysis',
    'PATCH',
    `properties?property_id=eq.${Number(propertyId)}`,
    patch
  );
  return patchRes.ok
    ? { ok: true, patched_fields: Object.keys(patch), patch }
    : { ok: false, skipped: 'patch_failed', status: patchRes.status, detail: patchRes.data };
}

async function promotePropertyFinancials(domain, propertyId, snapshot) {
  // Bug K fix (2026-04-25): dialysis properties don't carry cap_rate/noi/rent
  // (those live on leases/sales_transactions), but they DO carry year_built,
  // lot_sf, lease_commencement, and anchor_rent. Backfill those from the OM
  // when they're missing or when the OM lease is newer than the recorded
  // anchor — same conservative "fill blanks; don't clobber curated data"
  // rule as gov, with one exception: anchor_rent updates when lease_commencement
  // strictly post-dates anchor_rent_date, because by definition a newer lease
  // is the right anchor.
  if (domain === 'dialysis') {
    return promoteDiaPropertyFromOm(propertyId, snapshot);
  }
  if (domain !== 'government') {
    return { ok: true, skipped: `property_financials_not_supported_for_${domain}` };
  }

  // Gov properties has gross_rent + noi + year_built + land_acres + rba.
  // (cap_rate lives on available_listings / sales_transactions / view-computed.)
  //
  // Snapshot field map:
  //   snapshot.noi            → properties.noi
  //   snapshot.annual_rent    → properties.gross_rent
  //   snapshot.year_built     → properties.year_built           (2026-04-23)
  //   snapshot.land_acres OR
  //   snapshot.lot_sf         → properties.land_acres (÷43,560) (2026-04-23)
  //   snapshot.building_sf OR
  //   snapshot.square_footage → properties.rba                  (2026-04-23)
  //
  // Only fields currently null on the property get patched so we never
  // overwrite curated data.
  const patch = {};
  if (snapshot.noi != null)             patch.noi        = Number(snapshot.noi);
  if (snapshot.annual_rent != null)     patch.gross_rent = Number(snapshot.annual_rent);

  // year_built: accept an int 1800–current year. Reject junk.
  const yb = parseInt(snapshot.year_built, 10);
  if (Number.isFinite(yb) && yb >= 1800 && yb <= new Date().getFullYear() + 2) {
    patch.year_built = yb;
  }

  // land_acres: prefer explicit acres, else convert lot_sf (43,560 sf/acre).
  const lotSf = snapshot.lot_sf != null ? Number(snapshot.lot_sf) : null;
  const acres = snapshot.land_acres != null
    ? Number(snapshot.land_acres)
    : (lotSf && lotSf > 0 ? Math.round((lotSf / 43560) * 100) / 100 : null);
  if (Number.isFinite(acres) && acres > 0 && acres < 100000) {
    patch.land_acres = acres;
  }

  // rba (rentable building area): prefer building_sf, else square_footage.
  const rba = snapshot.building_sf != null
    ? Number(snapshot.building_sf)
    : (snapshot.square_footage != null ? Number(snapshot.square_footage) : null);
  if (Number.isFinite(rba) && rba >= 500 && rba < 10000000) {
    patch.rba = Math.round(rba);
  }

  if (!Object.keys(patch).length) {
    return { ok: false, skipped: 'nothing_to_update' };
  }

  const existing = await domainQuery(
    'government',
    'GET',
    `properties?property_id=eq.${Number(propertyId)}&select=noi,gross_rent,year_built,land_acres,rba&limit=1`
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
  if (current.year_built == null && patch.year_built != null) filteredPatch.year_built = patch.year_built;
  if (current.land_acres == null && patch.land_acres != null) filteredPatch.land_acres = patch.land_acres;
  if (current.rba        == null && patch.rba        != null) filteredPatch.rba        = patch.rba;
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
// 3c. PROSPECT LEAD UPSERT (so the Pipeline tab surfaces OM-promoted deals)
// ============================================================================
//
// Plano revealed a gap: the OM-promoted listing appears on Sales/Available
// (from v_available_listings → available_listings) but NOT on the Pipeline
// tab, because that tab queries prospect_leads. Without a lead row,
// intake-promoted deals are invisible to the broker's "what do I have to
// work on" view.
//
// Behavior:
//   - If a prospect_leads row already exists for this property_id (prior
//     ownership-change or CoStar scan picked it up), UPDATE it with fresh
//     intake context — fill-blanks-only, so we don't clobber human edits.
//   - Otherwise INSERT a new lead_source='lcc_intake_om' row with whatever
//     the OM snapshot yielded.
//
// Only runs for gov for now. Dia has a different lead-gen surface.
async function promoteProspectLead(domain, propertyId, snapshot, match, listingId) {
  if (domain !== 'government') {
    return { ok: true, skipped: `prospect_lead_not_supported_for_${domain}` };
  }
  if (!propertyId) return { ok: false, skipped: 'no_property_id' };

  const today = new Date().toISOString().split('T')[0];
  const fields = {
    tenant_agency:        snapshot.tenant_agency || snapshot.tenant_name || null,
    agency_full_name:     snapshot.agency_full_name || null,
    government_type:      snapshot.government_type || 'federal',
    source_listing_id:    listingId || null,
    listing_status:       'active',
    listing_date:         snapshot.listing_date || today,
    listing_broker_name:  snapshot.listing_broker || null,
    listing_broker_firm:  snapshot.listing_firm || null,
    listing_broker_email: snapshot.listing_broker_email || null,
    listing_broker_phone: snapshot.listing_broker_phone || null,
    asking_price:         snapshot.asking_price || null,
    asking_cap_rate:      snapshot.cap_rate || null,
    year_built:           snapshot.year_built ? parseInt(snapshot.year_built, 10) : null,
    land_acres:           snapshot.land_acres || (snapshot.lot_sf ? Math.round((Number(snapshot.lot_sf) / 43560) * 100) / 100 : null),
    rba:                  snapshot.building_sf ? parseInt(snapshot.building_sf, 10) : null,
    square_feet:          snapshot.building_sf ? parseInt(snapshot.building_sf, 10) : null,
    annual_rent:          snapshot.annual_rent ? Number(snapshot.annual_rent) : null,
    lease_expiration:     snapshot.lease_expiration || null,
    true_owner:           snapshot.seller_name || snapshot.owner_name || null,
    recorded_owner:       snapshot.seller_name || snapshot.owner_name || null,
    is_already_listed:    true,
  };
  // Drop null fields so COALESCE doesn't pointlessly "update" to null.
  for (const k of Object.keys(fields)) {
    if (fields[k] == null || fields[k] === '') delete fields[k];
  }

  // Find existing row by matched_property_id.
  const existing = await domainQuery(
    'government',
    'GET',
    `prospect_leads?matched_property_id=eq.${Number(propertyId)}&select=lead_id,${Object.keys(fields).join(',')}&limit=1`
  );
  if (existing.ok && existing.data?.length) {
    // Fill-blanks-only update so we don't stomp on user-edited fields.
    const current = existing.data[0];
    const patch = {};
    for (const k of Object.keys(fields)) {
      if (current[k] == null || current[k] === '') patch[k] = fields[k];
    }
    if (!Object.keys(patch).length) {
      return { ok: true, lead_id: current.lead_id, skipped: 'already_populated' };
    }
    patch.updated_at = new Date().toISOString();
    const patchRes = await domainQuery(
      'government',
      'PATCH',
      `prospect_leads?lead_id=eq.${encodeURIComponent(current.lead_id)}`,
      patch
    );
    return patchRes.ok
      ? { ok: true, lead_id: current.lead_id, updated: true, fields: Object.keys(patch) }
      : { ok: false, skipped: 'patch_failed', status: patchRes.status, detail: patchRes.data };
  }

  // INSERT fresh lead row.
  const row = {
    matched_property_id:  Number(propertyId),
    lead_source:          'lcc_intake_om',
    address:              snapshot.address || null,
    city:                 snapshot.city || null,
    state:                snapshot.state || null,
    zip_code:             snapshot.zip_code || null,
    ...fields,
  };
  const insertRes = await domainQuery(
    'government',
    'POST',
    'prospect_leads',
    row,
    { Prefer: 'return=representation' }
  );
  if (!insertRes.ok) {
    return { ok: false, skipped: 'insert_failed', status: insertRes.status, detail: insertRes.data };
  }
  const inserted = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  return { ok: true, lead_id: inserted?.lead_id || null, inserted: true };
}

// ============================================================================
// 3b. LEASE EXPENSE PROPAGATION
// ============================================================================
//
// The Sales/Available tab surfaces `expenses` via v_available_listings which
// COALESCEs properties.expenses → active_lease.expense_structure. OM
// extractions carry `expense_structure` (e.g. "Modified Gross" for Plano);
// propagating it to the active lease stops the dashboard from showing '—'
// on every ingested deal. Like promotePropertyFinancials, this is strictly
// fill-blanks-only so we don't overwrite curated lease data.
//
// "Active lease" = the lease on this property with the latest
// commencement_date that hasn't been superseded. If no such lease exists,
// we skip — creating a fresh lease from an OM is out of scope for this
// bridge.
// Bug I fix (2026-04-25): the dia promoter wasn't writing the OM-derived
// lease into dialysis.leases, so v_available_listings (which JOINs the
// most recent active lease) kept showing stale terms — wrong expense
// structure, wrong rent, wrong renewal text — even after a fresh OM
// landed. This writer creates a new lease row from the OM and deactivates
// any existing leases that have already expired, leaving overlapping
// active leases (which need human reconciliation) alone with a warning.
async function promoteDiaLeaseFromOm(propertyId, snapshot) {
  // Need at least commencement OR expiration to write a sensible lease row.
  const commencement = snapshot.lease_commencement || null;
  const expiration   = snapshot.lease_expiration   || null;
  if (!commencement && !expiration) {
    return { ok: true, skipped: 'no_lease_dates_in_snapshot' };
  }

  // Build payload from snapshot fields that map cleanly onto dia.leases.
  const annualRent = snapshot.annual_rent != null ? Number(snapshot.annual_rent) : null;
  const rentPerSf  = snapshot.rent_per_sf != null ? Number(snapshot.rent_per_sf) : null;
  const buildingSf = snapshot.building_sf != null ? Number(snapshot.building_sf) : null;
  const renewalText = snapshot.renewal_options
    ? String(snapshot.renewal_options).trim()
    : null;

  const newLease = {
    property_id:               Number(propertyId),
    // Canonicalize brand variants (DaVita Inc. / DAVITA / Davita Healthcare
    // Partners → DaVita Kidney Care). See _shared/tenant-canonical.js.
    tenant:                    canonicalizeTenant(snapshot.tenant_name) || null,
    guarantor:                 snapshot.tenant_guarantor || null,
    lease_start:               commencement,
    lease_expiration:          expiration,
    expense_structure:         snapshot.expense_structure || null,
    annual_rent:               Number.isFinite(annualRent) && annualRent > 0 ? annualRent : null,
    rent:                      Number.isFinite(annualRent) && annualRent > 0 ? annualRent : null,
    rent_per_sf:               Number.isFinite(rentPerSf) && rentPerSf > 0 ? rentPerSf : null,
    leased_area:               Number.isFinite(buildingSf) && buildingSf > 0 ? buildingSf : null,
    sqft:                      Number.isFinite(buildingSf) && buildingSf > 0 ? buildingSf : null,
    renewal_options:           renewalText,
    renewal_option_text:       renewalText,
    roof_responsibility:       snapshot.roof_responsibility       || null,
    hvac_responsibility:       snapshot.hvac_responsibility       || null,
    parking_responsibility:    snapshot.parking_responsibility    || null,
    structure_responsibility:  snapshot.structure_responsibility  || null,
    status:                    'active',
    is_active:                 true,
  };

  // Strip null fields so PostgREST doesn't try to overwrite defaults.
  const insertPayload = Object.fromEntries(
    Object.entries(newLease).filter(([, v]) => v !== null)
  );

  // Avoid duplicate: if an active lcc-intake-sourced lease already exists
  // for this property with the same lease_start, PATCH it instead of
  // inserting a second one. We use lease_start as the dedup key because
  // this domain has no source-of-truth column on leases.
  if (commencement) {
    const existing = await domainQuery(
      'dialysis',
      'GET',
      `leases?property_id=eq.${Number(propertyId)}` +
      `&lease_start=eq.${encodeURIComponent(commencement)}` +
      `&select=lease_id,is_active&limit=1`
    );
    if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
      const existingId = existing.data[0].lease_id;
      const patchRes = await domainQuery(
        'dialysis',
        'PATCH',
        `leases?lease_id=eq.${encodeURIComponent(existingId)}`,
        insertPayload,
        { Prefer: 'return=representation' }
      );
      return patchRes.ok
        ? { ok: true, lease_id: existingId, action: 'patched_existing' }
        : { ok: false, skipped: 'patch_failed', status: patchRes.status, detail: patchRes.data };
    }
  }

  // Round 76ej.e (2026-05-04): degradation guard. CREXi captures often
  // arrive with lease_expiration but NO commencement and partial tenant
  // info. The 76ej.d test inserted a third active lease on property
  // 35636 with NULL lease_start, NULL data_source, "2" renewal_options
  // — degrading the data set. If commencement is missing, find the
  // existing active lease for this property with the same expiration
  // and PATCH that one instead. If none exists, skip the insert
  // entirely rather than create a third partial row.
  if (!commencement && expiration) {
    const existingByExp = await domainQuery(
      'dialysis',
      'GET',
      `leases?property_id=eq.${Number(propertyId)}` +
      `&lease_expiration=eq.${encodeURIComponent(expiration)}` +
      `&is_active=eq.true&select=lease_id,lease_start&order=updated_at.desc.nullslast&limit=1`
    );
    if (existingByExp.ok && Array.isArray(existingByExp.data) && existingByExp.data.length) {
      const existingId = existingByExp.data[0].lease_id;
      // Only patch fields we have non-null values for; never overwrite
      // an existing lease_start with NULL.
      const safePatch = { ...insertPayload };
      delete safePatch.lease_start;
      const patchRes = await domainQuery(
        'dialysis',
        'PATCH',
        `leases?lease_id=eq.${encodeURIComponent(existingId)}`,
        safePatch,
        { Prefer: 'return=representation' }
      );
      return patchRes.ok
        ? { ok: true, lease_id: existingId, action: 'patched_existing_by_expiration' }
        : { ok: false, skipped: 'patch_failed', status: patchRes.status, detail: patchRes.data };
    }
    // No existing match — refuse to create a degraded row.
    return {
      ok: true,
      skipped: 'incomplete_lease_no_existing_match',
      reason:  'snapshot has lease_expiration but no lease_start; no existing active lease to enrich',
    };
  }

  // Insert fresh.
  const insertRes = await domainQuery(
    'dialysis',
    'POST',
    'leases',
    insertPayload,
    { Prefer: 'return=representation' }
  );

  // 409 race fallback: leases has UNIQUE(property_id, tenant_id, lease_start,
  // lease_expiration) — if a parallel writer (sidebar capture, another OM
  // promote, manual entry) inserted the same lease between our pre-insert
  // dedup check and this POST, we hit 409. Treat it as "already there",
  // PATCH the existing matching row with our latest values, and continue.
  // Mirrors the apply-change.js bridge-level fallback (PR #480) for the
  // direct-domainQuery path the OM promoter uses.
  if (!insertRes.ok && insertRes.status === 409) {
    const tenantId = newLease.tenant_id;
    const start = newLease.lease_start;
    const expiration = newLease.lease_expiration;
    if (start && expiration) {
      const filter = `property_id=eq.${Number(propertyId)}` +
        `&lease_start=eq.${encodeURIComponent(start)}` +
        `&lease_expiration=eq.${encodeURIComponent(expiration)}` +
        (tenantId
          ? `&tenant_id=eq.${encodeURIComponent(tenantId)}`
          : `&tenant_id=is.null`);
      const patchRes = await domainQuery(
        'dialysis', 'PATCH', `leases?${filter}`, insertPayload,
        { Prefer: 'return=representation' }
      );
      if (patchRes.ok) {
        const patched = Array.isArray(patchRes.data) ? patchRes.data[0] : patchRes.data;
        return {
          ok: true,
          lease_id: patched?.lease_id || null,
          action: 'patched_existing_after_409',
          deactivated_expired: 0, overlapping_active: 0
        };
      }
    }
    return { ok: false, skipped: 'insert_409_then_patch_failed',
             status: insertRes.status, detail: insertRes.data };
  }

  if (!insertRes.ok) {
    return { ok: false, skipped: 'insert_failed', status: insertRes.status, detail: insertRes.data };
  }
  const inserted = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
  const newLeaseId = inserted?.lease_id || null;

  // Deactivate genuinely-expired leases for this property — but only when
  // the OM's commencement supersedes them (lease_expiration < commencement).
  // Active overlapping leases get a warning so the user can reconcile.
  let deactivated = 0;
  let overlapping = 0;
  if (commencement) {
    const others = await domainQuery(
      'dialysis',
      'GET',
      `leases?property_id=eq.${Number(propertyId)}` +
      `&lease_id=neq.${encodeURIComponent(newLeaseId)}` +
      `&is_active=eq.true` +
      `&select=lease_id,lease_start,lease_expiration&limit=20`
    );
    if (others.ok && Array.isArray(others.data)) {
      for (const o of others.data) {
        if (o.lease_expiration && o.lease_expiration < commencement) {
          // eslint-disable-next-line no-await-in-loop
          const dRes = await domainQuery(
            'dialysis',
            'PATCH',
            `leases?lease_id=eq.${encodeURIComponent(o.lease_id)}`,
            { is_active: false }
          );
          if (dRes.ok) deactivated++;
        } else {
          overlapping++;
        }
      }
    }
  }

  return {
    ok: true,
    lease_id: newLeaseId,
    action: 'inserted_new',
    deactivated_expired: deactivated,
    overlapping_active: overlapping,
    overlap_warning: overlapping > 0
      ? `${overlapping} other active lease(s) overlap; manual reconciliation may be needed`
      : null,
  };
}

async function promoteLeaseExpenses(domain, propertyId, snapshot) {
  if (domain !== 'government') {
    // Dia leases are now handled by promoteDiaLeaseFromOm (called from
    // promoteIntakeToDomainListing), which writes the OM lease verbatim
    // into dialysis.leases. This gov-only function stays focused on
    // patching expense_structure onto the existing gov lease row.
    return { ok: true, skipped: `lease_expenses_not_supported_for_${domain}` };
  }

  const expenseStructure = (snapshot.expense_structure || '').trim();
  if (!expenseStructure) return { ok: false, skipped: 'no_expense_structure_in_snapshot' };

  // Find the active lease on this property — most-recent commencement,
  // not superseded, not expired past today.
  const todayIso = new Date().toISOString().split('T')[0];
  const activeLookup = await domainQuery(
    'government',
    'GET',
    `leases?property_id=eq.${Number(propertyId)}` +
    `&superseded_at=is.null` +
    `&or=(expiration_date.gte.${todayIso},expiration_date.is.null)` +
    `&select=lease_id,lease_number,expense_structure&order=commencement_date.desc.nullslast&limit=1`
  );
  if (!activeLookup.ok || !activeLookup.data?.length) {
    return { ok: true, skipped: 'no_active_lease' };
  }
  const active = activeLookup.data[0];
  if (active.expense_structure) {
    return { ok: true, skipped: 'lease_expense_already_populated', current: active.expense_structure };
  }

  const patchRes = await domainQuery(
    'government',
    'PATCH',
    `leases?lease_id=eq.${encodeURIComponent(active.lease_id)}`,
    { expense_structure: expenseStructure }
  );
  return patchRes.ok
    ? { ok: true, lease_id: active.lease_id, expense_structure: expenseStructure }
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

  // Pull the current sf_contact_id too so we can decide whether to run
  // SF backfill — rows created before SF was wired have it as NULL.
  const existing = await opsQuery('GET',
    `unified_contacts?email=ilike.${encodeURIComponent(email)}` +
    `&select=unified_id,sf_contact_id,sf_account_id,${linkCol}&limit=1`
  );

  let unifiedId = null;
  let existingRow = null;
  let wasInserted = false;

  if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
    existingRow = existing.data[0];
    unifiedId = existingRow.unified_id;
    // If the domain link isn't set yet, patch it in. sf_contact_id backfill
    // happens below regardless of whether the row was new or pre-existing.
    if (!existingRow[linkCol] && domainContactId) {
      await opsQuery('PATCH',
        `unified_contacts?unified_id=eq.${pgFilterVal(unifiedId)}`,
        { [linkCol]: domainContactId }
      ).catch(() => {});
    }
  } else {
    // No existing unified_contacts row — insert a fresh one.
    // full_name is a GENERATED column (omit from insert); contact_class
    // has a CHECK constraint ('business' or 'personal' only).
    const newRow = {
      contact_class: 'business',
      first_name:    firstName,
      last_name:     lastName,
      email,
      company_name:  snapshot.listing_firm || null,
      title:         'Listing Broker',
      contact_type:  'broker',
      [linkCol]:     domainContactId || null,
    };
    const insertRes = await opsQuery('POST', 'unified_contacts', newRow, { Prefer: 'return=representation' });
    if (!insertRes.ok) {
      return { ok: false, skipped: 'insert_failed', status: insertRes.status, detail: insertRes.data };
    }
    const inserted = Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data;
    unifiedId  = inserted?.unified_id || null;
    existingRow = { unified_id: unifiedId, sf_contact_id: null, sf_account_id: null };
    wasInserted = true;
  }

  const result = {
    ok: true,
    unified_id: unifiedId,
    inserted: wasInserted,
    ...(wasInserted ? {} : { skipped_insert: 'already_existed' }),
  };

  // Salesforce Contact lookup — runs for both fresh inserts AND existing
  // rows that haven't been SF-linked yet. This is the backfill path for
  // brokers inserted before SF was configured.
  if (!isSalesforceConfigured()) {
    result.sf_linked = { reason: 'sf_not_configured' };
    return result;
  }
  if (existingRow?.sf_contact_id) {
    result.sf_linked = { reason: 'already_linked', sf_contact_id: existingRow.sf_contact_id };
    return result;
  }

  try {
    const sfRes = await findSalesforceContactByEmail(email);
    if (sfRes.ok && sfRes.contact?.Id) {
      const sfId = sfRes.contact.Id;
      const sfAccountId = sfRes.contact.AccountId || null;
      const patchUnified = await opsQuery('PATCH',
        `unified_contacts?unified_id=eq.${pgFilterVal(unifiedId)}`,
        {
          sf_contact_id: sfId,
          ...(sfAccountId ? { sf_account_id: sfAccountId } : {}),
          sf_last_synced: new Date().toISOString(),
        }
      );
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
        backfilled: !wasInserted,   // true when we linked a pre-existing row
      };
    } else {
      result.sf_linked = { reason: sfRes.reason || 'sf_contact_not_found' };
    }
  } catch (err) {
    result.sf_linked = { error: err?.message };
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
  // Normalize first — extractor may emit 'offering_memorandum',
  // 'offering memorandum', 'OFFERRING MEMORANDUM' (typo), etc. instead of
  // canonical 'om' (Bug Z, 2026-04-27).
  const rawDocType = snapshot?.document_type || null;
  let   docType    = normalizeDocType(rawDocType);

  // Round 76ej.d (2026-05-04): the caller (sidebar Stage Listing flow)
  // can declare doctype upfront via context.seedData.doctype. Honor it
  // when the AI didn't classify the artifact (CREXi synthetic text
  // bullet lists rarely look like an OM cover page to the AI). The
  // doctype must still pass normalization + the LISTING_DOCUMENT_TYPES
  // guard, so a malicious / unrecognised seed_data value can't sneak
  // a non-listing doc through.
  let inferredFromSeed = false;
  if (!LISTING_DOCUMENT_TYPES.has(docType)) {
    const seedDoc = normalizeDocType(context?.seedData?.doctype || null);
    if (LISTING_DOCUMENT_TYPES.has(seedDoc)) {
      docType = seedDoc;
      inferredFromSeed = true;
    }
  }

  // Fallback: when the extractor returned null/unknown but the snapshot
  // looks like a listing (asking price + tenant + cap rate / SF / term),
  // promote anyway and tag the doctype as 'om' inferred. This recovers
  // intakes whose AI classification step under-classified.
  let inferredFromSnapshot = false;
  if (!LISTING_DOCUMENT_TYPES.has(docType) && snapshotLooksLikeListing(snapshot)) {
    docType = 'om';
    inferredFromSnapshot = true;
  }

  if (!LISTING_DOCUMENT_TYPES.has(docType)) {
    return {
      ok: false,
      skipped: 'not_a_listing_doc',
      document_type: rawDocType,
      normalized_document_type: docType,
    };
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

      // Fallback 1: look up the external_identity for this entity if
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

      // Fallback 2 (2026-04-24 — Bug A fix): the Chrome sidebar writes
      // `source_system='costar'` on the external_identities row (not
      // `gov_db`/`dia_db`), so Fallback 1 misses every CoStar-scraped
      // entity. If we still don't have a domainProp but the entity
      // itself carries a domain + address (`entity.name` is typically
      // the street address for asset entities), look up the actual
      // domain property by normalized address.
      if (!domainProp && (domain === 'dialysis' || domain === 'government')) {
        const addrLike = String(ent.name || ent.metadata?.address || '').trim();
        const stateGuess = ent.metadata?.state || snapshot?.state || null;
        if (addrLike) {
          const addrEsc = encodeURIComponent(`*${addrLike.split(',')[0]}*`);
          const dq = domain === 'dialysis' ? 'dialysis' : 'government';
          let lookupPath = `properties?address=ilike.${addrEsc}&select=property_id,address,city,state&limit=5`;
          if (stateGuess) lookupPath += `&state=eq.${encodeURIComponent(stateGuess)}`;
          try {
            const domLookup = await domainQuery(dq, 'GET', lookupPath);
            if (domLookup.ok && Array.isArray(domLookup.data) && domLookup.data.length) {
              // Best match: prefer exact address equality (case-insensitive)
              const normalized = addrLike.toLowerCase().replace(/[.,]/g, '').trim();
              const hit = domLookup.data.find(p =>
                String(p.address || '').toLowerCase().replace(/[.,]/g, '').includes(normalized)
                || normalized.includes(String(p.address || '').toLowerCase().replace(/[.,]/g, ''))
              ) || domLookup.data[0];
              if (hit?.property_id) {
                domainProp = hit.property_id;
                console.log(`[intake-promoter] LCC-bridge resolved via address lookup: entity=${match.property_id} → ${dq} property_id=${hit.property_id}`);
              }
            }
          } catch (err) {
            console.warn('[intake-promoter] address-fallback lookup failed:', err?.message);
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

  // Run the first four domain-DB promotions in parallel; the prospect lead
  // upsert needs the listing_id that promoteListing returns, so it runs
  // after. promoteDiaLeaseFromOm only fires when domain is 'dialysis' (gov
  // has its own dedicated leases table managed elsewhere); when not
  // applicable it returns {ok:true, skipped:...} and is a no-op.
  const [listingResult, contactResult, financialsResult, leaseExpensesResult, diaLeaseResult] = await Promise.all([
    promoteListing(match.domain, intakeId, snapshot, match).catch(e => ({ ok: false, error: e?.message })),
    promoteBrokerContact(match.domain, snapshot, match).catch(e => ({ ok: false, error: e?.message })),
    promotePropertyFinancials(match.domain, match.property_id, snapshot).catch(e => ({ ok: false, error: e?.message })),
    promoteLeaseExpenses(match.domain, match.property_id, snapshot).catch(e => ({ ok: false, error: e?.message })),
    match.domain === 'dialysis'
      ? promoteDiaLeaseFromOm(match.property_id, snapshot).catch(e => ({ ok: false, error: e?.message }))
      : Promise.resolve({ ok: true, skipped: `dia_lease_only_for_dialysis` }),
  ]);

  // Bug J fix (2026-04-25): wire the freshly-created broker contact back
  // onto the listing as listing_broker_id. Important note on schema: the
  // dialysis `available_listings.listing_broker_id` is a BIGINT FK to the
  // `brokers` table (integer pk), NOT to `contacts` (uuid pk). The two
  // tables are linked via `brokers.contact_id`. So the chain is:
  //   1. promoteBrokerContact already created the contact (uuid)
  //   2. Find or upsert a `brokers` row by email, set its contact_id back
  //   3. PATCH listing.listing_broker_id with that integer broker_id
  // Without step 2, the listing FK stays null and CRM filters by broker
  // miss OM-promoted listings even though the contact exists.
  // Best-effort: failure is logged but doesn't block the rest of the
  // pipeline. Only runs for dialysis; gov has its own broker model.
  if (
    match.domain === 'dialysis' &&
    listingResult?.ok && listingResult.listing_id &&
    contactResult?.ok && contactResult.contact_id
  ) {
    const allContactIds = [contactResult.contact_id, ...(contactResult.additional_contact_ids || [])];
    const pairs = splitBrokerPairs(snapshot.listing_broker || '', snapshot.listing_broker_email || '');

    let primaryBrokerId = null;
    try {
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const linkedContactId = allContactIds[i] || null;
        if (!pair.email && !pair.name) continue;

        // Find existing brokers row by email (canonical) or normalized name.
        let brokerId = null;
        if (pair.email) {
          const found = await domainQuery(
            'dialysis',
            'GET',
            `brokers?email=ilike.${encodeURIComponent(pair.email)}&select=broker_id,contact_id&limit=1`
          );
          if (found.ok && Array.isArray(found.data) && found.data.length) {
            brokerId = found.data[0].broker_id;
            // Backfill contact_id link if the existing brokers row is missing it
            if (linkedContactId && !found.data[0].contact_id) {
              await domainQuery(
                'dialysis',
                'PATCH',
                `brokers?broker_id=eq.${brokerId}`,
                { contact_id: linkedContactId }
              ).catch(() => {});
            }
          }
        }
        // Insert a fresh brokers row when none was found.
        if (!brokerId) {
          const insRes = await domainQuery(
            'dialysis',
            'POST',
            'brokers',
            {
              broker_name:     pair.name || pair.email || 'Unknown Broker',
              email:           pair.email || null,
              company:         snapshot.listing_firm || null,
              contact_id:      linkedContactId,
              normalized_name: (pair.name || '').toLowerCase().trim() || null,
            },
            { Prefer: 'return=representation' }
          );
          if (insRes.ok) {
            const inserted = Array.isArray(insRes.data) ? insRes.data[0] : insRes.data;
            brokerId = inserted?.broker_id || null;
          }
        }
        if (i === 0) primaryBrokerId = brokerId;
      }

      if (primaryBrokerId) {
        await domainQuery(
          'dialysis',
          'PATCH',
          `available_listings?listing_id=eq.${encodeURIComponent(listingResult.listing_id)}`,
          { listing_broker_id: primaryBrokerId, broker_id: primaryBrokerId }
        );
      }
    } catch (err) {
      console.warn('[intake-promoter] dia broker FK chain failed (non-fatal):', err?.message);
    }
  }

  // ── Phase 2.1 (2026-04-25): record field-level provenance ─────────────
  // For every field this promoter just wrote from the OM, log a row to
  // public.field_provenance via lcc_merge_field. Source='om_extraction',
  // source_run_id=intakeId. Every priority entry is enforce_mode=record_only
  // today, so this is observation-only — actual UPDATEs above ran unchanged.
  // See docs/architecture/data_quality_self_learning_loop.md.
  try {
    const targetDb = match.domain === 'dialysis' ? 'dia_db' : 'gov_db';
    const tablePrefix = match.domain === 'dialysis' ? 'dia' : 'gov';
    const provCtx = {
      targetDatabase: targetDb,
      workspaceId:    context.workspaceId,
      actorId:        context.actorId,
      intakeId,
    };

    // 1. Listing fields — schema differs by domain. Dia uses
    //    initial_price / last_price / current_cap_rate / initial_cap_rate /
    //    price_per_sf; gov uses asking_price / asking_cap_rate /
    //    asking_price_psf. The actual INSERT row built by buildDiaListingRow
    //    vs buildGovListingRow already uses the right names; this provenance
    //    call has to mirror them or v_field_provenance_unranked surfaces
    //    writes against columns that don't exist on the target table.
    if (listingResult?.ok && listingResult.listing_id) {
      const capRateDecimal = snapshot.cap_rate != null ? snapshot.cap_rate / 100 : null;
      const askPpsf = (snapshot.asking_price && snapshot.building_sf)
        ? Math.round((snapshot.asking_price / snapshot.building_sf) * 100) / 100
        : (snapshot.price_per_sf ?? null);

      const listingValues = match.domain === 'government'
        ? {
            asking_price:     snapshot.asking_price ?? null,
            asking_cap_rate:  capRateDecimal,
            asking_price_psf: askPpsf,
            listing_broker:   snapshot.listing_broker || null,
            broker_email:     snapshot.listing_broker_email || null,
            listing_date:     snapshot.listing_date ?? null,
          }
        : {
            initial_price:    snapshot.asking_price ?? null,
            last_price:       snapshot.asking_price ?? null,
            current_cap_rate: capRateDecimal,
            initial_cap_rate: capRateDecimal,
            listing_broker:   snapshot.listing_broker || null,
            broker_email:     snapshot.listing_broker_email || null,
            price_per_sf:     snapshot.price_per_sf ?? null,
            seller_name:      snapshot.seller_name || null,
          };

      await recordOmFieldsProvenance(
        { ...provCtx, targetTable: `${tablePrefix}.available_listings`, recordPk: listingResult.listing_id },
        listingValues
      );
    }

    // 2. Broker contact fields. Schema differs by domain — dia.contacts uses
    //    contact_email / contact_name / contact_phone; gov.contacts uses
    //    email / name / phone. The actual INSERT row already branches on
    //    isGov; mirror that here or provenance lands against columns that
    //    don't exist on the target table.
    if (contactResult?.ok && contactResult.contact_id) {
      const contactValues = match.domain === 'government'
        ? {
            email:    snapshot.listing_broker_email || null,
            name:     snapshot.listing_broker || null,
            company:  snapshot.listing_firm || null,
            title:    'Listing Broker',
          }
        : {
            contact_email: snapshot.listing_broker_email || null,
            contact_name:  snapshot.listing_broker || null,
            company:       snapshot.listing_firm || null,
            title:         'Listing Broker',
            role:          'broker',
          };

      await recordOmFieldsProvenance(
        { ...provCtx, targetTable: `${tablePrefix}.contacts`, recordPk: contactResult.contact_id },
        contactValues
      );
    }

    // 3. Property fields backfilled from the OM (only when promoter actually patched them)
    // Phase 2.1 coverage gap follow-up (2026-04-29): promoteDiaPropertyFromOm
    // also patches `tenant` (Bug Z, 2026-04-27), `building_size` (Round 76bk,
    // 2026-04-28), `land_area` (dia column for acres), and refreshes
    // `anchor_rent_source` alongside anchor_rent. Without branches for those
    // fields here, the writes happened unaudited — field_provenance had zero
    // rows for source=om_extraction × those fields despite production traffic.
    const propPatched = financialsResult?.patched_fields || [];
    if (propPatched.length && match.property_id) {
      const propValues = {};
      for (const f of propPatched) {
        if (f === 'year_built')              propValues.year_built          = snapshot.year_built;
        else if (f === 'tenant')             propValues.tenant              = snapshot.tenant_name || snapshot.primary_tenant || null;
        else if (f === 'lot_sf')             propValues.lot_sf              = snapshot.lot_sf;
        else if (f === 'parcel_number')      propValues.parcel_number       = snapshot.parcel_number;
        else if (f === 'building_size')      propValues.building_size       = snapshot.building_sf;
        else if (f === 'land_area')          propValues.land_area           = snapshot.land_acres
                                                                            ?? (snapshot.lot_sf ? snapshot.lot_sf / 43560 : null);
        else if (f === 'lease_commencement') propValues.lease_commencement  = snapshot.lease_commencement;
        else if (f === 'anchor_rent')        propValues.anchor_rent         = snapshot.annual_rent;
        else if (f === 'anchor_rent_date')   propValues.anchor_rent_date    = snapshot.lease_commencement;
        else if (f === 'anchor_rent_source') propValues.anchor_rent_source  = 'om_confirmed';
        else if (f === 'noi')                propValues.noi                 = snapshot.noi;
        else if (f === 'gross_rent')         propValues.gross_rent          = snapshot.annual_rent;
        else if (f === 'land_acres')         propValues.land_acres          = snapshot.land_acres
                                                                            ?? (snapshot.lot_sf ? snapshot.lot_sf / 43560 : null);
        else if (f === 'rba')                propValues.rba                 = snapshot.building_sf;
      }
      await recordOmFieldsProvenance(
        { ...provCtx, targetTable: `${tablePrefix}.properties`, recordPk: match.property_id },
        propValues
      );
    }

    // 4. Lease fields (dialysis only — gov has a different lease lifecycle)
    if (match.domain === 'dialysis' && diaLeaseResult?.ok && diaLeaseResult.lease_id) {
      await recordOmFieldsProvenance(
        { targetDatabase: 'dia_db', targetTable: 'dia.leases', recordPk: diaLeaseResult.lease_id,
          intakeId, workspaceId: context.workspaceId, actorId: context.actorId },
        {
          tenant:                  snapshot.tenant_name || null,
          guarantor:               snapshot.tenant_guarantor || null,
          lease_start:             snapshot.lease_commencement || null,
          lease_expiration:        snapshot.lease_expiration || null,
          expense_structure:       snapshot.expense_structure || null,
          annual_rent:             snapshot.annual_rent ?? null,
          rent:                    snapshot.annual_rent ?? null,
          rent_per_sf:             snapshot.rent_per_sf ?? null,
          leased_area:             snapshot.building_sf ?? null,
          renewal_options:         snapshot.renewal_options || null,
          roof_responsibility:     snapshot.roof_responsibility || null,
          structure_responsibility:snapshot.structure_responsibility || null,
          hvac_responsibility:     snapshot.hvac_responsibility || null,
          parking_responsibility:  snapshot.parking_responsibility || null,
        }
      );
    }
  } catch (err) {
    // Provenance recording is non-fatal — keep the response shape stable
    // even if the merge function isn't deployed or LCC Opps is degraded.
    console.warn('[intake-promoter] field provenance recording failed (non-fatal):', err?.message);
  }

  // Persist the synthetic OM text into dia.property_documents
  // (Round 76ej.e, 2026-05-04 — moved out of the field-provenance try
  // block where a contacts-side error was skipping it). CREXi listings
  // stage as text/plain artifacts (the OM PDF lives behind an NDA
  // modal so we can't fetch it; the sidebar synthesizes a labelled
  // summary from the structured CREXi extraction). The text body lives
  // in staged_intake_artifacts.inline_data — promote it into
  // dia.property_documents so the property card has a browsable record
  // of what the AI saw. Only fires for dialysis (gov has a different
  // documents table) and only when the artifact is text/plain.
  if (
    match.domain === 'dialysis' &&
    match.property_id &&
    artifact &&
    typeof artifact.mime_type === 'string' &&
    artifact.mime_type.toLowerCase().startsWith('text/')
  ) {
    try {
      const artFull = await opsQuery(
        'GET',
        `staged_intake_artifacts?intake_id=eq.${pgFilterVal(intakeId)}` +
        `&select=inline_data,file_name,mime_type&order=created_at.asc&limit=1`
      );
      const artRow = artFull.ok && Array.isArray(artFull.data) && artFull.data.length
        ? artFull.data[0]
        : null;
      // inline_data is base64-encoded UTF-8 bytes (per intake-extractor's
      // text/* handling). Decode to text — capped at 80K to match the
      // extractor's text/plain ceiling.
      let rawText = null;
      if (artRow?.inline_data) {
        try {
          const decoded = Buffer.from(artRow.inline_data, 'base64').toString('utf8');
          rawText = decoded.length > 80_000 ? decoded.slice(0, 80_000) : decoded;
        } catch (decodeErr) {
          rawText = null;
        }
      }
      const docPayload = {
        property_id:      Number(match.property_id),
        file_name:        artRow?.file_name || artifact.file_name || `intake-${intakeId}.txt`,
        raw_text:         rawText,
        document_type:    docType || 'om',
        source_url:       snapshot.source_url || snapshot.listing_url || null,
        ingestion_status: 'extracted',
        extracted_data:   {
          intake_id:        intakeId,
          doctype_inferred: inferredFromSeed || inferredFromSnapshot || false,
          address:          snapshot.address || null,
          tenant_name:      snapshot.tenant_name || null,
          asking_price:     snapshot.asking_price ?? null,
          cap_rate:         snapshot.cap_rate ?? null,
          lease_expiration: snapshot.lease_expiration || null,
        },
      };
      await domainQuery(
        'dialysis',
        'POST',
        'property_documents',
        docPayload,
        { Prefer: 'return=minimal' }
      );
    } catch (err) {
      console.warn('[intake-promoter] property_documents persist failed (non-fatal):', err?.message);
    }
  }

  // Pipeline lead — runs after the listing is written so we can stamp the
  // lead row with source_listing_id. Ensures OM-promoted deals show up on
  // the Pipeline tab, not just Sales/Available.
  const pipelineLeadResult = await promoteProspectLead(
    match.domain, match.property_id, snapshot, match, listingResult?.listing_id || null
  ).catch(e => ({ ok: false, error: e?.message }));

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

  // --- Post-promotion: refresh the gov Sales/Available materialized view ---
  // so the dashboard immediately reflects the new listing + property
  // enrichment (year_built, land_acres, expenses, OM path, DOM fallback).
  // Uses the same PostgREST RPC plumbing as the domain writes. Failure
  // here is non-fatal — the next scheduled refresh (pg_cron) would catch
  // up anyway, but shipping the freshness interactively keeps the UX
  // snappy for the broker who just ingested the OM.
  let matRefreshResult = { ok: true, skipped: 'not_gov' };
  if (match.domain === 'government') {
    try {
      const refreshRes = await domainQuery(
        'government',
        'POST',
        'rpc/lcc_refresh_available_listings',
        {}
      );
      matRefreshResult = refreshRes.ok
        ? { ok: true }
        : { ok: false, status: refreshRes.status, detail: refreshRes.data };
    } catch (err) {
      matRefreshResult = { ok: false, error: err?.message };
    }
  }

  const result = {
    ok:                    listingResult.ok,
    domain:                match.domain,
    match:                 { property_id: match.property_id, reason: match.reason, lcc_entity_id: match.lcc_entity_id || null },
    snapshot:              { address: snapshot?.address, city: snapshot?.city, state: snapshot?.state,
                             tenant_agency: snapshot?.tenant_agency || snapshot?.tenant_name,
                             listing_broker: snapshot?.listing_broker, asking_price: snapshot?.asking_price },
    listing:               listingResult,
    broker_contact:        contactResult,
    property_financials:   financialsResult,
    lease_expenses:        leaseExpensesResult,
    dia_lease:             diaLeaseResult,
    pipeline_lead:         pipelineLeadResult,
    lcc_entity:            lccEntityResult,
    unified_contact:       unifiedContactResult,
    owner_resolution:      ownerResolutionResult,
    merge_check:           mergeCheckResult,
    activity_event:        activityEventResult,
    mat_view_refresh:      matRefreshResult,
  };

  // --- Promotion log (Bug D fix, 2026-04-24) -------------------------
  // Write one row per successful promotion to staged_intake_promotions.
  // Previously this was missing entirely — the daily briefing's "New OM
  // Intakes" section (fetchNewIntakes queries this table) silently returned
  // empty forever. The inserted row carries the full pipeline_result blob
  // so the briefing / audit queries can unpack without re-joining.
  // Best-effort: a failure here never breaks the caller's response.
  if (listingResult.ok) {
    try {
      await opsQuery('POST',
        'staged_intake_promotions',
        {
          workspace_id:  context.workspaceId,
          intake_id:     intakeId,
          entity_id:     lccEntityResult?.entity_id || null,
          promoted_by:   context.actorId || null,
          pipeline_result: result,
          promoted_at:   new Date().toISOString(),
        },
        { 'Prefer': 'return=minimal' }
      );
    } catch (err) {
      console.warn('[intake-promoter] staged_intake_promotions insert failed (non-fatal):', err?.message);
    }

    // Flip staged_intake_items.status to 'finalized' so the review queue
    // UI stops showing promoted intakes as needing review. Before this,
    // the whole pipeline ran to completion — listings written, owner
    // linked, broker contact created, activity event logged — but the
    // top-level status never moved off 'review_required', leaving stale
    // badges in the dashboard's triage views. Best-effort: failure here
    // doesn't break the caller's response shape.
    try {
      await opsQuery('PATCH',
        `staged_intake_items?intake_id=eq.${encodeURIComponent(intakeId)}`,
        { status: 'finalized', updated_at: new Date().toISOString() },
        { 'Prefer': 'return=minimal' }
      );
    } catch (err) {
      console.warn('[intake-promoter] status flip to finalized failed (non-fatal):', err?.message);
    }
  }

  return result;
}
