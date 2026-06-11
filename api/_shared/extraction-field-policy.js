// ============================================================================
// Stage B Unit 0 — extraction field policy (the advisory write-path guard)
// Life Command Center
//
// Guard #3 of the 4-part advisory boundary. BOV/Master extraction produces three
// classes of figure with three DIFFERENT destinies (Scott, 2026-06-11):
//
//   • PROMOTABLE client-pricing advisory — ask / trade_low / trade_high /
//     recommended_value / recommended_cap. A recommendation to a client. Writes
//     to property_valuation_advisory ONLY; a CONFIRMED listing may later promote
//     ask / recommended_cap into reported asking_price / asking_cap (Unit 2 gate).
//   • INTERNAL valuation analytic — stabilized_noi / discount_rate / economic_cap
//     / implied_cap. Our adjusted math / the gov-engine (#64) inputs+outputs.
//     Lives in cap_rate_history / property_financials, PERMANENTLY quarantined —
//     NO promotion path (the reported market cap is always the OBSERVED sale cap;
//     an economic-cap adjustment can never be presented as the market number).
//   • FACTUAL — tenant, guarantor, rent, SF, lease terms, expense schedule, comp
//     figures (closed deals). Flow to the record with provenance.
//
// This module is the single chokepoint the extractor/writer consult BEFORE any
// domain write, so an advisory/internal value can never reach a reported field.
// Pure + dependency-free (mirrors folder-feed-classify.js) so it is unit-testable
// and importable from any writer.
// ============================================================================

// Promotable client-pricing advisories → property_valuation_advisory (Unit 2 may promote).
export const ADVISORY_PROMOTABLE_TYPES = new Set([
  'ask', 'trade_low', 'trade_high', 'recommended_value', 'recommended_cap',
]);

// Internal valuation analytics → #64 ledgers; NEVER promotable to reported.
export const INTERNAL_ANALYTIC_TYPES = new Set([
  'stabilized_noi', 'discount_rate', 'economic_cap', 'implied_cap',
]);

// Reported market fields — the destinations advisory/internal values may NEVER
// target. The price/cap a client SEES as the market number.
export const REPORTED_FIELDS = new Set([
  'listing_price', 'asking_price', 'asking_cap', 'original_price',
  'last_price', 'last_price_change', 'sold_price', 'sold_cap_rate',
]);

/**
 * Classify an extracted valuation figure by its value_type.
 * @returns {'advisory_promotable'|'internal_analytic'|'unknown'}
 */
export function classifyValuation(valueType) {
  const v = String(valueType || '').trim().toLowerCase();
  if (ADVISORY_PROMOTABLE_TYPES.has(v)) return 'advisory_promotable';
  if (INTERNAL_ANALYTIC_TYPES.has(v)) return 'internal_analytic';
  return 'unknown';
}

/** True when a target field is a reported market field. */
export function isReportedField(field) {
  return REPORTED_FIELDS.has(String(field || '').trim().toLowerCase());
}

/**
 * Resolve where an extracted valuation figure is ALLOWED to land, and whether it
 * is ever promotable. The extractor uses this to route; it never picks a reported
 * field as a target for an advisory/internal value.
 * @returns {{store:string|null, promotable:boolean, class:string}}
 */
export function valuationDestination(valueType) {
  const cls = classifyValuation(valueType);
  if (cls === 'advisory_promotable') {
    return { store: 'property_valuation_advisory', promotable: true, class: cls };
  }
  if (cls === 'internal_analytic') {
    const v = String(valueType).toLowerCase();
    // economic/implied cap → cap_rate_history (event_type='valuation'); NOI/
    // discount rate → property_financials. Both #64-owned, never promotable.
    const store = (v === 'economic_cap' || v === 'implied_cap')
      ? 'cap_rate_history' : 'property_financials';
    return { store, promotable: false, class: cls };
  }
  return { store: null, promotable: false, class: cls };
}

/**
 * THE GUARD. A value targeting a reported field is allowed ONLY when it is a
 * factual write or a confirmation-gated promotion. An advisory/internal value
 * targeting a reported field is rejected — the leak the four guards exist to stop.
 *
 * @param {object} a
 * @param {string} a.valueType      the extracted value_type (e.g. 'recommended_cap')
 * @param {string} a.targetField    the field about to be written
 * @param {boolean} [a.listingConfirmed]  Unit 2: a confirmed listing unlocks promotion of `ask`/`recommended_cap`
 * @returns {{ok:boolean, reason?:string, class:string}}
 */
export function guardValuationWrite({ valueType, targetField, listingConfirmed = false }) {
  const cls = classifyValuation(valueType);
  if (!isReportedField(targetField)) {
    return { ok: true, class: cls };  // not a reported field → advisory/ledger store, fine
  }
  // Target IS a reported field.
  if (cls === 'internal_analytic') {
    return { ok: false, reason: 'internal_analytic_cannot_reach_reported', class: cls };
  }
  if (cls === 'advisory_promotable') {
    // Promotion path: only ask → price-ish, recommended_cap → cap, AND only when
    // the listing is confirmed (Unit 2 gate). Otherwise reject.
    const v = String(valueType).toLowerCase();
    const promotable = (v === 'ask' || v === 'recommended_value' || v === 'recommended_cap');
    if (listingConfirmed && promotable) return { ok: true, reason: 'promoted_listing_confirmed', class: cls };
    return { ok: false, reason: 'advisory_not_promotable_until_listing_confirmed', class: cls };
  }
  // Unknown value_type → never let it reach a reported field.
  return { ok: false, reason: 'unclassified_valuation_to_reported', class: cls };
}
