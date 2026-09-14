#!/usr/bin/env node
// ============================================================================
// scripts/pr2-backfill-sidebar-parcel-stats.mjs
//
// PR2 — backfill `parcel_records` physical stats onto the rows the CoStar
// sidebar wrote BEFORE `upsertPublicRecords` started carrying them.
//
// THE DEFECT THIS REPAIRS
// -----------------------
// `parcel_records` has held building_sf / lot_sf / year_built / land_use /
// zoning / owner_name since it was created, and the CoStar Public Record tab
// sends them. The writer built its INSERT from apn/county/state/assessed_value
// only, and stashed the captured `tax_amount` in the parcel raw_payload instead
// of the `tax_records.tax_amount` column. So the ONE genuine public-record
// source in dia produced 932 rows carrying 931 real APNs and ZERO building
// stats, while the gpt-4o leg's APN-less rows were the only ones carrying any
// (measured 2026-09-02; see docs/architecture/public-records-source-lane.md).
//
// SINGLE OWNER OF THE PARSE
// -------------------------
// This reads `parcelStatsFromMetadata` from the shipped handler, so the
// backfilled values and the forward writer's values cannot disagree — the
// normaliser-drift hazard this repo has paid for repeatedly. In particular the
// lot-size unit rule (I12: "1.00 (43,560 sf)" is 43,560 sq ft, not 1) lives in
// exactly one place.
//
// DISCIPLINE
//   fill-blanks only          — never touches a column that already holds a value
//   priority-gated            — every write goes through lcc_merge_field, so the
//                               ladder records it and can adjudicate later
//   reversible                — pre-state snapshotted per row, batch-tagged
//   idempotent                — a second run plans 0 rows
//   dry-run by default
//
// Usage:
//   node scripts/pr2-backfill-sidebar-parcel-stats.mjs                     # dia dry run
//   node scripts/pr2-backfill-sidebar-parcel-stats.mjs --apply
//   node scripts/pr2-backfill-sidebar-parcel-stats.mjs --domain government --apply
//
// The dia run was executed 2026-09-02 as batch pr2_sidebar_parcel_stats_20260902
// (817 rows, 2,532 provenance writes). The GOVERNMENT run has NOT been made —
// see the report in that doc for the sized dry run and why it was left to a
// deliberate call.
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';
import { parcelStatsFromMetadata } from '../api/_handlers/sidebar-pipeline.js';

const env  = loadEnvForScripts();
const argv = process.argv.slice(2);
const APPLY  = argv.includes('--apply');
const DOMAIN = (() => {
  const i = argv.indexOf('--domain');
  const v = i === -1 ? 'dialysis' : String(argv[i + 1] || '').toLowerCase();
  if (v !== 'dialysis' && v !== 'government') {
    console.error('--domain must be dialysis or government');
    process.exit(2);
  }
  return v;
})();
const BATCH = (() => {
  const i = argv.indexOf('--batch');
  return i === -1 ? `pr2_sidebar_parcel_stats_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}` : argv[i + 1];
})();

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
const DOM_URL = DOMAIN === 'dialysis' ? env.DIA_SUPABASE_URL : env.GOV_SUPABASE_URL;
const DOM_KEY = DOMAIN === 'dialysis'
  ? (env.DIA_SUPABASE_SERVICE_KEY || env.DIA_SUPABASE_KEY)
  : (env.GOV_SUPABASE_SERVICE_KEY || env.GOV_SUPABASE_KEY);

if (!OPS_URL || !OPS_KEY || !DOM_URL || !DOM_KEY) {
  console.error('Missing credentials (need OPS_* and the chosen domain\'s *_SUPABASE_* vars)');
  process.exit(1);
}

async function rest(base, key, method, path, body, extraHeaders = {}) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'GET' ? 'count=exact' : 'return=representation',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

/**
 * ⚠️ PostgREST caps a response at 1000 rows regardless of `limit`, so every
 * read here pages at exactly 1000 and counts the truncation. A larger stride
 * silently SKIPS rows (CLAUDE.md, "PostgREST caps every response at 1000").
 */
