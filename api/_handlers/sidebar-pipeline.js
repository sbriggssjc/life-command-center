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
import { recalculateSaleCapRates } from '../_shared/rent-projection.js';

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

/** Parse lot SF: handles "2.49 AC" → acres-to-SF conversion, or standard SF parse */
function parseLotSF(rawLotSize) {
  if (!rawLotSize) return null;
  // If value contains AC/Acres, convert to SF
  const acMatch = String(rawLotSize).match(/([\d.]+)\s*AC/i);
  if (acMatch) return Math.round(parseFloat(acMatch[1]) * 43560);
  // Otherwise try standard SF parse
  return parseSF(rawLotSize);
}

/** Parse parking ratio: "2.28/1,000 SF" → 2.28, "32 Spaces (5.82 Spaces per 1,000 SF)" → 5.82 */
function parseParkingRatio(raw) {
  if (!raw) return null;
  // Prefer "X per 1,000 SF" ratio pattern
  const ratioMatch = String(raw).match(/([\d.]+)\s*[Ss]paces?\s+per\s+1[,.]?000/);
  if (ratioMatch) return parseFloat(ratioMatch[1]);
  // Fall back to first number (e.g. "4.35/1,000 SF" from CoStar)
  const perMatch = String(raw).match(/([\d.]+)\s*\/\s*1[,.]?000/);
  if (perMatch) return parseFloat(perMatch[1]);
  // Last resort: any decimal/integer
  const numMatch = String(raw).match(/[\d.]+/);
  return numMatch ? parseFloat(numMatch[0]) : null;
}

/** Safely parse integer: "2019" → 2019, "1" → 1 */
function parseIntSafe(val) {
  if (val == null) return null;
  const num = parseInt(String(val), 10);
  return isNaN(num) ? null : num;
}

/**
 * Parse a 4-digit "year built" value. Returns NULL for blank, non-numeric,
 * zero, or out-of-range inputs so we never persist year_built = 0.
 * Matches the DB CHECK constraint added in
 * sql/20260415_properties_year_built_null_zero.sql (1600–2100).
 */
function parseYearSafe(val) {
  if (val == null) return null;
  const str = String(val).trim();
  if (!str) return null;
  const num = parseInt(str, 10);
  if (isNaN(num) || num <= 0) return null;
  if (num < 1600 || num > 2100) return null;
  return num;
}

/** Parse a latitude or longitude value. Returns a valid numeric coordinate or null. */
function parseCoord(val) {
  if (val == null) return null;
  const num = typeof val === 'number' ? val : parseFloat(String(val).trim());
  if (isNaN(num) || num === 0) return null;
  // Sanity: lat [-90,90], lng [-180,180] — accept anything in the wider range
  if (num < -180 || num > 180) return null;
  return Math.round(num * 1e6) / 1e6; // 6 decimal places (~11cm precision)
}

/**
 * Extract structured data from CoStar "Sale Notes" narrative text.
 * Returns an object of parsed values (empty if nothing matched).
 */
function parseSaleNotes(text) {
  if (!text) return {};
  const extracted = {};

  // NOI
  const noiMatch = text.match(/(?:net\s+operating\s+income|noi)\s+(?:of\s+)?\$?([\d,]+)/i);
  if (noiMatch) extracted.noi = parseFloat(noiMatch[1].replace(/,/g, ''));

  // Cap rate from notes (cross-reference against structured cap_rate)
  const capMatch = text.match(/(\d+\.?\d*)\s*%\s*cap\s*rate/i) ||
                   text.match(/cap\s*rate.*?(\d+\.?\d*)\s*%/i);
  if (capMatch) extracted.stated_cap_rate = parseFloat(capMatch[1]);

  // Lease term remaining
  const termMatch = text.match(/(\d+)\s*(?:remaining\s+)?years?\s+remaining/i) ||
                    text.match(/(\d+)\s+years?\s+remain/i);
  if (termMatch) extracted.years_remaining = parseInt(termMatch[1]);

  // Building SF (cross-reference against RBA)
  const sfMatch = text.match(/([\d,]+)\s*[-–]?\s*square[-\s]?foot/i);
  if (sfMatch) extracted.building_sf = parseInt(sfMatch[1].replace(/,/g, ''));

  // Acreage
  const acreMatch = text.match(/([\d.]+)\s*acres?/i);
  if (acreMatch) extracted.acreage = parseFloat(acreMatch[1]);

  // Days on market
  const domMatch = text.match(/(?:market\s+for|on\s+the\s+market)\s+(\d+)\s+days/i);
  if (domMatch) extracted.days_on_market = parseInt(domMatch[1]);

  // Asking price
  const askMatch = text.match(/asking\s+price\s+of\s+\$?([\d,]+)/i) ||
                   text.match(/initial\s+asking.*?\$?([\d,]+(?:\.\d+)?)/i);
  if (askMatch) extracted.asking_price = parseFloat(askMatch[1].replace(/,/g, ''));

  // Construction type
  const constMatch = text.match(/(?:features?\s+)?(?:reinforced\s+)?(\w+\s+(?:concrete|construction|frame|masonry))/i);
  if (constMatch) extracted.construction_type = constMatch[1].trim();

  // Verification method
  const verifyMatch = text.match(/verified\s+(?:through|via|by)\s+(.+?)(?:\.|$)/i);
  if (verifyMatch) extracted.verification_method = verifyMatch[1].trim();

  // Lease type (e.g. "15-year triple net", "20 year NNN")
  const leaseMatch = text.match(/(\d+)[-\s]year\s+(triple\s+net|nnn|nn|gross|absolute)/i);
  if (leaseMatch) {
    extracted.lease_term_years = parseInt(leaseMatch[1]);
    extracted.lease_type = leaseMatch[2];
  }

  return extracted;
}

/**
 * Classify a CoStar-style property_type into the LCC building_type taxonomy.
 * CoStar routinely tags dialysis clinics, nephrology offices, and MOBs as a
 * generic "Office" subtype. When the tenant/entity signals are medical, we
 * promote that to a medical taxonomy value so the Property sidebar shows the
 * right label. Returns null when we have nothing confident to assert (caller
 * should leave the DB column untouched).
 */
function classifyBuildingType(metadata, entity, primaryTenant) {
  const rawType = (metadata.property_type || metadata.property_subtype || '').toString().trim();
  const signalText = [
    primaryTenant,
    entity?.name,
    metadata.tenant_name,
    metadata.asset_type,
    metadata.property_subtype,
    metadata.facility_name,
  ].filter(Boolean).join(' ').toLowerCase();

  const isDialysis = /dialysis|fresenius|davita|fmc\b|us\s+renal|american\s+renal|kidney|nephrology|satellite\s+healthcare|dci\b/.test(signalText);
  const isMedical  = isDialysis || /medical|clinic|physician|healthcare|health\s+care|hospital|imaging|surgery|oncology|cardiology/.test(signalText);

  if (isDialysis) return 'Medical Office – Dialysis Clinic';
  if (isMedical && /office/i.test(rawType)) return 'Medical Office';
  if (isMedical) return 'Medical Office';
  return rawType || null;
}

/** Strip null/undefined values from an object (for PATCH — avoids overwriting with null) */
function stripNulls(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) result[k] = v;
  }
  return result;
}

/** Strip address prefix from tenant names (e.g. "309 Monroe Ave, Memphis, TN 38103 - SSA, Office of Disability" → "SSA, Office of Disability") */
function cleanTenantValue(raw) {
  if (!raw) return null;
  const dashIdx = raw.indexOf(' - ');
  if (dashIdx > 0) {
    const prefix = raw.substring(0, dashIdx);
    if (/^\d+\s+\w/.test(prefix) || /,\s*[A-Z]{2}\s+\d{5}/.test(prefix)) {
      return raw.substring(dashIdx + 3).trim();
    }
  }
  return raw;
}

// ── Primary tenant priority selectors ──────────────────────────────────────
// Multi-tenant properties list tenants by SF (largest first). For domain
// pipelines the most *relevant* tenant matters more than the largest:
//   - Dialysis: prefer medical/dialysis tenants (e.g. Fresenius over Dollar Tree)
//   - Government: prefer government agency tenants (e.g. SSA over anchor store)

const MEDICAL_TENANT_PRIORITY = /fresenius|davita|dialysis|fmc|dci\b|kidney|renal|nephrology|satellite|healthcare|medical|clinic|health\s+care/i;

const GOV_TENANT_PRIORITY = /\bgsa\b|general services administration|veterans affairs|\bva\b|social security|\bssa\b|\birs\b|internal revenue|\bfbi\b|\bdea\b|\bice\b|\buscis\b|\bfema\b|\busda\b|\bhud\b|department of|bureau of|\bfederal\b|state of|county of|city of|\busps\b|postal service|army corps|coast guard|customs|\bcbp\b|\btsa\b|government/i;

/**
 * Select the most domain-relevant tenant from metadata.tenants[].
 * Falls back to metadata.tenant_name / metadata.primary_tenant when no
 * tenants array is present, and to tenants[0] when no priority match.
 */
