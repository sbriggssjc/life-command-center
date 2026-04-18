// ============================================================================
// Deed Text Parser — Extracts structured data from recorded deed documents
// Life Command Center
//
// Deeds follow predictable county recorder formats. This module extracts
// key fields (document number, recording date, transfer tax / implied price,
// grantor, grantee, APN, escrow, title company, entity types) from raw
// deed text (OCR or PDF-extracted).
//
// After parsing, cross-references against existing DB records to validate
// and optionally upgrade sales_transaction confidence to "deed_verified".
//
// Usage:
//   import { parseDeedText, crossReferenceDeed, processDeedDocument }
//     from './_handlers/deed-parser.js';
//
//   const parsed = parseDeedText(rawText);
//   const xref   = await crossReferenceDeed(domain, propertyId, parsed);
//   await processDeedDocument(domain, propertyId, documentId, rawText);
// ============================================================================

import { domainQuery } from '../_shared/domain-db.js';

// ── Transfer tax rates by jurisdiction ─────────────────────────────────────
// California standard: $1.10 per $1,000 of consideration
// Some cities impose additional tax (LA, SF, Oakland, etc.)
const CA_STANDARD_RATE = 1.10; // per $1,000

const CITY_ADDITIONAL_RATES = {
  'los angeles':    4.50,   // $4.50/$1,000 city + $1.10 county
  'san francisco': 12.50,   // tiered — simplified to $12.50 avg
  'oakland':        15.00,  // tiered — simplified
  'berkeley':       15.00,
  'san jose':       3.30,
  'santa monica':   3.00,
  'culver city':    4.50,
  'richmond':       7.00,
  'pomona':         2.20,
  // Victorville, Hesperia, most Inland Empire cities: no additional tax
};

// ============================================================================
// CORE PARSER
// ============================================================================

/**
 * Extract structured data from raw deed text.
 * Handles standard California Grant Deed / Quitclaim Deed formats.
 *
 * @param {string} text - Raw deed text (OCR or PDF extraction)
 * @param {object} [opts] - Options
 * @param {string} [opts.city] - City name for transfer tax calculation
 * @param {string} [opts.state] - State code (defaults to 'CA')
 * @returns {object} Parsed deed data
 */
