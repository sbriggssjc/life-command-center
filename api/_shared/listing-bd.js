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
import { generateDraft, recordTemplateSend } from './templates.js';

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

// ============================================================================
// W3.5 — LISTING-BD CONSUMER (audit 3.4.2)
//
// The producer above fanned ~1,080 runs/14d of matched-contact inbox_items out
// to the operator, while the T-011/T-012 templates it feeds had 0 sends in 120
// days: a pure producer with no consumer. This section is the named consumer.
// Given a set of listing_bd_trigger inbox items the operator selected in the
// grouped Inbox view, it:
//   1. Dedupes by contact across a 7-day window — a contact matched by three
//      listings in a week gets ONE draft covering all three, not three drafts.
//   2. Renders the contact's template into a draft.
//   3. Records a template_sends row (replied=null — "not yet observed") so
//      W1.2's reply loop (recordTemplateResponse) measures THIS channel from day
//      one; a reply flips replied=true + emits the template_response signal.
//   4. Marks the drained inbox items 'triaged' (reversible; never hard-deleted),
//      with a metadata tag so the honest inbox count stops showing worked items.
// Consumption-Layer doctrine: honest counts (one send per drafted contact, not
// one per matched row), reversible, idempotent.
// ============================================================================

const LISTING_BD_TRIGGER = 'listing_bd_trigger';

/**
 * Best-effort epoch (ms) for a listing_bd inbox item, preferring the producer's
 * generated_at stamp, then received_at/created_at. Undated items sort as "now"
 * so a selection with no timestamps still groups into one window.
 */
function _itemEpoch(item) {
  const raw = item?.metadata?.generated_at || item?.received_at || item?.created_at;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : Date.now();
}

/**
 * The listing identity for a listing_bd inbox item (its metadata.listing_entity_id).
 */
function _listingKey(item) {
  return item?.metadata?.listing_entity_id || null;
}

/**
 * The contact identity for a listing_bd inbox item. Prefer the entity_id (the
 * matched owner/contact); fall back to a normalized contact_email so two items
 * for the same person without an entity id still collapse.
 */
function _contactKey(item) {
  if (item?.entity_id) return `ent:${item.entity_id}`;
  const email = item?.metadata?.contact_email;
  if (email) return `email:${String(email).trim().toLowerCase()}`;
  return null;
}

/**
 * Cross-listing dedupe (Part 3). Groups listing_bd inbox items by contact, then
 * splits each contact's items into windows of `windowDays` (default 7): all
 * items within `windowDays` of the group's most-recent item become ONE draft
 * covering every distinct listing; items older than the window start a new
 * group. Pure — no I/O — so it is directly unit-testable.
 *
 * @param {object[]} items - listing_bd_trigger inbox items (with metadata)
 * @param {object} [opts]
 * @param {number} [opts.windowDays=7]
 * @returns {Array<{contactKey, contactId, contactName, contactEmail, domain,
 *   templateId, matchReason, items, listings}>}
 */
export function dedupeListingBdItemsByContact(items, opts = {}) {
  const windowMs = (opts.windowDays ?? 7) * 24 * 60 * 60 * 1000;

  // Bucket by contact
  const byContact = new Map();
  for (const item of (items || [])) {
    if (!item || item.source_type !== LISTING_BD_TRIGGER) continue;
    const ck = _contactKey(item);
    if (!ck) continue; // no contact identity → cannot draft, skip
    if (!byContact.has(ck)) byContact.set(ck, []);
    byContact.get(ck).push(item);
  }

  const groups = [];
  for (const [contactKey, contactItems] of byContact.entries()) {
    // Most-recent first so the window anchors on the freshest match.
    contactItems.sort((a, b) => _itemEpoch(b) - _itemEpoch(a));

    let bucket = [];
    let anchor = null;
    const flush = () => {
      if (!bucket.length) return;
      groups.push(_buildContactGroup(contactKey, bucket));
      bucket = [];
    };
    for (const item of contactItems) {
      const t = _itemEpoch(item);
      if (anchor === null || (anchor - t) <= windowMs) {
        if (anchor === null) anchor = t;
        bucket.push(item);
      } else {
        flush();
        anchor = t;
        bucket.push(item);
      }
    }
    flush();
  }
  return groups;
}