function selectPrimaryTenant(metadata, domain) {
  const tenants = metadata.tenants || [];
  if (tenants.length === 0) {
    return metadata.tenant_name || metadata.primary_tenant || null;
  }
  const priorityRe = domain === 'government' ? GOV_TENANT_PRIORITY : MEDICAL_TENANT_PRIORITY;
  const match = tenants.find(t => t.name && priorityRe.test(t.name));
  if (match) return match.name;
  // Fall back to first (largest by SF) tenant
  return tenants[0]?.name || metadata.tenant_name || null;
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

// ── Upsert sidebar contacts (brokers, true owner contacts → contacts table) ─
//
// Column mapping differs between domain databases:
//   Dialysis:    contact_id (PK), contact_name, contact_email, contact_phone, role
//   Government:  contact_id (PK), name, email, phone, contact_type
//
const CONTACT_COLS = {
  dialysis:   { id: 'contact_id', name: 'contact_name', email: 'contact_email', phone: 'contact_phone', role: 'role' },
  government: { id: 'contact_id', name: 'name',         email: 'email',         phone: 'phone',         role: 'contact_type' },
};

// ── Upsert document links from CoStar "Documents" section ─────────────

async function upsertDocumentLinks(domain, propertyId, metadata) {
  const docs = metadata.document_links;
  if (!Array.isArray(docs) || docs.length === 0) return 0;

  let count = 0;
  for (const doc of docs) {
    if (!doc.url) continue;
    const fileName = doc.label || doc.url.split('/').pop() || 'unknown';
    const row = {
      property_id: propertyId,
      file_name:   fileName,
      document_type: doc.type || 'other',
      source_url:  doc.url,
      ingestion_status: 'url_captured',
    };
    const r = await domainQuery(
      domain, 'POST',
      'property_documents?on_conflict=property_id,file_name',
      row,
      { 'Prefer': 'return=representation,resolution=merge-duplicates' }
    );
    if (r.ok) count++;
    else console.error(`[doc-links] upsert failed for ${fileName}:`, r.status, r.data);
  }
  return count;
}

async function upsertSidebarContacts(domain, propertyId, entity, metadata) {
  const contacts = metadata.contacts || [];
  let count = 0;
  const col = CONTACT_COLS[domain];
  if (!col) return 0;

  // ── Helper: find existing contact by email then by name ──────────────
  async function findExisting(email, normName, roleFilter) {
    if (email) {
      const r = await domainQuery(domain, 'GET',
        `contacts?${col.email}=eq.${encodeURIComponent(email)}&select=${col.id}&limit=1`
      );
      if (r.ok && r.data?.length) return r.data[0][col.id];
    }
    const nameQ = roleFilter
      ? `contacts?${col.name}=ilike.${encodeURIComponent(normName)}&${col.role}=eq.${roleFilter}&select=${col.id}&limit=1`
      : `contacts?${col.name}=ilike.${encodeURIComponent(normName)}&select=${col.id}&limit=1`;
    const r2 = await domainQuery(domain, 'GET', nameQ);
    if (r2.ok && r2.data?.length) return r2.data[0][col.id];
    return null;
  }

  // ── Person contacts (brokers, true buyer/seller individuals) ─────────
  const PERSON_ROLES = ['listing_broker', 'buyer_broker',
    'true_buyer_contact', 'true_seller_contact'];

  const people = contacts.filter(c =>
    PERSON_ROLES.includes(c.role) &&
    c.name && c.name.length > 2 && c.name.length < 80 &&
    (c.email || c.phones?.length || c.phone)
  );

  for (const person of people) {
    const email   = person.email || null;
    const phone   = person.phones?.[0] || person.phone || null;
    const company = person.company || null;
    const normName = person.name.trim().toLowerCase();

    const existingId = await findExisting(email, normName, null);

    if (existingId) {
      const patch = {};
      if (email) patch[col.email] = email;
      if (phone) patch[col.phone] = phone;
      if (company) patch.company = company;
      if (Object.keys(patch).length) {
        await domainPatch(domain,
          `contacts?${col.id}=eq.${existingId}`, patch,
          'upsertSidebarContacts:personUpdate'
        );
      }
    } else {
      const row = {
        [col.name]:  person.name.trim(),
        [col.email]: email,
        [col.phone]: phone,
        company:     company,
        title:       person.title || null,
        [col.role]:  person.role,
        data_source: 'costar_sidebar',
      };
      const r = await domainQuery(domain, 'POST', 'contacts', row);
      if (r.ok) count++;
    }
  }

  // ── Entity/org-level contacts (owners, buyers, sellers) ──────────────
  // High-value CRM contacts — true buyers/sellers often have direct
  // email/phone from CoStar that is critical for prospecting.

  const ENTITY_ROLE_MAP = {
    true_buyer:  'buyer',
    true_seller: 'seller',
    owner:       'owner',
    buyer:       'buyer',
    seller:      'seller',
  };

  const entities = contacts.filter(c =>
    ENTITY_ROLE_MAP[c.role] &&
    c.name && c.name.length > 2 && c.name.length < 80
  );

  for (const ent of entities) {
    const email      = ent.email || null;
    const phone      = ent.phones?.[0] || ent.phone || null;
    const website    = ent.website || null;
    const mappedRole = ENTITY_ROLE_MAP[ent.role];
    const normName   = ent.name.trim().toLowerCase();

    const existingId = await findExisting(email, normName, mappedRole);

    if (existingId) {
      const patch = {};
      if (email)       patch[col.email] = email;
      if (phone)       patch[col.phone] = phone;
      if (website)     { patch.website = website; patch.title = `Website: ${website}`; }
      if (ent.address) patch.address = ent.address;
      if (ent.city)    patch.city = ent.city;
      if (ent.state)   patch.state = ent.state;
      if (Object.keys(patch).length) {
        await domainPatch(domain,
          `contacts?${col.id}=eq.${existingId}`, patch,
          'upsertSidebarContacts:entityUpdate'
        );
      }
    } else {
      const row = {
        [col.name]:  ent.name.trim(),
        [col.email]: email,
        [col.phone]: phone,
        company:     ent.name.trim(),
        title:       website ? `Website: ${website}` : null,
        [col.role]:  mappedRole,
        website:     website,
        address:     ent.address || null,
        city:        ent.city || null,
        state:       ent.state || null,
        data_source: 'costar_sidebar',
      };
      const r = await domainQuery(domain, 'POST', 'contacts', row);
      if (r.ok) count++;
    }
  }

  return count;
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

  // Step 5b0: Upsert document links from CoStar "Documents" section
  results.records.document_links = await upsertDocumentLinks(domain, propertyId, metadata);

  // Step 5b0.5: Auto-stage gov comp to sf_comps_staging for Salesforce sync
  if (domain === 'government' && results.records.sales > 0) {
    await stageGovCompForSalesforce(propertyId, entity, metadata);
  }

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

  // Step 5e2: Upsert named contacts (brokers, true owner contacts → CRM)
  results.records.contacts = await upsertSidebarContacts(
    domain, propertyId, entity, metadata
  );

  // Step 5f: Auto-enqueue ownership research if true_owner still unknown (gov)
  if (domain === 'government') {
    await autoEnqueueOwnerResearch(propertyId, entity, metadata);
  }

  // Step 5g: Recalculate sale cap rates from confirmed rent anchor (dialysis).
  // No-op when no anchor rent has been set, so this is safe to run on every
  // save — it only does work once an OM or lease has populated anchor_rent.
  if (domain === 'dialysis') {
    try {
      const { updated, skipped } = await recalculateSaleCapRates(propertyId, domainQuery);
      console.log(`[cap-rate-recalc] property=${propertyId} updated=${updated} skipped=${skipped}`);
      results.records.cap_rate_recalc = { updated, skipped };
    } catch (err) {
      console.error('[cap-rate-recalc] post-propagate error:', err?.message || err);
    }
  }

  return { propagated: true, ...results };
}

// ── Auto-enqueue ownership research ───────────────────────────────────────

async function autoEnqueueOwnerResearch(propertyId, entity, metadata) {
  // Only enqueue if true_owner_id is still null after pipeline ran
  const propCheck = await domainQuery('government', 'GET',
    `properties?property_id=eq.${propertyId}&select=true_owner_id,recorded_owner_id&limit=1`
  );
  if (!propCheck.ok || !propCheck.data?.length) return;
  const prop = propCheck.data[0];

  // If true owner is already known, no research needed
  if (prop.true_owner_id) return;
  if (!prop.recorded_owner_id) return;

  // Check if already in research queue
  const queueCheck = await domainQuery('government', 'GET',
    `ownership_research_queue?property_id=eq.${propertyId}&status=neq.completed&select=id&limit=1`
  );
  if (queueCheck.ok && queueCheck.data?.length) return; // already queued

  // Enqueue for research
  const ownerName = (metadata.contacts || [])
    .find(c => c.role === 'owner')?.name || null;

  await domainQuery('government', 'POST', 'ownership_research_queue', {
    property_id:         propertyId,
    address:             entity.address || null,
    city:                entity.city    || null,
    state:               entity.state   || null,
    recorded_owner_id:   prop.recorded_owner_id,
    recorded_owner_name: ownerName,
    source:              'costar_sidebar',
    priority:            'normal',
    status:              'pending',
    created_at:          new Date().toISOString(),
  });
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
  // Select building size columns so we can guard against overwriting with lower-confidence data
  const sizeCol = domain === 'government' ? 'rba' : 'building_size';
  let lookupPath = `properties?address=ilike.${encodeURIComponent(normAddr)}` +
    `&select=property_id,${sizeCol}&limit=1`;
  if (entity.state) lookupPath += `&state=eq.${encodeURIComponent(entity.state)}`;
  if (entity.city)  lookupPath += `&city=ilike.${encodeURIComponent(entity.city)}`;

  let lookup = await domainQuery(domain, 'GET', lookupPath);

  // Fallback: if city filter yielded no results, retry without city in case of
  // city-name variant mismatch ("MEMPHIS" vs "Memphis" vs "memphis" in DB).
  if (!lookup.data?.length && entity.city && entity.state) {
    const fallbackPath = `properties?address=ilike.${encodeURIComponent(normAddr)}` +
      `&state=eq.${encodeURIComponent(entity.state)}&select=property_id,${sizeCol}&limit=1`;
    const fallback = await domainQuery(domain, 'GET', fallbackPath);
    if (fallback.ok && fallback.data?.length) lookup = fallback;
  }

  const INVALID_TENANT_VALUES = /^(public\s+record|building|building\s+info|land|market|market\s+data|sources|assessment|investment|not\s+disclosed|none|vacant|available|owner.occupied|confirmed|verified|research|buyer|seller|contacts|name|sf\s+occupied|analytics|reports|data|directory|stacking\s+plan|leasing|for\s+lease|for\s+sale|property\s+info|demographics|transit|walk\s+score)$/i;

  const rawTenant = selectPrimaryTenant(metadata, domain);
  const primaryTenant = (rawTenant && rawTenant.length > 2 && !INVALID_TENANT_VALUES.test(rawTenant))
    ? cleanTenantValue(rawTenant)
    : null;
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
    year_built: parseYearSafe(metadata.year_built),
    year_renovated: parseYearSafe(metadata.year_renovated),
    building_type: classifyBuildingType(metadata, entity, primaryTenant),
    tenant: primaryTenant,
    zoning: metadata.zoning || null,
    occupancy_percent: parsePercent(metadata.occupancy),
    parking_ratio: parseParkingRatio(metadata.parking),
    lot_sf: parseLotSF(metadata.land_sf) || parseLotSF(metadata.lot_size),
    assessed_value: parseCurrency(metadata.assessed_value),
    is_single_tenant: metadata.tenancy_type === 'Single' ? true : metadata.tenancy_type === 'Multi' ? false : null,
    property_ownership_type: metadata.ownership_type || null,
    recorded_owner_name: ownerContact?.name || null,
    land_area: metadata.lot_size && /AC/i.test(metadata.lot_size) ? parseAcres(metadata.lot_size) : null,
    // Coordinates from CoStar Public Record tab (shared across both domains)
    latitude:  parseCoord(metadata.public_record?.latitude) || parseCoord(metadata.location?.latitude) || parseCoord(metadata.property?.latitude) || parseCoord(metadata.latitude),
    longitude: parseCoord(metadata.public_record?.longitude) || parseCoord(metadata.location?.longitude) || parseCoord(metadata.property?.longitude) || parseCoord(metadata.longitude),
    // Rent anchor + lease escalation (dialysis only — gov schema has no
    // anchor_rent columns). Only applied below when domain === 'dialysis'.
    anchor_rent:            parseCurrency(metadata.anchor_rent),
    anchor_rent_date:       parseDate(metadata.anchor_rent_date)?.split('T')[0] || null,
    anchor_rent_source:     metadata.anchor_rent_source || null,
    lease_commencement:     parseDate(metadata.lease_commencement)?.split('T')[0] || null,
    lease_bump_pct:         metadata.lease_bump_pct != null ? Number(metadata.lease_bump_pct) : null,
    lease_bump_interval_mo: parseIntSafe(metadata.lease_bump_interval_mo),
  });

  if (domain === 'government') {
    // Government properties schema uses different column names
    const lotSF = parseSF(metadata.land_sf) || parseSF(metadata.lot_size);
    const lotAcres = lotSF ? Math.round(lotSF / 43560 * 100) / 100 : null;
    const landAcresRaw = metadata.lot_size && /AC/i.test(metadata.lot_size)
      ? parseAcres(metadata.lot_size) : null;

    Object.assign(propertyData, stripNulls({
      rba:               parsedSF,
      year_built:        parseYearSafe(metadata.year_built),
      year_renovated:    parseYearSafe(metadata.year_renovated),
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
      sf_leased:         parseSF(metadata.sf_leased),
      agency:            primaryTenant || null,
      agency_full_name:  primaryTenant || null,
      data_source:       'costar_sidebar',
    }));
    // Remove any dialysis-only fields that may have been set
    delete propertyData.lot_sf;
    delete propertyData.parking_ratio;
    delete propertyData.property_ownership_type;
    delete propertyData.tenant;
    delete propertyData.occupancy_percent;
    delete propertyData.zoning;
    delete propertyData.land_area;
    delete propertyData.is_single_tenant;
    delete propertyData.building_size;
    delete propertyData.building_type;
    // Rent anchor columns live on the dialysis properties table only
    delete propertyData.anchor_rent;
    delete propertyData.anchor_rent_date;
    delete propertyData.anchor_rent_source;
    delete propertyData.lease_bump_pct;
    delete propertyData.lease_bump_interval_mo;
  }

  if (lookup.ok && lookup.data?.length) {
    // Update existing property. Cap-rate anchor fields that get written here
    // are picked up by the end-of-propagateToDomainDbDirect recalc step
    // (Step 5g), which fires on every dialysis save and is idempotent.
    const propertyId = lookup.data[0].property_id;

    // ── Guard: protect building_size / rba from lease-area contamination ──
    // Hierarchy: (1) CoStar RBA from property tab, (2) existing DB value.
    // Never allow lease area (sf_leased) to overwrite building size.
    const existingSize = lookup.data[0][sizeCol];
    if (existingSize && existingSize > 0) {
      // DB already has a building size. Only overwrite if the incoming CoStar
      // value is clearly RBA (square_footage set AND different from sf_leased).
      // If sf_leased == square_footage, the extension may have picked up a
      // lease-area value that bled into the RBA field — keep existing.
      const incomingSF = parsedSF;
      const leasedSF = parseSF(metadata.sf_leased);
      if (!incomingSF || (leasedSF && incomingSF === leasedSF && incomingSF !== existingSize)) {
        console.log(`[upsertDomainProperty] Protecting ${sizeCol}: DB has ${existingSize}, ` +
          `incoming ${incomingSF || 'null'} matches sf_leased ${leasedSF || 'null'} — skipping overwrite`);
        delete propertyData.building_size;
        delete propertyData.rba;
      }
    }

    await domainPatch(domain, `properties?property_id=eq.${propertyId}`, propertyData, 'upsertDomainProperty');
    if (domain === 'government' && metadata.lease_number) {
      await linkGsaLease(propertyId, metadata.lease_number);
    }
    return propertyId;
  }

  // Create new property
  const result = await domainQuery(domain, 'POST', 'properties', propertyData);
  if (result.ok && result.data) {
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    const newPropertyId = created?.property_id || null;
    if (newPropertyId && domain === 'government' && metadata.lease_number) {
      await linkGsaLease(newPropertyId, metadata.lease_number);
    }
    return newPropertyId;
  }

  console.error(`[Sidebar pipeline] Failed to create ${domain} property:`, result.status, result.data);
  return null;
}

