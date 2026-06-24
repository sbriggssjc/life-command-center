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

// ============================================================================
// T4c (2026-06-24): on-market date as a first-class, source-ranked field.
//
// `listing_date` keeps a value for operational/non-timing use (the CoStar
// sidebar + OM promoter still stamp it, falling back to the capture clock).
// `on_market_date` is the TIMING truth — what the supply-side / DOM charts
// read — and it is sourced ONLY from real market-entry EVIDENCE, NEVER the
// processing clock. When no evidence exists the row is HELD (on_market_date
// NULL, source 'unestablished') and excluded from the added-per-month +
// DOM series; a NULL is honest, a fabricated load-date is the "surge".
//
// The mass-forward guard: when a batch of ingests shares a near-identical
// processing burst (the teambriggsdialysis@gmail.com mailbox re-forward), the
// caller passes { massForward:true } and on_market_date is HELD regardless —
// the ingest clock is never a market signal. Because the recovered date is
// sourced from the immutable email Date / platform DOM (and the ladder takes
// the EARLIEST signal), re-forwarding the whole mailbox cannot move any
// already-set market date.
//
// Evidence ladder (highest confidence first; the clock is NOT on it):
//   1. explicit on-market date (metadata.listing_date ≤ capture) — high
//   2. platform days-on-market (CoStar/RCA "days on market") — medium
//   3. email Date the OM arrived on (metadata.email_date / source_email_date,
//      ≤ capture) — medium; the go-forward signal captured at ingest
//   4. otherwise HELD (null / 'unestablished' / 'none')
// ============================================================================

/** A listing_date_source that is REAL market-entry evidence (vs a clock
 *  fallback). Used by the backfill migrations to decide which historical
 *  listing_date is promotable to on_market_date and at what confidence. */
export const REAL_LISTING_DATE_SOURCES = Object.freeze({
  on_market_date:                            'high',
  costar_date_on_market:                     'high',
  costar:                                    'high',
  loopnet:                                   'high',
  rca:                                       'high',
  salesforce:                                'high',
  email_earliest:                            'high',
  master_curated:                            'medium',
  costar_days_on_market:                     'medium',
  days_on_market:                            'medium',
  om_lease_inference:                        'medium',
  sale_anchor_est_175:                       'low',
  synth_sale_minus_median_dom:               'low',
  synth_sale_minus_median_dom_clamped_r70d10:'low',
  om_received_fallback:                      'low',
});

/** A listing_date_source that is a processing-clock fallback (NOT evidence) —
 *  these rows are HELD (on_market_date NULL) until a real date is recovered. */
export const HELD_LISTING_DATE_SOURCES = Object.freeze([
  'capture_date_fallback', 'date_unknown', 'date_unknown_r70b34', 'date_unknown_held', null,
]);

const HELD = Object.freeze({ on_market_date: null, source: 'unestablished', confidence: 'none' });

/**
 * Derive the on-market date + provenance from a fresh capture's metadata.
 * NEVER returns the processing clock — an absent signal HOLDs (null).
 * @param {object} metadata  capture/extraction fields (listing_date,
 *   days_on_market, email_date | source_email_date)
 * @param {object} [opts]
 * @param {number} [opts.nowMs]        capture instant in ms (injectable for tests)
 * @param {boolean} [opts.massForward] true ⇒ this ingest is part of a detected
 *   mass-forward burst; HOLD regardless of any clock-derived signal
 * @returns {{on_market_date: string|null, source: string, confidence: string}}
 */
export function deriveOnMarketDate(metadata = {}, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const capturePart = new Date(nowMs).toISOString().split('T')[0];

  // 1. explicit on-market date (never future)
  const onMarket = toDatePart(metadata?.listing_date);
  if (onMarket && onMarket <= capturePart) {
    return { on_market_date: onMarket, source: 'on_market_date', confidence: 'high' };
  }

  // 2. platform days-on-market — real market age, independent of the clock-as-signal
  const domRaw  = parseInt(metadata?.days_on_market, 10);
  const domDays = Number.isFinite(domRaw) && domRaw >= 0 && domRaw <= 1825 ? domRaw : null;
  if (domDays != null) {
    return {
      on_market_date: new Date(nowMs - domDays * 86400 * 1000).toISOString().split('T')[0],
      source: 'days_on_market',
      confidence: 'medium',
    };
  }

  // 3. the email Date the OM arrived on (the go-forward receipt signal captured
  //    at ingest). Suppressed for a detected mass-forward burst — the re-forward
  //    timestamp is not a market signal.
  if (!opts.massForward) {
    const emailDate = toDatePart(metadata?.email_date ?? metadata?.source_email_date);
    if (emailDate && emailDate <= capturePart) {
      return { on_market_date: emailDate, source: 'email_received', confidence: 'medium' };
    }
  }

  // 4. no evidence — HOLD (never the processing clock)
  return { ...HELD };
}
