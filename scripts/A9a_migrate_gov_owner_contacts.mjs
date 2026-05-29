#!/usr/bin/env node
// ============================================================================
// scripts/A9a_migrate_gov_owner_contacts.mjs
// OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Track A9a (owner subset)
//
// Migrates the owner-linked rows of gov.unified_contacts into the canonical
// LCC Opps unified_contacts hub (Decision #1: LCC Opps is the single contact
// hub; dia/gov contacts become projections).
//
// SCOPE (this script): only gov.unified_contacts rows WHERE recorded_owner_id
// IS NOT NULL — the ~13,403 rows tied to a gov property owner. The
// Salesforce-linked-only rows (~16,990) and the dia projection (A9b) are
// separate, later steps.
//
// WHY a workstation script (not pg_net / in-DB): LCC Opps has no gov DB
// credentials in its vault (the BD-engine tables were seeded by a one-shot
// workstation backfill, not the in-DB pg_net sync). This script follows that
// established pattern (cf. scripts/geocode-properties-backfill.mjs,
// scripts/merge-duplicate-owners.mjs) — run it from a machine that has BOTH
// the GOV and OPS service keys in env.
//
// SAFETY / REVERSIBILITY:
//   - DRY-RUN by default. Pass --apply to write.
//   - Preserves each gov row's unified_id (so any FK referencing it survives).
//   - Idempotent: upserts with on_conflict=unified_id, resolution=ignore-
//     duplicates — re-running skips rows already migrated, never duplicates.
//   - 1:1 migration, NO destructive collapse. The ~6 gov rows that share a
//     recorded_owner_id are migrated as-is (distinct unified_ids); deduping
//     unified_contacts is a separate concern (a future contact-dedup pass),
//     not this migration's job.
//   - Every migrated row is tagged field_sources->>'_a9a_migrated' = <run_id>.
//     Full rollback:
//       DELETE FROM unified_contacts WHERE field_sources ? '_a9a_migrated';
//   - A1 dedup remap: a gov row whose recorded_owner_id points at an
//     A1-merged loser is remapped to the surviving canonical owner. (Currently
//     0 such rows — a future-proof safety net.)
//
// Required env (set in .env.local or the shell):
//   GOV_SUPABASE_URL, GOV_SUPABASE_SERVICE_KEY (or GOV_SUPABASE_KEY)
//   OPS_SUPABASE_URL, OPS_SUPABASE_SERVICE_KEY (or OPS_SUPABASE_KEY)
//
// Usage:
//   node scripts/A9a_migrate_gov_owner_contacts.mjs                  # dry-run
//   node scripts/A9a_migrate_gov_owner_contacts.mjs --limit=200      # dry-run, capped
//   node scripts/A9a_migrate_gov_owner_contacts.mjs --apply          # live migrate
//   node scripts/A9a_migrate_gov_owner_contacts.mjs --apply --batch=500
//
// Flags:
//   --apply       Write to OPS. Without it, fetch + transform + report only.
//   --limit=N     Cap source rows processed (default: all).
//   --batch=N     Rows per fetch page AND per upsert batch (default: 500).
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const arg = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const LIMIT = parseInt(arg('limit', '0'), 10) || Infinity;
const BATCH = Math.min(parseInt(arg('batch', '500'), 10), 1000);

const RUN_ID = `A9a_gov_owner_contacts_${new Date().toISOString().slice(0, 10).replace(/-/g, '_')}`;

const GOV_URL = env.GOV_SUPABASE_URL;
const GOV_KEY = env.GOV_SUPABASE_SERVICE_KEY || env.GOV_SUPABASE_KEY;
const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_SERVICE_KEY || env.OPS_SUPABASE_KEY;

if (!GOV_URL || !GOV_KEY) { console.error('Missing GOV_SUPABASE_URL / _SERVICE_KEY'); process.exit(1); }
if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS_SUPABASE_URL / _SERVICE_KEY'); process.exit(1); }

