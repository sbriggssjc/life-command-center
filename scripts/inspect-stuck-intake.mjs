#!/usr/bin/env node
// ============================================================================
// scripts/inspect-stuck-intake.mjs
//
// Deep inspection of a single stuck intake. Shows: item, all extractions,
// all matches, the promoter's last-known response (from raw_payload), the
// matched entity + its external_identities, and (if entity is lcc-bridged)
// the target gov/dia property_id lookup.
//
// Usage:
//   node scripts/inspect-stuck-intake.mjs <intake_id_prefix>
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const idPrefix = process.argv[2];
if (!idPrefix) { console.error('Usage: node scripts/inspect-stuck-intake.mjs <intake_id_prefix>'); process.exit(1); }

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
const GOV_URL = env.GOV_SUPABASE_URL;
const GOV_KEY = env.GOV_SUPABASE_KEY;
const DIA_URL = env.DIA_SUPABASE_URL;
const DIA_KEY = env.DIA_SUPABASE_KEY;
if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS_SUPABASE_URL/KEY'); process.exit(1); }

async function rest(base, key, method, path) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}
const ops = (m, p) => rest(OPS_URL, OPS_KEY, m, p);
const gov = (m, p) => GOV_URL && GOV_KEY ? rest(GOV_URL, GOV_KEY, m, p) : Promise.resolve({ ok: false });
const dia = (m, p) => DIA_URL && DIA_KEY ? rest(DIA_URL, DIA_KEY, m, p) : Promise.resolve({ ok: false });

