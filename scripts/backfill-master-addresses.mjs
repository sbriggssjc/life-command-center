#!/usr/bin/env node
/**
 * Master-address backfill — Round 66x.2 follow-up.
 *
 * Legacy dia CSV/CMS imports corrupted addresses on a class of properties (wrong
 * city paired with a real street, suite drift, etc.). The cap-fingerprint audit
 * proved these are the SAME transactions the master comp workbook records under
 * clean, broker-curated addresses. This script rewrites the corrupted property
 * addresses from the master receipt, gated hard so a wrong write can't land.
 *
 * Population = properties carrying a master-linked sale
 *   (sales_transactions.data_source LIKE 'master_xlsx%'  OR
 *    sales_transactions.cap_rate_source = 'master_curated').
 *
 * PER-SALE RESOLUTION + GATES (a sale must clear ALL to contribute a write):
 *   1. KEY RESOLUTION  — match the sale to a master row on (sale_date, ROUND(sold_price)),
 *      the same key the importer used.
 *      - 0 master rows  -> skip NO_MASTER_ROW
 *      - >1 master rows with DIFFERENT normalized addresses -> skip AMBIGUOUS
 *        (the 4x$19,179,930-style identical date+price cluster across buildings;
 *         never auto-adjudicated).
 *   2. CAP FINGERPRINT — master.sold_cap must agree within <=5bp against ANY of the
 *      sale's cap columns (stated_cap_rate / cap_rate / calculated_cap_rate).
 *      - master cap null            -> skip NO_CAP_FINGERPRINT (can't verify)
 *      - min delta > 5bp            -> skip FINGERPRINT_FAIL
 *      Receipt records the matching column + delta, plus the independent
 *      calculated_cap_rate delta for the operator's eye.
 *
 * PER-PROPERTY GATES (after all the property's sales resolve):
 *   3. CONFLICTING MASTERS — if a property's passing sales propose DIFFERENT
 *      master addresses (the double-claim shape), skip the whole property:
 *      CONFLICTING_MASTERS (manual review).
 *   4. NEVER CLOBBER CURATED — if properties.source is already a curated/manual
 *      tag, skip CURATED_PROTECTED.
 *   5. STATE INVARIANT — the matcher was same-state, so normalized old_state must
 *      equal new_state. If not, it's a BUG SIGNAL, not a write: skip BUG_STATE_MISMATCH.
 *   6. NO CHANGE — if USPS-normalized (address, city) already agree, skip NO_CHANGE.
 *
 * PRECISION GUARDS — never let the master make a dia address LESS precise:
 *   7. MASTER_LESS_PRECISE_SUITE — dia carries a unit/suite (STE/BLDG/APT/...)
 *      the master row lacks -> skip (don't drop the unit).
 *   8. MASTER_LESS_PRECISE_CITY — the city change reduces precision. The CMS
 *      clinic link (medicare_clinics, joined on property_id) is the independent
 *      referee for ambiguous city corrections:
 *        - master un-truncates (new city char-starts-with old)   -> ALLOW
 *        - master truncates (old char-starts-with new)           -> SKIP
 *        - CMS clinic city == master city                        -> ALLOW (corroborated)
 *        - CMS clinic city == dia city                           -> SKIP (master coarsens/wrong)
 *        - no CMS referee / agrees with neither                  -> SKIP (don't guess)
 *      In practice the SKIPs also catch (sale_date,sold_price) mis-resolutions to
 *      a DIFFERENT building (both street AND city differ, CMS backs dia) — the
 *      referee prevents corrupting a correct dia record, it doesn't lose a fix.
 *
 * A surviving candidate becomes a WRITE: address/city/state <- master, lat/lng
 * NULLed (so the lcc-geocode-backfill cron re-geocodes), address provenance tagged
 * 'master_curated'. zip is NOT touched (master has none).
 *
 * MODES:
 *   live (default)     — fetch sales+properties via PostgREST (DIA_SUPABASE_URL/_KEY).
 *   offline snapshot   — --sales-snapshot=FILE --props-snapshot=FILE (no DB read).
 *   DRY-RUN is the default; --commit writes (live mode only) and requires the
 *   `properties.address_source` column (migration
 *   20260715_dia_properties_address_source.sql).
 *
 * USAGE (dry-run, produces address_backfill_plan.json):
 *   node scripts/backfill-master-addresses.mjs \
 *     --sales-snapshot=scripts/.addr_snapshot_sales.json \
 *     --props-snapshot=scripts/.addr_snapshot_props.json
 *   # live:
 *   DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... \
 *     node scripts/backfill-master-addresses.mjs
 *   # commit after sample-verifying the plan:
 *   DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... \
 *     node scripts/backfill-master-addresses.mjs --commit
 */
