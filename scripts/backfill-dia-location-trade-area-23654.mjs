#!/usr/bin/env node
/**
 * Backfill/audit dossier Location & Trade Area data for dia property 23654.
 *
 * Required for Supabase writes:
 *   DIA_SUPABASE_URL, DIA_SUPABASE_KEY (or DIA_SUPABASE_SERVICE_KEY)
 *
 * Required for radius demographics:
 *   CENSUS_API_KEY
 *
 * Optional:
 *   GOOGLE_MAPS_API_KEY (creates map cache + Places tenant rows when the
 *   additive cache tables from 20260801203000 are applied)
 *
 * Radius method: official Census TIGERweb block-group internal points are
 * joined to ACS5 block-group facts. Rows whose internal point falls within the
 * 1/3/5-mile circle are summed. This is a centroid/internal-point approximation,
 * so the `notes` field records the method rather than implying parcel-perfect
 * areal interpolation.
 */

import { loadEnvForScripts } from './_env-file.mjs';
import fs from 'node:fs';

Object.assign(process.env, loadEnvForScripts());

const {
  loadOrCreateNearbyNationalTenants,
  loadOrCreateStaticMap,
  haversineMiles,
} = await import('../api/_shared/location-trade-area.js');

const PROPERTY_ID = Number(process.argv.find(a => a.startsWith('--property='))?.split('=')[1] || 23654);
const ACS_YEAR = Number(process.argv.find(a => a.startsWith('--acs-year='))?.split('=')[1] || 2022);
const PREV_ACS_YEAR = Number(process.argv.find(a => a.startsWith('--prev-acs-year='))?.split('=')[1] || 2018);
const COMMIT = process.argv.includes('--commit');
const GAPS_FILE = process.argv.find(a => a.startsWith('--gaps-file='))?.split('=').slice(1).join('=') || null;

const DIA_URL = process.env.DIA_SUPABASE_URL;
const DIA_KEY = process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY;
const CENSUS_KEY = process.env.CENSUS_API_KEY;