/**
 * Look up a GSA lease by lease_number and link it to the property, pulling in
 * annual_rent, lease_expiration, sf_leased, agency, and government_type from
 * the GSA IOLP data already in the database.
 */
async function linkGsaLease(propertyId, leaseNumber) {
  if (!leaseNumber) return;

  // Find the GSA lease record
  const leaseLookup = await domainQuery('government', 'GET',
    `gsa_leases?lease_number=eq.${encodeURIComponent(leaseNumber)}` +
    `&select=lease_id,agency,agency_full_name,annual_rent,lease_expiration,` +
    `sf_leased,government_type&limit=1`
  );
  if (!leaseLookup.ok || !leaseLookup.data?.length) {
    console.log('[linkGsaLease] Lease not found in gsa_leases:', leaseNumber);
    return;
  }

  const lease = leaseLookup.data[0];

  // Link the GSA lease to the property and pull in lease data
  await domainPatch('government',
    `properties?property_id=eq.${propertyId}`,
    {
      linked_gsa_lease_id: lease.lease_id,
      lease_number:        leaseNumber,
      // Populate from GSA lease record if not already set
      agency:              lease.agency || null,
      agency_full_name:    lease.agency_full_name || null,
      sf_leased:           lease.sf_leased || null,
      gross_rent:          lease.annual_rent || null,
      lease_expiration:    lease.lease_expiration || null,
      government_type:     lease.government_type || null,
    },
    'linkGsaLease'
  );

  console.log('[linkGsaLease] Linked lease', leaseNumber, 'to property', propertyId);
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
  // ── Diagnostic: log what the extension actually sent ──────────────────
  const pubRecFields = {
    parcel_number: metadata.parcel_number || null,
    land_value: metadata.land_value || null,
    improvement_value: metadata.improvement_value || null,
    assessed_value: metadata.assessed_value || null,
    county: metadata.county || null,
    tax_amount: metadata.tax_amount || null,
    assessment_years: metadata.assessment_years || null,   // multi-year (if extension sends)
    census_tract: metadata.census_tract || null,
    legal_description: metadata.legal_description || null,
    latitude: metadata.latitude || null,
    longitude: metadata.longitude || null,
  };
  console.log(`[PublicRecords] domain=${domain} property=${propertyId} input:`, JSON.stringify(pubRecFields));

  if (!metadata.parcel_number) {
    console.warn(`[PublicRecords] SKIP — no parcel_number in metadata for property ${propertyId}. ` +
      `Extension may not be scraping CoStar Public Record tab. Keys received: [${Object.keys(metadata).join(', ')}]`);
    return 0;
  }
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
        raw_payload:    {
          source: 'costar_sidebar', property_id: propertyId,
          census_tract: metadata.census_tract || null,
          legal_description: metadata.legal_description || null,
          construction_type: metadata.construction_type || null,
          far: metadata.far || null,
          assessment_years: metadata.assessment_years || null,
          tax_amount: metadata.tax_amount || null,
        },
        fetched_at:     metadata.extracted_at || new Date().toISOString(),
        data_hash:      parcelHash,
      });
      parcelData.data_hash = parcelHash;  // NOT NULL — ensure present after stripNulls
      const r = await domainQuery('dialysis', 'POST', 'parcel_records', parcelData);
      if (r.ok) { count++; console.log(`[PublicRecords] INSERT dialysis parcel_records OK — apn=${apn}`); }
      else console.error(`[PublicRecords] INSERT dialysis parcel_records FAILED — apn=${apn} status=${r.status}`, r.data);
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
        raw_payload:          {
          source: 'costar_sidebar', property_id: propertyId,
          census_tract: metadata.census_tract || null,
          legal_description: metadata.legal_description || null,
          fips_code: metadata.fips_code || null,
          construction_type: metadata.construction_type || null,
          far: metadata.far || null,
          assessment_years: metadata.assessment_years || null,
          tax_amount: metadata.tax_amount || null,
        },
        fetched_at:           metadata.extracted_at || new Date().toISOString(),
        data_hash:            parcelHash,
      });
      const r = await domainQuery('government', 'POST', 'parcel_records', parcelData);
      if (r.ok) { count++; console.log(`[PublicRecords] INSERT gov parcel_records OK — apn=${apn}`); }
      else console.error(`[PublicRecords] INSERT gov parcel_records FAILED — apn=${apn} status=${r.status}`, r.data);
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
  // Build list of year/value pairs — prefer multi-year from extension, fallback to single current year
  const taxYears = [];
  if (Array.isArray(metadata.assessment_years) && metadata.assessment_years.length > 0) {
    for (const row of metadata.assessment_years) {
      const yr = row.year || row.tax_year;
      const val = parseCurrency(row.total) || parseCurrency(row.assessed_value)
                  || (parseCurrency(row.land) && parseCurrency(row.improvements)
                      ? parseCurrency(row.land) + parseCurrency(row.improvements) : null);
      if (yr && val) taxYears.push({ year: yr, assessed: val, land: parseCurrency(row.land), imp: parseCurrency(row.improvements) });
    }
    console.log(`[PublicRecords] Multi-year assessment data: ${taxYears.length} years from extension`);
  }
  if (taxYears.length === 0 && assessed) {
    taxYears.push({ year: taxYear, assessed, land: landVal, imp: impVal });
  }

  if (domain === 'dialysis') {
    for (const ty of taxYears) {
      const taxHash = Buffer.from(`tax|${apn}|${ty.year}`).toString('base64');
      const taxLookup = await domainQuery('dialysis', 'GET',
        `tax_records?apn=eq.${encodeURIComponent(apn)}&tax_year=eq.${ty.year}&select=id&limit=1`
      );
      if (!taxLookup.ok || !taxLookup.data?.length) {
        const taxData = stripNulls({
          apn,
          county,
          state:          entity.state || null,
          tax_year:       ty.year,
          assessed_value: ty.assessed,
          raw_payload:    { source: 'costar_sidebar', land_value: ty.land, improvement_value: ty.imp },
          fetched_at:     metadata.extracted_at || new Date().toISOString(),
          data_hash:      taxHash,
        });
        taxData.data_hash = taxHash;  // NOT NULL — ensure present after stripNulls
        const r = await domainQuery('dialysis', 'POST', 'tax_records', taxData);
        if (r.ok) { count++; console.log(`[PublicRecords] INSERT dialysis tax_records OK — apn=${apn} year=${ty.year}`); }
        else console.error(`[PublicRecords] INSERT dialysis tax_records FAILED — apn=${apn} year=${ty.year} status=${r.status}`, r.data);
      } else {
        await domainPatch('dialysis',
          `tax_records?apn=eq.${encodeURIComponent(apn)}&tax_year=eq.${ty.year}`,
          { assessed_value: ty.assessed },
          'upsertPublicRecords:dialysis:tax'
        );
      }
    }
  }

  if (domain === 'government' && taxYears.length > 0) {
    // Gov tax_records requires parcel_id FK — look up parcel first
    const parcelLookup = await domainQuery('government', 'GET',
      `parcel_records?apn=eq.${encodeURIComponent(apn)}&select=parcel_id&limit=1`
    );
    const parcelId = parcelLookup.ok && parcelLookup.data?.length
      ? parcelLookup.data[0].parcel_id
      : null;

    for (const ty of taxYears) {
      const taxLookup = parcelId
        ? await domainQuery('government', 'GET',
            `tax_records?parcel_id=eq.${parcelId}&tax_year=eq.${ty.year}&select=tax_record_id&limit=1`)
        : { ok: false, data: [] };

      if (!taxLookup.ok || !taxLookup.data?.length) {
        const taxHash = Buffer.from(`tax|${apn}|${entity.state || ''}|${ty.year}`).toString('base64');
        const taxData = stripNulls({
          parcel_id:      parcelId,
          county:         county || 'Unknown',
          state_code:     entity.state || 'XX',
          tax_year:       ty.year,
          assessed_value: ty.assessed,
          raw_payload:    { source: 'costar_sidebar', land_value: ty.land, improvement_value: ty.imp },
          fetched_at:     metadata.extracted_at || new Date().toISOString(),
          data_hash:      taxHash,
        });
        const r = await domainQuery('government', 'POST', 'tax_records', taxData);
        if (r.ok) { count++; console.log(`[PublicRecords] INSERT gov tax_records OK — apn=${apn} year=${ty.year}`); }
        else console.error(`[PublicRecords] INSERT gov tax_records FAILED — apn=${apn} year=${ty.year} status=${r.status}`, r.data);
      } else {
        await domainPatch('government',
          `tax_records?parcel_id=eq.${parcelId}&tax_year=eq.${ty.year}`,
          { assessed_value: ty.assessed },
          'upsertPublicRecords:gov:tax'
        );
      }
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
  if (/owner\s+user/.test(raw) || raw.includes('owner-user') ||
      raw.includes('owner occupied') || raw.includes('user')) {
    return { transaction_type: 'Owner-User', exclude_from_market_metrics: true };
  }
  if (raw.includes('build-to-suit') || raw.includes('build to suit') ||
      raw.includes('bts') || raw.includes('built to suit')) {
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
 * Re-route a record that looked like a sale but is actually a listing
 * (asking price, on-market, missing sale_date/sold_price) into
 * available_listings. Logs with the [listing-misroute] prefix so the
 * misroutes are auditable.
 */
async function routeListingMisroute(domain, propertyId, saleRow, reasons) {
  const rawPrice = Number(saleRow?.sold_price);
  const listPrice = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
  const notesVal = saleRow?.notes || null;

  const record = {
    property_id: domain === 'dialysis' ? parseInt(propertyId, 10) : propertyId,
    list_price: listPrice,
    status: 'off_market',
    notes: notesVal,
    data_source: 'costar_sidebar',
  };

  console.warn(
    `[listing-misroute] rerouting ${domain} property=${propertyId} to available_listings`,
    {
      list_price: listPrice,
      notes: notesVal,
      transaction_type: saleRow?.transaction_type || null,
      sale_date: saleRow?.sale_date || null,
      reasons,
    }
  );

  const result = await domainQuery(domain, 'POST', 'available_listings', record);
  if (!result.ok) {
    console.error('[listing-misroute] available_listings insert failed', {
      domain,
      propertyId,
      status: result.status,
      data: result.data,
      record,
    });
  }
  return result.ok;
}

/**
 * One-time audit helper: scan sales_transactions in both dialysis and
 * government DBs for rows where sale_date IS NULL and log them so we
 * can review and backfill/remove manually. Runs at most once per
 * process lifetime (guarded by `_nullSaleDateAuditDone`).
 */
let _nullSaleDateAuditDone = false;
async function auditNullSaleDates() {
  if (_nullSaleDateAuditDone) return;
  _nullSaleDateAuditDone = true;

  for (const domain of ['dialysis', 'government']) {
    try {
      if (!getDomainCredentials(domain)) continue;
      const selectCols = domain === 'government'
        ? 'sale_id,property_id,sale_date,sold_price,buyer,seller,transaction_type,data_source'
        : 'sale_id,property_id,sale_date,sold_price,buyer_name,seller_name,transaction_type,notes,data_source';
      const result = await domainQuery(domain, 'GET',
        `sales_transactions?sale_date=is.null&select=${selectCols}&limit=500`
      );
      if (!result.ok) {
        console.error(
          `[null-sale-date-audit] ${domain}: query failed status=${result.status}`
        );
        continue;
      }
      const rows = result.data || [];
      if (!rows.length) {
        console.log(`[null-sale-date-audit] ${domain}: clean, 0 null-sale_date rows`);
        continue;
      }
      console.warn(
        `[null-sale-date-audit] ${domain}: ${rows.length} sales_transactions rows have sale_date IS NULL — review manually`
      );
      for (const row of rows) {
        console.warn(`[null-sale-date-audit] ${domain} row`, JSON.stringify(row));
      }
    } catch (err) {
      console.error(
        `[null-sale-date-audit] ${domain}: error`,
        err?.message || err
      );
    }
  }
}

/**
 * Find the available_listings.listing_id that best represents the listing
 * campaign a given sale came from. Matches on property_id with a
 * listing_date within 180 days of sale_date — the closest preceding
 * listing wins; if none precede, the closest listing within the 180-day
 * window (future direction) is used. Returns null when no listing is in
 * range, signalling an off-market / private sale.
 *
 * Dialysis only (government sales_transactions has no listing_sale_id
 * column in the current schema).
 */
async function findMatchingListingForSale(domain, propertyId, saleDate) {
  if (domain !== 'dialysis') return null;
  const datePart = String(saleDate || '').split('T')[0];
  if (!datePart) return null;
  try {
    const propertyIdInt = parseInt(propertyId, 10);
    const lookup = await domainQuery('dialysis', 'GET',
      `available_listings?property_id=eq.${propertyIdInt}` +
      `&select=listing_id,listing_date&limit=200`
    );
    if (!lookup.ok || !Array.isArray(lookup.data) || !lookup.data.length) {
      return null;
    }
    const saleMs = new Date(datePart).getTime();
    const WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
    let best = null;
    for (const row of lookup.data) {
      if (!row.listing_date) continue;
      const listMs = new Date(String(row.listing_date).split('T')[0]).getTime();
      if (!Number.isFinite(listMs)) continue;
      const diff = saleMs - listMs; // positive = listing preceded sale
      if (Math.abs(diff) > WINDOW_MS) continue;
      // Prefer listings that preceded the sale; among those pick closest.
      const candidate = { listingId: row.listing_id, diff };
      if (!best) { best = candidate; continue; }
      const bestPreceded = best.diff >= 0;
      const candPreceded = candidate.diff >= 0;
      if (bestPreceded && !candPreceded) continue;
      if (!bestPreceded && candPreceded) { best = candidate; continue; }
      if (Math.abs(candidate.diff) < Math.abs(best.diff)) best = candidate;
    }
    return best?.listingId ?? null;
  } catch (err) {
    console.error('[listing-match] error', {
      domain, propertyId, saleDate: datePart, error: err?.message || String(err),
    });
    return null;
  }
}

/**
 * After a listing is inserted or updated, link any sales_transactions rows
 * for the same property whose sale_date is within 180 days of this
 * listing's listing_date and which currently have listing_sale_id=null.
 * This handles the normal pipeline ordering (sales written before the
 * listing that produced them): the sale-time match returns null for the
 * just-being-created listing, then this backfill associates them.
 * Dialysis only. Never throws.
 */
async function backfillListingSaleIdForListing(domain, { listingId, propertyId, listingDate }) {
  if (domain !== 'dialysis') return 0;
  if (listingId == null) return 0;
  const listDatePart = String(listingDate || '').split('T')[0];
  if (!listDatePart) return 0;
  try {
    const listMs = new Date(listDatePart).getTime();
    if (!Number.isFinite(listMs)) return 0;
    const WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
    const loStr = new Date(listMs - WINDOW_MS).toISOString().split('T')[0];
    const hiStr = new Date(listMs + WINDOW_MS).toISOString().split('T')[0];
    const patchPath =
      `sales_transactions?property_id=eq.${propertyId}` +
      `&sale_date=gte.${loStr}&sale_date=lte.${hiStr}` +
      `&listing_sale_id=is.null`;
    const res = await domainPatch('dialysis', patchPath,
      { listing_sale_id: listingId },
      'backfillListingSaleIdForListing'
    );
    if (res?.ok !== false) {
      console.log(
        `[listing-backfill] domain=dialysis listing_id=${listingId} ` +
        `property_id=${propertyId} window=${loStr}..${hiStr}`
      );
    }
    return 1;
  } catch (err) {
    console.error('[listing-backfill] error', {
      listingId, propertyId, listingDate: listDatePart,
      error: err?.message || String(err),
    });
    return 0;
  }
}

/**
 * After a sales_transactions row is written for a property, close any
 * available_listings rows still flagged as active/Active for the same
 * property. Applies to both dialysis and government domains, using each
 * domain's native column set:
 *   dialysis:   is_active=false, status='Sold', sold_date, off_market_date,
 *               sale_transaction_id (when provided), sold_price (when provided)
 *   government: listing_status='Sold', off_market_date, updated_at
 * Logs one line per closed listing with the [listing-close] prefix.
 * Never throws — listing-close failures must not abort the sales write.
 *
 * @param {'dialysis'|'government'} domain
 * @param {string|number} propertyId
 * @param {string} saleDate        — YYYY-MM-DD (sale_date of the transaction)
 * @param {number|null} [soldPrice] — sold_price from that sales_transactions
 *                                    row; written onto the dialysis listing
 *                                    row as sold_price.
 * @param {number|null} [saleId]   — sales_transactions.sale_id of the sale that
 *                                   just closed; written onto the dialysis
 *                                   listing row as sale_transaction_id (see
 *                                   the available_listings_sale_fk migration).
 *                                   Omit when no confirmed sale_id is available.
 */
async function closeActiveListingsOnSale(domain, propertyId, saleDate, soldPrice, saleId = null) {
  const datePart = String(saleDate || '').split('T')[0];
  if (!datePart) return 0;
  const priceNum = soldPrice != null && Number.isFinite(Number(soldPrice)) && Number(soldPrice) > 0
    ? Number(soldPrice)
    : null;
  const saleIdNum = Number.isFinite(Number(saleId)) && Number(saleId) > 0
    ? Number(saleId)
    : null;
  try {
    if (domain === 'dialysis') {
      const propertyIdInt = parseInt(propertyId, 10);
      const lookup = await domainQuery('dialysis', 'GET',
        `available_listings?property_id=eq.${propertyIdInt}` +
        `&is_active=is.true&select=listing_id,listing_date&limit=100`
      );
      if (!lookup.ok || !Array.isArray(lookup.data) || !lookup.data.length) return 0;
      let closed = 0;
      for (const row of lookup.data) {
        const listingId = row.listing_id;
        const patch = {
          is_active:        false,
          status:           'Sold',
          sold_date:        datePart,
          off_market_date:  datePart,
        };
        if (priceNum != null) patch.sold_price = priceNum;
        if (saleIdNum != null) patch.sale_transaction_id = saleIdNum;
        const res = await domainPatch('dialysis',
          `available_listings?listing_id=eq.${listingId}`,
          patch,
          'closeActiveListingsOnSale'
        );
        if (res?.ok !== false) {
          console.log(
            `[listing-close] domain=dialysis listing_id=${listingId} ` +
            `property_id=${propertyIdInt} sale_date=${datePart}` +
            (priceNum != null ? ` sold_price=${priceNum}` : '') +
            (saleIdNum != null ? ` sale_transaction_id=${saleIdNum}` : '')
          );
          closed++;
        }
      }
      return closed;
    }

    if (domain === 'government') {
      const lookup = await domainQuery('government', 'GET',
        `available_listings?property_id=eq.${propertyId}` +
        `&listing_status=eq.Active&select=listing_id,listing_date&limit=100`
      );
      if (!lookup.ok || !Array.isArray(lookup.data) || !lookup.data.length) return 0;
      const target = pickClosestListing(lookup.data);
      if (!target) {
        console.log(
          `[listing-close] domain=government property_id=${propertyId} ` +
          `sale_date=${datePart} skipped=no_match_in_3yr_window ` +
          `candidates=${lookup.data.length}`
        );
        return 0;
      }
      const listingId = target.listing_id;
      const patch = {
        listing_status:   'Sold',
        off_market_date:  datePart,
        updated_at:       new Date().toISOString(),
      };
      const res = await domainPatch('government',
        `available_listings?listing_id=eq.${listingId}`,
        patch,
        'closeActiveListingsOnSale'
      );
      if (res?.ok !== false) {
        console.log(
          `[listing-close] domain=government listing_id=${listingId} ` +
          `property_id=${propertyId} sale_date=${datePart} ` +
          `listing_date=${target.listing_date || 'null'}`
        );
        return 1;
      }
      return 0;
    }
  } catch (err) {
    console.error('[listing-close] error', {
      domain, propertyId, saleDate: datePart, error: err?.message || String(err),
    });
  }
  return 0;
}

/**
 * Upsert sales transactions in the domain database.
 * Matches by property_id + sale_date + sold_price for deduplication.
 */
async function upsertDomainSales(domain, propertyId, entity, metadata) {
  const sales = metadata.sales_history;
  if (!Array.isArray(sales) || sales.length === 0) return 0;

  const parsedSF = parseSF(metadata.square_footage);
  const primaryTenant = cleanTenantValue(selectPrimaryTenant(metadata, domain));

  // ── Sale Notes extraction ──────────────────────────────────────────────
  const saleNotesRaw = metadata.sale_notes_raw || null;
  const saleNotesExtracted = parseSaleNotes(saleNotesRaw);

  // Cross-reference sale notes values against structured fields
  if (saleNotesRaw && Object.keys(saleNotesExtracted).length > 0) {
    // NOI + cap rate → price validation
    if (saleNotesExtracted.noi && saleNotesExtracted.stated_cap_rate) {
      const impliedPrice = Math.round(saleNotesExtracted.noi / (saleNotesExtracted.stated_cap_rate / 100));
      console.log(`[sale-notes-xref] NOI=$${saleNotesExtracted.noi} / ${saleNotesExtracted.stated_cap_rate}% = implied price $${impliedPrice.toLocaleString()}`);
    }
    // Building SF cross-reference
    if (saleNotesExtracted.building_sf && parsedSF) {
      const sfDelta = Math.abs(saleNotesExtracted.building_sf - parsedSF);
      if (sfDelta > 100) {
        console.log(`[sale-notes-xref] SF mismatch: notes=${saleNotesExtracted.building_sf} vs RBA=${parsedSF} (delta=${sfDelta})`);
      }
    }
  }

  // Identify the "most recent" sale — the one whose sale_date most closely
  // matches the CoStar Last Sale Date stat-card value. Only that row may
  // carry the CoStar-stated cap rate; historical deed rows predate the
  // current listing and must not inherit its cap rate.
  const statCardLastSaleDate = parseDate(metadata.last_sale_date || metadata.sale_date);
  let mostRecentSaleDatePart = null;
  {
    const dated = sales
      .map(s => parseDate(s.sale_date))
      .filter(Boolean)
      .map(d => d.split('T')[0]);
    if (dated.length) {
      if (statCardLastSaleDate) {
        const target = new Date(statCardLastSaleDate.split('T')[0]).getTime();
        dated.sort((a, b) =>
          Math.abs(new Date(a).getTime() - target) -
          Math.abs(new Date(b).getTime() - target));
      } else {
        dated.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      }
      mostRecentSaleDatePart = dated[0];
    }
  }

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

    const lookupSelect = domain === 'government'
      ? 'sale_id,sale_date'
      : 'sale_id,sale_date,sold_price,stated_cap_rate,calculated_cap_rate,cap_rate_confidence';
    const lookupPath =
      `sales_transactions?property_id=eq.${propertyId}` +
      `&sale_date=gte.${loStr}&sale_date=lte.${hiStr}` +
      `&select=${lookupSelect}&limit=1`;
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

    // Cap-rate gating: only the most-recent sale (matching CoStar's Last
    // Sale Date) with a real sold_price may carry the CoStar-stated cap
    // rate. Historical deed rows still record provenance
    // (confidence='low', rent_source='costar_stated') but get
    // stated_cap_rate=NULL so they no longer inherit the current
    // listing's cap rate. sale_date-null rows are already skipped above.
    const isMostRecentSale = datePart === mostRecentSaleDatePart;
    const allowStatedCapRate =
      isMostRecentSale && soldPrice != null && capRateVal != null;

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
      : {
          // Cap rate provenance: raw CoStar value is "stated" with low
          // confidence until an OM or lease confirms it. calculated_cap_rate
          // and rent_at_sale are intentionally left null here — they are
          // populated downstream when confirmed rent data arrives.
          // Only the most-recent sale gets the stated cap rate value;
          // historical rows keep provenance but no value. The explicit
          // null on stated_cap_rate is re-applied after stripNulls below
          // so PATCHes clear any previously-written stat-card value.
          stated_cap_rate:     allowStatedCapRate ? capRateVal : null,
          cap_rate_confidence: 'low',
          rent_source:         'costar_stated',
          buyer_name:       buyerVal,
          seller_name:      sellerVal,
          procuring_broker: procuringBrokerVal,
        };

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
          saleNotesRaw ? `--- Sale Notes ---\n${saleNotesRaw}` : null,
        ].filter(Boolean).join('; ') || null,
        sale_notes_raw: saleNotesRaw,
        sale_notes_extracted: Object.keys(saleNotesExtracted).length > 0
          ? saleNotesExtracted : null,
      } : {}),
    });
    if (transaction_type !== null) saleData.transaction_type = transaction_type;
    // Always write exclude flag since false is a valid value that should persist
    saleData.exclude_from_market_metrics = exclude_from_market_metrics ?? false;
    saleData.data_source                = 'costar_sidebar';

    // Link the sale to the listing campaign that produced it, if any.
    // Only written for dialysis — government sales_transactions does not
    // carry a listing_sale_id column. Nullable: off-market sales or sales
    // that predate any captured listing get null and stay unlinked.
    if (domain === 'dialysis') {
      const matchedListingId = await findMatchingListingForSale(
        domain, propertyId, datePart
      );
      if (matchedListingId != null) {
        saleData.listing_sale_id = matchedListingId;
      }
    }
    // Re-apply explicit null on historical dialysis rows: stripNulls above
    // removes null values, but PATCH must actively clear stated_cap_rate
    // on rows that previously inherited the stat-card cap rate.
    if (domain !== 'government' && !allowStatedCapRate) {
      saleData.stated_cap_rate = null;
    }

    // Guard: block listing/asking-price rows from being written into
    // sales_transactions. A valid sale requires a parseable sale_date, a
    // positive sold_price, and no listing/asking/on-market markers in
    // transaction_type or notes. Any failure reroutes the record to
    // available_listings as an off-market listing.
    const txTypeForGuard = [
      saleData.transaction_type,
      sale.transaction_type,
      sale.sale_type,
    ].filter(Boolean).join(' | ');
    const notesForGuard = saleData.notes || '';
    const priceNum = Number(saleData.sold_price);
    const hasParseableDate = !!parseDate(saleData.sale_date);
    const hasPositivePrice = Number.isFinite(priceNum) && priceNum > 0;
    const hasListingTxMarker = /(listing|asking|on[\s-]?market)/i.test(txTypeForGuard);
    const hasOnMarketNotes = /on[\s-]?market/i.test(notesForGuard);

    if (!hasParseableDate || !hasPositivePrice
        || hasListingTxMarker || hasOnMarketNotes) {
      await routeListingMisroute(domain, propertyId, saleData, {
        invalid_date: !hasParseableDate,
        invalid_price: !hasPositivePrice,
        listing_transaction_type: hasListingTxMarker,
        on_market_notes: hasOnMarketNotes,
      });
      continue;
    }

    if (lookup.ok && lookup.data?.length) {
      const existing = lookup.data[0];

      // Tighter dialysis dedup: if an existing row is within 30 days of the
      // incoming sale_date AND within 2% of the incoming sold_price, treat
      // it as the same economic transaction (deed date vs. contract date vs.
      // recording date variants) and skip entirely. Land sales can
      // legitimately cluster, so skip this tighter check when the price is
      // under $1M and no tenant is present.
      if (domain === 'dialysis'
          && soldPrice != null
          && existing.sold_price != null) {
        const isLandSale = soldPrice < 1_000_000 && !primaryTenant;
        if (!isLandSale) {
          const existingDatePart = String(existing.sale_date).split('T')[0];
          const existingTime = new Date(existingDatePart).getTime();
          const incomingTime = new Date(datePart).getTime();
          const daysDiff = Math.abs(existingTime - incomingTime) / (1000 * 60 * 60 * 24);
          const existingPrice = Number(existing.sold_price);
          const priceDelta = existingPrice > 0
            ? Math.abs(existingPrice - soldPrice) / existingPrice
            : Infinity;
          if (daysDiff <= 30 && priceDelta <= 0.02) {
            console.log(
              `[sales-dedup] skipping duplicate property=${propertyId} ` +
              `existing_date=${existingDatePart} existing_price=${existingPrice} ` +
              `incoming_date=${datePart} incoming_price=${soldPrice} ` +
              `days_diff=${daysDiff.toFixed(1)} price_delta=${(priceDelta * 100).toFixed(2)}%`
            );
            continue;
          }
        }
      }

      // Update existing
      let patchData = saleData;

      // Preserve confirmed cap rate data: if a sale already has a
      // calculated_cap_rate and its confidence is medium/high, the CoStar
      // stated value must not downgrade confidence or clobber the anchor
      // rent source. Only refresh stated_cap_rate, and only if it changed.
      if (domain !== 'government'
          && existing.calculated_cap_rate != null
          && (existing.cap_rate_confidence === 'medium'
              || existing.cap_rate_confidence === 'high')) {
        patchData = { ...saleData };
        delete patchData.cap_rate_confidence;
        delete patchData.rent_source;
        const newStated = patchData.stated_cap_rate;
        const existingStated = existing.stated_cap_rate != null
          ? Number(existing.stated_cap_rate) : null;
        if (newStated == null || existingStated === Number(newStated)) {
          delete patchData.stated_cap_rate;
        }
      }

      await domainPatch(domain,
        `sales_transactions?sale_id=eq.${existing.sale_id}`, patchData, 'upsertDomainSales');
      // Close any still-active listings for this property now that a
      // confirmed sale exists. Fire-and-forget relative to the sale write —
      // failures are logged but do not affect the sales_transactions result.
      // Pass the existing sale_id + incoming soldPrice so the dialysis
      // listing row persists sale_transaction_id + sold_price (see the
      // available_listings_sale_fk migration).
      await closeActiveListingsOnSale(
        domain, propertyId, datePart, saleData.sold_price, existing.sale_id
      );
    } else {
      // Create new
      const result = await domainQuery(domain, 'POST', 'sales_transactions', saleData);
      if (result.ok) {
        count++;
        // Create BD alert for new dialysis sale capture (gov uses sf_comps_staging)
        if (domain === 'dialysis') {
          await createSaleAlert(propertyId, saleData);
        }
        // Close any still-active listings for this property on a new sale.
        // The POST uses Prefer: return=representation (see domain-db.js) so
        // result.data is the inserted row(s) — grab sale_id off it to stamp
        // onto the dialysis listing row as sale_transaction_id.
        const inserted = Array.isArray(result.data) ? result.data[0] : result.data;
        const newSaleId = inserted?.sale_id ?? null;
        await closeActiveListingsOnSale(
          domain, propertyId, datePart, saleData.sold_price, newSaleId
        );
      }
    }
  }

  return count;
}

