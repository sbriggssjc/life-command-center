#!/usr/bin/env node
// ============================================================================
// scripts/audit-duplicate-owners.mjs
//
// Find probable-duplicate pairs in gov.true_owners. Surfaced from the
// 2026-04-24 SF graduation pass — short-name entries like "Highwoods",
// "HC Gov", "Holmwood" are substring-matched to the same SF Account that
// a full-name entry ("Highwoods Properties", "HC Government Realty Trust",
// "Holmwood Capital") matched at 1.00 score. Likely duplicates in the
// true_owners table created by separate intake passes with different
// name captures.
//
// Detection strategies (union of all):
//   1. Same sf_account_id — two owners already both linked to the same
//      SF Account. Definite duplicate.
//   2. One's canonical_name is a strict prefix of the other's AND they
//      share at least one U.S. state via property ownership.
//   3. Edit-distance <= 2 on canonical_name AND share at least one state.
//
// For each candidate pair, prints:
//   - Each owner's id, name, property count, states covered
//   - Recommended keep/merge direction (prefer the one with sf_account_id
//     populated, else the one with more properties)
//
// Usage:
//   node scripts/audit-duplicate-owners.mjs              # all strategies
//   node scripts/audit-duplicate-owners.mjs --strategy 1 # only same-sf-id
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const STRATEGY = (() => {
  const i = argv.indexOf('--strategy');
  if (i === -1) return 'all';
  return argv[i + 1];
})();

const GOV_URL = env.GOV_SUPABASE_URL;
const GOV_KEY = env.GOV_SUPABASE_KEY;
if (!GOV_URL || !GOV_KEY) { console.error('Missing GOV creds'); process.exit(1); }

