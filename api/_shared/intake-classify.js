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

// ── Cap-rate normalization (Round 77f, 2026-06-04) ───────────────────────
// The extractor emits cap rates in BOTH forms depending on the AI/prompt:
//   - decimal fraction  : 0.055  (5.5%)        — already DB-ready
//   - whole-number pct   : 7.75   (7.75%)       — needs ÷100
// The promoter previously assumed percent form and unconditionally divided by
// 100, so a decimal-form 0.055 became 0.00055 and blew the
// chk_*_cap_rate_decimal_range check ([0.005, 0.30]) — killing the listing
// INSERT (Buckeye AZ, listing 23514, 2026-06-04). Detect, don't assume.
//
// Returns a DB-ready DECIMAL cap rate, or null when the value is implausible
// either way (callers keep the raw value in notes/metadata rather than failing
// the row). Plausible decimal band mirrors the DB check: [0.005, 0.30].
//
//   v > 1.5            → treat as percent, ÷100, accept only if result in band
//   0.005 ≤ v ≤ 0.30   → already decimal, pass through
//   0.30 < v ≤ 1.5     → ambiguous/implausible → null
//   v < 0.005          → implausible (e.g. a double-divided 0.00055) → null
export function normalizeCapRate(v) {
  if (v == null) return null;
  let n;
  if (typeof v === 'number') {
    n = v;
  } else {
    // Strip $, %, commas, whitespace — keep digits, dot, minus.
    const cleaned = String(v).replace(/[^0-9.\-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    n = Number(cleaned);
  }
  if (!Number.isFinite(n) || n <= 0) return null;

  if (n > 1.5) {
    const dec = n / 100;
    return dec >= 0.005 && dec <= 0.30 ? round6(dec) : null;
  }
  if (n >= 0.005 && n <= 0.30) return round6(n);
  return null;
}

function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}

// ── Array-valued snapshot field coercion (Round 77f, 2026-06-04) ──────────
// The F1/F2 work made tenant_name, listing_broker, listing_broker_email,
// seller_name (etc.) legitimately ARRAY-valued for multi-tenant / multi-broker
// OMs. Scalar consumers (`(snapshot.foo || '').trim()`, text-column writes)
// then crash with "(...).trim is not a function" or stuff a raw JSON array
// (["Jay","Tom"]) into a text column. These helpers coerce at the call site:
//   - firstOf(v)        → first non-empty element when array (or array-shaped
//                         JSON string), else the scalar. "first-as-primary".
//   - joinedOf(v, sep)  → human-joined string ("Jay Patel, Thomas Ladt") when
//                         array/array-string, else the scalar. For text columns
//                         and for feeding the broker comma-splitter — never raw
//                         JSON.

function parseArrayShape(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* not JSON — treat as scalar */ }
    }
  }
  return null;
}

export function firstOf(v) {
  if (v == null) return v;
  const arr = parseArrayShape(v);
  if (arr == null) return v; // scalar — pass through unchanged
  const first = arr.find((x) => x != null && String(x).trim() !== '');
  return first == null ? null : first;
}

export function joinedOf(v, sep = ', ') {
  if (v == null) return v;
  const arr = parseArrayShape(v);
  if (arr == null) return v; // scalar — pass through unchanged
  return arr
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean)
    .join(sep);
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