// ── Alert BD team on new dialysis sale capture ──────────────────────────────
async function createSaleAlert(propertyId, saleData) {
  const price = saleData.sold_price
    ? '$' + Number(saleData.sold_price).toLocaleString(undefined, { maximumFractionDigits: 0 })
    : 'undisclosed price';
  const capRate = saleData.stated_cap_rate ? ` at ${saleData.stated_cap_rate}% cap` : '';
  const buyer = saleData.buyer_name || 'unknown buyer';

  await domainQuery('dialysis', 'POST', 'alerts_unified', {
    entity_type:   'property',
    entity_id:     String(propertyId),
    alert_type:    'new_sale',
    priority:      'high',
    title:         `New sale captured via CoStar`,
    message:       `Sold to ${buyer} for ${price}${capRate} on ${saleData.sale_date}`,
    data_source:   'costar_sidebar',
    is_resolved:   false,
    created_at:    new Date().toISOString(),
  });
}

// ── Auto-stage gov comp for Salesforce sync ─────────────────────────────────
async function stageGovCompForSalesforce(propertyId, entity, metadata) {
  // Check if already staged for this property + most recent sale date
  const mostRecentSale = (metadata.sales_history || [])
    .filter(s => s.sale_date)
    .sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date))[0];
  if (!mostRecentSale) return;

  const saleDate = parseDate(mostRecentSale.sale_date)?.split('T')[0];
  if (!saleDate) return;

  // Check for existing staging row
  const existing = await domainQuery('government', 'GET',
    `sf_comps_staging?address=eq.${encodeURIComponent(entity.address || '')}` +
    `&sale_date=eq.${saleDate}&select=id&limit=1`
  );
  if (existing.ok && existing.data?.length) return; // already staged

  const buyerContact = (metadata.contacts || []).find(c => c.role === 'buyer');
  const sellerContact = (metadata.contacts || []).find(c => c.role === 'seller');

  await domainQuery('government', 'POST', 'sf_comps_staging', {
    address:        entity.address || null,
    city:           entity.city    || null,
    state:          entity.state   || null,
    sale_date:      saleDate,
    sale_price:     parseCurrency(mostRecentSale.sale_price),
    cap_rate:       parsePercent(mostRecentSale.cap_rate),
    buyer_name:     buyerContact?.name || mostRecentSale.buyer || null,
    seller_name:    sellerContact?.name || mostRecentSale.seller || null,
    square_feet:    parseSF(metadata.square_footage),
    property_id:    propertyId,
    data_source:    'costar_sidebar',
    sync_status:    'pending',
    created_at:     new Date().toISOString(),
  });
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
 * Government deed_records has no property_id — it uses parcel_id (UUID FK to
 * parcel_records).  Since we may not have a parcel UUID, we write with
 * available fields only, using document_number as the dedup key.
 * Filters out mortgage-type deeds via MORTGAGE_DEED_TYPES.
 */
