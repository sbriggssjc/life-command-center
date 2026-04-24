#!/usr/bin/env node
// ============================================================================
// scripts/finalize-orphan-drops.mjs
//
// Cleanup for true_owners rows that were partially merged and left orphaned:
//   - Properties correctly re-parented to KEEP
//   - ownership_history still references DROP
//   - true_owners row for DROP still exists
//
// Happened on 2026-04-24 when merge-duplicate-owners.mjs had a column-name
// bug (ownership_history.owner_id vs true_owner_id) — properties PATCH
// worked but history PATCH and DELETE failed. Can't use the regular merge
// script because DROP no longer has properties → fails shared_state filter
// in audit → never paired for re-processing.
//
// Input: explicit mapping of drop_id:keep_id pairs on command line.
//
// Usage:
//   node scripts/finalize-orphan-drops.mjs \
//     --map 78730371-7124-4575-85e4-dc5ef69f45bf:651436df-xxx \
//     --map 761d4b72-xxx:dfa9575f-xxx \
//     ...
//
//   Or single pair quick mode:
//   node scripts/finalize-orphan-drops.mjs --drop <id> --keep <id>
//
//   --apply to actually write (dry-run default)
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');

// Parse --map pairs (repeatable)
const mappings = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--map' && argv[i + 1]) {
    const [drop, keep] = argv[i + 1].split(':');
    if (drop && keep) mappings.push({ drop: drop.trim(), keep: keep.trim() });
    i++;
  }
}
// Or single pair shortcut
const dropFlag = (() => { const i = argv.indexOf('--drop'); return i === -1 ? null : argv[i + 1]; })();
const keepFlag = (() => { const i = argv.indexOf('--keep'); return i === -1 ? null : argv[i + 1]; })();
if (dropFlag && keepFlag) mappings.push({ drop: dropFlag, keep: keepFlag });

if (!mappings.length) { console.error('No mappings provided. Use --map drop:keep or --drop ID --keep ID'); process.exit(1); }

const GOV_URL = env.GOV_SUPABASE_URL;
const GOV_KEY = env.GOV_SUPABASE_KEY;
if (!GOV_URL || !GOV_KEY) { console.error('Missing GOV creds'); process.exit(1); }

