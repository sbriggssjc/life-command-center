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
import { fetchWithTimeout, opsQuery } from '../_shared/ops-db.js';
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
    if (domain === 'dialysis') {
      // Dialysis uses the centralized ingest endpoint (no direct PostgREST)
      return await propagateToDialysisDb(entity, metadata);
    } else if (domain === 'government') {
      if (!getDomainCredentials(domain)) return { propagated: false, reason: 'domain_db_not_configured' };
      return await propagateToGovernmentDb(entity, metadata);
    }
    return { propagated: false, reason: 'unknown_domain' };
  } catch (err) {
    console.error(`[Sidebar pipeline] Domain propagation error (${domain}):`, err?.message || err);
    return { propagated: false, reason: 'propagation_error', error: err?.message };
  }
}

// ── Dialysis DB propagation (via centralized ingest endpoint) ──────────────

const DIALYSIS_INGEST_URL = process.env.DIALYSIS_INGEST_URL;
const LCC_INGEST_SECRET = process.env.LCC_INGEST_SECRET;

/**
 * Build the ingest payload from CoStar sidebar metadata and POST it to the
 * Dialysis Flask ingestion pipeline. This replaces the previous approach of
 * making many individual PostgREST calls — the Python pipeline handles
 * entity resolution, ownership propagation, broker linking, etc.
 */
async function propagateToDialysisDb(entity, metadata) {
  if (!DIALYSIS_INGEST_URL || !LCC_INGEST_SECRET) {
    return { propagated: false, reason: 'dialysis_ingest_not_configured' };
  }

  const payload = buildIngestPayload(entity, metadata);

  try {
    const resp = await fetchWithTimeout(DIALYSIS_INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LCC-Secret': LCC_INGEST_SECRET,
      },
      body: JSON.stringify(payload),
    }, 30000);

    const contentType = resp.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await resp.json()
      : await resp.text();

    if (!resp.ok) {
      console.error('[Sidebar pipeline] Dialysis ingest error:', resp.status, body);
      return {
        propagated: false,
        reason: 'ingest_endpoint_error',
        status: resp.status,
        upstream_errors: typeof body === 'object' ? body.errors : [body],
      };
    }

    const result = typeof body === 'object' ? body : {};
    return {
      propagated: true,
      domain: 'dialysis',
      property_id: result.property_id || null,
      records: {
        sales: result.sales_transactions?.ingested || 0,
        leases: result.leases?.ingested || 0,
        loans: result.loans?.ingested || 0,
        owners: result.recorded_owners?.resolved || 0,
        ownership_history: result.ownership_history?.ingested || 0,
        brokers: result.brokers?.resolved || 0,
        listings: result.available_listings?.ingested || 0,
      },
      developer_flags: result.developer_flags || [],
      upstream_errors: result.errors || [],
    };
  } catch (err) {
    console.error('[Sidebar pipeline] Dialysis ingest fetch error:', err?.message || err);
    return { propagated: false, reason: 'ingest_fetch_error', error: err?.message };
  }
}

/**
 * Transform CoStar sidebar metadata into the Dialysis ingest payload format.
 */