if (!DIA_URL || !DIA_KEY) {
  console.error('Missing DIA_SUPABASE_URL and DIA_SUPABASE_KEY / DIA_SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

const headers = {
  apikey: DIA_KEY,
  Authorization: `Bearer ${DIA_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(method, path, body, extra = {}) {
  const res = await fetch(`${DIA_URL}/rest/v1/${path}`, {
    method,
    headers: { ...headers, Prefer: 'return=representation', ...extra },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok || /^<html/i.test(text.trim())) {
    throw new Error(`Fetch failed ${res.status}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
  }
  return JSON.parse(text);
}

async function getProperty() {
  const r = await rest('GET',
    `properties?property_id=eq.${encodeURIComponent(PROPERTY_ID)}` +
    `&select=property_id,address,city,state,zip_code,latitude,longitude&limit=1`);
  if (!r.ok || !r.data?.[0]) throw new Error(`Property ${PROPERTY_ID} not found`);
  return r.data[0];
}

async function getFips(lat, lng) {
  const url = `https://geo.fcc.gov/api/census/block/find?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&format=json`;
  const body = await fetchJson(url);
  const fips = String(body?.County?.FIPS || '');
  if (fips.length !== 5) throw new Error(`Could not resolve county FIPS for ${lat},${lng}`);
  return { state: fips.slice(0, 2), county: fips.slice(2, 5) };
}

async function getBlockGroupPoints(state, county) {
  const params = new URLSearchParams({
    where: `STATE='${state}' AND COUNTY='${county}'`,
    outFields: 'GEOID,STATE,COUNTY,TRACT,BLKGRP,INTPTLAT,INTPTLON,CENTLAT,CENTLON',
    returnGeometry: 'false',
    f: 'json',
  });
  const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/8/query?${params.toString()}`;
  const body = await fetchJson(url);
  return (body.features || []).map(f => {
    const a = f.attributes || {};
    return {
      geoid: String(a.GEOID || `${a.STATE}${a.COUNTY}${a.TRACT}${a.BLKGRP}`),
      lat: Number(a.INTPTLAT || a.CENTLAT),
      lng: Number(a.INTPTLON || a.CENTLON),
    };
  }).filter(r => r.geoid && Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

async function getAcsBlockGroups(year, state, county) {
  if (!CENSUS_KEY) throw new Error('CENSUS_API_KEY is required for ACS block-group demographics.');
  const get = 'NAME,B01003_001E,B11001_001E,B19025_001E';
  const url = `https://api.census.gov/data/${year}/acs/acs5?get=${get}` +
    `&for=block%20group:*&in=state:${state}%20county:${county}%20tract:*&key=${encodeURIComponent(CENSUS_KEY)}`;
  const body = await fetchJson(url);
  const [cols, ...rows] = body;
  const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
  const out = new Map();
  for (const row of rows) {
    const geoid = `${row[idx.state]}${row[idx.county]}${row[idx.tract]}${row[idx['block group']]}`;
    out.set(geoid, {
      population: Number(row[idx.B01003_001E]),
      households: Number(row[idx.B11001_001E]),
      aggregateIncome: Number(row[idx.B19025_001E]),
    });
  }
  return out;
}

function aggregateRadius({ property, points, current, previous, radius }) {
  let population = 0;
  let households = 0;
  let aggregateIncome = 0;
  let previousPopulation = 0;
  let included = 0;
  for (const p of points) {
    const d = haversineMiles(property.latitude, property.longitude, p.lat, p.lng);
    if (d == null || d > radius) continue;
    const cur = current.get(p.geoid);
    if (!cur) continue;
    included += 1;
    population += Number.isFinite(cur.population) ? cur.population : 0;
    households += Number.isFinite(cur.households) ? cur.households : 0;
    aggregateIncome += Number.isFinite(cur.aggregateIncome) ? cur.aggregateIncome : 0;
    const prev = previous.get(p.geoid);
    previousPopulation += prev && Number.isFinite(prev.population) ? prev.population : 0;
  }
  return {
    property_id: property.property_id,
    radius_miles: radius,
    population: Math.round(population),
    num_households: Math.round(households),
    avg_hhi: households > 0 ? Math.round(aggregateIncome / households) : null,
    population_growth_pct: previousPopulation > 0 ? Math.round(((population - previousPopulation) / previousPopulation) * 10000) / 10000 : null,
    data_source: 'census_acs5_block_group_internal_point_radius',
    data_year: ACS_YEAR,
    notes: `Derived: ACS${ACS_YEAR} block groups whose TIGERweb internal points fall within ${radius} miles of ${property.latitude},${property.longitude}; growth vs ACS${PREV_ACS_YEAR}; included block groups ${included}.`,
  };
}

async function upsertDemographics(rows) {
  const written = [];
  for (const row of rows) {
    const existing = await rest('GET',
      `property_demographics?property_id=eq.${row.property_id}&radius_miles=eq.${row.radius_miles}&select=demographic_id&limit=1`);
    if (existing.ok && existing.data?.[0]?.demographic_id) {
      const id = existing.data[0].demographic_id;
      if (COMMIT) {
        const patch = await rest('PATCH', `property_demographics?demographic_id=eq.${id}`, row);
        if (!patch.ok) throw new Error(`PATCH radius ${row.radius_miles} failed ${patch.status}: ${JSON.stringify(patch.data)}`);
      }
      written.push({ ...row, action: COMMIT ? 'patched' : 'would_patch' });
    } else {
      if (COMMIT) {
        const post = await rest('POST', 'property_demographics', row);
        if (!post.ok) throw new Error(`POST radius ${row.radius_miles} failed ${post.status}: ${JSON.stringify(post.data)}`);
      }
      written.push({ ...row, action: COMMIT ? 'inserted' : 'would_insert' });
    }
  }
  return written;
}

async function coverageGaps() {
  const props = await rest('GET',
    'properties?select=property_id,address,city,state,zip_code&order=property_id.asc&limit=5000');
  const demos = await rest('GET', 'property_demographics?select=property_id&limit=5000');
  if (!props.ok || !demos.ok) return { error: 'coverage_query_failed', propsStatus: props.status, demosStatus: demos.status };
  const covered = new Set((demos.data || []).map(r => Number(r.property_id)));
  return (props.data || []).filter(p => !covered.has(Number(p.property_id)));
}

const property = await getProperty();
console.log(`Property ${property.property_id}: ${property.address}, ${property.city}, ${property.state} ${property.zip_code} (${property.latitude}, ${property.longitude})`);

try {
  const [mapResult, tenants] = await Promise.all([
    loadOrCreateStaticMap({
      domain: 'dia',
      propertyId: property.property_id,
      lat: property.latitude,
      lng: property.longitude,
      address: [property.address, property.city, property.state, property.zip_code].filter(Boolean).join(', '),
    }),
    loadOrCreateNearbyNationalTenants({
      domain: 'dia',
      propertyId: property.property_id,
      lat: property.latitude,
      lng: property.longitude,
    }),
  ]);
  console.log(`Map cache: ${mapResult ? (mapResult.cached ? 'cached' : 'created') : 'Not on file'}`);
  console.log(`Nearby national tenants stored/found: ${tenants.length}`);
} catch (err) {
  console.log(`Map/Places pass skipped: ${err.message}`);
}

try {
  const fips = await getFips(property.latitude, property.longitude);
  const [points, current, previous] = await Promise.all([
    getBlockGroupPoints(fips.state, fips.county),
    getAcsBlockGroups(ACS_YEAR, fips.state, fips.county),
    getAcsBlockGroups(PREV_ACS_YEAR, fips.state, fips.county),
  ]);
  const rows = [1, 3, 5].map(radius => aggregateRadius({ property, points, current, previous, radius }));
  const written = await upsertDemographics(rows);
  console.log(COMMIT ? 'Demographics backfill written:' : 'Demographics backfill dry-run:');
  for (const r of written) {
    console.log(`  ${r.action} ${r.radius_miles} mi: pop ${r.population}, households ${r.num_households}, avg_hhi ${r.avg_hhi}, growth ${r.population_growth_pct}`);
  }
} catch (err) {
  console.log(`Demographics backfill not written: ${err.message}`);
}

const gaps = await coverageGaps();
if (Array.isArray(gaps)) {
  console.log(`Dialysis properties still lacking demographic rows: ${gaps.length}`);
  if (GAPS_FILE) {
    const lines = [
      '# Dialysis Properties Missing Radius Demographics',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Rows: ${gaps.length}`,
      '',
      '| property_id | address | city | state | zip_code |',
      '|---:|---|---|---|---|',
      ...gaps.map(g => `| ${g.property_id ?? ''} | ${String(g.address || '').replace(/\|/g, '\\|')} | ${String(g.city || '').replace(/\|/g, '\\|')} | ${String(g.state || '').replace(/\|/g, '\\|')} | ${String(g.zip_code || '').replace(/\|/g, '\\|')} |`),
      '',
    ];
    fs.writeFileSync(GAPS_FILE, lines.join('\n'));
    console.log(`Full coverage gap list written to ${GAPS_FILE}`);
  }
  for (const g of gaps.slice(0, 200)) {
    console.log(`  ${g.property_id} | ${[g.address, g.city, g.state, g.zip_code].filter(Boolean).join(', ')}`);
  }
  if (gaps.length > 200) console.log(`  ... ${gaps.length - 200} more not printed`);
} else {
  console.log(`Coverage audit failed: ${JSON.stringify(gaps)}`);
}