function _buildContactGroup(contactKey, bucket) {
  const first = bucket[0];
  const m0 = first.metadata || {};
  // Distinct listings for this contact within the window.
  const seenListing = new Set();
  const listings = [];
  for (const it of bucket) {
    const lk = _listingKey(it) || it.id;
    if (seenListing.has(lk)) continue;
    seenListing.add(lk);
    const m = it.metadata || {};
    listings.push({
      listing_entity_id: m.listing_entity_id || null,
      name: m.listing_name || null,
      city: m.listing_city || null,
      state: m.listing_state || null,
      city_state: [m.listing_city, m.listing_state].filter(Boolean).join(', ') || (m.listing_state || null),
      asset_type: m.listing_asset_type || null
    });
  }
  return {
    contactKey,
    contactId: first.entity_id || null,
    contactName: m0.contact_name || first.entity_name || null,
    contactEmail: m0.contact_email || null,
    domain: m0.domain || first.domain || null,
    // T-011 (same asset) is a stronger hook than T-012 (proximity); if a contact
    // matched both, lead with T-011.
    templateId: bucket.some(b => (b.metadata || {}).template_id === 'T-011') ? 'T-011' : (m0.template_id || 'T-012'),
    matchReason: m0.match_reason || null,
    items: bucket,
    listings
  };
}

/**
 * Build a template-render context for a deduped contact group. Best-effort: the
 * caller renders with strict:false so a variable the producer never captured
 * (e.g. listing.cap_rate) renders blank rather than blocking the draft.
 * `listingEntity` (optional) is the fetched listing entity whose metadata
 * enriches the primary listing (cap rate, asking price, summary).
 */
export function buildListingBdContext(group, listingEntity = null) {
  const primary = group.listings[0] || {};
  const lm = (listingEntity && listingEntity.metadata) || {};
  const fullName = group.contactName || '';
  const firstName = String(fullName).trim().split(/\s+/)[0] || fullName || null;
  const fmtPrice = (v) => (v == null || v === '' ? null
    : (typeof v === 'number' ? `$${v.toLocaleString('en-US')}` : String(v)));
  // The T-011/T-012 templates append a literal '%' after {{listing.cap_rate}},
  // so this returns the BARE percentage number (no '%') to avoid '7.08%%'.
  // 0.0708 → '7.08'; 7.08 → '7.08'; '7.08%' → '7.08'.
  const fmtCap = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'string') {
      const s = v.trim().replace(/%\s*$/, '');
      const n = Number(s);
      return Number.isFinite(n) ? String(n) : (s || null);
    }
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n < 1 ? String(Number((n * 100).toFixed(2))) : String(n);
  };

  // Humanize the domain for prose ("dia-leased" → "dialysis-leased"). The
  // canonical short form stays on context.domain / the send row.
  const domLabel = ({ dia: 'dialysis', gov: 'government' })[group.domain] || group.domain || null;

  const context = {
    domain: group.domain || null,
    contact: {
      full_name: fullName || null,
      first_name: firstName,
      firm: fullName || null,
      geography: primary.city_state || primary.state || null,
      email: group.contactEmail || null
    },
    property: {
      // "you own a <asset> in <state>" — the reason we reached out.
      tenant: primary.asset_type || domLabel || null,
      city_state: primary.city_state || primary.state || null,
      domain: domLabel
    },
    listing: {
      tenant: primary.asset_type || lm.tenant_name || lm.building_name || primary.name || 'our new listing',
      name: primary.name || lm.building_name || null,
      city_state: primary.city_state || primary.state || null,
      domain: domLabel,
      cap_rate: fmtCap(lm.cap_rate),
      list_price: fmtPrice(lm.asking_price ?? lm.list_price),
      property_summary: lm.property_summary || lm._pipeline_summary || null
    }
  };

  // Cross-listing: enumerate the OTHER listings this contact matched so the
  // draft can reference "and two others" honestly.
  if (group.listings.length > 1) {
    context.listing.additional_listings = group.listings.slice(1).map(l => ({
      name: l.name, city_state: l.city_state
    }));
    context.listing.additional_count = group.listings.length - 1;
  }
  return context;
}

/**
 * Run the listing-BD draft consumer over a set of selected inbox items.
 *
 * @param {object} params
 * @param {object[]} params.inboxItems - the selected listing_bd_trigger rows
 * @param {string}  params.workspaceId
 * @param {string}  [params.userId]
 * @param {number}  [params.windowDays=7]
 * @param {boolean} [params.strict=false] - fail a draft on missing mandatory vars
 * @returns {Promise<{ok, drafted, sends_recorded, items_triaged, skipped, drafts}>}
 */