async function gov(method, path) {
  const res = await fetch(`${GOV_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: GOV_KEY, Authorization: `Bearer ${GOV_KEY}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
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

async function main() {
  console.log(`[audit-duplicates] strategy=${STRATEGY}\n`);

  // Pull all true_owners. Small enough dataset — a few thousand at most.
  const ownersRes = await gov('GET',
    `true_owners?select=true_owner_id,name,canonical_name,sf_account_id,state&limit=5000`
  );
  if (!ownersRes.ok) { console.error('fetch failed', ownersRes.status); process.exit(1); }
  const owners = ownersRes.data || [];
  console.log(`Loaded ${owners.length} true_owners\n`);

  // Build property-state cache (one owner at a time — many owners have no
  // properties, so we lazy-load per comparison).
  const statesCache = new Map();
  async function ownerStates(ownerId) {
    if (statesCache.has(ownerId)) return statesCache.get(ownerId);
    const r = await gov('GET',
      `properties?or=(recorded_owner_id.eq.${encodeURIComponent(ownerId)},true_owner_id.eq.${encodeURIComponent(ownerId)})&select=state,property_id&limit=50`
    );
    const states = new Set();
    let propCount = 0;
    if (r.ok && Array.isArray(r.data)) {
      for (const p of r.data) {
        if (p.state) states.add(String(p.state).trim().toUpperCase());
        propCount++;
      }
    }
    const payload = { states: [...states], propCount };
    statesCache.set(ownerId, payload);
    return payload;
  }

  const pairs = [];   // { a, b, reason }

  // Strategy 1: same sf_account_id
  if (STRATEGY === 'all' || STRATEGY === '1') {
    const bySfId = new Map();
    for (const o of owners) {
      if (!o.sf_account_id) continue;
      if (!bySfId.has(o.sf_account_id)) bySfId.set(o.sf_account_id, []);
      bySfId.get(o.sf_account_id).push(o);
    }
    for (const [sfId, group] of bySfId.entries()) {
      if (group.length < 2) continue;
      // Report every pairwise combination
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          pairs.push({ a: group[i], b: group[j], reason: `same_sf_account_id:${sfId}` });
        }
      }
    }
  }

  // Strategy 2: prefix match (normalized)
  if (STRATEGY === 'all' || STRATEGY === '2') {
    // Index by normalized name
    const byNorm = owners.map(o => ({ o, norm: normalizeName(o.canonical_name || o.name) }));
    // Sort by length so prefixes come first
    byNorm.sort((x, y) => x.norm.length - y.norm.length);
    const seen = new Set();  // pair keys to avoid dup reports with strategy 1
    for (let i = 0; i < byNorm.length; i++) {
      const shortNorm = byNorm[i].norm;
      if (shortNorm.length < 4) continue;  // too short — false positive risk
      for (let j = i + 1; j < byNorm.length; j++) {
        const longNorm = byNorm[j].norm;
        if (longNorm === shortNorm) continue;  // exact match — different signal
        if (!longNorm.startsWith(shortNorm + ' ')) continue;  // not a word-boundary prefix
        const a = byNorm[i].o, b = byNorm[j].o;
        const key = [a.true_owner_id, b.true_owner_id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);

        // Require shared state (property ownership)
        const aSt = await ownerStates(a.true_owner_id);
        const bSt = await ownerStates(b.true_owner_id);
        const shared = aSt.states.filter(s => bSt.states.includes(s));
        if (shared.length === 0) continue;

        pairs.push({ a, b, reason: `prefix_match+shared_state:${shared.join(',')}` });
      }
    }
  }

  // Strategy 3: low edit distance + shared state
  if (STRATEGY === 'all' || STRATEGY === '3') {
    const byNorm = owners.map(o => ({ o, norm: normalizeName(o.canonical_name || o.name) }))
      .filter(x => x.norm.length >= 6);  // skip very short
    const seen = new Set(pairs.map(p => [p.a.true_owner_id, p.b.true_owner_id].sort().join('|')));
    for (let i = 0; i < byNorm.length; i++) {
      for (let j = i + 1; j < byNorm.length; j++) {
        const dist = levenshtein(byNorm[i].norm, byNorm[j].norm);
        const maxLen = Math.max(byNorm[i].norm.length, byNorm[j].norm.length);
        if (dist === 0) continue;
        if (dist > 2 || dist / maxLen > 0.25) continue;
        const a = byNorm[i].o, b = byNorm[j].o;
        const key = [a.true_owner_id, b.true_owner_id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);

        const aSt = await ownerStates(a.true_owner_id);
        const bSt = await ownerStates(b.true_owner_id);
        const shared = aSt.states.filter(s => bSt.states.includes(s));
        if (shared.length === 0) continue;

        pairs.push({ a, b, reason: `fuzzy_name(d=${dist})+shared_state:${shared.join(',')}` });
      }
    }
  }

  console.log(`Found ${pairs.length} probable duplicate pairs:\n`);

  // For each pair, print details and recommendation
  for (const { a, b, reason } of pairs) {
    const aSt = await ownerStates(a.true_owner_id);
    const bSt = await ownerStates(b.true_owner_id);

    // Keep direction: prefer the one with sf_account_id, else more properties,
    // else the longer canonical_name (more specific capture).
    let keep, drop;
    if (a.sf_account_id && !b.sf_account_id) { keep = a; drop = b; }
    else if (b.sf_account_id && !a.sf_account_id) { keep = b; drop = a; }
    else if (aSt.propCount > bSt.propCount) { keep = a; drop = b; }
    else if (bSt.propCount > aSt.propCount) { keep = b; drop = a; }
    else if ((a.canonical_name || '').length > (b.canonical_name || '').length) { keep = a; drop = b; }
    else { keep = b; drop = a; }

    console.log(`REASON: ${reason}`);
    console.log(`  KEEP: ${keep.true_owner_id.slice(0,8)}…  "${keep.name}"  sf=${keep.sf_account_id || '—'}  props=${(keep === a ? aSt : bSt).propCount}  states=${(keep === a ? aSt : bSt).states.join(',')}`);
    console.log(`  DROP: ${drop.true_owner_id.slice(0,8)}…  "${drop.name}"  sf=${drop.sf_account_id || '—'}  props=${(drop === a ? aSt : bSt).propCount}  states=${(drop === a ? aSt : bSt).states.join(',')}`);
    console.log('');
  }

  console.log(`[audit-duplicates] ${pairs.length} pairs`);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
