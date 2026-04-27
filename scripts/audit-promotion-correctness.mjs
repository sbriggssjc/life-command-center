#!/usr/bin/env node
// ============================================================================
// audit-promotion-correctness.mjs - cross-reference each successfully-
//   promoted intake's extraction snapshot against the resolved domain
//   property to find: empty-extraction matches, address mismatches, and
//   high-frequency repeat matches.
//
// Reads:
//   - LCC Opps Supabase: staged_intake_promotions JOIN staged_intake_items
//   - Dialysis Supabase: dia.properties (uses `tenant` column)
//   - Government Supabase: gov.properties (uses `tenant_agency` column)
//
// Output: writes a CSV next to this script with one row per promoted intake,
// each tagged with mismatch_kind:
//   - OK_EXACT          - extraction.address ~= property.address
//   - OK_PARTIAL        - extraction.address shares the street number/name
//   - OK_NO_EXTRACTION  - extraction.address null but landed on a property (RISK)
//   - MISMATCH          - extraction.address differs materially from property.address
//   - REPEAT_>=3        - same property_id resolved by 3+ distinct intakes
//
// Required env (loaded by Run-IntakeRecovery.ps1 from .env.local):
//   OPS_SUPABASE_URL + OPS_SUPABASE_KEY
//   DIA_SUPABASE_URL + DIA_SUPABASE_KEY
//   GOV_SUPABASE_URL + GOV_SUPABASE_KEY
//   LCC_WORKSPACE_ID (optional, defaults to a0000000-...-001)
//
// Usage (from PowerShell wrapper):
//   .\scripts\Run-IntakeRecovery.ps1 -Mode AuditCorrectness
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const OPS_URL = process.env.OPS_SUPABASE_URL;
const OPS_KEY = process.env.OPS_SUPABASE_KEY;
const DIA_URL = process.env.DIA_SUPABASE_URL;
const DIA_KEY = process.env.DIA_SUPABASE_KEY;
const GOV_URL = process.env.GOV_SUPABASE_URL;
const GOV_KEY = process.env.GOV_SUPABASE_KEY;
const WORKSPACE_ID = process.env.LCC_WORKSPACE_ID
                  || process.env.LCC_DEFAULT_WORKSPACE_ID
                  || 'a0000000-0000-0000-0000-000000000001';
const LOOKBACK_HOURS = parseInt(process.env.LOOKBACK_HOURS || '24', 10);

const required = { OPS_URL, OPS_KEY, DIA_URL, DIA_KEY, GOV_URL, GOV_KEY };
for (const [k, v] of Object.entries(required)) {
  if (!v) { console.error(`Missing env var ${k.replace('_URL','_URL/_KEY')}.`); process.exit(1); }
}

const OUT_PATH = path.join(__dirname, 'audit-promotion-correctness-output.csv');

function pgrest(baseUrl, key, route, opts = {}) {
  const url = baseUrl.replace(/\/+$/, '') + '/rest/v1/' + route.replace(/^\/+/, '');
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  return fetch(url, { method: opts.method || 'GET', headers, body: opts.body });
}

