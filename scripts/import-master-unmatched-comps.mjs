#!/usr/bin/env node
/**
 * Import the R72 "master has / we don't" UNMATCHED Sales Comps (the ~419 rows
 * from Dialysis Comp Work MASTER.xlsx that had no property to attach to in R72).
 *
 *   Phase-1 / Round 66x.2 Step 3. These feed ALL cohorts/dates (incl. the deck's
 *   2019 <=5 = 9.46% peak), so importing them is the last lever on the residual
 *   cap-by-term gap. Each imported sale carries master_curated provenance.
 *
 * WHY A SCRIPT (not a migration): the 419 rows live in the master workbook /
 * the R72 workstation artifact (/tmp/backfill_plan.json), NOT in the repo or DB.
 * Supply them as JSON via --input; this script geocodes, DEDUPES, junk-filters,
 * and (only with --commit) creates property stubs + inserts the sales.
 *
 * ── DUPLICATE GUARDRAIL (the whole reason these were "unmatched") ──────────────
 * The 419 were unmatched precisely because no property matched, so STUB CREATION
 * is where twin-property risk lives. Before creating ANY stub we run, per row:
 *   1. normalized-address exact match vs existing dia.properties (same state),
 *      with USPS-style suffix/directional canonicalization so "4120 W Loomis Rd"
 *      == "4120 West Loomis Road".
 *   2. geocode-proximity: haversine < --dedup-meters (default 80m) to an existing
 *      GEOCODED property sharing the same leading street number.
 * A row that matches an existing property is NOT given a stub — its sale is
 * attached to the existing property_id instead (or skipped if that exact sale
 * already exists). Reuses the Round 76gn geocoding infra (Census -> Google).
 *
 * ── JUNK FILTER ───────────────────────────────────────────────────────────────
 * A 419-row hand-maintained sheet has a few non-importable rows. We reject a row
 * unless it has: a street number + street, a 2-letter US state, a parseable
 * sale_date, and sold_price > 0. Cap is optional (kept only if 4-12%, else null).
 *
 * ── INPUT FORMAT (--input file.json) ──────────────────────────────────────────
 *   [ { "address":"4120 W Loomis Rd", "city":"Greenfield", "state":"WI",
 *       "sale_date":"2024-03-15", "sold_price":7650000, "sold_cap":7.65,
 *       "tenant":"Fresenius", "seller":"...", "buyer":"..." }, ... ]
 *   (sold_cap may be a percent like 7.65 or a decimal like 0.0765 — auto-detected.)
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────
 *   # 1) DRY RUN (default — no writes; prints the full plan + dedup decisions)
 *   DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... \
 *     node scripts/import-master-unmatched-comps.mjs --input=master_unmatched.json
 *
 *   # 2) Review the plan, then commit
 *   ... node scripts/import-master-unmatched-comps.mjs --input=master_unmatched.json --commit
 *
 * Flags:
 *   --input=FILE         Required. JSON array of master unmatched rows.
 *   --commit             Actually write (default: dry run).
 *   --dedup-meters=N     Proximity radius for the geocode dedup. Default 80.
 *   --google-key=KEY     Google Maps key for the geocode fallback (or env
 *                        GOOGLE_MAPS_API_KEY). Census-only if absent.
 *   --plan-out=FILE      Write the per-row decision plan as JSON for audit.
 *
 * Idempotency: re-running is safe — rows whose sale already exists (matched
 * property + sale_date within +/-90 days + sold_price within +/-3%) are skipped, and the
 * data_source tag ('master_xlsx_backfill_r2') lets you DELETE a bad run:
 *   DELETE FROM sales_transactions WHERE data_source='master_xlsx_backfill_r2';
 *   DELETE FROM properties WHERE data_source='master_xlsx_backfill_r2_stub'
 *     AND property_id NOT IN (SELECT property_id FROM sales_transactions);
 */

import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = parseArgs(process.argv.slice(2));
const INPUT = args.input;
const COMMIT = args.commit === true || args.commit === 'true';
const DEDUP_M = parseFloat(args['dedup-meters'] || '80');
const GOOGLE_KEY = args['google-key'] || process.env.GOOGLE_MAPS_API_KEY || null;
const PLAN_OUT = args['plan-out'] || null;

const SUPA_URL = process.env.DIA_SUPABASE_URL;
const SUPA_KEY = process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY;

const DATA_SOURCE_SALE = 'master_xlsx_backfill_r2';
const DATA_SOURCE_STUB = 'master_xlsx_backfill_r2_stub';

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

if (!INPUT) { console.error('FATAL: --input=FILE is required'); process.exit(1); }
if (!SUPA_URL || !SUPA_KEY) {
  console.error('FATAL: DIA_SUPABASE_URL and DIA_SUPABASE_SERVICE_KEY (or _KEY) must be set');
  process.exit(1);
}

// ── PostgREST helpers ────────────────────────────────────────────────────────
async function rest(method, path, body) {
  const resp = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) throw new Error(`${method} ${path} -> ${resp.status} ${await resp.text()}`);
  return resp.status === 204 ? null : resp.json();
}

