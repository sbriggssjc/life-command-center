import * as XLSX from 'xlsx';
import fs from 'fs';
import { domainQuery } from '../../api/_shared/domain-db.js';

// Excel serial → 'YYYY-MM-DD'
function excelDate(s) {
  if (s == null || isNaN(s)) return null;
  return new Date(Math.round((s - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
}

function normCity(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function normState(s) {
  return String(s || '').toUpperCase().slice(0, 2);
}

// ─────────────────────────────────────────────────────────────
// Load track-record rows
// ─────────────────────────────────────────────────────────────
const dia = XLSX.utils.sheet_to_json(
  XLSX.read(fs.readFileSync('C:/Users/scott/Downloads/data.xlsx')).Sheets['Export'],
  { defval: null }
).filter(r => r['SALES PRICE'] > 0 && r['CLOSE DATE'] && r.CITY && r.STATE)
 .map((r, i) => ({
   src_row: i + 2,
   deal_name: r['DEAL NAME'],
   city: r.CITY, state: r.STATE,
   city_norm: normCity(r.CITY), state_norm: normState(r.STATE),
   sold_price: Number(r['SALES PRICE']),
   close_date: excelDate(r['CLOSE DATE']),
   tenant: r.TENANT, team: r.TEAM, lead_broker: r['LEAD BROKER'],
   building_sf: Number(r['BUILDING SF']) || null,
   cap_rate: r['CAP RATE'],
 }));

const gov = XLSX.utils.sheet_to_json(
  XLSX.read(fs.readFileSync('C:/Users/scott/Downloads/SJC Gov Track Record.xlsx')).Sheets['report1484843441869'],
  { defval: null }
).filter(r => r['Sales Price'] > 0 && r.City && r.State)
 .map((r, i) => ({
   src_row: i + 2,
   deal_name: r['Deal: Broker Deal Name'],
   city: r.City, state: r.State,
   city_norm: normCity(r.City), state_norm: normState(r.State),
   sold_price: Number(r['Sales Price']),
   building_sf: Number(r['Building Size (SF)']) || null,
   cap_rate: Number(r['Cap Rate']) || null,
   tenant: r['Property Tenant'], government: r.Government, team: r['Broker Team'],
 }));

console.log(`DIA track-record candidates: ${dia.length}`);
console.log(`GOV track-record candidates: ${gov.length}`);

// ─────────────────────────────────────────────────────────────
// Fetch sales_transactions snapshots from each DB
// ─────────────────────────────────────────────────────────────
async function fetchAllSales(domain) {
  const path = 'sales_transactions?select=sale_id,sale_date,sold_price,city,state,property_id&sold_price=gt.0&sale_date=not.is.null';
  const r = await domainQuery(domain, 'GET', path);
  return r.ok ? r.data : [];
}

const diaSales = await fetchAllSales('dialysis');
const govSales = await fetchAllSales('government');
console.log(`DIA sales rows fetched: ${diaSales.length}`);
console.log(`GOV sales rows fetched: ${govSales.length}`);

// Index by city_norm + state_norm
function indexByCityState(rows) {
  const m = new Map();
  for (const s of rows) {
    const k = `${normCity(s.city)}|${normState(s.state)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  return m;
}
const diaIdx = indexByCityState(diaSales);
const govIdx = indexByCityState(govSales);

// ─────────────────────────────────────────────────────────────
// Match: city+state, then price ±2%, then date (dia) or SF (gov)
// ─────────────────────────────────────────────────────────────
function matchDia(track) {
  const k = `${track.city_norm}|${track.state_norm}`;
  const candidates = diaIdx.get(k) || [];
  if (!candidates.length) return { match: null, reason: 'no_city_state' };
  const trackTime = new Date(track.close_date).getTime();

  let best = null, bestScore = -Infinity;
  for (const c of candidates) {
    const priceDiff = Math.abs(Number(c.sold_price) - track.sold_price) / track.sold_price;
    if (priceDiff > 0.05) continue;  // >5% price gap = reject
    const dateGapDays = Math.abs((new Date(c.sale_date).getTime() - trackTime) / 86400000);
    if (dateGapDays > 90) continue;  // >90 days = reject
    const score = (1 - priceDiff) * 100 + (1 - dateGapDays / 90) * 50;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best
    ? { match: best, reason: 'matched', priceDiff: Math.abs(Number(best.sold_price) - track.sold_price) / track.sold_price, dateGap: Math.round(Math.abs((new Date(best.sale_date).getTime() - trackTime) / 86400000)) }
    : { match: null, reason: 'no_price_date_match' };
}

function matchGov(track) {
  const k = `${track.city_norm}|${track.state_norm}`;
  const candidates = govIdx.get(k) || [];
  if (!candidates.length) return { match: null, reason: 'no_city_state' };

  let best = null, bestScore = -Infinity;
  for (const c of candidates) {
    const priceDiff = Math.abs(Number(c.sold_price) - track.sold_price) / track.sold_price;
    if (priceDiff > 0.05) continue;
    // No close date — no time-based filter. But require tighter price match.
    const score = (1 - priceDiff) * 100;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best
    ? { match: best, reason: 'matched', priceDiff: Math.abs(Number(best.sold_price) - track.sold_price) / track.sold_price }
    : { match: null, reason: 'no_price_match' };
}

let dia_matched = 0, dia_no_city = 0, dia_no_match = 0;
const dia_match_log = [];
for (const t of dia) {
  const r = matchDia(t);
  if (r.match) { dia_matched++; dia_match_log.push({ track: t.deal_name, sale_id: r.match.sale_id, sale_date: r.match.sale_date, priceDiff: (r.priceDiff * 100).toFixed(2) + '%', dateGap: r.dateGap + 'd' }); }
  else if (r.reason === 'no_city_state') dia_no_city++;
  else dia_no_match++;
}
console.log(`\n=== DIALYSIS ===`);
console.log(`Matched: ${dia_matched} / ${dia.length} (${(dia_matched/dia.length*100).toFixed(1)}%)`);
console.log(`No city/state in sales: ${dia_no_city}`);
console.log(`City/state present but no price+date match: ${dia_no_match}`);
console.log(`Sample matches:`);
for (const m of dia_match_log.slice(0, 10)) console.log(`  ${m.track} → sale_id=${m.sale_id} ${m.sale_date} (priceDiff ${m.priceDiff}, dateGap ${m.dateGap})`);

let gov_matched = 0, gov_no_city = 0, gov_no_match = 0;
const gov_match_log = [];
for (const t of gov) {
  const r = matchGov(t);
  if (r.match) { gov_matched++; gov_match_log.push({ track: t.deal_name, sale_id: r.match.sale_id, sale_date: r.match.sale_date, priceDiff: (r.priceDiff * 100).toFixed(2) + '%' }); }
  else if (r.reason === 'no_city_state') gov_no_city++;
  else gov_no_match++;
}
console.log(`\n=== GOVERNMENT ===`);
console.log(`Matched: ${gov_matched} / ${gov.length} (${(gov_matched/gov.length*100).toFixed(1)}%)`);
console.log(`No city/state in sales: ${gov_no_city}`);
console.log(`City/state present but no price match: ${gov_no_match}`);
console.log(`Sample matches:`);
for (const m of gov_match_log.slice(0, 10)) console.log(`  ${m.track} → sale_id=${m.sale_id} ${m.sale_date} (priceDiff ${m.priceDiff})`);
