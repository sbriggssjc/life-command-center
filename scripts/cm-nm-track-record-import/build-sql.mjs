import * as XLSX from 'xlsx';
import fs from 'fs';

function excelDate(s) {
  if (s == null || isNaN(s)) return null;
  return new Date(Math.round((s - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
}
function sqlStr(s) { if (s == null) return 'null'; return "'" + String(s).replace(/'/g, "''") + "'"; }
function sqlNum(s) { if (s == null || isNaN(s)) return 'null'; return String(Number(s)); }
function sqlDate(s) { if (s == null) return 'null'; return "'" + s + "'::date"; }

const dia = XLSX.utils.sheet_to_json(
  XLSX.read(fs.readFileSync('C:/Users/scott/Downloads/data.xlsx')).Sheets['Export'],
  { defval: null }
).filter(r => r['SALES PRICE'] > 0 && r['CLOSE DATE'] && r.CITY && r.STATE);

const gov = XLSX.utils.sheet_to_json(
  XLSX.read(fs.readFileSync('C:/Users/scott/Downloads/SJC Gov Track Record.xlsx')).Sheets['report1484843441869'],
  { defval: null }
).filter(r => r['Sales Price'] > 0 && r.City && r.State);

// Build VALUES rows: (deal_name, city, state, sold_price, close_date)
const diaValues = dia.map((r, i) =>
  `(${i+1}, ${sqlStr(r['DEAL NAME'])}, ${sqlStr(r.CITY)}, ${sqlStr(r.STATE)}, ${sqlNum(r['SALES PRICE'])}, ${sqlDate(excelDate(r['CLOSE DATE']))})`
);
const govValues = gov.map((r, i) =>
  `(${i+1}, ${sqlStr(r['Deal: Broker Deal Name'])}, ${sqlStr(r.City)}, ${sqlStr(r.State)}, ${sqlNum(r['Sales Price'])}, null::date)`
);

fs.writeFileSync('scripts/cm-nm-track-record-import/dia-values.sql', diaValues.join(',\n'));
fs.writeFileSync('scripts/cm-nm-track-record-import/gov-values.sql', govValues.join(',\n'));
console.log(`Wrote ${diaValues.length} dia rows, ${govValues.length} gov rows`);
