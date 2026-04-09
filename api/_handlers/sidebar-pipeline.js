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

import { ensureEntityLink, normalizeCanonicalName } from '../_shared/entity-link.js';
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
  if (classified && classified !== entity.domain) {
    await opsQuery('PATCH',
      `entities?id=eq.${entity.id}&workspace_id=eq.${workspaceId}`,
      { domain: classified, updated_at: new Date().toISOString() }
    );
    return classified;
  }
  return entity.domain || null;
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

  // Step 5b: Upsert sales transactions
  results.records.sales = await upsertDomainSales(domain, propertyId, metadata);

  // Step 5b2: Upsert broker links (dialysis only)
  if (domain === 'dialysis') {
    results.records.brokers = await upsertDialysisBrokerLinks(propertyId, results.records.sales, metadata);
  }

  // Step 5c: Upsert loans
  results.records.loans = await upsertDomainLoans(domain, propertyId, metadata);

  // Step 5d: Upsert recorded owners + ownership history
  const ownerResults = await upsertDomainOwners(domain, propertyId, entity, metadata);
  results.records.owners = ownerResults.owners;
  results.records.history = ownerResults.history;

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

  // Try to find existing property by address
  const encodedAddr = encodeURIComponent(address);
  let lookupPath = `properties?address=ilike.${encodedAddr}&select=property_id&limit=1`;
  if (entity.state) lookupPath += `&state=eq.${encodeURIComponent(entity.state)}`;

  const lookup = await domainQuery(domain, 'GET', lookupPath);

  const primaryTenant = metadata.tenants?.[0]?.name || null;
  const ownerContact = (metadata.contacts || []).find(c => c.role === 'owner');

  // Build property data from CoStar metadata — domain-aware field names
  const parsedSF = parseSF(metadata.square_footage);
  const propertyData = stripNulls({
    address,
    city: entity.city || null,
    state: entity.state || null,
    zip_code: entity.zip || null,
    county: metadata.county || entity.county || null,
    // SF column differs: dialysis=building_size, gov=rba
    ...(domain === 'government' ? { rba: parsedSF } : { building_size: parsedSF }),
    year_built: parseIntSafe(metadata.year_built),
    year_renovated: parseIntSafe(metadata.year_renovated),
    tenant: primaryTenant,
    zoning: metadata.zoning || null,
    occupancy_percent: parsePercent(metadata.occupancy),
    parking_ratio: parseParkingRatio(metadata.parking),
    lot_sf: parseSF(metadata.land_sf) || parseSF(metadata.lot_size),
    assessed_value: parseCurrency(metadata.assessed_value),
    ...(domain === 'dialysis' ? {
      is_single_tenant: metadata.tenancy_type === 'Single' ? true : metadata.tenancy_type === 'Multi' ? false : null,
    } : {}),
    ...(domain === 'government' ? {
      rent_escalations: metadata.rent_escalations || null,
      renewal_options: metadata.renewal_options || null,
      lease_commencement: parseDate(metadata.lease_commencement)?.split('T')[0] || null,
      lease_expiration: parseDate(metadata.lease_expiration)?.split('T')[0] || null,
      gross_rent: parseCurrency(metadata.annual_rent),
      gross_rent_psf: parseCurrency(metadata.rent_per_sf),
    } : {}),
    property_ownership_type: metadata.ownership_type || null,
    recorded_owner_name: ownerContact?.name || null,
    land_area: metadata.lot_size && /AC/i.test(metadata.lot_size) ? parseAcres(metadata.lot_size) : null,
  });

  if (lookup.ok && lookup.data?.length) {
    // Update existing property
    const propertyId = lookup.data[0].property_id;
    await domainQuery(domain, 'PATCH', `properties?property_id=eq.${propertyId}`, propertyData);
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
 * Upsert sales transactions in the domain database.
 * Matches by property_id + sale_date + sold_price for deduplication.
 */
async function upsertDomainSales(domain, propertyId, metadata) {
  const sales = metadata.sales_history;
  if (!Array.isArray(sales) || sales.length === 0) return 0;

  let count = 0;
  for (const sale of sales) {
    const saleDate = parseDate(sale.sale_date);
    if (!saleDate) continue;

    const soldPrice = parseCurrency(sale.sale_price);

    // Check for existing sale by property_id + sale_date
    const datePart = saleDate.split('T')[0]; // YYYY-MM-DD
    let lookupPath = `sales_transactions?property_id=eq.${propertyId}&sale_date=eq.${datePart}&select=sale_id&limit=1`;
    const lookup = await domainQuery(domain, 'GET', lookupPath);

    // Find brokers from contacts
    const listingBroker = (metadata.contacts || []).find(c => c.role === 'listing_broker');
    const buyerBroker = (metadata.contacts || []).find(c => c.role === 'buyer_broker');

    // Domain-aware field names for sales transactions
    const capRateVal = parsePercent(sale.cap_rate || metadata.cap_rate);
    const buyerVal = sale.buyer || null;
    const sellerVal = sale.seller || null;
    const procuringBrokerVal = buyerBroker?.name || null;

    const domainSaleFields = domain === 'government'
      ? { sold_cap_rate: capRateVal, buyer: buyerVal, seller: sellerVal, purchasing_broker: procuringBrokerVal }
      : { cap_rate: capRateVal, buyer_name: buyerVal, seller_name: sellerVal, procuring_broker: procuringBrokerVal };

    const saleData = stripNulls({
      property_id: propertyId,
      sale_date: datePart,
      sold_price: soldPrice,
      ...domainSaleFields,
      listing_broker: listingBroker?.name || null,
      recorded_date: parseDate(sale.recordation_date) ? parseDate(sale.recordation_date).split('T')[0] : null,
      notes: [
        sale.deed_type ? `Deed: ${sale.deed_type}` : null,
        sale.transaction_type ? `Type: ${sale.transaction_type}` : null,
        sale.document_number ? `Doc#: ${sale.document_number}` : null,
        sale.buyer_address ? `Buyer addr: ${sale.buyer_address}` : null,
      ].filter(Boolean).join('; ') || null,
    });

    if (lookup.ok && lookup.data?.length) {
      // Update existing
      await domainQuery(domain, 'PATCH',
        `sales_transactions?sale_id=eq.${lookup.data[0].sale_id}`, saleData);
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

  for (const contact of brokerContacts) {
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
      `brokers?normalized_name=eq.${encodedNorm}&select=broker_id&limit=1`
    );

    let brokerId;
    if (lookup.ok && lookup.data?.length) {
      brokerId = lookup.data[0].broker_id;
    } else {
      // Insert new broker
      const brokerData = stripNulls({
        broker_name: name,
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
      const saleDate = parseDate(sale.sale_date);
      if (!saleDate) continue;
      const datePart = saleDate.split('T')[0];

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

  return created;
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

    // Map loan_type: "Commercial" → "Acquisition", else keep as-is
    const loanType = sale.loan_type === 'Commercial' ? 'Acquisition' : (sale.loan_type || null);

    // Domain-aware interest rate column: dialysis=interest_rate_percent, gov=interest_rate
    const interestRateVal = parsePercent(sale.interest_rate);
    const domainRateField = domain === 'government'
      ? { interest_rate: interestRateVal }
      : { interest_rate_percent: interestRateVal };

    const loanData = stripNulls({
      property_id: propertyId,
      lender_name: lenderName,
      loan_amount: loanAmount,
      loan_type: loanType,
      origination_date: parseDate(sale.loan_origination_date) ? parseDate(sale.loan_origination_date).split('T')[0] : null,
      ...domainRateField,
      loan_term: parseIntSafe(sale.loan_term),
      maturity_date: parseDate(sale.maturity_date) ? parseDate(sale.maturity_date).split('T')[0] : null,
    });

    if (lookup.ok && lookup.data?.length) {
      await domainQuery(domain, 'PATCH',
        `loans?loan_id=eq.${lookup.data[0].loan_id}`, loanData);
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

  // Helper to find-or-create a recorded owner by name
  async function ensureRecordedOwner(name, address) {
    if (!name) return null;
    const normalizedName = name.trim().toLowerCase()
      .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (ownerIds.has(normalizedName)) return ownerIds.get(normalizedName);

    // Domain-aware name column: dialysis=normalized_name, gov=canonical_name
    const nameCol = domain === 'government' ? 'canonical_name' : 'normalized_name';

    const lookup = await domainQuery(domain, 'GET',
      `recorded_owners?${nameCol}=eq.${encodeURIComponent(normalizedName)}&select=recorded_owner_id&limit=1`
    );

    if (lookup.ok && lookup.data?.length) {
      const id = lookup.data[0].recorded_owner_id;
      ownerIds.set(normalizedName, id);
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
  // Sort chronologically (oldest first) for ownership chain
  const sortedSales = [...sales].sort((a, b) => {
    const da = new Date(a.sale_date), db = new Date(b.sale_date);
    return da.getTime() - db.getTime();
  });

  for (let i = 0; i < sortedSales.length; i++) {
    const sale = sortedSales[i];
    const saleDate = parseDate(sale.sale_date);
    if (!saleDate) continue;
    const saleDateStr = saleDate.split('T')[0];

    // Ensure buyer owner record
    const buyerId = sale.buyer ? await ensureRecordedOwner(sale.buyer, sale.buyer_address) : null;

    // Ensure seller owner record
    const sellerId = sale.seller ? await ensureRecordedOwner(sale.seller, sale.seller_address) : null;

    // Build ownership_history entry for the buyer (they own from this sale forward)
    if (buyerId) {
      const nextSaleDate = i < sortedSales.length - 1 ? parseDate(sortedSales[i + 1].sale_date) : null;

      // Domain-aware ownership_history field names
      // Dialysis: ownership_start, ownership_end, sold_price
      // Gov: transfer_date (no end column), transfer_price
      const dateCol = domain === 'government' ? 'transfer_date' : 'ownership_start';

      // Dedup ownership_history by property_id + recorded_owner_id + date column
      const ohLookup = await domainQuery(domain, 'GET',
        `ownership_history?property_id=eq.${propertyId}&recorded_owner_id=eq.${buyerId}&${dateCol}=eq.${saleDateStr}&select=id&limit=1`
      );

      if (!ohLookup.ok || !ohLookup.data?.length) {
        let ohData;
        if (domain === 'government') {
          ohData = stripNulls({
            property_id: propertyId,
            recorded_owner_id: buyerId,
            transfer_date: saleDateStr,
            transfer_price: parseCurrency(sale.sale_price),
          });
        } else {
          ohData = stripNulls({
            property_id: propertyId,
            recorded_owner_id: buyerId,
            ownership_start: saleDateStr,
            ownership_end: nextSaleDate ? nextSaleDate.split('T')[0] : null,
            sold_price: parseCurrency(sale.sale_price),
          });
        }
        const result = await domainQuery(domain, 'POST', 'ownership_history', ohData);
        if (result.ok) results.history++;
      }
    }
  }

  // Link the current owner to the property record
  const currentOwner = ownerContacts[0];
  if (currentOwner) {
    const ownerId = ownerIds.get(
      currentOwner.name.trim().toLowerCase()
        .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    if (ownerId) {
      await domainQuery(domain, 'PATCH',
        `properties?property_id=eq.${propertyId}`,
        { recorded_owner_id: ownerId }
      );
    }
  }

  return results;
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
    });
  }

  let count = 0;
  for (const record of leaseRecords) {
    const cleaned = stripNulls(record);
    // Always keep property_id, status, is_active even if they'd survive stripNulls
    cleaned.property_id = propertyId;
    cleaned.status = 'active';
    cleaned.is_active = true;

    // Dedup: look up existing lease by property_id + tenant (case-insensitive)
    const encodedTenant = encodeURIComponent(record.tenant);
    const lookup = await domainQuery(domain, 'GET',
      `leases?property_id=eq.${propertyId}&tenant=ilike.${encodedTenant}&select=id&limit=1`
    );

    if (lookup.ok && lookup.data?.length) {
      // PATCH existing lease
      const { property_id: _pid, ...patchData } = cleaned;
      await domainQuery(domain, 'PATCH',
        `leases?id=eq.${lookup.data[0].id}`, patchData);
    } else {
      // INSERT new lease
      const result = await domainQuery(domain, 'POST', 'leases', cleaned);
      if (result.ok) count++;
    }
  }

  return count;
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