async function upsertGovernmentDeedRecords(entity, metadata) {
  const deedSales = (metadata.sales_history || []).filter(s =>
    s.document_number &&
    s.deed_type &&
    !MORTGAGE_DEED_TYPES.test(s.deed_type)
  );
  if (deedSales.length === 0) return 0;

  let count = 0;
  for (const sale of deedSales) {
    const dataHash = Buffer.from(
      `${sale.document_number}|${entity.state || ''}|${sale.sale_date || ''}`
    ).toString('base64');

    const existing = await domainQuery('government', 'GET',
      `deed_records?data_hash=eq.${encodeURIComponent(dataHash)}&select=deed_id&limit=1`
    );
    if (existing.ok && existing.data?.length) continue;

    const dateStr = parseDate(sale.recordation_date || sale.sale_date)
      ?.split('T')[0] || null;

    const r = await domainQuery('government', 'POST', 'deed_records', {
      document_number: sale.document_number,
      deed_type:       sale.deed_type || null,
      grantor:         sale.seller    || null,
      grantee:         sale.buyer     || null,
      recording_date:  dateStr,
      consideration:   parseCurrency(sale.sale_price),
      county:          entity.county  || null,
      state_code:      entity.state   || null,
      data_hash:       dataHash,
      raw_payload:     sale,
    });
    if (r.ok) count++;
  }
  return count;
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

  // Reconcile: set properties.recorded_owner_id to the most-recent
  // ownership_history buyer, and update current_value_estimate from the
  // latest sold_price.  This covers the gap where CoStar sidebar ingests
  // a new sale (with buyer) but never explicitly marks that buyer as
  // role=owner in contacts.
  await reconcilePropertyOwnership(domain, propertyId);

  return results;
}

