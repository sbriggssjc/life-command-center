// ============================================================================
// Shared listing_date derivation — Life Command Center
//
// Single source of truth for turning a capture/extraction's on-market signal
// into a real listing_date, used by BOTH the CoStar sidebar writer
// (api/_handlers/sidebar-pipeline.js) and the OM-intake promoter
// (api/_handlers/intake-promoter.js). Stamping the capture date on every write
// poisoned the recent edge of the supply-side Capital Markets charts; this
// keeps the two writers consistent.
//
// Pure + deterministic given `nowMs` so it is unit-testable. Priority:
//   1. explicit on-market date (metadata.listing_date), when ≤ capture day
//   2. capture_date − days_on_market (DOM bounded to [0, 1825] days = 5y)
//   3. capture date (last resort — no on-market signal present)
// Never returns a future date.
// ============================================================================

/** Parse a loose date value to a YYYY-MM-DD string, or null. Numbers rejected
 *  (a bare year like 2030 would otherwise be read as ms-since-epoch → 1970). */
export function toDatePart(v) {
  if (v == null) return null;
  if (typeof v === 'number') return null;
  if (typeof v !== 'string' && !(v instanceof Date)) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

/**
 * @param {object} metadata  capture/extraction fields (listing_date, days_on_market)
 * @param {number} [nowMs]   capture instant in ms (injectable for tests)
 * @returns {{listing_date: string, source: string}}
 */
export function deriveListingDate(metadata = {}, nowMs = Date.now()) {
  const capturePart = new Date(nowMs).toISOString().split('T')[0];
  const onMarket = toDatePart(metadata?.listing_date);
  const domRaw   = parseInt(metadata?.days_on_market, 10);
  const domDays  = Number.isFinite(domRaw) && domRaw >= 0 && domRaw <= 1825 ? domRaw : null;
  if (onMarket && onMarket <= capturePart) {
    return { listing_date: onMarket, source: 'on_market_date' };
  }
  if (domDays != null) {
    return {
      listing_date: new Date(nowMs - domDays * 86400 * 1000).toISOString().split('T')[0],
      source: 'days_on_market',
    };
  }
  return { listing_date: capturePart, source: 'capture_date_fallback' };
}
