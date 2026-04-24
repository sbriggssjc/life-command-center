#!/usr/bin/env node
// Quick check: list gov.available_listings rows for a property.
// Usage: node scripts/check-gov-listings.mjs <property_id>
import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const propId = process.argv[2];
if (!propId) { console.error('Usage: node scripts/check-gov-listings.mjs <property_id>'); process.exit(1); }

const GOV_URL = env.GOV_SUPABASE_URL;
const GOV_KEY = env.GOV_SUPABASE_KEY;
if (!GOV_URL || !GOV_KEY) { console.error('Missing GOV creds'); process.exit(1); }

async function gov(method, path) {
  const res = await fetch(`${GOV_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: GOV_KEY, Authorization: `Bearer ${GOV_KEY}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

const r = await gov('GET',
  `available_listings?property_id=eq.${propId}` +
  `&select=listing_id,source_listing_ref,listing_source,listing_status,asking_price,listing_date,first_seen_at,is_northmarq` +
  `&order=first_seen_at.desc&limit=20`
);

console.log(`Gov available_listings for property ${propId}:`);
if (!r.ok) { console.log(`  ERROR status=${r.status}`, r.data); process.exit(1); }
for (const row of r.data || []) {
  console.log(`  listing_id=${row.listing_id}  source=${row.listing_source}  ref=${row.source_listing_ref}  status=${row.listing_status}  price=${row.asking_price}  first_seen=${row.first_seen_at}  nm=${row.is_northmarq}`);
}
console.log(`\n${r.data?.length || 0} rows\n`);
