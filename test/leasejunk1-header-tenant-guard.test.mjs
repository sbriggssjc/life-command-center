// LEASEJUNK1 — OM / CoStar table-header text must never land in leases.tenant.
//
// Property 29671 (Tacoma) carried four lease rows whose tenant was a tenants-table
// header or summary label: "Type", "Shopping Center", "Strip Center", "Avail. Spaces"
// (lease_id 18398 was is_active=true). The writer is upsertDomainLeases
// (api/_handlers/sidebar-pipeline.js); the DB backstop is dia_is_om_table_header_tenant()
// + trigger dia_leasejunk1_header_tenant_guard_biu in
// supabase/migrations/dialysis/20261013090000_dia_leasejunk1_header_tenant_quarantine.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OM_TABLE_HEADER_TENANTS,
  isOmTableHeaderTenant,
  isJunkTenant,
  normalizeHeaderCandidate,
} from '../api/_handlers/sidebar-pipeline.js';
import { firstOf, firstOfWhere } from '../api/_shared/intake-classify.js';

const MIGRATION = 'supabase/migrations/dialysis/20261013090000_dia_leasejunk1_header_tenant_quarantine.sql';
const TACOMA_HEADERS = ['Type', 'Shopping Center', 'Strip Center', 'Avail. Spaces'];
const REAL_TENANTS = [
  'DaVita Kidney Care',
  'Fresenius Medical Care',
  'Total Renal Care, Inc (dba DaVita)',
  'U.S. Renal Care',
  // real names that CONTAIN a header word must pass — the match is exact, not substring
  'Shopping Center Dialysis LLC',
  'Strip Center Partners LLC',
  'Type A Dialysis',
];

test('the four Tacoma header strings are rejected by the header detector and by isJunkTenant', () => {
  for (const t of TACOMA_HEADERS) {
    assert.equal(isOmTableHeaderTenant(t), true, `${t} should be a header`);
    assert.equal(isJunkTenant(t), true, `${t} should be junk to the lease writer`);
  }
});

test('real tenant names pass both guards (the guard is not over-broad)', () => {
  for (const t of REAL_TENANTS) {
    assert.equal(isOmTableHeaderTenant(t), false, `${t} must not read as a header`);
    assert.equal(isJunkTenant(t), false, `${t} must not read as junk`);
  }
});

test('JS normalizer matches the live SQL dia_normalize_header_candidate() output', () => {
  // Values captured from dia_normalize_header_candidate() on zqzrriwuavgrquhisnoa, 2026-09-22.
  const measured = {
    'Type': 'type',
    'Avail. Spaces': 'avail. spaces',
    '  TENANT:  ': 'tenant',
    'Sq  Ft.': 'sq ft',
    'Office/Med Avail': 'office/med avail',
    '% of GLA': '% of gla',
    'Total Renal Care, Inc (dba DaVita)': 'total renal care, inc (dba davita)',
    'U.S. Renal Care': 'u.s. renal care',
  };
  for (const [raw, want] of Object.entries(measured)) {
    assert.equal(normalizeHeaderCandidate(raw), want, JSON.stringify(raw));
  }
  // and the live SQL detector's verdicts on those fixtures
  assert.equal(isOmTableHeaderTenant('  TENANT:  '), true);
  assert.equal(isOmTableHeaderTenant('Sq  Ft.'), true);
  assert.equal(isOmTableHeaderTenant('% of GLA'), true);
});

test('the JS header list and the SQL detector list are the same set (lock-step mirror)', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const fn = sql.slice(sql.indexOf('create or replace function dia_is_om_table_header_tenant'));
  const arr = fn.slice(fn.indexOf('array['), fn.indexOf(']::text[]'));
  const noComments = arr.replace(/--[^\n]*/g, '');
  const sqlList = [...noComments.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'"));
  assert.ok(sqlList.length > 20, `parsed ${sqlList.length} SQL entries — parser broke?`);
  assert.deepEqual([...sqlList].sort(), [...OM_TABLE_HEADER_TENANTS].sort());
  // every entry is already in normalized form, or the exact match could never hit it
  for (const h of OM_TABLE_HEADER_TENANTS) assert.equal(normalizeHeaderCandidate(h), h, h);
});