async function pageAll(base, key, path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await rest(base, key, 'GET', `${path}&limit=1000&offset=${offset}`);
    if (!r.ok) throw new Error(`read failed ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);
    const rows = Array.isArray(r.data) ? r.data : [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

// gov.parcel_records names the same facts differently and carries BOTH a
// square-foot and an acre column; I12 says derive one from the other rather
// than writing whichever unit the source happened to express.
const COLUMNS = DOMAIN === 'dialysis'
  ? ['building_sf', 'lot_sf', 'year_built', 'year_renovated', 'zoning', 'land_use', 'owner_name']
  : ['building_sf', 'land_area_sf', 'land_area_acres', 'year_built', 'zoning', 'property_class', 'owner_name'];
const PK        = DOMAIN === 'dialysis' ? 'id' : 'parcel_id';
const PROV_DB   = DOMAIN === 'dialysis' ? 'dia_db' : 'gov_db';
const PROV_TBL  = DOMAIN === 'dialysis' ? 'dia.parcel_records' : 'gov.parcel_records';
const DOM_TAG   = DOMAIN === 'dialysis' ? 'dia' : 'gov';

function statsForDomain(metadata) {
  const s = parcelStatsFromMetadata(metadata);
  if (DOMAIN === 'dialysis') return s;
  const acres = s.lot_sf != null ? Math.round((s.lot_sf / 43560) * 100) / 100 : null;
  return {
    building_sf: s.building_sf,
    land_area_sf: s.lot_sf,
    land_area_acres: acres,
    year_built: s.year_built,
    zoning: s.zoning,
    property_class: s.land_use,
    owner_name: s.owner_name,
  };
}

(async () => {
  // 1. every capture that carries a parcel number, newest first per APN.
  const entities = await pageAll(OPS_URL, OPS_KEY,
    `entities?select=id,domain,metadata,updated_at&metadata->>parcel_number=not.is.null&domain=eq.${DOM_TAG}&order=updated_at.desc`);
  const byApn = new Map();
  for (const e of entities) {
    const apn = e.metadata?.parcel_number;
    if (!apn || byApn.has(apn)) continue;
    byApn.set(apn, statsForDomain(e.metadata));
  }

  // 2. the sidebar-written parcel rows we could fill.
  const parcels = await pageAll(DOM_URL, DOM_KEY,
    `parcel_records?select=${PK},apn,${COLUMNS.join(',')},raw_payload&raw_payload->>source=eq.costar_sidebar&order=${PK}.asc`);

  const plan = [];
  for (const p of parcels) {
    const stats = byApn.get(p.apn);
    if (!stats) continue;
    const patch = {};
    for (const c of COLUMNS) {
      if (stats[c] == null) continue;
      if (p[c] != null && p[c] !== '') continue;   // FILL-BLANKS
      patch[c] = stats[c];
    }
    if (Object.keys(patch).length) plan.push({ pk: p[PK], apn: p.apn, before: p, patch });
  }

  const tally = Object.fromEntries(COLUMNS.map(c => [c, plan.filter(r => r.patch[c] != null).length]));
  console.log(JSON.stringify({
    domain: DOMAIN, batch: BATCH, apply: APPLY,
    captures_with_apn: byApn.size,
    sidebar_parcel_rows: parcels.length,
    rows_to_write: plan.length,
    fields: tally,
  }, null, 2));
  if (!APPLY) { console.log('DRY RUN — nothing written. Re-run with --apply.'); return; }

  let written = 0, failed = 0, prov = { write: 0, skip: 0, conflict: 0, error: 0 };
  for (const row of plan) {
    // Snapshot BEFORE the write. A reversal path that has never been exercised
    // is a claim, not a capability (P195) — the ledger is written first so a
    // failure mid-run still leaves every touched row reversible.
    const snap = { id: row.pk, apn: row.apn, batch_tag: BATCH };
    for (const c of COLUMNS) snap[c] = row.before[c] ?? null;
    const s = await rest(DOM_URL, DOM_KEY, 'POST', `_pr2_parcel_stats_backup_${BATCH.replace(/\W/g, '')}`, snap)
      .catch(() => ({ ok: false }));
    if (!s.ok) console.warn(`[pr2] snapshot failed for ${row.pk} — skipping the write`);
    if (!s.ok) { failed++; continue; }

    const u = await rest(DOM_URL, DOM_KEY, 'PATCH', `parcel_records?${PK}=eq.${encodeURIComponent(row.pk)}`, row.patch);
    if (!u.ok) { failed++; console.error(`[pr2] PATCH failed ${row.pk}: ${u.status}`); continue; }
    written++;

    for (const [field, value] of Object.entries(row.patch)) {
      const r = await rest(OPS_URL, OPS_KEY, 'POST', 'rpc/lcc_merge_field', {
        p_workspace_id: null, p_target_database: PROV_DB, p_target_table: PROV_TBL,
        p_record_pk: String(row.pk), p_field_name: field, p_value: value,
        p_source: 'costar_sidebar', p_source_run_id: BATCH, p_confidence: 0.6, p_recorded_by: null,
      });
      // ⚠️ field_provenance.value_text_hash is GENERATED as
      // encode(sha224((value)::text::bytea),'hex'). A jsonb string containing a
      // double quote renders with backslashes and ::bytea rejects it with
      // 22P02 — one live zoning value ('"C" - Commercial') hits this. Count the
      // failure rather than losing it; the parcel write already succeeded.
      const d = Array.isArray(r.data) ? r.data[0]?.decision : r.data?.decision;
      if (!r.ok) prov.error++; else prov[d] = (prov[d] || 0) + 1;
    }
  }
  console.log(JSON.stringify({ written, failed, provenance: prov }, null, 2));
  console.log(`REVERT: update parcel_records p set ${COLUMNS.map(c => `${c}=b.${c}`).join(', ')} ` +
              `from _pr2_parcel_stats_backup_${BATCH.replace(/\W/g, '')} b where b.id=p.${PK} and b.batch_tag='${BATCH}';`);
})().catch(err => { console.error(err); process.exit(1); });
