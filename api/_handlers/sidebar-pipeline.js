// ============================================================================
// Sidebar Data Pipeline — Unpacks CRE metadata from browser extension captures
// Life Command Center
//
// When the LCC browser extension saves a property from CoStar/LoopNet/CREXi,
// it stores rich metadata JSONB on the entity. This pipeline unpacks that
// metadata into proper relational records:
//
//   1. Contacts  → person/org entities + entity_relationships
//   2. Sales     → activity_events + buyer/seller/lender entities
//   3. Signals   → learning-loop signal
//   4. Domain    → classification (government/dialysis/null) + cross-domain sync
//
// Invocation:
//   - Fire-and-forget after entity creation (entities-handler.js)
//   - On-demand via POST /api/entities?action=process_sidebar_extraction
// ============================================================================

import { ensureEntityLink, normalizeCanonicalName, normalizeAddress } from '../_shared/entity-link.js';
import { opsQuery } from '../_shared/ops-db.js';
import { writeSignal } from '../_shared/signals.js';
import { domainQuery, getDomainCredentials } from '../_shared/domain-db.js';

// ── Role → relationship_type mapping ────────────────────────────────────────

const ROLE_TO_RELATIONSHIP = {
  owner: 'owns',
  seller: 'sells',
  buyer: 'purchases',
  listing_broker: 'brokers',
  buyer_broker: 'brokers',
  lender: 'finances',
  true_buyer: 'purchases',
  true_seller: 'sells',
  true_buyer_contact: 'associated_with',
  true_seller_contact: 'associated_with',
};

// ── Domain classification keywords ──────────────────────────────────────────

const GOV_TENANT_KEYWORDS = [
  'gsa', 'general services administration', 'veterans affairs', 'va ',
  'social security', 'ssa', 'irs', 'internal revenue', 'fbi', 'dea',
  'ice', 'uscis', 'fema', 'usda', 'hud', 'department of', 'bureau of',
  'federal', 'state of', 'county of', 'city of', 'usps', 'postal service',
  'army corps', 'coast guard', 'customs', 'cbp', 'tsa',
];

const DIALYSIS_TENANT_KEYWORDS = [
  'fresenius', 'fmc', 'davita', 'dialysis', 'dci ', 'dialysis clinic',
  'us renal care', 'american renal', 'greenfield renal', 'innovative renal',
  'satellite healthcare', 'satellite dialysis',
  'northwest kidney', 'kidney center', 'renal', 'nephrology',
];

// ── Mortgage / refinance deed types ─────────────────────────────────────────
// These deed types are financial instruments recorded against the property
// (liens, refinances, releases) and do NOT represent ownership transfers.
// They must be skipped when building sales_transactions and ownership_history.
const MORTGAGE_DEED_TYPES = /^(mortgage|deed\s+of\s+trust|assignment\s+of|subordination|satisfaction|release|reconveyance|lien|easement)/i;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a display-format date string into an ISO timestamp.
 * Handles "Mar 27, 2026", "2/28/2019", "2019-03-27", etc.
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Parse a display-format currency string to a numeric value.
 * "$3,390,952" → 3390952,  "Not Disclosed" → null
 */
