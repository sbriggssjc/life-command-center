#!/usr/bin/env node
// ============================================================================
// scripts/requeue-low-confidence-finds.mjs
//
// After expanding PA Flow 1 SOQL to fetch BillingCity/BillingState, re-queue
// the find_account rows whose original candidates came back only with
// {Id, Name, Type, Industry} so graduate-sf-find-results.mjs can cross-
// validate via property-state.
//
// Selection criteria: find_account rows that are:
//   - status=done
//   - already processed (have result.candidates)
//   - owner is still missing sf_account_id in gov.true_owners
//   - payload.name is NOT already in sf_sync_queue at status=pending/processing
//
// Usage:
//   node scripts/requeue-low-confidence-finds.mjs               # dry run
//   node scripts/requeue-low-confidence-finds.mjs --apply
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

async function main() {
  console.log(`[requeue-low-confidence] apply=${APPLY}`);

  // Pull all done find_account rows (most recent per owner_id)
  const list = await ops('GET',
    `sf_sync_queue?status=eq.done&kind=eq.find_account&select=id,payload,result,requested_at&order=requested_at.desc&limit=500`
  );
  if (!list.ok) { console.error('fetch failed', list.status, list.data); process.exit(1); }

  // Keep the most recent done row per owner_id
  const byOwner = new Map();
  for (const r of list.data || []) {
    const ownerId = r.payload?.owner_id;
    if (!ownerId) continue;
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, r);
  }

  const stats = { scanned: 0, already_linked: 0, candidate_has_state: 0, no_candidates: 0, requeued: 0, errors: 0 };
  const toRequeue = [];

  for (const [ownerId, row] of byOwner.entries()) {
    stats.scanned++;
    const cands = row.result?.candidates || [];
    if (!cands.length) { stats.no_candidates++; continue; }

    // Does any candidate already have BillingState? If so, graduate script
    // can handle it directly — no need to re-queue.
    const hasState = cands.some(c => c?.BillingState);
    if (hasState) { stats.candidate_has_state++; continue; }

    // Is the owner already linked?
    const cur = await gov('GET', `true_owners?true_owner_id=eq.${encodeURIComponent(ownerId)}&select=sf_account_id,name&limit=1`);
    if (cur.ok && cur.data?.[0]?.sf_account_id) { stats.already_linked++; continue; }

    toRequeue.push({
      ownerId,
      name:  row.payload?.name,
      ownerName: cur.data?.[0]?.name || row.payload?.name,
    });
  }

  console.log(`\n${toRequeue.length} rows would be re-queued:\n`);
  for (const t of toRequeue) {
    console.log(`  ${t.ownerId.slice(0,8)}…  "${t.name}"`);
  }

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to INSERT fresh find_account rows');
    console.log('stats', stats);
    return;
  }

  for (const t of toRequeue) {
    const ins = await ops('POST', 'sf_sync_queue', {
      workspace_id: 'a0000000-0000-0000-0000-000000000001',
      kind: 'find_account',
      payload: { name: t.name, owner_id: t.ownerId },
      status: 'pending',
      requested_by: 'requeue_low_confidence',
    });
    if (ins.ok) stats.requeued++; else { stats.errors++; console.warn(`  err on ${t.ownerId.slice(0,8)}: ${ins.status}`); }
  }
  console.log(`\n[requeue-low-confidence] done`, stats);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
