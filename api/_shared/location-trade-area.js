// Server-side Location & Trade Area helpers for grounded dossiers.
// Google keys never leave this module: map thumbnails are fetched server-side
// and embedded/cached as data URIs; Places names are stored before rendering.

import { createHash } from 'node:crypto';
import { domainQuery } from './domain-db.js';

const NATIONAL_TENANT_TERMS = [
  'Walmart', 'Walgreens', 'CVS', 'Kroger', 'Target', 'Costco', 'Sam\'s Club',
  'Home Depot', 'Lowe\'s', 'ALDI', 'Aldi', 'Dollar General', 'Family Dollar',
  'Dollar Tree', 'AutoZone', 'O\'Reilly Auto Parts', 'Advance Auto Parts',
  'McDonald\'s', 'Burger King', 'Taco Bell', 'Wendy\'s', 'Chick-fil-A',
  'Starbucks', 'Dunkin', 'Subway', 'KFC', 'Popeyes', 'Pizza Hut',
  'Domino\'s', 'FedEx', 'UPS', 'T-Mobile', 'Verizon', 'AT&T', 'Xfinity',
  'Bank of America', 'Wells Fargo', 'Chase', 'Regions Bank', 'Truist',
  'PNC Bank', 'U.S. Bank', 'TD Bank',
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stableHash(input) {
  return createHash('sha256').update(String(input)).digest('hex');
}

function circlePath(lat, lng, radiusMiles, points = 72) {
  const earthMiles = 3958.7613;
  const latRad = lat * Math.PI / 180;
  const lngRad = lng * Math.PI / 180;
  const angular = radiusMiles / earthMiles;
  const out = [];
  for (let i = 0; i <= points; i += 1) {
    const bearing = (2 * Math.PI * i) / points;
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(angular) +
      Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing)
    );
    const pLng = lngRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
      Math.cos(angular) - Math.sin(latRad) * Math.sin(pLat)
    );
    out.push(`${(pLat * 180 / Math.PI).toFixed(6)},${(pLng * 180 / Math.PI).toFixed(6)}`);
  }
  return out.join('|');
}

export function buildGoogleStaticMapUrl({ lat, lng, label, apiKey }) {
  const la = num(lat), lo = num(lng);
  if (la == null || lo == null || !apiKey) return null;
  const params = new URLSearchParams({
    center: `${la},${lo}`,
    zoom: '12',
    size: '780x300',
    scale: '2',
    maptype: 'roadmap',
    key: apiKey,
  });
  params.append('markers', `color:red|label:${encodeURIComponent(label || 'S')}|${la},${lo}`);
  params.append('path', `color:0x4f46e5ff|weight:2|fillcolor:0x4f46e522|${circlePath(la, lo, 1)}`);
  params.append('path', `color:0x4f46e5cc|weight:2|fillcolor:0x4f46e511|${circlePath(la, lo, 3)}`);
  params.append('path', `color:0x4f46e599|weight:2|fillcolor:0x4f46e508|${circlePath(la, lo, 5)}`);
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

export async function loadOrCreateStaticMap({ domain, propertyId, lat, lng, address, fetchImpl }) {
  const la = num(lat), lo = num(lng);
  const key = process.env.GOOGLE_STATIC_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || null;
  if (!domain || propertyId == null || la == null || lo == null || !key) return null;
  const descriptor = JSON.stringify({ provider: 'google_static_maps', lat: la, lng: lo, rings: [1, 3, 5], size: '780x300@2' });
  const cacheKey = stableHash(descriptor);

  const cached = await domainQuery(domain, 'GET',
    `property_static_map_cache?property_id=eq.${encodeURIComponent(propertyId)}` +
    `&cache_key=eq.${encodeURIComponent(cacheKey)}` +
    `&select=image_data_uri,provider,cache_key,created_at&limit=1`).catch(() => null);
  if (cached?.ok && cached.data?.[0]?.image_data_uri) {
    return {
      image_data_uri: cached.data[0].image_data_uri,
      provider: cached.data[0].provider || 'google_static_maps',
      cache_key: cacheKey,
      cached: true,
    };
  }

  const url = buildGoogleStaticMapUrl({ lat: la, lng: lo, label: 'S', apiKey: key });
  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));
  try {
    const res = await doFetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const contentType = res.headers?.get?.('content-type') || 'image/png';
    if (!/^image\//i.test(contentType)) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const imageDataUri = `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`;
    await domainQuery(domain, 'POST', 'property_static_map_cache', {
      property_id: Number(propertyId),
      provider: 'google_static_maps',
      cache_key: cacheKey,
      center_latitude: la,
      center_longitude: lo,
      radius_miles: [1, 3, 5],
      image_data_uri: imageDataUri,
      source_url_hash: stableHash(url.replace(key, 'GOOGLE_KEY')),
      map_notes: address ? `Centered on ${address}; rings 1/3/5 miles.` : 'Centered on property geocode; rings 1/3/5 miles.',
    }, { Prefer: 'resolution=merge-duplicates,return=representation' }).catch(() => null);
    return { image_data_uri: imageDataUri, provider: 'google_static_maps', cache_key: cacheKey, cached: false };
  } catch {
    return null;
  }
}

