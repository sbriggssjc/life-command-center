// ============================================================================
// Geocode Backfill Handler — bulk fills properties.latitude/longitude
// Life Command Center — Round 76gn (2026-05-08)
//
// Pulls a batch of `properties` rows where latitude IS NULL, geocodes each
// against the US Census Bureau onelineaddress API, and PATCHes the result
// back. Designed to be invoked on a short cron cadence so the background
// trickle keeps the property universe fully geocoded — the lease-comps
// export and any future distance-based ranking depend on lat/lng coverage.
//
// Why Census Bureau:
//   - Free, no API key, no rate limit (their TIGER service is built for
//     bulk municipal/research workloads).
//   - US-only — fine for our dialysis + federal-lease portfolio.
//   - ~95% match rate on residential / commercial street addresses.
//
// Why no Nominatim fallback in the cron path:
//   - Nominatim's TOS caps interactive use at ~1 req/sec, which would
//     stretch a 100-row batch to >100s and risk Vercel function timeout.
//   - The one-shot script (scripts/geocode-properties-backfill.mjs) does
//     have a Nominatim fallback for the long tail. Run it once manually
//     to clear the legacy backlog; the cron then maintains coverage.
//
// Auth: same LCC_API_KEY pattern as other admin sub-routes
// (handleAutoScrapeListings, handleAvailabilityPromotionSweep).
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { getDomainCredentials, domainQuery } from '../_shared/domain-db.js';

const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const DOMAIN_KEY_MAP = { dia: 'dialysis', gov: 'government' };

/**
 * Geocode one property's address via Census Bureau. Returns
 * { lat: number, lng: number } on success, null on miss/error.
 *
 * The onelineaddress endpoint is forgiving: handles abbreviated suffixes,
 * missing zip, mixed casing. We require at least street + (city or zip)
 * to avoid sending obviously-incomplete inputs.
 */
async function geocodeAddress(row) {
  const parts = [row.address, row.city, row.state, row.zip_code].filter(Boolean);
  if (parts.length < 2 || !row.address) return null;
  const url = CENSUS_GEOCODER
    + '?benchmark=Public_AR_Current&format=json&address='
    + encodeURIComponent(parts.join(', '));
  try {
    // Census responds in <500ms typically; 8s ceiling guards against
    // intermittent slowness pulling the whole batch into a Vercel timeout.
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const resp = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!resp.ok) return null;
    const data = await resp.json();
    const m = data?.result?.addressMatches?.[0];
    const lat = Number(m?.coordinates?.y);
    const lng = Number(m?.coordinates?.x);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Main handler — exposed via api/admin.js as ?_route=geocode-tick.
 *
 * Query params:
 *   domain    'dia' | 'gov' | 'both' (default 'both')
 *   limit     max rows per domain this tick (default 60, hard cap 200)
 *
 * Response:
 *   { mode, by_domain: { dia: {scanned, patched, ...}, gov: {...} }, totals: {...} }
 */
export async function handleGeocodeTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const domainParam = String(req.query.domain || 'both').toLowerCase();
  if (!['dia', 'gov', 'both'].includes(domainParam)) {
    return res.status(400).json({ error: 'domain must be dia, gov, or both' });
  }
  // Per-Vercel-function we have ~25s of effective budget once auth + json
  // overhead is paid; Census calls run ~300-500ms each, so 60 rows fits
  // comfortably with headroom for the PATCH writes. Cap at 200 if a caller
  // gets ambitious — past that we risk function timeout.
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '60', 10)));
  const dryRun = String(req.query.dry_run || '').toLowerCase() === 'true';

  const targets = domainParam === 'both' ? ['dia', 'gov'] : [domainParam];
  const out = {
    mode: dryRun ? 'dry_run' : 'apply',
    by_domain: {},
    totals: { scanned: 0, patched: 0, missed: 0, skipped: 0, errored: 0 }
  };

  for (const short of targets) {
    const domain = DOMAIN_KEY_MAP[short];
    const stats = { scanned: 0, patched: 0, missed: 0, skipped: 0, errored: 0 };

    if (!getDomainCredentials(domain)) {
      stats.errored = 1;
      stats.error = `${domain} credentials not configured`;
      out.by_domain[short] = stats;
      out.totals.errored += 1;
      continue;
    }

    // Pull this tick's batch — keyset-style ordering on property_id keeps
    // results stable across paginated calls if a future caller offsets.
    const batchPath = `properties`
      + `?select=property_id,address,city,state,zip_code`
      + `&latitude=is.null`
      + `&order=property_id.asc`
      + `&limit=${limit}`;
    const batchRes = await domainQuery(domain, 'GET', batchPath);
    if (!batchRes.ok) {
      stats.errored = 1;
      stats.error = `batch fetch failed: ${batchRes.status}`;
      out.by_domain[short] = stats;
      out.totals.errored += 1;
      continue;
    }
    const rows = Array.isArray(batchRes.data) ? batchRes.data : [];

    for (const row of rows) {
      stats.scanned += 1;
      // Skip rows that don't have enough address material to geocode —
      // they'd waste a Census call and inflate the miss rate.
      if (!row.address || (!row.city && !row.zip_code)) {
        stats.skipped += 1;
        continue;
      }
      const result = await geocodeAddress(row);
      if (!result) {
        stats.missed += 1;
        continue;
      }
      if (dryRun) {
        stats.patched += 1;
        continue;
      }
      // Single-row PATCH keyed on property_id. Failures here are individual
      // (network blip, rare RLS denial) — log and continue so one bad row
      // doesn't sink the whole tick.
      const patchRes = await domainQuery(
        domain,
        'PATCH',
        `properties?property_id=eq.${encodeURIComponent(row.property_id)}`,
        { latitude: result.lat, longitude: result.lng },
        { Prefer: 'return=minimal' }
      );
      if (patchRes.ok) {
        stats.patched += 1;
      } else {
        stats.errored += 1;
        if (!stats.error) stats.error = `first patch fail: ${patchRes.status}`;
      }
    }

    out.by_domain[short] = stats;
    out.totals.scanned += stats.scanned;
    out.totals.patched += stats.patched;
    out.totals.missed += stats.missed;
    out.totals.skipped += stats.skipped;
    out.totals.errored += stats.errored;
  }

  return res.status(200).json(out);
}