import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';

const A = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  if (!a.startsWith('--')) return [];
  const i = a.indexOf('='); return [[a.slice(2, i < 0 ? undefined : i), i < 0 ? true : a.slice(i + 1)]];
}));
const MASTER = A.master || 'scripts/master_sales_comps_full.json';
const SALES_SNAP = A['sales-snapshot'], PROPS_SNAP = A['props-snapshot'];
const OFFLINE = !!(SALES_SNAP && PROPS_SNAP);
const COMMIT = A.commit === true || A.commit === 'true';
const OUT = A.out || 'address_backfill_plan.json';
const URL = process.env.DIA_SUPABASE_URL, KEY = process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY;
if (!OFFLINE && (!URL || !KEY)) { console.error('FATAL: live mode needs DIA_SUPABASE_URL + DIA_SUPABASE_SERVICE_KEY (or pass --sales-snapshot/--props-snapshot)'); process.exit(1); }
if (COMMIT && OFFLINE) { console.error('FATAL: --commit requires live mode (REST), not snapshots'); process.exit(1); }

// ---- USPS-style normalizers (offline, deterministic) -----------------------
const SUFFIX = { STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE', BOULEVARD: 'BLVD', BLVD: 'BLVD',
  DRIVE: 'DR', DR: 'DR', ROAD: 'RD', RD: 'RD', LANE: 'LN', LN: 'LN', COURT: 'CT', CT: 'CT', PARKWAY: 'PKWY',
  PKWY: 'PKWY', PKY: 'PKWY', HIGHWAY: 'HWY', HWY: 'HWY', HWAY: 'HWY', PLACE: 'PL', PL: 'PL', CIRCLE: 'CIR',
  CIR: 'CIR', TERRACE: 'TER', TER: 'TER', SQUARE: 'SQ', SQ: 'SQ', TRAIL: 'TRL', TRL: 'TRL', WAY: 'WAY',
  PIKE: 'PIKE', LOOP: 'LOOP', PLAZA: 'PLZ', PLZ: 'PLZ', EXPRESSWAY: 'EXPY', EXPY: 'EXPY', CROSSING: 'XING',
  XING: 'XING', POINT: 'PT', PT: 'PT', CENTER: 'CTR', CTR: 'CTR', JUNCTION: 'JCT', JCT: 'JCT', ROUTE: 'RTE', RTE: 'RTE' };
const UNIT = { SUITE: 'STE', STE: 'STE', UNIT: 'STE', '#': 'STE', NO: 'STE', BUILDING: 'BLDG', BLDG: 'BLDG',
  FLOOR: 'FL', FL: 'FL', DEPARTMENT: 'DEPT', DEPT: 'DEPT', APARTMENT: 'APT', APT: 'APT', ROOM: 'RM', RM: 'RM' };
const DIR = { NORTH: 'N', N: 'N', SOUTH: 'S', S: 'S', EAST: 'E', E: 'E', WEST: 'W', W: 'W',
  NORTHEAST: 'NE', NE: 'NE', NORTHWEST: 'NW', NW: 'NW', SOUTHEAST: 'SE', SE: 'SE', SOUTHWEST: 'SW', SW: 'SW' };

