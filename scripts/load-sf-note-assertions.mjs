#!/usr/bin/env node
/**
 * P129 — load the Salesforce note-record exports into
 * lcc_sf_note_property_assertion (staging, lossless, no interpretation).
 *
 * WHY A SCRIPT AND NOT A MIGRATION: 34,001 rows is ~6.3 MB of INSERT text.
 * That belongs in a batched loader run from a machine that has the env, not in
 * a migration file or a chat tool call.
 *
 * WHAT THIS DOES NOT DO, ON PURPOSE:
 *   * does not mint entities
 *   * does not create owner edges or cadences
 *   * does not decide whether a party OWNS, DEVELOPED or BROKERED the property
 * The export carries only the note TITLE. Scott: notes are "tagged to any
 * current or prior owner, developer and sometimes brokers ... but most often is
 * just the notes on the contact's specific ownership". Role is therefore
 * UNKNOWABLE from this file, and asserting ownership here would repeat the P116
 * brokerage-as-owner and P113 prior-vs-current traps at 19,565-row scale.
 *
 * Title parsing is best-effort and allowed to fail: 86.8% match
 * "Tenant - City, ST" (after stripping trailing status suffixes like "- SOLD"
 * and accepting "Tenant, City, ST"). The remaining ~4,479 are genuinely varied
 * -- portfolios, multi-property, "Untitled Note" -- and are left NULL rather
 * than forced into a shape they do not have.
 *
 * Usage:
 *   OPS_SUPABASE_URL=... OPS_SUPABASE_KEY=... \
 *   node scripts/load-sf-note-assertions.mjs \
 *     "path/to/Note Records - Contact - Team Briggs.xlsx" \
 *     "path/to/Note Records - Company - Team Briggs.xlsx"
 *
 * Idempotent: ON CONFLICT (sf_party_id, note_id) DO NOTHING, so re-running is
 * safe. Reverse with:
 *   DELETE FROM lcc_sf_note_property_assertion WHERE batch_tag = 'notes_2024';
 */
import fs from 'node:fs';
import XLSX from 'xlsx';

const URL = process.env.OPS_SUPABASE_URL;
const KEY = process.env.OPS_SUPABASE_KEY;
if (!URL || !KEY) { console.error('Set OPS_SUPABASE_URL and OPS_SUPABASE_KEY'); process.exit(1); }

const BATCH_TAG = process.env.BATCH_TAG || 'notes_2024';
const CHUNK = Number(process.env.CHUNK || 500);

// "Tenant - City, ST" is the dominant shape. Strip trailing deal-status
// suffixes first ("- SOLD", "- Under Contract"), then try dash, then comma.
const STATUS = /\s*[-–]\s*(SOLD|Sold|sold|Under Contract|UC|Closed|LOI|Dead|On Hold)\s*$/;
const DASH   = /^(.+?)\s*[-–]\s*([^,\-]+?),\s*([A-Z]{2})\.?$/;
const COMMA  = /^(.+?),\s*([^,]+?),\s*([A-Z]{2})\.?$/;

function parseTitle(raw) {
  if (!raw) return [null, null, null];
  let s = String(raw).trim(), prev = null;
  while (prev !== s) { prev = s; s = s.replace(STATUS, '').trim(); }
  for (const rx of [DASH, COMMA]) {
    const m = s.match(rx);
    if (m) return [m[1].trim(), m[2].trim(), m[3].trim()];
  }
  return [null, null, null];   // a real tail; never forced
}

function readSheet(path, kind) {
  const wb = XLSX.readFile(path, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10)
                     : (typeof d === 'string' && d.length >= 10 ? d.slice(0, 10) : null));
  return rows.map((r) => {
    const idKey    = Object.keys(r).find((k) => /^(Contact|Company) ID/i.test(k));
    const nameKey  = Object.keys(r).find((k) => /^(Contact|Company) Name/i.test(k));
    const authKey  = Object.keys(r).find((k) => /^Note Created ?By/i.test(k));
    const createdK = Object.keys(r).find((k) => /^Note Created Date/i.test(k));
    const modK     = Object.keys(r).find((k) => /^Note Last Modified/i.test(k));
    const [tenant, city, state] = parseTitle(r['Note Title']);
    return {
      party_kind: kind,
      sf_party_id: r[idKey] ? String(r[idKey]).trim() : null,
      party_name: r[nameKey] ?? null,
      note_id: r['Note ID'] ? String(r['Note ID']).trim() : null,
      note_title: r['Note Title'] ?? null,
      note_author: r[authKey] ?? null,
      note_created_at: ymd(r[createdK]),
      note_modified_at: ymd(r[modK]),
      parsed_tenant: tenant, parsed_city: city, parsed_state: state,
      batch_tag: BATCH_TAG,
    };
  }).filter((x) => x.sf_party_id && x.note_id);
}

const files = process.argv.slice(2);
if (!files.length) { console.error('Pass the two xlsx paths'); process.exit(1); }

let all = [];
for (const f of files) {
  const kind = /contact/i.test(f) ? 'contact' : 'company';
  const rows = readSheet(f, kind);
  const parsed = rows.filter((r) => r.parsed_tenant).length;
  console.log(`${kind.padEnd(8)} ${String(rows.length).padStart(6)} rows  ${parsed} parsed (${(100*parsed/rows.length).toFixed(1)}%)  ${f.split(/[\\/]/).pop()}`);
  all = all.concat(rows);
}

let inserted = 0, failed = 0;
for (let i = 0; i < all.length; i += CHUNK) {
  const chunk = all.slice(i, i + CHUNK);
  const res = await fetch(`${URL}/rest/v1/lcc_sf_note_property_assertion?on_conflict=sf_party_id,note_id`, {
    method: 'POST',
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(chunk),
  });
  if (res.ok) { inserted += chunk.length; }
  else { failed += chunk.length; console.error(`chunk ${i}: ${res.status} ${(await res.text()).slice(0, 200)}`); }
  process.stdout.write(`\r  ${Math.min(i + CHUNK, all.length)}/${all.length}`);
}
console.log(`\nsent ${inserted}, failed ${failed}. Verify:
  select count(*), count(parsed_tenant) parsed, count(distinct sf_party_id) parties
    from lcc_sf_note_property_assertion where batch_tag = '${BATCH_TAG}';`);