async function pgrestJson(baseUrl, key, route) {
  const r = await pgrest(baseUrl, key, route);
  const text = await r.text();
  if (!r.ok) throw new Error(`PostgREST ${r.status} ${route}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`PostgREST non-JSON for ${route}: ${text.slice(0, 200)}`); }
}

function normAddress(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[.,#]/g, '')
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|highway|hwy|parkway|pkwy|circle|cir|court|ct|place|pl|terrace|ter|way|suite|ste|unit|apt)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressSimilarity(a, b) {
  const na = normAddress(a);
  const nb = normAddress(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  const ta = new Set(na.split(' ').filter(t => t.length > 1));
  const tb = new Set(nb.split(' ').filter(t => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

function classifyMatch(extractionAddr, propertyAddr) {
  if (!extractionAddr) return 'OK_NO_EXTRACTION';
  const sim = addressSimilarity(extractionAddr, propertyAddr);
  if (sim >= 0.8) return 'OK_EXACT';
  if (sim >= 0.5) return 'OK_PARTIAL';
  return 'MISMATCH';
}

async function main() {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  console.log(`Audit window: promoted_at >= ${since}`);
  console.log(`Workspace:    ${WORKSPACE_ID}`);

  console.log('\n[1/4] Fetching recent promotions from LCC Opps...');
  const promotionsRaw = await pgrestJson(
    OPS_URL, OPS_KEY,
    `staged_intake_promotions?workspace_id=eq.${WORKSPACE_ID}` +
    `&promoted_at=gte.${encodeURIComponent(since)}` +
    `&select=intake_id,promoted_at,pipeline_result&order=promoted_at.desc&limit=2000`
  );
  // Dedupe by intake_id, keeping the most recent promotion (results are
  // already sorted desc by promoted_at). Multiple bulk runs and re-promotes
  // produce many staged_intake_promotions rows per intake; for the audit we
  // only want the *current* resolved property.
  const seen = new Set();
  const promotions = [];
  for (const p of promotionsRaw) {
    if (seen.has(p.intake_id)) continue;
    seen.add(p.intake_id);
    promotions.push(p);
  }
  console.log(`   ${promotionsRaw.length} promotion rows (${promotions.length} distinct intake_ids after dedup).`);

  if (promotions.length === 0) {
    console.log('Nothing to audit. Exiting.');
    return;
  }

  console.log('\n[2/4] Fetching extraction snapshots for those intake_ids...');
  const intakeIds = promotions.map(p => p.intake_id);
  const items = {};
  for (let i = 0; i < intakeIds.length; i += 50) {
    const chunk = intakeIds.slice(i, i + 50);
    const inList = chunk.map(id => `"${id}"`).join(',');
    const rows = await pgrestJson(
      OPS_URL, OPS_KEY,
      `staged_intake_items?intake_id=in.(${inList})` +
      `&workspace_id=eq.${WORKSPACE_ID}` +
      `&select=intake_id,raw_payload`
    );
    for (const r of rows) items[r.intake_id] = r;
  }
  console.log(`   Fetched ${Object.keys(items).length} item rows.`);

  console.log('\n[3/4] Fetching resolved properties from dia/gov DBs...');
  const diaIds = new Set();
  const govIds = new Set();
  for (const p of promotions) {
    const pid = Number(p.pipeline_result?.domain_property_id);
    const dom = p.pipeline_result?.domain;
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (dom === 'dialysis')        diaIds.add(pid);
    else if (dom === 'government') govIds.add(pid);
  }
  // dia.properties has `tenant`; gov.properties uses `tenant_agency`.
  // Normalize into a shared `_tenant` field on each row.
  const diaProps = {};
  if (diaIds.size > 0) {
    const ids = [...diaIds];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100).join(',');
      const rows = await pgrestJson(DIA_URL, DIA_KEY,
        `properties?property_id=in.(${chunk})&select=property_id,address,city,state,tenant`);
      for (const r of rows) diaProps[r.property_id] = { ...r, _tenant: r.tenant };
    }
  }
  const govProps = {};
  if (govIds.size > 0) {
    const ids = [...govIds];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100).join(',');
      const rows = await pgrestJson(GOV_URL, GOV_KEY,
        `properties?property_id=in.(${chunk})&select=property_id,address,city,state,tenant_agency`);
      for (const r of rows) govProps[r.property_id] = { ...r, _tenant: r.tenant_agency };
    }
  }
  console.log(`   Fetched ${Object.keys(diaProps).length} dia + ${Object.keys(govProps).length} gov properties.`);

  console.log('\n[4/4] Classifying matches + writing CSV...');
  const propCounts = {};
  for (const p of promotions) {
    const pid = Number(p.pipeline_result?.domain_property_id);
    const dom = p.pipeline_result?.domain;
    if (Number.isFinite(pid) && pid > 0 && dom) {
      const key = `${dom}:${pid}`;
      propCounts[key] = (propCounts[key] || 0) + 1;
    }
  }

  const out = [];
  out.push([
    'intake_id', 'promoted_at', 'domain', 'domain_property_id',
    'extraction_address', 'extraction_city', 'extraction_state', 'extraction_tenant',
    'property_address', 'property_city', 'property_state', 'property_tenant',
    'address_similarity', 'mismatch_kind', 'repeat_count',
    'subject_or_source',
  ].join(','));

  let stats = { total: 0, OK_EXACT: 0, OK_PARTIAL: 0, OK_NO_EXTRACTION: 0, MISMATCH: 0, NO_PROPERTY: 0 };
  for (const p of promotions) {
    stats.total++;
    const item     = items[p.intake_id] || {};
    const snapshot = item.raw_payload?.extraction_snapshot
                  || item.raw_payload?.seed_data?.extraction_snapshot
                  || {};
    const exAddr  = snapshot.address  || null;
    const exCity  = snapshot.city     || null;
    const exState = snapshot.state    || null;
    const exTen   = snapshot.tenant_name || snapshot.primary_tenant || null;
    const subject = item.raw_payload?.seed_data?.subject || '';

    const pid = Number(p.pipeline_result?.domain_property_id);
    const dom = p.pipeline_result?.domain;
    const propRow = (dom === 'dialysis' ? diaProps[pid]
                  : dom === 'government' ? govProps[pid]
                  : null);

    if (!Number.isFinite(pid) || pid <= 0 || !propRow) {
      stats.NO_PROPERTY++;
      out.push([
        p.intake_id, p.promoted_at, dom || '', '',
        csvSafe(exAddr), csvSafe(exCity), csvSafe(exState), csvSafe(exTen),
        '', '', '', '',
        '', 'NO_PROPERTY', '',
        csvSafe(subject),
      ].join(','));
      continue;
    }

    const sim = addressSimilarity(exAddr, propRow.address);
    const kind = classifyMatch(exAddr, propRow.address);
    stats[kind]++;
    const repeats = propCounts[`${dom}:${pid}`] || 1;

    out.push([
      p.intake_id, p.promoted_at, dom, pid,
      csvSafe(exAddr), csvSafe(exCity), csvSafe(exState), csvSafe(exTen),
      csvSafe(propRow.address), csvSafe(propRow.city), csvSafe(propRow.state), csvSafe(propRow._tenant),
      sim.toFixed(2), kind, repeats >= 3 ? `REPEAT_${repeats}` : repeats,
      csvSafe(subject),
    ].join(','));
  }

  fs.writeFileSync(OUT_PATH, out.join('\n'), 'utf8');

  const topRepeats = Object.entries(propCounts)
    .filter(([_, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log('\n--- Summary ---');
  console.log(`Total promotions audited:  ${stats.total}`);
  console.log(`  OK_EXACT (sim>=0.8):     ${stats.OK_EXACT}`);
  console.log(`  OK_PARTIAL (sim>=0.5):   ${stats.OK_PARTIAL}`);
  console.log(`  OK_NO_EXTRACTION (RISK): ${stats.OK_NO_EXTRACTION}`);
  console.log(`  MISMATCH (RISK):         ${stats.MISMATCH}`);
  console.log(`  NO_PROPERTY (failed):    ${stats.NO_PROPERTY}`);
  console.log(`\nTop repeat property_ids (>=3 promotions to same property):`);
  for (const [key, n] of topRepeats) console.log(`  ${key}: ${n} intakes`);
  console.log(`\nWrote CSV -> ${OUT_PATH}`);
}

function csvSafe(v) {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

main().catch(err => {
  console.error('FAIL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
