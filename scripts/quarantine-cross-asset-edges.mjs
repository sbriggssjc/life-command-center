#!/usr/bin/env node
/**
 * Quarantine known same-batch cross-asset graph contamination.
 *
 * Dry-run by default. Apply mode PATCHes entity_relationships.metadata with a
 * reversible quarantine marker; it does not delete rows.
 *
 * Usage:
 *   node scripts/quarantine-cross-asset-edges.mjs --asset=<uuid> --dry-run
 *   node scripts/quarantine-cross-asset-edges.mjs --asset=<uuid> --apply
 */

import fs from 'node:fs';
import process from 'node:process';

loadDotEnvLocal();

const args = parseArgs(process.argv.slice(2));
const APPLY = args.apply === true || args.apply === 'true';
const ASSET = args.asset || 'bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0';
const OPS = {
  url: process.env.OPS_SUPABASE_URL,
  key: process.env.OPS_SUPABASE_KEY || process.env.OPS_SUPABASE_SERVICE_KEY,
};
const BAD_PARTIES = [
  { pattern: 'Radar Woodbridge', roles: new Set(['purchases']), reason: 'cross_asset_radar_woodbridge_purchase' },
  { pattern: 'Clue Drive', roles: new Set(['sells']), reason: 'cross_asset_clue_drive_sell' },
];

function loadDotEnvLocal() {
  if (!fs.existsSync('.env.local')) return;
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key]) continue;
    process.env[key] = m[2].trim().replace(/^"|"$/g, '');
  }
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else out[a.slice(2)] = true;
  }
  return out;
}

async function rest(method, path, body = null) {
  const resp = await fetch(OPS.url.replace(/\/$/, '') + '/rest/v1/' + path, {
    method,
    headers: {
      apikey: OPS.key,
      Authorization: `Bearer ${OPS.key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: resp.ok, status: resp.status, data };
}

async function findPartyEntities(pattern) {
  const r = await rest('GET', `entities?name=ilike.*${encodeURIComponent(pattern)}*&select=id,name&limit=100`);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

async function main() {
  if (!OPS.url || !OPS.key) {
    console.error('Missing OPS_SUPABASE_URL / OPS_SUPABASE_KEY');
    process.exit(1);
  }
  const report = { mode: APPLY ? 'apply' : 'dry-run', asset: ASSET, candidates: [], quarantined: 0 };
  for (const spec of BAD_PARTIES) {
    const parties = await findPartyEntities(spec.pattern);
    if (!parties.length) continue;
    const ids = parties.map(p => p.id).join(',');
    const rels = await rest('GET',
      `entity_relationships?from_entity_id=in.(${ids})&to_entity_id=eq.${encodeURIComponent(ASSET)}` +
      '&relationship_type=in.(purchases,sells)&select=id,from_entity_id,relationship_type,metadata,created_at');
    for (const rel of rels.ok && Array.isArray(rels.data) ? rels.data : []) {
      if (!spec.roles.has(rel.relationship_type)) continue;
      const party = parties.find(p => p.id === rel.from_entity_id);
      const patch = {
        ...(rel.metadata && typeof rel.metadata === 'object' ? rel.metadata : {}),
        quarantined: true,
        quarantine_reason: spec.reason,
        quarantine_source: 'quarantine-cross-asset-edges',
        quarantined_at: new Date().toISOString(),
      };
      report.candidates.push({ id: rel.id, party: party?.name || rel.from_entity_id, relationship_type: rel.relationship_type, created_at: rel.created_at, reason: spec.reason });
      if (APPLY) {
        const upd = await rest('PATCH', `entity_relationships?id=eq.${encodeURIComponent(rel.id)}`, { metadata: patch });
        if (upd.ok) report.quarantined++;
      }
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
