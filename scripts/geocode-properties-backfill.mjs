#!/usr/bin/env node
/**
 * Bulk geocode backfill for `properties` rows with NULL latitude/longitude.
 *
 * The lease-comps export ranks comparables by haversine distance from the
 * subject. That requires both subject AND comp properties to have lat/lng.
 * Audit on 2026-05-08 found ~zero geocoded rows in dia.properties (probably
 * the same on gov), which made the export return "no comps near this
 * subject" for every click. This script walks every NULL row and patches
 * coordinates in place.
 *
 * Geocoder cascade (per row):
 *   1. US Census Bureau — https://geocoding.geo.census.gov, free, no API
 *      key, no rate limit. Resolves ~95% of US street addresses.
 *   2. Nominatim/OpenStreetMap — rate-limited to 1 req/sec by their TOS.
 *      Fallback for the long tail Census can't match (rural, PO boxes,
 *      typos, recent construction not yet in TIGER).
 *
 * Idempotent + resumable: always pulls properties WHERE latitude IS NULL,
 * so re-running picks up where the previous run left off. Failed rows
 * stay NULL and are tracked in a per-run Set so we don't loop on them.
 *
 * Required env (set the ones for the domains you're running):
 *   DIA_SUPABASE_URL, DIA_SUPABASE_SERVICE_KEY
 *   GOV_SUPABASE_URL, GOV_SUPABASE_SERVICE_KEY
 *
 * Usage:
 *   node scripts/geocode-properties-backfill.mjs --domain=dia
 *   node scripts/geocode-properties-backfill.mjs --domain=gov --limit=500
 *   node scripts/geocode-properties-backfill.mjs --domain=both --dry-run
 *
 * Flags:
 *   --domain=dia|gov|both   Which database(s) to backfill. Default: both
 *   --limit=N               Max rows per domain. Default: 10000
 *   --batch=N               Rows fetched per page. Default: 200
 *   --dry-run               Geocode + log, don't PATCH. Useful for first run.
 *   --skip-nominatim        Census-only. Faster but lower coverage.
 *   --census-rate-ms=N      Sleep between Census calls. Default: 50
 *   --nominatim-rate-ms=N   Sleep between Nominatim calls. Default: 1100
 *
 * Expected runtime (Census-only on a US-only portfolio):
 *   ~5000 rows × ~0.3s per call ≈ 25 minutes
 */

import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const domains = (args.domain === 'both' || !args.domain) ? ['dia', 'gov'] : [args.domain];
const maxRows = parseInt(args.limit || '10000', 10);
const batchSize = Math.min(parseInt(args.batch || '200', 10), 1000);
const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
const skipNominatim = args['skip-nominatim'] === true || args['skip-nominatim'] === 'true';
const censusRateMs = parseInt(args['census-rate-ms'] || '50', 10);
const nominatimRateMs = parseInt(args['nominatim-rate-ms'] || '1100', 10);

const DOMAIN_CONFIG = {
  dia: { url: process.env.DIA_SUPABASE_URL, key: process.env.DIA_SUPABASE_SERVICE_KEY },
  gov: { url: process.env.GOV_SUPABASE_URL, key: process.env.GOV_SUPABASE_SERVICE_KEY }
};

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else out[a.slice(2)] = true;
  }
  return out;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Geocoders ──────────────────────────────────────────────────────────────

async function geocodeViaCensus(row) {
  // One-line address form is the most forgiving — handles abbreviated
  // suffixes, missing zip, etc. Census matches against TIGER which is
  // updated continuously from local jurisdictions.
  const parts = [row.address, row.city, row.state, row.zip_code].filter(Boolean);
  if (parts.length < 2) return null;
  const oneLine = parts.join(', ');
  const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
    + '?benchmark=Public_AR_Current'
    + '&format=json'
    + '&address=' + encodeURIComponent(oneLine);
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const matches = data?.result?.addressMatches;
    if (!Array.isArray(matches) || matches.length === 0) return null;
    const m = matches[0];
    const lat = Number(m?.coordinates?.y);
    const lng = Number(m?.coordinates?.x);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng, source: 'census' };
  } catch (err) {
    return null;
  }
}

async function geocodeViaNominatim(row) {
  const parts = [row.address, row.city, row.state, row.zip_code].filter(Boolean);
  if (parts.length < 2) return null;
  const q = parts.join(', ');
  const url = 'https://nominatim.openstreetmap.org/search'
    + '?format=json&limit=1&countrycodes=us'
    + '&q=' + encodeURIComponent(q);
  try {
    // Nominatim asks for an identifying User-Agent. Node's fetch sends a
    // default; we override with something traceable in case of complaints.
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'lcc-geocode-backfill/1.0 (sabriggs@northmarq.com)',
        'Accept': 'application/json'
      }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng, source: 'nominatim' };
  } catch (err) {
    return null;
  }
}

