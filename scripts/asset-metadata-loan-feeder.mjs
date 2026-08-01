#!/usr/bin/env node
/**
 * Feed structured domain loans from OPS asset entities.metadata.loans[].
 *
 * Dry-run by default. Apply is fill-blanks/additive: it inserts a domain loans
 * row only when no same-property, same-amount, near-date loan already exists.
 *
 * Required env:
 *   OPS_SUPABASE_URL, OPS_SUPABASE_KEY
 *   DIA_SUPABASE_URL, DIA_SUPABASE_SERVICE_KEY (or DIA_SUPABASE_KEY)
 *   GOV_SUPABASE_URL, GOV_SUPABASE_SERVICE_KEY (or GOV_SUPABASE_KEY) for gov
 *
 * Usage:
 *   node scripts/asset-metadata-loan-feeder.mjs --entity=<uuid> --dry-run
 *   node scripts/asset-metadata-loan-feeder.mjs --entity=<uuid> --apply
 *   node scripts/asset-metadata-loan-feeder.mjs --all --dry-run
 */

import fs from 'node:fs';
import process from 'node:process';

loadDotEnvLocal();

const args = parseArgs(process.argv.slice(2));
const APPLY = args.apply === true || args.apply === 'true';
const ENTITY_ID = args.entity || null;
const ALL = args.all === true || args.all === 'true';
const LIMIT = Math.max(1, Math.min(1000, parseInt(args.limit || '250', 10)));
const DEFAULT_WORKSPACE_ID = 'a0000000-0000-0000-0000-000000000001';
const SOURCE_PRIORITY_ROWS = [
  ...['lender_name', 'loan_amount', 'loan_type', 'loan_term', 'origination_date', 'maturity_date',
    'interest_rate_percent', 'loan_to_value', 'originator', 'special_servicer', 'origination_appraisal',
    'cmbs_deal_name'].map(field_name => ({
    target_table: 'dia.loans', field_name, source: 'ops_asset_metadata_loan',
    priority: 25, min_confidence: 0.5, enforce_mode: 'record_only',
    notes: 'RCA/CMBS loan packet propagated from OPS asset metadata.',
  })),
  ...['loan_amount', 'loan_type', 'term_years', 'origination_date', 'maturity_date', 'interest_rate',
    'ltv', 'originator', 'special_servicer', 'origination_appraisal', 'cmbs_deal_name', 'status'].map(field_name => ({
    target_table: 'gov.loans', field_name, source: 'ops_asset_metadata_loan',
    priority: 25, min_confidence: 0.5, enforce_mode: 'record_only',
    notes: 'RCA/CMBS loan packet propagated from OPS asset metadata.',
  })),
];

const OPS = {
  url: process.env.OPS_SUPABASE_URL,
  key: process.env.OPS_SUPABASE_KEY || process.env.OPS_SUPABASE_SERVICE_KEY,
};
const DOMAINS = {
  dia: {
    long: 'dialysis',
    url: process.env.DIA_SUPABASE_URL,
    key: process.env.DIA_SUPABASE_SERVICE_KEY || process.env.DIA_SUPABASE_KEY,
  },
  gov: {
    long: 'government',
    url: process.env.GOV_SUPABASE_URL,
    key: process.env.GOV_SUPABASE_SERVICE_KEY || process.env.GOV_SUPABASE_KEY,
  },
};

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