function parseCurrency(val) {
  if (!val || typeof val !== 'string') return null;
  const cleaned = val.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/** Parse SF string: "8,750 SF" → 8750 */
function parseSF(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/,/g, '').replace(/\s*SF\s*/gi, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/** Parse percentage string: "6.76%" → 6.76, "100%" → 100 */
function parsePercent(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[%\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/** Parse acres string: "0.54 AC" → 0.54 */
function parseAcres(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/,/g, '').replace(/\s*AC\s*/gi, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/** Parse parking ratio: "2.28/1,000 SF" → 2.28 */
function parseParkingRatio(val) {
  if (val == null) return null;
  const match = String(val).match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : null;
}

/** Safely parse integer: "2019" → 2019, "1" → 1 */
function parseIntSafe(val) {
  if (val == null) return null;
  const num = parseInt(String(val), 10);
  return isNaN(num) ? null : num;
}

/** Strip null/undefined values from an object (for PATCH — avoids overwriting with null) */
function stripNulls(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) result[k] = v;
  }
  return result;
}

/**
 * Wrapper around domainQuery for PATCH calls that surfaces silent failures
 * (column mismatches, CHECK constraint violations, etc.) in Vercel logs.
 * Previously, PATCH failures were swallowed — this forced schema issues to
 * only be discovered during audits. Always use this instead of calling
 * domainQuery(..., 'PATCH', ...) directly within this pipeline.
 */
async function domainPatch(domain, path, data, label) {
  const result = await domainQuery(domain, 'PATCH', path, data);
  if (!result.ok) {
    console.error(`[${label}] PATCH failed:`, {
      domain, path,
      status: result.status,
      error: result.data,
      fields: Object.keys(data),
    });
  }
  return result;
}

/**
 * Infer entity_type for a contact entry from the sidebar metadata.
 */
function contactEntityType(contact) {
  if (contact.type === 'entity' || contact.type === 'organization') return 'organization';
  if (contact.type === 'person') return 'person';
  // Heuristic: if name looks like a company (all-caps, contains LLC/Inc, etc.)
  const name = (contact.name || '').trim();
  if (/\b(LLC|INC|CORP|LTD|LP|LLP|PARTNERS|GROUP|ASSOCIATES|ADVISORS)\b/i.test(name)) {
    return 'organization';
  }
  return 'person';
}

/**
 * Build seed fields for ensureEntityLink based on contact data.
 */
function contactSeedFields(contact, entityType) {
  const seed = { name: contact.name };

  if (entityType === 'person') {
    const parts = (contact.name || '').trim().split(/\s+/);
    if (parts.length >= 2) {
      seed.first_name = parts[0];
      seed.last_name = parts.slice(1).join(' ');
    }
    if (contact.email) seed.email = contact.email;
    if (contact.phones?.length) seed.phone = contact.phones[0];
    if (contact.title) seed.title = contact.title;
  }

  if (entityType === 'organization') {
    if (contact.ownership_type) seed.org_type = 'owner';
  }

  if (contact.address) {
    // Try to parse "6436 Penn Ave S, Minneapolis, MN 55423"
    const addrParts = contact.address.split(',').map(s => s.trim());
    seed.address = addrParts[0] || contact.address;
    if (addrParts.length >= 2) seed.city = addrParts[1];
    if (addrParts.length >= 3) {
      const stateZip = addrParts[2].split(/\s+/);
      if (stateZip[0]) seed.state = stateZip[0];
      if (stateZip[1]) seed.zip = stateZip[1];
    }
  }

  return seed;
}

/**
 * Classify domain based on property metadata.
 * Checks DIALYSIS first (more specific) to avoid misclassifying dialysis
 * properties with "Medical Office" subtypes as government.
 * Returns 'dialysis', 'government', or null.
 */
function classifyDomain(metadata, entityFields) {
  const textParts = [
    metadata.tenant_name,
    metadata.primary_tenant,
    metadata.building_name,
    entityFields.description,
    entityFields.name,
    metadata.asset_type,
    metadata.property_type,
    metadata.property_subtype,
    metadata.occupancy_details,
  ];

  // Include tenant names from tenants[] array
  if (Array.isArray(metadata.tenants)) {
    for (const t of metadata.tenants) {
      if (t.name) textParts.push(t.name);
    }
  }

  // Include contact names from contacts[] array
  if (Array.isArray(metadata.contacts)) {
    for (const c of metadata.contacts) {
      if (c.name) textParts.push(c.name);
    }
  }

  const searchText = textParts.filter(Boolean).join(' ').toLowerCase();

  // Check DIALYSIS FIRST — more specific domain, prevents misclassification
  for (const kw of DIALYSIS_TENANT_KEYWORDS) {
    if (searchText.includes(kw)) return 'dialysis';
  }

  // Then check government
  if (entityFields.asset_type === 'government_leased') return 'government';
  for (const kw of GOV_TENANT_KEYWORDS) {
    if (searchText.includes(kw)) return 'government';
  }

  return null;
}

// ── Step 1: Unpack Contacts ─────────────────────────────────────────────────

async function unpackContacts(propertyEntityId, metadata, workspaceId, userId, domain) {
  const contacts = metadata.contacts;
  if (!Array.isArray(contacts) || contacts.length === 0) return 0;

  let created = 0;
  const source = metadata.source || 'costar';
  const extractedAt = metadata.extracted_at || new Date().toISOString();

  for (const contact of contacts) {
    if (!contact.name) continue;

    const entityType = contactEntityType(contact);
    const seedFields = contactSeedFields(contact, entityType);

    // Use ensureEntityLink to deduplicate
    const link = await ensureEntityLink({
      workspaceId,
      userId,
      sourceSystem: source,
      sourceType: entityType === 'person' ? 'contact' : 'company',
      externalId: normalizeCanonicalName(contact.name),
      domain,
      seedFields,
      metadata: {
        sidebar_source: source,
        original_contact: contact,
      },
    });

    if (!link.ok) {
      console.error('[Sidebar pipeline] Failed to create contact entity:', contact.name, link.error);
      continue;
    }

    if (link.createdEntity) created++;

    // Store additional contact details via PATCH if we have enrichment data
    if (entityType === 'person' && (contact.email || contact.phones?.length || contact.title)) {
      const updates = {};
      if (contact.email && !link.entity.email) updates.email = contact.email;
      if (contact.phones?.length && !link.entity.phone) updates.phone = contact.phones[0];
      if (contact.title && !link.entity.title) updates.title = contact.title;
      if (contact.company) {
        updates.metadata = {
          ...(link.entity.metadata || {}),
          company: contact.company,
          phones: contact.phones || [],
          website: contact.website || null,
        };
      }
      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        await opsQuery('PATCH',
          `entities?id=eq.${link.entityId}&workspace_id=eq.${workspaceId}`,
          updates
        );
      }
    }

    // Create entity_relationship linking contact → property
    const role = contact.role || 'unknown';
    const relationshipType = ROLE_TO_RELATIONSHIP[role] || 'associated_with';

    await opsQuery('POST', 'entity_relationships', {
      workspace_id: workspaceId,
      from_entity_id: link.entityId,
      to_entity_id: propertyEntityId,
      relationship_type: relationshipType,
      metadata: {
        role,
        source: `${source}_sidebar`,
        extracted_at: extractedAt,
      },
      effective_from: parseDate(metadata.sale_date) || null,
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

    // If person has a company, also create the company as an org entity
    if (entityType === 'person' && contact.company) {
      const companyLink = await ensureEntityLink({
        workspaceId,
        userId,
        sourceSystem: source,
        sourceType: 'company',
        externalId: normalizeCanonicalName(contact.company),
        domain,
        seedFields: { name: contact.company, org_type: 'broker' },
      });

      if (companyLink.ok && companyLink.createdEntity) created++;
    }
  }

  return created;
}

// ── Step 1b: Unpack Tenant → Entity + Lease Relationship ────────────────────

async function unpackTenant(propertyEntityId, metadata, workspaceId, userId, domain) {
  const tenantName = metadata.tenant_name || metadata.primary_tenant;
  if (!tenantName) return 0;

  const source = metadata.source || 'costar';
  const entityType = /\b(LLC|INC|CORP|LTD|LP|LLP|PARTNERS|GROUP|AGENCY|ADMINISTRATION|DEPARTMENT)\b/i.test(tenantName)
    ? 'organization' : 'organization'; // Tenants are almost always orgs

  const tenantLink = await ensureEntityLink({
    workspaceId,
    userId,
    sourceSystem: source,
    sourceType: 'company',
    externalId: normalizeCanonicalName(tenantName),
    domain,
    seedFields: { name: tenantName, org_type: 'tenant' },
  });

  if (!tenantLink.ok) return 0;

  // Create lease relationship with term details
  await opsQuery('POST', 'entity_relationships', {
    workspace_id: workspaceId,
    from_entity_id: tenantLink.entityId,
    to_entity_id: propertyEntityId,
    relationship_type: 'leases',
    metadata: {
      role: 'tenant',
      source: `${source}_sidebar`,
      lease_term: metadata.lease_term || null,
      occupancy: metadata.occupancy || null,
      extracted_at: metadata.extracted_at || new Date().toISOString(),
    },
  }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

  return tenantLink.createdEntity ? 1 : 0;
}

// ── Step 2: Unpack Sales History ────────────────────────────────────────────

async function unpackSalesHistory(propertyEntityId, metadata, workspaceId, userId, domain) {
  const sales = metadata.sales_history;
  if (!Array.isArray(sales) || sales.length === 0) return 0;

  const source = metadata.source || 'costar';
  let recorded = 0;

  for (const sale of sales) {
    const saleDate = parseDate(sale.sale_date);
    const salePrice = sale.sale_price && sale.sale_price !== 'Not Disclosed'
      ? sale.sale_price : null;

    // Build descriptive title
    const pricePart = salePrice || 'Undisclosed';
    const partiesPart = [sale.seller, sale.buyer].filter(Boolean).join(' → ');
    const title = partiesPart
      ? `Sale: ${pricePart} — ${partiesPart}`
      : `Sale: ${pricePart}`;

    // Create activity_event
    const eventResult = await opsQuery('POST', 'activity_events', {
      workspace_id: workspaceId,
      actor_id: userId,
      entity_id: propertyEntityId,
      category: 'system',
      source_type: `${source}_deed_record`,
      title,
      occurred_at: saleDate || new Date().toISOString(),
      domain,
      visibility: 'shared',
      metadata: {
        sale_price: sale.sale_price || null,
        asking_price: sale.asking_price || null,
        cap_rate: sale.cap_rate || null,
        buyer: sale.buyer || null,
        buyer_address: sale.buyer_address || null,
        seller: sale.seller || null,
        seller_address: sale.seller_address || null,
        lender: sale.lender || null,
        loan_amount: sale.loan_amount || null,
        loan_type: sale.loan_type || null,
        loan_origination_date: sale.loan_origination_date || null,
        interest_rate: sale.interest_rate || null,
        loan_term: sale.loan_term || null,
        maturity_date: sale.maturity_date || null,
        deed_type: sale.deed_type || null,
        transaction_type: sale.transaction_type || null,
        sale_type: sale.sale_type || null,
        sale_condition: sale.sale_condition || null,
        hold_period: sale.hold_period || null,
        document_number: sale.document_number || null,
        title_company: sale.title_company || null,
        is_current: sale.is_current || false,
        source,
      },
    });

    if (eventResult.ok) recorded++;

    // Create buyer entity if present (and not already handled by contacts)
    if (sale.buyer) {
      const buyerType = /\b(LLC|INC|CORP|LTD|LP|LLP|PARTNERS|GROUP)\b/i.test(sale.buyer)
        ? 'organization' : 'person';
      const buyerSeed = { name: sale.buyer };
      if (sale.buyer_address) {
        const parts = sale.buyer_address.split(',').map(s => s.trim());
        buyerSeed.address = parts[0];
        if (parts.length >= 2) buyerSeed.city = parts[1];
        if (parts.length >= 3) {
          const sz = parts[2].split(/\s+/);
          if (sz[0]) buyerSeed.state = sz[0];
          if (sz[1]) buyerSeed.zip = sz[1];
        }
      }

      const buyerLink = await ensureEntityLink({
        workspaceId,
        userId,
        sourceSystem: source,
        sourceType: buyerType === 'person' ? 'contact' : 'company',
        externalId: normalizeCanonicalName(sale.buyer),
        domain,
        seedFields: buyerSeed,
      });

      if (buyerLink.ok) {
        // Find the next sale date for effective_to
        const saleIdx = sales.indexOf(sale);
        const nextSaleDate = saleIdx > 0 ? parseDate(sales[saleIdx - 1].sale_date) : null;

        await opsQuery('POST', 'entity_relationships', {
          workspace_id: workspaceId,
          from_entity_id: buyerLink.entityId,
          to_entity_id: propertyEntityId,
          relationship_type: 'purchases',
          metadata: { role: 'buyer', source: `${source}_deed`, document_number: sale.document_number || null },
          effective_from: saleDate || null,
          effective_to: nextSaleDate || null,
        }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
      }
    }

    // Create seller entity if present
    if (sale.seller) {
      const sellerType = /\b(LLC|INC|CORP|LTD|LP|LLP|PARTNERS|GROUP)\b/i.test(sale.seller)
        ? 'organization' : 'person';

      const sellerLink = await ensureEntityLink({
        workspaceId,
        userId,
        sourceSystem: source,
        sourceType: sellerType === 'person' ? 'contact' : 'company',
        externalId: normalizeCanonicalName(sale.seller),
        domain,
        seedFields: { name: sale.seller },
      });

      if (sellerLink.ok) {
        await opsQuery('POST', 'entity_relationships', {
          workspace_id: workspaceId,
          from_entity_id: sellerLink.entityId,
          to_entity_id: propertyEntityId,
          relationship_type: 'sells',
          metadata: { role: 'seller', source: `${source}_deed`, document_number: sale.document_number || null },
          effective_from: saleDate || null,
        }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
      }
    }

    // Create lender entity if present
    if (sale.lender) {
      const lenderLink = await ensureEntityLink({
        workspaceId,
        userId,
        sourceSystem: source,
        sourceType: 'company',
        externalId: normalizeCanonicalName(sale.lender),
        domain,
        seedFields: { name: sale.lender, org_type: 'lender' },
      });

      if (lenderLink.ok) {
        await opsQuery('POST', 'entity_relationships', {
          workspace_id: workspaceId,
          from_entity_id: lenderLink.entityId,
          to_entity_id: propertyEntityId,
          relationship_type: 'finances',
          metadata: {
            role: 'lender',
            source: `${source}_deed`,
            loan_amount: sale.loan_amount || null,
            loan_type: sale.loan_type || null,
            loan_origination_date: sale.loan_origination_date || null,
            interest_rate: sale.interest_rate || null,
            loan_term: sale.loan_term || null,
            maturity_date: sale.maturity_date || null,
            document_number: sale.document_number || null,
          },
          effective_from: parseDate(sale.loan_origination_date) || saleDate || null,
        }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });
      }
    }
  }

  return recorded;
}

// ── Step 3: Write extraction signal ─────────────────────────────────────────

async function writeExtractionSignal(propertyEntityId, metadata, domain, userId, contactCount, salesCount) {
  await writeSignal({
    signal_type: 'sidebar_extraction_processed',
    signal_category: 'intelligence',
    entity_type: 'asset',
    entity_id: propertyEntityId,
    domain,
    user_id: userId,
    payload: {
      source: metadata.source || 'costar',
      extraction_type: `${metadata.source || 'costar'}_sidebar`,
      contacts_created: contactCount,
      sales_recorded: salesCount,
      financial_signals: {
        has_pricing: !!metadata.asking_price,
        has_cap_rate: !!metadata.cap_rate,
        has_noi: !!metadata.noi,
        sale_count: metadata.sales_history?.length || 0,
      },
    },
    outcome: 'pending',
  });
}

// ── Step 4: Domain classification + update ──────────────────────────────────

async function classifyAndUpdateDomain(entity, metadata, workspaceId) {
  const classified = classifyDomain(metadata, entity);

  if (classified) {
    // Positive keyword match — update if it changed
    if (classified !== entity.domain) {
      await opsQuery('PATCH',
        `entities?id=eq.${entity.id}&workspace_id=eq.${workspaceId}`,
        { domain: classified, updated_at: new Date().toISOString() }
      );
    }
    return classified;
  }

  // No keyword match found — this usually means the page view didn't
  // include tenant data (e.g. user was on Contacts or Public Records tab).
  // NEVER downgrade an established domain to null or a different domain
  // based on absence of evidence. Only a POSITIVE match for a different
  // domain should cause a reclassification.
  if (entity.domain) {
    return entity.domain;  // preserve existing
  }

  return null;
}

// ── Step 5: Domain database propagation ────────────────────────────────────
//
// After unpacking into LCC Ops relational records, propagate the structured
// data into the correct domain-specific Supabase backend (dialysis or gov).

/**
 * Main domain propagation dispatcher.
 * Routes to the correct domain backend based on classified domain.
 */
async function propagateToDomainDb(entity, metadata, domain) {
  if (!domain) return { propagated: false, reason: 'no_domain' };

  try {
    if (domain === 'dialysis' || domain === 'government') {
      if (!getDomainCredentials(domain)) return { propagated: false, reason: 'domain_db_not_configured' };
      return await propagateToDomainDbDirect(domain, entity, metadata);
    }
    return { propagated: false, reason: 'unknown_domain' };
  } catch (err) {
    console.error(`[Sidebar pipeline] Domain propagation error (${domain}):`, err?.message || err);
    return { propagated: false, reason: 'propagation_error', error: err?.message };
  }
}

// ── Domain DB propagation (direct PostgREST for both dialysis & government) ─

async function propagateToDomainDbDirect(domain, entity, metadata) {
  const results = { domain, property_id: null, records: {} };

  // Step 5a: Upsert property record
  const propertyId = await upsertDomainProperty(domain, entity, metadata);
  if (!propertyId) {
    console.error(`[Sidebar pipeline] ${domain} property upsert failed for:`, entity.address);
    return { propagated: false, reason: 'property_upsert_failed', ...results };
  }
  results.property_id = propertyId;

  // Step 5a1: Link property to government agency tenant (gov only)
  if (domain === 'government') {
    results.records.property_agencies = await upsertPropertyAgency(
      propertyId, metadata
    );
  }

  // Step 5a2: Upsert public records (parcel + tax from CoStar sidebar)
  results.records.public_records = await upsertPublicRecords(
    domain, propertyId, entity, metadata
  );

  // Step 5b: Upsert sales transactions
  results.records.sales = await upsertDomainSales(domain, propertyId, entity, metadata);

  // Step 5b1.5: Upsert available_listings
  if (domain === 'government') {
    results.records.listings = await upsertGovListings(propertyId, entity, metadata);
  }
  if (domain === 'dialysis') {
    results.records.listings = await upsertDialysisListings(propertyId, metadata);
  }

  // Step 5b2: Upsert broker links
  if (domain === 'dialysis') {
    results.records.brokers = await upsertDialysisBrokerLinks(propertyId, results.records.sales, metadata);
  }
  if (domain === 'government') {
    results.records.brokers = await upsertGovBrokers(propertyId, metadata);
  }

  // Step 5b3: Upsert deed records
  if (domain === 'dialysis') {
    results.records.deed_records = await upsertDialysisDeedRecords(propertyId, entity, metadata);
  }
  if (domain === 'government') {
    results.records.deed_records = await upsertGovernmentDeedRecords(entity, metadata);
  }

  // Step 5c: Upsert loans
  results.records.loans = await upsertDomainLoans(domain, propertyId, metadata);

  // Step 5d: Upsert recorded owners + ownership history
  const ownerResults = await upsertDomainOwners(domain, propertyId, entity, metadata);
  results.records.owners = ownerResults.owners;
  results.records.history = ownerResults.history;

  // Step 5d2: Upsert true owners (true buyer / true seller behind shell entities)
  const trueOwnerResult = await upsertTrueOwners(domain, propertyId, metadata);
  results.records.true_owners = (trueOwnerResult.true_buyer_id ? 1 : 0)
                               + (trueOwnerResult.true_seller_id ? 1 : 0);

  // Step 5e: Upsert leases (dialysis only — gov skipped for now)
  results.records.leases = await upsertDomainLeases(domain, propertyId, metadata);

  return { propagated: true, ...results };
}

// ── Shared domain DB upsert helpers ────────────────────────────────────────

/**
 * Find or create a property record in the domain database.
 * Matches by address + state for deduplication.
 * Returns the property_id (UUID) or null on failure.
 */
async function upsertDomainProperty(domain, entity, metadata) {
  const address = entity.address || metadata.address;
  if (!address) return null;

  // Try to find existing property by address. Normalize first so abbreviation
  // variants ("Street" vs "St", "Road" vs "Rd") resolve to the same record
  // instead of creating a duplicate every time CoStar spells it differently.
  const normAddr = normalizeAddress(address);
  let lookupPath = `properties?address=ilike.${encodeURIComponent(normAddr)}` +
    `&select=property_id&limit=1`;
  if (entity.state) lookupPath += `&state=eq.${encodeURIComponent(entity.state)}`;

  const lookup = await domainQuery(domain, 'GET', lookupPath);

  const INVALID_TENANT_VALUES = /^(public\s+record|building|land|market|sources|assessment|investment|not\s+disclosed|none|vacant|available|owner.occupied|confirmed|verified)$/i;

  const primaryTenant = [
    metadata.tenants?.[0]?.name,
    metadata.tenant_name,
    metadata.primary_tenant,
  ].find(t => t && t.length > 2 && !INVALID_TENANT_VALUES.test(t)) || null;
  const ownerContact = (metadata.contacts || []).find(c => c.role === 'owner');

  // Build property data from CoStar metadata — domain-aware field names.
  // Dialysis build stays as-is; government overrides follow below because
  // the gov properties table uses a different column set entirely.
  const parsedSF = parseSF(metadata.square_footage);
  const propertyData = stripNulls({
    address,
    city: entity.city || null,
    state: entity.state || null,
    zip_code: entity.zip || null,
    county: metadata.county || entity.county || null,
    building_size: parsedSF,
    year_built: parseIntSafe(metadata.year_built),
    year_renovated: parseIntSafe(metadata.year_renovated),
    tenant: primaryTenant,
    zoning: metadata.zoning || null,
    occupancy_percent: parsePercent(metadata.occupancy),
    parking_ratio: parseParkingRatio(metadata.parking),
    lot_sf: parseSF(metadata.land_sf) || parseSF(metadata.lot_size),
    assessed_value: parseCurrency(metadata.assessed_value),
    is_single_tenant: metadata.tenancy_type === 'Single' ? true : metadata.tenancy_type === 'Multi' ? false : null,
    property_ownership_type: metadata.ownership_type || null,
    recorded_owner_name: ownerContact?.name || null,
    land_area: metadata.lot_size && /AC/i.test(metadata.lot_size) ? parseAcres(metadata.lot_size) : null,
  });

  if (domain === 'government') {
    // Government properties schema uses different column names
    const lotSF = parseSF(metadata.land_sf) || parseSF(metadata.lot_size);
    const lotAcres = lotSF ? Math.round(lotSF / 43560 * 100) / 100 : null;
    const landAcresRaw = metadata.lot_size && /AC/i.test(metadata.lot_size)
      ? parseAcres(metadata.lot_size) : null;

    Object.assign(propertyData, stripNulls({
      rba:               parsedSF,
      year_built:        parseIntSafe(metadata.year_built),
      year_renovated:    parseIntSafe(metadata.year_renovated),
      county:            metadata.county || entity.county || null,
      zip_code:          entity.zip || null,
      land_acres:        landAcresRaw || lotAcres,
      gov_occupancy_pct: parsePercent(metadata.occupancy),
      assessed_value:    parseCurrency(metadata.assessed_value),
      gross_rent:        parseCurrency(metadata.annual_rent),
      gross_rent_psf:    parseCurrency(metadata.rent_per_sf),
      lease_commencement: parseDate(metadata.lease_commencement)?.split('T')[0] || null,
      lease_expiration:   parseDate(metadata.lease_expiration)?.split('T')[0] || null,
      renewal_options:    metadata.renewal_options || null,
      rent_escalations:   metadata.rent_escalations || null,
      sf_leased:         parseSF(metadata.sf_leased || metadata.square_footage),
      agency:            primaryTenant || null,
      agency_full_name:  primaryTenant || null,
      data_source:       'costar_sidebar',
    }));
    // Remove any dialysis-only fields that may have been set
    delete propertyData.lot_sf;
    delete propertyData.parking_ratio;
    delete propertyData.property_ownership_type;
    delete propertyData.recorded_owner_name;
    delete propertyData.tenant;
    delete propertyData.occupancy_percent;
    delete propertyData.zoning;
    delete propertyData.land_area;
    delete propertyData.is_single_tenant;
    delete propertyData.building_size;
  }

  if (lookup.ok && lookup.data?.length) {
    // Update existing property
    const propertyId = lookup.data[0].property_id;
    await domainPatch(domain, `properties?property_id=eq.${propertyId}`, propertyData, 'upsertDomainProperty');
    return propertyId;
  }

  // Create new property
  const result = await domainQuery(domain, 'POST', 'properties', propertyData);
  if (result.ok && result.data) {
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    return created?.property_id || null;
  }

  console.error(`[Sidebar pipeline] Failed to create ${domain} property:`, result.status, result.data);
  return null;
}

/**
 * Link a property to its government agency tenant in the property_agencies
 * junction table (government domain only, 43k rows).
 *
 * Schema (from information_schema):
 *   property_agency_id (uuid PK), property_id (bigint), agency_id (uuid),
 *   agency_code (text), government_type (text), sf_occupied (int),
 *   occupancy_pct (numeric), is_primary_tenant (bool), lease_number (text),
 *   lease_commencement (date), lease_expiration (date), annual_rent (numeric),
 *   rent_psf (numeric), status (text), move_in_date (date), move_out_date (date),
 *   data_source (text), notes (text), created_at (timestamptz), updated_at (timestamptz)
 *
 * government_agencies uses `full_name` (not `name`) for the agency display name.
 */
async function upsertPropertyAgency(propertyId, metadata) {
  const agencyName = metadata.tenants?.[0]?.name
    || metadata.tenant_name
    || metadata.primary_tenant
    || null;
  if (!agencyName) return 0;

  // Look up the agency in government_agencies by full_name
  const agencyLookup = await domainQuery('government', 'GET',
    `government_agencies?full_name=ilike.*${encodeURIComponent(agencyName)}*&select=agency_id,code,government_type&limit=1`
  );
  const agency = agencyLookup.ok && agencyLookup.data?.length
    ? agencyLookup.data[0] : null;

  if (!agency) {
    // Agency not in master list — skip for now (don't create unknown agencies)
    console.log('[upsertPropertyAgency] Agency not found in master list:', agencyName);
    return 0;
  }

  // Check existing link
  const existing = await domainQuery('government', 'GET',
    `property_agencies?property_id=eq.${propertyId}&agency_id=eq.${agency.agency_id}&select=property_agency_id&limit=1`
  );
  if (existing.ok && existing.data?.length) return 0; // already linked

  // Create junction record
  const r = await domainQuery('government', 'POST', 'property_agencies', {
    property_id:     propertyId,
    agency_id:       agency.agency_id,
    agency_code:     agency.code || null,
    government_type: agency.government_type || null,
    is_primary_tenant: true,
    data_source:     'costar_sidebar',
  });
  return r.ok ? 1 : 0;
}

/**
 * Upsert parcel_records and tax_records from CoStar Public Records section.
 * Writes APN, land value, and improvement value into both domain databases.
 *
 * Schema notes (from information_schema):
 *   Dialysis parcel_records: id (uuid PK), apn, county, state, assessed_value,
 *       data_hash (NOT NULL)
 *   Dialysis tax_records: id (uuid PK), apn, county, state, tax_year,
 *       assessed_value, data_hash (NOT NULL)
 *   Gov parcel_records: parcel_id (uuid PK), apn, county (NOT NULL),
 *       state_code (NOT NULL), land_value, improvement_value,
 *       total_assessed_value, assessment_year, data_hash
 *   Gov tax_records: tax_record_id (uuid PK), parcel_id (uuid FK),
 *       county (NOT NULL), state_code (NOT NULL), tax_year (NOT NULL),
 *       assessed_value, data_hash
 */
async function upsertPublicRecords(domain, propertyId, entity, metadata) {
  if (!metadata.parcel_number) return 0;
  let count = 0;

  const apn       = metadata.parcel_number;
  const county    = metadata.county || entity.county || null;
  const landVal   = parseCurrency(metadata.land_value);
  const impVal    = parseCurrency(metadata.improvement_value);
  const assessed  = parseCurrency(metadata.assessed_value)
                    || (landVal && impVal ? landVal + impVal : null);
  const taxYear   = new Date().getFullYear();

  // ── parcel_records ──────────────────────────────────────────────────────
  if (domain === 'dialysis') {
    const parcelHash = Buffer.from(`parcel|${apn}|${entity.state || ''}`).toString('base64');
    const parcelLookup = await domainQuery('dialysis', 'GET',
      `parcel_records?apn=eq.${encodeURIComponent(apn)}&select=id&limit=1`
    );
    if (!parcelLookup.ok || !parcelLookup.data?.length) {
      const parcelData = stripNulls({
        apn,
        county,
        state:          entity.state || null,
        assessed_value: assessed,
        raw_payload:    { source: 'costar_sidebar', property_id: propertyId },
        fetched_at:     metadata.extracted_at || new Date().toISOString(),
        data_hash:      parcelHash,
      });
      parcelData.data_hash = parcelHash;  // NOT NULL — ensure present after stripNulls
      const r = await domainQuery('dialysis', 'POST', 'parcel_records', parcelData);
      if (r.ok) count++;
    } else {
      await domainPatch('dialysis',
        `parcel_records?apn=eq.${encodeURIComponent(apn)}`,
        { assessed_value: assessed, county },
        'upsertPublicRecords:dialysis:parcel'
      );
    }
  }

  if (domain === 'government') {
    const parcelLookup = await domainQuery('government', 'GET',
      `parcel_records?apn=eq.${encodeURIComponent(apn)}&select=parcel_id&limit=1`
    );
    if (!parcelLookup.ok || !parcelLookup.data?.length) {
      const parcelHash = Buffer.from(`parcel|${apn}|${entity.state || ''}`).toString('base64');
      const parcelData = stripNulls({
        apn,
        county:               county || 'Unknown',
        state_code:           entity.state || 'XX',
        land_value:           landVal,
        improvement_value:    impVal,
        total_assessed_value: assessed,
        assessment_year:      taxYear,
        situs_address:        entity.address || null,
        raw_payload:          { source: 'costar_sidebar', property_id: propertyId },
        fetched_at:           metadata.extracted_at || new Date().toISOString(),
        data_hash:            parcelHash,
      });
      const r = await domainQuery('government', 'POST', 'parcel_records', parcelData);
      if (r.ok) count++;
    } else {
      await domainPatch('government',
        `parcel_records?apn=eq.${encodeURIComponent(apn)}`,
        stripNulls({
          land_value:           landVal,
          improvement_value:    impVal,
          total_assessed_value: assessed,
          assessment_year:      taxYear,
        }),
        'upsertPublicRecords:gov:parcel'
      );
    }
  }

  // ── tax_records ─────────────────────────────────────────────────────────
  if (domain === 'dialysis' && assessed) {
    const taxHash = Buffer.from(`tax|${apn}|${taxYear}`).toString('base64');
    const taxLookup = await domainQuery('dialysis', 'GET',
      `tax_records?apn=eq.${encodeURIComponent(apn)}&tax_year=eq.${taxYear}&select=id&limit=1`
    );
    if (!taxLookup.ok || !taxLookup.data?.length) {
      const taxData = stripNulls({
        apn,
        county,
        state:          entity.state || null,
        tax_year:       taxYear,
        assessed_value: assessed,
        raw_payload:    { source: 'costar_sidebar', land_value: landVal, improvement_value: impVal },
        fetched_at:     metadata.extracted_at || new Date().toISOString(),
        data_hash:      taxHash,
      });
      taxData.data_hash = taxHash;  // NOT NULL — ensure present after stripNulls
      const r = await domainQuery('dialysis', 'POST', 'tax_records', taxData);
      if (r.ok) count++;
    } else {
      await domainPatch('dialysis',
        `tax_records?apn=eq.${encodeURIComponent(apn)}&tax_year=eq.${taxYear}`,
        { assessed_value: assessed },
        'upsertPublicRecords:dialysis:tax'
      );
    }
  }

  if (domain === 'government' && assessed) {
    // Gov tax_records requires parcel_id FK — look up parcel first
    const parcelLookup = await domainQuery('government', 'GET',
      `parcel_records?apn=eq.${encodeURIComponent(apn)}&select=parcel_id&limit=1`
    );
    const parcelId = parcelLookup.ok && parcelLookup.data?.length
      ? parcelLookup.data[0].parcel_id
      : null;

    const taxLookup = parcelId
      ? await domainQuery('government', 'GET',
          `tax_records?parcel_id=eq.${parcelId}&tax_year=eq.${taxYear}&select=tax_record_id&limit=1`)
      : { ok: false, data: [] };

    if (!taxLookup.ok || !taxLookup.data?.length) {
      const taxHash = Buffer.from(`tax|${apn}|${entity.state || ''}|${taxYear}`).toString('base64');
      const taxData = stripNulls({
        parcel_id:      parcelId,
        county:         county || 'Unknown',
        state_code:     entity.state || 'XX',
        tax_year:       taxYear,
        assessed_value: assessed,
        raw_payload:    { source: 'costar_sidebar', land_value: landVal, improvement_value: impVal },
        fetched_at:     metadata.extracted_at || new Date().toISOString(),
        data_hash:      taxHash,
      });
      const r = await domainQuery('government', 'POST', 'tax_records', taxData);
      if (r.ok) count++;
    } else {
      await domainPatch('government',
        `tax_records?parcel_id=eq.${parcelId}&tax_year=eq.${taxYear}`,
        { assessed_value: assessed },
        'upsertPublicRecords:gov:tax'
      );
    }
  }

  return count;
}

function classifySaleType(sale) {
  const raw = (sale.sale_type || sale.transaction_type || '').toLowerCase();
  if (raw.includes('land') || raw.includes('pre-development') ||
      raw.includes('pre development') || raw.includes('ground lease') ||
      raw.includes('vacant')) {
    return { transaction_type: 'Land Sale', exclude_from_market_metrics: true };
  }
  if (raw.includes('build-to-suit') || raw.includes('build to suit') ||
      raw.includes('bts')) {
    return { transaction_type: 'Build-to-Suit', exclude_from_market_metrics: false };
  }
  if (raw.includes('portfolio')) {
    return { transaction_type: 'Portfolio', exclude_from_market_metrics: false };
  }
  if (raw.includes('1031') || raw.includes('exchange')) {
    return { transaction_type: '1031 Exchange', exclude_from_market_metrics: false };
  }
  if (raw.includes('investment') || raw.includes('resale')) {
    return { transaction_type: 'Investment', exclude_from_market_metrics: false };
  }
  return { transaction_type: null, exclude_from_market_metrics: false };
}

/**
 * Upsert sales transactions in the domain database.
 * Matches by property_id + sale_date + sold_price for deduplication.
 */
async function upsertDomainSales(domain, propertyId, entity, metadata) {
  const sales = metadata.sales_history;
  if (!Array.isArray(sales) || sales.length === 0) return 0;

  const parsedSF = parseSF(metadata.square_footage);
  const primaryTenant = metadata.tenants?.[0]?.name
    || metadata.tenant_name || metadata.primary_tenant || null;

  let count = 0;
  for (const sale of sales) {
    const saleDate = parseDate(sale.sale_date);
    if (!saleDate) continue;

    // Skip refinance/encumbrance deeds — not ownership transfers.
    // Still written as loan records if lender/loan data is present
    // (upsertDomainLoans handles this separately).
    if (sale.deed_type && MORTGAGE_DEED_TYPES.test(sale.deed_type)) {
      continue;
    }

    const soldPrice = parseCurrency(sale.sale_price);

    // Check for existing sale by property_id within a ±45 day window.
    // CoStar often records the same transaction with two different dates
    // (deed recording date vs. stat-card transaction date), which can differ
    // by days to weeks. An exact-date match creates a duplicate on every
    // re-save, so we treat any sale on the same property within ±45 days as
    // the same transaction and PATCH it instead of inserting.
    const datePart = saleDate.split('T')[0]; // YYYY-MM-DD
    const saleD = new Date(datePart);
    const lo = new Date(saleD); lo.setDate(lo.getDate() - 45);
    const hi = new Date(saleD); hi.setDate(hi.getDate() + 45);
    const loStr = lo.toISOString().split('T')[0];
    const hiStr = hi.toISOString().split('T')[0];

    const lookupPath =
      `sales_transactions?property_id=eq.${propertyId}` +
      `&sale_date=gte.${loStr}&sale_date=lte.${hiStr}` +
      `&select=sale_id,sale_date&limit=1`;
    const lookup = await domainQuery(domain, 'GET', lookupPath);

    // Only apply current brokers to the current/most-recent sale. Historical
    // deed-record sales predate the current broker engagement and must not
    // have these broker names attributed to them.
    const parsedSaleDate = new Date(saleDate);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const isCurrentSale = parsedSaleDate >= ninetyDaysAgo;

    // Find brokers from contacts
    const listingBroker = (metadata.contacts || []).find(c =>
      c.role === 'listing_broker' && (
        // Prefer a broker tagged to this specific transaction
        (c.sale_buyer && (
          (sale.buyer || '').toLowerCase().includes(c.sale_buyer.toLowerCase().split(' ')[0]) ||
          (sale.buyer_name || '').toLowerCase().includes(c.sale_buyer.toLowerCase().split(' ')[0])
        )) ||
        (c.sale_seller && (
          (sale.seller || '').toLowerCase().includes(c.sale_seller.toLowerCase().split(' ')[0]) ||
          (sale.seller_name || '').toLowerCase().includes(c.sale_seller.toLowerCase().split(' ')[0])
        ))
      )
    ) || (isCurrentSale ? (metadata.contacts || []).find(c => c.role === 'listing_broker') : null);
    const buyerBroker = (metadata.contacts || []).find(c => c.role === 'buyer_broker');

    // Domain-aware field names for sales transactions
    const capRateVal = parsePercent(sale.cap_rate || metadata.cap_rate);
    // For current sales with no deed-level buyer/seller, supplement
    // from contacts (buyer/seller contacts are the same entities)
    const contactBuyer = (metadata.contacts || [])
      .find(c => c.role === 'buyer')?.name || null;
    const contactSeller = (metadata.contacts || [])
      .find(c => c.role === 'seller')?.name || null;

    const buyerVal  = sale.buyer  || (isCurrentSale ? contactBuyer  : null);
    const sellerVal = sale.seller || (isCurrentSale ? contactSeller : null);
    const procuringBrokerVal = isCurrentSale ? (buyerBroker?.name || null) : null;

    const domainSaleFields = domain === 'government'
      ? {
          sold_cap_rate:    capRateVal,
          buyer:            buyerVal,
          seller:           sellerVal,
          purchasing_broker: procuringBrokerVal,
          // v_sales_comps reads address/agency from sales_transactions
          address:          entity.address || null,
          city:             entity.city    || null,
          state:            entity.state   || null,
          agency:           primaryTenant  || null,
          government_type:  metadata.government_type || null,
          // Compute sold_price_psf when both price and SF are known
          sold_price_psf:   (soldPrice && parsedSF && parsedSF > 0)
                            ? Math.round(soldPrice / parsedSF * 100) / 100
                            : null,
          // Financing details from deed entry
          financing_type:   sale.financing_type || sale.deed_type || null,
          lender_name:      sale.lender_name    || null,
          guarantor:        metadata.guarantor  || null,
          gross_rent:       parseCurrency(metadata.annual_rent),
          gross_rent_psf:   parseCurrency(metadata.rent_per_sf),
          transaction_type: null,  // set below by classifySaleType
          data_source:      'costar_sidebar',
        }
      : { cap_rate: capRateVal, buyer_name: buyerVal, seller_name: sellerVal, procuring_broker: procuringBrokerVal };

    const { transaction_type, exclude_from_market_metrics } = classifySaleType(sale);

    const saleData = stripNulls({
      property_id: propertyId,
      sale_date:   datePart,
      sold_price:  soldPrice,
      ...domainSaleFields,
      listing_broker: listingBroker?.name || null,
      // Only include recorded_date and notes for dialysis — gov
      // sales_transactions has neither column, and PostgREST will
      // silently 400 on PATCH if these are sent.
      ...(domain === 'dialysis' ? {
        recorded_date: parseDate(sale.recordation_date)?.split('T')[0] || null,
        notes: [
          sale.deed_type ? `Deed: ${sale.deed_type}` : null,
          sale.transaction_type ? `Type: ${sale.transaction_type}` : null,
          sale.document_number ? `Doc#: ${sale.document_number}` : null,
          sale.buyer_address ? `Buyer addr: ${sale.buyer_address}` : null,
        ].filter(Boolean).join('; ') || null,
      } : {}),
    });
    if (transaction_type !== null) saleData.transaction_type = transaction_type;
    // Always write exclude flag since false is a valid value that should persist
    saleData.exclude_from_market_metrics = exclude_from_market_metrics ?? false;
    saleData.data_source                = 'costar_sidebar';

    if (lookup.ok && lookup.data?.length) {
      // Update existing
      await domainPatch(domain,
        `sales_transactions?sale_id=eq.${lookup.data[0].sale_id}`, saleData, 'upsertDomainSales');
    } else {
      // Create new
      const result = await domainQuery(domain, 'POST', 'sales_transactions', saleData);
      if (result.ok) count++;
    }
  }

  return count;
}

/**
 * Upsert broker records and sale_brokers junction links in the Dialysis DB.
 * Collects broker names from metadata.contacts[], normalizes them, upserts into
 * the brokers table, then links each broker to the relevant sale via sale_brokers.
 */
async function upsertDialysisBrokerLinks(propertyId, salesResult, metadata) {
  const contacts = metadata.contacts;
  if (!Array.isArray(contacts)) return 0;

  const brokerContacts = contacts.filter(
    c => c.role === 'listing_broker' || c.role === 'buyer_broker'
  );
  if (brokerContacts.length === 0) return 0;

  // Map role to sale_brokers.role value
  const roleMap = { listing_broker: 'listing', buyer_broker: 'procuring' };

  let created = 0;

  // Regex to detect firm/company names vs. actual person names
  // e.g. "Horvath & Tremblay" or "Marcus & Millichap" match on "&"
  const FIRM_PATTERN = /\b(LLC|INC|CORP|LTD|LP|LLP|PARTNERS|GROUP|ASSOCIATES|ADVISORS|REALTY|PROPERTIES|CAPITAL|INVESTMENTS|COMMERCIAL|RETAIL|&)\b/i;

  // ── Pass 2: Group-based firm→person assignment ──
  // Contacts are extracted in CoStar order, where one or more people are
  // followed by the firm they all work for. Walk the array collecting people,
  // and when a firm entry is encountered, assign it to ALL people in the
  // current group who don't yet have a company. This correctly handles
  // groups with multiple people sharing a single firm (e.g. Matt Hagar +
  // Yuan-Sing Chang both at AiCRE Partners, or Alvin Mansour + Phil Sambazis
  // both at Marcus & Millichap).
  let groupPeople = [];
  for (const contact of brokerContacts) {
    const isFirm = FIRM_PATTERN.test(contact.name || '');
    if (!isFirm) {
      groupPeople.push(contact);
    } else {
      // Firm encountered — assign to ALL people in the current group
      // who don't yet have a company
      for (const person of groupPeople) {
        if (!person.company) person.company = contact.name;
      }
      groupPeople = []; // reset for next group
    }
  }

  // Re-derive people and firms arrays after assignment
  const people = brokerContacts.filter(c => !FIRM_PATTERN.test(c.name || ''));
  const firms  = brokerContacts.filter(c =>  FIRM_PATTERN.test(c.name || ''));

  // ── Pass 3: Process people — create broker records + sale_brokers entries ──
  for (const contact of people) {
    const name = (contact.name || '').trim();
    if (!name) continue;

    // Normalize: lowercase, strip common suffixes, collapse whitespace
    const normalized = name
      .toLowerCase()
      .replace(/\b(llc|inc|corp|ltd|lp|llp|co|company|group|associates|advisors)\b\.?/gi, '')
      .replace(/[.,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) continue;

    // Look up existing broker by normalized_name
    const encodedNorm = encodeURIComponent(normalized);
    const lookup = await domainQuery('dialysis', 'GET',
      `brokers?normalized_name=eq.${encodedNorm}&select=broker_id,email,phone,company&limit=1`
    );

    let brokerId;
    if (lookup.ok && lookup.data?.length) {
      brokerId = lookup.data[0].broker_id;

      // Patch null contact fields if we now have data
      const existing = lookup.data[0];
      const patch = stripNulls({
        email: existing.email == null && contact.email ? contact.email : null,
        phone: existing.phone == null && contact.phones?.[0] ? contact.phones[0] : null,
        company: existing.company == null && contact.company ? contact.company : null,
      });
      if (Object.keys(patch).length) {
        await domainPatch('dialysis',
          `brokers?broker_id=eq.${brokerId}`, patch, 'upsertDialysisBrokerLinks'
        );
      }
    } else {
      // Insert new broker with company from the firm assignment above
      const brokerData = stripNulls({
        broker_name: name,
        email: contact.email || null,
        phone: contact.phones?.[0] || null,
        company: contact.company || null,
        normalized_name: normalized,
      });
      const ins = await domainQuery('dialysis', 'POST', 'brokers', brokerData);
      if (!ins.ok || !ins.data?.length) continue;
      brokerId = ins.data[0].broker_id;
      created++;
    }

    // Link broker to each sale for this property written in this pipeline run
    const sales = metadata.sales_history;
    if (!Array.isArray(sales)) continue;

    for (const sale of sales) {
      // Skip land / pre-development sales — they distort broker market stats.
      const { exclude_from_market_metrics } = classifySaleType(sale);
      if (exclude_from_market_metrics) continue;

      const saleDate = parseDate(sale.sale_date);
      if (!saleDate) continue;
      const datePart = saleDate.split('T')[0];

      // Match broker to their transaction using the tagged buyer/seller,
      // falling back to recency if no tag is available
      const hasSaleTag = contact.sale_buyer || contact.sale_seller;
      if (hasSaleTag) {
        // Broker was tagged with a specific transaction group —
        // only link to sales that match the buyer or seller
        const buyerMatch  = contact.sale_buyer
          && sale.buyer === contact.sale_buyer?.toUpperCase()?.trim();
        const sellerMatch = contact.sale_seller
          && sale.seller === contact.sale_seller?.toUpperCase()?.trim();
        // Also try case-insensitive token match. Split on spaces AND hyphens
        // so hyphenated compounds like "Tognoli-Blefari-Thompson" yield
        // individual tokens that can match "THOMAS C TOGNOLI; LYNN D TOGNOLI".
        const buyerTokens = (contact.sale_buyer || '')
          .toLowerCase()
          .split(/[\s\-]+/)
          .filter(t => t.length >= 4);
        const buyerFuzzy = buyerTokens.length > 0 && (
          sale.buyer_name || sale.buyer || ''
        ).toLowerCase().split(/[\s\-;,]+/)
          .some(nameToken => buyerTokens.includes(nameToken));

        const sellerTokens = (contact.sale_seller || '')
          .toLowerCase()
          .split(/[\s\-]+/)
          .filter(t => t.length >= 4);
        const sellerFuzzy = sellerTokens.length > 0 && (
          sale.seller_name || sale.seller || ''
        ).toLowerCase().split(/[\s\-;,]+/)
          .some(nameToken => sellerTokens.includes(nameToken));
        if (!buyerMatch && !sellerMatch && !buyerFuzzy && !sellerFuzzy) continue;
      } else {
        // No tag — fall back to 90-day recency filter (current sale only)
        const saleDateObj  = new Date(saleDate);
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        if (saleDateObj < ninetyDaysAgo) continue;
      }

      // Look up the sale_id by property_id + sale_date
      const saleLookup = await domainQuery('dialysis', 'GET',
        `sales_transactions?property_id=eq.${propertyId}&sale_date=eq.${datePart}&select=sale_id&limit=1`
      );
      if (!saleLookup.ok || !saleLookup.data?.length) continue;
      const saleId = saleLookup.data[0].sale_id;

      // Check if junction row already exists
      const junctionLookup = await domainQuery('dialysis', 'GET',
        `sale_brokers?sale_id=eq.${saleId}&broker_id=eq.${brokerId}&select=sale_broker_id&limit=1`
      );
      if (junctionLookup.ok && junctionLookup.data?.length) continue;

      // Insert junction record
      await domainQuery('dialysis', 'POST', 'sale_brokers', {
        sale_id: saleId,
        broker_id: brokerId,
        role: roleMap[contact.role] || contact.role,
      });
    }
  }

  // ── Pass 4: Handle firm-only listings (no person from the same firm) ──
  // If a firm has no matching person, create a broker record + sale_brokers
  // for the firm itself so we don't lose data.
  const processedCompanies = new Set(people.map(p => p.company).filter(Boolean));

  for (const firm of firms) {
    const firmName = (firm.name || '').trim();
    if (!firmName) continue;

    // A person already carries this firm as their company — skip
    if (processedCompanies.has(firmName)) continue;

    // Normalize firm name for lookup
    const normalized = firmName
      .toLowerCase()
      .replace(/\b(llc|inc|corp|ltd|lp|llp|co|company|group|associates|advisors)\b\.?/gi, '')
      .replace(/[.,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) continue;

    const encodedNorm = encodeURIComponent(normalized);
    const lookup = await domainQuery('dialysis', 'GET',
      `brokers?normalized_name=eq.${encodedNorm}&select=broker_id&limit=1`
    );

    let brokerId;
    if (lookup.ok && lookup.data?.length) {
      brokerId = lookup.data[0].broker_id;
    } else {
      const brokerData = stripNulls({
        broker_name: firmName,
        email: firm.email || null,
        phone: firm.phones?.[0] || null,
        company: firmName,
        normalized_name: normalized,
      });
      const ins = await domainQuery('dialysis', 'POST', 'brokers', brokerData);
      if (!ins.ok || !ins.data?.length) continue;
      brokerId = ins.data[0].broker_id;
      created++;
    }

    // Link firm broker to each sale
    const sales = metadata.sales_history;
    if (!Array.isArray(sales)) continue;

    for (const sale of sales) {
      // Skip land / pre-development sales — they distort broker market stats.
      const { exclude_from_market_metrics } = classifySaleType(sale);
      if (exclude_from_market_metrics) continue;

      const saleDate = parseDate(sale.sale_date);
      if (!saleDate) continue;
      const datePart = saleDate.split('T')[0];

      // Match broker to their transaction using the tagged buyer/seller,
      // falling back to recency if no tag is available
      const hasSaleTag = firm.sale_buyer || firm.sale_seller;
      if (hasSaleTag) {
        // Broker was tagged with a specific transaction group —
        // only link to sales that match the buyer or seller
        const buyerMatch  = firm.sale_buyer
          && sale.buyer === firm.sale_buyer?.toUpperCase()?.trim();
        const sellerMatch = firm.sale_seller
          && sale.seller === firm.sale_seller?.toUpperCase()?.trim();
        // Also try case-insensitive partial match
        const buyerFuzzy  = firm.sale_buyer && sale.buyer_name
          && sale.buyer_name.toLowerCase().includes(
               firm.sale_buyer.toLowerCase().split(' ')[0]);
        const sellerFuzzy = firm.sale_seller && sale.seller_name
          && sale.seller_name.toLowerCase().includes(
               firm.sale_seller.toLowerCase().split(' ')[0]);
        if (!buyerMatch && !sellerMatch && !buyerFuzzy && !sellerFuzzy) continue;
      } else {
        // No tag — fall back to 90-day recency filter (current sale only)
        const saleDateObj  = new Date(saleDate);
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        if (saleDateObj < ninetyDaysAgo) continue;
      }

      const saleLookup = await domainQuery('dialysis', 'GET',
        `sales_transactions?property_id=eq.${propertyId}&sale_date=eq.${datePart}&select=sale_id&limit=1`
      );
      if (!saleLookup.ok || !saleLookup.data?.length) continue;
      const saleId = saleLookup.data[0].sale_id;

      const junctionLookup = await domainQuery('dialysis', 'GET',
        `sale_brokers?sale_id=eq.${saleId}&broker_id=eq.${brokerId}&select=sale_broker_id&limit=1`
      );
      if (junctionLookup.ok && junctionLookup.data?.length) continue;

      await domainQuery('dialysis', 'POST', 'sale_brokers', {
        sale_id: saleId,
        broker_id: brokerId,
        role: roleMap[firm.role] || firm.role,
      });
    }
  }

  return created;
}

// ── Step 5b2-gov: Upsert brokers (government) ────────────────────────────

/**
 * Upsert broker records in the government brokers table.
 * Gov brokers table has a different schema than Dialysis — no sale_brokers
 * junction table exists in gov, so we only upsert broker records themselves.
 *
 * For each listing_broker / buyer_broker contact:
 *   - Build canonical_name (lowercase, strip punctuation, collapse spaces)
 *   - Look up by canonical_name (ilike match)
 *   - INSERT if not found; PATCH email/phone/firm only if previously null
 *
 * Returns count of broker records created.
 */
async function upsertGovBrokers(propertyId, metadata) {
  const contacts = metadata.contacts;
  if (!Array.isArray(contacts)) return 0;

  const brokerContacts = contacts.filter(
    c => c.role === 'listing_broker' || c.role === 'buyer_broker'
  );
  if (brokerContacts.length === 0) return 0;

  let created = 0;

  for (const contact of brokerContacts) {
    const name = (contact.name || '').trim();
    if (!name) continue;

    // Build canonical_name: lowercase, strip punctuation, collapse spaces
    const canonicalName = name
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!canonicalName) continue;

    // Look up existing broker by canonical_name (case-insensitive)
    const encodedName = encodeURIComponent(canonicalName);
    const lookup = await domainQuery('government', 'GET',
      `brokers?canonical_name=ilike.${encodedName}&select=broker_id,email,phone,firm&limit=1`
    );

    if (lookup.ok && lookup.data?.length) {
      // PATCH only null fields — don't overwrite existing data
      const existing = lookup.data[0];
      const patchData = {};
      if (!existing.email && contact.email) patchData.email = contact.email;
      if (!existing.phone && contact.phones?.[0]) patchData.phone = contact.phones[0];
      if (!existing.firm && contact.company) patchData.firm = contact.company;

      if (Object.keys(patchData).length > 0) {
        await domainPatch('government',
          `brokers?broker_id=eq.${existing.broker_id}`, patchData, 'upsertGovBrokers');
      }
    } else {
      // INSERT new broker record
      const brokerData = stripNulls({
        name,
        firm: contact.company || null,
        email: contact.email || null,
        phone: contact.phones?.[0] || null,
        canonical_name: canonicalName,
        active: true,
      });
      const ins = await domainQuery('government', 'POST', 'brokers', brokerData);
      if (ins.ok) created++;
    }
  }

  return created;
}

/**
 * Upsert deed records in the Dialysis database from sales_history entries.
 * Only processes entries that have a document_number.
 * Deduplicates by data_hash (document_number + state + recording_date).
 * Deed records are immutable — existing records are never updated.
 * Returns count of records inserted.
 */
async function upsertDialysisDeedRecords(propertyId, entity, metadata) {
  const sales = metadata.sales_history;
  if (!Array.isArray(sales) || sales.length === 0) return 0;

  let inserted = 0;

  for (const sale of sales) {
    if (!sale.document_number) continue;

    const datePart = parseDate(sale.recordation_date)?.split('T')[0] || null;

    // Build deterministic dedup hash: document_number|state|recording_date
    const hashSource = `${sale.document_number}|${entity.state || ''}|${datePart || ''}`;
    const dataHash = Buffer.from(hashSource).toString('base64');

    // Check if a deed_record with this hash already exists — skip if so (immutable)
    const lookup = await domainQuery('dialysis', 'GET',
      `deed_records?data_hash=eq.${encodeURIComponent(dataHash)}&select=id&limit=1`
    );
    if (lookup.ok && lookup.data?.length) continue;

    const deedRecord = stripNulls({
      county: entity.county || metadata.county || null,
      state: entity.state || null,
      recording_date: datePart,
      document_number: sale.document_number,
      deed_type: sale.deed_type || null,
      grantor: sale.seller || null,
      grantee: sale.buyer || null,
      consideration: parseCurrency(sale.sale_price),
      raw_payload: sale,
      data_hash: dataHash,
      fetched_at: metadata.extracted_at || new Date().toISOString(),
    });

    // data_hash is NOT NULL, ensure it's always present after stripNulls
    deedRecord.data_hash = dataHash;

    const result = await domainQuery('dialysis', 'POST', 'deed_records', deedRecord);
    if (result.ok) inserted++;
  }

  return inserted;
}

/**
 * Upsert deed records into the government domain database.
 * Government schema uses parcel_id (not property_id) and state_code (not state).
 * Filters out mortgage-type deeds via MORTGAGE_DEED_TYPES.
 */
async function upsertGovernmentDeedRecords(entity, metadata) {
  const deedSales = (metadata.sales_history || [])
    .filter(s => s.document_number && !MORTGAGE_DEED_TYPES.test(s.deed_type || ''));
  if (deedSales.length === 0) return 0;

  let inserted = 0;

  for (const sale of deedSales) {
    const datePart = parseDate(sale.recordation_date || sale.sale_date)
      ?.split('T')[0] || null;
    const dataHash = Buffer.from(
      `${sale.document_number}|${entity.state}|${datePart || ''}`
    ).toString('base64');

    const lookup = await domainQuery('government', 'GET',
      `deed_records?data_hash=eq.${encodeURIComponent(dataHash)}&select=deed_id&limit=1`
    );
    if (lookup.ok && lookup.data?.length) continue;

    const result = await domainQuery('government', 'POST', 'deed_records', {
      document_number:  sale.document_number,
      deed_type:        sale.deed_type || null,
      grantor:          sale.seller || null,
      grantee:          sale.buyer || null,
      recording_date:   datePart,
      consideration:    parseCurrency(sale.sale_price),
      county:           entity.county || null,
      state_code:       entity.state || null,
      data_hash:        dataHash,
      raw_payload:      sale,
    });
    if (result.ok) inserted++;
  }

  return inserted;
}

/**
 * Map a raw CoStar loan type description to the constrained values
 * allowed by the Dialysis loans table CHECK constraint ('Refinance' or
 * 'Acquisition'). Returns null for unknown types rather than violating
 * the constraint.
 */
function mapLoanType(rawType) {
  if (!rawType) return null;
  const t = rawType.toLowerCase();
  // Any purchase/acquisition loan
  if (t.includes('purchase') || t.includes('acquisition') ||
      t.includes('commercial') || t.includes('construction') ||
      t.includes('future advance') || t.includes('open end') ||
      t.includes('bridge') || t.includes('new') ||
      t.includes('purchase money')) {
    return 'Acquisition';
  }
  // Any refinance loan
  if (t.includes('refinanc') || t.includes('refi') ||
      t.includes('cash out') || t.includes('rate') ||
      t.includes('term') || t.includes('modification')) {
    return 'Refinance';
  }
  // Unknown — send null rather than violate the constraint
  return null;
}

/**
 * Upsert loan records in the domain database.
 * Created from sales_history entries that have lender/loan_amount data.
 */
async function upsertDomainLoans(domain, propertyId, metadata) {
  const sales = metadata.sales_history;
  if (!Array.isArray(sales) || sales.length === 0) return 0;

  let count = 0;
  for (const sale of sales) {
    if (!sale.lender || !sale.loan_amount) continue;

    const lenderName = sale.lender;
    const loanAmount = parseCurrency(sale.loan_amount);
    if (!loanAmount) continue;

    // Dedup by property_id + lender_name + loan_amount
    const encodedLender = encodeURIComponent(lenderName);
    const lookup = await domainQuery(domain, 'GET',
      `loans?property_id=eq.${propertyId}&lender_name=ilike.${encodedLender}&loan_amount=eq.${loanAmount}&select=loan_id&limit=1`
    );

    const loanType = mapLoanType(sale.loan_type);

    // Government loans table has different column names (no text lender
    // column, term_years instead of loan_term, interest_rate instead of
    // interest_rate_percent), so build a domain-specific payload.
    const loanData = domain === 'government' ? stripNulls({
      property_id:      propertyId,
      loan_type:        loanType,
      loan_amount:      loanAmount,
      interest_rate:    parsePercent(sale.interest_rate),
      term_years:       sale.loan_term ? parseFloat(sale.loan_term) / 12 : null,
      origination_date: parseDate(sale.loan_origination_date)?.split('T')[0] || null,
      maturity_date:    parseDate(sale.maturity_date)?.split('T')[0] || null,
      data_source:      'costar_sidebar',
    }) : stripNulls({
      property_id:           propertyId,
      lender_name:           lenderName,
      loan_amount:           loanAmount,
      loan_type:             loanType,
      origination_date:      parseDate(sale.loan_origination_date)?.split('T')[0] || null,
      interest_rate_percent: parsePercent(sale.interest_rate),
      loan_term:             parseIntSafe(sale.loan_term),
      maturity_date:         parseDate(sale.maturity_date)?.split('T')[0] || null,
      data_source:           'costar_sidebar',
    });

    if (lookup.ok && lookup.data?.length) {
      await domainPatch(domain,
        `loans?loan_id=eq.${lookup.data[0].loan_id}`, loanData, 'upsertDomainLoans');
    } else {
      const result = await domainQuery(domain, 'POST', 'loans', loanData);
      if (result.ok) count++;
    }
  }

  return count;
}

/**
 * Upsert recorded owners and build ownership history chain.
 * Sources: contacts[] with role=owner, plus buyers/sellers from sales_history[].
 */
async function upsertDomainOwners(domain, propertyId, entity, metadata) {
  const results = { owners: 0, history: 0 };
  const ownerIds = new Map(); // name → recorded_owner_id
  const nameCol = domain === 'government' ? 'canonical_name' : 'normalized_name';

  // Normalize an owner name for dedup matching
  function normalizeOwnerName(n) {
    return n.trim().toLowerCase()
      .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Bulk-prefetch existing recorded_owners to avoid per-owner round-trips
  const allOwnerNames = new Set();
  for (const c of (metadata.contacts || []).filter(c => c.role === 'owner')) {
    if (c.name) allOwnerNames.add(normalizeOwnerName(c.name));
  }
  for (const s of (metadata.sales_history || [])) {
    if (s.buyer) allOwnerNames.add(normalizeOwnerName(s.buyer));
    if (s.seller) allOwnerNames.add(normalizeOwnerName(s.seller));
  }
  // Track existing owner rows so we can back-fill missing fields on cache hit
  const existingOwnerData = new Map();
  if (allOwnerNames.size > 0) {
    const nameList = [...allOwnerNames].map(n => encodeURIComponent(n)).join(',');
    const selectCols = domain === 'government'
      ? `recorded_owner_id,${nameCol}`
      : `recorded_owner_id,${nameCol},address`;
    const prefetch = await domainQuery(domain, 'GET',
      `recorded_owners?${nameCol}=in.(${nameList})&select=${selectCols}&limit=50`
    );
    if (prefetch.ok && Array.isArray(prefetch.data)) {
      for (const row of prefetch.data) {
        ownerIds.set(row[nameCol], row.recorded_owner_id);
        existingOwnerData.set(row[nameCol], row);
      }
    }
  }

  // Helper to find-or-create a recorded owner by name
  async function ensureRecordedOwner(name, address) {
    if (!name) return null;
    const normalizedName = normalizeOwnerName(name);

    if (ownerIds.has(normalizedName)) {
      const id = ownerIds.get(normalizedName);

      // Patch address if existing record is missing it and we have data.
      // Gov uses a contact_info JSONB column instead of flat address — skip
      // that domain here to avoid PATCHing a non-existent column.
      if (domain !== 'government' && address) {
        const existing = existingOwnerData.get(normalizedName);
        if (existing && !existing.address) {
          const addrFields = {};
          const parts = address.split(',').map(s => s.trim());
          addrFields.address = parts[0] || null;
          if (parts.length >= 2) addrFields.city = parts[1] || null;
          if (parts.length >= 3) {
            const stateZip = parts[2].split(/\s+/);
            if (stateZip[0]) addrFields.state = stateZip[0];
          }
          if (Object.keys(addrFields).length) {
            await domainPatch(domain,
              `recorded_owners?recorded_owner_id=eq.${id}`,
              addrFields,
              'upsertDomainOwners:ensureRecordedOwner'
            );
          }
        }
      }

      return id;
    }

    // Parse address if provided — domain-aware storage
    // Dialysis: flat address/city/state columns
    // Gov: contact_info JSONB with { address, city, state }
    const addrFields = {};
    if (address) {
      const parts = address.split(',').map(s => s.trim());
      const addrLine = parts[0] || null;
      const cityVal = parts.length >= 2 ? (parts[1] || null) : null;
      let stateVal = null;
      if (parts.length >= 3) {
        const stateZip = parts[2].split(/\s+/);
        if (stateZip[0]) stateVal = stateZip[0];
      }
      if (domain === 'government') {
        addrFields.contact_info = stripNulls({ address: addrLine, city: cityVal, state: stateVal });
      } else {
        addrFields.address = addrLine;
        if (cityVal) addrFields.city = cityVal;
        if (stateVal) addrFields.state = stateVal;
      }
    }

    const ownerData = stripNulls({
      name: name.trim(),
      [nameCol]: normalizedName,
      ...addrFields,
    });

    const result = await domainQuery(domain, 'POST', 'recorded_owners', ownerData);
    if (result.ok && result.data) {
      const created = Array.isArray(result.data) ? result.data[0] : result.data;
      const id = created?.recorded_owner_id || null;
      if (id) {
        ownerIds.set(normalizedName, id);
        results.owners++;
      }
      return id;
    }
    return null;
  }

  // Process contacts with role=owner
  const ownerContacts = (metadata.contacts || []).filter(c => c.role === 'owner');
  for (const contact of ownerContacts) {
    await ensureRecordedOwner(contact.name, contact.address);
  }

  // Process buyers and sellers from sales history to build ownership chain
  const sales = metadata.sales_history || [];

  // Build ownership chain — only use sales with actual buyers as
  // transition points. Stat card entries (is_current: true, no buyer)
  // are noise and must not create false ownership end dates.
  const validTransitions = [...sales]
    .filter(s => s.sale_date && s.buyer)  // must have a buyer to count as a transfer
    .sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date));

  for (let i = 0; i < validTransitions.length; i++) {
    const sale = validTransitions[i];
    const saleDate = parseDate(sale.sale_date);
    if (!saleDate) continue;

    // Skip refinance/encumbrance deeds — buyer here is a lender or the
    // existing owner refinancing, not a new owner. Counting these would
    // create duplicate ownership_history rows.
    if (sale.deed_type && MORTGAGE_DEED_TYPES.test(sale.deed_type)) continue;

    const saleDateStr = saleDate.split('T')[0];

    // Ensure buyer owner record
    const buyerId = sale.buyer ? await ensureRecordedOwner(sale.buyer, sale.buyer_address) : null;

    // Ensure seller owner record
    const sellerId = sale.seller ? await ensureRecordedOwner(sale.seller, sale.seller_address) : null;

    // Build ownership_history entry for the buyer (they own from this sale forward)
    if (buyerId) {
      // Next transition is the NEXT SALE WITH A BUYER, not any stat card entry.
      // nextSaleDate = null means this buyer is still the current owner.
      // (Only used by the dialysis branch — gov has no ownership_end column.)
      const nextTransition = i < validTransitions.length - 1 ? validTransitions[i + 1] : null;
      const nextSaleDate = nextTransition ? parseDate(nextTransition.sale_date) : null;

      // Dedup check — domain-aware date column.
      // Gov ownership_history uses transfer_date; dialysis uses ownership_start.
      const dateColFilter = domain === 'government'
        ? `transfer_date=eq.${saleDateStr}`
        : `ownership_start=eq.${saleDateStr}`;
      const ohLookup = await domainQuery(domain, 'GET',
        `ownership_history?property_id=eq.${propertyId}` +
        `&recorded_owner_id=eq.${buyerId}&${dateColFilter}` +
        `&select=ownership_id&limit=1`
      );

      // Build data — domain-aware column names.
      // Gov: transfer_date / transfer_price, no ownership_end.
      // Dialysis: ownership_start / ownership_end / sold_price.
      const ohData = domain === 'government'
        ? stripNulls({
            property_id:       propertyId,
            recorded_owner_id: buyerId,
            new_owner:         sale.buyer || null,
            prior_owner:       sale.seller || null,
            transfer_date:     saleDateStr,
            transfer_price:    parseCurrency(sale.sale_price),
            data_source:       'costar_sidebar',
          })
        : stripNulls({
            property_id:       propertyId,
            recorded_owner_id: buyerId,
            ownership_start:   saleDateStr,
            ownership_end:     nextSaleDate ? nextSaleDate.split('T')[0] : null,
            sold_price:        parseCurrency(sale.sale_price),
          });

      if (!ohLookup.ok || !ohLookup.data?.length) {
        const result = await domainQuery(domain, 'POST', 'ownership_history', ohData);
        if (result.ok) results.history++;
      }
    }
  }

  // If no ownership_history was written from sales (e.g. only stat card
  // captured, no deed entries with buyer names), write one from the
  // current owner contact and the most recent sale date.
  if (results.history === 0) {
    const ownerContact = (metadata.contacts || [])
      .find(c => c.role === 'owner');
    if (ownerContact?.name) {
      const ownerId = await ensureRecordedOwner(
        ownerContact.name,
        ownerContact.address || null
      );
      if (ownerId) {
        // Find the most recent sale date as the transfer date
        const mostRecentSale = [...(metadata.sales_history || [])]
          .filter(s => s.sale_date)
          .sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date))[0];
        const transferDate = mostRecentSale
          ? parseDate(mostRecentSale.sale_date)?.split('T')[0]
          : null;

        // Gov uses transfer_date + new_owner/prior_owner
        // Dialysis uses ownership_start
        const ohData = domain === 'government'
          ? stripNulls({
              property_id:       propertyId,
              recorded_owner_id: ownerId,
              new_owner:         ownerContact.name,
              prior_owner:       (metadata.contacts || [])
                                   .find(c => c.role === 'seller')?.name || null,
              transfer_date:     transferDate,
              sale_price:        parseCurrency(
                                   mostRecentSale?.sale_price),
              data_source:       'costar_sidebar',
            })
          : stripNulls({
              property_id:       propertyId,
              recorded_owner_id: ownerId,
              ownership_start:   transferDate,
              ownership_end:     null,  // current owner
              sold_price:        parseCurrency(
                                   mostRecentSale?.sale_price),
            });

        const dateCol = domain === 'government'
          ? `transfer_date=eq.${transferDate}`
          : `ownership_start=eq.${transferDate}`;
        const dedupPath = `ownership_history?property_id=eq.${propertyId}` +
          `&recorded_owner_id=eq.${ownerId}&${dateCol}&select=ownership_id&limit=1`;
        const ohCheck = await domainQuery(domain, 'GET', dedupPath);
        if (!ohCheck.ok || !ohCheck.data?.length) {
          const r = await domainQuery(domain, 'POST', 'ownership_history', ohData);
          if (r.ok) results.history++;
        }
      }
    }
  }

  // Link the current owner to the property record
  const currentOwner = ownerContacts[0];
  if (currentOwner) {
    const ownerId = ownerIds.get(normalizeOwnerName(currentOwner.name));
    if (ownerId) {
      await domainPatch(domain,
        `properties?property_id=eq.${propertyId}`,
        { recorded_owner_id: ownerId },
        'upsertDomainOwners:linkCurrentOwner'
      );
    }
  }

  return results;
}

// ── Step 5d2: Upsert true owners (true buyer / true seller) ────────────────

async function upsertTrueOwners(domain, propertyId, metadata) {
  const contacts = metadata.contacts || [];

  // Find true buyer — must have a name that looks like an organization,
  // not a CoStar UI label
  const COSTAR_LABEL_PATTERN = /^(sale\s+date|sale\s+price|buyer\s+type|country|national|institutional|private|individual|confirmed|investment|research\s+complete|wood\s+frame|suburban|parking|land|zoning|building|type|location|stories|class|construction|tenancy|sprinklers|parcels|assessment|documents|deed|market|vacancy|submarket|months\s+on\s+market|prev\s+year)/i;

  const trueBuyer = contacts.find(c =>
    c.role === 'true_buyer' &&
    c.name &&
    c.name.length > 3 &&
    c.name.length < 100 &&
    !COSTAR_LABEL_PATTERN.test(c.name)
  );

  const trueSeller = contacts.find(c =>
    c.role === 'true_seller' &&
    c.name &&
    c.name.length > 3 &&
    c.name.length < 100 &&
    !COSTAR_LABEL_PATTERN.test(c.name)
  );

  // Filter individual contacts to only include those with a name that
  // looks like a real person (not a CoStar UI label)
  const trueBuyerContacts = contacts.filter(c =>
    c.role === 'true_buyer_contact' &&
    c.name &&
    c.name.length > 3 &&
    c.name.length < 60 &&
    !COSTAR_LABEL_PATTERN.test(c.name) &&
    // Real person names have at least a first and last name (space between)
    // OR have a phone/email attached
    (c.name.includes(' ') || c.phones?.length || c.email)
  );
  const trueSellerContacts = contacts.filter(c =>
    c.role === 'true_seller_contact' &&
    c.name &&
    c.name.length > 3 &&
    c.name.length < 60 &&
    !COSTAR_LABEL_PATTERN.test(c.name) &&
    (c.name.includes(' ') || c.phones?.length || c.email)
  );

  let trueBuyerId  = null;
  let trueSellerId = null;

  // Helper: find or create a true_owner record
  async function ensureTrueOwner(owner, individualContacts) {
    if (!owner?.name) return null;
    const normalized = owner.name.trim().toLowerCase()
      .replace(/\b(llc|inc|corp|ltd|lp|llp|co|company|group|partners)\b\.?/gi, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

    if (domain === 'government') {
      // Check true_owners table first (canonical buyer intelligence)
      const normalized = owner.name.trim().toUpperCase()
        .replace(/\b(LLC|INC|CORP|LTD|LP|LLP|GLOBAL|ASSET\s+MANAGEMENT)\b\.?/gi, '')
        .replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

      const lookup = await domainQuery('government', 'GET',
        `true_owners?canonical_name=ilike.*${encodeURIComponent(normalized)}*` +
        `&select=true_owner_id,name&limit=1`
      );
      if (lookup.ok && lookup.data?.length) {
        return lookup.data[0].true_owner_id;
      }

      // Not in true_owners — create a new record
      const r = await domainQuery('government', 'POST', 'true_owners', {
        name:           owner.name,
        canonical_name: owner.name.toUpperCase(),
        entity_type:    'buyer',
        contact_info:   JSON.stringify({
          address: owner.address || null,
          city:    owner.city    || null,
          state:   owner.state   || null,
          phone:   owner.phone   || null,
        }),
      });
      return r.ok && r.data
        ? (Array.isArray(r.data) ? r.data[0] : r.data)?.true_owner_id
        : null;
    }

    // Dialysis: true_owners table
    const lookup = await domainQuery('dialysis', 'GET',
      `true_owners?normalized_name=eq.${encodeURIComponent(normalized)}&select=true_owner_id&limit=1`
    );
    if (lookup.ok && lookup.data?.length) {
      return lookup.data[0].true_owner_id;
    }
    const contact1 = individualContacts[0]?.name || null;
    const contact2 = individualContacts[1]?.name || null;
    const trueOwnerData = stripNulls({
      name:              owner.name,
      normalized_name:   normalized,
      notice_address_1:  owner.address || null,
      city:              owner.city    || null,
      state:             owner.state   || null,
      contact_1_name:    contact1,
      contact_2_name:    contact2,
      owner_type:        'buyer',
      is_prospect:       true,
      updated_at:        new Date().toISOString(),
    });
    const r = await domainQuery('dialysis', 'POST', 'true_owners', trueOwnerData);
    return r.ok && r.data
      ? (Array.isArray(r.data) ? r.data[0] : r.data)?.true_owner_id
      : null;
  }

  // Write true buyer
  if (trueBuyer) {
    trueBuyerId = await ensureTrueOwner(trueBuyer, trueBuyerContacts);
    if (trueBuyerId) {
      await domainPatch(domain,
        `properties?property_id=eq.${propertyId}`,
        { true_owner_id: trueBuyerId },
        'upsertTrueOwners'
      );
    }
  }

  // Write true seller (for historical record — don't update property)
  if (trueSeller) {
    trueSellerId = await ensureTrueOwner(trueSeller, trueSellerContacts);
  }

  return {
    true_buyer_id:  trueBuyerId,
    true_seller_id: trueSellerId,
  };
}

// ── Step 5e: Upsert leases (dialysis only) ────────────────────────────────

/**
 * Upsert lease records in the domain database.
 * Builds one lease record per tenant from metadata.tenants[].
 * Falls back to a single record from top-level fields if tenants[] is empty.
 * Deduplicates by property_id + tenant (case-insensitive).
 * Skips government domain (not yet supported).
 */
async function upsertDomainLeases(domain, propertyId, metadata) {
  // Domain guard — only dialysis for now
  if (domain !== 'dialysis') return 0;

  const tenants = metadata.tenants;
  let leaseRecords = [];

  if (Array.isArray(tenants) && tenants.length > 0) {
    // Build one lease record per tenant entry
    for (const t of tenants) {
      if (!t.name) continue;
      leaseRecords.push({
        property_id: propertyId,
        tenant: t.name,
        leased_area: parseSF(t.sf || metadata.sf_leased),
        lease_start: parseDate(t.lease_start || metadata.lease_commencement),
        lease_expiration: parseDate(t.lease_expiration || metadata.lease_expiration),
        expense_structure: t.lease_type || metadata.expense_structure || metadata.lease_type,
        rent_per_sf: parseCurrency(t.rent_per_sf || metadata.rent_per_sf),
        annual_rent: parseCurrency(metadata.annual_rent),
        renewal_options: metadata.renewal_options || null,
        guarantor: metadata.guarantor || null,
        status: 'active',
        is_active: true,
        data_source: 'costar_sidebar',
        // Dialysis leases.source_confidence has a CHECK constraint; 'estimated'
        // matches the allowed enum values ('documented' | 'estimated' | 'inferred').
        // 'costar_estimate' was rejected and caused every INSERT to 400 silently.
        source_confidence: 'estimated',
      });
    }
  } else {
    // Fallback: single lease from top-level metadata fields
    const tenantName = metadata.tenant_name || metadata.primary_tenant;
    if (!tenantName) return 0;

    leaseRecords.push({
      property_id: propertyId,
      tenant: tenantName,
      leased_area: parseSF(metadata.sf_leased || metadata.square_footage),
      lease_start: parseDate(metadata.lease_commencement),
      lease_expiration: parseDate(metadata.lease_expiration),
      expense_structure: metadata.expense_structure || metadata.lease_type,
      rent_per_sf: parseCurrency(metadata.rent_per_sf),
      annual_rent: parseCurrency(metadata.annual_rent),
      renewal_options: metadata.renewal_options || null,
      guarantor: metadata.guarantor || null,
      status: 'active',
      is_active: true,
      data_source: 'costar_sidebar',
      // Same CHECK-constraint-safe value as above.
      source_confidence: 'estimated',
    });
  }

  // Fetch all existing leases for this property once
  const existing = await domainQuery(
    domain, 'GET',
    `leases?property_id=eq.${propertyId}&select=lease_id,tenant&limit=50`
  );
  const existingTenants = new Set(
    (existing.data || []).map(l => l.tenant?.toLowerCase().trim())
  );

  let count = 0;
  for (const record of leaseRecords) {
    const cleaned = stripNulls(record);
    // Always keep property_id, status, is_active even if they'd survive stripNulls
    cleaned.property_id = propertyId;
    cleaned.status = 'active';
    cleaned.is_active = true;

    const tenantKey = record.tenant.toLowerCase().trim();
    if (existingTenants.has(tenantKey)) {
      // PATCH existing lease — find its lease_id and update
      const existingLease = existing.data.find(
        l => l.tenant?.toLowerCase().trim() === tenantKey
      );
      const { property_id: _pid, ...patchData } = cleaned;
      await domainPatch(domain,
        `leases?lease_id=eq.${existingLease.lease_id}`, patchData, 'upsertDomainLeases');
    } else {
      // INSERT new lease
      const result = await domainQuery(domain, 'POST', 'leases', cleaned);
      if (!result.ok) {
        console.error('[upsertDomainLeases] INSERT failed:', {
          domain,
          propertyId,
          tenant: record.tenant,
          status: result.status,
          error: result.data,
          leaseData: cleaned,
        });
        continue;
      }
      count++;
      existingTenants.add(tenantKey); // prevent double-insert within same run
    }
  }

  return count;
}

// ── Step 5f: Upsert available_listings ─────────────────────────────────────

/**
 * Upsert a listing record in the dialysis available_listings table.
 * Trigger: only writes if metadata.asking_price is present OR any
 *          sales_history entry has is_current: true.
 * Dedup: property_id + is_active=true — one active listing per property.
 *        If one already exists, PATCH price/cap_rate; otherwise INSERT.
 * Returns 1 if a record was created or updated, 0 if skipped.
 */
async function upsertDialysisListings(propertyId, metadata) {
  // Trigger guard — check parsed value, not raw metadata string.
  // If metadata.asking_price is undefined (e.g. stripped by buildMetadata),
  // the raw-string guard would silently return 0 even when a current sale
  // exists, so parse first and also evaluate any current sales_history rows.
  const parsedAskingPrice = parseCurrency(metadata.asking_price);
  const currentListings = Array.isArray(metadata.sales_history)
    ? metadata.sales_history.filter(s => s.is_current === true)
    : [];
  if (!parsedAskingPrice && !currentListings.length) {
    console.log('[upsertDialysisListings] early-exit: no asking_price and no current sale', {
      propertyId,
      raw_asking_price: metadata.asking_price,
      parsed_asking_price: parsedAskingPrice,
      sales_history_count: Array.isArray(metadata.sales_history) ? metadata.sales_history.length : 0,
    });
    return 0;
  }

  const contacts = metadata.contacts || [];
  const sellerContact = contacts.find(c => c.role === 'owner' || c.role === 'seller') || null;

  // Prefer a person (has email or phone) over a firm name
  const brokerContacts = contacts.filter(
    c => c.role === 'listing_broker' || c.role === 'buyer_broker'
  );
  const FIRM_PATTERN = /\b(LLC|INC|CORP|LTD|LP|LLP|PARTNERS|GROUP|ASSOCIATES|ADVISORS|REALTY|PROPERTIES|CAPITAL|INVESTMENTS|COMMERCIAL|RETAIL|&)\b/i;
  const personBroker = brokerContacts.find(
    c => !FIRM_PATTERN.test(c.name) && (c.email || c.phones?.length)
  );
  const firmBroker = brokerContacts.find(c => FIRM_PATTERN.test(c.name));
  const primaryBroker = personBroker || firmBroker || brokerContacts[0] || null;

  // Guard: reject price_per_sf under $50 (cap rate leak) or over $2000
  // (CoStar sometimes shows building SF in the Price/SF position)
  const rawPricePsf = parseCurrency(metadata.price_per_sf);
  const pricePsf = (rawPricePsf && rawPricePsf >= 50 && rawPricePsf <= 2000)
    ? rawPricePsf : null;
  // Fallback: compute from asking_price / square_footage when raw value is bad
  const computedPricePsf = (!pricePsf && parseCurrency(metadata.asking_price)
    && parseSF(metadata.square_footage))
    ? Math.round(parseCurrency(metadata.asking_price) / parseSF(metadata.square_footage) * 100) / 100
    : null;
  const safePricePsf = pricePsf || computedPricePsf || null;

  // Dialysis available_listings.property_id is an integer column; PostgREST
  // will reject a numeric-string with a silent 400. Cast once here and reuse.
  const propertyIdInt = parseInt(propertyId, 10);

  const record = stripNulls({
    property_id: propertyIdInt,
    initial_price: parseCurrency(metadata.asking_price),
    last_price: parseCurrency(metadata.asking_price),
    current_cap_rate: parsePercent(metadata.cap_rate),
    cap_rate: parsePercent(metadata.cap_rate),
    listing_date: new Date().toISOString().split('T')[0],
    status: 'Active',
    is_active: true,
    seller_name: sellerContact?.name || null,
    listing_broker: primaryBroker?.name || null,
    broker_email: primaryBroker?.email || null,
    price_per_sf: safePricePsf,
  });

  // Always keep property_id, status, and is_active even after stripNulls
  record.property_id = propertyIdInt;
  record.status = 'Active';
  record.is_active = true;

  // Dedup: one active listing per property
  const lookup = await domainQuery('dialysis', 'GET',
    `available_listings?property_id=eq.${propertyId}&is_active=is.true&select=property_id&limit=1`
  );

  if (lookup.ok && lookup.data?.length) {
    // Update price and cap rate on existing active listing
    const patchData = stripNulls({
      last_price: parseCurrency(metadata.asking_price),
      current_cap_rate: parsePercent(metadata.cap_rate),
      cap_rate: parsePercent(metadata.cap_rate),
      price_per_sf: safePricePsf,
    });
    await domainPatch('dialysis',
      `available_listings?property_id=eq.${propertyId}&is_active=is.true`, patchData, 'upsertDialysisListings');
    return 1;
  }

  const result = await domainQuery('dialysis', 'POST', 'available_listings', record);
  if (!result.ok) {
    console.error('[upsertDialysisListings] INSERT failed:', {
      propertyId: propertyIdInt,
      status: result.status,
      data: result.data,
      record,
    });
    return 0;
  }

  // Post-insert check: if a closed sale already exists for this property
  // within the last 2 years, immediately close the listing so we don't
  // treat it as a new active listing.
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
  const recentSales = await domainQuery('dialysis', 'GET',
    `sales_transactions?property_id=eq.${propertyIdInt}` +
    `&sale_date=gte.${twoYearsAgo}&select=sale_id,sale_date,sold_price,cap_rate` +
    `&order=sale_date.desc&limit=1`
  );

  if (recentSales.ok && recentSales.data?.length) {
    const latestSale = recentSales.data[0];
    await domainPatch('dialysis',
      `available_listings?property_id=eq.${propertyIdInt}&is_active=is.true`,
      {
        is_active: false,
        status: 'Sold',
        off_market_date: latestSale.sale_date,
        last_price: parseCurrency(latestSale.sold_price) || null,
        current_cap_rate: latestSale.cap_rate || null,
      },
      'upsertDialysisListings:autoClose'
    );
    // Return 0 — don't count as "new active listing" since it's already sold
    return 0;
  }
  return 1;
}

/**
 * Upsert a listing record in the government available_listings table.
 * Trigger: only writes if metadata.asking_price is present OR any
 *          sales_history entry has is_current: true.
 * Dedup: property_id + listing_status='Active' — one active listing per property.
 *        If one already exists, PATCH it; otherwise INSERT.
 */
async function upsertGovListings(propertyId, entity, metadata) {
  // Trigger guard
  const hasAskingPrice = !!metadata.asking_price;
  const hasCurrentSale = Array.isArray(metadata.sales_history)
    && metadata.sales_history.some(s => s.is_current === true);
  if (!hasAskingPrice && !hasCurrentSale) return 0;

  // Derive listing_date from the most recent is_current sale, else today
  let listingDate = new Date().toISOString().split('T')[0];
  if (Array.isArray(metadata.sales_history)) {
    const currentSale = metadata.sales_history.find(s => s.is_current === true);
    if (currentSale?.sale_date) {
      const parsed = parseDate(currentSale.sale_date);
      if (parsed) listingDate = parsed.split('T')[0];
    }
  }

  // Find broker / seller contacts
  const contacts = metadata.contacts || [];
  const brokerContact = contacts.find(c => c.role === 'listing_broker') || null;
  const sellerContact = contacts.find(c => c.role === 'owner' || c.role === 'seller') || null;

  // Compute firm_term_remaining from lease_expiration
  let firmTermRemaining = null;
  const leaseExp = parseDate(metadata.lease_expiration);
  if (leaseExp) {
    const diffMs = new Date(leaseExp).getTime() - Date.now();
    if (diffMs > 0) {
      firmTermRemaining = Math.round((diffMs / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10;
    }
  }

  const sfInt = parseSF(metadata.square_footage);

  // Guard: reject price_per_sf under $50 (cap rate leak) or over $2000
  // (CoStar sometimes shows building SF in the Price/SF position)
  const rawGovPricePsf = parseCurrency(metadata.price_per_sf);
  const govPricePsf = (rawGovPricePsf && rawGovPricePsf >= 50 && rawGovPricePsf <= 2000)
    ? rawGovPricePsf : null;
  const computedGovPricePsf = (!govPricePsf && parseCurrency(metadata.asking_price) && sfInt)
    ? Math.round(parseCurrency(metadata.asking_price) / sfInt * 100) / 100
    : null;
  const safeGovPricePsf = govPricePsf || computedGovPricePsf || null;

  const record = stripNulls({
    property_id: propertyId,
    listing_source: 'costar_sidebar',
    address: entity.address || null,
    city: entity.city || null,
    state: entity.state || null,
    square_feet: sfInt != null ? Math.round(sfInt) : null,
    asking_price: parseCurrency(metadata.asking_price),
    asking_cap_rate: parsePercent(metadata.cap_rate),
    asking_price_psf: safeGovPricePsf,
    listing_date: listingDate,
    listing_status: 'Active',
    days_on_market: parseIntSafe(metadata.days_on_market),
    tenant_agency: metadata.tenant_name || metadata.primary_tenant
      || metadata.tenants?.[0]?.name || null,
    annual_rent: parseCurrency(metadata.annual_rent),
    lease_expiration: parseDate(metadata.lease_expiration)?.split('T')[0] || null,
    firm_term_remaining: firmTermRemaining,
    listing_broker: brokerContact?.name || null,
    listing_firm: brokerContact?.company || null,
    broker_phone: brokerContact?.phones?.[0] || null,
    broker_email: brokerContact?.email || null,
    seller_name: sellerContact?.name || null,
  });

  // Always keep property_id and listing_status even after stripNulls
  record.property_id = propertyId;
  record.listing_status = 'Active';

  // Dedup: one active listing per property
  const lookup = await domainQuery('government', 'GET',
    `available_listings?property_id=eq.${propertyId}&listing_status=eq.Active&select=id&limit=1`
  );

  if (lookup.ok && lookup.data?.length) {
    const { property_id: _pid, ...patchData } = record;
    await domainPatch('government',
      `available_listings?id=eq.${lookup.data[0].id}`, patchData, 'upsertGovListings');
    return 0; // updated, not newly created
  }

  const result = await domainQuery('government', 'POST', 'available_listings', record);
  if (!result.ok) return 0;

  // Post-insert check: if a closed sale already exists for this property
  // within the last 2 years, immediately close the listing so we don't
  // treat it as a new active listing. The close_listing_on_sale trigger
  // fires on sale INSERT, but the pipeline creates the listing AFTER the
  // sale, so the trigger finds no active listing to close.
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
  const recentSales = await domainQuery('government', 'GET',
    `sales_transactions?property_id=eq.${propertyId}` +
    `&sale_date=gte.${twoYearsAgo}&select=sale_id,sale_date,sold_price,sold_cap_rate` +
    `&order=sale_date.desc&limit=1`
  );

  if (recentSales.ok && recentSales.data?.length) {
    const latestSale = recentSales.data[0];
    await domainPatch('government',
      `available_listings?property_id=eq.${propertyId}&listing_status=eq.Active`,
      {
        listing_status:  'Sold',
        off_market_date: latestSale.sale_date,
        asking_cap_rate: latestSale.sold_cap_rate || null,
        updated_at:      new Date().toISOString(),
      },
      'upsertGovListings:autoClose'
    );
    return 0; // Sold, not an active listing
  }
  return 1;
}

// ── Main pipeline entry point ───────────────────────────────────────────────

/**
 * Process sidebar extraction metadata for a property entity.
 * This is the main entry point — called fire-and-forget after entity creation,
 * or on-demand via the process_sidebar_extraction action.
 *
 * @param {string} entityId - The property entity UUID
 * @param {string} workspaceId - Workspace UUID
 * @param {string} userId - Acting user UUID
 * @returns {object} Summary of what was processed
 */
export async function processSidebarExtraction(entityId, workspaceId, userId) {
  // Fetch the full entity
  const entityResult = await opsQuery('GET',
    `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}&select=*`
  );
  if (!entityResult.ok || !entityResult.data?.length) {
    return { ok: false, error: 'Entity not found' };
  }

  const entity = entityResult.data[0];
  const metadata = entity.metadata || {};

  // Only process if there's sidebar extraction data worth unpacking
  if (!hasSidebarData(metadata)) {
    return { ok: true, skipped: true, reason: 'No actionable sidebar data in metadata' };
  }

  // Step 1 — classify domain (needed for entity creation in steps 2-3)
  const domain = await classifyAndUpdateDomain(entity, metadata, workspaceId);

  // Step 2 — Unpack contacts → entities + relationships
  const contactCount = await unpackContacts(entityId, metadata, workspaceId, userId, domain);

  // Step 2b — Unpack tenant → entity + lease relationship
  const tenantCount = await unpackTenant(entityId, metadata, workspaceId, userId, domain);

  // Step 3 — Unpack sales history → activity events + buyer/seller/lender entities
  const salesCount = await unpackSalesHistory(entityId, metadata, workspaceId, userId, domain);

  // Step 4 — Propagate to domain database (dialysis or government)
  const propagation = await propagateToDomainDb(entity, metadata, domain);

  // Step 5 — Write signal for learning loop
  const totalContacts = contactCount + tenantCount;
  await writeExtractionSignal(entityId, metadata, domain, userId, totalContacts, salesCount);

  // Mark metadata as processed so we don't re-process
  // Only write _pipeline_processed_at when propagation succeeded — failed runs
  // remain retryable (hasSidebarData() will return true on the next save).
  const updatedMeta = {
    ...metadata,
    ...(propagation.propagated
      ? { _pipeline_processed_at: new Date().toISOString(), _pipeline_status: 'success' }
      : { _pipeline_status: 'failed', _pipeline_last_error: propagation.reason || 'unknown' }),
    _pipeline_summary: {
      contacts_created: contactCount,
      tenant_created: tenantCount,
      sales_recorded: salesCount,
      domain,
      domain_propagated: propagation.propagated || false,
      domain_property_id: propagation.property_id || null,
      domain_records: propagation.records || null,
    },
  };
  await opsQuery('PATCH',
    `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}`,
    { metadata: updatedMeta, updated_at: new Date().toISOString() }
  );

  console.log(`[Sidebar pipeline] Done: entity=${entityId}, domain=${domain}, contacts=${totalContacts}, sales=${salesCount}, propagated=${propagation.propagated}`);

  return {
    ok: true,
    entity_id: entityId,
    domain,
    contacts_created: contactCount,
    tenant_created: tenantCount,
    sales_recorded: salesCount,
    domain_propagated: propagation.propagated || false,
    domain_property_id: propagation.property_id || null,
    domain_records: propagation.records || null,
    processed_at: new Date().toISOString(),
  };
}

/**
 * Check if an entity's metadata has sidebar extraction data that needs processing.
 */
export function hasSidebarData(metadata) {
  if (!metadata) return false;
  if (metadata._pipeline_processed_at && metadata._pipeline_status !== 'failed') return false; // Already processed (failed runs are retryable)
  return !!(
    metadata.contacts?.length ||
    metadata.sales_history?.length ||
    metadata.tenants?.length ||
    metadata.tenant_name ||
    metadata.primary_tenant ||
    metadata.asking_price ||
    metadata.square_footage ||
    metadata.cap_rate ||
    metadata.lease_expiration
  );
}
