#!/usr/bin/env node
// ============================================================================
// scripts/undo-bad-graduate-links.mjs
//
// Recovery for the bug where graduate-sf-find-results.mjs --min-score 0.85
// auto-accepted all substring matches without the intended BillingState
// cross-validation. Created 27 link_account rows, some of which linked
// owners to the wrong SF Account (e.g. "BB Properties, LLC" → "Grubb
// Properties, LLC").
//
// Two passes:
//   PASS A — For link_account rows from requested_by='graduate_find_results'
//            queued today that are STILL PENDING: mark them 'failed' so PA
//            Flow 1 doesn't process them.
//   PASS B — For link_account rows from that batch that already processed
//            (status=done), if the resulting true_owners.sf_account_id
//            doesn't satisfy our now-stricter criteria (exact name match
//            OR state-validated substring), NULL the sf_account_id so it
//            can be re-evaluated under the fixed graduate logic.
//
// Usage:
//   node scripts/undo-bad-graduate-links.mjs              # dry-run
//   node scripts/undo-bad-graduate-links.mjs --apply
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const APPLY = process.argv.includes('--apply');

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
const GOV_URL = env.GOV_SUPABASE_URL;
const GOV_KEY = env.GOV_SUPABASE_KEY;
if (!OPS_URL || !OPS_KEY || !GOV_URL || !GOV_KEY) { console.error('Missing creds'); process.exit(1); }

async function rest(base, key, method, path, body) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}
const ops = (m, p, b) => rest(OPS_URL, OPS_KEY, m, p, b);
const gov = (m, p, b) => rest(GOV_URL, GOV_KEY, m, p, b);

function normalizeBusinessName(name) {
  return String(name || '').toLowerCase()
    .replace(/[.,;:'"]/g, ' ')
    .replace(/\b(llc|l\.l\.c\.|lp|l\.p\.|inc|inc\.|corp|corp\.|llp|co|ltd|pllc|the)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

async function main() {
  console.log(`[undo-bad-graduate-links] apply=${APPLY}`);

  // Fetch ALL link_account rows from the graduate_find_results batch
  const list = await ops('GET',
    `sf_sync_queue?kind=eq.link_account&requested_by=eq.graduate_find_results` +
    `&select=id,status,payload,requested_at&order=requested_at.desc&limit=200`
  );
  if (!list.ok) { console.error('fetch failed', list.status, list.data); process.exit(1); }

  console.log(`\nFound ${list.data.length} link_account rows from graduate_find_results`);

  const pending = [];
  const done    = [];
  for (const r of list.data) {
    if (r.status === 'pending' || r.status === 'processing') pending.push(r);
    else if (r.status === 'done') done.push(r);
  }
  console.log(`  pending/processing: ${pending.length}`);
  console.log(`  done: ${done.length}\n`);

  // PASS A — cancel pending rows
  console.log('PASS A — cancel pending link_account rows:');
  for (const r of pending) {
    console.log(`  ${APPLY ? '[cancel]' : '[dry   ]'} ${r.id.slice(0,8)}…  owner_id=${r.payload.owner_id.slice(0,8)}  sf=${r.payload.sf_account_id}`);
    if (APPLY) {
      await ops('PATCH',
        `sf_sync_queue?id=eq.${encodeURIComponent(r.id)}`,
        { status: 'failed', result: { reason: 'graduate_script_logic_bug_undo', cancelled_at: new Date().toISOString() } },
        'return=minimal'
      );
    }
  }

  // PASS B — for done rows, re-evaluate: if the sf_account_id WAS set by
  // this batch AND the name match isn't exact, NULL it out.
  console.log('\nPASS B — re-evaluate already-processed rows:');
  const affectedOwners = [];

  for (const r of done) {
    const ownerId     = r.payload.owner_id;
    const sfAccountId = r.payload.sf_account_id;

    // Pull the owner record + compare normalized names
    const ownerRes = await gov('GET',
      `true_owners?true_owner_id=eq.${encodeURIComponent(ownerId)}` +
      `&select=true_owner_id,name,canonical_name,sf_account_id,sf_last_synced&limit=1`
    );
    if (!ownerRes.ok || !ownerRes.data?.length) { continue; }
    const owner = ownerRes.data[0];

    if (owner.sf_account_id !== sfAccountId) {
      // Owner's current sf_account_id isn't what this batch linked — maybe
      // a later row overwrote it, or the link never took effect. Skip.
      continue;
    }

    // Pull the SF Account name from the ORIGINAL find_account row's result
    const findRes = await ops('GET',
      `sf_sync_queue?kind=eq.find_account&status=eq.done` +
      `&payload->>owner_id=eq.${encodeURIComponent(ownerId)}` +
      `&select=result&order=requested_at.desc&limit=1`
    );
    const candidates = findRes.ok ? (findRes.data[0]?.result?.candidates || []) : [];
    const candidate = candidates.find(c => c?.Id === sfAccountId);
    if (!candidate) {
      console.log(`  ${ownerId.slice(0,8)}… [no candidate found in find_account results — skip]`);
      continue;
    }

    const ownerNorm = normalizeBusinessName(owner.name);
    const candNorm  = normalizeBusinessName(candidate.Name);
    const exactMatch = (ownerNorm === candNorm);

    if (exactMatch) {
      continue;   // legit 1.00 match, keep
    }

    // Substring match: check if candidate's BillingState matches any of
    // owner's property states. If so, it's a legit state-validated match.
    const sfState = String(candidate.BillingState || '').trim().toUpperCase();
    let stateOk = false;
    if (sfState) {
      const propRes = await gov('GET',
        `properties?or=(recorded_owner_id.eq.${encodeURIComponent(ownerId)},true_owner_id.eq.${encodeURIComponent(ownerId)})&select=state&limit=50`
      );
      if (propRes.ok) {
        const ownerStates = new Set();
        for (const p of propRes.data || []) if (p.state) ownerStates.add(String(p.state).trim().toUpperCase());
        stateOk = ownerStates.has(sfState);
        if (stateOk) continue;   // validated — keep the link
      }
    }

    // Not exact, not state-validated → unlink
    console.log(`  ${APPLY ? '[unlink]' : '[dry   ]'} owner=${ownerId.slice(0,8)} "${owner.name.slice(0,35)}" → NULL (was ${sfAccountId}, candidate="${candidate.Name.slice(0,35)}", sfState=${sfState||'∅'})`);
    affectedOwners.push(ownerId);

    if (APPLY) {
      await gov('PATCH',
        `true_owners?true_owner_id=eq.${encodeURIComponent(ownerId)}`,
        { sf_account_id: null, sf_last_synced: null }
      );
    }
  }

  console.log(`\n[undo-bad-graduate-links] pending=${pending.length} done=${done.length} unlinked=${affectedOwners.length}`);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
