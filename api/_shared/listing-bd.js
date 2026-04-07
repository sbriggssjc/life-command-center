// ============================================================================
// Listing-as-BD Trigger — Automated business development from active listings
// Life Command Center — Wave 2: Signal-driven outreach
//
// When a new listing is created or activated, this module identifies two
// pools of contacts who should receive personalized outreach:
//
//   T-011: Same Asset Type / Same State
//     "We just listed a dialysis clinic in Oklahoma — you own one too."
//     Finds owners in the domain DB whose asset type + state match the listing.
//
//   T-012: Geographic Proximity (Owner Near Listing)
//     "There's a new listing near your location in Tulsa."
//     Finds known owners whose personal/business address is in the same state
//     as the listing, regardless of where their property is.
//
// Both pools are queued as batch draft candidates in the inbox_items table
// with source_type='listing_bd_trigger' for Scott's review before sending.
//
// This module is called:
//   1. By a signal listener when entity_type='listing' is created/activated
//   2. Directly via POST /api/operations?_route=draft&action=listing_bd
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';
import { writeSignal } from './signals.js';

// ============================================================================
// CONTACT MATCHING — Same Asset Type / Same State (T-011)
// ============================================================================

/**
 * Find contacts who own the same asset type in the same state as a listing.
 * Queries the entity-hub for contacts/orgs with matching domain + state + asset_type.
 *
 * @param {object} listing - The listing entity with at minimum: domain, state, asset_type
 * @param {string} workspaceId
 * @param {object} [options]
 * @param {number} [options.limit=50] - Max contacts to return
 * @param {string[]} [options.excludeEntityIds] - Entity IDs to exclude (e.g., the seller)
 * @returns {Promise<object[]>} Matching contact entities
 */
export async function findSameAssetTypeContacts(listing, workspaceId, options = {}) {
  const { limit = 50, excludeEntityIds = [] } = options;

  if (!listing.state || !listing.domain) return [];

  // Query entities that are contacts or orgs in the same domain + state
  // who have metadata indicating they own the same asset type
  let path = `entities?workspace_id=eq.${pgFilterVal(workspaceId)}`;
  path += `&entity_type=in.(contact,organization)`;
  path += `&domain=eq.${pgFilterVal(listing.domain)}`;
  path += `&state=eq.${pgFilterVal(listing.state)}`;
  path += `&select=id,name,entity_type,domain,state,city,email,metadata`;
  path += `&order=name.asc`;
  path += `&limit=${limit}`;

  // Exclude the listing's own entity and any specified exclusions
  if (excludeEntityIds.length > 0) {
    path += `&id=not.in.(${excludeEntityIds.map(pgFilterVal).join(',')})`;
  }

  const result = await opsQuery('GET', path);
  if (!result.ok) return [];

  return (result.data || []).filter(c => {
    // Additional filter: check metadata for asset_type match if available
    // If no asset_type metadata, include them (they're in the same domain/state)
    if (!listing.asset_type) return true;
    const ownerAssetType = c.metadata?.asset_type || c.metadata?.property_type;
    if (!ownerAssetType) return true; // Include if we don't know — Scott can filter
    return ownerAssetType.toLowerCase().includes(listing.asset_type.toLowerCase());
  });
}

// ============================================================================
// CONTACT MATCHING — Geographic Proximity / Owner Near Listing (T-012)
// ============================================================================

/**
 * Find contacts whose personal or business address is in the same state
 * as the listing, regardless of where their owned property is.
 *
 * This is the "owner is local to the listing" use case — e.g., a dialysis
 * owner based in Oklahoma should hear about our new Oklahoma listing even
 * if their clinic is in Texas.
 *
 * @param {object} listing - The listing entity with at minimum: state, domain
 * @param {string} workspaceId
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @param {string[]} [options.excludeEntityIds] - Entity IDs to exclude
 * @param {string[]} [options.excludeFromT011] - Already matched by T-011 (avoid dupes)
 * @returns {Promise<object[]>} Matching contact entities
 */
