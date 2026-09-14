#!/usr/bin/env node
/**
 * P136b — resolve lcc_dia_ownership_master.medicare_ccn -> dia property_id.
 *
 * WHY A SCRIPT: this is a CROSS-PROJECT join. The workbook is staged in LCC Opps;
 * the CCN -> property_id map lives in Dialysis_DB. No single SQL statement can
 * see both, so the bridge is built over REST from a machine that holds both keys.
 *
 * WHY IT IS NEEDED AT ALL (measured 2026-08-18): the CCN is a perfect key into
 * dia and a nearly empty one into LCC -- only 115 of 3,236 workbook CCNs resolve
 * through external_identities(source_system='cms', source_type='medicare_ccn'),
 * because LCC holds just 345 CMS identities against ~11.8k dia clinics. The
 * canonical identity scheme reserves that slot; nothing ever filled it.
 *
 * DISCIPLINE
 *   * fill-blanks: only writes rows whose source_property_id IS NULL
 *   * never guesses: a CCN unknown to dia is stamped 'no_clinic', a clinic with
 *     no property_id is stamped 'no_property'. Unresolved stays VISIBLY
 *     unresolved rather than silently absent.
 *   * skips dedup_status='demoted_duplicate' clinics (dia doctrine)
 *   * idempotent -- re-running resolves only what is still unlinked
 *   * asserts nothing about ownership; this says only "this row is about that
 *     property"
 *
 * Usage (repo root, reads .env.local):
 *   node scripts/resolve-dia-ownership-property-ids.mjs           # dry run
 *   node scripts/resolve-dia-ownership-property-ids.mjs --apply
 *
 * Needs OPS_SUPABASE_URL/KEY and DIA_SUPABASE_URL + DIA_SUPABASE_SERVICE_KEY
 * (falls back to DIA_SUPABASE_KEY).
 */
import fs from 'node:fs';
import path from 'node:path';

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

const OPS_URL = process.env.OPS_SUPABASE_URL;
const OPS_KEY = process.env.OPS_SUPABASE_KEY;
const DIA_URL = process.env.DIA_SUPABASE_URL;
const DIA_KEY = process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY;
const missing = [
  !OPS_URL && 'OPS_SUPABASE_URL', !OPS_KEY && 'OPS_SUPABASE_KEY',
  !DIA_URL && 'DIA_SUPABASE_URL', !DIA_KEY && 'DIA_SUPABASE_SERVICE_KEY/DIA_SUPABASE_KEY',
].filter(Boolean);
if (missing.length) {
  console.error(`Missing: ${missing.join(', ')}`);
  console.error(envFile ? `Read ${envFile} but those keys were not in it.` : 'No .env.local found.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const BATCH_TAG = process.env.BATCH_TAG || 'dia_ownership_master';
console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}  ops=${OPS_URL.replace(/^https:\/\//, '').split('.')[0]}  `
          + `dia=${DIA_URL.replace(/^https:\/\//, '').split('.')[0]}`);

const get = async (base, key, qs) => {
  const r = await fetch(`${base}/rest/v1/${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

// ---- 1. the unlinked staged CCNs -------------------------------------------
// PostgREST caps every response at 1000 rows regardless of limit (CLAUDE.md), so
// page at exactly 1000 or rows are silently skipped.
const PAGE = 1000;
let staged = [];
for (let off = 0; ; off += PAGE) {
  const p = await get(OPS_URL, OPS_KEY,
    `lcc_dia_ownership_master?select=id,medicare_ccn&batch_tag=eq.${BATCH_TAG}`
    + `&source_property_id=is.null&order=id.asc&limit=${PAGE}&offset=${off}`);
  staged = staged.concat(p);
  if (p.length < PAGE) break;
}
const ccns = [...new Set(staged.map((r) => r.medicare_ccn))];
console.log(`staged rows needing a link: ${staged.length}  (${ccns.length} distinct CCNs)`);
if (!staged.length) { console.log('nothing to do'); process.exit(0); }

// ---- 2. dia's CCN -> property_id map ---------------------------------------
const map = new Map();          // ccn -> property_id
const seenCcn = new Set();      // ccn known to dia at all (even without a property)
const IN = 300;                 // keep the URL well under any gateway limit
for (let i = 0; i < ccns.length; i += IN) {
  const slice = ccns.slice(i, i + IN);
  const rows = await get(DIA_URL, DIA_KEY,
    `medicare_clinics?select=medicare_id,property_id,dedup_status`
    + `&medicare_id=in.(${slice.map((c) => `"${c}"`).join(',')})&limit=${PAGE}`);
  for (const r of rows) {
    if (r.dedup_status === 'demoted_duplicate') continue;   // dia doctrine
    seenCcn.add(String(r.medicare_id));
    if (r.property_id != null && !map.has(String(r.medicare_id))) {
      map.set(String(r.medicare_id), String(r.property_id));
    }
  }
  process.stdout.write(`\r  dia lookup ${Math.min(i + IN, ccns.length)}/${ccns.length}`);
}
console.log();

const plan = staged.map((r) => ({
  id: r.id,
  source_property_id: map.get(r.medicare_ccn) ?? null,
  property_link_status: map.has(r.medicare_ccn) ? 'linked'
                       : seenCcn.has(r.medicare_ccn) ? 'no_property' : 'no_clinic',
}));
const n = (s) => plan.filter((p) => p.property_link_status === s).length;
console.log(`  linked ${n('linked')}   no_property ${n('no_property')}   no_clinic ${n('no_clinic')}`);
console.log(`  distinct dia properties reached: ${new Set(plan.map((p) => p.source_property_id).filter(Boolean)).size}`);

if (!APPLY) { console.log('\ndry run — re-run with --apply to write'); process.exit(0); }

// ---- 3. write back ----------------------------------------------------------
// Via RPC, not a PostgREST upsert: Postgres evaluates NOT NULL before ON
// CONFLICT, so a {id, source_property_id, property_link_status} payload 23502s
// on medicare_ccn/batch_tag before merge-duplicates can fire. The RPC is
// fill-blanks, so a hand-corrected link is never clobbered by a re-run.
let updated = 0, bad = 0;
const CHUNK = 500;
for (let i = 0; i < plan.length; i += CHUNK) {
  const chunk = plan.slice(i, i + CHUNK);
  const res = await fetch(`${OPS_URL}/rest/v1/rpc/lcc_apply_dia_ownership_property_link`, {
    method: 'POST',
    headers: {
      apikey: OPS_KEY, Authorization: `Bearer ${OPS_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_rows: chunk }),
  });
  if (res.ok) updated += Number(await res.text()) || 0;
  else { bad += chunk.length; console.error(`\nchunk ${i}: ${res.status} ${(await res.text()).slice(0, 300)}`); }
  process.stdout.write(`\r  sent ${Math.min(i + CHUNK, plan.length)}/${plan.length}`);
}
console.log(`\ndone: ${updated} rows linked, ${bad} failed`);
console.log(`verify: select property_link_status, count(*) from lcc_dia_ownership_master `
          + `where batch_tag='${BATCH_TAG}' group by 1;`);
