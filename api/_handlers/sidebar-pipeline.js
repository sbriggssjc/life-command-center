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
  'fresenius', 'davita', 'dialysis', 'dci ', 'dialysis clinic',
  'us renal care', 'american renal', 'satellite healthcare',
  'northwest kidney', 'kidney center', 'renal',
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
 * Returns 'government', 'dialysis', or null.
 */
function classifyDomain(metadata, entityFields) {
  const searchText = [
    metadata.tenant_name,
    metadata.primary_tenant,
    entityFields.description,
    entityFields.name,
    metadata.asset_type,
    metadata.property_type,
    metadata.occupancy_details,
  ].filter(Boolean).join(' ').toLowerCase();

  // Check government first
  if (entityFields.asset_type === 'government_leased') return 'government';
  for (const kw of GOV_TENANT_KEYWORDS) {
    if (searchText.includes(kw)) return 'government';
  }

  // Check dialysis
  for (const kw of DIALYSIS_TENANT_KEYWORDS) {
    if (searchText.includes(kw)) return 'dialysis';
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

  // Only process if there's sidebar extraction data
  if (!metadata.contacts && !metadata.sales_history) {
    return { ok: true, skipped: true, reason: 'No contacts or sales_history in metadata' };
  }

  // Step 4 first: classify domain (needed for entity creation in steps 1-2)
  const domain = await classifyAndUpdateDomain(entity, metadata, workspaceId);

  // Step 1: Unpack contacts → entities + relationships
  const contactCount = await unpackContacts(entityId, metadata, workspaceId, userId, domain);

  // Step 2: Unpack sales history → activity events + buyer/seller/lender entities
  const salesCount = await unpackSalesHistory(entityId, metadata, workspaceId, userId, domain);

  // Step 3: Write signal for learning loop
  await writeExtractionSignal(entityId, metadata, domain, userId, contactCount, salesCount);

  // Mark metadata as processed so we don't re-process
  const updatedMeta = {
    ...metadata,
    _pipeline_processed_at: new Date().toISOString(),
    _pipeline_summary: { contacts_created: contactCount, sales_recorded: salesCount, domain },
  };
  await opsQuery('PATCH',
    `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}`,
    { metadata: updatedMeta, updated_at: new Date().toISOString() }
  );

  return {
    ok: true,
    entity_id: entityId,
    domain,
    contacts_created: contactCount,
    sales_recorded: salesCount,
    processed_at: new Date().toISOString(),
  };
}

/**
 * Check if an entity's metadata has sidebar extraction data that needs processing.
 */
export function hasSidebarData(metadata) {
  if (!metadata) return false;
  if (metadata._pipeline_processed_at) return false; // Already processed
  return !!(metadata.contacts?.length || metadata.sales_history?.length);
}
