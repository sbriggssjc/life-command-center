// ============================================================================
// Listing URL filter
//
// Defensive helper used by writers of `available_listings.listing_url`
// (and the gov-equivalent fields). Rejects URLs we know the
// availability-checker can't usefully classify.
//
// Why this exists: the availability-checker probes listing URLs and
// writes off_market / withdrawn verdicts based on what the parsers see.
// If the URL points at a paywalled aggregator app (CoStar Suite,
// LoopNet for-broker, etc.), every fetch returns a login redirect and
// the parser produces a useless verdict — at best 'manual_review_needed',
// at worst 'still_available' because the login HTML lacks any off-market
// markers. Storing those URLs at write time costs us:
//
//   - per-listing cron cycles wasted on un-parseable pages
//   - misleading url_status writes against field_provenance
//   - operator confusion when the LCC UI's "View Listing" button leads
//     to a broker login wall instead of a public deal page
//
// The fix is to reject these at the writer, not after the fact. We
// don't try to canonicalize — the public `costar.com/property/...`
// IDs are NOT the same as CoStar Suite's `product.costar.com` asset
// IDs, so a naive transformation would point at the wrong property.
// Instead we drop the URL and let the caller fall back to whatever it
// would do for a missing URL (typically: leave the field null and
// surface a "no listing URL" data-quality flag in the UI).
//
// Surfaced by issue #560.
// ============================================================================

// Hosts whose pages are gated behind a login wall and cannot be
// usefully classified by the availability-checker. Add new entries
// here, lowercased, registrable-domain or full subdomain. Match is
// hostname-anchored (host === entry || host.endsWith('.' + entry)),
// so adding 'product.costar.com' will not accidentally drop
// 'costar.com' or 'mycostar.com'.
export const PAYWALLED_LISTING_HOSTS = [
  'product.costar.com',
];

/**
 * Returns true if `url` points at a host on the paywalled-listing
 * list. Returns false for null/undefined/non-URLs (callers should
 * treat "no URL" as a separate concern from "rejected URL").
 */
export function isPaywalledListingUrl(url) {
  if (!url || typeof url !== 'string') return false;
  let host;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  return PAYWALLED_LISTING_HOSTS.some(
    (entry) => host === entry || host.endsWith('.' + entry),
  );
}

/**
 * Returns the URL unchanged if it's safe to persist, or null if it's
 * paywalled. Logs a one-liner so the rejection is observable in
 * Vercel function logs without needing to re-instrument every caller.
 *
 * Pass a `context` string describing the caller (e.g.
 * `'intake-promoter:dia.available_listings'`) so the log message is
 * actionable.
 */
export function sanitizeListingUrl(url, context = 'unknown') {
  if (!isPaywalledListingUrl(url)) return url;
  console.warn(
    `[listing-url-filter] dropped paywalled URL from ${context}: ${url}`,
  );
  return null;
}