// ── address normalization (USPS-ish) ─────────────────────────────────────────
const SUFFIX = { road:'rd', rd:'rd', street:'st', st:'st', avenue:'ave', ave:'ave', av:'ave',
  boulevard:'blvd', blvd:'blvd', drive:'dr', dr:'dr', lane:'ln', ln:'ln', court:'ct', ct:'ct',
  highway:'hwy', hwy:'hwy', parkway:'pkwy', pkwy:'pkwy', place:'pl', pl:'pl', circle:'cir', cir:'cir',
  terrace:'ter', ter:'ter', way:'way', trail:'trl', trl:'trl', route:'rt', rt:'rt', us:'us' };
const DIR = { north:'n', n:'n', south:'s', s:'s', east:'e', e:'e', west:'w', w:'w',
  northeast:'ne', ne:'ne', northwest:'nw', nw:'nw', southeast:'se', se:'se', southwest:'sw', sw:'sw' };

function normAddr(raw) {
  if (!raw) return '';
  let s = String(raw).toLowerCase()
    .replace(/\b(suite|ste|unit|apt|#|bldg|building|floor|fl)\b.*$/i, '') // drop unit tails
    .replace(/[.,]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const toks = s.split(' ').map(t => SUFFIX[t] || DIR[t] || t);
  return toks.join(' ').trim();
}
function leadingNumber(raw) {
  const m = String(raw || '').trim().match(/^(\d+)/);
  return m ? m[1] : null;
}
function haversineM(a, b, c, d) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(c - a), dLng = toR(d - b);
  const h = Math.sin(dLat/2)**2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── geocoders (Census -> Google), mirrors Round 76gn ─────────────────────────
async function geocode(row) {
  const parts = [row.address, row.city, row.state].filter(Boolean);
  if (parts.length < 2) return null;
  const oneLine = parts.join(', ');
  try {
    const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
      + '?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(oneLine);
    const r = await fetch(u);
    if (r.ok) {
      const m = (await r.json())?.result?.addressMatches?.[0];
      const lat = Number(m?.coordinates?.y), lng = Number(m?.coordinates?.x);
      if (isFinite(lat) && isFinite(lng)) return { lat, lng, src: 'census' };
    }
  } catch { /* fall through */ }
  if (GOOGLE_KEY) {
    try {
      const u = 'https://maps.googleapis.com/maps/api/geocode/json?address='
        + encodeURIComponent(oneLine) + '&key=' + GOOGLE_KEY;
      const r = await fetch(u);
      if (r.ok) {
        const j = await r.json();
        const loc = j?.results?.[0]?.geometry?.location;
        if (loc && isFinite(loc.lat) && isFinite(loc.lng)) return { lat: loc.lat, lng: loc.lng, src: 'google' };
      }
    } catch { /* none */ }
  }
  return null;
}

// ── junk filter ──────────────────────────────────────────────────────────────
function junkReason(row) {
  if (!row.address || !leadingNumber(row.address)) return 'no_street_number';
  if (!/^[A-Za-z]{2}$/.test(String(row.state || '').trim())) return 'bad_state';
  const d = new Date(row.sale_date);
  if (!row.sale_date || Number.isNaN(d.getTime())) return 'bad_sale_date';
  if (d.getFullYear() < 1990 || d.getFullYear() > new Date().getFullYear() + 1) return 'sale_date_out_of_range';
  if (!(Number(row.sold_price) > 0)) return 'no_sold_price';
  return null;
}
function normCap(v) {
  if (v == null || v === '') return null;
  let c = Number(v);
  if (!isFinite(c)) return null;
  if (c > 1) c = c / 100;          // percent -> decimal
  return (c >= 0.04 && c <= 0.12) ? Number(c.toFixed(5)) : null; // band-gate
}

// ── main ─────────────────────────────────────────────────────────────────────
(async function main() {
  const rows = JSON.parse(readFileSync(INPUT, 'utf8'));
  if (!Array.isArray(rows)) { console.error('FATAL: --input must be a JSON array'); process.exit(1); }
  console.log(`[import] ${rows.length} master rows | mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'} | dedup=${DEDUP_M}m | google=${GOOGLE_KEY ? 'on' : 'off'}`);

  // Load existing dia.properties once (id, normalized addr, state, lat, lng).
  console.log('[import] loading existing properties for dedup...');
  const existing = [];
  for (let off = 0; ; off += 1000) {
    const page = await rest('GET',
      `properties?select=property_id,address,city,state,latitude,longitude&order=property_id&limit=1000&offset=${off}`);
    if (!page.length) break;
    for (const p of page) existing.push({
      property_id: p.property_id, state: (p.state || '').toUpperCase().trim(),
      norm: normAddr(p.address), num: leadingNumber(p.address),
      lat: p.latitude != null ? Number(p.latitude) : null, lng: p.longitude != null ? Number(p.longitude) : null,
    });
    if (page.length < 1000) break;
  }
  console.log(`[import] ${existing.length} existing properties loaded`);

  const plan = [];
  const counts = { junk: 0, deduped: 0, sale_exists: 0, new_property: 0, attach_existing: 0, geocode_miss: 0 };

  for (const [i, raw] of rows.entries()) {
    const row = { ...raw, state: String(raw.state || '').toUpperCase().trim() };
    const junk = junkReason(row);
    if (junk) { counts.junk++; plan.push({ i, address: row.address, decision: 'JUNK', reason: junk }); continue; }

    const nAddr = normAddr(row.address), num = leadingNumber(row.address);
    const geo = await geocode(row);
    await sleep(60);
    if (!geo) counts.geocode_miss++;

    // dedup: normalized-address exact (same state) OR proximity + same street number
    let match = existing.find(e => e.state === row.state && e.norm === nAddr);
    if (!match && geo) {
      match = existing.find(e =>
        e.lat != null && e.lng != null && e.num === num &&
        haversineM(geo.lat, geo.lng, e.lat, e.lng) <= DEDUP_M);
    }

    const cap = normCap(row.sold_cap);
    const saleRow = {
      property_id: match ? match.property_id : null, // filled after stub insert
      sale_date: new Date(row.sale_date).toISOString().slice(0, 10),
      sold_price: Number(row.sold_price),
      cap_rate: cap, stated_cap_rate: cap, cap_rate_final: cap,
      cap_rate_source: cap != null ? 'master_curated' : null,
      cap_rate_confidence: cap != null ? 'high' : null,
      transaction_type: 'Investment',
      buyer_name: row.buyer || null, seller_name: row.seller || null,
      data_source: DATA_SOURCE_SALE,
      notes: `master_xlsx_backfill_r2${row.tenant ? ' tenant=' + row.tenant : ''}`,
    };

    if (match) {
      // Tolerant same-transaction dedup: a sale on the SAME property within
      // +/-90 days AND +/-3% price is the SAME deal (master vs CoStar date/price
      // drift), not a new sale. (Exact date + $1k was far too strict —
      // independent tolerant-match sampling (n=203) showed ~88% of master rows
      // already have their sale in the DB at this tolerance; the strict matcher
      // mislabeled ~600 of them ATTACH_EXISTING, which would insert duplicates.)
      const d = new Date(saleRow.sale_date);
      const lo = new Date(d); lo.setDate(lo.getDate() - 90);
      const hi = new Date(d); hi.setDate(hi.getDate() + 90);
      const tol = 0.03 * saleRow.sold_price;
      const near = await rest('GET',
        `sales_transactions?select=sale_id,sale_date,sold_price&property_id=eq.${match.property_id}` +
        `&sale_date=gte.${lo.toISOString().slice(0, 10)}&sale_date=lte.${hi.toISOString().slice(0, 10)}&limit=50`);
      const twin = near.find(s => {
        const p = Number(s.sold_price);
        return p > 0 && Math.abs(p - saleRow.sold_price) <= tol;
      });
      if (twin) { counts.sale_exists++; plan.push({ i, address: row.address, decision: 'SALE_EXISTS', property_id: match.property_id, sale_id: twin.sale_id }); continue; }
      counts.attach_existing++;
      plan.push({ i, address: row.address, decision: 'ATTACH_EXISTING', property_id: match.property_id, cap, geocode: geo?.src || 'miss' });
      if (COMMIT) await rest('POST', 'sales_transactions', saleRow);
      continue;
    }

    // genuinely new -> stub + sale
    counts.new_property++;
    plan.push({ i, address: row.address, decision: 'NEW_PROPERTY', cap, geocode: geo?.src || 'miss', lat: geo?.lat, lng: geo?.lng });
    if (COMMIT) {
      const stub = await rest('POST', 'properties', {
        address: row.address, city: row.city || null, state: row.state,
        tenant: row.tenant || null,
        latitude: geo?.lat ?? null, longitude: geo?.lng ?? null,
        data_source: DATA_SOURCE_STUB,
      });
      const newId = stub[0].property_id;
      existing.push({ property_id: newId, state: row.state, norm: nAddr, num, lat: geo?.lat ?? null, lng: geo?.lng ?? null });
      await rest('POST', 'sales_transactions', { ...saleRow, property_id: newId });
    }
  }

  console.log('\n[import] PLAN SUMMARY');
  console.table(counts);
  console.log(`  JUNK rejected ......... ${counts.junk}`);
  console.log(`  deduped: SALE_EXISTS .. ${counts.sale_exists}`);
  console.log(`  deduped: ATTACH_EXIST . ${counts.attach_existing}  (sale added to an existing property, no stub)`);
  console.log(`  NEW_PROPERTY stub ..... ${counts.new_property}`);
  console.log(`  geocode misses ........ ${counts.geocode_miss}  (still imported, lat/lng null)`);
  console.log(COMMIT ? '\n[import] COMMITTED.' : '\n[import] DRY RUN — no writes. Re-run with --commit to apply.');
  if (PLAN_OUT) { writeFileSync(PLAN_OUT, JSON.stringify(plan, null, 2)); console.log(`[import] per-row plan -> ${PLAN_OUT}`); }
})().catch(e => { console.error('[import] FATAL', e); process.exit(1); });
