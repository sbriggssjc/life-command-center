// ============================================================================
// Intake OM extraction prompt builder — pure, model-agnostic, testable
// Life Command Center · Prompt 61 (W5.3 follow-up)
//
// Extracted from intake-extractor.js::callAiExtraction so it can be unit-tested
// and hardened without touching the extraction pipeline plumbing. ONE prompt,
// model-agnostic: the cloud chain (Claude/OpenAI) and the local model
// (qwen2.5:14b via Ollama) all receive the same instructions. The local model
// additionally gets Ollama's native `response_format:json_object` (see
// _shared/ai.js::invokeOllamaExtraction) — this prompt is the belt, that is the
// suspenders.
//
// W5.3 grading (docs/audits/W5_3_LOCAL_LLM_EVALUATION_2026-08-06.md) measured the
// local model drifting hard on OM extraction: NOI 4% vs cloud 93%, lease
// responsibility keys NEVER emitted, sale-comp keys (seller/sold_price/
// sold_cap_rate) emitted on plain OMs, PSAs/listing-agreements/valuation-proposals
// misclassified `om`, and a signature-block broker grabbed as the seller. This
// builder answers each of those with an explicit, enumerated contract:
//   • the FULL key list, EXACTLY, null for absent, no extra keys;
//   • a doc-type rubric with the real vocabulary + one-line definitions;
//   • a party-role guard (signature blocks / broker lines are not seller/buyer);
//   • a sale-record guard (no sold_* / buyer unless the doc IS a closed sale);
//   • preserve abstain-don't-fabricate (the one behavior grading found GOOD).
// ============================================================================

// The canonical, exhaustive extraction key set. Order matters only for human
// readability; downstream consumers read by key. Keep this in lockstep with the
// persisted-summary + promoter field reads — adding/removing a key here changes
// what every provider is asked to emit.
export const EXTRACTION_SCHEMA_KEYS = [
  'document_type',
  'address',
  'addresses',
  'city',
  'state',
  'zip_code',
  'tenant_name',
  'tenant_guarantor',
  'property_type',
  'building_sf',
  'lot_sf',
  'year_built',
  'asking_price',
  'price_per_sf',
  'cap_rate',
  'sold_price',
  'sold_cap_rate',
  'noi',
  'financial_projections',
  'annual_rent',
  'rent_per_sf',
  'lease_commencement',
  'lease_expiration',
  'lease_term_years',
  'renewal_options',
  'expense_structure',
  'rent_escalations',
  'roof_responsibility',
  'hvac_responsibility',
  'structure_responsibility',
  'parking_responsibility',
  'listing_broker',
  'listing_broker_email',
  'listing_firm',
  'seller_name',
  'seller_email',
  'seller_phone',
  'seller_address',
  'buyer_name',
  'buyer_email',
  'buyer_phone',
  'owner_contact_name',
  'owner_contact_email',
  'owner_contact_phone',
  'parcel_number',
  'confidence_notes',
];

// Document-type vocabulary + one-line definitions. The `value` strings are what
// the model must emit for `document_type`; normalizeDocType (intake-classify.js)
// maps synonyms back to canonical short forms downstream. The non-listing deal
// types (psa/listing_agreement/valuation_proposal) exist SPECIFICALLY to stop
// the "everything is an om" drift measured in W5.3 — an executed PSA is not a
// live listing and must never be promoted into available_listings as one.
export const DOC_TYPE_RUBRIC = [
  ['om', 'Offering Memorandum — a broker marketing package for a property FOR SALE (address, tenant, price/cap, lease abstract).'],
  ['marketing_brochure', 'A multi-page marketing brochure for a property or portfolio for sale (brochure-grade, not a full OM).'],
  ['flyer', 'A 1–2 page broker teaser / one-pager for a property for sale.'],
  ['rent_roll', 'A tenant-by-tenant rent schedule (units, rents, terms) — not a marketing doc.'],
  ['lease_abstract', 'A summary of a single lease’s economic + responsibility terms.'],
  ['psa', 'A Purchase & Sale Agreement / contract of sale (executed or draft) between a named buyer and seller — a legal contract, NOT a listing.'],
  ['listing_agreement', 'A listing / representation agreement engaging a broker to market a property — a legal engagement, NOT a listing-for-sale marketing doc.'],
  ['valuation_proposal', 'A BOV / broker opinion of value / valuation or pitch proposal — an internal/advisory valuation, NOT an on-market listing.'],
  ['broker_email', 'A broker email body (teaser, blast, or thread) with deal data but no formal marketing document.'],
  ['comp', 'A comparable-sale record: a CLOSED sale with a sold price/cap and a sale date.'],
  ['unknown', 'None of the above / cannot be determined.'],
];

/**
 * Build the JSON-schema-in-prompt block: an exact key list, each on its own
 * line as `"key": null`, so the model returns EXACTLY these keys.
 */
function schemaBlock() {
  const lines = EXTRACTION_SCHEMA_KEYS.map((k) => {
    // document_type carries the enum inline as its example value.
    if (k === 'document_type') {
      const enumStr = DOC_TYPE_RUBRIC.map(([v]) => v).join('|');
      return `  "document_type": "${enumStr}"`;
    }
    return `  "${k}": null`;
  });
  return `{\n${lines.join(',\n')}\n}`;
}