function truncate(s, n) {
  if (s == null) return null;
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

async function main() {
  // Resolve prefix to full intake_id: fetch recent and filter client-side
  // (PostgREST uuid LIKE needs a cast, easier to just do it here)
  let intakeId = idPrefix;
  if (idPrefix.length < 36) {
    const recent = await ops('GET', `staged_intake_items?select=intake_id&order=created_at.desc&limit=500`);
    if (!recent.ok) { console.error('Fetch recent failed:', recent.status, recent.data); process.exit(1); }
    const matches = (recent.data || []).filter(r => r.intake_id.startsWith(idPrefix));
    if (matches.length === 0) { console.error('No intake found with prefix', idPrefix); process.exit(1); }
    if (matches.length > 1) { console.error('Ambiguous prefix, matches:', matches.map(x => x.intake_id)); process.exit(1); }
    intakeId = matches[0].intake_id;
  }
  console.log(`\n=== Intake ${intakeId} ===\n`);

  // 1. Item
  const itm = await ops('GET', `staged_intake_items?intake_id=eq.${intakeId}&select=*&limit=1`);
  const item = itm.data[0];
  console.log('ITEM:');
  console.log(`  status=${item.status}  source_type=${item.source_type}  created_at=${item.created_at}`);
  if (item.raw_payload?.extraction_result) {
    console.log(`  last_extraction_result: ${JSON.stringify(item.raw_payload.extraction_result).slice(0, 200)}`);
  }

  // 2. All extractions
  const exs = await ops('GET', `staged_intake_extractions?intake_id=eq.${intakeId}&order=created_at.asc&select=id,document_type,extraction_snapshot,created_at`);
  console.log(`\nEXTRACTIONS (${exs.data?.length || 0}):`);
  for (const e of exs.data || []) {
    const s = e.extraction_snapshot || {};
    console.log(`  ${e.created_at}  ${e.document_type}  addr=${s.address || '—'}  state=${s.state || '—'}  city=${s.city || '—'}  tenant=${s.tenant_name || '—'}`);
  }

  // 3. All match rows
  const mts = await ops('GET', `staged_intake_matches?intake_id=eq.${intakeId}&order=created_at.asc&select=decision,reason,domain,property_id,confidence,match_result,created_at`);
  console.log(`\nMATCHES (${mts.data?.length || 0}):`);
  for (const m of mts.data || []) {
    console.log(`  ${m.created_at}  ${m.decision}  reason=${m.reason}  domain=${m.domain}  prop=${m.property_id}  conf=${m.confidence}`);
  }

  // 4. Last match → inspect matched entity (if domain=lcc)
  const lastMatch = mts.data?.[mts.data.length - 1];
  if (lastMatch && lastMatch.property_id) {
    if (lastMatch.domain === 'lcc') {
      console.log(`\nMATCHED LCC ENTITY ${lastMatch.property_id}:`);
      const ent = await ops('GET', `entities?id=eq.${lastMatch.property_id}&select=id,name,domain,metadata,state,address,city`);
      const e = ent.data?.[0];
      if (!e) { console.log('  (not found)'); }
      else {
        console.log(`  name="${e.name}"  domain=${e.domain}  state=${e.state}`);
        console.log(`  metadata.domain_property_id=${e.metadata?.domain_property_id || '—'}`);
        console.log(`  metadata._pipeline_summary.domain_property_id=${e.metadata?._pipeline_summary?.domain_property_id || '—'}`);

        // External identities
        const xid = await ops('GET', `external_identities?entity_id=eq.${lastMatch.property_id}&select=source_system,source_type,external_id,last_synced_at`);
        console.log(`  external_identities (${xid.data?.length || 0}):`);
        for (const x of xid.data || []) {
          console.log(`    ${x.source_system}/${x.source_type}  external_id=${x.external_id}`);
        }

        // If entity has gov_db/dia_db bridge, confirm domain property exists
        const domainBridge = (xid.data || []).find(x => x.source_system === 'gov_db' || x.source_system === 'dia_db');
        if (domainBridge) {
          const dq = domainBridge.source_system === 'gov_db' ? gov : dia;
          const prop = await dq('GET', `properties?property_id=eq.${domainBridge.external_id}&select=property_id,address,city,state&limit=1`);
          console.log(`  domain property lookup (${domainBridge.source_system} ${domainBridge.external_id}):`, prop.ok && prop.data?.length ? prop.data[0] : 'NOT FOUND');
        } else {
          console.log(`  (no gov_db/dia_db bridge — promoter will try address-lookup fallback)`);
          // Try the fallback lookup
          if (e.domain === 'government' || e.domain === 'dialysis') {
            const dq = e.domain === 'government' ? gov : dia;
            const addrLike = String(e.name || '').split(',')[0];
            const path = `properties?address=ilike.*${encodeURIComponent(addrLike)}*${e.state ? `&state=eq.${encodeURIComponent(e.state)}` : ''}&select=property_id,address,city,state&limit=5`;
            const r = await dq('GET', path);
            console.log(`  address-lookup fallback (${e.domain} ilike "${addrLike}" state=${e.state}):`, r.ok ? `${r.data?.length || 0} candidates` : `failed ${r.status}`);
            if (r.ok) for (const c of r.data || []) console.log(`    ${c.property_id}: ${c.address}, ${c.city}, ${c.state}`);
          }
        }
      }
    } else {
      console.log(`\nMATCHED DOMAIN ${lastMatch.domain} property_id=${lastMatch.property_id}:`);
      const dq = lastMatch.domain === 'government' ? gov : dia;
      const prop = await dq('GET', `properties?property_id=eq.${lastMatch.property_id}&select=property_id,address,city,state&limit=1`);
      console.log(`  ${prop.ok && prop.data?.length ? JSON.stringify(prop.data[0]) : 'NOT FOUND'}`);
    }
  }

  // 5. Promotion row (if any)
  const pr = await ops('GET', `staged_intake_promotions?intake_id=eq.${intakeId}&select=promoted_at,entity_id,pipeline_result&order=promoted_at.desc&limit=1`);
  console.log(`\nPROMOTION: ${pr.data?.length ? JSON.stringify({ promoted_at: pr.data[0].promoted_at, entity_id: pr.data[0].entity_id, result_summary: truncate(pr.data[0].pipeline_result, 200) }) : 'NONE'}`);

  console.log('');
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
