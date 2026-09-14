#!/usr/bin/env node
// ============================================================================
// scripts/check-field-source-priority-columns.mjs
//
// PR5/PR7 — the standing check for a ladder rung that names a column its target
// table does not have. A rung on a nonexistent column is a claim about authority
// that can never be true: `lcc_merge_field` will happily record provenance for
// it, and the ladder for the REAL column is never consulted.
//
// WHY THIS IS A SCRIPT AND NOT A TEST OR A VIEW — say it plainly, because
// CLAUDE.md is explicit that "guarded by test/x.test.mjs" must not be written
// about something no gate runs:
//
//   * It cannot be a repo test. The rungs live on LCC Opps and the columns live
//     on the dia and gov databases. Neither schema is derivable from this repo,
//     and a committed column census would rot in the WRONG direction — a column
//     legitimately added tomorrow would make the guard go red over correct code.
//   * It cannot be a single SQL view. No database can see both sides: LCC has no
//     read path into the domain information_schema (adding one would widen the
//     data-query allowlist), and the domains cannot read field_source_priority.
//
//   So it is an OPERATOR-RUN check, like `npm run verify:deploy`. It is a
//   regression detector for whoever runs it, NOT a merge gate. The pure half
//   (parseMissingColumn / planTableProbes / summarise) is unit-tested in
//   test/pr5-ladder-source-triage.test.mjs; the network half is not.
//
// HOW IT PROBES — deliberately through PostgREST, not information_schema.
// A `GET /<table>?select=<cols>&limit=0` against a nonexistent column returns
// HTTP 400 with PostgREST code 42703 naming the column. That is the SAME
// surface every writer uses, so this answers the question that actually matters
// ("can a write name this column?") rather than the question a schema mirror
// answers. It also needs no new database object on either domain — relevant
// while SEC1 is open on definer functions.
//
// Usage:
//   node scripts/check-field-source-priority-columns.mjs                 # both domains
//   node scripts/check-field-source-priority-columns.mjs --domain government
//   node scripts/check-field-source-priority-columns.mjs --json
//
// Exit codes: 0 clean · 1 orphan rungs found · 2 bad usage/credentials.
//
// ⚠️ WHAT WAS AND WAS NOT VERIFIED (2026-09-02). The SQL half is positive-
// controlled live: an injected fake pair (`properties.__pr5_positive_control__`)
// is reported while a real column beside it is not, so the comparison can fire.
// The Postgres wording is confirmed live too — `column "__pr5_no_such_column__"
// does not exist`, code 42703. What could NOT be exercised end to end is the
// PostgREST ENVELOPE around that message: the sandbox holds no OPS_/DIA_/GOV_
// credentials. parseMissingColumn therefore handles both observed shapes
// (`column x does not exist` and `column table.x does not exist`) and is unit
// tested on both — but the first real run is the positive control that matters,
// and if it aborts with a non-42703 body, read the body before changing the
// regex: an abort is the designed behaviour, not a bug.
//
// ⚠️ EXPECTED NON-ZERO TODAY. The 2026-09-02 baseline is 19 (table, column)
// pairs carrying 49 rungs, all of them marked `PR7:orphan_column` in
// field_source_priority.notes and visible on v_field_source_priority_triage.
// Pass --baseline to exit 0 while the reported set is a SUBSET of that baseline
// and non-zero only on something NEW — which is the signal worth waking up for.
// ============================================================================

import { pathToFileURL } from 'node:url';
import { loadEnvForScripts } from './_env-file.mjs';

// --- pure half -------------------------------------------------------------

// The 2026-09-02 measured baseline. Keep it in sync with the PR7 markers the
// migration writes; the test asserts the two agree in SHAPE, not in content,
// because the migration is the record and this is only a convenience.
export const PR7_BASELINE_2026_09_02 = [
  'dia.recorded_owners.sf_company_id',
  'dia.sales_transactions.asking_cap',
  'dia.sales_transactions.asking_price',
  'dia.sales_transactions.last_price',
  'dia.sales_transactions.last_price_change',
  'dia.sales_transactions.listing_price',
  'dia.sales_transactions.original_price',
  'dia.sales_transactions.sold_cap_rate',
  'gov.properties.parcel_number',
  'gov.properties.recorded_owner_name',
  'gov.properties.tenant',
  'gov.sales_transactions.asking_cap',
  'gov.sales_transactions.asking_price',
  'gov.sales_transactions.buyer_name',
  'gov.sales_transactions.last_price_change',
  'gov.sales_transactions.listing_price',
  'gov.sales_transactions.original_price',
  'gov.sales_transactions.procuring_broker',
  'gov.sales_transactions.seller_name',
];

/**
 * PostgREST reports an unknown column as 42703 and names it in `message`.
 * Returns the column name, or null when the body is any other error — a null
 * MUST abort the caller's bisect rather than being read as "column is fine",
 * or a permission error would be laundered into a clean bill of health.
 */
