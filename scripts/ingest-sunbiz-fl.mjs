#!/usr/bin/env node
// ============================================================================
// ingest-sunbiz-fl.mjs  (free SOS-direct LLC research, part b) — 2026-05-31
// ----------------------------------------------------------------------------
// Parses a Florida Sunbiz Corporate Data File (fixed-width ASCII .txt) and
// loads it into public.sos_fl_entities on LCC Opps, where the lookupLlc FL
// adapter reads it. Compliant + free: the file is the State's own published
// bulk download (dos.fl.gov .../corporate-data-file), no scraping, no anti-bot.
//
// USAGE:
//   1. Download the file from the Sunbiz Data Access Portal (public creds on
//      the download page). Files are named CCYYMMDDx.txt.
//   2. node scripts/ingest-sunbiz-fl.mjs <path-to-file.txt>
//
// ENV (LCC Opps):
//   OPS_SUPABASE_URL, OPS_SUPABASE_SERVICE_KEY
//
// Record layout (1-based start positions, lengths) from the State's
// file-structure page. JS slice is 0-based half-open, so col(start,len) =
// line.slice(start-1, start-1+len).
// ============================================================================
import fs from 'node:fs';
import readline from 'node:readline';

const FILES = process.argv.slice(2);
const ACTIVE_LLC_ONLY = process.env.SUNBIZ_ACTIVE_LLC_ONLY === '1';
const OPS_URL = process.env.OPS_SUPABASE_URL;
const OPS_KEY = process.env.OPS_SUPABASE_SERVICE_KEY;

if (!FILES.length) { console.error('Usage: node scripts/ingest-sunbiz-fl.mjs <file.txt> [more...]  (SUNBIZ_ACTIVE_LLC_ONLY=1 for active LLCs only)'); process.exit(1); }
if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS_SUPABASE_URL / OPS_SUPABASE_SERVICE_KEY'); process.exit(1); }
for (const f of FILES) { if (!fs.existsSync(f)) { console.error('File not found: ' + f); process.exit(1); } }

const col = (line, start, len) => line.slice(start - 1, start - 1 + len).trim();

// Suffix/punctuation strip, mirroring the kind of normalization the rest of
// the codebase uses for owner names, so the adapter's name_norm match lines up.
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,'"]/g, '')
    .replace(/\b(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|lp|llp|ltd|limited|trust|holdings|partners|partnership)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseFileDate(raw) {
  // Sunbiz File Date is MMDDYYYY (e.g. 11301992 = 1992-11-30), NOT CCYYMMDD.
  // Convert to ISO YYYY-MM-DD; anything malformed or out-of-range -> null so a
  // single bad value never 400s the batch.
  const v = String(raw || '').trim();
  if (!/^\d{8}$/.test(v) || v === '00000000') return null;
  const mm = +v.slice(0, 2), dd = +v.slice(2, 4), yyyy = +v.slice(4, 8);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1800 || yyyy > 2200) return null;
  return `${yyyy}-${v.slice(0, 2)}-${v.slice(2, 4)}`;
}

function parseOfficers(line) {
  // 6 officers, each a 4-len title + 1-len type + 42 name + 42 addr + 28 city
  // + 2 state + 9 zip, starting at field 37 (pos 669).
  const officers = [];
  const starts = [669, 797, 925, 1053, 1181, 1309];
  for (const s of starts) {
    const title = col(line, s, 4);
    const type  = col(line, s + 4, 1);
    const name  = col(line, s + 5, 42);
    if (!name) continue;
    officers.push({
      title, type, name,
      address: col(line, s + 47, 42),
      city:    col(line, s + 89, 28),
      state:   col(line, s + 117, 2),
      zip:     col(line, s + 119, 9),
    });
  }
  return officers;
}

function parseRow(line) {
  if (line.length < 545) return null; // too short to hold the RA block — skip junk lines
  const corp_number = col(line, 1, 12);
  const corp_name   = col(line, 13, 192);
  if (!corp_number || !corp_name) return null;
  const _status = col(line, 205, 1);
  const _ftype  = col(line, 206, 15);
  if (ACTIVE_LLC_ONLY && !(_status === 'A' && (_ftype === 'FLAL' || _ftype === 'FORL'))) return null;
  const officers = parseOfficers(line);
  const o1 = officers[0] || {};
  return {
    corp_number,
    corp_name,
    status:        _status || null,
    filing_type:   _ftype || null,
    file_date:     parseFileDate(col(line, 473, 8)),
    ra_name:       col(line, 545, 42) || null,
    ra_type:       col(line, 587, 1) || null,
    ra_address:    col(line, 588, 42) || null,
    ra_city:       col(line, 630, 28) || null,
    ra_state:      col(line, 658, 2) || null,
    ra_zip:        col(line, 660, 9) || null,
    officer1_title: o1.title || null,
    officer1_name:  o1.name || null,
    officers_json:  officers,
    name_norm:      normName(corp_name),
    source_file:    CURRENT_FILE.split(/[\\/]/).pop(),
  };
}

async function flush(batch) {
  const res = await fetch(`${OPS_URL}/rest/v1/sos_fl_entities?on_conflict=corp_number`, {
    method: 'POST',
    headers: {
      apikey: OPS_KEY,
      Authorization: `Bearer ${OPS_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(batch),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`upsert failed ${res.status}: ${t.slice(0, 300)}`);
  }
}

let CURRENT_FILE = null;
(async () => {
  let total = 0, skipped = 0;
  const BATCH = 500;
  if (ACTIVE_LLC_ONLY) console.log('Filter: ACTIVE LLC filings only (status=A, type FLAL/FORL).');
  for (const f of FILES) {
    CURRENT_FILE = f;
    console.log('Ingesting ' + f + ' ...');
    const rl = readline.createInterface({ input: fs.createReadStream(f, 'latin1'), crlfDelay: Infinity });
    let batch = [];
    for await (const line of rl) {
      const row = parseRow(line);
      if (!row) { skipped++; continue; }
      batch.push(row);
      if (batch.length >= BATCH) { await flush(batch); total += batch.length; batch = []; if (total % 50000 === 0) console.log(`  ${total} upserted...`); }
    }
    if (batch.length) { await flush(batch); total += batch.length; batch = []; }
  }
  console.log(`Done. Upserted ${total} FL entities (${skipped} skipped/filtered). Mirror: public.sos_fl_entities on LCC Opps.`);
})().catch(e => { console.error('Ingest failed:', e.message); process.exit(1); });