// ── Ownership reconciliation ───────────────────────────────────────────────
// Ensures properties.recorded_owner_id always points to the most-recent buyer
// from ownership_history, and back-fills current_value_estimate from the latest
// sold_price.  Called per-property after upsertDomainOwners and also exposed
// for batch repair via admin diagnostics.

export async function reconcilePropertyOwnership(domain, propertyId) {
  const dateCol  = domain === 'government' ? 'transfer_date' : 'ownership_start';
  const priceCol = domain === 'government' ? 'transfer_price' : 'sold_price';

  // 1. Fetch the most recent ownership_history record for this property
  const ohRes = await domainQuery(domain, 'GET',
    `ownership_history?property_id=eq.${propertyId}` +
    `&recorded_owner_id=not.is.null` +
    `&order=${dateCol}.desc.nullslast` +
    `&select=recorded_owner_id,${dateCol},${priceCol}` +
    `&limit=1`
  );
  if (!ohRes.ok || !ohRes.data?.length) return { updated: false };

  const latest = ohRes.data[0];
  const latestOwnerId = latest.recorded_owner_id;
  const latestDate    = latest[dateCol];
  const latestPrice   = latest[priceCol];

  // 2. Fetch the property's current recorded_owner_id so we know whether to
  //    update.  Also grab the current owner's transfer date for comparison.
  const propRes = await domainQuery(domain, 'GET',
    `properties?property_id=eq.${propertyId}` +
    `&select=recorded_owner_id,current_value_estimate` +
    `&limit=1`
  );
  if (!propRes.ok || !propRes.data?.length) return { updated: false };

  const prop = propRes.data[0];
  const patch = {};

  // If the property already points to this owner, skip the owner update but
  // still check whether current_value_estimate needs back-filling.
  if (prop.recorded_owner_id !== latestOwnerId) {
    // Verify the new owner is actually newer than the existing one
    if (prop.recorded_owner_id && latestDate) {
      const curOwnerOh = await domainQuery(domain, 'GET',
        `ownership_history?property_id=eq.${propertyId}` +
        `&recorded_owner_id=eq.${prop.recorded_owner_id}` +
        `&order=${dateCol}.desc.nullslast` +
        `&select=${dateCol}` +
        `&limit=1`
      );
      if (curOwnerOh.ok && curOwnerOh.data?.length) {
        const curDate = curOwnerOh.data[0][dateCol];
        if (curDate && new Date(curDate) >= new Date(latestDate)) {
          // Current owner is same-date-or-newer; don't overwrite
          return { updated: false, reason: 'current_owner_is_newer' };
        }
      }
    }
    patch.recorded_owner_id = latestOwnerId;
    patch.true_owner_id    = latestOwnerId;

    // 2b. Back-fill recorded_owner_name (and true_owner_name if available)
    //     from the recorded_owners / true_owners tables so the denormalized
    //     cache on the properties row stays in sync with the new owner ID.
    const roRes = await domainQuery(domain, 'GET',
      `recorded_owners?recorded_owner_id=eq.${latestOwnerId}` +
      `&select=name,true_owner_id` +
      `&limit=1`
    );
    if (roRes.ok && roRes.data?.length) {
      const ro = roRes.data[0];
      if (ro.name) patch.recorded_owner_name = ro.name;
      if (ro.true_owner_id) {
        const truRes = await domainQuery(domain, 'GET',
          `true_owners?true_owner_id=eq.${ro.true_owner_id}` +
          `&select=name` +
          `&limit=1`
        );
        if (truRes.ok && truRes.data?.length && truRes.data[0].name) {
          patch.true_owner_name = truRes.data[0].name;
        }
      }
    }
  }

  // 3. Back-fill current_value_estimate from the latest sold price
  if (latestPrice && !prop.current_value_estimate) {
    patch.current_value_estimate = latestPrice;
  }

  if (Object.keys(patch).length === 0) return { updated: false, reason: 'no_change' };

  await domainPatch(domain,
    `properties?property_id=eq.${propertyId}`,
    patch,
    'reconcilePropertyOwnership'
  );
  return { updated: true, patch };
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

    // Reject CoStar classification labels that slip in as contact entries
    const CONTACT_LABEL_REJECT = /^(public|private|local|national|institutional|corporation|individual|other|buyer\s+contacts|seller\s+contacts|public\s+reit|user|managing\s+partner|country\s+of\s+origin|buyer\s+origin|seller\s+origin|buyer\s+type|seller\s+type|secondary\s+type|activity|sale\s+notes|documents|deed)$/i;

    const cleanedContacts = individualContacts.filter(c =>
      c.name &&
      c.name.length > 3 &&
      !CONTACT_LABEL_REJECT.test(c.name.trim()) &&
      (c.name.includes(' ') || c.phones?.length || c.email)
    );

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
    const contact1 = cleanedContacts[0]?.name || null;
    const contact2 = cleanedContacts[1]?.name || null;
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

  // Determine data_source and source_confidence based on origin
  const leaseDataSource = metadata._intake_promoted
    ? 'email_intake'
    : 'costar_sidebar';
  // Dialysis leases.source_confidence CHECK: 'documented' | 'estimated' | 'inferred'
  // lease_abstract docs → 'documented'; OM / other intake → 'estimated'
  const leaseConfidence = metadata._intake_promoted
    ? (metadata.document_type === 'lease_abstract' ? 'documented' : 'estimated')
    : 'estimated';

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
        data_source: leaseDataSource,
        source_confidence: leaseConfidence,
      });
    }
  } else {
    // Fallback: single lease from top-level metadata fields
    const tenantName = metadata.tenant_name || metadata.primary_tenant;
    if (!tenantName) return 0;

    leaseRecords.push({
      property_id: propertyId,
      tenant: tenantName,
      leased_area: parseSF(metadata.sf_leased),
      lease_start: parseDate(metadata.lease_commencement),
      lease_expiration: parseDate(metadata.lease_expiration),
      expense_structure: metadata.expense_structure || metadata.lease_type,
      rent_per_sf: parseCurrency(metadata.rent_per_sf),
      annual_rent: parseCurrency(metadata.annual_rent),
      renewal_options: metadata.renewal_options || null,
      guarantor: metadata.guarantor || null,
      status: 'active',
      is_active: true,
      data_source: leaseDataSource,
      source_confidence: leaseConfidence,
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
    let leaseId = null;
    if (existingTenants.has(tenantKey)) {
      // PATCH existing lease — find its lease_id and update
      const existingLease = existing.data.find(
        l => l.tenant?.toLowerCase().trim() === tenantKey
      );
      const { property_id: _pid, ...patchData } = cleaned;
      await domainPatch(domain,
        `leases?lease_id=eq.${existingLease.lease_id}`, patchData, 'upsertDomainLeases');
      leaseId = existingLease.lease_id;
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
      leaseId = Array.isArray(result.data) ? result.data[0]?.lease_id : result.data?.lease_id;
    }

    // Write escalation data from CoStar estimated rent range
    if (domain === 'dialysis' && leaseId) {
      await upsertLeaseEscalations(propertyId, leaseId, metadata);

      // ── Lease field provenance: track underwriting-critical fields ──
      // Uses upsert_lease_field() which checks source tier before overwriting,
      // so CoStar data (tier 5) never clobbers lease-document data (tier 1-3).
      //
      // When data arrives via intake promotion (_intake_promoted), the source
      // tier is determined by the document type:
      //   lease_abstract → tier 1 (lease_document)
      //   om             → tier 3 (om_lease_abstract)
      //   otherwise      → tier 4 (broker_package)
      const isIntake = metadata._intake_promoted === true;
      const intakeDocType = metadata.document_type;
      const intakeTier = intakeDocType === 'lease_abstract' ? 1
        : intakeDocType === 'om' ? 3
        : 4;
      const sourceTier   = isIntake ? intakeTier : 5;
      const sourceLabel  = isIntake
        ? (intakeDocType === 'lease_abstract' ? 'lease_document'
           : intakeDocType === 'om' ? 'om_lease_abstract'
           : 'broker_package')
        : 'costar_verified';
      const capturedBy   = isIntake ? 'intake_pipeline' : 'sidebar_pipeline';
      const sourceFile   = isIntake ? (metadata._intake_source || null) : null;
      const provenanceNote = isIntake
        ? `Auto-captured from intake promotion (${intakeDocType || 'unknown'} document)`
        : 'Auto-captured from CoStar sidebar ingestion';

      const provenanceFields = {
        expense_structure: record.expense_structure,
        rent:              record.annual_rent,
        rent_per_sf:       record.rent_per_sf,
        leased_area:       record.leased_area,
        roof_responsibility:      metadata.roof_responsibility || null,
        hvac_responsibility:      metadata.hvac_responsibility || null,
        structure_responsibility: metadata.structure_responsibility || null,
        parking_responsibility:   metadata.parking_responsibility || null,
      };
      for (const [field, value] of Object.entries(provenanceFields)) {
        if (value == null) continue;
        await domainQuery(domain, 'POST', 'rpc/upsert_lease_field', {
          p_lease_id:      leaseId,
          p_field_name:    field,
          p_field_value:   String(value),
          p_source_tier:   sourceTier,
          p_source_label:  sourceLabel,
          p_captured_by:   capturedBy,
          p_source_file:   sourceFile,
          p_source_detail: null,
          p_notes:         provenanceNote,
        });
      }

      // Sync expense_structure_canonical from the mapping table
      if (record.expense_structure) {
        const canonical = await domainQuery(domain, 'GET',
          `expense_structure_canonical?raw_value=eq.${encodeURIComponent(record.expense_structure)}&select=canonical&limit=1`
        );
        if (canonical.ok && canonical.data?.[0]?.canonical) {
          await domainPatch(domain,
            `leases?lease_id=eq.${leaseId}`,
            { expense_structure_canonical: canonical.data[0].canonical },
            'upsertDomainLeases:canonical'
          );
        }
      }
    }
  }

  return count;
}

// ── Step 5e-ii: Upsert lease_escalations (CoStar rent band) ───────────────

/**
 * Parse CoStar estimated rent range (e.g. "$24 - 29/NNN (Office)") and
 * write a lease_escalations row capturing the rent band.
 * Skips if the lease already has a costar_sidebar escalation row.
 */
async function upsertLeaseEscalations(propertyId, leaseId, metadata) {
  const estRent = metadata.est_rent;
  if (!estRent) return 0;

  // Parse "$24 - 29/NNN" → low: 24, high: 29, structure: NNN
  const match = estRent.match(/\$?([\d.]+)\s*[-–]\s*([\d.]+)\s*\/([\w\s]+)/);
  if (!match) return 0;

  const rentLow     = parseFloat(match[1]);
  const rentHigh    = parseFloat(match[2]);
  const structure   = match[3].trim().split(' ')[0]; // "NNN", "FS", "MG"
  const midpoint    = Math.round((rentLow + rentHigh) / 2 * 100) / 100;

  // Check if already have an escalation row for this lease from sidebar
  const existing = await domainQuery('dialysis', 'GET',
    `lease_escalations?lease_id=eq.${leaseId}&data_source=eq.costar_sidebar&select=id&limit=1`
  );
  if (existing.ok && existing.data?.length) return 0;

  const r = await domainQuery('dialysis', 'POST', 'lease_escalations', {
    lease_id:           leaseId,
    property_id:        parseInt(propertyId, 10),
    rent_low_psf:       rentLow,
    rent_high_psf:      rentHigh,
    rent_estimate_psf:  midpoint,
    expense_structure:  structure,
    escalation_source:  'costar_estimate',
    data_source:        'costar_sidebar',
    effective_date:     new Date().toISOString().split('T')[0],
  });
  return r.ok ? 1 : 0;
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

  // Listing cap rate — sourced ONLY from the CoStar listing cap rate field
  // (the one tied to the current asking price). Must never be derived from
  // a historical sale's calculated_cap_rate or sold_cap_rate. Named
  // distinctly from the sales-context capRate/cap_rate to keep the source
  // unambiguous in code review.
  const listingCapRate = parsePercent(metadata.cap_rate);

  const record = stripNulls({
    property_id: propertyIdInt,
    initial_price: parseCurrency(metadata.asking_price),
    last_price: parseCurrency(metadata.asking_price),
    current_cap_rate: listingCapRate,
    cap_rate: listingCapRate,
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

  // Dedup: an existing active listing whose listing_date is within 90 days
  // of now represents the SAME listing campaign — PATCH it in place. An
  // older active listing (>90 days) is a separate prior campaign for the
  // same property; we leave it alone and INSERT a new row for the new
  // campaign (avoids collapsing distinct campaigns into a single listing
  // record that then gets associated with multiple sales).
  const ingestionDatePart = new Date().toISOString().split('T')[0];
  const ninetyDaysAgoPart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
  const lookup = await domainQuery('dialysis', 'GET',
    `available_listings?property_id=eq.${propertyIdInt}` +
    `&is_active=is.true` +
    `&listing_date=gte.${ninetyDaysAgoPart}` +
    `&select=listing_id,listing_date` +
    `&order=listing_date.desc.nullslast&limit=1`
  );

  let currentListingId = null;

  if (lookup.ok && lookup.data?.length) {
    // Update price and cap rate on the in-window active listing. listingCapRate
    // comes only from metadata.cap_rate (the CoStar listing's asking cap
    // rate); never from a sale-derived calculated/sold cap rate.
    currentListingId = lookup.data[0].listing_id;
    const patchData = stripNulls({
      last_price: parseCurrency(metadata.asking_price),
      current_cap_rate: listingCapRate,
      cap_rate: listingCapRate,
      price_per_sf: safePricePsf,
    });
    // Also update broker fields if currently empty
    if (primaryBroker?.name)  patchData.listing_broker = primaryBroker.name;
    if (primaryBroker?.email) patchData.broker_email   = primaryBroker.email;
    await domainPatch('dialysis',
      `available_listings?listing_id=eq.${currentListingId}`,
      patchData, 'upsertDialysisListings'
    );
    await backfillListingSaleIdForListing('dialysis', {
      listingId: currentListingId,
      propertyId: propertyIdInt,
      listingDate: lookup.data[0].listing_date || ingestionDatePart,
    });
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

  // Recover the new listing_id from the insert response (PostgREST returns
  // the row when Prefer: return=representation is set — domainQuery sets it
  // for POSTs). Fall back to a property_id lookup if unavailable.
  if (Array.isArray(result.data) && result.data.length && result.data[0].listing_id != null) {
    currentListingId = result.data[0].listing_id;
  } else if (result.data?.listing_id != null) {
    currentListingId = result.data.listing_id;
  } else {
    const idLookup = await domainQuery('dialysis', 'GET',
      `available_listings?property_id=eq.${propertyIdInt}` +
      `&is_active=is.true&select=listing_id&order=listing_date.desc.nullslast&limit=1`
    );
    currentListingId = idLookup.ok && idLookup.data?.[0]?.listing_id || null;
  }

  if (currentListingId != null) {
    await backfillListingSaleIdForListing('dialysis', {
      listingId: currentListingId,
      propertyId: propertyIdInt,
      listingDate: record.listing_date || ingestionDatePart,
    });
  }

  // Post-insert check: if a closed sale already exists for this property
  // within the last 2 years, immediately close the listing so we don't
  // treat it as a new active listing.
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
  const recentSales = await domainQuery('dialysis', 'GET',
    `sales_transactions?property_id=eq.${propertyIdInt}` +
    `&sale_date=gte.${twoYearsAgo}&select=sale_id,sale_date,sold_price` +
    `&order=sale_date.desc&limit=1`
  );

  if (recentSales.ok && recentSales.data?.length) {
    const latestSale = recentSales.data[0];
    const latestSalePrice = parseCurrency(latestSale.sold_price);
    const latestSaleId = Number.isFinite(Number(latestSale.sale_id))
      && Number(latestSale.sale_id) > 0
        ? Number(latestSale.sale_id) : null;
    // Do NOT copy any sale-derived cap rate into available_listings here.
    // The listing's cap_rate / current_cap_rate columns must only ever
    // reflect the CoStar listing's asking cap rate (listingCapRate above);
    // leaking a sales_transactions cap rate into them was the root cause
    // of the cap-rate-leak bug this branch fixes.
    // Scope the close to the listing we just inserted (not every active
    // listing for the property) — older campaigns stay open per the 3-year
    // rule in closeActiveListingsOnSale.
    //
    // Bulk-close FK linkage: populate sale_transaction_id + sold_price so
    // the closed listing resolves to the specific sales_transactions row
    // that closed it (matched by property_id + closest sale_date above, via
    // the sale_date.desc limit=1 lookup). See available_listings_sale_fk
    // migration.
    const closeFilter = currentListingId != null
      ? `listing_id=eq.${currentListingId}`
      : `property_id=eq.${propertyIdInt}&is_active=is.true`;
    const patch = {
      is_active: false,
      status: 'Sold',
      off_market_date: latestSale.sale_date,
      last_price: latestSalePrice || null,
    };
    if (latestSaleId != null) patch.sale_transaction_id = latestSaleId;
    if (latestSalePrice != null) patch.sold_price = latestSalePrice;
    await domainPatch('dialysis',
      `available_listings?${closeFilter}`,
      patch,
      'upsertDialysisListings:autoClose'
    );
    console.log(
      `[listing-fk-backfill] auto-close property_id=${propertyIdInt} ` +
      `sale_transaction_id=${latestSaleId ?? 'null'} ` +
      `sold_price=${latestSalePrice ?? 'null'} sale_date=${latestSale.sale_date}`
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
 * Dedup: finds ANY existing listing for the property (not just Active).
 *        If Active exists, PATCH it. If non-Active (under_contract/sold/etc),
 *        create a new Active listing. If none exist, INSERT.
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

  // Guard against section-header noise captured as tenant names (e.g. "Buyer")
  const INVALID_TENANT = /^(public\s+record|building|building\s+info|land|market|market\s+data|sources|assessment|investment|not\s+disclosed|none|vacant|available|owner.occupied|confirmed|verified|research|buyer|seller|contacts|name|sf\s+occupied|analytics|reports|data|directory|stacking\s+plan|leasing|for\s+lease|for\s+sale|property\s+info|demographics|transit|walk\s+score)$/i;
  const tenantAgency = [
    metadata.tenants?.[0]?.name,
    metadata.tenant_name,
    metadata.primary_tenant,
  ].find(t => t && t.length > 2 && !INVALID_TENANT.test(t)) || null;

  // Listing cap rate — sourced ONLY from the CoStar listing cap rate field
  // (the one tied to the current asking price). Must never be derived from
  // a historical sale's sold_cap_rate or calculated_cap_rate. Named
  // distinctly from the sales-context capRate to keep the source
  // unambiguous in code review.
  const listingCapRate = parsePercent(metadata.cap_rate);

  const record = stripNulls({
    property_id: propertyId,
    listing_source: 'costar_sidebar',
    address: entity.address || null,
    city: entity.city || null,
    state: entity.state || null,
    square_feet: sfInt != null ? Math.round(sfInt) : null,
    asking_price: parseCurrency(metadata.asking_price),
    asking_cap_rate: listingCapRate,
    asking_price_psf: safeGovPricePsf,
    listing_date: listingDate,
    listing_status: 'Active',
    days_on_market: parseIntSafe(metadata.days_on_market),
    tenant_agency: tenantAgency,
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

  // Dedup: find ANY existing listing for this property (not just Active)
  const lookup = await domainQuery('government', 'GET',
    `available_listings?property_id=eq.${propertyId}` +
    `&select=listing_id,listing_status&order=listing_date.desc.nullslast&limit=1`
  );

  if (lookup.ok && lookup.data?.length) {
    const existing = lookup.data[0];
    if (existing.listing_status === 'Active') {
      // Update existing Active listing
      const { property_id: _pid, ...patchData } = record;
      await domainPatch('government',
        `available_listings?listing_id=eq.${existing.listing_id}`,
        patchData, 'upsertGovListings:update'
      );
      return 0;
    }
    // Existing listing is under_contract/sold/superseded — create new Active
    // (fall through to INSERT below)
  }

  // INSERT new listing
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
    `&sale_date=gte.${twoYearsAgo}&select=sale_id,sale_date,sold_price` +
    `&order=sale_date.desc&limit=1`
  );

  if (recentSales.ok && recentSales.data?.length) {
    const latestSale = recentSales.data[0];
    // Do NOT copy any sale-derived cap rate (sold_cap_rate /
    // calculated_cap_rate) into available_listings.asking_cap_rate here.
    // asking_cap_rate must only ever reflect the CoStar listing's asking
    // cap rate (listingCapRate above); leaking a sales_transactions cap
    // rate into it was the root cause of the cap-rate-leak bug this
    // branch fixes.
    await domainPatch('government',
      `available_listings?property_id=eq.${propertyId}&listing_status=eq.Active`,
      {
        listing_status:  'Sold',
        off_market_date: latestSale.sale_date,
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

  // One-time audit of legacy null-sale_date rows in both domain DBs
  // (fire-and-forget; runs at most once per process lifetime).
  auditNullSaleDates().catch(err =>
    console.error('[null-sale-date-audit] unexpected error', err?.message || err)
  );

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