function buildIngestPayload(entity, metadata) {
  const payload = {};

  // property_id — pass through CoStar ID if available (avoids fuzzy matching)
  if (metadata.property_id || metadata.costar_property_id) {
    payload.property_id = metadata.property_id || metadata.costar_property_id;
  }

  // property object
  const primaryTenant = metadata.tenants?.[0]?.name || metadata.tenant_name || metadata.primary_tenant || null;
  payload.property = stripNulls({
    address: entity.address || metadata.address || null,
    city: entity.city || null,
    state: entity.state || null,
    zip_code: entity.zip || null,
    county: metadata.county || entity.county || null,
    building_size: parseSF(metadata.square_footage),
    year_built: parseIntSafe(metadata.year_built),
    tenant: primaryTenant,
    property_type: metadata.property_type || metadata.asset_type || null,
    zoning: metadata.zoning || null,
    occupancy_percent: parsePercent(metadata.occupancy),
    parking_ratio: parseParkingRatio(metadata.parking),
    lot_sf: parseSF(metadata.land_sf) || parseSF(metadata.lot_size),
  });

  // current_owner — from contacts with role=owner
  const ownerContact = (metadata.contacts || []).find(c => c.role === 'owner');
  if (ownerContact) {
    payload.current_owner = stripNulls({ name: ownerContact.name });
  }

  // recorded_owners — all contacts with role=owner + buyers/sellers from sales
  const ownerNames = new Set();
  const owners = [];
  for (const c of (metadata.contacts || [])) {
    if (c.role === 'owner' && c.name && !ownerNames.has(c.name)) {
      ownerNames.add(c.name);
      owners.push(stripNulls({
        name: c.name,
        address: c.address || null,
        city: c.city || null,
        state: c.state || null,
      }));
    }
  }
  for (const sale of (metadata.sales_history || [])) {
    if (sale.buyer && !ownerNames.has(sale.buyer)) {
      ownerNames.add(sale.buyer);
      const o = { name: sale.buyer };
      if (sale.buyer_address) o.address = sale.buyer_address;
      owners.push(stripNulls(o));
    }
    if (sale.seller && !ownerNames.has(sale.seller)) {
      ownerNames.add(sale.seller);
      owners.push(stripNulls({ name: sale.seller }));
    }
  }
  if (owners.length) payload.recorded_owners = owners;

  // sales_transactions
  const salesHistory = metadata.sales_history || [];
  if (salesHistory.length) {
    payload.sales_transactions = salesHistory
      .filter(s => s.sale_date)
      .map(sale => {
        const saleDate = parseDate(sale.sale_date);
        const datePart = saleDate ? saleDate.split('T')[0] : null;
        const listingBroker = (metadata.contacts || []).find(c => c.role === 'listing_broker');
        const buyerBroker = (metadata.contacts || []).find(c => c.role === 'buyer_broker');
        return stripNulls({
          sale_date: datePart,
          sold_price: parseCurrency(sale.sale_price),
          buyer_name: sale.buyer || null,
          seller_name: sale.seller || null,
          cap_rate: parsePercent(sale.cap_rate || metadata.cap_rate),
          listing_broker: listingBroker?.name || null,
          procuring_broker: buyerBroker?.name || null,
          notes: [
            sale.deed_type ? `Deed: ${sale.deed_type}` : null,
            sale.transaction_type ? `Type: ${sale.transaction_type}` : null,
            sale.is_current ? 'Active listing' : null,
          ].filter(Boolean).join('; ') || null,
        });
      });
  }

  // available_listings — from sales with is_current flag
  const currentListings = salesHistory.filter(s => s.is_current);
  if (currentListings.length) {
    const listingBroker = (metadata.contacts || []).find(c => c.role === 'listing_broker');
    payload.available_listings = currentListings.map(l => stripNulls({
      listing_date: parseDate(l.sale_date) ? parseDate(l.sale_date).split('T')[0] : null,
      cap_rate: parsePercent(l.cap_rate || metadata.cap_rate),
      listing_broker: listingBroker?.name || null,
      seller_name: l.seller || ownerContact?.name || null,
      status: 'Active',
    }));
  }

  // ownership_history — built from chronologically sorted sales
  const sortedSales = [...salesHistory]
    .filter(s => s.sale_date)
    .sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date));
  if (sortedSales.length) {
    const history = [];
    for (let i = 0; i < sortedSales.length; i++) {
      const sale = sortedSales[i];
      const saleDate = parseDate(sale.sale_date);
      const datePart = saleDate ? saleDate.split('T')[0] : null;
      const nextDate = i < sortedSales.length - 1
        ? parseDate(sortedSales[i + 1].sale_date)?.split('T')[0] || null
        : null;

      if (sale.buyer) {
        history.push(stripNulls({
          owner_name: sale.buyer,
          start_date: datePart,
          end_date: nextDate,
        }));
      }
    }
    if (history.length) payload.ownership_history = history;
  }

  // loans — from sales with lender/loan data
  const loanEntries = salesHistory.filter(s => s.lender && s.loan_amount);
  if (loanEntries.length) {
    payload.loans = loanEntries.map(sale => {
      const loanType = sale.loan_type === 'Commercial' ? 'Acquisition' : (sale.loan_type || null);
      return stripNulls({
        loan_amount: parseCurrency(sale.loan_amount),
        loan_type: loanType,
        origination_date: parseDate(sale.loan_origination_date)?.split('T')[0] || null,
        maturity_date: parseDate(sale.maturity_date)?.split('T')[0] || null,
        lender_name: sale.lender,
        interest_rate_percent: parsePercent(sale.interest_rate),
      });
    });
  }

  // leases — from tenants array
  const tenants = metadata.tenants || [];
  if (tenants.length) {
    payload.leases = tenants.filter(t => t.name).map(t => stripNulls({
      tenant: t.name,
      leased_area: parseSF(t.sf || metadata.sf_leased),
      lease_start: parseDate(t.lease_start || metadata.lease_commencement)?.split('T')[0] || null,
      lease_expiration: parseDate(t.lease_expiration || metadata.lease_expiration)?.split('T')[0] || null,
      lease_type: t.lease_type || metadata.expense_structure || null,
      status: 'active',
    }));
  }

  // brokers — from contacts with broker roles
  const brokerContacts = (metadata.contacts || []).filter(c =>
    c.role === 'listing_broker' || c.role === 'buyer_broker'
  );
  if (brokerContacts.length) {
    payload.brokers = brokerContacts.filter(b => b.name).map(b => stripNulls({
      broker_name: b.name,
      company: b.company || null,
    }));
  }

  // deed_records — from sales with document_number
  const deedSales = salesHistory.filter(s => s.document_number);
  if (deedSales.length) {
    payload.deed_records = deedSales.map(sale => stripNulls({
      doc_number: sale.document_number,
      recorded_date: parseDate(sale.recordation_date)?.split('T')[0] || null,
      grantor: sale.seller || null,
      grantee: sale.buyer || null,
    }));
  }

  return payload;
}