function rubricBlock() {
  return DOC_TYPE_RUBRIC.map(([v, def]) => `  - "${v}": ${def}`).join('\n');
}

/**
 * Build the deterministic provider stamp attached to the extraction snapshot
 * itself (Prompt 61 #2), from the module-level __lastAiCallInfo sidechannel.
 * Pure (no timestamp) so it is unit-testable; the caller adds stamped_at.
 *
 * @param {object|null} aiCallInfo  { final_provider, final_model, fell_back, tried[] }
 * @returns {{final_provider, final_model, fell_back, chain}}
 */
export function buildProviderStamp(aiCallInfo) {
  const info = aiCallInfo || {};
  return {
    final_provider: info.final_provider || null,
    final_model:    info.final_model || null,
    fell_back:      Boolean(info.fell_back),
    chain:          Array.isArray(info.tried) ? info.tried.map((t) => t && t.stage).filter(Boolean) : [],
  };
}

/**
 * Build the full extraction prompt.
 *
 * @param {string} documentBody  The document text block (already framed by the
 *                               caller: "Document (N pages) — extracted text: …",
 *                               an email body, or a scanned-PDF note).
 * @returns {string}             The complete, model-agnostic extraction prompt.
 */
export function buildExtractionPrompt(documentBody = '') {
  return `Extract all available deal data from this CRE document.
Return ONLY a single JSON object — no markdown, no code fence, no explanation, no preamble.
The object MUST contain EXACTLY the keys shown in the schema below, in that shape. Use null for any field the document does not explicitly state. Do NOT invent keys and do NOT omit keys.

RULES
- Monetary values: numbers only (no $, no commas). Percentages: decimals (7.5% → 7.5).
- EXCEPTION — "cap_rate", "sold_cap_rate": return a DECIMAL FRACTION (6.5% → 0.065, 7.75% → 0.0775).
- Dates: YYYY-MM-DD.
- "address" MUST be the SUBJECT PROPERTY's street address. Do NOT return the listing broker's, marketing firm's, or contact-block address (header/footer or "For more information contact …"). If only a contact/brokerage address is present, return null for "address".
- Portfolio (MULTIPLE subject properties): return every subject-property street address as a JSON array of strings in "addresses", and the primary one in "address". Single-property: "addresses" = null. Never pack multiple addresses into "address".
- NEVER fabricate. If the document does not literally state a field, return null. Abstaining is correct; guessing is not.

DOCUMENT-TYPE RUBRIC — set "document_type" to the single best match:
${rubricBlock()}
  Classify by what the document IS, not what property it concerns. An executed contract is "psa", a broker engagement is "listing_agreement", a BOV/pitch is "valuation_proposal" — NONE of these are "om" even though they describe a property.

SALE-RECORD GUARD:
- "sold_price" / "sold_cap_rate" describe a CLOSED sale of THIS property. Populate them ONLY when the document is a comp, a psa, or explicitly states a completed sale (a sold price AND a sale date). For an on-market OM / flyer / brochure / listing_agreement, leave "sold_price" and "sold_cap_rate" null.
- "buyer_name"/"buyer_email"/"buyer_phone": populate ONLY when the document names an acquiring party in a sale/contract context. An on-market OM has no buyer — leave null.

PARTY-ROLE GUARD:
- A name in a SIGNATURE BLOCK, a "prepared by" line, a "listed by" line, or a broker/agent contact block is the BROKER — NOT the seller, buyer, or owner. Put brokers ONLY in "listing_broker"/"listing_broker_email"/"listing_firm".
- "seller_name"/"seller_email"/"seller_phone": the property SELLER / current owner of record (the entity disposing of the asset), only when the document explicitly identifies it as such. "seller_address" is the SELLER's own mailing/notice address — NOT the subject property's address.
- "owner_contact_*": a named owner/principal contact ONLY when DISTINCT from the listing broker and the seller (e.g. an asset-manager block). Never copy the broker's details into seller/buyer/owner fields.

${documentBody}
SCHEMA (return EXACTLY these keys):
${schemaBlock()}

FIELD NOTES
- "noi": the IN-PLACE / current net operating income the document states (number only).
- "cap_rate": the current/asking cap (decimal fraction).
- "financial_projections": if the document tabulates a MULTI-YEAR rent/expense/NOI schedule, return a JSON array [{"year": 2025, "gross_rent": null, "expenses": null, "noi": null}, …], numbers only, null per-field when not stated. Return null (not []) when there is no multi-year schedule. Do NOT fabricate or interpolate years — include only years explicitly tabulated.
- Responsibility fields ("roof_responsibility", "hvac_responsibility", "structure_responsibility", "parking_responsibility"): return "tenant", "landlord", or "shared" from the lease language (keywords: repair/replace/maintain/responsible near roof / HVAC-heating-cooling / structural-foundation-walls / parking-lot-striping). In an OM these live in the lease-abstract section. Return null only when the document truly does not state responsibility — do NOT drop these keys.
- "confidence_notes": a short free-text note on anything ambiguous or low-confidence (or null).`;
}