async function gov(method, path, body) {
  const res = await fetch(`${GOV_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: GOV_KEY,
      Authorization: `Bearer ${GOV_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'GET' ? 'count=exact' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const cr = res.headers.get('content-range');
  let count = 0;
  if (cr) { const m = cr.match(/\/(\d+)/); if (m) count = parseInt(m[1], 10); }
  return { ok: res.ok, status: res.status, data, count };
}

// Resolve an 8-char UUID prefix (or longer) to the full UUID by scanning
// a small set of recent true_owners. Expensive but bounded — we only
// ever call this for a handful of orphan drops.
async function resolveUuid(prefix) {
  if (prefix.length >= 36) return prefix;  // already full UUID
  // Paginated scan
  let offset = 0;
  while (true) {
    const r = await gov('GET', `true_owners?select=true_owner_id&order=true_owner_id.asc&limit=1000&offset=${offset}`);
    if (!r.ok) throw new Error(`Failed to scan true_owners: ${r.status}`);
    const batch = r.data || [];
    const match = batch.find(x => x.true_owner_id.startsWith(prefix));
    if (match) return match.true_owner_id;
    if (batch.length < 1000) return null;
    offset += 1000;
  }
}

async function main() {
  console.log(`[finalize-orphan-drops] apply=${APPLY}  pairs=${mappings.length}\n`);

  // Resolve any prefix mappings to full UUIDs up front
  for (const m of mappings) {
    if (m.drop.length < 36) {
      const full = await resolveUuid(m.drop);
      if (!full) { console.error(`Prefix ${m.drop} not found in true_owners`); process.exit(1); }
      m.drop = full;
    }
    if (m.keep.length < 36) {
      const full = await resolveUuid(m.keep);
      if (!full) { console.error(`Prefix ${m.keep} not found in true_owners`); process.exit(1); }
      m.keep = full;
    }
  }

  for (const { drop, keep } of mappings) {
    // Sanity check: drop still exists, keep still exists
    const [dropRow, keepRow] = await Promise.all([
      gov('GET', `true_owners?true_owner_id=eq.${encodeURIComponent(drop)}&select=true_owner_id,name,sf_account_id&limit=1`),
      gov('GET', `true_owners?true_owner_id=eq.${encodeURIComponent(keep)}&select=true_owner_id,name,sf_account_id&limit=1`),
    ]);
    if (!dropRow.ok || !dropRow.data?.length) {
      console.log(`[skip] DROP ${drop.slice(0,8)} not found in true_owners (already cleaned up?)`);
      continue;
    }
    if (!keepRow.ok || !keepRow.data?.length) {
      console.log(`[error] KEEP ${keep.slice(0,8)} not found in true_owners — bad mapping`);
      continue;
    }

    // Count remaining props pointing to DROP (should be 0 after partial merge)
    const [rProp, tProp, hist] = await Promise.all([
      gov('GET', `properties?recorded_owner_id=eq.${encodeURIComponent(drop)}&select=property_id&limit=1`),
      gov('GET', `properties?true_owner_id=eq.${encodeURIComponent(drop)}&select=property_id&limit=1`),
      gov('GET', `ownership_history?true_owner_id=eq.${encodeURIComponent(drop)}&select=ownership_id&limit=1`),
    ]);

    console.log(`DROP=${drop.slice(0,8)} "${dropRow.data[0].name}"  KEEP=${keep.slice(0,8)} "${keepRow.data[0].name}"`);
    console.log(`  remaining: properties.recorded=${rProp.count}  properties.true=${tProp.count}  history=${hist.count}`);

    if (!APPLY) { console.log(`  [dry-run]\n`); continue; }

    // Clean up any remaining property references (defensive — shouldn't be any)
    if (rProp.count > 0) {
      const r = await gov('PATCH', `properties?recorded_owner_id=eq.${encodeURIComponent(drop)}`, { recorded_owner_id: keep });
      if (!r.ok) { console.error(`  PATCH properties.recorded failed: ${r.status}`); continue; }
    }
    if (tProp.count > 0) {
      const r = await gov('PATCH', `properties?true_owner_id=eq.${encodeURIComponent(drop)}`, { true_owner_id: keep });
      if (!r.ok) { console.error(`  PATCH properties.true failed: ${r.status}`); continue; }
    }

    // Move history
    if (hist.count > 0) {
      const r = await gov('PATCH', `ownership_history?true_owner_id=eq.${encodeURIComponent(drop)}`, { true_owner_id: keep });
      if (!r.ok) { console.error(`  PATCH ownership_history failed: ${r.status} ${JSON.stringify(r.data)}`); continue; }
      console.log(`  moved ${hist.count} ownership_history rows`);
    }

    // Copy sf_account_id if keeper is null
    if (!keepRow.data[0].sf_account_id && dropRow.data[0].sf_account_id) {
      const r = await gov('PATCH', `true_owners?true_owner_id=eq.${encodeURIComponent(keep)}`, {
        sf_account_id: dropRow.data[0].sf_account_id,
        sf_last_synced: new Date().toISOString(),
      });
      if (r.ok) console.log(`  copied sf_account_id from drop to keep`);
    }

    // Delete DROP
    const del = await gov('DELETE', `true_owners?true_owner_id=eq.${encodeURIComponent(drop)}`);
    if (del.ok) console.log(`  ✓ deleted DROP ${drop.slice(0,8)}`);
    else console.error(`  DELETE failed: ${del.status} ${JSON.stringify(del.data)}`);
    console.log('');
  }
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
