#!/usr/bin/env node
// ============================================================================
// scripts/graduate-sf-find-results.mjs
//
// After PA Flow 1 drains find_account / find_contact queue rows, their SF
// match candidates sit in sf_sync_queue.result.candidates — but nothing
// automatically writes the best match back to gov.true_owners.sf_account_id
// (for owners) or gov.contacts.sf_contact_id (for contacts).
//
// This script "graduates" those done find_* rows by:
//   1. Fetching all sf_sync_queue rows where status=done AND kind in
//      (find_account, find_contact) AND result.candidates has 1+ hits
//   2. For each, score candidates against the payload name/email and pick
//      the best (same logic as api/_shared/salesforce.js)
//   3. Check if the target record (true_owners for accounts, contacts for
//      contacts) is still missing sf_*_id
//   4. Queue a link_account / link_contact row so PA Flow 1 writes through
//
// Usage:
//   node scripts/graduate-sf-find-results.mjs              # dry run
//   node scripts/graduate-sf-find-results.mjs --apply
//   node scripts/graduate-sf-find-results.mjs --apply --kind find_account
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const KIND_FILTER = (() => {
  const i = argv.indexOf('--kind');
  return i === -1 ? null : argv[i + 1];
})();
const MIN_SCORE = (() => {
  const i = argv.indexOf('--min-score');
  if (i === -1) return 1.00;   // default: only exact normalized matches
  const n = parseFloat(argv[i + 1]);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 1.00;
})();

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
const GOV_URL = env.GOV_SUPABASE_URL;
const GOV_KEY = env.GOV_SUPABASE_KEY;
if (!OPS_URL || !OPS_KEY || !GOV_URL || !GOV_KEY) {
  console.error('Missing OPS_* or GOV_* creds'); process.exit(1);
}

async function rest(base, key, method, path, body) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'GET' ? 'count=exact' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}
const ops = (m, p, b) => rest(OPS_URL, OPS_KEY, m, p, b);
const gov = (m, p, b) => rest(GOV_URL, GOV_KEY, m, p, b);

