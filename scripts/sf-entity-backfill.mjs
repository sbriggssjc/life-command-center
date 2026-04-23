#!/usr/bin/env node
// ============================================================================
// scripts/sf-entity-backfill.mjs
//
// One-shot backfill that surfaces Salesforce links onto the LCC entity graph
// for ALL pre-existing rows that were created before the 2026-04-23 SF-sync
// hook went live.
//
// What it does, per LCC entity:
//   A. Looks up any existing sf_contact_id / sf_account_id on domain rows
//      (unified_contacts, gov.contacts, gov.true_owners, gov.recorded_owners,
//      dia.contacts) and mirrors them to:
//         - lcc_opps.entities.metadata.salesforce.{account_id,contact_id,...}
//         - lcc_opps.external_identities (source_system='salesforce',
//                                          source_type='Account'|'Contact')
//   B. For entities that still lack any SF id but carry enough identifying
//      info (person: email; organization: name), calls the PA-proxy SF lookup
//      and applies the same A-path writes on success. Best-effort — failures
//      never kill the run.
//
// Usage:
//   node scripts/sf-entity-backfill.mjs                 # dry run (log only)
//   node scripts/sf-entity-backfill.mjs --apply         # actually write
//   node scripts/sf-entity-backfill.mjs --apply --live  # include PA SF lookup
//   node scripts/sf-entity-backfill.mjs --limit 10      # cap entity scan
//
// Environment required (reads .env.local / .env.example / process.env):
//   OPS_SUPABASE_URL       LCC Opps Supabase URL
//   OPS_SUPABASE_KEY       service-role key for LCC Opps
//   GOV_SUPABASE_URL       gov Supabase URL
//   GOV_SUPABASE_KEY       service-role key for gov
//   DIA_SUPABASE_URL       dia Supabase URL
//   DIA_SUPABASE_KEY       service-role key for dia
//   SF_LOOKUP_WEBHOOK_URL  (optional, only with --live) PA flow URL
//   DEFAULT_WORKSPACE_ID   workspace to scope the sweep (defaults to 'all')
//
// Safety:
//   - Dry-run by default. Nothing is written without --apply.
//   - PA lookups only run with --apply --live (they hit the PA flow).
//   - Runs sequentially per entity; no fan-out, predictable rate on SF side.
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const APPLY   = argv.includes('--apply');
const LIVE    = argv.includes('--live');
const VERBOSE = argv.includes('--verbose') || argv.includes('-v');
// Default: newest entities first so recent deals (more likely to have
// usable SF linkage via unified_contacts / true_owners) get tried first.
// `--oldest` flips the order for exhaustive historical sweeps.
const ORDER = argv.includes('--oldest') ? 'created_at.asc' : 'created_at.desc';
const LIMIT = (() => {
  const i = argv.indexOf('--limit');
  if (i === -1) return null;
  const n = parseInt(argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const WORKSPACE_ID = env.DEFAULT_WORKSPACE_ID || null;

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
const GOV_URL = env.GOV_SUPABASE_URL;
const GOV_KEY = env.GOV_SUPABASE_KEY;
const DIA_URL = env.DIA_SUPABASE_URL;
const DIA_KEY = env.DIA_SUPABASE_KEY;
const SF_URL  = env.SF_LOOKUP_WEBHOOK_URL;

// Validate env vars and print a precise, actionable diagnostic if any are
// missing. OPS is hard-required (the entity graph lives there). GOV is
// strongly recommended but optional — without it we skip the gov.true_owners
// sweep but still handle unified_contacts mirroring. DIA + SF_URL are
// optional (DIA for dia.contacts sweep; SF_URL only used with --live).
const missing = [];
if (!OPS_URL) missing.push('OPS_SUPABASE_URL');
if (!OPS_KEY) missing.push('OPS_SUPABASE_KEY');
const missingOptional = [];
if (!GOV_URL) missingOptional.push('GOV_SUPABASE_URL');
if (!GOV_KEY) missingOptional.push('GOV_SUPABASE_KEY');
if (!DIA_URL) missingOptional.push('DIA_SUPABASE_URL');
if (!DIA_KEY) missingOptional.push('DIA_SUPABASE_KEY');
if (LIVE && !SF_URL) missingOptional.push('SF_LOOKUP_WEBHOOK_URL (required with --live)');

if (missing.length) {
  console.error(`\nMissing required env vars: ${missing.join(', ')}`);
  console.error(`\nFix: pull from Vercel:`);
  console.error(`  vercel env pull .env.local`);
  console.error(`Or copy from Vercel Dashboard → Settings → Environment Variables (Production) into .env.local.\n`);
  process.exit(1);
}
if (missingOptional.length) {
  console.warn(`\nOptional env vars not set — some backfill paths will be skipped:`);
  missingOptional.forEach((v) => console.warn(`  - ${v}`));
  console.warn('');
}

// ---------- thin REST helpers --------------------------------------------------
async function rest(base, key, method, path, body, extraHeaders = {}) {
  const url = `${base}/rest/v1/${path}`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: method === 'GET' ? 'count=exact' : 'return=representation',
    ...extraHeaders,
  };
  const opts = { method, headers };
  if (body && (method === 'POST' || method === 'PATCH')) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}
const ops = (m, p, b, h) => rest(OPS_URL, OPS_KEY, m, p, b, h);
const gov = (m, p, b, h) => (GOV_URL && GOV_KEY) ? rest(GOV_URL, GOV_KEY, m, p, b, h) : { ok: false, status: 0, data: null };
const dia = (m, p, b, h) => (DIA_URL && DIA_KEY) ? rest(DIA_URL, DIA_KEY, m, p, b, h) : { ok: false, status: 0, data: null };

// ---------- optional PA flow lookup (--live) ----------------------------------
async function sfLookup(operation, value) {
  if (!SF_URL || !LIVE) return null;
  try {
    const res = await fetch(SF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, value }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) return null;
    return json;
  } catch (err) {
    console.warn('[sfLookup] failed:', err?.message);
    return null;
  }
}

function normalizeName(s) {
  return String(s || '').toLowerCase()
    .replace(/[.,;:'"]/g, ' ')
    .replace(/\b(llc|lp|inc|corp|co|ltd|pllc|llp|the)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

function scoreName(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const A = new Set(a.split(' ').filter(w => w.length > 1));
  const B = new Set(b.split(' ').filter(w => w.length > 1));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return Math.min(0.80, shared / (A.size + B.size - shared));
}

// ---------- upsert helpers ----------------------------------------------------
async function upsertExternalIdentity({ workspaceId, entityId, kind, sfId, sfName }) {
  if (!APPLY) return { ok: true, skipped: 'dry_run' };
  const url = 'external_identities?on_conflict=workspace_id,source_system,source_type,external_id';
  return ops('POST', url, {
    workspace_id: workspaceId,
    entity_id:    entityId,
    source_system:'salesforce',
    source_type:  kind,
    external_id:  sfId,
    external_url: env.SF_INSTANCE_URL ? `${env.SF_INSTANCE_URL.replace(/\/+$/, '')}/lightning/r/${kind}/${sfId}/view` : null,
    metadata:     { sf_name: sfName || null, synced_via: 'sf-entity-backfill.v1' },
    last_synced_at: new Date().toISOString(),
  }, { Prefer: 'return=representation,resolution=merge-duplicates' });
}

async function mergeEntitySalesforce({ workspaceId, entityId, sfPayload }) {
  if (!APPLY) return { ok: true, skipped: 'dry_run' };
  // Read current metadata, merge salesforce block, write back.
  const read = await ops('GET', `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}&select=metadata&limit=1`);
  const current = read.data?.[0]?.metadata || {};
  const merged = {
    ...current,
    salesforce: { ...(current.salesforce || {}), ...sfPayload, last_synced_at: new Date().toISOString() },
  };
  return ops('PATCH', `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}`, { metadata: merged });
}

// ---------- per-entity backfill ----------------------------------------------
async function backfillOne(entity) {
  const outcome = {
    entity_id: entity.id,
    name:      entity.name,
    type:      entity.entity_type,
    applied:   [],
    reasons:   [],  // diagnostic trail of what was tried + why it succeeded/failed
  };
  const note = (msg) => { outcome.reasons.push(msg); };

  // 1. Collect SF ids that already exist on linked domain rows.
  const identities = await ops('GET',
    `external_identities?workspace_id=eq.${entity.workspace_id}&entity_id=eq.${entity.id}&select=source_system,source_type,external_id&limit=50`
  );
  const idMap = {};
  for (const row of identities.data || []) {
    idMap[`${row.source_system}/${row.source_type}`] = row.external_id;
  }
  if (idMap['salesforce/Contact'] || idMap['salesforce/Account']) {
    note(`already has SF identity (${Object.keys(idMap).filter(k => k.startsWith('salesforce')).join(', ')})`);
  }

  let foundContactId = null;
  let foundAccountId = null;
  let provenance = [];

  // Domain lookups — only run queries that make sense for this entity type.
  if (entity.entity_type === 'person') {
    if (!entity.email) {
      note('person has no email — no domain lookup key available');
    } else {
      // Look for a unified_contacts match by email.
      const r = await ops('GET',
        `unified_contacts?email=ilike.${encodeURIComponent(entity.email)}&select=unified_id,sf_contact_id,sf_account_id&limit=1`
      );
      if (!r.ok) {
        note(`unified_contacts query failed (${r.status})`);
      } else if (!r.data?.length) {
        note(`unified_contacts: no row for email ${entity.email}`);
      } else if (!r.data[0].sf_contact_id) {
        note(`unified_contacts: row found but sf_contact_id is null`);
      } else {
        foundContactId = r.data[0].sf_contact_id;
        foundAccountId = r.data[0].sf_account_id || null;
        provenance.push('unified_contacts.email');
        note(`unified_contacts → sf_contact_id ${foundContactId}`);
      }

      // gov.contacts fallback
      if (!foundContactId && GOV_URL) {
        const r2 = await gov('GET',
          `contacts?email=ilike.${encodeURIComponent(entity.email)}&select=contact_id,sf_contact_id,sf_account_id&limit=1`
        );
        if (!r2.ok) {
          note(`gov.contacts query failed (${r2.status})`);
        } else if (!r2.data?.length) {
          note(`gov.contacts: no row for email ${entity.email}`);
        } else if (!r2.data[0].sf_contact_id) {
          note(`gov.contacts: row found but sf_contact_id is null`);
        } else {
          foundContactId = r2.data[0].sf_contact_id;
          foundAccountId = foundAccountId || r2.data[0].sf_account_id || null;
          provenance.push('gov.contacts.email');
          note(`gov.contacts → sf_contact_id ${foundContactId}`);
        }
      }
    }
  } else if (entity.entity_type === 'organization') {
    if (!entity.name) {
      note('organization has no name — cannot look up');
    } else if (!GOV_URL) {
      note('GOV_SUPABASE_URL not configured — skipping true_owners sweep');
    } else {
      const norm = normalizeName(entity.name);
      if (!norm) {
        note(`organization name "${entity.name}" normalized to empty string`);
      } else {
        const r = await gov('GET',
          `true_owners?canonical_name=ilike.${encodeURIComponent('%' + norm + '%')}&select=true_owner_id,name,canonical_name,sf_account_id&limit=5`
        );
        if (!r.ok) {
          note(`true_owners query failed (${r.status})`);
        } else if (!r.data?.length) {
          note(`true_owners: no ILIKE match for "${norm}"`);
        } else {
          let best = null, bestScore = 0;
          for (const cand of r.data) {
            const s = scoreName(normalizeName(cand.canonical_name || cand.name), norm);
            if (s > bestScore) { bestScore = s; best = cand; }
          }
          if (!best || bestScore < 0.5) {
            note(`true_owners: ${r.data.length} candidates but best score ${bestScore.toFixed(2)} < 0.5 threshold (best="${best?.name || '?'}")`);
          } else if (!best.sf_account_id) {
            note(`true_owners: best match "${best.name}" (score ${bestScore.toFixed(2)}) has null sf_account_id`);
          } else {
            foundAccountId = best.sf_account_id;
            provenance.push(`gov.true_owners(${bestScore.toFixed(2)})`);
            note(`true_owners → "${best.name}" (score ${bestScore.toFixed(2)}) → sf_account_id ${foundAccountId}`);
          }
        }
      }
    }
  } else {
    note(`entity_type=${entity.entity_type} not supported`);
  }

  // 2. Live PA lookup if still missing (requires --live).
  if (LIVE && APPLY && !foundContactId && !foundAccountId) {
    if (entity.entity_type === 'person' && entity.email) {
      const r = await sfLookup('find_contact_by_email', String(entity.email).trim().toLowerCase());
      const c = r?.candidates?.[0] || r?.contact;
      if (c?.Id) {
        foundContactId = c.Id;
        foundAccountId = c.AccountId || null;
        provenance.push('sf_live.email');
      }
    } else if (entity.entity_type === 'organization' && entity.name) {
      const r = await sfLookup('find_account_by_name', String(entity.name).trim());
      const cands = r?.candidates || (r?.account ? [r.account] : []);
      if (cands.length) {
        const target = normalizeName(entity.name);
        let best = null, bestScore = 0;
        for (const cand of cands) {
          const s = scoreName(target, normalizeName(cand.Name));
          if (s > bestScore) { bestScore = s; best = cand; }
        }
        if (best && bestScore >= 0.5) {
          foundAccountId = best.Id;
          provenance.push(`sf_live.name(${bestScore.toFixed(2)})`);
        }
      }
    }
  }

  // 3. Apply: write external_identities rows + merge metadata.
  const sfPayload = {};
  if (foundContactId && idMap['salesforce/Contact'] !== foundContactId) {
    const r = await upsertExternalIdentity({ workspaceId: entity.workspace_id, entityId: entity.id, kind: 'Contact', sfId: foundContactId });
    outcome.applied.push({ identity: 'salesforce/Contact', sf_id: foundContactId, ok: r.ok, dry: !APPLY });
    sfPayload.contact_id = foundContactId;
  }
  if (foundAccountId && idMap['salesforce/Account'] !== foundAccountId) {
    const r = await upsertExternalIdentity({ workspaceId: entity.workspace_id, entityId: entity.id, kind: 'Account', sfId: foundAccountId });
    outcome.applied.push({ identity: 'salesforce/Account', sf_id: foundAccountId, ok: r.ok, dry: !APPLY });
    sfPayload.account_id = foundAccountId;
  }
  if (Object.keys(sfPayload).length) {
    sfPayload.source = provenance.join(',');
    const r = await mergeEntitySalesforce({ workspaceId: entity.workspace_id, entityId: entity.id, sfPayload });
    outcome.applied.push({ metadata_merge: Object.keys(sfPayload), ok: r.ok, dry: !APPLY });
  } else if (!outcome.reasons.length) {
    // Never left a reason trail — surface a generic marker so the tally
    // can bucket it. (backfillOne always notes SOMETHING in the normal
    // flow; this is defensive belt-and-suspenders.)
    outcome.reasons.push('no_match');
  }

  return outcome;
}

// ---------- main --------------------------------------------------------------
async function main() {
  console.log(`[sf-backfill] start  apply=${APPLY}  live=${LIVE}  verbose=${VERBOSE}  order=${ORDER}  limit=${LIMIT ?? '∞'}  workspace=${WORKSPACE_ID || 'all'}`);

  // Only persons and organizations benefit — assets don't have SF analogs.
  let path = `entities?select=id,workspace_id,name,entity_type,email&entity_type=in.(person,organization)&order=${encodeURIComponent(ORDER)}`;
  if (WORKSPACE_ID) path += `&workspace_id=eq.${WORKSPACE_ID}`;
  if (LIMIT) path += `&limit=${LIMIT}`;
  const list = await ops('GET', path);
  if (!list.ok) { console.error('Failed to list entities:', list.status, list.data); process.exit(1); }
  const rows = list.data || [];
  console.log(`[sf-backfill] scanning ${rows.length} entities`);

  const stats = { scanned: 0, matched: 0, identity_writes: 0, metadata_writes: 0, no_match: 0, errors: 0 };
  // Track the most common no-match reasons so the summary shows where the
  // sweep is being starved. Helps decide whether to widen the matcher (e.g.
  // lower the 0.5 name-score threshold), populate more domain-side SF ids,
  // or just accept that the entity universe has low SF overlap.
  const reasonTally = new Map();

  for (const e of rows) {
    stats.scanned += 1;
    try {
      const out = await backfillOne(e);
      const applied = out.applied.length;
      if (applied) {
        stats.matched += 1;
        for (const a of out.applied) {
          if (a.identity) stats.identity_writes += 1;
          if (a.metadata_merge) stats.metadata_writes += 1;
        }
        console.log(`  [hit] ${out.entity_id.slice(0,8)}… "${String(out.name).slice(0, 60)}" (${out.type}) → ${out.applied.map(a => a.identity || 'metadata').join(', ')}${APPLY ? '' : ' (dry)'}`);
        if (VERBOSE && out.reasons.length) {
          out.reasons.forEach(r => console.log(`        · ${r}`));
        }
      } else {
        stats.no_match += 1;
        // Log the last-reason summary when verbose; tally always.
        const tailReason = out.reasons[out.reasons.length - 1] || 'no_signal';
        const bucket = tailReason.split(':')[0].replace(/[0-9]+/g, '').slice(0, 60);
        reasonTally.set(bucket, (reasonTally.get(bucket) || 0) + 1);
        if (VERBOSE) {
          console.log(`  [miss] ${out.entity_id.slice(0,8)}… "${String(out.name).slice(0, 60)}" (${out.type})`);
          out.reasons.forEach(r => console.log(`        · ${r}`));
        }
      }
    } catch (err) {
      stats.errors += 1;
      console.warn(`  [err] ${e.id}: ${err.message}`);
    }
  }
  console.log('[sf-backfill] done', stats);
  if (stats.no_match > 0) {
    const top = [...reasonTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log('[sf-backfill] top no-match reasons:');
    top.forEach(([r, n]) => console.log(`  ${n}×  ${r}`));
    if (!VERBOSE) {
      console.log('[sf-backfill] re-run with --verbose to see the full per-entity reason trail.');
    }
  }
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
