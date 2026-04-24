#!/usr/bin/env node
// ============================================================================
// scripts/merge-duplicate-owners.mjs
//
// Merge duplicate gov.true_owners rows identified by audit-duplicate-owners.
// Two-pass workflow:
//
//   1. Read audit (same logic as audit-duplicate-owners.mjs) to build pair list
//   2. For each pair, compute impact: property rows that would be re-parented,
//      sf_account_id decisions, ownership_history transfers
//   3. Dry-run: print the full impact report so Scott can veto individual pairs
//   4. --apply: for each approved pair, run surgery in this order:
//        a. UPDATE gov.properties SET recorded_owner_id = keeper WHERE = dropper
//        b. UPDATE gov.properties SET true_owner_id = keeper WHERE = dropper
//        c. UPDATE gov.ownership_history SET owner_id = keeper WHERE = dropper
//        d. If keeper.sf_account_id is null AND dropper's is set → copy over
//        e. DELETE gov.true_owners WHERE true_owner_id = dropper
//
// Safety:
//   - Refuses to merge without first running audit to compute pairs
//   - Refuses to merge a pair if both owners have sf_account_id set AND they
//     differ (ambiguous — which SF link wins?) → prints warning, skips pair
//   - Allows --only-typos flag to merge ONLY the fuzzy_name typo pairs
//     (safest: Kilroy Relaty/Realty, Tom Flangana/Flanagan, Pete Brendell/Brendel)
//   - Allows --skip-ids a,b,c to exclude specific pairs (whitespace-split owner ids)
//
// Usage:
//   node scripts/merge-duplicate-owners.mjs                           # dry-run all
//   node scripts/merge-duplicate-owners.mjs --only-typos              # dry-run typos only
//   node scripts/merge-duplicate-owners.mjs --only-typos --apply      # apply typos
//   node scripts/merge-duplicate-owners.mjs --apply                   # apply all (after review!)
//   node scripts/merge-duplicate-owners.mjs --apply --skip 4c9440fc   # apply except listed drop ids
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const APPLY       = argv.includes('--apply');
const ONLY_TYPOS  = argv.includes('--only-typos');
const SKIP_IDS = (() => {
  const i = argv.indexOf('--skip');
  if (i === -1) return new Set();
  return new Set(String(argv[i + 1] || '').split(',').map(s => s.trim()).filter(Boolean));
})();

const GOV_URL = env.GOV_SUPABASE_URL;
const GOV_KEY = env.GOV_SUPABASE_KEY;
if (!GOV_URL || !GOV_KEY) { console.error('Missing GOV creds'); process.exit(1); }

async function gov(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${GOV_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: GOV_KEY,
      Authorization: `Bearer ${GOV_KEY}`,
      'Content-Type': 'application/json',
      Prefer: extraHeaders.Prefer || (method === 'GET' ? 'count=exact' : 'return=minimal'),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const contentRange = res.headers.get('content-range');
  let count = 0;
  if (contentRange) {
    const m = contentRange.match(/\/(\d+)/);
    if (m) count = parseInt(m[1], 10);
  }
  return { ok: res.ok, status: res.status, data, count };
}

function normalizeName(name) {
  return String(name || '').toLowerCase()
    .replace(/[.,;:'"]/g, ' ')
    .replace(/\b(llc|l\.l\.c\.|lp|l\.p\.|inc|inc\.|corp|corp\.|llp|co|ltd|pllc|the)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i-1] === a[j-1] ? 0 : 1;
      m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+cost);
    }
  }
  return m[b.length][a.length];
}

