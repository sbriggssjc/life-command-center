// ============================================================================
// Geocode Backfill Handler — bulk fills properties.latitude/longitude
// Life Command Center — Round 76gn (2026-05-08)
//
// Pulls a batch of `properties` rows where latitude IS NULL, geocodes each
// against the US Census Bureau onelineaddress API, falls back to the Google
// Maps Geocoding API on Census misses, and PATCHes the result back.
// Designed to be invoked on a short cron cadence so the background trickle
// keeps the property universe fully geocoded — the lease-comps export and
// any future distance-based ranking (nearby owners, competitor analysis,
// nearby sales) depend on lat/lng coverage.
//
// Geocoder cascade (Round 76gn.b, 2026-05-08):
//   1. US Census Bureau onelineaddress — free, no key, no rate limit, US-only
//      and great at street addresses TIGER indexes (~70-80% hit rate on our
//      data, 90%+ on gov/FRPP). ~300-500ms per call.
//   2. Google Maps Geocoding API — paid (~$5/1000 calls), broad coverage,
//      handles suite numbers / abbreviations / minor city-name typos that
//      Census struggles with. ~+30 percentage points hit rate over Census
//      alone in spot-check. Engaged ONLY on Census miss to keep cost low.
//      Skipped silently when GOOGLE_MAPS_API_KEY is not configured (cron
//      stays on Census-only behavior, no errors).
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
const GEOCODIO_GEOCODER = 'https://api.geocod.io/v1.7/geocode';
const GOOGLE_GEOCODER = 'https://maps.googleapis.com/maps/api/geocode/json';
const DOMAIN_KEY_MAP = { dia: 'dialysis', gov: 'government' };

// Logged once per cold start so a missing key surfaces in Railway logs without
// flooding every tick. The handler still functions correctly — it just falls
// back to Census-only behavior identical to the Round 76gn launch.
let warnedAboutMissingGoogleKey = false;
let warnedAboutMissingGeocodioKey = false;

/**
 * Geocode one property's address via Census Bureau. Returns
 * { lat: number, lng: number } on success, null on miss/error.
 *
 * The onelineaddress endpoint is forgiving: handles abbreviated suffixes,
 * missing zip, mixed casing. We require at least street + (city or zip)
 * to avoid sending obviously-incomplete inputs.
 */
async function geocodeAddressCensus(row) {
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
 * Geocode via Google Maps Geocoding API. Returns
 * { lat, lng, location_type } on success, null on miss/error/no-key.
 *
 * `location_type` from Google ('ROOFTOP' | 'RANGE_INTERPOLATED' |
 * 'GEOMETRIC_CENTER' | 'APPROXIMATE') is included so a future caller can
 * decide whether the precision is good enough — for haversine ranking out
 * to a few miles, even APPROXIMATE (zip-centroid-grade) is fine.
 *
 * We deliberately DO NOT validate that the returned formatted_address still
 * resembles the input — for the address-corruption rows we identified
 * (wrong city paired with real street), Google is more likely to find the
 * STREET in the WRONG city and still return a coordinate. That's OK for
 * the lease-comps use case: the comp will land near the wrong city, which
 * makes it a non-comp and gets ranked away naturally. Better than NULL.
 */
/**
 * Geocodio — paid US/Canada geocoder. ~$0.50 per 1,000 calls (10x cheaper
 * than Google), 2,500/day free tier, high accuracy on US street addresses
 * including unit/suite-numbered entries that dominate the dia long tail.
 * Sits between Census and Google in the cascade — Census is free so it goes
 * first, and Google's worldwide coverage stays as a last resort.
 *
 * Returns { lat, lng, accuracy, accuracy_type } or null on miss/error.
 * accuracy is 0..1 from Geocodio. accuracy_type is e.g. 'rooftop',
 * 'range_interpolation', 'nearest_rooftop_match', 'point', 'place', 'state'.
 * Anything coarser than 'place' / 'point' is essentially a centroid — we
 * still accept it because a centroid is better than NULL for haversine
 * comp ranking (puts the row at the city's center; if it's not actually
 * near the subject, it ranks itself away naturally).
 */
async function geocodeAddressGeocodio(row, apiKey) {
  if (!apiKey) return null;
  const parts = [row.address, row.city, row.state, row.zip_code].filter(Boolean);
  if (parts.length < 2 || !row.address) return null;
  const url = GEOCODIO_GEOCODER
    + '?q=' + encodeURIComponent(parts.join(', '))
    + '&limit=1'
    + '&api_key=' + encodeURIComponent(apiKey);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const resp = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!resp.ok) return null;
    const data = await resp.json();
    const r = data?.results?.[0];
    const lat = Number(r?.location?.lat);
    const lng = Number(r?.location?.lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return {
      lat,
      lng,
      accuracy: r?.accuracy ?? null,
      accuracy_type: r?.accuracy_type || null,
    };
  } catch {
    return null;
  }
}