test('the Tacoma tenants[] shape: the lease writer keeps DaVita and drops every header', () => {
  // metadata.tenants[] as the extension's Tenants-panel parse produces it.
  const tenants = [
    { name: 'Type' },
    { name: 'Shopping Center' },
    { name: 'Strip Center' },
    { name: 'Avail. Spaces', sf: '8,569 SF' },
    { name: 'DaVita Kidney Care', sf: '7,500 SF' },
  ];
  // upsertDomainLeases' per-tenant loop skips on exactly this predicate.
  const kept = tenants.filter(t => t.name && !isJunkTenant(t.name)).map(t => t.name);
  assert.deepEqual(kept, ['DaVita Kidney Care']);
  const src = readFileSync('api/_handlers/sidebar-pipeline.js', 'utf8');
  assert.match(src, /if \(!t\.name \|\| isJunkTenant\(t\.name\)\) continue;/);
  assert.match(src, /if \(isJunkTenant\(tenantName\)\) \{/);
  assert.match(src, /export function isJunkTenant\(name\) \{[\s\S]{0,200}if \(isOmTableHeaderTenant\(n\)\) return true;/);
});

test('OM promote paths take the first NON-header tenant, never a header', () => {
  assert.equal(firstOf(['Type', 'Total Renal Care, Inc (dba DaVita)']), 'Type', 'control: plain firstOf takes the header');
  assert.equal(firstOfWhere(['Type', 'Total Renal Care, Inc (dba DaVita)'], isOmTableHeaderTenant),
    'Total Renal Care, Inc (dba DaVita)');
  assert.equal(firstOfWhere('["Avail. Spaces","DaVita"]', isOmTableHeaderTenant), 'DaVita');
  assert.equal(firstOfWhere('Strip Center', isOmTableHeaderTenant), null, 'a rejected scalar yields null, never itself');
  assert.equal(firstOfWhere('DaVita Kidney Care', isOmTableHeaderTenant), 'DaVita Kidney Care');
  assert.equal(firstOfWhere(null, isOmTableHeaderTenant), null);

  const promoter = readFileSync('api/_handlers/intake-promoter.js', 'utf8');
  assert.match(promoter, /tenant:\s+canonicalizeTenant\(firstOfWhere\(snapshot\.tenant_name, isOmTableHeaderTenant\)\)/);
  const intake = readFileSync('api/intake.js', 'utf8');
  assert.match(intake, /tenant_name: firstOfWhere\(extraction\.tenant_name, isOmTableHeaderTenant\)/);
  assert.match(intake, /primary_tenant: firstOfWhere\(extraction\.tenant_name, isOmTableHeaderTenant\)/);
});

test('app readers of dia leases exclude quarantined rows', () => {
  const read = p => readFileSync(p, 'utf8');
  assert.match(read('api/_handlers/property-handler.js'),
    /leases\?property_id=eq\.\$\{enc\(domainProperty\.property_id\)\}&data_quality_flag=is\.null/);
  assert.match(read('api/_shared/asset-entity.js'),
    /longDomain === 'dialysis' \? '&data_quality_flag=is\.null' : ''/);
  assert.match(read('api/_handlers/entities-handler.js'),
    /superseded_at=is\.null\$\{domain === 'dia' \? '&data_quality_flag=is\.null' : ''\}/);
  assert.match(read('detail.js'),
    /diaQuery\('leases', '\*', \{ filter: `property_id=eq\.\$\{encodeURIComponent\(propId\)\}`, filter2: 'data_quality_flag=is\.null'/);
  const dia = read('dialysis.js');
  assert.match(dia, /source_confidence,data_quality_flag(,expiration_state)?\)\)/);
  assert.match(dia, /function pickCurrentLease\(leases\) \{\n  leases = dropQuarantinedLeases\(leases\);/);
});

test('the migration quarantines reversibly and never deletes', () => {
  const sql = readFileSync(MIGRATION, 'utf8').replace(/--[^\n]*/g, '');
  assert.doesNotMatch(sql, /\bdelete\s+from\s+leases\b/i);
  assert.match(sql, /create table if not exists dia_leasejunk1_quarantine_log/);
  assert.match(sql, /create or replace function dia_leasejunk1_restore_quarantine/);
  assert.match(sql, /before insert or update of tenant, is_active, status on leases/);
  assert.match(sql, /if new\.data_quality_flag is not null then return new; end if;/);
});
