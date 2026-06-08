// scripts/sf-nm-dryrun.mjs
// ============================================================================
// Round 74 Task 3 — one-shot SF→NM classification dry-run.
//
// Runs the durable classifier (api/_shared/sf-nm-classifier.js) over a CSV
// export of the Salesforce closed-won deal universe (Scott's data.xlsx, saved
// as CSV) and prints the classification plan: per-vertical counts, the NM-listed
// vs buy-side split, the non-comp (referral/fee/portfolio) exclusions, and the
// NM-vs-market cap averages. NO database writes — this is the gate input Scott
// verifies before any flag flip.
//
// Usage:
//   node scripts/sf-nm-dryrun.mjs path/to/sf_export.csv [--json out.json]
//
// To produce the CSV from data.xlsx:
//   (any spreadsheet) Save As → CSV, OR
//   python3 -c "import openpyxl,csv,sys; wb=openpyxl.load_workbook('data.xlsx',data_only=True); ws=wb['Export']; w=csv.writer(open('sf_export.csv','w',newline='')); [w.writerow(r) for r in ws.iter_rows(values_only=True)]"
// ============================================================================

import fs from 'node:fs';
import { classifyDeal, normalizeDealRow } from '../api/_shared/sf-nm-classifier.js';

function parseCsv(text) {
  // Minimal RFC-4180-ish parser (handles quoted fields w/ commas + newlines).
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csvPath = process.argv[2];
if (!csvPath) { console.error('usage: node scripts/sf-nm-dryrun.mjs <export.csv> [--json out.json]'); process.exit(1); }
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const rows = parseCsv(fs.readFileSync(csvPath, 'utf8')).filter((r) => r.some((c) => String(c).trim()));
const headers = rows[0];
const data = rows.slice(1);

const verdicts = data.map((r) => classifyDeal(normalizeDealRow(r, headers)));

const by = (pred) => verdicts.filter(pred);
const caps = (arr) => {
  const xs = arr.map((v) => v.cap_rate).filter((x) => x != null && x > 0 && x < 30);
  if (!xs.length) return null;
  return +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3);
};

const plan = {
  generated_at: new Date().toISOString(),
  source: csvPath,
  total_rows: verdicts.length,
  vertical: {
    dia: by((v) => v.vertical === 'dia').length,
    gov: by((v) => v.vertical === 'gov').length,
    unclassified: by((v) => v.vertical === null).length,
  },
  nm_listing: {
    nm_listed: by((v) => v.is_northmarq).length,
    buyside_only: by((v) => v.is_northmarq_buyside).length,
    neither: by((v) => !v.is_northmarq && !v.is_northmarq_buyside).length,
  },
  comps: {
    real_single_asset: by((v) => v.is_comp).length,
    excluded_non_comp: by((v) => !v.is_comp).length,
  },
  // The #20 chart cohorts (NM-listed vs everything-else), cap-rate averages:
  cap_rate_avgs: {
    nm_listed: caps(by((v) => v.is_northmarq && v.is_comp)),
    market_non_nm: caps(by((v) => !v.is_northmarq && v.is_comp)),
  },
};

console.log(JSON.stringify(plan, null, 2));

// 30-row add/remove samples for the gate (add = would-flag NM-listed comps).
const addSample = by((v) => v.is_northmarq && v.is_comp).slice(0, 30)
  .map((v) => ({ sf_id: v.sf_id, deal_name: v.deal_name, state: v.state, close_date: v.close_date, sale_price: v.sale_price, vertical: v.vertical, reason: v.nm_reason }));
const buyideSample = by((v) => v.is_northmarq_buyside).slice(0, 15)
  .map((v) => ({ deal_name: v.deal_name, reason: v.nm_reason }));
const excludeSample = by((v) => !v.is_comp).slice(0, 30)
  .map((v) => ({ deal_name: v.deal_name, reasons: v.exclude_reasons }));

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ plan, addSample, buyideSample, excludeSample, verdicts }, null, 2));
  console.error(`\n[wrote ${jsonOut} — ${verdicts.length} verdicts]`);
}
