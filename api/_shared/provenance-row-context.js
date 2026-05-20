// ============================================================================
// Provenance Review Queue — entity-context enrichment
// Life Command Center
//
// The queue view (v_field_provenance_review_queue) lives on LCC Opps and
// only stores (target_database, target_table, record_pk_value, field_name)
// pointers into the dia / gov domain DBs. Without entity context the queue
// reads as a wall of "8500 vs 33316 leased_area, record 18156" — a human
// reviewer can't tell which property/lease/contact they're judging.
//
// This helper takes a page of queue rows and decorates each with a
// `record_context: { label, sub }` pair by batch-fetching the underlying
// rows from the appropriate domain DB in two stages:
//
//   Stage 1: group by (target_database, target_table), one IN-list fetch
//            per group via domainQuery. Selects a small set of label
//            columns (address/tenant/file_name/etc).
//
//   Stage 2: for non-property tables we ALSO need the property address
//            (so a `dia.leases.lease_expiration` row can render "...for
//            123 Main St"). Collect every property_id touched in stage 1,
//            then one IN-list fetch per domain.
//
// Failure is silent and per-row: if domainQuery returns !ok we leave
// `record_context` null on that row. The queue still renders.
// ============================================================================

import { domainQuery } from './domain-db.js';

const DB_TO_DOMAIN = {
  dia_db: 'dialysis',
  gov_db: 'government',
};

// Per-table config: PK column, columns to select, how to render the row's
// own label, and how to extract the property_id (for the stage-2 join).
// Property tables themselves return null from propertyIdOf so we don't
// double-fetch them.
const TABLE_CONFIG = {
  'dia.properties': {
    pk: 'property_id',
    cols: 'property_id,address,city,state,tenant',
    label: labelProperty,
    propertyIdOf: () => null,
  },
  'gov.properties': {
    pk: 'property_id',
    cols: 'property_id,address,city,state',
    label: labelProperty,
    propertyIdOf: () => null,
  },
  'dia.leases': {
    pk: 'lease_id',
    cols: 'lease_id,property_id,tenant,lease_start,lease_expiration',
    label: (r) => {
      const exp = r.lease_expiration ? String(r.lease_expiration).slice(0, 10) : null;
      const parts = [r.tenant || 'lease'];
      if (exp) parts.push(`expires ${exp}`);
      return parts.join(' · ');
    },
    propertyIdOf: (r) => r.property_id,
  },
  'dia.contacts': {
    pk: 'contact_id',
    cols: 'contact_id,contact_name,role,property_id',
    label: (r) => {
      const parts = [r.contact_name || 'contact'];
      if (r.role) parts.push(r.role);
      return parts.join(' · ');
    },
    propertyIdOf: (r) => r.property_id,
  },
  'dia.property_documents': {
    pk: 'document_id',
    cols: 'document_id,property_id,file_name,document_type',
    label: (r) => {
      const parts = [r.file_name || 'document'];
      if (r.document_type) parts.push(r.document_type);
      return parts.join(' · ');
    },
    propertyIdOf: (r) => r.property_id,
  },
  'gov.property_documents': {
    pk: 'document_id',
    cols: 'document_id,property_id,file_name,document_type',
    label: (r) => {
      const parts = [r.file_name || 'document'];
      if (r.document_type) parts.push(r.document_type);
      return parts.join(' · ');
    },
    propertyIdOf: (r) => r.property_id,
  },
  'gov.parcel_records': {
    pk: 'parcel_id',
    cols: 'parcel_id,property_id,apn',
    label: (r) => `APN ${r.apn || '—'}`,
    propertyIdOf: (r) => r.property_id,
  },
};

function labelProperty(r) {
  const addr = [r.address, r.city, r.state].filter(Boolean).join(', ');
  return addr || `property ${r.property_id}`;
}

export async function enrichReviewQueueContext(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  // Initialize the field on every row so the frontend can rely on its
  // presence even if enrichment misses.
  for (const r of rows) r.record_context = null;

  // Stage 1: group queue rows by (database, table) so we can batch the
  // domain fetch per group.
  const groups = new Map(); // key -> { cfg, domain, table, pks: Set }
  for (const r of rows) {
    const cfg = TABLE_CONFIG[r.target_table];
    if (!cfg) continue;
    const domain = DB_TO_DOMAIN[r.target_database];
    if (!domain) continue;
    const key = `${domain}|${r.target_table}`;
    if (!groups.has(key)) {
      groups.set(key, { cfg, domain, table: r.target_table, pks: new Set() });
    }
    groups.get(key).pks.add(String(r.record_pk_value));
  }

  // records: `${target_table}|${pk_as_string}` -> fetched row
  const records = new Map();

  await Promise.all(Array.from(groups.values()).map(async (g) => {
    const tableName = g.table.split('.')[1]; // 'dia.leases' -> 'leases'
    const inList = Array.from(g.pks).join(',');
    const path = `${tableName}?${g.cfg.pk}=in.(${inList})&select=${g.cfg.cols}`;
    const r = await domainQuery(g.domain, 'GET', path);
    if (!r.ok || !Array.isArray(r.data)) return;
    for (const row of r.data) {
      const pk = String(row[g.cfg.pk]);
      records.set(`${g.table}|${pk}`, row);
    }
  }));

  // Stage 2: secondary lookup for property addresses, keyed by domain.
  const propertyIdsByDomain = { dialysis: new Set(), government: new Set() };
  for (const r of rows) {
    if (r.target_table === 'dia.properties' || r.target_table === 'gov.properties') continue;
    const cfg = TABLE_CONFIG[r.target_table];
    if (!cfg) continue;
    const rec = records.get(`${r.target_table}|${String(r.record_pk_value)}`);
    if (!rec) continue;
    const pid = cfg.propertyIdOf(rec);
    if (pid == null) continue;
    const domain = DB_TO_DOMAIN[r.target_database];
    if (!domain) continue;
    propertyIdsByDomain[domain].add(pid);
  }

  const propertyMap = new Map(); // `${domain}|${pid}` -> {address, city, state}
  await Promise.all(Object.entries(propertyIdsByDomain).map(async ([domain, set]) => {
    if (set.size === 0) return;
    const inList = Array.from(set).join(',');
    const path = `properties?property_id=in.(${inList})&select=property_id,address,city,state`;
    const r = await domainQuery(domain, 'GET', path);
    if (!r.ok || !Array.isArray(r.data)) return;
    for (const p of r.data) {
      propertyMap.set(`${domain}|${p.property_id}`, p);
    }
  }));

  // Stage 3: attach record_context to each row.
  for (const r of rows) {
    const cfg = TABLE_CONFIG[r.target_table];
    if (!cfg) continue;
    const rec = records.get(`${r.target_table}|${String(r.record_pk_value)}`);
    if (!rec) continue;

    const label = cfg.label(rec);
    let sub = null;
    if (r.target_table !== 'dia.properties' && r.target_table !== 'gov.properties') {
      const pid = cfg.propertyIdOf(rec);
      const domain = DB_TO_DOMAIN[r.target_database];
      if (pid != null && domain) {
        const p = propertyMap.get(`${domain}|${pid}`);
        if (p) sub = labelProperty(p);
      }
    }
    r.record_context = { label, sub };
  }
}