function normalizeBusinessName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,;:'"]/g, ' ')
    .replace(/\b(llc|l\.l\.c\.|lp|l\.p\.|inc|inc\.|corp|corp\.|llp|co|ltd|pllc|the)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreName(targetNorm, candidateNorm) {
  if (!candidateNorm) return 0;
  if (candidateNorm === targetNorm) return 1.00;
  if (candidateNorm.includes(targetNorm) || targetNorm.includes(candidateNorm)) return 0.85;
  const tw = new Set(targetNorm.split(' ').filter(w => w.length > 1));
  const cw = new Set(candidateNorm.split(' ').filter(w => w.length > 1));
  if (!tw.size || !cw.size) return 0;
  let shared = 0;
  for (const w of tw) if (cw.has(w)) shared++;
  return Math.min(0.80, shared / (tw.size + cw.size - shared));
}

// Fetch the set of U.S. states where a true_owner's properties are located.
// Used as a sanity check for 0.85 substring matches: if the SF candidate's
// BillingState isn't in this set, the match is probably wrong (different
// entity that happens to share a substring). Pulls from both recorded and
// true owner links to cover the widest slice of ownership signal.
const _ownerStateCache = new Map();
async function fetchOwnerPropertyStates(ownerId) {
  if (_ownerStateCache.has(ownerId)) return _ownerStateCache.get(ownerId);
  const r = await gov('GET',
    `properties?or=(recorded_owner_id.eq.${encodeURIComponent(ownerId)},true_owner_id.eq.${encodeURIComponent(ownerId)})` +
    `&select=state&limit=50`
  );
  const states = new Set();
  if (r.ok && Array.isArray(r.data)) {
    for (const p of r.data) {
      if (p.state) states.add(String(p.state).trim().toUpperCase());
    }
  }
  const arr = [...states];
  _ownerStateCache.set(ownerId, arr);
  return arr;
}

async function main() {
  console.log(`[graduate-sf] apply=${APPLY}  kind_filter=${KIND_FILTER || 'all'}  min_score=${MIN_SCORE}`);

  let kindFilter = 'kind=in.(find_account,find_contact)';
  if (KIND_FILTER) kindFilter = `kind=eq.${KIND_FILTER}`;

  // Fetch done rows with results
  const list = await ops('GET',
    `sf_sync_queue?status=eq.done&${kindFilter}` +
    `&select=id,kind,payload,result,requested_at` +
    `&order=requested_at.asc&limit=500`
  );
  if (!list.ok) { console.error('fetch failed', list.status, list.data); process.exit(1); }

  const rows = list.data || [];
  console.log(`Found ${rows.length} done rows to evaluate\n`);

  const stats = {
    scanned: 0,
    no_candidates: 0,
    low_confidence: 0,
    validated_by_state: 0,    // 0.85 match where BillingState matches owner's property states
    rejected_by_state: 0,     // 0.85 match where BillingState CONFLICTS with owner's property states
    no_validation_data: 0,    // 0.85 match where either side's state is missing → can't validate
    already_linked: 0,
    queued_link: 0,
    errors: 0,
  };

  for (const r of rows) {
    stats.scanned++;
    const cands = r.result?.candidates || [];
    if (!cands.length) { stats.no_candidates++; continue; }

    if (r.kind === 'find_account') {
      const targetName = r.payload?.name;
      const ownerId    = r.payload?.owner_id;
      if (!targetName || !ownerId) continue;

      const targetNorm = normalizeBusinessName(targetName);
      let best = null, bestScore = 0;
      for (const c of cands) {
        const s = scoreName(targetNorm, normalizeBusinessName(c.Name));
        if (s > bestScore) { bestScore = s; best = c; }
      }
      // Accept at exact-match threshold (1.00, no validation needed) OR at
      // MIN_SCORE with BillingState cross-validation. The SAFE_SCORE threshold
      // is hardcoded at 1.00 because substring matches below 1.00 have real
      // false-positive risk (e.g. "NGP" → "5118 de Longpre LLC"), and the
      // only honest way to accept them is with a second signal like the
      // candidate's BillingState matching one of the owner's property states.
      const SAFE_SCORE = 1.00;
      let accepted = false;
      let validationNote = '';
      if (!best || bestScore < MIN_SCORE) {
        stats.low_confidence++; continue;
      }
      if (bestScore >= SAFE_SCORE) {
        accepted = true;
      } else {
        // Below SAFE_SCORE (i.e. a substring-match 0.85 or token-jaccard):
        // require property-state cross-validation before linking.
        const sfState   = String(best.BillingState || '').trim().toUpperCase();
        const ownerStates = await fetchOwnerPropertyStates(ownerId);
        if (!sfState || ownerStates.length === 0) {
          stats.no_validation_data++;
          if (process.env.VERBOSE) {
            console.log(`  [skip] owner_id=${ownerId.slice(0,8)}… "${targetName.slice(0,40)}" → sf="${best.Name.slice(0,40)}" no state data (sf=${sfState || '∅'}, owner=${ownerStates.join(',') || '∅'})`);
          }
          continue;
        }
        if (ownerStates.includes(sfState)) {
          accepted = true;
          validationNote = ` [state-validated ${sfState}]`;
          stats.validated_by_state++;
        } else {
          stats.rejected_by_state++;
          console.log(`  [rjct] owner_id=${ownerId.slice(0,8)}… "${targetName.slice(0,40)}" → sf="${best.Name.slice(0,40)}" state mismatch (sf=${sfState}, owner=${ownerStates.join(',')})`);
          continue;
        }
      }

      // Is this owner already linked?
      const cur = await gov('GET',
        `true_owners?true_owner_id=eq.${encodeURIComponent(ownerId)}&select=sf_account_id&limit=1`
      );
      if (cur.ok && cur.data?.[0]?.sf_account_id) { stats.already_linked++; continue; }

      console.log(`  ${APPLY ? '[link]' : '[dry ]'} owner_id=${ownerId.slice(0,8)}… "${targetName.slice(0,40)}" → sf=${best.Id} "${best.Name}" (score ${bestScore.toFixed(2)})${validationNote}`);

      if (APPLY) {
        const ins = await ops('POST', 'sf_sync_queue', {
          workspace_id: 'a0000000-0000-0000-0000-000000000001',
          kind: 'link_account',
          payload: { owner_id: ownerId, sf_account_id: best.Id },
          status: 'pending',
          requested_by: 'graduate_find_results',
        });
        if (ins.ok) stats.queued_link++; else { stats.errors++; console.warn(`    err ${ins.status}`); }
      } else {
        stats.queued_link++;
      }
    } else if (r.kind === 'find_contact') {
      const targetEmail = r.payload?.email;
      const contactId   = r.payload?.contact_id;
      if (!targetEmail || !contactId) continue;

      // Email is exact match — first candidate wins
      const best = cands[0];
      if (!best?.Id) { stats.low_confidence++; continue; }

      const cur = await gov('GET',
        `contacts?contact_id=eq.${encodeURIComponent(contactId)}&select=sf_contact_id&limit=1`
      );
      if (cur.ok && cur.data?.[0]?.sf_contact_id) { stats.already_linked++; continue; }

      console.log(`  ${APPLY ? '[link]' : '[dry ]'} contact_id=${contactId.slice(0,8)}… "${targetEmail}" → sf_contact=${best.Id} sf_account=${best.AccountId}`);

      if (APPLY) {
        const ins = await ops('POST', 'sf_sync_queue', {
          workspace_id: 'a0000000-0000-0000-0000-000000000001',
          kind: 'link_contact',
          payload: {
            contact_id: contactId,
            sf_contact_id: best.Id,
            sf_account_id: best.AccountId || null,
          },
          status: 'pending',
          requested_by: 'graduate_find_results',
        });
        if (ins.ok) stats.queued_link++; else { stats.errors++; console.warn(`    err ${ins.status}`); }
      } else {
        stats.queued_link++;
      }
    }
  }

  console.log('\n[graduate-sf] stats', stats);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