export async function findGeographicProximityContacts(listing, workspaceId, options = {}) {
  const { limit = 50, excludeEntityIds = [], excludeFromT011 = [] } = options;

  if (!listing.state) return [];

  // Query contacts/orgs whose mailing_state or metadata.address_state matches
  // the listing state, but who are NOT necessarily in the same domain
  let path = `entities?workspace_id=eq.${pgFilterVal(workspaceId)}`;
  path += `&entity_type=in.(contact,organization)`;
  path += `&select=id,name,entity_type,domain,state,city,email,metadata`;
  path += `&order=name.asc`;
  path += `&limit=${limit}`;

  // We need contacts whose OWN location (not their property) is in the listing state
  // The 'state' field on the entity may represent their property state, so we also
  // check metadata.mailing_state and metadata.address_state
  // For now, use the state field as best-available proxy
  path += `&state=eq.${pgFilterVal(listing.state)}`;

  // Exclude: seller, already-matched T-011, and any specified exclusions
  const allExclusions = [...new Set([...excludeEntityIds, ...excludeFromT011])];
  if (allExclusions.length > 0) {
    path += `&id=not.in.(${allExclusions.map(pgFilterVal).join(',')})`;
  }

  const result = await opsQuery('GET', path);
  if (!result.ok) return [];

  // Filter to contacts that are in the same domain (or have no domain set)
  // This prevents sending dialysis listing emails to government contacts
  return (result.data || []).filter(c => {
    if (!listing.domain) return true;
    if (!c.domain) return true; // Include unknowns — Scott can filter
    return c.domain === listing.domain;
  });
}

// ============================================================================
// DRAFT QUEUE BUILDER — Creates inbox items for batch review
// ============================================================================

/**
 * Queue listing-BD draft candidates as inbox items for review.
 * Each matched contact becomes an inbox item with:
 *   - source_type: 'listing_bd_trigger'
 *   - metadata containing listing context + template_id + contact match reason
 *   - status: 'new' (awaiting Scott's review before batch generation)
 *
 * @param {object} params
 * @param {object} params.listing - The listing entity
 * @param {object[]} params.contacts - Matched contacts
 * @param {string} params.templateId - 'T-011' or 'T-012'
 * @param {string} params.matchReason - 'same_asset_type_state' or 'geographic_proximity'
 * @param {string} params.workspaceId
 * @param {string} params.userId - The user who triggered (or system)
 * @param {string} params.domain
 * @returns {Promise<{ queued: number, items: object[] }>}
 */
export async function queueListingBdDrafts({
  listing, contacts, templateId, matchReason,
  workspaceId, userId, domain
}) {
  const items = [];
  const now = new Date().toISOString();

  for (const contact of contacts) {
    const inboxItem = {
      workspace_id: workspaceId,
      title: `[Listing BD] ${templateId === 'T-011' ? 'Same Asset' : 'Near Listing'}: ${contact.name} ← ${listing.name || listing.address || 'New Listing'}`,
      body: buildDraftPreview(listing, contact, templateId, matchReason),
      status: 'new',
      priority: 'normal',
      source_type: 'listing_bd_trigger',
      entity_id: contact.id,
      domain: domain || listing.domain || null,
      metadata: {
        template_id: templateId,
        match_reason: matchReason,
        listing_entity_id: listing.id,
        listing_name: listing.name || listing.address || null,
        listing_state: listing.state || null,
        listing_city: listing.city || null,
        listing_asset_type: listing.asset_type || listing.metadata?.asset_type || null,
        contact_name: contact.name,
        contact_state: contact.state || null,
        contact_city: contact.city || null,
        contact_email: contact.email || contact.metadata?.email || null,
        auto_generated: true,
        generated_at: now
      },
      created_at: now,
      updated_at: now
    };

    const result = await opsQuery('POST', 'inbox_items', inboxItem);
    if (result.ok) {
      items.push(Array.isArray(result.data) ? result.data[0] : result.data);
    }
  }

  // Fire signal for the learning loop
  writeSignal({
    signal_type: 'listing_bd_trigger',
    signal_category: 'prospecting',
    entity_type: 'listing',
    entity_id: listing.id || null,
    domain: domain || listing.domain || null,
    user_id: userId || null,
    payload: {
      template_id: templateId,
      match_reason: matchReason,
      listing_state: listing.state || null,
      contacts_matched: contacts.length,
      contacts_queued: items.length,
      listing_name: listing.name || listing.address || null
    },
    outcome: 'pending'
  });

  return { queued: items.length, items };
}

// ============================================================================
// FULL LISTING-BD PIPELINE
// ============================================================================

/**
 * Run the full listing-as-BD pipeline for a given listing entity.
 * This is the main entry point — called by signal listeners or the
 * draft API route.
 *
 * Steps:
 *   1. Find T-011 matches (same asset type / same state)
 *   2. Find T-012 matches (geographic proximity, excluding T-011 dupes)
 *   3. Queue both pools as inbox items for review
 *   4. Return summary for the caller
 *
 * @param {object} listing - The listing entity (must have: id, domain, state)
 * @param {string} workspaceId
 * @param {string} userId
 * @param {object} [options]
 * @param {string[]} [options.excludeEntityIds] - Entities to exclude (e.g., the seller)
 * @param {number} [options.limit] - Max contacts per pool
 * @returns {Promise<object>} Summary of queued drafts
 */