export async function runListingBdDraftConsumer(params) {
  const {
    inboxItems = [], workspaceId, userId = null,
    windowDays = 7, strict = false
  } = params || {};

  const valid = (inboxItems || []).filter(i => i && i.source_type === LISTING_BD_TRIGGER);
  const groups = dedupeListingBdItemsByContact(valid, { windowDays });

  // Prefetch distinct listing entities once (enrich the drafts) — best-effort.
  const listingIds = [...new Set(groups.map(g => g.listings[0]?.listing_entity_id).filter(Boolean))];
  const listingById = new Map();
  if (listingIds.length) {
    try {
      const idList = listingIds.map(pgFilterVal).join(',');
      const r = await opsQuery('GET',
        `entities?id=in.(${idList})&workspace_id=eq.${pgFilterVal(workspaceId)}&select=id,name,metadata`,
        undefined, { countMode: 'none' }
      );
      if (r.ok) for (const e of (r.data || [])) listingById.set(e.id, e);
    } catch (err) {
      console.warn('[listing_bd consumer] listing prefetch failed (non-blocking):', err?.message || err);
    }
  }

  const drafts = [];
  let sendsRecorded = 0;
  let itemsTriaged = 0;
  const skipped = [];

  for (const group of groups) {
    const listingEntity = listingById.get(group.listings[0]?.listing_entity_id) || null;
    const context = buildListingBdContext(group, listingEntity);

    let draftResult;
    try {
      draftResult = await generateDraft(group.templateId, context, { strict });
    } catch (err) {
      draftResult = { ok: false, error: err?.message || String(err) };
    }
    if (!draftResult.ok) {
      skipped.push({ contactKey: group.contactKey, reason: draftResult.error || 'draft_failed',
        missing: draftResult.missing || null });
      continue;
    }

    // Record ONE send per drafted contact (honest count). replied=null via
    // recordTemplateSend's open-outcome semantics; entity_id + contact_id set to
    // the matched owner so W1.2's reply loop can attribute a reply back.
    let sendId = null;
    try {
      const rec = await recordTemplateSend({
        template_id: group.templateId,
        template_version: draftResult.draft?.template_version || 1,
        user_id: userId,
        entity_id: group.contactId,
        contact_id: group.contactId,
        entity_type: 'contact',
        domain: group.domain
      });
      if (rec.ok) { sendsRecorded++; sendId = rec.send?.id || null; }
    } catch (err) {
      console.warn('[listing_bd consumer] recordTemplateSend failed (non-blocking):', err?.message || err);
    }

    // Drain the inbox items for this group → triaged (reversible tag).
    const nowIso = new Date().toISOString();
    for (const item of group.items) {
      try {
        const meta = { ...(item.metadata || {}),
          listing_bd_drafted: true,
          listing_bd_drafted_at: nowIso,
          listing_bd_send_id: sendId,
          listing_bd_covered_listings: group.listings.length
        };
        const patch = await opsQuery('PATCH',
          `inbox_items?id=eq.${pgFilterVal(item.id)}&workspace_id=eq.${pgFilterVal(workspaceId)}`,
          { status: 'triaged', triaged_at: nowIso, metadata: meta, updated_at: nowIso }
        );
        if (patch.ok) itemsTriaged++;
      } catch (err) {
        console.warn('[listing_bd consumer] inbox triage failed (non-blocking):', err?.message || err);
      }
    }

    drafts.push({
      contact_id: group.contactId,
      contact_name: group.contactName,
      contact_email: group.contactEmail,
      domain: group.domain,
      template_id: group.templateId,
      covered_listings: group.listings.length,
      listings: group.listings.map(l => l.name || l.city_state).filter(Boolean),
      send_id: sendId,
      subject: draftResult.draft?.subject || '',
      body: draftResult.draft?.body || '',
      unresolved_variables: draftResult.draft?.unresolved_variables || []
    });
  }

  return {
    ok: true,
    selected: valid.length,
    deduped_contacts: groups.length,
    drafted: drafts.length,
    sends_recorded: sendsRecorded,
    items_triaged: itemsTriaged,
    skipped,
    drafts
  };
}