export function parseMissingColumn(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.code !== '42703') return null;
  const m = /column\s+(?:\S+\.)?"?([A-Za-z0-9_]+)"?\s+does not exist/i.exec(String(body.message || ''));
  if (m) return m[1];
  const m2 = /"?([A-Za-z0-9_]+)"?\s+does not exist/i.exec(String(body.message || ''));
  return m2 ? m2[1] : null;
}

/**
 * Group rungs into one probe per physical table for a single domain.
 * `rungs` are {target_table, field_name} with the logical `dia.`/`gov.` prefix.
 */
export function planTableProbes(rungs, prefix) {
  const byTable = new Map();
  for (const r of rungs || []) {
    if (!r || typeof r.target_table !== 'string') continue;
    if (!r.target_table.startsWith(prefix + '.')) continue;
    const table = r.target_table.slice(prefix.length + 1);
    if (!table || !r.field_name) continue;
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table).add(r.field_name);
  }
  return [...byTable.entries()]
    .map(([table, cols]) => ({ table, columns: [...cols].sort() }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

export function summarise(found, baseline = PR7_BASELINE_2026_09_02) {
  const known = new Set(baseline);
  const sorted = [...new Set(found)].sort();
  return {
    orphans: sorted,
    newSinceBaseline: sorted.filter((x) => !known.has(x)),
    clearedSinceBaseline: [...known].filter((x) => !sorted.includes(x)).sort(),
  };
}

// --- network half ----------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const baselineMode = argv.includes('--baseline');
  const only = (() => {
    const i = argv.indexOf('--domain');
    if (i === -1) return null;
    const v = String(argv[i + 1] || '').toLowerCase();
    if (v !== 'dialysis' && v !== 'government') { console.error('--domain must be dialysis or government'); process.exit(2); }
    return v;
  })();

  const env = loadEnvForScripts();
  const OPS_URL = env.OPS_SUPABASE_URL;
  const OPS_KEY = env.OPS_SUPABASE_KEY;
  if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS_SUPABASE_URL / OPS_SUPABASE_KEY'); process.exit(2); }

  const domains = [
    { name: 'dialysis',   prefix: 'dia', url: env.DIA_SUPABASE_URL, key: env.DIA_SUPABASE_SERVICE_KEY || env.DIA_SUPABASE_KEY },
    { name: 'government', prefix: 'gov', url: env.GOV_SUPABASE_URL, key: env.GOV_SUPABASE_SERVICE_KEY || env.GOV_SUPABASE_KEY },
  ].filter((d) => !only || d.name === only);

  const rungsRes = await fetch(
    `${OPS_URL}/rest/v1/field_source_priority?select=target_table,field_name&limit=10000`,
    { headers: { apikey: OPS_KEY, Authorization: `Bearer ${OPS_KEY}` } },
  );
  if (!rungsRes.ok) { console.error(`field_source_priority read failed: ${rungsRes.status}`); process.exit(2); }
  const rungs = await rungsRes.json();

  const found = [];
  for (const d of domains) {
    if (!d.url || !d.key) { console.error(`Missing credentials for ${d.name}; cannot check it — refusing to report it clean.`); process.exit(2); }
    for (const probe of planTableProbes(rungs, d.prefix)) {
      let cols = [...probe.columns];
      // Bisect by removal: each 400 names exactly one bad column, drop it, retry.
      for (let guard = 0; guard <= probe.columns.length; guard++) {
        if (cols.length === 0) break;
        const res = await fetch(
          `${d.url}/rest/v1/${probe.table}?select=${encodeURIComponent(cols.join(','))}&limit=0`,
          { headers: { apikey: d.key, Authorization: `Bearer ${d.key}` } },
        );
        if (res.ok) break;
        let body = null;
        try { body = JSON.parse(await res.text()); } catch { body = null; }
        const missing = parseMissingColumn(body);
        if (!missing) {
          console.error(`${d.prefix}.${probe.table}: probe failed for a reason that is not 42703 — ${res.status} ${JSON.stringify(body)}`);
          console.error('Refusing to report this table clean (an auth or table error is not "no orphans").');
          process.exit(2);
        }
        found.push(`${d.prefix}.${probe.table}.${missing}`);
        cols = cols.filter((c) => c !== missing);
      }
    }
  }

  const out = summarise(found);
  if (asJson) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`orphan rungs (table.column pairs): ${out.orphans.length}`);
    for (const o of out.orphans) console.log(`  ${o}${PR7_BASELINE_2026_09_02.includes(o) ? '' : '   <-- NEW since the 2026-09-02 baseline'}`);
    if (out.clearedSinceBaseline.length) console.log(`cleared since baseline: ${out.clearedSinceBaseline.join(', ')}`);
  }
  if (baselineMode) process.exit(out.newSinceBaseline.length ? 1 : 0);
  process.exit(out.orphans.length ? 1 : 0);
}

// ⚠️ Windows: argv[1] is a drive path while import.meta.url is file:///C:/... —
// a string-built `file://` comparison never matches, main() never runs, and the
// command exits 0 having done nothing (CLAUDE.md, OCR1). pathToFileURL is the
// only correct form, and a check that silently passes is worse than no check.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
