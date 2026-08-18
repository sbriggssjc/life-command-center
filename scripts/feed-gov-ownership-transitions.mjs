#!/usr/bin/env node
/**
 * P140 — feed gov's dated ownership transitions into lcc_property_owner_evidence.
 *
 * NO NEW ENGINE. lcc_supersede_property_owner() already owns tiering, the
 * is_unique test, the brokerage and org-marker guards, dry-run, and the
 * lcc_owner_supersession_log reversal ledger. It reads
 * lcc_property_owner_evidence, tiered on `source` and won on `observed_at`.
 * P139 registered `gov_ownership_transition` at tier 3 (with rel_purchase, so
 * the transfer DATE decides) and field_source_priority 18. This script only
 * supplies rows.
 *
 * WHY A SCRIPT: it is a CROSS-PROJECT join. The transitions live in gov
 * (scknotsqkcheojiaewwh), the evidence table lives in LCC Opps
 * (xengecqvemvfknjvbvrq). No single SQL statement sees both.
 *
 * NO NAME MATCHING ANYWHERE. Both joins are ID-to-ID:
 *   gov property_id            -> external_identities(gov, asset)      -> asset entity
 *   gov true_owner_id          -> external_identities(gov, true_owner) -> owner entity
 * The gov view withholds new_owner_true_owner_id unless the linked
 * true_owners.name matches the transition's new_owner, so the NAME verifies the
 * ID and the ID carries the identity. (Measured: the id means the NEW owner
 * 91.4% of the time, the PRIOR owner 0.6%, neither 8.1% -- the 8.1% is exactly
 * what that verification withholds.)
 *
 * VALUE GATE: --min-rent, default 500000. Rent bands measured 2026-08-18 say a
 * $500k floor covers 80% of gov annual rent in ~25% of the properties. Assets
 * below the floor are counted and skipped, never silently dropped.
 *
 * DOES NOT MINT ASSET ENTITIES. A property with no asset entity is reported as
 * `no_asset_entity` and skipped. Minting is a producer action and needs its own
 * decision (see docs/architecture/gov-asset-identity-coverage-2026-08.md);
 * doing it here would smuggle ~3,000 new entities in behind an evidence load.
 *
 * Usage (repo root, reads .env.local):
 *   node scripts/feed-gov-ownership-transitions.mjs                 # dry run
 *   node scripts/feed-gov-ownership-transitions.mjs --apply
 *   node scripts/feed-gov-ownership-transitions.mjs --min-rent 0 --apply
 *
 * Idempotent: upserts on the natural PK
 * (entity_id, candidate_owner_entity, source) with ignore-duplicates, so a
 * re-run adds only genuinely new pairs and never rewrites an observed_at.
 *
 * REVERSAL:
 *   delete from lcc_property_owner_evidence where source='gov_ownership_transition';
 *   -- any owner already RESOLVED from it reverses via lcc_owner_supersession_log.
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
const GOV_URL = process.env.GOV_SUPABASE_URL;
const GOV_KEY = process.env.GOV_SUPABASE_SERVICE_KEY || process.env.GOV_SUPABASE_KEY;
const missing = [
  !OPS_URL && 'OPS_SUPABASE_URL', !OPS_KEY && 'OPS_SUPABASE_KEY',
  !GOV_URL && 'GOV_SUPABASE_URL', !GOV_KEY && 'GOV_SUPABASE_SERVICE_KEY/GOV_SUPABASE_KEY',
].filter(Boolean);
if (missing.length) {
  console.error(`Missing: ${missing.join(', ')}`);
  console.error(envFile ? `Read ${envFile} but those keys were not in it.` : 'No .env.local found.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const mrIdx = process.argv.indexOf('--min-rent');
const MIN_RENT = mrIdx > -1 ? Number(process.argv[mrIdx + 1]) : 500000;
console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}  min-rent $${MIN_RENT.toLocaleString()}  `
          + `ops=${OPS_URL.replace(/^https:\/\//, '').split('.')[0]} `
          + `gov=${GOV_URL.replace(/^https:\/\//, '').split('.')[0]}`);

// PostgREST caps every response at 1000 rows regardless of `limit` (CLAUDE.md).
// Page at exactly 1000 or rows are silently skipped.
const PAGE = 1000;
async function pageAll(base, key, pathAndQuery) {
  let out = [];
  for (let off = 0; ; off += PAGE) {
    const url = `${base}/rest/v1/${pathAndQuery}&limit=${PAGE}&offset=${off}`;
    const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    out = out.concat(rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ---- LCC side: the two ID maps and the rent gate --------------------------
const assetRows = await pageAll(OPS_URL, OPS_KEY,
  `external_identities?select=external_id,entity_id&source_system=eq.gov&source_type=eq.asset&order=external_id.asc`);
const ownerRows = await pageAll(OPS_URL, OPS_KEY,
  `external_identities?select=external_id,entity_id&source_system=eq.gov&source_type=eq.true_owner&order=external_id.asc`);
const attrRows = await pageAll(OPS_URL, OPS_KEY,
  `lcc_property_attributes?select=source_property_id,annual_rent&source_domain=eq.gov&order=source_property_id.asc`);

const assetByProp = new Map(assetRows.map((r) => [String(r.external_id), r.entity_id]));
const ownerById   = new Map(ownerRows.map((r) => [String(r.external_id), r.entity_id]));
const rentByProp  = new Map(attrRows.map((r) => [String(r.source_property_id), r.annual_rent]));
console.log(`lcc: ${assetByProp.size} gov asset ids · ${ownerById.size} true_owner ids · ${rentByProp.size} attribute rows`);

// ---- gov side: the feedable transitions ------------------------------------
// is_oscillating_pair (P138f) excludes properties whose history contains BOTH
// A->B and B->A. That is a gsa_lease_diff artifact -- the GSA lessor field
// flickers between an SPE and its parent, so the DATE is real but the DIRECTION
// is contradicted. Found by reading a sample row from this script's own first
// dry run: property 180 had GPIT and Echelon Pkwy swapping four times, with six
// identical rows on the newest date. 233 properties are affected.
const trans = await pageAll(GOV_URL, GOV_KEY,
  `v_ownership_transitions_portfolio?select=property_id,transfer_date,new_owner_cleaned,`
  + `new_owner_true_owner_id,prior_owner_cleaned,transfer_price,data_source`
  + `&is_latest_for_property=is.true&new_owner_is_clean=is.true&is_self_transition=is.false`
  + `&is_oscillating_pair=is.false`
  + `&new_owner_true_owner_id=not.is.null&order=property_id.asc`);
console.log(`gov: ${trans.length} feedable transitions (oscillating pairs already excluded)`);

// ---- join, gate, and account for every row ---------------------------------
const skip = { no_asset_entity: 0, no_owner_entity: 0, below_rent_floor: 0, no_rent: 0 };
const rows = [];
for (const t of trans) {
  const pid = String(t.property_id);
  const assetEntity = assetByProp.get(pid);
  if (!assetEntity) { skip.no_asset_entity++; continue; }
  const ownerEntity = ownerById.get(String(t.new_owner_true_owner_id));
  if (!ownerEntity) { skip.no_owner_entity++; continue; }
  const rent = rentByProp.get(pid);
  // --min-rent 0 means "no value gate at all", so a MISSING rent must not keep
  // gating. Otherwise 0 quietly still drops rows and the operator cannot express
  // "everything". Only gate on rent when a floor is actually set.
  if (MIN_RENT > 0) {
    if (rent == null) { skip.no_rent++; continue; }
    if (Number(rent) < MIN_RENT) { skip.below_rent_floor++; continue; }
  }
  rows.push({
    entity_id: assetEntity,
    candidate_owner_entity: ownerEntity,
    source: 'gov_ownership_transition',
    weight: 1.0,
    observed_at: t.transfer_date,          // the transfer date IS the ordering signal
    detail: {
      gov_property_id: pid,
      new_owner: t.new_owner_cleaned,
      prior_owner: t.prior_owner_cleaned,
      transfer_price: t.transfer_price,
      annual_rent: rent,
      gov_data_source: t.data_source,   // gsa_lease_diff is ~93% of the feed
      basis: 'gov.ownership_history dated transfer; owner id verified against the '
           + 'transition name before use; properties with a contradicted '
           + 'direction (A->B and B->A both recorded) excluded',
      view: 'v_ownership_transitions_portfolio',
    },
  });
}

console.log(`\ncandidate evidence rows: ${rows.length}`);
console.log(`  skipped  no_asset_entity ${skip.no_asset_entity}  no_owner_entity ${skip.no_owner_entity}`
          + `  below_rent_floor ${skip.below_rent_floor}  no_rent ${skip.no_rent}`);
console.log(`  distinct assets ${new Set(rows.map((r) => r.entity_id)).size}`
          + `  distinct owners ${new Set(rows.map((r) => r.candidate_owner_entity)).size}`);
if (rows.length) {
  const yrs = rows.map((r) => String(r.observed_at).slice(0, 4)).sort();
  console.log(`  transfer years ${yrs[0]}..${yrs[yrs.length - 1]}`);
  console.log('  sample:');
  for (const r of rows.slice(0, 5)) {
    console.log(`    ${r.observed_at}  prop ${r.detail.gov_property_id}  ${String(r.detail.new_owner).slice(0, 40)}`);
  }
}

if (!APPLY) { console.log('\ndry run — re-run with --apply to write'); process.exit(0); }

// ---- write ------------------------------------------------------------------
// PK is (entity_id, candidate_owner_entity, source) -- PLAIN columns, so unlike
// the P136a case PostgREST can infer the arbiter directly. ignore-duplicates so
// a re-run never rewrites an observed_at that is already recorded.
let ok = 0, bad = 0;
const CHUNK = 500;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const res = await fetch(
    `${OPS_URL}/rest/v1/lcc_property_owner_evidence`
    + `?on_conflict=entity_id,candidate_owner_entity,source`, {
      method: 'POST',
      headers: {
        apikey: OPS_KEY, Authorization: `Bearer ${OPS_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify(chunk),
    });
  if (res.ok) ok += chunk.length;
  else { bad += chunk.length; console.error(`\nchunk ${i}: ${res.status} ${(await res.text()).slice(0, 300)}`); }
  process.stdout.write(`\r  sent ${ok + bad}/${rows.length}`);
}
console.log(`\ndone: ${ok} sent, ${bad} failed`);
console.log(`\nNEXT (both dry-run first, neither is run by this script):`);
console.log(`  select * from lcc_supersede_property_owner(true);   -- see what would resolve`);
console.log(`  select count(*) from lcc_property_owner_evidence where source='gov_ownership_transition';`);