function normAddr(s) {
  if (s == null) return '';
  let t = String(s).toUpperCase().replace(/[.,]/g, ' ').replace(/#/g, ' # ').replace(/\s+/g, ' ').trim();
  const toks = t.split(' ').filter(Boolean).map(tok => {
    if (SUFFIX[tok]) return SUFFIX[tok];
    if (UNIT[tok]) return UNIT[tok];
    if (DIR[tok]) return DIR[tok];
    return tok;
  });
  return toks.join(' ');
}
const normCity = s => (s == null ? '' : String(s).toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim());
const normState = s => (s == null ? '' : String(s).toUpperCase().trim());
const normCap = v => { if (v == null || v === '') return null; let c = Number(v); if (!isFinite(c)) return null; if (c > 1) c /= 100; return c; };
const priceKey = (d, p) => `${String(d).slice(0, 10)}|${Math.round(Number(p))}`;
const CURATED = /master_curated|manual|curated/i;

// ---- precision guards -------------------------------------------------------
// Unit/suite designator present in a USPS-normalized address (SUITE/UNIT/#/...
// already mapped to STE by normAddr).
const UNIT_RE = /\b(STE|BLDG|APT|FL|RM|DEPT)\b|#/;
const hasUnit = a => UNIT_RE.test(a);
// City precision verdict — the CMS clinic link is the independent referee for
// ambiguous city corrections (metro-coarsening vs genuine fix). cmsSet = the
// linked medicare_clinics cities (normalized). Char-prefix handles the 76gn.c
// truncation class (master un-truncates -> more precise).
function cityVerdict(oC, nC, cmsSet) {
  if (oC === nC) return 'SAME';
  if (nC.startsWith(oC)) return 'ALLOW_UNTRUNCATE';   // master longer -> more precise
  if (oC.startsWith(nC)) return 'SKIP_TRUNCATE';      // master shorter -> less precise
  if (cmsSet.has(nC)) return 'ALLOW_CMS';             // referee corroborates master
  if (cmsSet.has(oC)) return 'SKIP_CMS_BACKS_DIA';    // referee backs dia -> master coarsens/wrong
  return 'SKIP_CITY_UNVERIFIED';                       // no referee -> don't guess
}

async function rest(method, path, body) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
async function fetchAllSales() {
  const out = []; const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const q = `sales_transactions?select=sale_id,property_id,sale_date,sold_price,stated_cap_rate,cap_rate,calculated_cap_rate`
      + `&or=(data_source.like.master_xlsx*,cap_rate_source.eq.master_curated)`
      + `&property_id=not.is.null&sale_date=not.is.null&sold_price=not.is.null&limit=${PAGE}&offset=${off}`;
    const r = await fetch(`${URL}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`sales fetch ${r.status} ${await r.text()}`);
    const rows = await r.json(); out.push(...rows); if (rows.length < PAGE) break;
  }
  return out;
}
async function fetchProps(ids) {
  const out = []; const CH = 200;
  for (let i = 0; i < ids.length; i += CH) {
    const chunk = ids.slice(i, i + CH).join(',');
    // embed the CMS clinic link (medicare_clinics.property_id -> properties) for the city referee
    const q = `properties?select=property_id,address,city,state,zip_code,latitude,longitude,source,medicare_clinics(city)&property_id=in.(${chunk})`;
    const r = await fetch(`${URL}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`props fetch ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows.map(p => ({ ...p, has_lat: p.latitude != null,
      clinic_cities: (p.medicare_clinics || []).map(c => c.city).filter(Boolean) })));
  }
  return out;
}

(async function main() {
  const master = (() => { const m = JSON.parse(readFileSync(MASTER, 'utf8')); return m.rows || m; })();
  // Build master index: key -> [{addr,city,state,cap,raw}] ; ambiguity = >1 distinct normalized (addr|city|state)
  const midx = new Map();
  for (const m of master) {
    if (m.sale_date == null || m.sold_price == null) continue;
    const k = priceKey(m.sale_date, m.sold_price);
    if (!midx.has(k)) midx.set(k, []);
    midx.get(k).push({ addr: m.address, city: m.city, state: m.state, cap: normCap(m.sold_cap),
      naddr: normAddr(m.address), ncity: normCity(m.city), nstate: normState(m.state) });
  }

  const sales = OFFLINE ? JSON.parse(readFileSync(SALES_SNAP, 'utf8')) : await fetchAllSales();
  const propIds = [...new Set(sales.map(s => s.property_id))];
  const props = OFFLINE ? JSON.parse(readFileSync(PROPS_SNAP, 'utf8')) : await fetchProps(propIds);
  const pmap = new Map(props.map(p => [p.property_id, p]));
  console.log(`[addr-backfill] ${sales.length} master-linked sales | ${props.length} props | mode=${OFFLINE ? 'OFFLINE' : 'LIVE'} | ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);

  const skips = [];
  const byProp = new Map(); // property_id -> [{candidate proposal}]
  for (const s of sales) {
    const k = priceKey(s.sale_date, s.sold_price);
    const cands = midx.get(k) || [];
    if (cands.length === 0) { skips.push({ property_id: s.property_id, sale_id: s.sale_id, reason: 'NO_MASTER_ROW', detail: k }); continue; }
    // ambiguity: distinct normalized addresses among the key's master rows
    const distinct = [...new Set(cands.map(c => `${c.naddr}|${c.ncity}|${c.nstate}`))];
    if (distinct.length > 1) { skips.push({ property_id: s.property_id, sale_id: s.sale_id, reason: 'AMBIGUOUS', detail: `${cands.length} master rows / ${distinct.length} distinct addrs @ ${k}` }); continue; }
    const m = cands[0];
    // cap fingerprint
    if (m.cap == null) { skips.push({ property_id: s.property_id, sale_id: s.sale_id, reason: 'NO_CAP_FINGERPRINT', detail: 'master sold_cap null' }); continue; }
    const cols = { stated_cap_rate: s.stated_cap_rate, cap_rate: s.cap_rate, calculated_cap_rate: s.calculated_cap_rate };
    let best = { col: null, bp: Infinity };
    for (const [col, v] of Object.entries(cols)) {
      const cv = normCap(v); if (cv == null) continue;
      const bp = Math.abs(m.cap - cv) * 10000;
      if (bp < best.bp) best = { col, bp: Number(bp.toFixed(2)) };
    }
    const calcCv = normCap(s.calculated_cap_rate);
    const calcDeltaBp = calcCv == null ? null : Number((Math.abs(m.cap - calcCv) * 10000).toFixed(2));
    if (best.col == null) { skips.push({ property_id: s.property_id, sale_id: s.sale_id, reason: 'NO_CAP_FINGERPRINT', detail: 'sale has no cap columns' }); continue; }
    if (best.bp > 5) { skips.push({ property_id: s.property_id, sale_id: s.sale_id, reason: 'FINGERPRINT_FAIL', detail: `min ${best.bp}bp via ${best.col} (master ${(m.cap * 100).toFixed(3)}%)` }); continue; }
    if (!byProp.has(s.property_id)) byProp.set(s.property_id, []);
    byProp.get(s.property_id).push({ sale_id: s.sale_id, m, fp_source: best.col, fp_bp: best.bp, calc_delta_bp: calcDeltaBp, master_sale_date: String(s.sale_date).slice(0, 10), master_sold_price: Math.round(Number(s.sold_price)) });
  }

  const writes = [];
  for (const [pid, list] of byProp) {
    const p = pmap.get(pid);
    if (!p) { skips.push({ property_id: pid, reason: 'PROP_MISSING' }); continue; }
    // conflicting masters: distinct proposed normalized addresses among passing sales
    const distinct = [...new Set(list.map(c => `${c.m.naddr}|${c.m.ncity}|${c.m.nstate}`))];
    if (distinct.length > 1) { skips.push({ property_id: pid, reason: 'CONFLICTING_MASTERS', detail: distinct.join('  ||  '), sale_ids: list.map(c => c.sale_id) }); continue; }
    // curated guard
    if (p.source && CURATED.test(p.source)) { skips.push({ property_id: pid, reason: 'CURATED_PROTECTED', detail: `source=${p.source}` }); continue; }
    const c = list[0];
    const oA = normAddr(p.address), oC = normCity(p.city), oS = normState(p.state);
    // state invariant — must never flip (matcher was same-state)
    if (oS && c.m.nstate && oS !== c.m.nstate) { skips.push({ property_id: pid, reason: 'BUG_STATE_MISMATCH', detail: `${p.state} -> ${c.m.state}`, sale_ids: list.map(x => x.sale_id) }); continue; }
    // no-change
    if (oA === c.m.naddr && oC === c.m.ncity) { skips.push({ property_id: pid, reason: 'NO_CHANGE' }); continue; }
    // PRECISION GUARD 1 — never let the master drop a unit/suite the dia row carries.
    if (hasUnit(oA) && !hasUnit(c.m.naddr)) {
      skips.push({ property_id: pid, reason: 'MASTER_LESS_PRECISE_SUITE', detail: `${p.address}  ->  ${c.m.addr}`, sale_ids: list.map(x => x.sale_id) }); continue;
    }
    // PRECISION GUARD 2 — city: skip metro-coarsening / unverified city changes,
    // using the CMS clinic link as the referee for ambiguous ones.
    const cms = new Set((p.clinic_cities || []).map(x => normCity(x)));
    const cv = cityVerdict(oC, c.m.ncity, cms);
    if (cv.startsWith('SKIP')) {
      skips.push({ property_id: pid, reason: 'MASTER_LESS_PRECISE_CITY', detail: `${cv}: ${p.city} -> ${c.m.city}`, clinic_cities: [...cms], sale_ids: list.map(x => x.sale_id) }); continue;
    }
    writes.push({
      property_id: pid,
      old_address: p.address, new_address: c.m.addr,
      old_city: p.city, new_city: c.m.city,
      old_state: p.state, new_state: c.m.state,
      city_verdict: cv, clinic_cities: [...cms],
      master_cap_pct: Number((c.m.cap * 100).toFixed(3)),
      fingerprint_source: c.fp_source, fingerprint_bp_delta: c.fp_bp,
      calc_cap_delta_bp: c.calc_delta_bp,
      master_sale_date: c.master_sale_date, master_sold_price: c.master_sold_price,
      has_lat_will_null: !!p.has_lat,
      source_sales: list.map(x => x.sale_id),
    });
  }

  // summary
  const sc = {}; for (const s of skips) sc[s.reason] = (sc[s.reason] || 0) + 1;
  const summary = { generated_at: new Date().toISOString(), mode: OFFLINE ? 'offline' : 'live', committed: COMMIT,
    master_linked_sales: sales.length, candidate_props: byProp.size, writes: writes.length, skips_by_reason: sc };
  console.log('\n[addr-backfill] SUMMARY'); console.log(JSON.stringify(summary, null, 2));

  if (COMMIT) {
    let ok = 0;
    for (const w of writes) {
      await rest('PATCH', `properties?property_id=eq.${w.property_id}`, {
        address: w.new_address, city: w.new_city, state: w.new_state,
        latitude: null, longitude: null, address_source: 'master_curated',
      });
      ok++;
    }
    console.log(`[addr-backfill] COMMITTED ${ok} address rewrites (lat/lng nulled -> geocode cron re-runs).`);
  } else {
    console.log('[addr-backfill] DRY RUN — no writes. Re-run with --commit after sample-verifying the plan.');
  }
  writeFileSync(OUT, JSON.stringify({ summary, writes, skips }, null, 2));
  console.log(`[addr-backfill] plan -> ${OUT}`);
})().catch(e => { console.error('[addr-backfill] FATAL', e); process.exit(1); });
