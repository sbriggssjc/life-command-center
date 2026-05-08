#!/usr/bin/env node
// ============================================================================
// scripts/cm-refresh-catalog-snapshot.mjs
//
// Regenerates test/fixtures/cm-catalog-snapshot.json from the live LCC Opps
// `cm_chart_catalog` table. Run this whenever a catalog migration lands so
// the export-bundle audit test (test/cm-export-bundle-audit.test.js) keeps
// pace with the live catalog.
//
// Usage:
//   SUPABASE_URL=https://xengecqvemvfknjvbvrq.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//     node scripts/cm-refresh-catalog-snapshot.mjs
//
// Or rely on the existing OPS_DB_URL / OPS_DB_KEY env from .env.local —
// this script reuses the same credentials the API uses for opsQuery.
// ============================================================================

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, '..', 'test', 'fixtures', 'cm-catalog-snapshot.json');

const url = process.env.OPS_DB_URL || process.env.SUPABASE_URL;
const key = process.env.OPS_DB_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('ERROR: missing OPS_DB_URL / OPS_DB_KEY (or SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  console.error('Set them in your shell or in .env.local (the LCC Opps Supabase project).');
  process.exit(1);
}

const path = `cm_chart_catalog?select=chart_template_id,chart_type,applies_to_verticals,phase&order=chart_template_id.asc`;
const r = await fetch(`${url}/rest/v1/${path}`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
  },
});
if (!r.ok) {
  console.error(`Catalog query failed: HTTP ${r.status}`);
  console.error(await r.text());
  process.exit(2);
}
const allRows = await r.json();

// Filter to dialysis or gov (national_st has its own audit — out of scope here)
const filtered = allRows.filter((row) =>
  Array.isArray(row.applies_to_verticals) &&
  (row.applies_to_verticals.includes('dialysis') || row.applies_to_verticals.includes('gov'))
);

const today = new Date().toISOString().slice(0, 10);
const snapshot = {
  _doc: 'Snapshot of cm_chart_catalog from LCC Opps (xengecqvemvfknjvbvrq) for the export-bundle audit test. Filtered to chart_template_ids that ship to dialysis or gov. Refresh via `node scripts/cm-refresh-catalog-snapshot.mjs` after catalog migrations land. The audit test (test/cm-export-bundle-audit.test.js) reads this file and asserts every entry has a TAB_NAMES entry in cm-excel-export.js.',
  _refreshed_at: today,
  _filter: "applies_to_verticals contains 'dialysis' or 'gov'",
  templates: filtered.map((t) => ({
    chart_template_id:    t.chart_template_id,
    chart_type:           t.chart_type,
    applies_to_verticals: t.applies_to_verticals,
    phase:                t.phase,
  })),
};

writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
console.log(`Wrote ${filtered.length} templates to ${SNAPSHOT_PATH}`);
console.log('Run `npm test` to verify the audit still passes.');
