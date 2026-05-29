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

// JS port of LCC's lcc_normalize_entity_name(). Used on BOTH entities.name and
// dia.true_owners.name — since the SAME function normalizes both sides, the
// keys match each other regardless of any tiny JS-vs-PG divergence (we do NOT
// rely on the stored entities.canonical_name, which uses a lighter normalization).
// Clean punctuation to spaces FIRST (so "L.L.C." → "l l c", "Inc." → "inc"),
// THEN strip legal/suffix tokens including de-dotted acronym forms. This makes
// "...LLC" and "...L.L.C." normalize identically — what the PG function's
// boundary regex misses on trailing dots. Consistency across both sides is the
// goal (we don't compare to the stored canonical_name).
const _SUFFIX_RE = /\b(l l c|llc|l p|lp|llp|inc|corp|corporation|company|co|trust|holdings|properties|partners|capital|group|the|n a|na)\b/g;
function normEntityName(name) {
  if (name == null) return null;
  let v = String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  v = v.replace(_SUFFIX_RE, ' ').replace(/\s+/g, ' ').trim();
  return v.length < 4 ? null : v;
}

async function main() {
  console.log(`[G7-dia] apply=${APPLY} batch=${BATCH}`);

  // Source 1: dia.true_owners.lcc_canonical_entity_id (owner → entity, authoritative).
  // Also pull name for the source-3 name-match. (lcc_canonical_entity_id is empty
  // until/unless a write-back populates it — the BD sync is a one-way pull and does
  // NOT populate it, so source 3 is the real coverage path today.)
  console.log('[G7-dia] loading all dia.true_owners (id, canonical entity, name)…');
  const trueOwners = await pageAll(DIA_URL, DIA_KEY, 'true_owners',
    'true_owner_id,lcc_canonical_entity_id,name', '',
    'true_owner_id', '00000000-0000-0000-0000-000000000000');
  const ownerToEntity = new Map(
    trueOwners.filter(o => o.lcc_canonical_entity_id).map(o => [o.true_owner_id, o.lcc_canonical_entity_id]));
  console.log(`[G7-dia]   true_owners total: ${trueOwners.length}; with canonical entity: ${ownerToEntity.size}`);

  // Source 2: LCC lcc_entity_portfolio_facts (current owner → entity), dia only
  console.log('[G7-dia] loading lcc_entity_portfolio_facts (dia, current) → entity map…');
  const pf = await pageAll(OPS_URL, OPS_KEY, 'lcc_entity_portfolio_facts',
    'source_property_id,entity_id', '&source_domain=eq.dia&is_current=eq.true',
    'source_property_id', '');
  const propToEntity = new Map(pf.map(f => [String(f.source_property_id), f.entity_id]));
  console.log(`[G7-dia]   portfolio_facts dia current links: ${propToEntity.size}`);

  // Source 3: name-match dia.true_owners → LCC entities (organization, dia/dialysis).
  // Re-normalize both sides with the same normEntityName; drop ambiguous keys
  // (a normalized name that maps to >1 distinct entity — don't guess).
  console.log('[G7-dia] loading LCC entities (organization, dia) for name-match…');
  const ents = await pageAll(OPS_URL, OPS_KEY, 'entities',
    'id,name', "&entity_type=eq.organization&domain=in.(dia,dialysis)&name=not.is.null",
    'id', '00000000-0000-0000-0000-000000000000');
  const normToEntity = new Map();   // norm-name → entity_id
  const ambiguous = new Set();
  for (const e of ents) {
    const nn = normEntityName(e.name);
    if (!nn) continue;
    if (normToEntity.has(nn) && normToEntity.get(nn) !== e.id) { ambiguous.add(nn); }
    else if (!normToEntity.has(nn)) { normToEntity.set(nn, e.id); }
  }
  for (const nn of ambiguous) normToEntity.delete(nn);
  // owner → entity via name
  const ownerToEntityByName = new Map();
  for (const o of trueOwners) {
    const nn = normEntityName(o.name);
    if (nn && normToEntity.has(nn)) ownerToEntityByName.set(o.true_owner_id, normToEntity.get(nn));
  }
  console.log(`[G7-dia]   org entities: ${ents.length}; unambiguous norm-names: ${normToEntity.size} (${ambiguous.size} ambiguous dropped); owners name-matched: ${ownerToEntityByName.size}`);

  // dia properties with an owner
  console.log('[G7-dia] loading dia.properties (with an owner)…');
  const props = await pageAll(DIA_URL, DIA_KEY, 'properties',
    'property_id,true_owner_id,recorded_owner_id,unified_id',
    '&or=(true_owner_id.not.is.null,recorded_owner_id.not.is.null)',
    'property_id', '0');
  console.log(`[G7-dia]   dia properties with an owner: ${props.length}`);

  const stats = { viaOwner: 0, viaPortfolio: 0, viaNameMatch: 0, unresolved: 0, changed: 0, batches: 0 };
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
    if (!entityId) {
      entityId = propToEntity.get(String(p.property_id)) || null;
      if (entityId) stats.viaPortfolio++;
    }
    if (!entityId && p.true_owner_id) {
      entityId = ownerToEntityByName.get(p.true_owner_id) || null;
      if (entityId) stats.viaNameMatch++;
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
  console.log(`resolved via true_owner→entity id  : ${stats.viaOwner}  (lcc_canonical_entity_id; ~0 unless written back)`);
  console.log(`resolved via portfolio_facts       : ${stats.viaPortfolio}  (authoritative current owner)`);
  console.log(`resolved via owner name-match      : ${stats.viaNameMatch}  (true_owner.name ↔ entity.name)`);
  console.log(`unresolved (no entity link)        : ${stats.unresolved}`);
  console.log(`${APPLY ? 'rows updated' : 'rows that WOULD update'}            : ${stats.changed}`);
  if (!APPLY) console.log('\nDRY RUN — no writes. Re-run with --apply.');
  else console.log('\nAPPLIED. Unresolved owners have no matching org entity (yet) — they fill in as entities/owners are added or deduped.');
}

main().catch((err) => { console.error('\n[G7-dia] FATAL:', err.message); process.exit(1); });
