// ============================================================================
// OM Lease Abstract Parser — Extracts structured lease data from Offering
// Memoranda (OM) documents
// Life Command Center
//
// OMs are the most valuable document type for lease underwriting because they
// contain the lease summary with responsibility breakdown — tier 3 provenance
// data in the lease_field_provenance system.
//
// The OM "Lease Summary" page for NNN dialysis properties typically contains:
//   - Key-value table (tenant, lease type, term, rent, escalations, guaranty)
//   - Responsibility assignments (taxes, insurance, utilities, roof, HVAC, etc.)
//   - Financial metrics (price, cap rate, NOI)
//   - Landlord obligations paragraph with maintenance detail
//
// Usage:
//   import { parseOmLeaseAbstract, processOmDocument }
//     from './_handlers/om-parser.js';
//
//   const parsed = parseOmLeaseAbstract(rawText);
//   await processOmDocument(domain, leaseId, rawText, 'offering_memo.pdf');
// ============================================================================

import { domainQuery } from '../_shared/domain-db.js';

// ── Key-value patterns from OM lease summary tables ──────────────────────────
const KV_PATTERNS = {
  tenant:              /^TENANT:?\s*(.+)/i,
  lease_type:          /^LEASE\s+TYPE:?\s*(.+)/i,
  corporate_guaranty:  /^CORPORATE\s+GUARANTY?:?\s*(.+)/i,
  lease_term:          /^LEASE\s+TERM:?\s*(.+)/i,
  lease_commencement:  /^LEASE\s+COMMENCEMENT:?\s*(.+)/i,
  lease_expiration:    /^LEASE\s+EXPIRATION:?\s*(.+)/i,
  remaining_term:      /^REMAINING\s+LEASE\s+TERM:?\s*(.+)/i,
  renewal_options:     /^RENEWAL\s+OPTIONS?:?\s*(.+)/i,
  rent_increases:      /^RENT\s+INCREASES?:?\s*(.+)/i,
  annual_base_rent:    /^ANNUAL\s+BASE\s+RENT:?\s*(.+)/i,
  rent_per_sf:         /^RENT\s+PER\s+SF:?\s*(.+)/i,
  permitted_use:       /^PERMITTED\s+USE:?\s*(.+)/i,
  building_sf:         /^BUILDING\s+(?:SIZE|SF|AREA):?\s*(.+)/i,
  lot_size:            /^LOT\s+SIZE:?\s*(.+)/i,
  year_built:          /^YEAR\s+BUILT:?\s*(.+)/i,
};

// ── Responsibility patterns ─────────────────────────────────────────────────
const RESPONSIBILITY_PATTERNS = {
  property_taxes:  /^PROPERTY\s+TAXES:?\s*(.+)/i,
  insurance:       /^INSURANCE:?\s*(.+)/i,
  utilities:       /^UTILITIES:?\s*(.+)/i,
  roof_structure:  /^ROOF\s*(?:&|AND)\s*STRUCTURE:?\s*(.+)/i,
  roof:            /^ROOF:?\s*(.+)/i,
  hvac:            /^HVAC:?\s*(.+)/i,
  parking:         /^PARKING:?\s*(.+)/i,
  cam:             /^CAM:?\s*(.+)/i,
  structure:       /^STRUCTURE:?\s*(.+)/i,
};

// ── Financial metric patterns (searched across full text) ────────────────────
const FINANCIAL_PATTERNS = {
  asking_price:    /PRICE:?\s*\$?([\d,]+)/i,
  listed_cap_rate: /CAP\s+RATE:?\s*([\d.]+)\s*%/i,
  noi:             /NOI:?\s*\$?([\d,]+)/i,
};

// ============================================================================
// PARSE OM LEASE ABSTRACT
// ============================================================================

/**
 * Extract structured lease data from raw OM text.
 *
 * Handles the standard NNN property OM layout:
 *   1. Key-value lease summary table
 *   2. Responsibility assignments (tenant/landlord/shared)
 *   3. Financial metrics from executive summary
 *   4. Landlord obligations paragraph
 *
 * @param {string} text - Raw text extracted from OM PDF
 * @returns {object} Parsed lease data with normalized responsibility values
 */
