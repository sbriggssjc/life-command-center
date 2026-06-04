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
 * attached to the existing property_id instead. Reuses the Round 76gn geocoding
 * infra (Census -> Google).
 *
 * Beyond property-dedup, four SALE-level guards (sampling showed ~88% of master
 * rows already exist; 48.5% of the rest were cross-property dups):
 *   SALE_EXISTS   — a same-property sale within +/-90d AND +/-3% price (master vs
 *                   CoStar date/price drift) -> already in DB, skip.
 *   DUP_REVIEW    — a same-state sale within +/-90d/+/-3% on a DIFFERENT property
 *                   -> the same transaction on another property record = a
 *                   property-MERGE candidate. Emits matched sale_id/property_id;
 *                   NOT inserted (twins are not; the merge lead is the value).
 *   INTRA_DUP     — identical (state,date,price,ADDRESS) input rows -> keep first.
 *   PORTFOLIO_SKIP— >=2 input rows sharing an identical price within +/-2 days =
 *                   one aggregate price split across properties -> excluded
 *                   (importing each as a full-price sale would multi-count).
 * Only ATTACH_EXISTING + NEW_PROPERTY are written on --commit.
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
 *   DELETE FROM properties WHERE source='master_xlsx_backfill_r2_stub'
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
  // Accept either a bare JSON array OR a wrapper object { ..., rows: [...] }
  // (the master export ships as {source, extracted, note, rows:[...]}).
  const parsed = JSON.parse(readFileSync(INPUT, 'utf8'));
  const rows = Array.isArray(parsed) ? parsed
    : (Array.isArray(parsed?.rows) ? parsed.rows : null);
  if (!rows) { console.error('FATAL: --input must be a JSON array or an object with a "rows" array'); process.exit(1); }
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

  // Load all market sales once for CROSS-PROPERTY dedup: a tolerant date+price
  // match on a DIFFERENT same-state property is a cross-property duplicate (same
  // transaction recorded against another property record) -> a property-MERGE
  // candidate, not a new sale. (Sampling n=264: 48.5% of ATTACH candidates had
  // exactly this.) Reuses the property->state map.
  const propState = new Map(existing.map(e => [e.property_id, e.state]));
  const sales = [];
  for (let off = 0; ; off += 1000) {
    const page = await rest('GET',
      `sales_transactions?select=sale_id,property_id,sale_date,sold_price&sold_price=gt.0&order=sale_id&limit=1000&offset=${off}`);
    if (!page.length) break;
    for (const s of page) sales.push({
      sale_id: s.sale_id, property_id: s.property_id, state: propState.get(s.property_id) || null,
      t: s.sale_date ? new Date(s.sale_date).getTime() : null, price: Number(s.sold_price),
    });
    if (page.length < 1000) break;
  }
  console.log(`[import] ${sales.length} existing sales loaded (cross-property dedup)`);

  // ── Input-side pre-pass (no DB) ──────────────────────────────────────────────
  const DAY = 86400000;
  // (2) intra-master exact duplicates: identical (state, date, price, ADDRESS) ->
  // keep first. The address is REQUIRED in the key — without it, a portfolio sale
  // (N distinct properties sharing one aggregate price+date) would be wrongly
  // collapsed to a single property. Same-price/different-address is handled by the
  // portfolio guard below, not here.
  const exactSeen = new Map();
  for (const [i, r] of rows.entries()) {
    if (!(Number(r.sold_price) > 0) || !r.sale_date) continue;
    const key = `${String(r.state || '').toUpperCase().trim()}|${String(r.sale_date).slice(0, 10)}|${Math.round(Number(r.sold_price))}|${normAddr(r.address)}`;
    if (exactSeen.has(key)) { r._skip = 'INTRA_DUP'; r._dupOf = exactSeen.get(key); }
    else exactSeen.set(key, i);
  }
  // (3) portfolio allocations: >=2 rows sharing an IDENTICAL price within +/-2 days
  // are an aggregate price split across properties -> exclude (importing each as a
  // full-price sale multi-counts). Distinct per-property prices don't group here.
  const byPrice = new Map();
  for (const [i, r] of rows.entries()) {
    if (r._skip || !(Number(r.sold_price) > 0) || !r.sale_date) continue;
    const p = Math.round(Number(r.sold_price));
    if (!byPrice.has(p)) byPrice.set(p, []);
    byPrice.get(p).push({ i, t: new Date(r.sale_date).getTime() });
  }
  for (const arr of byPrice.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.t - b.t);
    let cluster = [arr[0]];
    const flush = () => { if (cluster.length >= 2) for (const c of cluster) { rows[c.i]._skip = 'PORTFOLIO'; rows[c.i]._portfolioN = cluster.length; } };
    for (let k = 1; k < arr.length; k++) {
      if (Math.abs(arr[k].t - cluster[cluster.length - 1].t) <= 2 * DAY) cluster.push(arr[k]);
      else { flush(); cluster = [arr[k]]; }
    }
    flush();
  }

  const plan = [];
  const counts = { junk: 0, intra_dup: 0, portfolio_skip: 0, sale_exists: 0, dup_review: 0, attach_existing: 0, new_property: 0, geocode_miss: 0 };

  for (const [i, raw] of rows.entries()) {
    const row = { ...raw, state: String(raw.state || '').toUpperCase().trim() };
    const junk = junkReason(row);
    if (junk) { counts.junk++; plan.push({ i, address: row.address, decision: 'JUNK', reason: junk }); continue; }
    if (raw._skip === 'INTRA_DUP') { counts.intra_dup++; plan.push({ i, address: row.address, decision: 'INTRA_DUP', dup_of_row: raw._dupOf }); continue; }
    if (raw._skip === 'PORTFOLIO') { counts.portfolio_skip++; plan.push({ i, address: row.address, decision: 'PORTFOLIO_SKIP', price: Number(row.sold_price), group_size: raw._portfolioN }); continue; }

    const nAddr = normAddr(row.address), num = leadingNumber(row.address);
    const cap = normCap(row.sold_cap);
    const saleRow = {
      property_id: null,
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

    // property match: normalized-address exact (same state) OR geocode proximity.
    // Geocode only on a norm miss (bounds geocoding to the long tail).
    let match = existing.find(e => e.state === row.state && e.norm === nAddr);
    let geo = null;
    if (!match) {
      geo = await geocode(row); await sleep(60);
      if (!geo) counts.geocode_miss++;
      else match = existing.find(e =>
        e.lat != null && e.lng != null && e.num === num &&
        haversineM(geo.lat, geo.lng, e.lat, e.lng) <= DEDUP_M);
    }
    if (match) saleRow.property_id = match.property_id;

    // Tolerant sale dedup: any same-state sale within +/-90d AND +/-3% price.
    const tT = new Date(saleRow.sale_date).getTime();
    const tol = 0.03 * saleRow.sold_price;
    const twins = sales.filter(s => s.state === row.state && s.t != null &&
      Math.abs(s.t - tT) <= 90 * DAY && s.price > 0 && Math.abs(s.price - saleRow.sold_price) <= tol);
    const samePropTwin = match ? twins.find(s => s.property_id === match.property_id) : null;
    if (samePropTwin) { counts.sale_exists++; plan.push({ i, address: row.address, decision: 'SALE_EXISTS', property_id: match.property_id, sale_id: samePropTwin.sale_id }); continue; }
    const crossPropTwin = twins.find(s => !match || s.property_id !== match.property_id);
    if (crossPropTwin) {
      counts.dup_review++;
      plan.push({ i, address: row.address, state: row.state, decision: 'DUP_REVIEW',
        matched_sale_id: crossPropTwin.sale_id, matched_property_id: crossPropTwin.property_id,
        candidate_property_id: match ? match.property_id : null }); // merge lead — NOT inserted
      continue;
    }

    if (match) {
      counts.attach_existing++;
      plan.push({ i, address: row.address, decision: 'ATTACH_EXISTING', property_id: match.property_id, cap, geocode: geo?.src || 'norm' });
      if (COMMIT) {
        const ins = await rest('POST', 'sales_transactions', saleRow);
        const r = Array.isArray(ins) ? ins[0] : ins;
        if (r?.sale_id) sales.push({ sale_id: r.sale_id, property_id: match.property_id, state: row.state, t: tT, price: saleRow.sold_price });
      }
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
        // properties table has `source`, not `data_source` (that column is on
        // sales_transactions) — PGRST204 on the first stub insert otherwise.
        source: DATA_SOURCE_STUB,
      });
      const newId = stub[0].property_id;
      existing.push({ property_id: newId, state: row.state, norm: nAddr, num, lat: geo?.lat ?? null, lng: geo?.lng ?? null });
      const ins = await rest('POST', 'sales_transactions', { ...saleRow, property_id: newId });
      const r = Array.isArray(ins) ? ins[0] : ins;
      if (r?.sale_id) sales.push({ sale_id: r.sale_id, property_id: newId, state: row.state, t: tT, price: saleRow.sold_price });
    }
  }

  console.log('\n[import] PLAN SUMMARY');
  console.table(counts);
  console.log(`  JUNK rejected ............ ${counts.junk}`);
  console.log(`  INTRA_DUP (input dups) ... ${counts.intra_dup}`);
  console.log(`  PORTFOLIO_SKIP ........... ${counts.portfolio_skip}  (>=2 rows, identical price within +/-2d)`);
  console.log(`  SALE_EXISTS (same prop) .. ${counts.sale_exists}`);
  console.log(`  DUP_REVIEW (cross-prop) .. ${counts.dup_review}  (merge candidates; NOT inserted — see plan)`);
  console.log(`  ATTACH_EXISTING (insert) . ${counts.attach_existing}`);
  console.log(`  NEW_PROPERTY (stub+insert) ${counts.new_property}`);
  console.log(`  => GENUINE INSERTS ....... ${counts.attach_existing + counts.new_property}`);
  console.log(`  geocode misses ........... ${counts.geocode_miss}  (norm-miss rows only; imported with lat/lng null)`);
  console.log(COMMIT ? '\n[import] COMMITTED.' : '\n[import] DRY RUN — no writes. Re-run with --commit to apply.');
  if (PLAN_OUT) { writeFileSync(PLAN_OUT, JSON.stringify(plan, null, 2)); console.log(`[import] per-row plan -> ${PLAN_OUT}`); }
})().catch(e => { console.error('[import] FATAL', e); process.exit(1); });
