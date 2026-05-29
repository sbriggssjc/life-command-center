#!/usr/bin/env node
// ============================================================================
// scripts/A9b_backfill_parity_cols.mjs
// OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Track A9b, phase 1b (schema parity)
//
// Backfills the 3 gov-only "engagement" columns from gov.unified_contacts onto
// the matching LCC Opps hub rows (by unified_id):
//   email_aliases (text[]), last_activity_date (date), total_touches (int)
// (teams_user_id is all-null on gov — column added for parity, no backfill.)
//
// Phase 1a already ADDed these columns to the hub. This fills their values so
// the eventual govQuery→opsQuery contacts cutover shows the same data the app
// shows today.
//
// MECHANISM: bulk UPSERT with resolution=merge-duplicates. Every unified_id
// already exists in the hub (these are migrated rows), so each row hits the
// ON CONFLICT path and only the 3 columns in the payload are updated — nothing
// else is touched. Idempotent (re-running sets the same values). DRY-RUN by
// default.
//
// Only rows with meaningful data are sent (email_aliases non-empty OR
// last_activity_date NOT NULL OR total_touches > 0) — the rest already match
// the hub defaults ('{}' / NULL / 0).
//
// Required env: GOV_SUPABASE_URL + GOV_SUPABASE_SERVICE_KEY (or _KEY),
//               OPS_SUPABASE_URL + OPS_SUPABASE_SERVICE_KEY (or _KEY)
//
// Usage:
//   node scripts/A9b_backfill_parity_cols.mjs            # dry-run
//   node scripts/A9b_backfill_parity_cols.mjs --apply    # backfill
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const APPLY = process.argv.includes('--apply');
const BATCH = 500;

const GOV_URL = env.GOV_SUPABASE_URL;
const GOV_KEY = env.GOV_SUPABASE_SERVICE_KEY || env.GOV_SUPABASE_KEY;
const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_SERVICE_KEY || env.OPS_SUPABASE_KEY;
if (!GOV_URL || !GOV_KEY) { console.error('Missing GOV_SUPABASE_URL / _SERVICE_KEY'); process.exit(1); }
if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS_SUPABASE_URL / _SERVICE_KEY'); process.exit(1); }

async function rest(baseUrl, key, method, path, body, extraHeaders = {}) {
  const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: extraHeaders.Prefer || (method === 'GET' ? 'count=exact' : 'return=minimal'),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data, text };
}

// Existing hub unified_ids — so we only UPDATE rows that exist. Without this,
// the merge-duplicates upsert would INSERT junk (email-less) rows for any gov
// unified_id not in the hub (e.g. the 44 email-collision skips from A9a).
async function fetchHubUnifiedIds() {
  const set = new Set();
  let cursor = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const r = await rest(OPS_URL, OPS_KEY, 'GET',
      `unified_contacts?select=unified_id&unified_id=gt.${cursor}&order=unified_id.asc&limit=1000`);
    if (!r.ok) throw new Error(`Hub id fetch failed: HTTP ${r.status} ${r.text}`);
    if (!r.data?.length) break;
    for (const row of r.data) set.add(row.unified_id);
    cursor = r.data[r.data.length - 1].unified_id;
    if (r.data.length < 1000) break;
  }
  return set;
}

async function main() {
  console.log(`[A9b-parity] apply=${APPLY} batch=${BATCH}`);
  console.log('[A9b-parity] loading existing hub unified_ids (update-only guard)…');
  const hubIds = await fetchHubUnifiedIds();
  console.log(`[A9b-parity] hub has ${hubIds.size} rows`);
  const stats = { fetched: 0, skippedNotInHub: 0, updated: 0, batches: 0 };
  let buffer = [];
  let cursor = '00000000-0000-0000-0000-000000000000';

  const flush = async () => {
    if (!buffer.length) return;
    stats.batches++;
    if (APPLY) {
      const r = await rest(OPS_URL, OPS_KEY, 'POST',
        'unified_contacts?on_conflict=unified_id', buffer,
        { Prefer: 'resolution=merge-duplicates,return=minimal' });
      if (!r.ok) throw new Error(`Backfill batch ${stats.batches} failed: HTTP ${r.status} ${r.text}`);
    }
    stats.updated += buffer.length;
    process.stdout.write(`\r[A9b-parity] ${APPLY ? 'updated' : 'prepared'} ${stats.updated} rows (${stats.batches} batches)…`);
    buffer = [];
  };

  // Only rows with non-default values (PostgREST `or=`).
  const filter = '&or=(last_activity_date.not.is.null,total_touches.gt.0,email_aliases.neq.{})';

  for (;;) {
    const r = await rest(GOV_URL, GOV_KEY, 'GET',
      `unified_contacts?select=unified_id,email_aliases,last_activity_date,total_touches`
      + filter
      + `&unified_id=gt.${cursor}&order=unified_id.asc&limit=${BATCH}`);
    if (!r.ok) throw new Error(`Source fetch failed: HTTP ${r.status} ${r.text}`);
    if (!r.data?.length) break;
    for (const row of r.data) {
      stats.fetched++;
      if (!hubIds.has(row.unified_id)) { stats.skippedNotInHub++; continue; }
      buffer.push({
        unified_id: row.unified_id,
        email_aliases: row.email_aliases ?? [],
        last_activity_date: row.last_activity_date ?? null,
        total_touches: row.total_touches ?? 0,
      });
      if (buffer.length >= BATCH) await flush();
    }
    cursor = r.data[r.data.length - 1].unified_id;
    if (r.data.length < BATCH) break;
  }
  await flush();
  process.stdout.write('\n');

  console.log('\n──────── A9b parity backfill summary ────────');
  console.log(`gov rows with parity data fetched : ${stats.fetched}`);
  console.log(`skipped (unified_id not in hub)    : ${stats.skippedNotInHub}`);
  console.log(`${APPLY ? 'hub rows updated' : 'hub rows that WOULD be updated'} : ${stats.updated}`);
  console.log(`batches                            : ${stats.batches}`);
  if (!APPLY) console.log('\nDRY RUN — no writes. Re-run with --apply.');
  else console.log('\nAPPLIED. (Only rows whose unified_id exists in the hub are touched; merge-duplicates updates only the 3 parity columns.)');
}

main().catch((err) => { console.error('\n[A9b-parity] FATAL:', err.message); process.exit(1); });