export function parseOmLeaseAbstract(text) {
  if (!text || typeof text !== 'string') return {};

  const data = {};
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ── Pass 1: Line-by-line key-value extraction ───────────────────────────
  for (const line of lines) {
    // Lease summary fields
    for (const [key, pattern] of Object.entries(KV_PATTERNS)) {
      const match = line.match(pattern);
      if (match) data[key] = match[1].trim();
    }

    // Responsibility fields — normalize to tenant | landlord | shared
    for (const [key, pattern] of Object.entries(RESPONSIBILITY_PATTERNS)) {
      const match = line.match(pattern);
      if (match) {
        data[key] = normalizeResponsibility(match[1]);
      }
    }
  }

  // ── Handle combined "Roof & Structure" field ────────────────────────────
  if (data.roof_structure) {
    if (!data.roof) data.roof = data.roof_structure;
    if (!data.structure) data.structure = data.roof_structure;
  }

  // ── Pass 2: Financial metrics from full text ────────────────────────────
  for (const [key, pattern] of Object.entries(FINANCIAL_PATTERNS)) {
    const match = text.match(pattern);
    if (match) {
      data[key] = parseFloat(match[1].replace(/,/g, ''));
    }
  }

  // ── Pass 3: Numeric extraction from text values ─────────────────────────
  if (data.annual_base_rent) {
    const rentNum = data.annual_base_rent.match(/\$?([\d,]+)/);
    if (rentNum) data.annual_base_rent_numeric = parseFloat(rentNum[1].replace(/,/g, ''));
  }
  if (data.rent_per_sf) {
    const rsfNum = data.rent_per_sf.match(/\$?([\d.]+)/);
    if (rsfNum) data.rent_per_sf_numeric = parseFloat(rsfNum[1]);
  }

  // ── Pass 4: Landlord obligations paragraph ──────────────────────────────
  const landlordIdx = text.search(/LANDLORD\s+OBLIGATIONS/i);
  if (landlordIdx > -1) {
    const oblText = text.substring(landlordIdx, landlordIdx + 2000);
    const paragraphLines = oblText.split('\n').slice(1);
    // Collect lines until next section header (ALL CAPS line or empty gap)
    const oblLines = [];
    for (const line of paragraphLines) {
      const trimmed = line.trim();
      if (!trimmed) { if (oblLines.length > 0) break; continue; }
      // Stop at next section header (all-caps, 3+ words)
      if (/^[A-Z\s&]{10,}$/.test(trimmed) && oblLines.length > 0) break;
      oblLines.push(trimmed);
    }
    data.landlord_obligations_raw = oblLines.join(' ').trim();

    // Extract detail keywords from obligations paragraph
    data.landlord_obligation_details = extractObligationDetails(data.landlord_obligations_raw);
  }

  return data;
}

// ============================================================================
// PROCESS OM DOCUMENT — Parse + push through provenance system
// ============================================================================

/**
 * Full pipeline: parse OM text → push responsibility data through
 * lease_field_provenance at tier 3 (om_lease_abstract).
 *
 * @param {string} domain    - 'dialysis' or 'government'
 * @param {string} leaseId   - UUID of the lease record
 * @param {string} omText    - Raw text extracted from OM PDF
 * @param {string} omFilename - Original filename for source attribution
 * @param {object} [opts]    - Options
 * @param {string} [opts.propertyId] - Property UUID for cross-ref
 * @returns {{ parsed: object, provenanceResults: object[] }}
 */