// Columns present on BOTH gov + LCC unified_contacts. (gov-only:
// teams_user_id/last_activity_date/total_touches/email_aliases; LCC-only:
// sf_last_synced — both intentionally omitted.) unified_id + recorded_owner_id
// + field_sources are handled explicitly below, so they're excluded here.
const CARRY_COLS = [
  'contact_class', 'first_name', 'last_name', 'full_name',
  'email', 'email_secondary', 'phone', 'mobile_phone', 'title', 'company_name',
  'city', 'state', 'website', 'entity_type', 'contact_type', 'industry',
  'is_1031_buyer', 'total_transactions', 'total_volume', 'avg_cap_rate',
  'sf_contact_id', 'sf_account_id', 'gov_contact_id', 'dia_contact_id', 'true_owner_id',
  'outlook_contact_id', 'webex_person_id', 'icloud_contact_id',
  'last_call_date', 'last_email_date', 'last_meeting_date',
  'total_calls', 'total_emails_sent', 'engagement_score',
  'match_confidence', 'match_method', 'merge_history', 'email_stale', 'phone_stale',
  'created_at', 'last_synced_sf', 'last_synced_outlook', 'last_synced_calendar',
];
const SELECT_COLS = ['unified_id', 'recorded_owner_id', 'field_sources', ...CARRY_COLS].join(',');

async function rest(baseUrl, key, method, path, body, extraHeaders = {}) {
  const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
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

// Best-effort audit_run_log wrapper on OPS. Tolerates signature drift so a
// logging hiccup never aborts (or, worse, half-aborts) the migration.
async function auditBegin(plannedCount) {
  try {
    const r = await rest(OPS_URL, OPS_KEY, 'POST', 'rpc/audit_run_begin', {
      p_run_id: RUN_ID, p_step: 'A9a_unified_contacts_migration', p_target_database: 'gov',
      p_dry_run: false, p_rows_before: plannedCount,
      p_notes: 'A9a: migrate gov.unified_contacts owner-linked rows into LCC Opps unified_contacts (preserve unified_id, A1-canonical remap, idempotent).',
      p_metadata: { scope: 'recorded_owner_id_not_null', run_id: RUN_ID },
    });
    if (r.ok) return Array.isArray(r.data) ? r.data[0] : r.data;
    console.warn(`[audit] begin RPC returned HTTP ${r.status}: ${r.text} — continuing without audit row`);
  } catch (e) {
    console.warn(`[audit] begin failed (${e.message}) — continuing without audit row`);
  }
  return null;
}
async function auditFinish(logId, status, rows, errMsg) {
  if (logId == null) return;
  try {
    await rest(OPS_URL, OPS_KEY, 'POST', 'rpc/audit_run_finish', {
      p_log_id: logId, p_status: status, p_rows_affected: rows,
      p_rows_after: null, p_error: errMsg || null,
    });
  } catch (e) {
    console.warn(`[audit] finish failed (${e.message})`);
  }
}

async function buildA1RemapMap() {
  // gov.recorded_owners losers -> survivors (A1 dedup output).
  const map = new Map();
  let cursor = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const r = await rest(GOV_URL, GOV_KEY, 'GET',
      `recorded_owners?select=recorded_owner_id,merged_into_recorded_owner_id`
      + `&merged_into_recorded_owner_id=not.is.null`
      + `&recorded_owner_id=gt.${cursor}&order=recorded_owner_id.asc&limit=1000`);
    if (!r.ok) throw new Error(`A1 remap fetch failed: HTTP ${r.status} ${r.text}`);
    if (!r.data?.length) break;
    for (const row of r.data) map.set(row.recorded_owner_id, row.merged_into_recorded_owner_id);
    cursor = r.data[r.data.length - 1].recorded_owner_id;
    if (r.data.length < 1000) break;
  }
  return map;
}

function resolveCanonical(ownerId, remap) {
  // Resolve at most a few hops in case A1 ever produced a chain.
  let id = ownerId, hops = 0;
  while (remap.has(id) && hops < 5) { id = remap.get(id); hops++; }
  return id;
}

function toHubRow(govRow, remap, stats) {
  const canonical = resolveCanonical(govRow.recorded_owner_id, remap);
  if (canonical !== govRow.recorded_owner_id) stats.remapped++;
  const fieldSources = (govRow.field_sources && typeof govRow.field_sources === 'object')
    ? { ...govRow.field_sources } : {};
  fieldSources._a9a_migrated = RUN_ID;
  fieldSources.recorded_owner_id = 'gov.unified_contacts';
  const row = {
    unified_id: govRow.unified_id,
    recorded_owner_id: canonical,
    field_sources: fieldSources,
    updated_at: new Date().toISOString(),
  };
  for (const c of CARRY_COLS) row[c] = govRow[c] ?? null;
  // contact_class is NOT NULL on the hub (default 'business'); never send null.
  if (row.contact_class == null) row.contact_class = 'business';
  return row;
}

