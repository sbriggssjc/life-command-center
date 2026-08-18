#!/usr/bin/env node
/**
 * P136 — load "Dialysis Ownership MASTER.xlsx" (Ownership sheet) into
 * lcc_dia_ownership_master (staging, lossless, no interpretation).
 *
 * WHY THIS FILE MATTERS MORE THAN THE NOTE RECORDS (P129)
 *   The note export carried a note TITLE and nothing else, so a row asserted
 *   "this party touched this property" with no role and no hard key. P134
 *   measured the consequence: ~10% contact hit rate, 0 of 236 supersession ties
 *   broken. This workbook fixes BOTH defects:
 *
 *     * CMS Medicare ID (CCN) -> a hard join to dia.medicare_clinics. Not a
 *       name heuristic, so none of the P116/P130/P135 name-matching traps apply.
 *     * ROLE is already separated into columns -- Recorded / Owner / Previous /
 *       Developer -- by the people who did the research.
 *
 *   Measured on the 2026-08-18 copy (8,909 rows, 3,283 with ownership content):
 *     recorded owner   3,079    true/beneficial owner   2,376
 *     previous owner     555    developer                 336
 *     beneficial owners that look like PEOPLE:  1,349 distinct / 1,589 CCNs
 *     pipe-delimited "SPE | principal" values:    335
 *     DATED previous -> owner transitions:        423
 *
 * WHAT THIS DOES NOT DO, ON PURPOSE
 *   * does not mint entities
 *   * does not write lcc_property_owner / lcc_property_owner_evidence
 *   * does not create contacts, edges or cadences
 *   * does not resolve the pipe-delimited multi-party values
 *   Staging is lossless and uninterpreted; promotion happens in reviewable
 *   passes, exactly as with the note records. In particular "Previous" is a
 *   PRIOR owner and must never reach lcc_property_owner as a current one (P113).
 *
 * Usage (from the repo root -- reads .env.local for the ops keys):
 *   node scripts/load-dia-ownership-master.mjs \
 *     "C:\\Users\\scott\\OneDrive - NorthMarq Capital, LLC\\Team Briggs - Documents\\Dialysis Research\\Dialysis Ownership MASTER.xlsx"
 *
 * Idempotent via the unique index on
 * (batch_tag, medicare_ccn, coalesce(recorded_owner,''), coalesce(true_owner,'')).
 * Reverse with:
 *   DELETE FROM lcc_dia_ownership_master WHERE batch_tag = 'dia_ownership_master';
 */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

function loadEnvLocal() {
  for (const f of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
    return f;
  }
  return null;
}
const envFile = loadEnvLocal();

const URL = process.env.OPS_SUPABASE_URL;
const KEY = process.env.OPS_SUPABASE_KEY;
if (!URL || !KEY) {
  console.error('Missing OPS_SUPABASE_URL / OPS_SUPABASE_KEY.');
  console.error(envFile ? `Read ${envFile} but those keys were not in it.`
                        : 'No .env.local found - run this from the repo root.');
  process.exit(1);
}
console.log(`ops: ${URL.replace(/^https:\/\//, '').split('.')[0]}  (env: ${envFile || 'process env'})`);

const BATCH_TAG = process.env.BATCH_TAG || 'dia_ownership_master';
const CHUNK = Number(process.env.CHUNK || 500);

// The sheet has a blank spacer row above the header, so the header is row 2.
const HEADER_ROW = Number(process.env.HEADER_ROW || 2);

// Excel leaves a lot of "empty but not null" cells in this workbook.
const BLANK = new Set(['', '-', '—', '#N/A', '#REF!', 'N/A', 'NA', 'TBD', '?']);
const txt = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return BLANK.has(s) ? null : s;
};
const ymd = (v) => {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = txt(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);   // 3/18/2021
  if (us) return `${us[3]}-${String(us[1]).padStart(2, '0')}-${String(us[2]).padStart(2, '0')}`;
  return null;                                                  // never guessed
};
const num = (v) => {
  const s = txt(v);
  if (s === null) return null;
  const n = Number(s.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
};
// CCNs are 6 chars with meaningful LEADING ZEROS ("012505"). Excel stores some
// as numbers, which drops them -- pad rather than lose the join key.
const ccn = (v) => {
  const s = txt(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  return digits ? digits.padStart(6, '0') : null;
};

const file = process.argv[2];
if (!file) { console.error('Pass the path to Dialysis Ownership MASTER.xlsx'); process.exit(1); }

const wb = XLSX.readFile(file, { cellDates: true });
const sheet = wb.Sheets['Ownership'] || wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, range: HEADER_ROW - 1 });

const staged = rows.map((r) => ({
  medicare_ccn:    ccn(r['Medicare ID']),
  operator:        txt(r['Operator']),
  address:         txt(r['Address']),
  city:            txt(r['City']),
  state:           txt(r['State']),
  recorded_owner:  txt(r['Recorded']),
  true_owner:      txt(r['Owner']),
  previous_owner:  txt(r['Previous']),
  developer:       txt(r['Developer']),
  last_sale_date:  ymd(r['Last Sale']),
  last_sale_price: num(r['Price']),
  cap_rate:        num(r['Cap']),
  batch_tag:       BATCH_TAG,
}))
  // A row with a CCN but no party tells us nothing we do not already have from
  // CMS. Value-gate at the door rather than staging 5,600 empty rows.
  .filter((x) => x.medicare_ccn
    && (x.recorded_owner || x.true_owner || x.previous_owner || x.developer));

const c = (k) => staged.filter((x) => x[k]).length;
console.log(`${rows.length} sheet rows -> ${staged.length} with ownership content`);
console.log(`  recorded ${c('recorded_owner')}  owner ${c('true_owner')}  `
          + `previous ${c('previous_owner')}  developer ${c('developer')}  `
          + `sale-dated ${c('last_sale_date')}`);

let inserted = 0, failed = 0;
for (let i = 0; i < staged.length; i += CHUNK) {
  const chunk = staged.slice(i, i + CHUNK);
  const res = await fetch(`${URL}/rest/v1/lcc_dia_ownership_master`, {
    method: 'POST',
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=ignore-duplicates',
    },
    body: JSON.stringify(chunk),
  });
  if (res.ok) { inserted += chunk.length; }
  else { failed += chunk.length; console.error(`chunk ${i}: ${res.status} ${(await res.text()).slice(0, 300)}`); }
  process.stdout.write(`\r  sent ${inserted + failed}/${staged.length}`);
}
console.log(`\ndone: sent ${inserted}, failed ${failed}, batch_tag='${BATCH_TAG}'`);