export async function processOmDocument(domain, leaseId, omText, omFilename, opts = {}) {
  const parsed = parseOmLeaseAbstract(omText);

  // ── Build provenance field map ──────────────────────────────────────────
  // Responsibility fields are the primary value — these determine who pays
  // for $200K+ roof replacements, HVAC units, structural repairs, etc.
  const provenanceFields = {
    roof_responsibility:      parsed.roof || null,
    hvac_responsibility:      parsed.hvac || null,
    structure_responsibility: parsed.structure || null,
    parking_responsibility:   parsed.parking || null,
    // Financial fields also tracked through provenance
    expense_structure:        parsed.lease_type || null,
    rent:                     parsed.annual_base_rent_numeric ? String(parsed.annual_base_rent_numeric) : null,
    rent_per_sf:              parsed.rent_per_sf_numeric ? String(parsed.rent_per_sf_numeric) : null,
    escalation_schedule:      parsed.rent_increases || null,
    renewal_options:          parsed.renewal_options || null,
    guarantor:                parsed.corporate_guaranty || null,
  };

  // Append detail fields for responsibility items that have obligation context
  const details = parsed.landlord_obligation_details || {};
  const detailFields = {
    roof_detail:      details.roof || null,
    hvac_detail:      details.hvac || null,
    structure_detail: details.structure || null,
  };

  // Truncate obligations text for notes (max 500 chars)
  const oblNotes = parsed.landlord_obligations_raw
    ? parsed.landlord_obligations_raw.substring(0, 500)
    : null;

  // ── Push each field through tier-guarded provenance ─────────────────────
  const provenanceResults = [];

  for (const [field, value] of Object.entries({ ...provenanceFields, ...detailFields })) {
    if (value == null) continue;

    const result = await domainQuery(domain, 'POST', 'rpc/upsert_lease_field', {
      p_lease_id:      leaseId,
      p_field_name:    field,
      p_field_value:   String(value),
      p_source_tier:   3,
      p_source_label:  'om_lease_abstract',
      p_captured_by:   'om_parser',
      p_source_file:   omFilename || null,
      p_source_detail: 'Lease Summary table',
      p_notes:         oblNotes,
    });

    provenanceResults.push({
      field,
      value: String(value),
      accepted: result.ok,
      blocked: !result.ok,
    });
  }

  return { parsed, provenanceResults };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Normalize a responsibility value to tenant | landlord | shared.
 * Raw OM text varies: "Tenant's Responsibility", "Landlord Responsible",
 * "Shared 50/50", etc.
 *
 * @param {string} raw - Raw responsibility text from OM
 * @returns {string} Normalized value or original if unrecognized
 */
function normalizeResponsibility(raw) {
  if (!raw) return raw;
  const lower = raw.trim().toLowerCase();

  if (lower.includes('tenant'))   return 'tenant';
  if (lower.includes('landlord')) return 'landlord';
  if (lower.includes('shared'))   return 'shared';
  if (lower.includes('owner'))    return 'landlord';
  if (lower.includes('lessee'))   return 'tenant';
  if (lower.includes('lessor'))   return 'landlord';

  // Return cleaned original if unrecognized
  return raw.trim();
}

/**
 * Extract detail keywords from landlord obligations paragraph.
 * Identifies what specifically the landlord is responsible for
 * (repair, replace, maintain) for roof, HVAC, and structure.
 *
 * @param {string} oblText - Landlord obligations paragraph text
 * @returns {{ roof?: string, hvac?: string, structure?: string }}
 */
function extractObligationDetails(oblText) {
  if (!oblText) return {};
  const details = {};
  const lower = oblText.toLowerCase();

  // Roof obligation detail
  if (lower.includes('roof')) {
    details.roof = extractDetailPhrase(oblText, /roof/i);
  }

  // HVAC obligation detail
  if (lower.includes('hvac') || lower.includes('heating') || lower.includes('air condition')) {
    details.hvac = extractDetailPhrase(oblText, /(?:hvac|heating|air\s*condition)/i);
  }

  // Structure obligation detail
  if (lower.includes('structur') || lower.includes('foundation') || lower.includes('load-bearing')) {
    details.structure = extractDetailPhrase(oblText, /(?:structur|foundation|load[- ]bearing)/i);
  }

  return details;
}

/**
 * Extract a surrounding phrase (up to ~120 chars) around a keyword match.
 * Used to capture context like "repair and replace the roof membrane".
 *
 * @param {string} text - Full text to search
 * @param {RegExp} keyword - Pattern to locate
 * @returns {string|null}
 */
function extractDetailPhrase(text, keyword) {
  const match = keyword.exec(text);
  if (!match) return null;

  // Grab ~60 chars before and after the keyword
  const start = Math.max(0, match.index - 60);
  const end = Math.min(text.length, match.index + match[0].length + 60);
  let phrase = text.substring(start, end).trim();

  // Trim to sentence boundaries if possible
  const sentStart = phrase.indexOf('. ');
  if (sentStart > -1 && sentStart < 20) phrase = phrase.substring(sentStart + 2);
  const sentEnd = phrase.lastIndexOf('.');
  if (sentEnd > phrase.length - 10) phrase = phrase.substring(0, sentEnd + 1);

  return phrase.trim() || null;
}