// ── Government DB propagation ──────────────────────────────────────────────

async function propagateToGovernmentDb(entity, metadata) {
  const domain = 'government';
  const results = { domain, property_id: null, records: {} };

  // Step 5a: Upsert property record
  const propertyId = await upsertDomainProperty(domain, entity, metadata);
  if (!propertyId) {
    console.error('[Sidebar pipeline] Government property upsert failed for:', entity.address);
    return { propagated: false, reason: 'property_upsert_failed', ...results };
  }
  results.property_id = propertyId;

  // Step 5c: Upsert sales transactions
  results.records.sales = await upsertDomainSales(domain, propertyId, metadata);

  // Step 5d: Upsert loans
  results.records.loans = await upsertDomainLoans(domain, propertyId, metadata);

  // Step 5e: Upsert recorded owners
  const ownerResults = await upsertDomainOwners(domain, propertyId, entity, metadata);
  results.records.owners = ownerResults.owners;
  results.records.ownership_history = ownerResults.history;

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

  // Build property data from CoStar metadata
  const propertyData = stripNulls({
    address,
    city: entity.city || null,
    state: entity.state || null,
    zip_code: entity.zip || null,
    county: metadata.county || entity.county || null,
    building_sf: parseSF(metadata.square_footage),
    year_built: parseIntSafe(metadata.year_built),
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

    // Find listing broker from contacts
    const listingBroker = (metadata.contacts || []).find(c => c.role === 'listing_broker');

    const saleData = stripNulls({
      property_id: propertyId,
      sale_date: datePart,
      sold_price: soldPrice,
      cap_rate: parsePercent(sale.cap_rate || metadata.cap_rate),
      buyer_name: sale.buyer || null,
      seller_name: sale.seller || null,
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

    const loanData = stripNulls({
      property_id: propertyId,
      lender_name: lenderName,
      loan_amount: loanAmount,
      loan_type: loanType,
      origination_date: parseDate(sale.loan_origination_date) ? parseDate(sale.loan_origination_date).split('T')[0] : null,
      interest_rate_percent: parsePercent(sale.interest_rate),
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

    const lookup = await domainQuery(domain, 'GET',
      `recorded_owners?normalized_name=eq.${encodeURIComponent(normalizedName)}&select=recorded_owner_id&limit=1`
    );

    if (lookup.ok && lookup.data?.length) {
      const id = lookup.data[0].recorded_owner_id;
      ownerIds.set(normalizedName, id);
      return id;
    }

    // Parse address if provided
    const addrFields = {};
    if (address) {
      const parts = address.split(',').map(s => s.trim());
      addrFields.address = parts[0] || null;
      if (parts.length >= 2) addrFields.city = parts[1] || null;
      if (parts.length >= 3) {
        const stateZip = parts[2].split(/\s+/);
        if (stateZip[0]) addrFields.state = stateZip[0];
      }
    }

    const ownerData = stripNulls({
      name: name.trim(),
      normalized_name: normalizedName,
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

      // Dedup ownership_history by property_id + recorded_owner_id + ownership_start
      const ohLookup = await domainQuery(domain, 'GET',
        `ownership_history?property_id=eq.${propertyId}&recorded_owner_id=eq.${buyerId}&ownership_start=eq.${saleDateStr}&select=id&limit=1`
      );

      if (!ohLookup.ok || !ohLookup.data?.length) {
        const ohData = stripNulls({
          property_id: propertyId,
          recorded_owner_id: buyerId,
          ownership_start: saleDateStr,
          ownership_end: nextSaleDate ? nextSaleDate.split('T')[0] : null,
          sold_price: parseCurrency(sale.sale_price),
        });
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
  if (!metadata.contacts && !metadata.sales_history && !metadata.tenants
      && !metadata.tenant_name && !metadata.primary_tenant) {
    return { ok: true, skipped: true, reason: 'No contacts, sales_history, tenants, or tenant in metadata' };
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
  const updatedMeta = {
    ...metadata,
    _pipeline_processed_at: new Date().toISOString(),
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
  if (metadata._pipeline_processed_at) return false; // Already processed
  return !!(
    metadata.contacts?.length ||
    metadata.sales_history?.length ||
    metadata.tenants?.length ||
    metadata.tenant_name ||
    metadata.primary_tenant
  );
}