async function main() {
  console.log(`[A9a] run_id=${RUN_ID} apply=${APPLY} limit=${LIMIT === Infinity ? 'all' : LIMIT} batch=${BATCH}`);
  console.log('[A9a] building A1 canonical remap map from gov.recorded_owners…');
  const remap = await buildA1RemapMap();
  console.log(`[A9a] A1 remap entries (merged losers): ${remap.size}`);

  const stats = { fetched: 0, transformed: 0, remapped: 0, upserted: 0, batches: 0 };
  const pendingByCanonical = new Map(); // canonical_owner_id -> first unified_id (collapse observability only)
  let buffer = [];
  let cursor = '00000000-0000-0000-0000-000000000000';

  const flush = async () => {
    if (!buffer.length) return;
    stats.batches++;
    if (APPLY) {
      const r = await rest(OPS_URL, OPS_KEY, 'POST',
        'unified_contacts?on_conflict=unified_id', buffer,
        { Prefer: 'resolution=ignore-duplicates,return=minimal' });
      if (!r.ok) throw new Error(`Upsert batch ${stats.batches} failed: HTTP ${r.status} ${r.text}`);
    }
    stats.upserted += buffer.length;
    process.stdout.write(`\r[A9a] ${APPLY ? 'upserted' : 'prepared'} ${stats.upserted} rows (${stats.batches} batches)…`);
    buffer = [];
  };

  for (;;) {
    if (stats.fetched >= LIMIT) break;
    const want = Math.min(BATCH, LIMIT - stats.fetched);
    const r = await rest(GOV_URL, GOV_KEY, 'GET',
      `unified_contacts?select=${SELECT_COLS}`
      + `&recorded_owner_id=not.is.null`
      + `&unified_id=gt.${cursor}&order=unified_id.asc&limit=${want}`);
    if (!r.ok) throw new Error(`Source fetch failed: HTTP ${r.status} ${r.text}`);
    if (!r.data?.length) break;

    for (const govRow of r.data) {
      stats.fetched++;
      const hubRow = toHubRow(govRow, remap, stats);
      stats.transformed++;
      const canon = hubRow.recorded_owner_id;
      if (canon != null) {
        if (pendingByCanonical.has(canon)) stats.collapseObserved = (stats.collapseObserved || 0) + 1;
        else pendingByCanonical.set(canon, hubRow.unified_id);
      }
      buffer.push(hubRow);
      if (buffer.length >= BATCH) await flush();
    }
    cursor = r.data[r.data.length - 1].unified_id;
    if (r.data.length < want) break;
  }
  await flush();
  process.stdout.write('\n');

  let logId = null;
  if (APPLY) logId = await auditBegin(stats.transformed);

  console.log('\n──────── A9a summary ────────');
  console.log(`source owner-linked rows fetched : ${stats.fetched}`);
  console.log(`transformed                       : ${stats.transformed}`);
  console.log(`A1-remapped to canonical owner    : ${stats.remapped}`);
  console.log(`distinct canonical owners         : ${pendingByCanonical.size}`);
  console.log(`same-owner collapses observed     : ${stats.collapseObserved || 0} (migrated as-is, not collapsed)`);
  console.log(`${APPLY ? 'rows upserted to OPS' : 'rows that WOULD be upserted'} : ${stats.upserted}`);
  console.log(`batches                           : ${stats.batches}`);
  if (!APPLY) console.log('\nDRY RUN — no writes. Re-run with --apply to migrate.');
  else console.log(`\nAPPLIED. Rollback: DELETE FROM unified_contacts WHERE field_sources ? '_a9a_migrated';`);

  if (APPLY) await auditFinish(logId, 'succeeded', stats.upserted, null);
}

main().catch(async (err) => {
  console.error('\n[A9a] FATAL:', err.message);
  process.exit(1);
});
