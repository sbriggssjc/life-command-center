#!/usr/bin/env node
// ============================================================================
// scripts/backfill-sidebar-entity-bridges.mjs
//
// One-shot backfill for Bug C (2026-04-24 audit): sidebar-pipeline never
// wrote `external_identities` rows with source_system='gov_db'/'dia_db' to
// bridge LCC asset entities to their underlying gov/dia property_id.
// 14-day audit found 172 asset entities orphaned from the domain
// dashboards.
//
// What this does, per orphan asset entity:
//   1. Read the entity's address (from name, seed fields, or metadata)
//   2. Read the captured domain + domain_property_id from
//      metadata._pipeline_summary.domain_property_id (populated by
//      propagateToDomainDb even when the bridge row was missed)
//   3. If not found in metadata, do an address lookup against the domain
//      properties table to find the real property_id
//   4. Insert an external_identities row (source_system='gov_db'|'dia_db',
//      source_type='property', external_id=<property_id>)
//
// Usage:
//   node scripts/backfill-sidebar-entity-bridges.mjs                 # dry run
//   node scripts/backfill-sidebar-entity-bridges.mjs --apply
//   node scripts/backfill-sidebar-entity-bridges.mjs --apply --limit 50
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const LIMIT = (() => {
  const i = argv.indexOf('--limit');
  if (i === -1) return 500;
  const n = parseInt(argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
})();

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
const GOV_URL = env.GOV_SUPABASE_URL;
const GOV_KEY = env.GOV_SUPABASE_KEY;
const DIA_URL = env.DIA_SUPABASE_URL;
const DIA_KEY = env.DIA_SUPABASE_KEY;

if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS creds'); process.exit(1); }

async function rest(base, key, method, path, body) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'GET' ? 'count=exact' : 'return=minimal,resolution=merge-duplicates',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}
const ops = (m, p, b) => rest(OPS_URL, OPS_KEY, m, p, b);
const gov = (m, p, b) => (GOV_URL && GOV_KEY) ? rest(GOV_URL, GOV_KEY, m, p, b) : { ok: false, data: null };
const dia = (m, p, b) => (DIA_URL && DIA_KEY) ? rest(DIA_URL, DIA_KEY, m, p, b) : { ok: false, data: null };

function normalizeAddress(addr) {
  if (!addr) return '';
  return String(addr).trim()
    .replace(/\bStreet\b/gi, 'St').replace(/\bAvenue\b/gi, 'Ave').replace(/\bBoulevard\b/gi, 'Blvd')
    .replace(/\bDrive\b/gi, 'Dr').replace(/\bRoad\b/gi, 'Rd').replace(/\bLane\b/gi, 'Ln')
    .replace(/\bCourt\b/gi, 'Ct').replace(/\bPlace\b/gi, 'Pl').replace(/\bHighway\b/gi, 'Hwy')
    .replace(/\bParkway\b/gi, 'Pkwy').replace(/\bCircle\b/gi, 'Cir').replace(/\bTrail\b/gi, 'Trl')
    .replace(/\s+/g, ' ').toLowerCase();
}

async function findDomainProperty(domain, entity) {
  // Step A — did propagateToDomainDb already capture the property_id in metadata?
  const metaId = entity.metadata?._pipeline_summary?.domain_property_id
              || entity.metadata?.domain_property_id
              || null;
  if (metaId) return { property_id: String(metaId), source: 'metadata' };

  // Step B — address lookup against the domain's properties table
  const addr = entity.name || entity.metadata?.address;
  const state = entity.metadata?.state || null;
  if (!addr) return null;

  const norm = normalizeAddress(addr);
  if (!norm) return null;

  const dq = domain === 'government' ? gov : dia;
  let path = `properties?address=ilike.${encodeURIComponent(norm)}&select=property_id,address,state,city&limit=5`;
  if (state) path += `&state=eq.${encodeURIComponent(state)}`;

  const r = await dq('GET', path);
  if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) return null;

  // Prefer the first row (address exact-equal case-insensitive)
  return { property_id: String(r.data[0].property_id), source: 'address_lookup' };
}

async function main() {
  console.log(`[sidebar-bridge-backfill] apply=${APPLY} limit=${LIMIT}`);

  // Fetch orphan asset entities: entity_type='asset', has source_system='costar' OR 'loopnet' OR 'crexi',
  // NO source_system='gov_db'/'dia_db' bridge row.
  const list = await ops('GET',
    `entities?entity_type=eq.asset` +
    `&select=id,workspace_id,name,domain,metadata,created_at` +
    `&order=created_at.desc&limit=${LIMIT}`
  );
  if (!list.ok) { console.error('list failed', list.status, list.data); process.exit(1); }

  const stats = { scanned: 0, bridged: 0, skipped_no_domain: 0, skipped_has_bridge: 0, no_match: 0, errors: 0 };

  for (const e of list.data || []) {
    stats.scanned += 1;

    if (!e.domain || (e.domain !== 'government' && e.domain !== 'dialysis')) {
      stats.skipped_no_domain += 1;
      continue;
    }

    // Does the entity already have a gov_db/dia_db external_identity?
    const existing = await ops('GET',
      `external_identities?entity_id=eq.${e.id}` +
      `&source_system=in.(gov_db,dia_db)&select=id&limit=1`
    );
    if (existing.ok && existing.data?.length) {
      stats.skipped_has_bridge += 1;
      continue;
    }

    // Resolve domain property_id
    const resolution = await findDomainProperty(e.domain, e);
    if (!resolution) {
      stats.no_match += 1;
      console.log(`  [miss] ${e.id.slice(0, 8)}… "${String(e.name).slice(0, 40)}" (${e.domain})`);
      continue;
    }

    const sourceSystem = e.domain === 'government' ? 'gov_db' : 'dia_db';

    if (!APPLY) {
      stats.bridged += 1;
      console.log(`  [dry] ${e.id.slice(0, 8)}… → ${sourceSystem} property_id=${resolution.property_id} (via ${resolution.source})`);
      continue;
    }

    const ins = await ops('POST',
      'external_identities?on_conflict=workspace_id,source_system,source_type,external_id',
      {
        workspace_id: e.workspace_id,
        entity_id:    e.id,
        source_system: sourceSystem,
        source_type:  'property',
        external_id:  resolution.property_id,
        metadata:     { synced_via: 'backfill-sidebar-entity-bridges.v1', source: resolution.source },
        last_synced_at: new Date().toISOString(),
      }
    );
    if (ins.ok) {
      stats.bridged += 1;
      console.log(`  [ok]  ${e.id.slice(0, 8)}… → ${sourceSystem} property_id=${resolution.property_id}`);
    } else {
      stats.errors += 1;
      console.warn(`  [err] ${e.id.slice(0, 8)}… ${ins.status}: ${JSON.stringify(ins.data).slice(0, 120)}`);
    }
  }

  console.log('[sidebar-bridge-backfill] done', stats);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
