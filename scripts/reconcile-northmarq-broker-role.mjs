#!/usr/bin/env node
// Reconcile Northmarq sell-side broker-of-record attribution.
//
// For is_northmarq sell-side sales, our SF/SJC roster is authoritative for the
// canonical listing_broker field. Third-party feed values are retained separately
// as sale_brokers.role='as_reported_listing' and in LCC conflict/disagreement lanes.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvForScripts } from './_env-file.mjs';

Object.assign(process.env, loadEnvForScripts(path.resolve(fileURLToPath(new URL('..', import.meta.url)))));

const { domainQuery } = await import('../api/_shared/domain-db.js');
const { opsQuery } = await import('../api/_shared/ops-db.js');
const { shouldWriteField } = await import('../api/_shared/field-priority-guard.js');
const {
  planNorthmarqListingBrokerReconciliation,
  SOURCE_NORTHMARQ_ROSTER,
  CONF_NORTHMARQ_ROSTER,
} = await import('../api/_handlers/party-extract.js');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv);
const APPLY = !!args.apply;
const DOMAIN = String(args.domain || 'dia').toLowerCase();
const PROPERTY_ID = args.property ? String(args.property) : null;
const LISTING_ID = args.listing ? String(args.listing) : null;
const LIMIT = Math.max(1, parseInt(args.limit, 10) || 200);
const BATCH_TAG = args['batch-tag'] || `northmarq_broker_role_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
const DEFAULT_BROKER = args['default-broker'] || 'Team Briggs / Northmarq';
const FORCE_NORTHMARQ = !!args['force-northmarq'];

const DOMAIN_TABLE = (d) => `${d}.sales_transactions`;
const DOMAIN_DB_TAG = (d) => (d === 'dia' ? 'dia_db' : 'gov_db');

function enc(v) { return encodeURIComponent(String(v)); }
function normBrokerName(name) {
  return String(name || '').toLowerCase()
    .replace(/\b(llc|inc|corp|ltd|lp|llp|co|company|group|associates|advisors)\b\.?/gi, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchSales() {
  const cols = [
    'sale_id', 'property_id', 'listing_broker', 'procuring_broker',
    'is_northmarq', 'data_source', 'sf_deal_id',
  ].join(',');
  let p = `sales_transactions?select=${cols}&order=sale_id.asc&limit=${LIMIT}`;
  if (PROPERTY_ID) p += `&property_id=eq.${enc(PROPERTY_ID)}`;
  else p += '&is_northmarq=eq.true';
  const res = await domainQuery(DOMAIN, 'GET', p);
  if (!res.ok) throw new Error(`${DOMAIN} sales read ${res.status}: ${JSON.stringify(res.data)}`);
  return Array.isArray(res.data) ? res.data : [];
}

async function fetchRoster(row) {
  const select = 'sf_deal_id,sf_listing_id,matched_sale_id,linked_property_id,deal_side,sjc_team,broker_name,listing_broker_sf_id';
  const paths = [];
  if (row.sale_id) paths.push(`v_sjc_deal_book?matched_sale_id=eq.${enc(row.sale_id)}&select=${select}&limit=1`);
  if (row.sf_deal_id) paths.push(`v_sjc_deal_book?sf_deal_id=eq.${enc(row.sf_deal_id)}&select=${select}&limit=1`);
  if (row.property_id) paths.push(`v_sjc_deal_book?linked_property_id=eq.${enc(row.property_id)}&select=${select}&limit=1`);

  for (const p of paths) {
    const res = await domainQuery(DOMAIN, 'GET', p).catch(() => null);
    if (res?.ok && Array.isArray(res.data) && res.data[0]) return res.data[0];
  }
  return null;
}

async function fetchListingSignal(row) {
  if (!row.property_id && !LISTING_ID) return null;
  const select = 'listing_id,property_id,is_northmarq,listing_broker,status';
  if (LISTING_ID) {
    const byId = await domainQuery(DOMAIN, 'GET',
      `available_listings?listing_id=eq.${enc(LISTING_ID)}&select=${select}&limit=1`).catch(() => null);
    if (byId?.ok && Array.isArray(byId.data) && byId.data[0]) return byId.data[0];
  }
  const res = await domainQuery(DOMAIN, 'GET',
    `available_listings?property_id=eq.${enc(row.property_id)}&select=${select}&order=listing_id.desc&limit=1`).catch(() => null);
  if (res?.ok && Array.isArray(res.data) && res.data[0]) return res.data[0];
  return null;
}

async function ensureBrokerLink(saleId, link) {
  if (DOMAIN !== 'dia' || !saleId || !link?.broker_name) return { ok: true, skipped: true };
  const name = String(link.broker_name).trim();
  const normalized = normBrokerName(name);
  let brokerId = null;
  const byNorm = normalized
    ? await domainQuery(DOMAIN, 'GET', `brokers?normalized_name=eq.${enc(normalized)}&select=broker_id&limit=1`)
    : null;
  if (byNorm?.ok && byNorm.data?.[0]) brokerId = byNorm.data[0].broker_id;

  if (!brokerId) {
    const byName = await domainQuery(DOMAIN, 'GET', `brokers?broker_name=ilike.${enc(name)}&select=broker_id&limit=1`);
    if (byName.ok && byName.data?.[0]) brokerId = byName.data[0].broker_id;
  }
  if (!brokerId) {
    const ins = await domainQuery(DOMAIN, 'POST', 'brokers', {
      broker_name: name,
      company: /northmarq|team briggs|briggs/i.test(name) ? 'Northmarq' : null,
      normalized_name: normalized || null,
    });
    if (!ins.ok || !ins.data?.[0]) return { ok: false, status: ins.status, data: ins.data };
    brokerId = ins.data[0].broker_id;
  }

  const existing = await domainQuery(DOMAIN, 'GET',
    `sale_brokers?sale_id=eq.${enc(saleId)}&broker_id=eq.${enc(brokerId)}&role=eq.${enc(link.role)}&select=sale_broker_id&limit=1`);
  if (existing.ok && existing.data?.length) return { ok: true, skipped: true };

  const inserted = await domainQuery(DOMAIN, 'POST', 'sale_brokers', {
    sale_id: saleId,
    broker_id: brokerId,
    role: link.role,
  }, { Prefer: 'return=minimal' });
  return inserted.ok ? { ok: true } : { ok: false, status: inserted.status, data: inserted.data };
}

async function entityIdForProperty(propertyId) {
  if (!propertyId) return null;
  const res = await opsQuery('GET',
    `external_identities?source_system=eq.${enc(DOMAIN)}&source_type=eq.asset&external_id=eq.${enc(propertyId)}&select=entity_id&limit=1`,
    null, { countMode: 'none' });
  return res.ok && Array.isArray(res.data) && res.data[0]?.entity_id ? res.data[0].entity_id : null;
}

async function recordDisagreement(row, plan) {
  if (!plan.disagreementKind) return;
  await opsQuery('POST', 'party_extract_disagreements', {
    batch_tag: BATCH_TAG,
    target_database: DOMAIN,
    record_pk: String(row.sale_id),
    field_name: 'listing_broker',
    channel_a_value: plan.authoritativeValue,
    channel_b_value: plan.asReportedValue,
    channel_a_core: plan.authoritativeCore,
    channel_b_core: plan.asReportedCore,
    disagreement_kind: plan.disagreementKind,
    note_excerpt: `Northmarq sell-side broker-of-record reconciliation for property ${row.property_id}`,
    ai_final_provider: 'not_applicable',
  }, { headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } });
}

async function recordDealConflict(row, plan) {
  const entityId = await entityIdForProperty(row.property_id);
  if (!entityId || !plan.asReportedValue) return;
  await opsQuery('POST', 'lcc_deal_conflict?on_conflict=entity_id,field', {
    entity_id: entityId,
    field: 'listing_broker',
    values: [
      { v: plan.authoritativeValue, source: SOURCE_NORTHMARQ_ROSTER },
      { v: plan.asReportedValue, source: plan.asReportedSource || row.data_source || 'costar_sidebar', role: 'as_reported_listing' },
    ],
    note: 'Northmarq sell-side deal: our SF/SJC roster is authoritative for listing broker; third-party feed retained as as-reported.',
    status: 'open',
  }, { headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
}

async function retentionFor(row) {
  const out = { disagreement: null, deal_conflict: null };
  const disagreement = await opsQuery('GET',
    `party_extract_disagreements?target_database=eq.${enc(DOMAIN)}&record_pk=eq.${enc(row.sale_id)}&field_name=eq.listing_broker&disagreement_kind=eq.northmarq_authoritative_role_conflict&select=channel_a_value,channel_b_value,disagreement_kind,resolved,created_at&limit=1`,
    null, { countMode: 'none' }).catch(() => null);
  if (disagreement?.ok && Array.isArray(disagreement.data) && disagreement.data[0]) out.disagreement = disagreement.data[0];

  const entityId = await entityIdForProperty(row.property_id);
  if (entityId) {
    const conflict = await opsQuery('GET',
      `lcc_deal_conflict?entity_id=eq.${enc(entityId)}&field=eq.listing_broker&select=values,note,status&limit=1`,
      null, { countMode: 'none' }).catch(() => null);
    if (conflict?.ok && Array.isArray(conflict.data) && conflict.data[0]) out.deal_conflict = conflict.data[0];
  }
  return out;
}

async function applyPlan(row, plan) {
  await ensurePriorityRows();
  const guard = await shouldWriteField({
    targetDb: DOMAIN_DB_TAG(DOMAIN),
    targetTable: DOMAIN_TABLE(DOMAIN),
    recordPk: String(row.sale_id),
    fieldName: 'listing_broker',
    value: plan.authoritativeValue,
    source: SOURCE_NORTHMARQ_ROSTER,
    sourceRunId: BATCH_TAG,
    confidence: CONF_NORTHMARQ_ROSTER,
  });
  if (!guard.write) return { ok: false, reason: guard.reason || guard.decision };

  const patch = await domainQuery(DOMAIN, 'PATCH',
    `sales_transactions?sale_id=eq.${enc(row.sale_id)}`,
    plan.patch,
    { Prefer: 'return=minimal' },
    { label: 'northmarq-broker-role', sourceRunId: BATCH_TAG });
  if (!patch.ok) return { ok: false, reason: `patch ${patch.status}`, data: patch.data };

  for (const link of plan.saleBrokerLinks) {
    const linked = await ensureBrokerLink(row.sale_id, link);
    if (!linked.ok) console.warn(`[northmarq-role] broker link failed sale=${row.sale_id} role=${link.role}: ${JSON.stringify(linked)}`);
  }
  await recordDisagreement(row, plan);
  await recordDealConflict(row, plan);
  return { ok: true };
}

let priorityRowsEnsured = false;
async function ensurePriorityRows() {
  if (priorityRowsEnsured) return;
  const rows = [
    {
      target_table: 'dia.sales_transactions',
      field_name: 'listing_broker',
      source: SOURCE_NORTHMARQ_ROSTER,
      priority: 20,
      min_confidence: 0.90,
      enforce_mode: 'record_only',
      notes: 'Prompt 03: authoritative Team Briggs/Northmarq sell-side broker from SF/SJC roster.',
    },
    {
      target_table: 'gov.sales_transactions',
      field_name: 'listing_broker',
      source: SOURCE_NORTHMARQ_ROSTER,
      priority: 20,
      min_confidence: 0.90,
      enforce_mode: 'record_only',
      notes: 'Prompt 03: authoritative Team Briggs/Northmarq sell-side broker from SF/SJC roster.',
    },
  ];
  await opsQuery('POST', 'field_source_priority', rows, {
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
  });
  priorityRowsEnsured = true;
}

async function main() {
  const rows = await fetchSales();
  const report = [];
  for (const row of rows) {
    const roster = await fetchRoster(row);
    const listingSignal = await fetchListingSignal(row);
    const planRow = { ...row, ...(roster || {}) };
    if (listingSignal?.is_northmarq === true) {
      planRow.is_northmarq = true;
      planRow.authoritative_listing_broker = /northmarq|briggs/i.test(String(listingSignal.listing_broker || ''))
        ? listingSignal.listing_broker
        : planRow.authoritative_listing_broker;
      planRow.sjc_team = planRow.sjc_team || 'Team Briggs';
    }
    if (FORCE_NORTHMARQ) planRow.is_northmarq = true;
    const plan = planNorthmarqListingBrokerReconciliation(planRow, {
      defaultBroker: DEFAULT_BROKER,
      allowDefaultBroker: !!PROPERTY_ID,
    });
    if (!['reconcile', 'noop'].includes(plan.action)) {
      if (PROPERTY_ID) {
        report.push({
          domain: DOMAIN,
          property_id: row.property_id,
          sale_id: row.sale_id,
          action: 'skip',
          reason: plan.reason,
          is_northmarq: row.is_northmarq,
          current_listing_broker: row.listing_broker,
          roster_source: roster ? 'v_sjc_deal_book' : 'none',
          listing_signal: listingSignal ? {
            listing_id: listingSignal.listing_id,
            is_northmarq: listingSignal.is_northmarq,
            listing_broker: listingSignal.listing_broker,
          } : null,
        });
      }
      continue;
    }
    const item = {
      domain: DOMAIN,
      property_id: row.property_id,
      sale_id: row.sale_id,
      action: plan.action,
      current_listing_broker: row.listing_broker,
      authoritative_listing_broker: plan.authoritativeValue,
      as_reported_listing_broker: plan.asReportedValue,
      roster_source: roster ? 'v_sjc_deal_book' : 'fallback',
      listing_signal: listingSignal ? {
        listing_id: listingSignal.listing_id,
        is_northmarq: listingSignal.is_northmarq,
        listing_broker: listingSignal.listing_broker,
      } : null,
    };
    if (APPLY && plan.action === 'reconcile') item.apply = await applyPlan(row, plan);
    if (PROPERTY_ID) item.retained_third_party_view = await retentionFor(row);
    if (APPLY && plan.action === 'noop' && item.retained_third_party_view?.disagreement?.channel_b_value) {
      await recordDealConflict(row, {
        authoritativeValue: plan.authoritativeValue,
        asReportedValue: item.retained_third_party_view.disagreement.channel_b_value,
        asReportedSource: 'costar_sidebar',
      });
      item.retained_third_party_view = await retentionFor(row);
    }
    report.push(item);
  }
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', batch_tag: BATCH_TAG, rows: report }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error('[northmarq-role] fatal:', err); process.exit(1); });
}
