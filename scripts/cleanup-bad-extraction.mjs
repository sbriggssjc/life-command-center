#!/usr/bin/env node
// ============================================================================
// scripts/cleanup-bad-extraction.mjs
//
// Removes the most-recent extraction row + most-recent match row for a given
// intake. Used when a retry ran against the old code path (pre-short-circuit
// deploy), producing a fresh AI extraction with variable output that degraded
// the match. After cleanup, the short-circuit will fall back to the previous
// (good) extraction + match.
//
// Usage:
//   node scripts/cleanup-bad-extraction.mjs <intake_id_prefix>          # dry-run
//   node scripts/cleanup-bad-extraction.mjs <intake_id_prefix> --apply
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const idPrefix = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!idPrefix) { console.error('Usage: node scripts/cleanup-bad-extraction.mjs <intake_id_prefix> [--apply]'); process.exit(1); }

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS creds'); process.exit(1); }

async function ops(method, path) {
  const res = await fetch(`${OPS_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: OPS_KEY, Authorization: `Bearer ${OPS_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

async function main() {
  // Resolve prefix
  let intakeId = idPrefix;
  if (idPrefix.length < 36) {
    const recent = await ops('GET', `staged_intake_items?select=intake_id&order=created_at.desc&limit=500`);
    const matches = (recent.data || []).filter(r => r.intake_id.startsWith(idPrefix));
    if (matches.length !== 1) { console.error('Prefix not unique, matches:', matches.map(x => x.intake_id)); process.exit(1); }
    intakeId = matches[0].intake_id;
  }
  console.log(`Cleaning intake ${intakeId}  apply=${APPLY}`);

  // Latest extraction
  const ex = await ops('GET', `staged_intake_extractions?intake_id=eq.${intakeId}&order=created_at.desc&limit=1&select=id,created_at,extraction_snapshot`);
  if (!ex.ok || !ex.data?.length) { console.log('No extraction found'); return; }
  const latest = ex.data[0];
  const snap = latest.extraction_snapshot || {};
  console.log(`Latest extraction: ${latest.created_at}  addr="${snap.address}"  id=${latest.id}`);

  // Latest match
  const mt = await ops('GET', `staged_intake_matches?intake_id=eq.${intakeId}&order=created_at.desc&limit=1&select=id,created_at,reason,domain,property_id,confidence`);
  const latestMatch = mt.data?.[0] || null;
  if (latestMatch) console.log(`Latest match:      ${latestMatch.created_at}  ${latestMatch.reason}/${latestMatch.confidence} ${latestMatch.domain}/${latestMatch.property_id}  id=${latestMatch.id}`);

  if (!APPLY) { console.log('\nDry run — pass --apply to delete'); return; }

  // Delete
  const delEx = await ops('DELETE', `staged_intake_extractions?id=eq.${latest.id}`);
  console.log(`  deleted extraction: ${delEx.ok ? 'ok' : `err ${delEx.status}`}`);
  if (latestMatch) {
    const delMt = await ops('DELETE', `staged_intake_matches?id=eq.${latestMatch.id}`);
    console.log(`  deleted match: ${delMt.ok ? 'ok' : `err ${delMt.status}`}`);
  }
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