export function parseDeedText(text, opts = {}) {
  if (!text || typeof text !== 'string') return {};

  const data = {};
  const state = opts.state || 'CA';

  // ── Document number (DOC# 2026-0042560, Doc #: 2026-0042560, etc.) ────
  const docMatch = text.match(/DOC\s*#?:?\s*([\d\-\.]+)/i);
  if (docMatch) data.document_number = docMatch[1].trim();

  // ── Recording date (MM/DD/YYYY or Month DD, YYYY near "recorded" context) ─
  const recContextMatch = text.match(
    /(?:record(?:ed|ing)\s+(?:on|date)?[:\s]*)([\d]{1,2}\/[\d]{1,2}\/[\d]{4})/i
  );
  if (recContextMatch) {
    data.recording_date = recContextMatch[1];
  } else {
    // Fall back to first MM/DD/YYYY in the document header area (first 500 chars)
    const headerText = text.slice(0, 500);
    const dateMatch = headerText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dateMatch) data.recording_date = dateMatch[1];
  }

  // ── Transfer tax → back-calculate sale price ─────────────────────────
  const taxPatterns = [
    /documentary\s+transfer\s+tax\s+(?:is|of|:)\s*\$?([\d,]+\.?\d*)/i,
    /transfer\s+tax\s*(?:paid|:)\s*\$?([\d,]+\.?\d*)/i,
    /(?:city|county)\s+transfer\s+tax\s*(?:is|:)?\s*\$?([\d,]+\.?\d*)/i,
  ];
  for (const pattern of taxPatterns) {
    const taxMatch = text.match(pattern);
    if (taxMatch) {
      data.transfer_tax = parseFloat(taxMatch[1].replace(/,/g, ''));
      break;
    }
  }

  if (data.transfer_tax && state === 'CA') {
    const cityKey = (opts.city || '').toLowerCase().trim();
    const additionalRate = CITY_ADDITIONAL_RATES[cityKey] || 0;
    const effectiveRate = CA_STANDARD_RATE + additionalRate;
    data.transfer_tax_rate = effectiveRate;
    data.implied_sale_price = Math.round(data.transfer_tax / effectiveRate * 1000);
  }

  // ── Computed from tax: "computed on full value" vs "less liens" ──────
  if (text.match(/computed\s+on\s+(?:the\s+)?full\s+value/i)) {
    data.tax_computation_basis = 'full_value';
  } else if (text.match(/computed\s+on.*less\s+(?:the\s+)?(?:value\s+of\s+)?liens/i)) {
    data.tax_computation_basis = 'less_liens';
  }

  // ── Grantee (buyer) — between "GRANT(S) to" and property description ─
  const granteePatterns = [
    /GRANTS?\s*\(S\)\s+to\s+(.+?)(?:,?\s+(?:the\s+following|all\s+that|that\s+certain))/is,
    /GRANTS?\s+to\s+(.+?)(?:,?\s+(?:the\s+following|all\s+that|that\s+certain))/is,
    /(?:in\s+favor\s+of|conveyed?\s+to)\s+(.+?)(?:,?\s+(?:the\s+following|all\s+that))/is,
  ];
  for (const pattern of granteePatterns) {
    const match = text.match(pattern);
    if (match) {
      data.grantee = cleanEntityName(match[1]);
      break;
    }
  }

  // ── Grantor (seller) — before "hereby GRANT" ─────────────────────────
  const grantorPatterns = [
    /acknowledged,\s+(.+?)\s+hereby\s+GRANTS?/is,
    /(?:know\s+all\s+men|that)\s+(.+?)(?:\s+(?:has|have|do(?:es)?)\s+(?:hereby\s+)?(?:grant|remise|convey))/is,
    /the\s+undersigned\s+grantor\(s\):?\s*\n?\s*(.+?)(?:\n\s*\n|\s+hereby)/is,
  ];
  for (const pattern of grantorPatterns) {
    const match = text.match(pattern);
    if (match) {
      data.grantor = cleanEntityName(match[1]);
      break;
    }
  }

  // ── APN / Parcel ID ──────────────────────────────────────────────────
  const apnPatterns = [
    /APN\s*[\/:]?\s*(?:Parcel\s+ID\s*\(s?\)\s*[:\s]*)?(\d[\d\-]+\d)/i,
    /Assessor['']?s?\s+Parcel\s+(?:No|Number|#)\s*[.:]?\s*(\d[\d\-]+\d)/i,
    /Parcel\s+(?:No|Number|ID)\s*[.:]?\s*(\d[\d\-]+\d)/i,
  ];
  for (const pattern of apnPatterns) {
    const match = text.match(pattern);
    if (match) {
      data.apn = match[1].trim();
      break;
    }
  }

  // ── Escrow number ────────────────────────────────────────────────────
  const escrowMatch = text.match(/Escrow\s+(?:No|Number|#)\s*[.:]?\s*([\w\-]+)/i);
  if (escrowMatch) data.escrow_number = escrowMatch[1].trim();

  // ── Title / escrow company ───────────────────────────────────────────
  const titlePatterns = [
    /RECORDING\s+REQUESTED\s+BY[:\s]*\n?\s*(.+?)(?:\n|$)/i,
    /(?:Title|Escrow)\s+(?:Company|Officer)\s*[:\s]+(.+?)(?:\n|$)/i,
    /(?:WHEN\s+RECORDED\s+(?:MAIL|RETURN)\s+TO)[:\s]*\n?\s*(.+?)(?:\n|$)/i,
  ];
  for (const pattern of titlePatterns) {
    const match = text.match(pattern);
    if (match) {
      const val = match[1].trim();
      // Skip if it looks like a person's name or address
      if (val.length > 3 && !val.match(/^\d/)) {
        data.title_company = val;
        break;
      }
    }
  }

  // ── Deed type ────────────────────────────────────────────────────────
  if (text.match(/GRANT\s+DEED/i)) data.deed_type = 'Grant Deed';
  else if (text.match(/QUIT\s*CLAIM\s+DEED/i)) data.deed_type = 'Quitclaim Deed';
  else if (text.match(/WARRANTY\s+DEED/i)) data.deed_type = 'Warranty Deed';
  else if (text.match(/SPECIAL\s+WARRANTY/i)) data.deed_type = 'Special Warranty Deed';
  else if (text.match(/TRUSTEE['']?S?\s+DEED/i)) data.deed_type = "Trustee's Deed";
  else if (text.match(/DEED\s+OF\s+TRUST/i)) data.deed_type = 'Deed of Trust';
  else if (text.match(/INTERSPOUSAL/i)) data.deed_type = 'Interspousal Transfer Deed';
  else if (text.match(/GIFT\s+DEED/i)) data.deed_type = 'Gift Deed';

  // ── Entity type classification ───────────────────────────────────────
  data.grantee_entity_type = classifyEntityType(data.grantee, text);
  data.grantor_entity_type = classifyEntityType(data.grantor, text);

  // ── Trust dates (important for entity verification) ──────────────────
  const trustDates = [...text.matchAll(/trust\s+(?:dated|created|established)\s+(\w+\s+\d+,?\s+\d{4})/gi)];
  if (trustDates.length) data.trust_dates = trustDates.map(m => m[1]);

  // ── Legal description (abbreviated — first line only) ────────────────
  const legalMatch = text.match(
    /(?:the\s+following\s+described\s+(?:real\s+)?property|legal\s+description)\s*[:\s]*\n?\s*(.+?)(?:\n\s*\n|APN)/is
  );
  if (legalMatch) {
    const desc = legalMatch[1].trim();
    data.legal_description_excerpt = desc.length > 200 ? desc.slice(0, 200) + '...' : desc;
  }

  // ── Consideration stated ─────────────────────────────────────────────
  const considerationMatch = text.match(
    /(?:for\s+(?:a\s+)?(?:good\s+and\s+)?valuable\s+consideration|(?:sum|amount)\s+of)\s+\$?([\d,]+\.?\d*)/i
  );
  if (considerationMatch) {
    const stated = parseFloat(considerationMatch[1].replace(/,/g, ''));
    if (stated > 0) data.stated_consideration = stated;
  }

  // ── "for good and valuable consideration" (no dollar amount) ─────────
  if (!data.stated_consideration && text.match(/good\s+and\s+valuable\s+consideration/i)) {
    data.consideration_type = 'nominal';
  }

  return data;
}

// ============================================================================
// CROSS-REFERENCE VALIDATION
// ============================================================================

/**
 * Validate parsed deed data against existing DB records.
 * Returns a validation report with matches, mismatches, and confidence score.
 *
 * @param {string} domain - 'government' or 'dialysis'
 * @param {string} propertyId - Property/parcel UUID in domain DB
 * @param {object} parsed - Output from parseDeedText()
 * @returns {object} { matches: [], mismatches: [], confidence, suggestions }
 */
export async function crossReferenceDeed(domain, propertyId, parsed) {
  const report = {
    matches: [],
    mismatches: [],
    confidence: 0,
    suggestions: [],
  };

  if (!parsed || !propertyId) return report;

  const idCol = domain === 'government' ? 'parcel_id' : 'property_id';
  let checks = 0;
  let passed = 0;

  // ── 1. Check sales_transactions for implied sale price ───────────────
  if (parsed.implied_sale_price || parsed.stated_consideration) {
    checks++;
    const price = parsed.implied_sale_price || parsed.stated_consideration;
    const salesRes = await domainQuery(domain, 'GET',
      `sales_transactions?${idCol}=eq.${propertyId}&select=id,sold_price,sale_date,notes&order=sale_date.desc&limit=5`
    );
    if (salesRes.ok && salesRes.data?.length) {
      const matchingSale = salesRes.data.find(s => {
        if (!s.sold_price) return false;
        // Allow 2% tolerance for rounding differences in tax calculation
        const diff = Math.abs(s.sold_price - price) / price;
        return diff < 0.02;
      });
      if (matchingSale) {
        passed++;
        report.matches.push({
          field: 'sale_price',
          deed_value: price,
          db_value: matchingSale.sold_price,
          db_record: 'sales_transactions',
          db_id: matchingSale.id,
        });
      } else {
        report.mismatches.push({
          field: 'sale_price',
          deed_value: price,
          db_values: salesRes.data.map(s => s.sold_price).filter(Boolean),
          db_record: 'sales_transactions',
        });
      }
    }
  }

  // ── 2. Check recorded_owner matches grantee ──────────────────────────
  if (parsed.grantee) {
    checks++;
    const ownerRes = await domainQuery(domain, 'GET',
      `recorded_owners?${idCol}=eq.${propertyId}&select=id,owner_name,ownership_start_date&order=ownership_start_date.desc.nullsfirst&limit=3`
    );
    if (ownerRes.ok && ownerRes.data?.length) {
      const normalizedGrantee = normalizeForComparison(parsed.grantee);
      const matchingOwner = ownerRes.data.find(o =>
        normalizeForComparison(o.owner_name) === normalizedGrantee
      );
      if (matchingOwner) {
        passed++;
        report.matches.push({
          field: 'grantee_vs_owner',
          deed_value: parsed.grantee,
          db_value: matchingOwner.owner_name,
          db_record: 'recorded_owners',
          db_id: matchingOwner.id,
        });
      } else {
        report.mismatches.push({
          field: 'grantee_vs_owner',
          deed_value: parsed.grantee,
          db_values: ownerRes.data.map(o => o.owner_name),
          db_record: 'recorded_owners',
        });
        report.suggestions.push(`Grantee "${parsed.grantee}" does not match current recorded owner(s). Consider updating recorded_owners.`);
      }
    }
  }

  // ── 3. Check APN matches parcel_records (government) ─────────────────
  if (parsed.apn && domain === 'government') {
    checks++;
    const parcelRes = await domainQuery(domain, 'GET',
      `parcel_records?parcel_id=eq.${propertyId}&select=parcel_id,parcel_number`
    );
    if (parcelRes.ok && parcelRes.data?.length) {
      const normalizedApn = parsed.apn.replace(/[\s\-]/g, '');
      const matchingParcel = parcelRes.data.find(p =>
        (p.parcel_number || '').replace(/[\s\-]/g, '') === normalizedApn
      );
      if (matchingParcel) {
        passed++;
        report.matches.push({
          field: 'apn',
          deed_value: parsed.apn,
          db_value: matchingParcel.parcel_number,
          db_record: 'parcel_records',
        });
      } else {
        report.mismatches.push({
          field: 'apn',
          deed_value: parsed.apn,
          db_values: parcelRes.data.map(p => p.parcel_number),
          db_record: 'parcel_records',
        });
      }
    }
  }

  // ── 4. Check document_number against existing deed_records ───────────
  if (parsed.document_number) {
    checks++;
    const deedRes = await domainQuery(domain, 'GET',
      `deed_records?document_number=eq.${encodeURIComponent(parsed.document_number)}&select=deed_id,grantor,grantee,consideration&limit=1`
    );
    if (deedRes.ok && deedRes.data?.length) {
      passed++;
      report.matches.push({
        field: 'document_number',
        deed_value: parsed.document_number,
        db_value: parsed.document_number,
        db_record: 'deed_records',
        db_id: deedRes.data[0].deed_id,
        note: 'Deed already recorded in system',
      });
    }
  }

  report.confidence = checks > 0 ? Math.round((passed / checks) * 100) : 0;
  return report;
}

// ============================================================================
// DB INTEGRATION — Store parsed deed & upgrade transaction confidence
// ============================================================================

/**
 * Full deed processing pipeline:
 * 1. Parse raw deed text
 * 2. Store extracted data on the property_documents row (metadata JSONB)
 * 3. Upsert deed_record if document_number present
 * 4. Cross-reference against existing DB records
 * 5. Upgrade matching sales_transaction confidence to "deed_verified"
 *
 * @param {string} domain - 'government' or 'dialysis'
 * @param {string} propertyId - Property/parcel UUID
 * @param {string} documentId - property_documents row ID (optional)
 * @param {string} rawText - Raw deed text
 * @param {object} [opts] - { city, state } for transfer tax calculation
 * @returns {object} { parsed, crossRef, deedRecordId, upgradedTransactions }
 */
export async function processDeedDocument(domain, propertyId, documentId, rawText, opts = {}) {
  const result = {
    parsed: {},
    crossRef: null,
    deedRecordId: null,
    upgradedTransactions: 0,
  };

  // Step 1: Parse
  result.parsed = parseDeedText(rawText, opts);
  const parsed = result.parsed;

  if (!parsed.document_number && !parsed.grantee && !parsed.implied_sale_price) {
    // Nothing meaningful extracted
    return result;
  }

  // Step 2: Store extracted data on property_documents row
  if (documentId) {
    await domainQuery(domain, 'PATCH',
      `property_documents?id=eq.${documentId}`,
      {
        ingestion_status: 'deed_parsed',
        metadata: {
          deed_extraction: parsed,
          extracted_at: new Date().toISOString(),
        },
      },
      { 'Prefer': 'return=minimal' }
    );
  }

  // Step 3: Upsert deed_record if we have a document number
  if (parsed.document_number) {
    const idCol = domain === 'government' ? 'parcel_id' : 'property_id';
    const state = opts.state || parsed.recording_date ? null : null;
    const stateCol = domain === 'government' ? 'state_code' : 'state';

    const datePart = parseRecordingDate(parsed.recording_date);
    const hashSource = `${parsed.document_number}|${opts.state || ''}|${datePart || ''}`;
    const dataHash = Buffer.from(hashSource).toString('base64');

    // Check for existing deed record
    const existing = await domainQuery(domain, 'GET',
      `deed_records?data_hash=eq.${encodeURIComponent(dataHash)}&select=deed_id&limit=1`
    );

    if (!existing.ok || !existing.data?.length) {
      const deedRow = {};
      if (domain !== 'government') deedRow.property_id = propertyId;
      deedRow.document_number = parsed.document_number;
      deedRow.deed_type = parsed.deed_type || null;
      deedRow.grantor = parsed.grantor || null;
      deedRow.grantee = parsed.grantee || null;
      deedRow.recording_date = datePart;
      deedRow.consideration = parsed.implied_sale_price || parsed.stated_consideration || null;
      deedRow.county = opts.county || null;
      deedRow[stateCol] = opts.state || null;
      deedRow.data_hash = dataHash;
      deedRow.raw_payload = {
        source: 'deed_parser',
        parsed,
        raw_text_length: rawText.length,
      };

      // Remove null values
      for (const [k, v] of Object.entries(deedRow)) {
        if (v === null || v === undefined) delete deedRow[k];
      }
      deedRow.data_hash = dataHash; // Always keep

      const insertRes = await domainQuery(domain, 'POST', 'deed_records', deedRow,
        { 'Prefer': 'return=representation' }
      );
      if (insertRes.ok && insertRes.data?.[0]) {
        result.deedRecordId = insertRes.data[0].deed_id || insertRes.data[0].id;
      }
    } else {
      result.deedRecordId = existing.data[0].deed_id;
    }
  }

  // Step 4: Cross-reference
  result.crossRef = await crossReferenceDeed(domain, propertyId, parsed);

  // Step 5: Upgrade sales_transaction confidence if price matches
  if (result.crossRef.matches.some(m => m.field === 'sale_price')) {
    const priceMatch = result.crossRef.matches.find(m => m.field === 'sale_price');
    if (priceMatch?.db_id) {
      const updateRes = await domainQuery(domain, 'PATCH',
        `sales_transactions?id=eq.${priceMatch.db_id}`,
        {
          data_confidence: 'deed_verified',
          notes: appendNote(
            priceMatch.notes,
            `Deed verified: DOC# ${parsed.document_number || 'unknown'}, ` +
            `transfer tax $${parsed.transfer_tax || 'N/A'}, ` +
            `recorded ${parsed.recording_date || 'unknown'}`
          ),
        },
        { 'Prefer': 'return=minimal' }
      );
      if (updateRes.ok) result.upgradedTransactions++;
    }
  }

  return result;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Clean up entity name extracted from deed text.
 * Removes excess whitespace, line breaks, and common legal boilerplate.
 */
function cleanEntityName(raw) {
  if (!raw) return null;
  return raw
    .replace(/\r?\n/g, ' ')           // collapse line breaks
    .replace(/\s{2,}/g, ' ')          // collapse multiple spaces
    .replace(/^[,;\s]+|[,;\s]+$/g, '') // trim punctuation
    .replace(/\s*,\s*$/, '')           // trailing comma
    .trim() || null;
}

/**
 * Classify entity type from name and surrounding text context.
 */
function classifyEntityType(entityName, fullText) {
  if (!entityName) return null;
  const combined = (entityName + ' ' + (fullText || '')).toLowerCase();
  const name = entityName.toLowerCase();

  if (name.includes('llc') || name.includes('l.l.c') || combined.match(/limited\s+liability\s+company/)) return 'LLC';
  if (name.includes('inc') || name.includes('corp') || combined.match(/\bcorporation\b/)) return 'Corporation';
  if (name.includes('lp') || name.includes('l.p.') || combined.match(/limited\s+partnership/)) return 'Limited Partnership';
  if (name.includes('trust') || combined.match(/(?:as\s+)?trustee/)) return 'Trust';
  if (combined.match(/husband\s+and\s+wife|married\s+couple|community\s+property/)) return 'Individual (Married)';
  if (combined.match(/(?:a\s+)?single\s+(?:man|woman|person)/)) return 'Individual (Single)';
  return null;
}

/**
 * Normalize name for comparison: lowercase, strip punctuation, collapse spaces.
 */
function normalizeForComparison(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[.,;:'"()\-]/g, '')
    .replace(/\b(llc|inc|corp|ltd|lp|a california|a delaware|a nevada)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Parse recording date from MM/DD/YYYY format to ISO date string.
 */
function parseRecordingDate(dateStr) {
  if (!dateStr) return null;
  // Handle MM/DD/YYYY
  const parts = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (parts) {
    const [, month, day, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  // Fall back to generic Date parse
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

/**
 * Append a note string to existing notes (pipe-separated).
 */
function appendNote(existing, newNote) {
  if (!existing) return newNote;
  if (existing.includes(newNote)) return existing; // avoid duplication
  return `${existing} | ${newNote}`;
}