export async function runListingBdPipeline(listing, workspaceId, userId, options = {}) {
  const { excludeEntityIds = [], limit = 50, triggerSource = 'manual', sfDealId = null } = options;

  // Step 1: T-011 — same asset type, same state
  const t011Contacts = await findSameAssetTypeContacts(listing, workspaceId, {
    limit,
    excludeEntityIds
  });

  const t011Result = await queueListingBdDrafts({
    listing,
    contacts: t011Contacts,
    templateId: 'T-011',
    matchReason: 'same_asset_type_state',
    workspaceId,
    userId,
    domain: listing.domain
  });

  // Step 2: T-012 — geographic proximity (exclude T-011 matches to avoid dupes)
  const t011Ids = t011Contacts.map(c => c.id);
  const t012Contacts = await findGeographicProximityContacts(listing, workspaceId, {
    limit,
    excludeEntityIds,
    excludeFromT011: t011Ids
  });

  const t012Result = await queueListingBdDrafts({
    listing,
    contacts: t012Contacts,
    templateId: 'T-012',
    matchReason: 'geographic_proximity',
    workspaceId,
    userId,
    domain: listing.domain
  });

  const summary = {
    listing_id: listing.id,
    listing_name: listing.name || listing.address || null,
    t011_same_asset: {
      matched: t011Contacts.length,
      queued: t011Result.queued,
      template: 'T-011'
    },
    t012_geographic: {
      matched: t012Contacts.length,
      queued: t012Result.queued,
      template: 'T-012'
    },
    total_queued: t011Result.queued + t012Result.queued
  };

  // Step 3: Write tracking row to listing_bd_runs (fire-and-forget)
  try {
    await opsQuery('POST', 'listing_bd_runs', {
      workspace_id: workspaceId,
      listing_entity_id: listing.id || null,
      listing_name: listing.name || listing.address || null,
      listing_state: listing.state || null,
      listing_city: listing.city || null,
      listing_domain: listing.domain || null,
      asset_type: listing.asset_type || listing.metadata?.asset_type || null,
      sf_deal_id: sfDealId || listing.metadata?.deal_id || null,
      deal_status: listing.metadata?.deal_status || 'ELA Executed',
      t011_matched: t011Contacts.length,
      t011_queued: t011Result.queued,
      t012_matched: t012Contacts.length,
      t012_queued: t012Result.queued,
      total_queued: summary.total_queued,
      trigger_source: triggerSource,
      triggered_by: userId || null
    });
  } catch (err) {
    // Tracking row is non-critical — never block the pipeline
    console.error('[listing_bd_runs write failed]', err?.message || err);
  }

  return summary;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a human-readable preview of the draft for the inbox item body.
 * This gives Scott a quick sense of why this contact was matched
 * before he triggers batch generation.
 */
function buildDraftPreview(listing, contact, templateId, matchReason) {
  const lines = [];

  if (templateId === 'T-011') {
    lines.push(`MATCH: Same ${listing.domain || 'asset'} type in ${listing.state}`);
    lines.push(`LISTING: ${listing.name || listing.address || 'New listing'} — ${listing.city || ''}, ${listing.state || ''}`);
    lines.push(`CONTACT: ${contact.name} — ${contact.city || ''}, ${contact.state || ''}`);
    lines.push(`TEMPLATE: T-011 (Same Asset Type / Same State)`);
    lines.push('');
    lines.push(`This owner has a ${listing.domain || ''} property in the same state as our new listing. Template will profile the listing and offer a complimentary BOV + capital markets update.`);
  } else {
    lines.push(`MATCH: Owner located near listing in ${listing.state}`);
    lines.push(`LISTING: ${listing.name || listing.address || 'New listing'} — ${listing.city || ''}, ${listing.state || ''}`);
    lines.push(`CONTACT: ${contact.name} — ${contact.city || ''}, ${contact.state || ''}`);
    lines.push(`TEMPLATE: T-012 (Geographic Proximity)`);
    lines.push('');
    lines.push(`This owner is based near our listing location. Template will reference their proximity and offer a complimentary BOV + market intelligence.`);
  }

  return lines.join('\n');
}