function requireConfig() {
  const missing = [];
  if (!OPS.url || !OPS.key) missing.push('OPS_SUPABASE_URL/KEY');
  if (!DOMAINS.dia.url || !DOMAINS.dia.key) missing.push('DIA_SUPABASE_URL/KEY');
  if (!ENTITY_ID && !ALL) missing.push('--entity=<uuid> or --all');
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function rest(client, method, path, body = null, headers = {}) {
  const resp = await fetch(client.url.replace(/\/$/, '') + '/rest/v1/' + path, {
    method,
    headers: {
      apikey: client.key,
      Authorization: `Bearer ${client.key}`,
      'Content-Type': 'application/json',
      ...(method === 'POST' ? { Prefer: 'return=representation' } : {}),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: resp.ok, status: resp.status, data };
}

async function recordLoanProvenance(domainKey, loanId, payload, sourceRunId) {
  const targetDatabase = domainKey === 'gov' ? 'gov_db' : 'dia_db';
  const targetTable = domainKey === 'gov' ? 'gov.loans' : 'dia.loans';
  const skip = new Set(['property_id', 'data_source', 'notes', 'is_active']);
  const fields = Object.entries(payload).filter(([k, v]) => !skip.has(k) && v !== undefined);
  for (const [field, value] of fields) {
    await rest(OPS, 'POST', 'rpc/lcc_merge_field', {
      p_workspace_id: DEFAULT_WORKSPACE_ID,
      p_target_database: targetDatabase,
      p_target_table: targetTable,
      p_record_pk: String(loanId),
      p_field_name: field,
      p_value: value,
      p_source: 'ops_asset_metadata_loan',
      p_source_run_id: sourceRunId,
      p_confidence: 0.85,
      p_recorded_by: null,
    }).catch(() => null);
  }
}

async function ensureSourcePriorityRows() {
  await rest(OPS, 'POST',
    'field_source_priority?on_conflict=target_table,field_name,source',
    SOURCE_PRIORITY_ROWS,
    { Prefer: 'resolution=merge-duplicates,return=minimal' });
}

function parseMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).toLowerCase();
  const mult = /\b(m|mm|million)\b/.test(s) ? 1_000_000 : (/\b(k|thousand)\b/.test(s) ? 1_000 : 1);
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * mult) : null;
}