function isNationalTenantName(name) {
  const n = String(name || '').toLowerCase();
  return NATIONAL_TENANT_TERMS.some(t => n.includes(t.toLowerCase()));
}

function simplifyPlace(p) {
  return {
    place_id: p.place_id || null,
    tenant_name: p.name || null,
    vicinity: p.vicinity || p.formatted_address || null,
    latitude: num(p.geometry?.location?.lat),
    longitude: num(p.geometry?.location?.lng),
    business_status: p.business_status || null,
    place_types: Array.isArray(p.types) ? p.types : [],
    rating: num(p.rating),
    user_ratings_total: num(p.user_ratings_total),
  };
}

export async function loadOrCreateNearbyNationalTenants({ domain, propertyId, lat, lng, fetchImpl }) {
  const la = num(lat), lo = num(lng);
  if (!domain || propertyId == null || la == null || lo == null) return [];
  const stored = await domainQuery(domain, 'GET',
    `property_nearby_national_tenants?property_id=eq.${encodeURIComponent(propertyId)}` +
    `&select=tenant_name,place_id,vicinity,distance_miles,latitude,longitude,place_types,rating,user_ratings_total,source,observed_at` +
    `&order=distance_miles.asc.nullslast&limit=8`).catch(() => null);
  if (stored?.ok && Array.isArray(stored.data) && stored.data.length) return stored.data;

  const key = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || null;
  if (!key) return [];
  const params = new URLSearchParams({
    location: `${la},${lo}`,
    radius: String(Math.round(5 * 1609.344)),
    keyword: NATIONAL_TENANT_TERMS.join('|'),
    key,
  });
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
  const doFetch = fetchImpl || ((u, opts) => fetch(u, opts));
  try {
    const res = await doFetch(url, { method: 'GET' });
    if (!res.ok) return [];
    const body = await res.json();
    const rows = (Array.isArray(body.results) ? body.results : [])
      .map(simplifyPlace)
      .filter(p => p.place_id && p.tenant_name && p.business_status !== 'CLOSED_PERMANENTLY')
      .filter(p => isNationalTenantName(p.tenant_name))
      .map(p => ({
        property_id: Number(propertyId),
        ...p,
        distance_miles: haversineMiles(la, lo, p.latitude, p.longitude),
        source: 'google_places_nearbysearch',
        raw_result: p,
      }))
      .filter(p => p.distance_miles != null && p.distance_miles <= 5)
      .slice(0, 8);
    if (!rows.length) return [];
    await domainQuery(domain, 'POST', 'property_nearby_national_tenants', rows,
      { Prefer: 'resolution=merge-duplicates,return=representation' }).catch(() => null);
    return rows;
  } catch {
    return [];
  }
}

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const a1 = num(lat1), o1 = num(lon1), a2 = num(lat2), o2 = num(lon2);
  if (a1 == null || o1 == null || a2 == null || o2 == null) return null;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(a2 - a1);
  const dLon = toRad(o2 - o1);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLon / 2) ** 2;
  return Math.round((3958.7613 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))) * 100) / 100;
}

export const __test__ = { circlePath, isNationalTenantName };
