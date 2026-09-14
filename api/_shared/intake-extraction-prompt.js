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
  'agency_full_name',
  'government_type',
  'credit_tier',
  'government_type_evidence',
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
 * Guarantee an extraction snapshot carries a `_provider` stamp before it is
 * persisted to staged_intake_extractions (Prompt 82). This is the SINGLE choke
 * point every writer of extraction_snapshot funnels through — one stamp shape,
 * no per-path forks.
 *
 * Coverage gap it closes (grounded 2026-08-08): the per-artifact stamp added in
 * Prompt 61 was applied inside the extraction loop and could be dropped before
 * the write (multi-artifact merge keeping only the priority winner's fields, a
 * null `__lastAiCallInfo` sidechannel, or a channel whose snapshot bypassed the
 * loop stamp), so only 4/15 fresh rows carried `_provider`. Stamping at the
 * write site makes it 100%.
 *
 * Semantics of an ABSENT vs PRESENT stamp (Prompt 82 #2): a written row must
 * NEVER be silently unstamped — a missing `_provider` should mean "old row
 * written before the stamp existed", never "unknown path". When there is a live
 * AI call sidechannel, stamp it; when a path genuinely made no AI call (e.g. a
 * manual re-stage), stamp `{final_provider:'none'}` rather than omitting.
 *
 * Idempotent: an already-stamped snapshot is returned untouched, so the
 * accurate per-artifact stamp (when present) wins over this write-site default.
 *
 * @param {object|null} snapshot     The extraction snapshot about to be written.
 * @param {object|null} aiCallInfo   The __lastAiCallInfo sidechannel, or null.
 * @param {string} [nowIso]          Injectable timestamp (for tests); defaults to now.
 * @returns {object|null}            The same snapshot, mutated to carry `_provider`.
 */
export function ensureProviderStamp(snapshot, aiCallInfo, nowIso) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  if (snapshot._provider && typeof snapshot._provider === 'object') return snapshot;
  const base = aiCallInfo
    ? buildProviderStamp(aiCallInfo)
    : { final_provider: 'none', final_model: null, fell_back: false, chain: [] };
  snapshot._provider = { ...base, stamped_at: nowIso || new Date().toISOString() };
  return snapshot;
}

// On-market document types (no closed-sale economics). The SALE-RECORD GUARD in
// the prompt tells the model to leave sold_price/sold_cap_rate null for these, but
// the model still drifts (grounded 2026-08-12: 7 on-market rows carried sold_*).
const ON_MARKET_DOC_TYPES = new Set([
  'om', 'flyer', 'marketing_brochure', 'brochure', 'listing_agreement', 'valuation_proposal',
]);

/**
 * Deterministic no-sale-keys strip at the persist site (Prompt 93). When the
 * snapshot's document_type is an ON-MARKET doctype, a closed-sale price/cap is a
 * hallucination — null `sold_price` / `sold_cap_rate` so the drift never reaches
 * the comps engine. Conservative: only strips for a KNOWN on-market doctype; a
 * null/unknown/comp/psa doctype is left untouched (a real comp keeps its sold_*).
 * Idempotent, mutates in place, returns the same snapshot.
 *
 * @param {object|null} snapshot
 * @returns {object|null}
 */
export function stripNonSaleKeys(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const dt = String(snapshot.document_type || '').toLowerCase();
  if (!ON_MARKET_DOC_TYPES.has(dt)) return snapshot;
  if (snapshot.sold_price != null) snapshot.sold_price = null;
  if (snapshot.sold_cap_rate != null) snapshot.sold_cap_rate = null;
  return snapshot;
}

/**
 * Reconstruct a `_provider` stamp from an intake's PERSISTED per-artifact
 * diagnostics (Prompt 93). Every extractor run persists ai_final_provider /
 * ai_final_model / ai_fell_back / ai_chain onto staged_intake_items.raw_payload
 * .extraction_result.diagnostics — the exact __lastAiCallInfo data the write-site
 * stamp would have captured. When a snapshot escaped the at-write stamp (e.g. the
 * Aug-10 burst that wrote before the Prompt-82 write-site deploy landed), this
 * rebuilds an ACCURATE stamp from the row's own provenance. Distinct
 * `reconstructed_from:'diagnostics'` marker so a rebuilt stamp is never confused
 * with a genuine at-write stamp. Returns null when no diagnostic names a provider.
 *
 * @param {Array<object>|null} diagnostics  raw_payload.extraction_result.diagnostics
 * @param {string} [nowIso]
 * @returns {object|null}  a `_provider` object, or null when unreconstructable.
 */
export function reconstructProviderStampFromDiagnostics(diagnostics, nowIso) {
  if (!Array.isArray(diagnostics) || !diagnostics.length) return null;
  // Winning diagnostic: a successful one that names a provider (prefer ai_ok).
  const withProvider = diagnostics.filter((d) => d && d.ai_final_provider);
  if (!withProvider.length) return null;
  const win = withProvider.find((d) => d.ai_ok) || withProvider[0];
  const chain = Array.isArray(win.ai_chain)
    ? win.ai_chain.map((c) => c && c.stage).filter(Boolean)
    : [];
  return {
    final_provider: win.ai_final_provider || null,
    final_model:    win.ai_final_model || null,
    fell_back:      Boolean(win.ai_fell_back),
    chain,
    stamped_at:        nowIso || new Date().toISOString(),
    reconstructed_from: 'diagnostics',
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
- "agency_full_name": for government leases, the full tenant agency name as stated. Otherwise null.
- "government_type" / "credit_tier": for government leases only, return "federal", "state", or "municipal" when explicitly stated or clearly derivable from agency text (examples: GSA/US/VA/FBI = federal; State of/Texas Dept/TX Health and Human Services = state; City of/County of/School District/Municipal Utility District = municipal). If multiple government tenants from different buckets are present, return a JSON array of the bucket names. If unclear, return null. Do not default to federal.
- "government_type_evidence": the short source phrase that supports "government_type" / "credit_tier", or null.
- Responsibility fields ("roof_responsibility", "hvac_responsibility", "structure_responsibility", "parking_responsibility"): return "tenant", "landlord", or "shared" from the lease language (keywords: repair/replace/maintain/responsible near roof / HVAC-heating-cooling / structural-foundation-walls / parking-lot-striping). In an OM these live in the lease-abstract section. Return null only when the document truly does not state responsibility — do NOT drop these keys.
- "confidence_notes": a short free-text note on anything ambiguous or low-confidence (or null).`;
}
