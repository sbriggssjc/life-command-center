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
import { validateDeedIngest, buildDeedDataHash } from '../_shared/ingest-contract.js';

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

// ── Documentary-stamp (deed transfer-tax) rate by STATE, as a FRACTION of the
// sale price (R58b Unit 2). Used to back out a price from "Doc Stamps $X".
// FL deed doc stamps = $0.70 per $100 = 0.0070 (verified: $13,333,400 ×
// 0.0070 = $93,333.80). Only states with a flat, deed-wide rate are modeled;
// an unmodeled state yields no doc-stamp price estimate (skip, don't guess).
const DEED_DOC_STAMP_RATE = {
  FL: 0.0070,
};

const NOMINAL_CONSIDERATION_FLOOR = 100; // excludes the "$10.00 and other valuable consideration" nominal

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

  // ── Grantor / Grantee (R58b Unit 1) ──────────────────────────────────
  // Three formats, in precedence order:
  //   1. LABELED cover-page (county recorder / Simplifile cover sheets):
  //      "First Grantor: NAME  First Grantee: NAME", "Grantor(s): NAME".
  //   2. NARRATIVE parenthetical (the body of most warranty/quitclaim deeds):
  //      "… NAME[, a <entity qualifier>] (the "Grantor"), and NAME (the "Grantee")".
  //   3. LEGACY "GRANTS to …" body forms (the original parser).
  // Cover-page parties are the recorder's authoritative fields, so they win
  // when both a cover sheet AND a body are present. A deed of trust
  // (trustor/trustee/beneficiary, none of these markers) correctly yields null.
  const legacyGranteePatterns = [
    /GRANTS?\s*\(S\)\s+to\s+(.+?)(?:,?\s+(?:the\s+following|all\s+that|that\s+certain))/is,
    /GRANTS?\s+to\s+(.+?)(?:,?\s+(?:the\s+following|all\s+that|that\s+certain))/is,
    /(?:in\s+favor\s+of|conveyed?\s+to)\s+(.+?)(?:,?\s+(?:the\s+following|all\s+that))/is,
  ];
  const legacyGrantorPatterns = [
    /acknowledged,\s+(.+?)\s+hereby\s+GRANTS?/is,
    /(?:know\s+all\s+men|that)\s+(.+?)(?:\s+(?:has|have|do(?:es)?)\s+(?:hereby\s+)?(?:grant|remise|convey))/is,
    /the\s+undersigned\s+grantor\(s\):?\s*\n?\s*(.+?)(?:\n\s*\n|\s+hereby)/is,
  ];

  // R59b — every path now returns a CLEANED + VALIDATED name (or null) so the
  // `||` chain falls through to the next path instead of latching onto garbage
  // (a form-field label / legal-description blob / OCR-bleed tail). The labeled
  // cover-page path (R58b) wins; then the narrative parenthetical; then the
  // scanned "from <X> to <Y>" form (R59b); then the legacy "GRANTS to …" body —
  // the legacy candidate is run through the same clean+validate gate so it can
  // no longer emit a qualifier/junk tail (the doc-1948 bug).
  data.grantee = extractLabeledParty(text, 'Grantee')
              || extractNarrativeParty(text, 'Grantee')
              || extractFromToParty(text, 'Grantee')
              || cleanAndValidateParty(firstPatternMatch(text, legacyGranteePatterns));
  data.grantor = extractLabeledParty(text, 'Grantor')
              || extractNarrativeParty(text, 'Grantor')
              || extractFromToParty(text, 'Grantor')
              || cleanAndValidateParty(firstPatternMatch(text, legacyGrantorPatterns));

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

  // ── County (deeds reliably name their recording county; gov.deed_records
  //    requires it NOT NULL) ──────────────────────────────────────────────
  const countyMatch =
    text.match(/County\s+of\s+([A-Za-z][A-Za-z .'\-]+?)(?:\s*[,\n]|\s+State\b)/i) ||
    text.match(/\b([A-Za-z][A-Za-z .'\-]+?)\s+County\b/);
  if (countyMatch) {
    const c = cleanEntityName(countyMatch[1]);
    if (c && c.length <= 40) data.county = c;
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

  // ── Sale price (R58b Unit 2) — precedence:
  //   (1) explicit transfer amount / total consideration ($real, not the $10 nominal),
  //   (2) FL-style doc-stamp back-out by state rate,
  //   (3) the CA transfer-tax estimate already computed above.
  // Tag price_source so the higher-confidence transfer_amount is distinguishable
  // from the doc_stamp/transfer-tax estimates. implied_sale_price is the field the
  // existing R58 cross-ref + the gated DEED_IMPLIED_PRICE_FILL write consume.
  const amountPatterns = [
    /Transfer\s+Amt\.?\s*:?\s*\$\s*([\d,]+\.?\d*)/i,
    /Total\s+Consideration\s*:?\s*\$\s*([\d,]+\.?\d*)/i,
    /consideration\s+(?:of|in\s+the\s+(?:total\s+)?amount\s+of)\s+\$\s*([\d,]+\.?\d*)/i,
  ];
  for (const p of amountPatterns) {
    const m = text.match(p);
    if (m) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(v) && v > NOMINAL_CONSIDERATION_FLOOR) { data.transfer_amount = v; break; }
    }
  }

  const stampMatch = text.match(/Doc(?:umentary)?\s+Stamps?(?:\s+Tax)?\s*:?\s*\$\s*([\d,]+\.?\d*)/i);
  if (stampMatch) {
    const stamps = parseFloat(stampMatch[1].replace(/,/g, ''));
    const rate = DEED_DOC_STAMP_RATE[(state || '').toUpperCase()];
    if (Number.isFinite(stamps) && stamps > 0 && rate) {
      data.doc_stamp_amount = stamps;
      data.doc_stamp_implied_price = Math.round(stamps / rate);
    }
  }

  if (data.transfer_amount) {
    data.implied_sale_price = data.transfer_amount;
    data.price_source = 'transfer_amount';
    // Sanity-check the explicit amount against the doc-stamp estimate when both exist.
    if (data.doc_stamp_implied_price && data.transfer_amount > 0) {
      const diff = Math.abs(data.doc_stamp_implied_price - data.transfer_amount) / data.transfer_amount;
      data.price_cross_check = diff < 0.02 ? 'agree' : 'differ';
    }
  } else if (data.doc_stamp_implied_price) {
    data.implied_sale_price = data.doc_stamp_implied_price;
    data.price_source = 'doc_stamp_estimate';
  } else if (data.implied_sale_price) {
    // CA transfer-tax estimate computed earlier
    data.price_source = data.price_source || 'transfer_tax_estimate';
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
 * R58 (2026-06-20): rewritten to be SCHEMA-CORRECT per domain. The original
 * orphaned parser queried columns that exist on NEITHER live DB
 * (`sales_transactions.id`/`.data_confidence`/`.notes`-by-`parcel_id`,
 * `recorded_owners.owner_name`/`.ownership_start_date`-by-property,
 * `parcel_records.parcel_number`). Grounded live: both domains key
 * `sales_transactions` on `property_id` (dia sale_id:int / gov sale_id:uuid) and
 * carry `properties.recorded_owner_name` denormalized. The owner check now reads
 * that denormalized name (the property→owner link), and the sale check keys on
 * `property_id` and selects the real PK.
 *
 * @param {string} domain - 'government' or 'dialysis'
 * @param {string|number} propertyId - domain properties.property_id
 * @param {object} parsed - Output from parseDeedText()
 * @param {object} [deps] - { domainQuery } injectable for tests
 * @returns {object} { matches, mismatches, confidence, suggestions, saleCandidate }
 *   saleCandidate: { sale_id, sold_price, implied_price } — the best sale to
 *   verify / fill (price-matched first, else the most recent), or null.
 */
export async function crossReferenceDeed(domain, propertyId, parsed, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const report = {
    matches: [],
    mismatches: [],
    confidence: 0,
    suggestions: [],
    saleCandidate: null,
  };

  if (!parsed || propertyId == null) return report;
  const isGov = domain === 'government';
  const salePk = isGov ? 'sale_id' : 'sale_id'; // PK is sale_id on both (gov uuid / dia int)
  let checks = 0;
  let passed = 0;

  const impliedPrice = parsed.implied_sale_price || parsed.stated_consideration || null;

  // ── 1. sales_transactions — keyed on property_id (both domains) ───────
  const salesRes = await q(domain, 'GET',
    `sales_transactions?property_id=eq.${propertyId}&select=${salePk},sold_price,sale_date&order=sale_date.desc.nullslast&limit=10`
  );
  const sales = (salesRes.ok && Array.isArray(salesRes.data)) ? salesRes.data : [];
  if (impliedPrice) {
    checks++;
    const priceMatch = sales.find(s => {
      if (!s.sold_price) return false;
      return Math.abs(Number(s.sold_price) - impliedPrice) / impliedPrice < 0.02; // 2% tax-rounding tolerance
    });
    if (priceMatch) {
      passed++;
      report.matches.push({
        field: 'sale_price', deed_value: impliedPrice, db_value: priceMatch.sold_price,
        db_record: 'sales_transactions', db_id: priceMatch[salePk],
      });
      report.saleCandidate = { sale_id: priceMatch[salePk], sold_price: priceMatch.sold_price, sale_date: priceMatch.sale_date || null, implied_price: impliedPrice, price_matched: true };
    } else if (sales.length) {
      report.mismatches.push({
        field: 'sale_price', deed_value: impliedPrice,
        db_values: sales.map(s => s.sold_price).filter(v => v != null), db_record: 'sales_transactions',
      });
    }
  }
  // Fall back to the most-recent sale as the verify/fill candidate when no price
  // matched (e.g. the sale has a NULL price — the implied price can fill it).
  if (!report.saleCandidate && sales.length) {
    const s = sales[0];
    report.saleCandidate = { sale_id: s[salePk], sold_price: s.sold_price ?? null, sale_date: s.sale_date || null, implied_price: impliedPrice, price_matched: false };
  }

  // ── 2. grantee vs the property's recorded owner ──────────────────────
  // Resolve via properties.recorded_owner_id → recorded_owners.name (works on
  // BOTH domains — gov properties has NO denormalized recorded_owner_name column,
  // only the FK; the original parser's `select=recorded_owner_name` 400'd on gov).
  if (parsed.grantee) {
    checks++;
    const propRes = await q(domain, 'GET',
      `properties?property_id=eq.${propertyId}&select=recorded_owner_id&limit=1`
    );
    const ownerId = (propRes.ok && propRes.data?.[0]?.recorded_owner_id) || null;
    let ownerName = null;
    if (ownerId) {
      const oRes = await q(domain, 'GET',
        `recorded_owners?recorded_owner_id=eq.${ownerId}&select=name&limit=1`
      );
      ownerName = (oRes.ok && oRes.data?.[0]?.name) || null;
    }
    if (ownerName) {
      if (normalizeForComparison(ownerName) === normalizeForComparison(parsed.grantee)) {
        passed++;
        report.matches.push({
          field: 'grantee_vs_owner', deed_value: parsed.grantee,
          db_value: ownerName, db_record: 'properties',
        });
      } else {
        report.mismatches.push({
          field: 'grantee_vs_owner', deed_value: parsed.grantee,
          db_values: [ownerName], db_record: 'properties',
        });
        report.suggestions.push(`Grantee "${parsed.grantee}" differs from recorded owner "${ownerName}".`);
      }
    }
  }

  // ── 3. document_number against existing deed_records (PK per domain) ──
  if (parsed.document_number) {
    checks++;
    const deedPk = isGov ? 'deed_id' : 'id';
    const deedRes = await q(domain, 'GET',
      `deed_records?document_number=eq.${encodeURIComponent(parsed.document_number)}&select=${deedPk}&limit=1`
    );
    if (deedRes.ok && deedRes.data?.length) {
      passed++;
      report.matches.push({
        field: 'document_number', deed_value: parsed.document_number, db_value: parsed.document_number,
        db_record: 'deed_records', db_id: deedRes.data[0][deedPk], note: 'Deed already recorded in system',
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
 * Full deed processing pipeline (R58 — wired off the orphaned shelf, 2026-06-20):
 * 1. Parse raw deed text
 * 2. Store extracted data on property_documents.extracted_data (NOT `metadata` —
 *    that column exists on NEITHER domain; both carry `extracted_data` jsonb +
 *    PK `document_id`)
 * 3. Upsert deed_records (archival; dedup PK per domain — dia `id` / gov `deed_id`)
 * 4. FEED R51 — write the grantee to properties.latest_deed_grantee/_date so the
 *    existing v_owner_source_conflict view + owner-deed-autofix lane pick it up
 *    (R51 reads those property columns, NOT deed_records). Fill-blanks-or-newer,
 *    never clobber a more-recent recorded grantee.
 * 5. Cross-reference + supply the deed's implied sale price as a CANDIDATE on a
 *    matching sale that LACKS one — confirm-gated (env DEED_IMPLIED_PRICE_FILL),
 *    fill-blanks ONLY, NEVER overwrites a curated price.
 *
 * @param {string} domain - 'government' or 'dialysis'
 * @param {string|number} propertyId - domain properties.property_id
 * @param {string|number} documentId - property_documents.document_id (optional)
 * @param {string} rawText - Raw deed text (digital or OCR'd)
 * @param {object} [opts] - { city, state, county } for transfer-tax calc + DTO
 * @param {object} [deps] - { domainQuery } injectable for tests
 * @returns {object} { parsed, crossRef, deedRecordId, upgradedTransactions, r51Fed, impliedPriceFilled }
 */
export async function processDeedDocument(domain, propertyId, documentId, rawText, opts = {}, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const result = {
    parsed: {},
    crossRef: null,
    deedRecordId: null,
    upgradedTransactions: 0,
    r51Fed: false,
    impliedPriceFilled: false,
    // R59 — propagation into the BD spine (all gated on the optional deps below;
    // absent deps ⇒ exact pre-R59 behavior, so the R58 tests stay byte-identical).
    saleBuyerFilled: false,
    saleSellerFilled: false,
    ownershipEventAppended: false,
    suspectedSaleSurfaced: false,
    granteeEntityId: null,
    ownsEdgeCreated: false,
    traceGranteeTaskSurfaced: false,
  };

  // Step 1: Parse
  result.parsed = parseDeedText(rawText, opts);
  const parsed = result.parsed;

  if (!parsed.document_number && !parsed.grantee && !parsed.implied_sale_price) {
    // Nothing meaningful extracted
    return result;
  }

  // Step 2: Store extracted data on property_documents row. The column is
  // `extracted_data` (jsonb) and the PK is `document_id` on BOTH domains — the
  // original `metadata`/`id` write was a silent no-op against the real schema.
  if (documentId != null) {
    await q(domain, 'PATCH',
      `property_documents?document_id=eq.${documentId}`,
      {
        ingestion_status: 'deed_parsed',
        extracted_data: {
          deed_extraction: parsed,
          extracted_at: new Date().toISOString(),
        },
      },
      { 'Prefer': 'return=minimal' }
    ).catch(() => {});
  }

  // Step 3: Upsert deed_record if we have a document number.
  // C9 Phase 2 (2026-05-27): route through the standard ingest contract.
  // Builds a DeedIngestDTO, runs validateDeedIngest, computes the canonical
  // base64 data_hash via buildDeedDataHash. Validation failures log + skip
  // the write rather than failing loudly mid-pipeline; the DB CHECK
  // constraints would have rejected the same rows.
  // gov.deed_records requires county + state_code NOT NULL. Prefer the caller's
  // opts, then the county parsed from the deed text. Skip the gov archival insert
  // when neither is available (it would only 400) — the R51 feed + extracted_data
  // (the actual BD value) still run. dia.deed_records has no such requirement.
  const deedCounty = opts.county || parsed.county || null;
  const deedState = opts.state || null;
  const canInsertDeed = parsed.document_number &&
    (domain !== 'government' || (deedCounty && deedState));
  if (canInsertDeed) {
    const stateCol = domain === 'government' ? 'state_code' : 'state';
    const datePart = parseRecordingDate(parsed.recording_date);
    const dataHash = buildDeedDataHash(parsed.document_number, deedState || '', datePart || '');

    // Build the DTO + validate before any DB I/O
    const dto = {
      domain: domain === 'government' ? 'government' : 'dialysis',
      property_id: domain === 'government' ? undefined : propertyId,
      document_number: parsed.document_number,
      [stateCol]: deedState || null,
      state: deedState || null,
      county: deedCounty,
      recording_date: datePart,
      deed_type: parsed.deed_type || null,
      grantor: parsed.grantor || null,
      grantee: parsed.grantee || null,
      consideration: parsed.implied_sale_price || parsed.stated_consideration || null,
      data_hash: dataHash,
      data_source: 'deed_parser',
      raw_payload: { source: 'deed_parser', parsed, raw_text_length: rawText.length },
    };

    const { ok: dtoOk, errors: dtoErrors } = validateDeedIngest(dto);
    if (!dtoOk) {
      // Log all validation errors for observability. Hard-skip the write
      // only when a showstopper would cause a DB CHECK violation; soft
      // errors (e.g. missing state) get a warning but proceed — preserves
      // pre-C9 behavior so this migration is non-breaking.
      const hardErrors = dtoErrors.filter(e =>
        e.includes('data_hash must be >=')             // A4b CHECK on dia
     || e.includes('require property_id')              // Round 76ae guard on dia
     || e.includes('document_number is required')      // hard NOT NULL
     || e.includes('recording_date is required')       // hard NOT NULL
      );
      if (hardErrors.length) {
        console.warn(
          `[deed-parser] DeedIngestDTO HARD-skip doc=${parsed.document_number} ` +
          `domain=${domain} property_id=${propertyId}: ${hardErrors.join('; ')}`
        );
        result.parsed.validation_errors = dtoErrors;
        return result;
      }
      console.warn(
        `[deed-parser] DeedIngestDTO soft warnings doc=${parsed.document_number} ` +
        `domain=${domain} property_id=${propertyId}: ${dtoErrors.join('; ')}`
      );
      result.parsed.validation_warnings = dtoErrors;
      // Fall through to the insert — the DB will accept or reject per its
      // existing constraints. The warnings show up in Vercel logs for triage.
    }

    // Check for existing deed record (dedup by data_hash). The PK differs by
    // domain — dia `id`, gov `deed_id` — so select the right one (the prior
    // `select=deed_id` 400'd on dia).
    const deedPk = domain === 'government' ? 'deed_id' : 'id';
    const existing = await q(domain, 'GET',
      `deed_records?data_hash=eq.${encodeURIComponent(dataHash)}&select=${deedPk}&limit=1`
    );

    if (!existing.ok || !existing.data?.length) {
      // Build the actual insert row from the validated DTO, dropping
      // undefined/null fields (matches previous stripNulls behavior).
      const deedRow = {};
      if (domain !== 'government') deedRow.property_id = propertyId;
      deedRow.document_number = dto.document_number;
      deedRow.deed_type = dto.deed_type;
      deedRow.grantor = dto.grantor;
      deedRow.grantee = dto.grantee;
      deedRow.recording_date = dto.recording_date;
      deedRow.consideration = dto.consideration;
      deedRow.county = dto.county;
      deedRow[stateCol] = deedState || null;
      deedRow.data_hash = dataHash;
      deedRow.raw_payload = dto.raw_payload;

      for (const [k, v] of Object.entries(deedRow)) {
        if (v === null || v === undefined) delete deedRow[k];
      }
      deedRow.data_hash = dataHash; // Always keep (NOT NULL)

      const insertRes = await q(domain, 'POST', 'deed_records', deedRow,
        { 'Prefer': 'return=representation' }
      );
      if (insertRes.ok && insertRes.data?.[0]) {
        result.deedRecordId = insertRes.data[0].deed_id || insertRes.data[0].id;
      }
    } else {
      result.deedRecordId = existing.data[0][deedPk];
    }
  }

  // Step 4: FEED R51 — write the recorded deed's grantee onto the property's
  // latest_deed_grantee/_date (the columns v_owner_source_conflict +
  // owner-deed-autofix read). Conservative: only when the grantee passes the
  // basic guard (has a letter, length >= 4 after stripping) AND it is BLANK or
  // the parsed recording date is NEWER than the existing one — never clobber a
  // more-recent recorded grantee. Property key is property_id on both domains.
  if (propertyId != null && parsed.grantee && granteeIsPlausible(parsed.grantee)) {
    const recDate = parseRecordingDate(parsed.recording_date);
    const propRes = await q(domain, 'GET',
      `properties?property_id=eq.${propertyId}&select=latest_deed_grantee,latest_deed_date&limit=1`
    );
    const cur = (propRes.ok && propRes.data?.[0]) || {};
    const curDate = cur.latest_deed_date || null;
    const isBlank = !cur.latest_deed_grantee;
    const isNewer = recDate && curDate && recDate > curDate;
    const isBlankDate = recDate && !curDate && !cur.latest_deed_grantee;
    if (isBlank || isNewer || isBlankDate) {
      const patch = { latest_deed_grantee: parsed.grantee };
      if (recDate) patch.latest_deed_date = recDate;
      const upd = await q(domain, 'PATCH',
        `properties?property_id=eq.${propertyId}`, patch, { 'Prefer': 'return=minimal' }
      ).catch(() => ({ ok: false }));
      result.r51Fed = !!upd.ok;
    }
  }

  // Step 5: Cross-reference + supply the deed's implied price as a CANDIDATE on a
  // matching sale that LACKS one. confirm-gated (DEED_IMPLIED_PRICE_FILL) and
  // fill-blanks ONLY — a curated (non-null) sold_price is NEVER overwritten, and
  // the verification is recorded regardless. The implied price is a transfer-tax
  // ESTIMATE, so the real-write is gated exactly like R51's owner-deed-autofix.
  result.crossRef = await crossReferenceDeed(domain, propertyId, parsed, deps);
  const cand = result.crossRef.saleCandidate;
  const implied = parsed.implied_sale_price || parsed.stated_consideration || null;
  // A confirmed verification = the parsed deed matched an existing sale's price.
  if (result.crossRef.matches.some(m => m.field === 'sale_price')) {
    result.upgradedTransactions++;  // "deed_verified" — recorded in extracted_data (no DB confidence column)
  }
  const fillEnabled = String(process.env.DEED_IMPLIED_PRICE_FILL || '').toLowerCase() === 'on'
                   || process.env.DEED_IMPLIED_PRICE_FILL === 'true';
  if (fillEnabled && cand && cand.sale_id != null && (cand.sold_price == null) && implied && implied > 0) {
    const upd = await q(domain, 'PATCH',
      `sales_transactions?sale_id=eq.${cand.sale_id}&sold_price=is.null`,
      { sold_price: implied }, { 'Prefer': 'return=minimal' }
    ).catch(() => ({ ok: false }));
    result.impliedPriceFilled = !!upd.ok;
  }

  // Step 6 (R59): propagate the extracted deed into the BD spine — fill the sale's
  // parties, append the ownership_history event, surface an unrecorded transfer,
  // enter the grantee into the entity graph, and prompt the ambiguous cases. All
  // additive / fill-blanks / append-only / gated on the optional deps.
  await propagateDeedToBd({ domain, propertyId, documentId, parsed, crossRef: result.crossRef }, q, deps, result)
    .catch((e) => { result.bdError = e?.message || String(e); });

  return result;
}

/**
 * R59b Unit 2 — run ONLY the R59 BD-spine propagation (Step 5 cross-reference +
 * Step 6 `propagateDeedToBd`) over an ALREADY-PARSED deed's stored extraction.
 *
 * This is the one-time retroactive backfill entrypoint: deeds parsed BEFORE R59
 * shipped have their `latest_deed_grantee` set + the R58c terminal marker, so the
 * re-parse queue skips them and Step 6 never ran — their matching sale stays
 * NULL-party and ownership_history stays empty. This reuses the EXACT R59 Step 6
 * entrypoint (same fill-blanks / append-only / guards / idempotency), reading the
 * stored `parsed` object — it does NOT re-parse (no regex/OCR) and does NOT
 * re-write extracted_data / deed_records. Gated on the same optional deps, so
 * with none injected it is a pure no-op.
 *
 * @param {object} args - { domain, propertyId, documentId, parsed }
 *   parsed = the stored property_documents.extracted_data.deed_extraction object.
 * @param {object} [deps] - same dep set as processDeedDocument's Step 5/6.
 * @returns {object} the R59 effect flags + the crossRef.
 */
export async function propagateStoredDeedExtraction({ domain, propertyId, documentId, parsed }, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const result = {
    crossRef: null,
    saleBuyerFilled: false, saleSellerFilled: false, ownershipEventAppended: false,
    suspectedSaleSurfaced: false, granteeEntityId: null, ownsEdgeCreated: false,
    traceGranteeTaskSurfaced: false,
  };
  if (!parsed || propertyId == null || !parsed.grantee) return result;
  result.crossRef = await crossReferenceDeed(domain, propertyId, parsed, deps);
  await propagateDeedToBd({ domain, propertyId, documentId, parsed, crossRef: result.crossRef }, q, deps, result)
    .catch((e) => { result.bdError = e?.message || String(e); });
  return result;
}

// ── R59 per-domain wiring ────────────────────────────────────────────────────
// sales_transactions party columns DIFFER by domain (dia buyer_name/seller_name;
// gov buyer/seller). ownership_history schemas DIFFER too (dia ownership_start /
// sold_price / acquisition_method; gov transfer_date / change_type / data_source,
// uuid sale ids). Both grounded live 2026-06-22.
const DEED_BD_SALE_COLS = {
  government: { buyer: 'buyer', seller: 'seller' },
  dialysis:  { buyer: 'buyer_name', seller: 'seller_name' },
};
// A deed recording date within this window of a sale's date is the SAME
// transaction even when the deed's consideration differs from the recorded price
// by more than the 2% price-match tolerance (closing-cost / doc-stamp rounding —
// the 24703 example: deed $13.33M vs sale $13.70M = 2.7%, but 5 days apart).
const DEED_SALE_PROXIMITY_DAYS = 548; // ~18 months
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripNullsLocal(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

/**
 * R59 Units 1-4 — propagate a parsed+matched deed into the BD spine.
 * Every effect is gated on its dep being present (so a caller that injects only
 * `domainQuery`, like the R58 tests, gets exact pre-R59 behavior). Best-effort:
 * a failure on any sub-step is recorded but never blocks the others.
 *
 * Optional deps:
 *   granteePassesOwnerGuards(name)            — R51 owner guard (broker/federal/junk)
 *   resolveRecordedOwner(domain, name)        — resolve/create recorded_owner → id
 *   ensureEntityLink(args)                    — mint/resolve an LCC entity (guards)
 *   insertEntityRelationship(row)             — entity_relationships POST (owns edge)
 *   opsQuery(method, path, body)              — LCC Opps query (edge dupe-guard)
 *   openResearchTask(args)                    — idempotent research_tasks producer
 *   resolveBuyerParent(entityId)              — lcc_resolve_buyer_parent (R5/R6)
 *   workspaceId / userId                      — optional context for the mint
 */
async function propagateDeedToBd({ domain, propertyId, documentId, parsed, crossRef }, q, deps, result) {
  if (!parsed || propertyId == null) return;
  const short = domain === 'government' ? 'gov' : 'dia';
  const passes = deps.granteePassesOwnerGuards || null;
  const recDate = parseRecordingDate(parsed.recording_date);
  const grantee = parsed.grantee || null;
  const grantor = parsed.grantor || null;
  const price = parsed.implied_sale_price || parsed.stated_consideration || null;

  // Resolve "the deed's sale" — the price-matched sale, or a date-proximate
  // fallback (same transaction, looser price). Null = no sale corresponds.
  const cand = crossRef?.saleCandidate || null;
  let confidentSale = null;
  if (cand && cand.sale_id != null) {
    if (cand.price_matched) {
      confidentSale = cand;
    } else if (recDate && cand.sale_date) {
      const days = Math.abs((new Date(recDate) - new Date(cand.sale_date)) / 86400000);
      if (Number.isFinite(days) && days <= DEED_SALE_PROXIMITY_DAYS) confidentSale = cand;
    }
  }

  // ── Unit 1(a): fill the confident sale's parties (fill-blanks, per-domain) ──
  if (confidentSale && passes) {
    const cols = DEED_BD_SALE_COLS[domain] || DEED_BD_SALE_COLS.dialysis;
    const sid = encodeURIComponent(String(confidentSale.sale_id));
    if (grantee && passes(grantee)) {
      const up = await q(domain, 'PATCH',
        `sales_transactions?sale_id=eq.${sid}&${cols.buyer}=is.null`,
        { [cols.buyer]: grantee }, { Prefer: 'return=minimal' }).catch(() => ({ ok: false }));
      if (up && up.ok) result.saleBuyerFilled = true;
    }
    if (grantor && passes(grantor)) {
      const up = await q(domain, 'PATCH',
        `sales_transactions?sale_id=eq.${sid}&${cols.seller}=is.null`,
        { [cols.seller]: grantor }, { Prefer: 'return=minimal' }).catch(() => ({ ok: false }));
      if (up && up.ok) result.saleSellerFilled = true;
    }
  }

  // ── Unit 1(b): append the ownership_history event (recorded deed = transfer) ──
  let granteeOwnerId = null;
  if (grantee && passes && passes(grantee) && deps.resolveRecordedOwner && recDate) {
    granteeOwnerId = await deps.resolveRecordedOwner(domain, grantee).catch(() => null);
    if (granteeOwnerId) {
      const dateCol = domain === 'government' ? 'transfer_date' : 'ownership_start';
      const pkCol = domain === 'government' ? 'ownership_id' : 'id';
      const dq = await q(domain, 'GET',
        `ownership_history?property_id=eq.${propertyId}&recorded_owner_id=eq.${encodeURIComponent(granteeOwnerId)}` +
        `&${dateCol}=eq.${recDate}&select=${pkCol}&limit=1`).catch(() => ({ ok: false }));
      const exists = dq && dq.ok && Array.isArray(dq.data) && dq.data.length > 0;
      if (!exists) {
        // sale_id is uuid on gov / int on dia — only link when the matched sale's
        // PK fits the domain's column type (never coerce a mismatched type).
        const saleIdGov = confidentSale && UUID_RE.test(String(confidentSale.sale_id)) ? confidentSale.sale_id : null;
        const saleIdDia = confidentSale && /^\d+$/.test(String(confidentSale.sale_id)) ? Number(confidentSale.sale_id) : null;
        const row = domain === 'government'
          ? stripNullsLocal({
              property_id: propertyId, recorded_owner_id: granteeOwnerId,
              recorded_owner_name: grantee, new_owner: grantee, prior_owner: grantor,
              transfer_date: recDate, transfer_price: price, sale_price: price,
              sale_id: saleIdGov, matched_sale_id: saleIdGov,
              change_type: 'deed', data_source: 'deed_extraction', ownership_state: 'active',
            })
          : stripNullsLocal({
              property_id: propertyId, recorded_owner_id: granteeOwnerId,
              ownership_start: recDate, sold_price: price, sale_id: saleIdDia,
              acquisition_method: 'deed', ownership_source: 'deed_extraction',
              ownership_state: 'active', notes: `Recorded deed grantee (doc ${documentId})`,
            });
        const ins = await q(domain, 'POST', 'ownership_history', row, { Prefer: 'return=minimal' }).catch(() => ({ ok: false }));
        if (ins && ins.ok) result.ownershipEventAppended = true;
      }
    }
  }

  // ── Unit 2: a transfer with consideration but NO matching sale → research task.
  // NOTE: gov owner-conflicting deeds ALSO surface in the R53 v_suspected_sale
  // lane via the Step-4 R51 latest_deed_grantee feed (that lane reads the view,
  // not seeded decisions). This research task is the universally-VISIBLE producer
  // for both domains (a deed with consideration but no sale row), idempotent on
  // (research_type, property_id). We never write a sales row — a suspected sale is
  // a LEAD, confirmed only with an operator-supplied price.
  if (!confidentSale && recDate && Number(price) > 0 && grantee && passes && passes(grantee) && deps.openResearchTask) {
    const rt = await deps.openResearchTask({
      researchType: 'confirm_deed_transfer_sale', domain: short, propertyId,
      sourceTable: 'deed_extraction',
      title: `Confirm unrecorded sale: ${grantor || '?'} → ${grantee} (${recDate})`,
      instructions: `A recorded deed shows a transfer with consideration ($${price}) recorded ${recDate} ` +
        `but no matching sales_transactions row was found. Confirm the sale (operator price) or mark not-a-sale. Deed doc ${documentId}.`,
      metadata: { document_id: documentId, suspected_grantor: grantor, suspected_grantee: grantee,
        suspected_sale_date: recDate, suspected_price: price, price_source: parsed.price_source || null },
    }).catch(() => null);
    if (rt && rt.ok) result.suspectedSaleSurfaced = true;
  }

  // ── Unit 3: grantee → BD entity + owns edge (best-effort; NEVER an opportunity —
  // the R5 gate forbids a prospect opp for a buyer SPE and we open none). ────────
  if (grantee && passes && passes(grantee) && deps.ensureEntityLink) {
    const ent = await deps.ensureEntityLink({
      workspaceId: deps.workspaceId || null, userId: deps.userId || null,
      domain: short, sourceType: 'true_owner',
      seedFields: { name: grantee, metadata: { source: 'deed_extraction', property_id: String(propertyId), document_id: documentId } },
    }).catch(() => null);
    const ownerEntityId = ent && ent.ok ? (ent.entityId || ent.entity_id || null) : null;
    if (ownerEntityId) {
      result.granteeEntityId = ownerEntityId;
      // owns edge owner→asset: resolve the asset entity by its external identity
      // (resolveOnly — never invents an asset). owner=from, asset=to (R10/R17).
      if (deps.insertEntityRelationship) {
        const asset = await deps.ensureEntityLink({
          sourceSystem: short, sourceType: 'asset', externalId: String(propertyId),
          domain: short, resolveOnly: true,
        }).catch(() => null);
        const assetEntityId = asset && asset.ok ? (asset.entityId || asset.entity_id || null) : null;
        if (assetEntityId && String(assetEntityId) !== String(ownerEntityId)) {
          let edgeExists = false;
          if (deps.opsQuery) {
            const ex = await deps.opsQuery('GET',
              `entity_relationships?from_entity_id=eq.${encodeURIComponent(ownerEntityId)}` +
              `&to_entity_id=eq.${encodeURIComponent(assetEntityId)}` +
              `&relationship_type=eq.owns&select=id&limit=1`).catch(() => ({ ok: false }));
            edgeExists = ex && ex.ok && Array.isArray(ex.data) && ex.data.length > 0;
          }
          if (!edgeExists) {
            const er = await deps.insertEntityRelationship({
              from_entity_id: ownerEntityId, to_entity_id: assetEntityId,
              relationship_type: 'owns',
              metadata: { source: 'deed_extraction', document_id: documentId },
            }).catch(() => ({ ok: false }));
            if (er && er.ok) result.ownsEdgeCreated = true;
          }
        }
      }

      // ── Unit 4 (deed): a private-LLC grantee that does NOT resolve to a known
      // parent → a trace-to-developer research task (idempotent on property). ──
      if (deps.resolveBuyerParent && deps.openResearchTask && /\b(llc|l\.?l\.?c|lp|l\.?p|llp)\b/i.test(grantee)) {
        const pr = await deps.resolveBuyerParent(ownerEntityId).catch(() => null);
        const parentId = pr && pr.ok && Array.isArray(pr.data) && pr.data[0]
          ? pr.data[0].parent_entity_id
          : (pr && pr.parent_entity_id) || null;
        if (!parentId) {
          const rt = await deps.openResearchTask({
            researchType: 'trace_grantee_to_parent', domain: short, propertyId,
            entityId: ownerEntityId, sourceTable: 'deed_extraction',
            title: `Trace grantee to parent: ${grantee}`,
            instructions: `The recorded deed grantee "${grantee}" is a private entity that does not resolve ` +
              `to a known buyer parent. Trace its ownership/control to a parent (SOS / chain research). Deed doc ${documentId}.`,
            metadata: { document_id: documentId, grantee },
          }).catch(() => null);
          if (rt && rt.ok) result.traceGranteeTaskSurfaced = true;
        }
      }
    }
  }
}

/**
 * Conservative grantee guard for the R51 feed — must contain a letter and be
 * substantive (>= 4 alphanumerics). Keeps the broker/federal anti-patterns the
 * R51 view already filters from polluting latest_deed_grantee at the source.
 *
 * R59b — also rejects the OCR garbage shapes a scanned grant deed produces: a
 * form-field instruction label, a legal-description blob, an over-long sentence/
 * clause. A name that survives this is still re-checked downstream by
 * granteePassesOwnerGuards (broker/federal/junk) before any BD write.
 */
function granteeIsPlausible(name) {
  if (!name || typeof name !== 'string') return false;
  if (!/[A-Za-z]/.test(name)) return false;
  if (name.replace(/[^A-Za-z0-9]/g, '').length < 4) return false;
  if (/^\s*(u\s?\.?\s?s\s?\.?\s?a|united states|gsa|government|federal|n\.?\/?a|unknown|none|tbd)\b/i.test(name)) return false;
  if (isFormBoilerplateOrLegalDescription(name)) return false;
  return true;
}

/**
 * R59b — reject a candidate party that is actually a county-form instruction
 * label or a legal-description span (OCR latches onto these on scanned deeds),
 * or is simply too long / sentence-shaped to be an entity name.
 *   doc 1896: "name, mailing address, and, if appropriate, character of entity, e.g."
 *   doc 1935: "…POINT OF BEGINNING… metes and bounds…" (~600 chars)
 * A real grantee/grantor name is short and has few internal commas, so this is
 * conservative — "Deltona Wellness, LP" / "ABC Holdings, LLC" all pass.
 */
function isFormBoilerplateOrLegalDescription(name) {
  if (!name) return false;
  const n = String(name);
  // Too long to be an entity name — OCR grabbed a clause / legal-description blob.
  if (n.length > 80) return true;
  // County-form instruction boilerplate (the parenthetical that follows a label).
  if (/\b(mailing\s+address|character\s+of\s+entity|e\.\s?g\.|i\.\s?e\.|if\s+appropriate|space\s+above\s+(?:this|reserved|for)|for\s+recorder|documentary\s+transfer\s+tax|return\s+to)\b/i.test(n)) return true;
  // Legal-description markers.
  if (/\b(point\s+of\s+beginning|metes\s+and\s+bounds|more\s+particularly\s+described|deed\s+book|page\s+\d|\bthence\b|book\s+\d+\s+page|section\s+\d+,?\s+township|together\s+with\s+all)\b/i.test(n)) return true;
  // Compass bearings in a legal description: "North 45°", "S 12 deg".
  if (/\b[NS]\s*\d{1,2}\s*(?:°|deg\b|degrees\b)/i.test(n)) return true;
  // Sentence/clause shape — a real party name rarely carries 4+ commas/semicolons.
  if ((n.match(/[,;]/g) || []).length >= 4) return true;
  return false;
}

/**
 * R59b — single clean+validate gate every extraction path runs its raw candidate
 * through. Reuses the R58c qualifier-stripping (`leadingEntityName`), then trims
 * an OCR-bleed tail, then validates. Returns a clean name or null (so the caller's
 * `||` fallback chain continues instead of latching onto junk).
 */
function cleanAndValidateParty(raw) {
  if (!raw) return null;
  let n = leadingEntityName(raw);          // R58c qualifier / a-k-a / address strip
  n = trimTrailingOcrNoise(n);             // R59b OCR-bleed tail
  if (!n) return null;
  return granteeIsPlausible(n) ? n : null; // form / legal-desc / length / federal guard
}

/**
 * R59b — trim an OCR-bleed tail off an otherwise-good name. Two shapes:
 *  (a) a no-comma entity-type clause the comma-anchored `leadingEntityName` missed
 *      — "LA MIRADA INVESTMENT LLC A CALIFORNIA LIMITED LIABILITY COMPANY Area"
 *  (b) a single dangling capitalized stray token after a firm suffix
 *      — "… LIMITED LIABILITY COMPANY Area" / "FOO LLC Area" → drop "Area".
 */
function trimTrailingOcrNoise(name) {
  if (!name) return name;
  let n = String(name);
  // (a) no-comma "[,]? a <state/words> limited liability company/corporation/…" clause.
  n = n.replace(
    /\s*,?\s+an?\s+(?:[A-Za-z]+\s+){0,3}(?:limited\s+liability\s+company|limited\s+(?:liability\s+)?partnership|general\s+partnership|professional\s+(?:corporation|association)|corporation|company)\b.*$/i,
    ''
  );
  // (b) a lone trailing capitalized stray token right after a firm suffix.
  n = n.replace(
    /\b(LLC|L\.L\.C\.?|LP|L\.P\.?|LLP|INC|CORP|CORPORATION|CO|TRUST|HOLDINGS|PARTNERS|COMPANY)\.?\s+[A-Z][a-z]+\s*$/,
    '$1'
  );
  return cleanEntityName(n);
}

/**
 * R59b — scanned-deed fallback: the "THIS [SPECIAL WARRANTY] DEED … from <Grantor>
 * to <Grantee>" recital form (parties named without the `(the "Grantor")` marker
 * that OCR frequently drops). Validated like every other path.
 */
function extractFromToParty(text, which) {
  if (!text) return null;
  const m = text.match(
    /\bdeed\b[^.]{0,160}?\bfrom\s+(.+?)\s+\bto\s+(.+?)(?:[,.]|\s+(?:dated|whose|the\s+following|all\s+that|that\s+certain|for\s+(?:and|valuable|the)|its\s+successors|in\s+consideration)|[\r\n]|$)/is
  );
  if (!m) return null;
  return cleanAndValidateParty(which === 'Grantor' ? m[1] : m[2]);
}

// ============================================================================
// HELPERS
// ============================================================================

// Quote class covering straight + curly single/double quotes (OCR/PDF vary).
const Q = '["\\u201C\\u201D\\u2018\\u2019\']?';

/**
 * R58b Unit 1 — labeled cover-page party.
 * "First Grantor: NAME", "Grantor: NAME", "Grantor(s): NAME" — value runs up to
 * the next Grantor/Grantee label, a "Fees:"/"Consideration:" field, or EOL.
 * `which` is the canonical label ('Grantor' | 'Grantee').
 */
function extractLabeledParty(text, which) {
  if (!text) return null;
  const re = new RegExp(
    '(?:^|[\\r\\n]|\\s)(?:First\\s+)?' + which + '(?:\\(s\\))?\\s*:\\s*' +
    '(.+?)' +
    '(?=\\s+(?:First\\s+)?Grant(?:or|ee)(?:\\(s\\))?\\s*:|\\s+(?:Fees?|Consideration|Document(?:ary)?|Recording)\\b|[\\r\\n]|$)',
    'i'
  );
  const m = text.match(re);
  if (!m) return null;
  // R59b — validate the labeled value (a scanned grant-deed form puts a
  // parenthetical instruction after the label, e.g. "Grantee (name, mailing
  // address, …, e.g. …)"). An invalid value returns null so the caller falls
  // through to the narrative / from-to / legacy paths.
  return cleanAndValidateParty(m[1]);
}

/**
 * R58c Unit 1 — narrative parenthetical party, anchored on the CONNECTIVE.
 *
 * Real warranty/quitclaim deeds put a long entity-type qualifier AND a notice
 * address BETWEEN the entity name and the `(the "Grantor")` defined-term marker,
 * e.g.
 *   "… by and between Oldsmar Retail Development LLC, a Florida limited liability
 *    company, a/k/a Oldsmar Retail Development, LLC, whose address is 3662 Avalon
 *    Park East Blvd, Suite 201, Orlando, Florida 32828 (the "Grantor"), and
 *    Deltona Wellness, LP, a Florida limited partnership, whose address is …
 *    (the "Grantee") …"
 * so the token immediately BEFORE the marker is the ADDRESS, not the name.
 *
 * R58b captured backward from the marker (`[^()\r\n;.]*?`), and the intervening
 * newlines/periods/parens in that address broke the capture → `no_parties`. R58c
 * instead anchors on the connective that INTRODUCES the party (grantor: the
 * recital "between"; grantee: the "and" that joins the two parties) and takes the
 * LEADING entity name up to the first qualifier delimiter — robust to whatever
 * address/aka junk trails it. A deed of trust (no Grantor/Grantee marker) → null.
 * Precedence is unchanged: the labeled cover-page path wins; this is the
 * fallback; an implausible cleaned name falls through (no bad party emitted).
 */
function extractNarrativeParty(text, which) {
  if (!text) return null;

  // 1. Locate the defined-term marker — parenthesized `(the "Grantor")` or the
  //    bare quoted form `the "Grantor"` (quotes required when no parens).
  const Qc = '["\\u201C\\u201D\\u2018\\u2019\']';
  const markerRe = new RegExp(
    '\\(\\s*[Tt]he\\s+' + Q + which + Q + '\\s*\\)' +
    '|[Tt]he\\s+' + Qc + '\\s*' + which + '\\s*' + Qc,
    'i'
  );
  const marker = text.match(markerRe);
  if (!marker) return null;
  const before = text.slice(0, marker.index);

  // 2. The connective that introduces this party. Use the LAST one before the
  //    marker so the recital's "by and between" is skipped. Grantor → "between".
  //    Grantee → ", and" (the join between the two parties), falling back to a
  //    bare " and " for the comma-less "(the "Grantor") and X (the "Grantee")".
  const span = which === 'Grantee'
    ? (sliceAfterLast(before, /,\s*and\s+/gi) ?? sliceAfterLast(before, /\band\s+/gi))
    : sliceAfterLast(before, /\bbetween\s+/gi);
  if (span == null) return null;

  // 3. Leading entity name = everything before the first qualifier delimiter,
  //    then validate via the shared R59b clean+validate gate (qualifier strip +
  //    OCR-tail trim + the plausibility / form-label / legal-desc guard).
  return cleanAndValidateParty(span);
}

/** Text after the LAST match of a global `re` in `s`, or null when none match. */
function sliceAfterLast(s, re) {
  let idx = -1, len = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(s)) !== null) {
    idx = m.index; len = m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++; // zero-width-match guard
  }
  return idx < 0 ? null : s.slice(idx + len);
}

/**
 * From a connective-anchored span, the entity name is everything up to the FIRST
 * qualifier delimiter — the entity-type clause / a-k-a / notice address / role
 * that always follows the name in the narrative form, e.g.
 *   "Oldsmar Retail Development LLC, a Florida limited liability company, a/k/a …"
 *      → "Oldsmar Retail Development LLC"
 *   "Deltona Wellness, LP, a Florida limited partnership, whose address is …"
 *      → "Deltona Wellness, LP"   (the ", LP" is NOT a ", a/an …" qualifier)
 * `\s+` spans newlines, so a name immediately followed by ",\na Florida …" (the
 * address wrapped to the next OCR line) is still cut correctly.
 */
function leadingEntityName(span) {
  if (!span) return null;
  const qualifierRe = new RegExp(
    [
      ',\\s+an?\\s',                    // ", a "/", an " — entity-type / individual / married clause
      '\\ba\\/k\\/a\\b',                // a/k/a
      '\\bf\\/k\\/a\\b',                // f/k/a
      '\\bn\\/k\\/a\\b',                // n/k/a
      ',?\\s*whose\\s+address',         // whose address / , whose address
      ',?\\s*having\\s+an?\\s+address', // having an address
      ',\\s+as\\s+trustee\\b',          // , as trustee
      ',\\s+trustee\\b',                // , trustee
    ].join('|'),
    'i'
  );
  const m = span.match(qualifierRe);
  const head = m ? span.slice(0, m.index) : span;
  return cleanEntityName(head);
}

/** First capture group of the first matching pattern, cleaned. */
function firstPatternMatch(text, patterns) {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return cleanEntityName(m[1]);
  }
  return null;
}

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
