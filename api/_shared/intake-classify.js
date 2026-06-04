// ============================================================================
// Intake classification — doctype normalization + deal/non-deal disposition
// Life Command Center
//
// Pure, dependency-free helpers shared by the extractor, the promoter, the
// create-from-intake handler, and the rematch/disposition worker. Kept in
// _shared (no DB imports) so it loads instantly in unit tests and can be
// imported from any layer without pulling the promoter's heavy graph.
//
// Single source of truth for:
//   - DOCTYPE_ALIASES / normalizeDocType   (was local to intake-promoter.js)
//   - LISTING_DOCUMENT_TYPES               (om / flyer / marketing_brochure)
//   - snapshotLooksLikeListing             (listing-grade heuristic)
//   - isNonDealSnapshot                    (auto-disposition classifier)
//   - hasFullDealSignature                 (guarded AUTO-create gate)
// ============================================================================

// Document types that represent on-market listing marketing. Full OMs,
// 1-page broker flyers, and marketing brochures all contain listing-grade
// data (address, tenant, price, cap rate, lease terms, broker) and populate
// available_listings identically. Comps and lease abstracts are deal-adjacent
// but not listings-of-record; they stay out of this set.
export const LISTING_DOCUMENT_TYPES = new Set([
  'om',
  'flyer',
  'marketing_brochure',
]);

// ── Doctype normalization (Bug Z fix, 2026-04-27) ────────────────────────
// The extractor returns document_type values that vary across AI providers
// and prompt versions: 'om', 'OM', 'offering_memorandum', 'offering memorandum',
// 'broker package', 'broker_package', 'flyer', 'marketing_flyer', etc.
// Normalize at the boundary so any variant of "OM" maps back to 'om', etc.
const DOCTYPE_ALIASES = {
  // OM variants
  'om':                    'om',
  'offering_memorandum':   'om',
  'offering memorandum':   'om',
  'offering-memorandum':   'om',
  'offering':              'om',
  'broker_package':        'om',
  'broker package':        'om',
  'investment_memorandum': 'om',
  'investment memorandum': 'om',
  // Flyer variants
  'flyer':                 'flyer',
  'broker_flyer':          'flyer',
  'broker flyer':          'flyer',
  'marketing_flyer':       'flyer',
  'marketing flyer':       'flyer',
  'one_pager':             'flyer',
  'one pager':             'flyer',
  'one-pager':             'flyer',
  // Brochure variants
  'marketing_brochure':    'marketing_brochure',
  'marketing brochure':    'marketing_brochure',
  'brochure':              'marketing_brochure',
};

/**
 * Normalize a document_type string to its canonical short form.
 * Returns the input (lower/trimmed) unchanged if no alias matches, so
 * non-listing types ('lease_abstract', 'rent_roll', 'unknown', 'comp', …)
 * flow through and are classified normally by the callers.
 */
export function normalizeDocType(dt) {
  if (!dt || typeof dt !== 'string') return dt;
  const key = dt.toLowerCase().trim();
  // Tolerate common typos / extra punctuation ("OFFERRING MEMORANDUM")
  const dedup = key.replace(/r{2,}/g, 'r').replace(/[.,]/g, '');
  return DOCTYPE_ALIASES[key] || DOCTYPE_ALIASES[dedup] || key;
}

/**
 * Heuristic: classify an extraction snapshot as listing-grade when
 * `document_type` is null/unknown but the snapshot carries the signals a
 * listing usually has (asking price + tenant + ≥1 of cap rate / building SF /
 * lease term, OR (cap/noi) + tenant + lease expiration). Used as a fallback so
 * low-quality classification doesn't block obviously-promotable deals.
 */
export function snapshotLooksLikeListing(snapshot) {
  if (!snapshot) return false;
  const hasPrice  = Number(snapshot.asking_price) > 0;
  const hasCap    = Number(snapshot.cap_rate) > 0
                 || (typeof snapshot.cap_rate === 'string' && /\d/.test(snapshot.cap_rate));
  const hasNoi    = Number(snapshot.noi) > 0;
  const hasTenant = !!(snapshot.tenant_name || snapshot.primary_tenant);
  const supportingFields = [
    snapshot.cap_rate,
    snapshot.building_sf,
    snapshot.lease_term_years,
    snapshot.lease_expiration,
    snapshot.noi,
  ].filter(v => v != null && v !== '').length;
  if (hasPrice && hasTenant && supportingFields >= 1) return true;
  if ((hasCap || hasNoi) && hasTenant && snapshot.lease_expiration) return true;
  return false;
}

// Doctypes that, on their own, keep an intake in the review pile even with no
// address/price — a comp or listing doc is deal-shaped enough to triage.
const DEAL_DISPOSITION_DOCTYPES = new Set(['om', 'flyer', 'marketing_brochure', 'comp']);

function snapshotHasAddress(snapshot) {
  if (!snapshot) return false;
  return !!(snapshot.address
    || (Array.isArray(snapshot.addresses) && snapshot.addresses.length));
}

function snapshotHasCapRate(snapshot) {
  if (!snapshot) return false;
  return Number(snapshot.cap_rate) > 0
    || (typeof snapshot.cap_rate === 'string' && /\d/.test(snapshot.cap_rate));
}

/**
 * Auto-disposition classifier (doctrine 2026-06-04).
 *
 * An intake is NON-DEAL — i.e. a newsletter / broker blast / thread history
 * that will never match or promote — when ALL of:
 *   - no extracted address
 *   - no asking_price
 *   - no cap_rate
 *   - document_type NOT IN (om, flyer, marketing_brochure, comp)
 * Tenant alone does NOT save it (a "DaVita is expanding" newsletter mentions
 * a tenant but carries no deal).
 *
 * Returns false for a null snapshot — that's an extraction *failure*, handled
 * separately, not a confidently-classified non-deal.
 */
export function isNonDealSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const dt = normalizeDocType(snapshot.document_type || '');
  if (DEAL_DISPOSITION_DOCTYPES.has(dt)) return false;
  if (snapshotHasAddress(snapshot)) return false;
  if (Number(snapshot.asking_price) > 0) return false;
  if (snapshotHasCapRate(snapshot)) return false;
  return true;
}

/**
 * Full deal signature: address + tenant + asking_price. Gate for the guarded
 * AUTO create-from-intake mode (the manual route is less strict — an operator
 * vouches for the item).
 */
export function hasFullDealSignature(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const hasTenant = !!(snapshot.tenant_name || snapshot.primary_tenant);
  return snapshotHasAddress(snapshot)
    && hasTenant
    && Number(snapshot.asking_price) > 0;
}