// ── Supabase REST helpers (PostgREST direct, no proxy) ─────────────────────

async function fetchNullCoordsBatch(cfg, limit) {
  const url = new URL(cfg.url + '/rest/v1/properties');
  url.searchParams.set('select', 'property_id,address,city,state,zip_code');
  url.searchParams.set('latitude', 'is.null');
  url.searchParams.set('order', 'property_id.asc');
  url.searchParams.set('limit', String(limit));
  const resp = await fetch(url.toString(), {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }
  });
  if (!resp.ok) throw new Error(`Fetch null-coord batch failed: HTTP ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function patchCoords(cfg, propertyId, lat, lng) {
  const url = new URL(cfg.url + '/rest/v1/properties');
  url.searchParams.set('property_id', `eq.${propertyId}`);
  const resp = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ latitude: lat, longitude: lng })
  });
  if (!resp.ok) throw new Error(`PATCH failed for ${propertyId}: HTTP ${resp.status} ${await resp.text()}`);
}

// ── Per-domain runner ──────────────────────────────────────────────────────

async function runDomain(domain) {
  const cfg = DOMAIN_CONFIG[domain];
  if (!cfg.url || !cfg.key) {
    console.error(`[${domain}] missing ${domain.toUpperCase()}_SUPABASE_URL / _SERVICE_KEY env — skipping`);
    return;
  }
  console.log(`[${domain}] starting backfill (limit=${maxRows}, batch=${batchSize}, dryRun=${dryRun}, skipNominatim=${skipNominatim})`);

  const failedThisRun = new Set();
  const stats = { fetched: 0, census: 0, nominatim: 0, failed: 0, skipped: 0, patched: 0 };
  const t0 = Date.now();

  while (stats.fetched < maxRows) {
    const remaining = maxRows - stats.fetched;
    const want = Math.min(batchSize, remaining);
    let batch;
    try {
      batch = await fetchNullCoordsBatch(cfg, want);
    } catch (e) {
      console.error(`[${domain}] batch fetch failed:`, e.message);
      break;
    }
    if (!batch.length) {
      console.log(`[${domain}] no more rows with NULL lat/lng — done`);
      break;
    }

    // Filter out rows we already failed on this run (otherwise the same NULL
    // rows come back next iteration since they don't leave the result set
    // when geocoding fails).
    const todo = batch.filter(r => !failedThisRun.has(r.property_id));
    if (todo.length === 0) {
      console.log(`[${domain}] all remaining NULL rows already failed this run — stopping`);
      break;
    }

    for (const row of todo) {
      stats.fetched++;
      if (!row.address || (!row.city && !row.zip_code)) {
        stats.skipped++;
        failedThisRun.add(row.property_id);
        continue;
      }

      // 1) Census — fast, free, no rate limit, US-only.
      let result = await geocodeViaCensus(row);
      if (result) stats.census++;
      if (censusRateMs > 0) await sleep(censusRateMs);

      // 2) Nominatim — slower, worldwide, fallback only.
      if (!result && !skipNominatim) {
        result = await geocodeViaNominatim(row);
        if (result) stats.nominatim++;
        await sleep(nominatimRateMs);
      }

      if (!result) {
        stats.failed++;
        failedThisRun.add(row.property_id);
        continue;
      }

      if (dryRun) {
        stats.patched++;
      } else {
        try {
          await patchCoords(cfg, row.property_id, result.lat, result.lng);
          stats.patched++;
        } catch (e) {
          console.error(`[${domain}] patch failed for ${row.property_id}:`, e.message);
          stats.failed++;
          failedThisRun.add(row.property_id);
        }
      }

      if (stats.fetched % 50 === 0) {
        const rate = (stats.patched / ((Date.now() - t0) / 1000)).toFixed(1);
        console.log(`[${domain}] processed=${stats.fetched} patched=${stats.patched} census=${stats.census} nominatim=${stats.nominatim} failed=${stats.failed} skipped=${stats.skipped} (${rate} rows/s)`);
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[${domain}] DONE: processed=${stats.fetched} patched=${stats.patched} census=${stats.census} nominatim=${stats.nominatim} failed=${stats.failed} skipped=${stats.skipped} in ${elapsed}s`);
}

// ── Main ──────────────────────────────────────────────────────────────────

for (const d of domains) {
  await runDomain(d);
}