function parsePercent(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function isoDate(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function statusFrom(raw) {
  const s = String(raw || '').toLowerCase();
  if (/watchlist/.test(s)) return 'active';
  if (/outstanding|current|performing|active/.test(s)) return 'active';
  if (/paid/.test(s)) return 'paid_off';
  if (/matur/.test(s)) return 'matured';
  if (/default|delinquent|foreclos/.test(s)) return 'defaulted';
  if (/refi/.test(s)) return 'refinanced';
  return null;
}

function mapLoanType(raw) {
  const s = String(raw || '').toLowerCase();
  if (/refinanc|refi/.test(s)) return 'Refinance';
  if (/acquisition|purchase|1st mortgage|new|commercial|construction/.test(s)) return 'Acquisition';
  return null;
}

function buildNotes(loan) {
  const notes = {
    source: 'ops_asset_metadata.loans',
    summary: loan.summary || null,
    loan_status_raw: loan.loan_status || null,
    amortization_type: loan.amortization_type || null,
    debt_yield_pct: parsePercent(loan.debt_yield_pct ?? loan.debt_yield),
    total_reserves_dollars: parseMoney(loan.total_reserves_dollars ?? loan.total_reserves),
    defeasance_date: isoDate(loan.defeasance_date_iso || loan.defeasance_date),
    prepayment_date: isoDate(loan.prepayment_date_iso || loan.prepayment_date),
    current_balance_estimate: null,
    current_balance_estimate_basis: 'Not computed: amortization schedule/current servicer balance not on file.',
  };
  Object.keys(notes).forEach(k => notes[k] == null && delete notes[k]);
  return JSON.stringify(notes);
}

function loanPayload(domainKey, propertyId, loan) {
  const amount = parseMoney(loan.loan_amount_dollars ?? loan.loan_amount);
  if (!amount) return null;
  const origination = isoDate(loan.origination_date_iso || loan.origination);
  const maturity = isoDate(loan.maturity_date_iso || loan.original_maturity || loan.maturity_date);
  const status = statusFrom(loan.loan_status);
  const loanType = mapLoanType(loan.loan_type);
  const common = {
    property_id: propertyId,
    loan_type: loanType,
    loan_amount: amount,
    origination_date: origination,
    maturity_date: maturity,
    originator: loan.originator || null,
    special_servicer: loan.special_servicer || null,
    origination_appraisal: parseMoney(loan.origination_appraisal_dollars ?? loan.deal_appraisal),
    cmbs_deal_name: loan.is_cmbs ? (loan.lender_name || loan.cmbs_deal_name || null) : null,
    notes: buildNotes(loan),
    data_source: 'ops_asset_metadata_loan',
  };
  if (domainKey === 'gov') {
    return stripNulls({
      ...common,
      interest_rate: parsePercent(loan.interest_rate_pct ?? loan.interest_rate),
      term_years: Number.isFinite(Number(loan.term_years)) ? Number(loan.term_years) : null,
      ltv: parsePercent(loan.ltv_pct ?? loan.original_ltv),
      status,
    });
  }
  return stripNulls({
    ...common,
    lender_name: loan.lender_name || loan.originator || null,
    interest_rate_percent: parsePercent(loan.interest_rate_pct ?? loan.interest_rate),
    loan_term: Number.isFinite(Number(loan.term_months)) ? Number(loan.term_months) : null,
    loan_to_value: parsePercent(loan.ltv_pct ?? loan.original_ltv),
    is_active: status ? status === 'active' : null,
  });
}

function stripNulls(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

async function fetchAssets() {
  if (ENTITY_ID) {
    const r = await rest(OPS, 'GET', `entities?id=eq.${encodeURIComponent(ENTITY_ID)}&select=id,name,metadata&limit=1`);
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }
  const r = await rest(OPS, 'GET',
    `entities?entity_type=eq.asset&metadata->loans=not.is.null&select=id,name,metadata&limit=${LIMIT}`);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

async function domainBridge(entityId) {
  const r = await rest(OPS, 'GET',
    `external_identities?entity_id=eq.${encodeURIComponent(entityId)}` +
    '&source_system=in.(dia,gov)&source_type=eq.asset&select=source_system,external_id');
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

async function findExisting(domainClient, propertyId, payload) {
  const amount = Number(payload.loan_amount);
  const lo = Math.floor(amount * 0.95);
  const hi = Math.ceil(amount * 1.05);
  const r = await rest(domainClient, 'GET',
    `loans?property_id=eq.${encodeURIComponent(String(propertyId))}` +
    `&loan_amount=gte.${lo}&loan_amount=lte.${hi}&select=loan_id,origination_date&limit=10`);
  if (!r.ok || !Array.isArray(r.data)) return null;
  for (const row of r.data) {
    if (!payload.origination_date || !row.origination_date) return row.loan_id;
    const days = Math.abs(new Date(String(row.origination_date).slice(0, 10)) - new Date(payload.origination_date)) / 86400000;
    if (days <= 31) return row.loan_id;
  }
  return null;
}

async function main() {
  requireConfig();
  if (APPLY) await ensureSourcePriorityRows();
  const assets = await fetchAssets();
  const report = { mode: APPLY ? 'apply' : 'dry-run', assets: assets.length, inserted: 0, skipped: 0, rows: [] };
  for (const asset of assets) {
    const loans = Array.isArray(asset.metadata?.loans) ? asset.metadata.loans : [];
    if (!loans.length) continue;
    const bridge = await domainBridge(asset.id);
    if (!bridge || !DOMAINS[bridge.source_system]?.url || !DOMAINS[bridge.source_system]?.key) {
      report.skipped += loans.length;
      report.rows.push({ entity_id: asset.id, name: asset.name, skipped: 'no_domain_bridge_or_config' });
      continue;
    }
    const domainKey = bridge.source_system;
    const client = DOMAINS[domainKey];
    const propertyId = bridge.external_id;
    for (const loan of loans) {
      const payload = loanPayload(domainKey, propertyId, loan);
      if (!payload) {
        report.skipped++;
        report.rows.push({ entity_id: asset.id, property_id: propertyId, skipped: 'no_loan_amount' });
        continue;
      }
      const existing = await findExisting(client, propertyId, payload);
      if (existing) {
        if (APPLY) await recordLoanProvenance(domainKey, existing, payload, `asset_metadata_loan:${asset.id}`);
        report.skipped++;
        report.rows.push({ entity_id: asset.id, property_id: propertyId, skipped: 'already_recorded', loan_id: existing });
        continue;
      }
      if (!APPLY) {
        report.rows.push({ entity_id: asset.id, property_id: propertyId, would_insert: payload });
        continue;
      }
      const ins = await rest(client, 'POST', 'loans', payload);
      if (ins.ok) {
        const insertedId = ins.data?.[0]?.loan_id || null;
        if (insertedId) await recordLoanProvenance(domainKey, insertedId, payload, `asset_metadata_loan:${asset.id}`);
        report.inserted++;
        report.rows.push({ entity_id: asset.id, property_id: propertyId, inserted: insertedId || true });
      } else {
        report.skipped++;
        report.rows.push({ entity_id: asset.id, property_id: propertyId, skipped: 'insert_failed', status: ins.status, detail: ins.data });
      }
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
