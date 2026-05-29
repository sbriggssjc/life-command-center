#!/usr/bin/env node
// ============================================================================
// scripts/A9b_dia_property_unified_id.mjs
// OWNERSHIP_AND_SALES_REMEDIATION_PLAN — G7 (dia half)
//
// Backfills dia.properties.unified_id with the canonical LCC Opps entity
// (entities.id, uuid) for each property's owner — per Decision: dia properties
// link to the BD `entities` canonical layer (not the people-Contacts hub).
//
// Two sources, in preference order per property:
//   1. dia.true_owners.lcc_canonical_entity_id  (the owner's canonical entity;
//      authoritative, owner-based). EMPTY until the BD entity sync runs — once
//      it populates this column, re-run this script for FULL coverage of the
//      ~9,488 dia owner-properties.
//   2. lcc_entity_portfolio_facts (LCC Opps; current-owner→entity, is_current)
//      — authoritative for the ~1,159 dia properties it covers; available NOW.
//
// Idempotent, dry-run-first. Only UPDATEs rows it read from dia.properties
// (bulk upsert merge-duplicates on property_id — never inserts).
//
// Required env: DIA_SUPABASE_URL + DIA_SUPABASE_SERVICE_KEY (or _KEY),
//               OPS_SUPABASE_URL + OPS_SUPABASE_SERVICE_KEY (or _KEY)
//
// Usage:
//   node scripts/A9b_dia_property_unified_id.mjs            # dry-run
//   node scripts/A9b_dia_property_unified_id.mjs --apply
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const APPLY = process.argv.includes('--apply');
const BATCH = 500;

const DIA_URL = env.DIA_SUPABASE_URL;
const DIA_KEY = env.DIA_SUPABASE_SERVICE_KEY || env.DIA_SUPABASE_KEY;
const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_SERVICE_KEY || env.OPS_SUPABASE_KEY;
if (!DIA_URL || !DIA_KEY) { console.error('Missing DIA_SUPABASE_URL / _SERVICE_KEY'); process.exit(1); }
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

// Page a table by an ascending cursor column.
async function pageAll(baseUrl, key, table, select, filter, cursorCol, cursorStart) {
  const out = [];
  let cursor = cursorStart;
  for (;;) {
    const r = await rest(baseUrl, key, 'GET',
      `${table}?select=${select}${filter}&${cursorCol}=gt.${encodeURIComponent(cursor)}&order=${cursorCol}.asc&limit=1000`);
    if (!r.ok) throw new Error(`Fetch ${table} failed: HTTP ${r.status} ${r.text}`);
    if (!r.data?.length) break;
    out.push(...r.data);
    cursor = r.data[r.data.length - 1][cursorCol];
    if (r.data.length < 1000) break;
  }
  return out;
}

async function main() {
  console.log(`[G7-dia] apply=${APPLY} batch=${BATCH}`);

  // Source 1: dia.true_owners.lcc_canonical_entity_id (owner → entity)
  console.log('[G7-dia] loading dia.true_owners → entity map…');
  const trueOwners = await pageAll(DIA_URL, DIA_KEY, 'true_owners',
    'true_owner_id,lcc_canonical_entity_id', '&lcc_canonical_entity_id=not.is.null',
    'true_owner_id', '00000000-0000-0000-0000-000000000000');
  const ownerToEntity = new Map(trueOwners.map(o => [o.true_owner_id, o.lcc_canonical_entity_id]));
  console.log(`[G7-dia]   true_owners with canonical entity: ${ownerToEntity.size} (0 until the BD entity sync runs)`);

  // Source 2: LCC lcc_entity_portfolio_facts (current owner → entity), dia only
  console.log('[G7-dia] loading lcc_entity_portfolio_facts (dia, current) → entity map…');
  const pf = await pageAll(OPS_URL, OPS_KEY, 'lcc_entity_portfolio_facts',
    'source_property_id,entity_id', '&source_domain=eq.dia&is_current=eq.true',
    'source_property_id', '');
  const propToEntity = new Map(pf.map(f => [String(f.source_property_id), f.entity_id]));
  console.log(`[G7-dia]   portfolio_facts dia current links: ${propToEntity.size}`);

  // dia properties with an owner
  console.log('[G7-dia] loading dia.properties (with an owner)…');
  const props = await pageAll(DIA_URL, DIA_KEY, 'properties',
    'property_id,true_owner_id,recorded_owner_id,unified_id',
    '&or=(true_owner_id.not.is.null,recorded_owner_id.not.is.null)',
    'property_id', '0');
  console.log(`[G7-dia]   dia properties with an owner: ${props.length}`);

  const stats = { viaOwner: 0, viaPortfolio: 0, unresolved: 0, changed: 0, batches: 0 };
  let buffer = [];
  const flush = async () => {
    if (!buffer.length) return;
    stats.batches++;
    if (APPLY) {
      const r = await rest(DIA_URL, DIA_KEY, 'POST', 'properties?on_conflict=property_id', buffer,
        { Prefer: 'resolution=merge-duplicates,return=minimal' });
      if (!r.ok) throw new Error(`Update batch ${stats.batches} failed: HTTP ${r.status} ${r.text}`);
    }
    process.stdout.write(`\r[G7-dia] ${APPLY ? 'updated' : 'prepared'} ${stats.changed} rows (${stats.batches} batches)…`);
    buffer = [];
  };

  for (const p of props) {
    let entityId = (p.true_owner_id && ownerToEntity.get(p.true_owner_id)) || null;
    if (entityId) stats.viaOwner++;
    else {
      entityId = propToEntity.get(String(p.property_id)) || null;
      if (entityId) stats.viaPortfolio++;
    }
    if (!entityId) { stats.unresolved++; continue; }
    if (p.unified_id === entityId) continue;  // already correct
    stats.changed++;
    buffer.push({ property_id: p.property_id, unified_id: entityId });
    if (buffer.length >= BATCH) await flush();
  }
  await flush();
  process.stdout.write('\n');

  console.log('\n──────── G7-dia unified_id backfill summary ────────');
  console.log(`dia properties with an owner       : ${props.length}`);
  console.log(`resolved via true_owner→entity     : ${stats.viaOwner}  (grows once the BD entity sync runs)`);
  console.log(`resolved via portfolio_facts       : ${stats.viaPortfolio}  (authoritative, available now)`);
  console.log(`unresolved (no entity link yet)    : ${stats.unresolved}`);
  console.log(`${APPLY ? 'rows updated' : 'rows that WOULD update'}            : ${stats.changed}`);
  if (!APPLY) console.log('\nDRY RUN — no writes. Re-run with --apply.');
  else console.log('\nAPPLIED. Re-run after the BD entity sync populates dia.true_owners.lcc_canonical_entity_id for full coverage.');
}

main().catch((err) => { console.error('\n[G7-dia] FATAL:', err.message); process.exit(1); });
