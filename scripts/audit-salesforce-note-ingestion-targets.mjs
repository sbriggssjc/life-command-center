#!/usr/bin/env node
import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();

const DBS = [
  { name: 'lcc_opps', url: env.OPS_SUPABASE_URL, key: env.OPS_SUPABASE_KEY },
  { name: 'gov_db', url: env.GOV_SUPABASE_URL, key: env.GOV_SUPABASE_SERVICE_KEY || env.GOV_SUPABASE_KEY },
  { name: 'dia_db', url: env.DIA_SUPABASE_URL, key: env.DIA_SUPABASE_SERVICE_KEY || env.DIA_SUPABASE_KEY },
];

const checks = {
  lcc_opps: [
    ['entities', ''],
    ['entities.person', 'entity_type=eq.person'],
    ['entities.organization', 'entity_type=eq.organization'],
    ['entities.asset', 'entity_type=eq.asset'],
    ['external_identities.salesforce', 'source_system=eq.salesforce'],
    ['external_identities.salesforce_accounts', 'source_system=eq.salesforce&source_type=eq.Account'],
    ['external_identities.salesforce_contacts', 'source_system=eq.salesforce&source_type=eq.Contact'],
    ['entity_relationships', ''],
    ['activity_events.salesforce', 'source_type=eq.salesforce'],
    ['salesforce_activity_log', ''],
    ['action_items.sf_sync', 'source_type=eq.sf_sync'],
    ['field_provenance.legacy_notes', 'source=eq.salesforce_legacy_note'],
    ['sf_sync_queue', ''],
  ],
  gov_db: [
    ['unified_contacts', ''],
    ['unified_contacts.sf_contact', 'sf_contact_id=not.is.null'],
    ['unified_contacts.sf_account', 'sf_account_id=not.is.null'],
    ['contacts.sf_contact', 'sf_contact_id=not.is.null'],
    ['true_owners.sf_account', 'sf_account_id=not.is.null'],
    ['properties', ''],
    ['available_listings', ''],
  ],
  dia_db: [
    ['contacts.sf_contact', 'sf_contact_id=not.is.null'],
    ['properties', ''],
    ['properties.tenant_present', 'tenant=not.is.null'],
    ['true_owners.sf_account', 'sf_account_id=not.is.null'],
    ['available_listings', ''],
    ['sales_transactions', ''],
    ['leases', ''],
    ['salesforce_activities.open_opps', 'nm_type=eq.Opportunity&is_closed=eq.false'],
  ],
};

async function countRows(db, table, filter) {
  const [baseTable] = table.split('.');
  const query = filter ? `?${filter}&select=*` : '?select=*';
  const url = `${db.url.replace(/\/+$/, '')}/rest/v1/${baseTable}${query}`;
  const res = await fetch(url, {
    method: 'HEAD',
    headers: {
      apikey: db.key,
      Authorization: `Bearer ${db.key}`,
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, count: res.headers.get('content-range')?.split('/').pop() || 'unknown' };
}

for (const db of DBS) {
  console.log(`\n=== ${db.name} ===`);
  if (!db.url || !db.key) {
    console.log('missing env');
    continue;
  }
  for (const [label, filter] of checks[db.name]) {
    const result = await countRows(db, label, filter);
    console.log(`${label}: ${result.ok ? result.count : `error ${result.status}`}`);
  }
}