async function geocodeAddressGoogle(row, apiKey) {
  if (!apiKey) return null;
  const parts = [row.address, row.city, row.state, row.zip_code].filter(Boolean);
  if (parts.length < 2 || !row.address) return null;
  const url = GOOGLE_GEOCODER
    + '?address=' + encodeURIComponent(parts.join(', '))
    + '&key=' + encodeURIComponent(apiKey);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const resp = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!resp.ok) return null;
    const data = await resp.json();
    // Google returns status='ZERO_RESULTS' for genuine misses, 'OK' for
    // hits, plus quota/auth statuses. Only OK is success.
    if (data?.status !== 'OK') return null;
    const r = data?.results?.[0];
    const lat = Number(r?.geometry?.location?.lat);
    const lng = Number(r?.geometry?.location?.lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return {
      lat,
      lng,
      location_type: r?.geometry?.location_type || null,
    };
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
 *   {
 *     mode,
 *     by_domain: {
 *       dia: { scanned, patched, patched_census, patched_google,
 *              missed, skipped, errored },
 *       gov: {...}
 *     },
 *     totals: {...}
 *   }
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
  // overhead is paid; Census calls run ~300-500ms each + Google fallback
  // adds ~200-300ms per Census miss. 60 rows fits comfortably with
  // headroom for the PATCH writes. Cap at 200 — past that we risk timeout.
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '60', 10)));
  const dryRun = String(req.query.dry_run || '').toLowerCase() === 'true';

  const geocodioKey = process.env.GEOCODIO_API_KEY || '';
  if (!geocodioKey && !warnedAboutMissingGeocodioKey) {
    console.warn('[geocode-tick] GEOCODIO_API_KEY not set — Geocodio tier disabled.');
    warnedAboutMissingGeocodioKey = true;
  }
  const googleKey = process.env.GOOGLE_MAPS_API_KEY || '';
  if (!googleKey && !warnedAboutMissingGoogleKey) {
    console.warn('[geocode-tick] GOOGLE_MAPS_API_KEY not set — Google final-resort fallback disabled.');
    warnedAboutMissingGoogleKey = true;
  }

  const targets = domainParam === 'both' ? ['dia', 'gov'] : [domainParam];
  const out = {
    mode: dryRun ? 'dry_run' : 'apply',
    cascade: [
      'census',
      geocodioKey ? 'geocodio' : null,
      googleKey ? 'google' : null,
    ].filter(Boolean).join(' -> '),
    geocodio_fallback: geocodioKey ? 'enabled' : 'disabled',
    google_fallback: googleKey ? 'enabled' : 'disabled',
    by_domain: {},
    totals: {
      scanned: 0, patched: 0, patched_census: 0, patched_geocodio: 0, patched_google: 0,
      missed: 0, skipped: 0, errored: 0,
    },
  };

  for (const short of targets) {
    const domain = DOMAIN_KEY_MAP[short];
    // R17 Unit 1: don't geocode gov rows archived as backfill junk (gov has a
    // status column; dia has none, so the filter is gov-only).
    const archivedFilter = short === 'gov' ? '&status=not.eq.archived' : '';
    const stats = {
      scanned: 0, patched: 0, patched_census: 0, patched_geocodio: 0, patched_google: 0,
      missed: 0, skipped: 0, errored: 0,
    };

    if (!getDomainCredentials(domain)) {
      stats.errored = 1;
      stats.error = `${domain} credentials not configured`;
      out.by_domain[short] = stats;
      out.totals.errored += 1;
      continue;
    }

    // Read the per-domain pagination cursor. Without this, every tick fetches
    // the same head-of-queue rows (Round 76gn.d). If the geocode_cursor table
    // doesn't exist yet (deploy preceding migration), fall back to cursor=0
    // so this handler stays compatible with both schema states.
    let cursor = 0;
    let cursorTableMissing = false;
    {
      const cursorRes = await domainQuery(
        domain,
        'GET',
        'geocode_cursor?id=eq.1&select=last_seen_property_id'
      );
      if (cursorRes.ok && Array.isArray(cursorRes.data) && cursorRes.data[0]) {
        cursor = Number(cursorRes.data[0].last_seen_property_id) || 0;
      } else if (cursorRes.status === 404 || cursorRes.status === 400) {
        cursorTableMissing = true;
      }
    }
    stats.cursor_in = cursor;

    // Pull this tick's batch using keyset pagination on property_id. Failed
    // rows stay latitude=NULL but the cursor advances past them, so the next
    // tick fetches genuinely new rows instead of re-reading the failure wall.
    const batchPath = `properties`
      + `?select=property_id,address,city,state,zip_code`
      + `&latitude=is.null`
      + archivedFilter
      + `&property_id=gt.${cursor}`
      + `&order=property_id.asc`
      + `&limit=${limit}`;
    let batchRes = await domainQuery(domain, 'GET', batchPath);
    if (!batchRes.ok) {
      stats.errored = 1;
      stats.error = `batch fetch failed: ${batchRes.status}`;
      out.by_domain[short] = stats;
      out.totals.errored += 1;
      continue;
    }
    let rows = Array.isArray(batchRes.data) ? batchRes.data : [];

    // Wrap-around: empty batch + non-zero cursor means we've reached the end
    // of the queue. Reset to 0 and re-fetch so this tick still does work
    // (picks up any newly-arrived ungeocoded rows, plus retries the chronic
    // misses one more time — Google's index improves over weeks).
    if (rows.length === 0 && cursor > 0 && !cursorTableMissing && !dryRun) {
      const resetRes = await domainQuery(
        domain,
        'PATCH',
        'geocode_cursor?id=eq.1',
        { last_seen_property_id: 0 },
        { Prefer: 'return=minimal' }
      );
      if (resetRes.ok) {
        cursor = 0;
        stats.cursor_wrapped = true;
        const refetch = await domainQuery(
          domain,
          'GET',
          `properties?select=property_id,address,city,state,zip_code`
            + `&latitude=is.null&property_id=gt.0`
            + archivedFilter
            + `&order=property_id.asc&limit=${limit}`
        );
        if (refetch.ok && Array.isArray(refetch.data)) rows = refetch.data;
      }
    }

    for (const row of rows) {
      stats.scanned += 1;
      // Skip rows that don't have enough address material to geocode —
      // they'd waste a Census call and inflate the miss rate.
      if (!row.address || (!row.city && !row.zip_code)) {
        stats.skipped += 1;
        continue;
      }

      // Geocoder cascade: Census (free) → Geocodio (cheap, US-focused,
      // $0.50/1k) → Google (worldwide, $5/1k, last resort). Each tier
      // engages only when the prior one misses. We track the source
      // separately so cron stats expose each tier's contribution.
      let result = await geocodeAddressCensus(row);
      let source = 'census';
      if (!result && geocodioKey) {
        result = await geocodeAddressGeocodio(row, geocodioKey);
        if (result) source = 'geocodio';
      }
      if (!result && googleKey) {
        result = await geocodeAddressGoogle(row, googleKey);
        if (result) source = 'google';
      }

      if (!result) {
        stats.missed += 1;
        continue;
      }
      if (dryRun) {
        stats.patched += 1;
        if (source === 'census') stats.patched_census += 1;
        else if (source === 'geocodio') stats.patched_geocodio += 1;
        else stats.patched_google += 1;
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
        if (source === 'census') stats.patched_census += 1;
        else if (source === 'geocodio') stats.patched_geocodio += 1;
        else stats.patched_google += 1;
      } else {
        stats.errored += 1;
        if (!stats.error) stats.error = `first patch fail: ${patchRes.status}`;
      }
    }

    // Advance the cursor to the highest property_id seen this tick (regardless
    // of geocode success/failure) so the next tick fetches new rows. If the
    // cursor table doesn't exist yet, skip silently.
    if (!cursorTableMissing && rows.length > 0 && !dryRun) {
      const newCursor = rows.reduce(
        (m, r) => (r.property_id > m ? r.property_id : m),
        cursor
      );
      if (newCursor > cursor) {
        const writeRes = await domainQuery(
          domain,
          'PATCH',
          'geocode_cursor?id=eq.1',
          { last_seen_property_id: newCursor },
          { Prefer: 'return=minimal' }
        );
        stats.cursor_out = writeRes.ok ? newCursor : cursor;
      } else {
        stats.cursor_out = cursor;
      }
    }

    out.by_domain[short] = stats;
    out.totals.scanned += stats.scanned;
    out.totals.patched += stats.patched;
    out.totals.patched_census += stats.patched_census;
    out.totals.patched_geocodio += stats.patched_geocodio;
    out.totals.patched_google += stats.patched_google;
    out.totals.missed += stats.missed;
    out.totals.skipped += stats.skipped;
    out.totals.errored += stats.errored;
  }

  return res.status(200).json(out);
}