// ============================================================================
// BUILD PAIR LIST — replicates audit logic (prefix + fuzzy strategies only)
// ============================================================================
async function buildPairs() {
  // Paginated fetch of all true_owners
  const owners = [];
  let offset = 0;
  while (true) {
    const r = await gov('GET',
      `true_owners?select=true_owner_id,name,canonical_name,sf_account_id` +
      `&order=true_owner_id.asc&limit=1000&offset=${offset}`
    );
    if (!r.ok) throw new Error(`fetch true_owners failed: ${r.status}`);
    const batch = r.data || [];
    owners.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`[merge] loaded ${owners.length} true_owners`);

  // Fetch property states cache
  const _statesCache = new Map();
  async function ownerStates(ownerId) {
    if (_statesCache.has(ownerId)) return _statesCache.get(ownerId);
    const r = await gov('GET',
      `properties?or=(recorded_owner_id.eq.${encodeURIComponent(ownerId)},true_owner_id.eq.${encodeURIComponent(ownerId)})&select=state&limit=50`
    );
    const states = new Set();
    if (r.ok) for (const p of r.data || []) if (p.state) states.add(String(p.state).trim().toUpperCase());
    const arr = [...states];
    _statesCache.set(ownerId, arr);
    return arr;
  }

  const pairs = [];
  const seen = new Set();

  // Strategy: prefix match + shared state
  if (!ONLY_TYPOS) {
    const byNorm = owners.map(o => ({ o, norm: normalizeName(o.canonical_name || o.name) }));
    byNorm.sort((x, y) => x.norm.length - y.norm.length);
    for (let i = 0; i < byNorm.length; i++) {
      const shortNorm = byNorm[i].norm;
      if (shortNorm.length < 4) continue;
      for (let j = i + 1; j < byNorm.length; j++) {
        const longNorm = byNorm[j].norm;
        if (longNorm === shortNorm) continue;
        if (!longNorm.startsWith(shortNorm + ' ')) continue;
        const a = byNorm[i].o, b = byNorm[j].o;
        const key = [a.true_owner_id, b.true_owner_id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);

        const aSt = await ownerStates(a.true_owner_id);
        const bSt = await ownerStates(b.true_owner_id);
        const shared = aSt.filter(s => bSt.includes(s));
        if (!shared.length) continue;

        pairs.push({ a, b, reason: `prefix_match+shared_state:${shared.join(',')}`, strategy: 'prefix' });
      }
    }
  }

  // Strategy: fuzzy typo + first-token-identity + shared state
  const byNorm = owners.map(o => ({ o, norm: normalizeName(o.canonical_name || o.name) }))
    .filter(x => x.norm.length >= 8);
  for (let i = 0; i < byNorm.length; i++) {
    for (let j = i + 1; j < byNorm.length; j++) {
      const normA = byNorm[i].norm, normB = byNorm[j].norm;
      const dist = levenshtein(normA, normB);
      const maxLen = Math.max(normA.length, normB.length);
      if (dist === 0) continue;
      if (dist > 2 || dist / maxLen > 0.20) continue;
      const firstA = normA.split(' ')[0];
      const firstB = normB.split(' ')[0];
      if (firstA !== firstB) continue;
      if (firstA.length < 3) continue;

      const a = byNorm[i].o, b = byNorm[j].o;
      const key = [a.true_owner_id, b.true_owner_id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      const aSt = await ownerStates(a.true_owner_id);
      const bSt = await ownerStates(b.true_owner_id);
      const shared = aSt.filter(s => bSt.includes(s));
      if (!shared.length) continue;

      pairs.push({ a, b, reason: `fuzzy_name(d=${dist})+first_token="${firstA}"+shared_state:${shared.join(',')}`, strategy: 'fuzzy' });
    }
  }

  // Filter: only typos if requested
  return ONLY_TYPOS ? pairs.filter(p => p.strategy === 'fuzzy') : pairs;
}

// ============================================================================
// COMPUTE IMPACT — property/history row counts + keep/drop decision
// ============================================================================
async function computeImpact(pair) {
  const a = pair.a, b = pair.b;

  const aProps = await gov('GET',
    `properties?or=(recorded_owner_id.eq.${encodeURIComponent(a.true_owner_id)},true_owner_id.eq.${encodeURIComponent(a.true_owner_id)})&select=property_id&limit=1`
  );
  const bProps = await gov('GET',
    `properties?or=(recorded_owner_id.eq.${encodeURIComponent(b.true_owner_id)},true_owner_id.eq.${encodeURIComponent(b.true_owner_id)})&select=property_id&limit=1`
  );

  // Keep direction: prefer sf_account_id, else more properties, else longer canonical_name
  let keep, drop;
  if (a.sf_account_id && !b.sf_account_id) { keep = a; drop = b; }
  else if (b.sf_account_id && !a.sf_account_id) { keep = b; drop = a; }
  else if (aProps.count > bProps.count) { keep = a; drop = b; }
  else if (bProps.count > aProps.count) { keep = b; drop = a; }
  else if ((a.canonical_name || '').length > (b.canonical_name || '').length) { keep = a; drop = b; }
  else { keep = b; drop = a; }

  // SF ambiguity check
  const bothSfSet = (a.sf_account_id && b.sf_account_id);
  const sfConflict = bothSfSet && (a.sf_account_id !== b.sf_account_id);

  // Count rows affected
  const recordedCount = await gov('GET',
    `properties?recorded_owner_id=eq.${encodeURIComponent(drop.true_owner_id)}&select=property_id&limit=1`
  );
  const trueOwnerCount = await gov('GET',
    `properties?true_owner_id=eq.${encodeURIComponent(drop.true_owner_id)}&select=property_id&limit=1`
  );
  const historyCount = await gov('GET',
    `ownership_history?owner_id=eq.${encodeURIComponent(drop.true_owner_id)}&select=ownership_id&limit=1`
  );

  return {
    keep, drop, sfConflict,
    propsRecorded: recordedCount.count,
    propsTrueOwner: trueOwnerCount.count,
    history: historyCount.ok ? historyCount.count : 'n/a',
    copySfFromDropToKeep: (!keep.sf_account_id && drop.sf_account_id),
  };
}

// ============================================================================
// APPLY MERGE (one pair)
// ============================================================================
async function applyMerge(keep, drop, impact) {
  console.log(`    (a) UPDATE properties recorded_owner_id: ${drop.true_owner_id.slice(0,8)} → ${keep.true_owner_id.slice(0,8)} (${impact.propsRecorded} rows)`);
  if (impact.propsRecorded > 0) {
    const r = await gov('PATCH',
      `properties?recorded_owner_id=eq.${encodeURIComponent(drop.true_owner_id)}`,
      { recorded_owner_id: keep.true_owner_id }
    );
    if (!r.ok) throw new Error(`PATCH recorded_owner_id failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  console.log(`    (b) UPDATE properties true_owner_id: ${drop.true_owner_id.slice(0,8)} → ${keep.true_owner_id.slice(0,8)} (${impact.propsTrueOwner} rows)`);
  if (impact.propsTrueOwner > 0) {
    const r = await gov('PATCH',
      `properties?true_owner_id=eq.${encodeURIComponent(drop.true_owner_id)}`,
      { true_owner_id: keep.true_owner_id }
    );
    if (!r.ok) throw new Error(`PATCH true_owner_id failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  console.log(`    (c) UPDATE ownership_history owner_id: ${drop.true_owner_id.slice(0,8)} → ${keep.true_owner_id.slice(0,8)} (${impact.history} rows)`);
  if (impact.history !== 'n/a' && impact.history > 0) {
    const r = await gov('PATCH',
      `ownership_history?owner_id=eq.${encodeURIComponent(drop.true_owner_id)}`,
      { owner_id: keep.true_owner_id }
    );
    if (!r.ok) console.warn(`    WARN: ownership_history PATCH failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  if (impact.copySfFromDropToKeep) {
    console.log(`    (d) COPY sf_account_id ${drop.sf_account_id} from drop → keep`);
    const r = await gov('PATCH',
      `true_owners?true_owner_id=eq.${encodeURIComponent(keep.true_owner_id)}`,
      { sf_account_id: drop.sf_account_id, sf_last_synced: new Date().toISOString() }
    );
    if (!r.ok) throw new Error(`PATCH keeper.sf_account_id failed: ${r.status}`);
  }

  console.log(`    (e) DELETE true_owner ${drop.true_owner_id.slice(0,8)}`);
  const delRes = await gov('DELETE',
    `true_owners?true_owner_id=eq.${encodeURIComponent(drop.true_owner_id)}`
  );
  if (!delRes.ok) throw new Error(`DELETE true_owner failed: ${delRes.status} ${JSON.stringify(delRes.data)}`);
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log(`[merge-duplicate-owners] apply=${APPLY}  only-typos=${ONLY_TYPOS}  skip=${[...SKIP_IDS].join(',') || '(none)'}\n`);

  const pairs = await buildPairs();
  console.log(`Built ${pairs.length} merge candidate pairs\n`);

  const stats = { planned: 0, applied: 0, skipped_sf_conflict: 0, skipped_user: 0, errors: 0 };

  for (let idx = 0; idx < pairs.length; idx++) {
    const pair = pairs[idx];
    const impact = await computeImpact(pair);
    stats.planned++;

    const tag = `[${idx + 1}/${pairs.length}]`;
    console.log(`${tag} ${pair.strategy}  ${pair.reason}`);
    console.log(`    KEEP: ${impact.keep.true_owner_id.slice(0,8)}…  "${impact.keep.name}"  sf=${impact.keep.sf_account_id || '—'}`);
    console.log(`    DROP: ${impact.drop.true_owner_id.slice(0,8)}…  "${impact.drop.name}"  sf=${impact.drop.sf_account_id || '—'}`);
    console.log(`    impact: propsRecorded=${impact.propsRecorded}  propsTrueOwner=${impact.propsTrueOwner}  history=${impact.history}`);

    if (impact.sfConflict) {
      console.log(`    SKIP: both have distinct sf_account_id — which SF link wins? Manual review required`);
      stats.skipped_sf_conflict++;
      console.log('');
      continue;
    }
    if (SKIP_IDS.has(impact.drop.true_owner_id.slice(0, 8)) || SKIP_IDS.has(impact.drop.true_owner_id)) {
      console.log(`    SKIP: --skip flag`);
      stats.skipped_user++;
      console.log('');
      continue;
    }

    if (!APPLY) {
      console.log(`    [dry-run] would merge`);
      console.log('');
      continue;
    }

    try {
      await applyMerge(impact.keep, impact.drop, impact);
      stats.applied++;
      console.log(`    ✓ merged`);
    } catch (err) {
      stats.errors++;
      console.error(`    ✗ ERROR: ${err.message}`);
    }
    console.log('');
  }

  console.log('\n[merge-duplicate-owners]', stats);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
