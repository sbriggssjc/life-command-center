// SALE-PROMOTER1 (2026-09-25) — record the sales Salesforce and the CoStar sidebar already know
// about, so a sold dia listing closes itself through LISTING-SALE-PARITY1's triggers.
//
// Behavioural. The parity migration and then supabase/migrations/dialysis/20261015130000_dia_sale_promoter1.sql
// are applied, byte for byte, to a throwaway Postgres cluster (the parity test's seed, read from
// test/listing-sale-parity1.test.mjs, plus the columns this file writes). Then:
//   * the shared rule block matches the md5 pinned in both repos (government-lease
//     tests/unit/test_sale_promoter1.py) and answers every case of the shared fixture;
//   * a date-only candidate is refused and writes nothing;
//   * a price+date Salesforce comp promotes and the parity trigger closes and links its listing;
//   * an existing sale within 30 days (any state) refuses the candidate;
//   * a second run writes nothing;
//   * an owner-user sale is recorded excluded from market metrics and queued for review;
//   * a same-price sale on another property in the same city is refused and queued for review;
//   * 'listed_over_2y' is measured from the capture date when the on-market date is an older SF date.
// Each rule has a mutation that must turn its case red. Skips when no PostgreSQL binaries exist.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, chmodSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'supabase', 'migrations', 'dialysis');
const PARITY = join(DIR, '20261014120000_dia_listing_sale_parity1.sql');
const MIGRATION = join(DIR, '20261015130000_dia_sale_promoter1.sql');
const CASES = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'sale_candidate_verdict_cases.json'), 'utf8'));
const BEGIN = '-- ===== BEGIN lcc_sale_candidate_verdict';
const END = '-- ===== END lcc_sale_candidate_verdict =====';
// Pinned in both repos (government-lease tests/unit/test_sale_promoter1.py). Change the function on
// BOTH DBs and both pins together, or not at all.
const VERDICT_MD5 = 'b92f6fa8b82a9a6967c15c61bd38d8d7';
const PORT = '55463';

// The parity test's seed is the live dia shape; reuse it rather than keeping a second copy.
const parityTest = readFileSync(join(ROOT, 'test', 'listing-sale-parity1.test.mjs'), 'utf8');
const SEED = parityTest.slice(parityTest.indexOf('const SEED = String.raw`') + 'const SEED = String.raw`'.length,
  parityTest.indexOf('`;', parityTest.indexOf('const SEED = String.raw`')));
const EXTRA = `
alter table sales_transactions add column buyer_name varchar, add column seller_name varchar,
  add column data_source text, add column transaction_type text, add column notes text;
alter table available_listings add column on_market_date_source text;
create table sf_comp_staging (staging_id bigserial primary key, sf_comp_id text, imported_at timestamptz default now(),
  source_system text default 'salesforce',
  comp_type text default 'External', status text default 'Sold', raw_row jsonb default '{}'::jsonb,
  street text, state text, sold_date date, sold_price numeric, linked_property_id integer,
  normalized_address text);
`;

function pgBin() {
  const base = '/usr/lib/postgresql';
  if (!existsSync(base)) return null;
  const vers = readdirSync(base).sort((a, b) => Number(b) - Number(a));
  for (const v of vers) if (existsSync(join(base, v, 'bin', 'initdb'))) return join(base, v, 'bin');
  return null;
}
const isRoot = typeof process.geteuid === 'function' && process.geteuid() === 0;
const asPg = (cmd) => (isRoot ? ['runuser', '-u', 'postgres', '--', ...cmd] : cmd);
const BIN = pgBin();
const SKIP = !BIN || (isRoot && spawnSync('which', ['runuser']).status !== 0)
  ? 'no PostgreSQL binaries available' : false;

let dir; let n = 0;
function run(cmd) {
  const [c, ...a] = asPg(cmd);
  return spawnSync(c, a, { encoding: 'utf8', timeout: 60000 });
}
function psql(sql, db = 'postgres', check = true) {
  const r = spawnSync(join(BIN, 'psql'), ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1',
    '-h', dir, '-p', PORT, '-U', 'postgres', '-d', db], { input: sql, encoding: 'utf8' });
  if (check && r.status !== 0) throw new Error(r.stderr);
  return r;
}
const q = (sql, db) => psql(sql, db).stdout.trim();
const migration = () => readFileSync(MIGRATION, 'utf8');
function freshDb(sql) {
  n += 1;
  const db = `sp1dia_${n}`;
  psql(`create database ${db};`);
  for (const s of [SEED, readFileSync(PARITY, 'utf8'), EXTRA, sql]) psql(s, db);
  return db;
}
function mutate(pairs) {
  let t = migration();
  for (const [o, nw] of pairs) { assert.ok(t.includes(o), o); t = t.replace(o, nw); }
  return t;
}
const lit = (v) => (v === null || v === undefined ? 'null' : `'${v}'`);
function prop(db, pid, addr = '100 Main St', city = 'Austin', state = 'TX') {
  q(`insert into properties values (${pid}, '${addr}', '${city}', '${state}');`, db);
}
function listing(db, pid, { seen = '2026-05-01', ask = null, omd = null, conf = null, oms = null } = {}) {
  return q(`insert into available_listings (property_id, status, is_active, listing_date, listing_date_source,
    on_market_date, on_market_date_confidence, on_market_date_source, last_seen, last_price)
    values (${pid}, 'active', true, ${lit(seen)}, 'capture_date_fallback', ${lit(omd)}, ${lit(conf)}, ${lit(oms)},
    ${lit(seen)}, ${lit(ask)}) returning listing_id;`, db);
}
function sf(db, ref, pid, d, price, state = 'TX') {
  q(`insert into sf_comp_staging (sf_comp_id, linked_property_id, sold_date, sold_price, state)
     values ('${ref}', ${pid}, '${d}', ${price ?? 'null'}, '${state}');`, db);
}
function sidebar(db, pid, d, { price = null, saleType = null } = {}) {
  q(`insert into dia_sidebar_sale_candidate (entity_id, row_key, property_id, sale_date, sale_price, sale_type)
     values (gen_random_uuid(), 'r1', ${pid}, '${d}', ${price ?? 'null'}, ${lit(saleType)});`, db);
}
function runP(db, runId = 't1') {
  const out = q(`select source_ref || '=' || decision from dia_promote_market_sales(false, '2020-01-01', null, '${runId}');`, db);
  return Object.fromEntries(out.split('\n').filter(Boolean).map((l) => l.split('=')));
}
const status = (db, lid) => q(`select status, coalesce(sale_transaction_id::text,'') from available_listings where listing_id = ${lid};`, db).split('|');
const nSales = (db) => Number(q('select count(*) from sales_transactions;', db));

before(() => {
  if (SKIP) return;
  dir = mkdtempSync(join(tmpdir(), 'sp1dia_'));
  chmodSync(dir, 0o777);
  const data = join(dir, 'data');
  let r = run([join(BIN, 'initdb'), '-D', data, '-A', 'trust', '-U', 'postgres', '-E', 'UTF8']);
  if (r.status !== 0) throw new Error(r.stderr);
  r = run([join(BIN, 'pg_ctl'), '-D', data, '-w', '-l', join(dir, 'pg.log'), '-o',
    `-k ${dir} -c listen_addresses='' -p ${PORT}`, 'start']);
  if (r.status !== 0) throw new Error(r.stderr);
  psql('create role anon; create role authenticated; create role service_role bypassrls;');
});
after(() => {
  if (SKIP || !dir) return;
  run([join(BIN, 'pg_ctl'), '-D', join(dir, 'data'), '-m', 'immediate', 'stop']);
  rmSync(dir, { recursive: true, force: true });
});

test('the rule block matches the md5 pinned in both repos', () => {
  const t = migration();
  const block = t.slice(t.indexOf(BEGIN), t.indexOf(END) + END.length);
  assert.equal(createHash('md5').update(block).digest('hex'), VERDICT_MD5);
});

test('the shared rule answers every fixture case', { skip: SKIP }, () => {
  const db = freshDb(migration());
  for (const c of CASES) {
    const a = c.args;
    const got = q(`select lcc_sale_candidate_verdict(${lit(a.sale_date)}::date, ${lit(a.price)}::numeric,
      ${lit(a.has_party)}::boolean, ${lit(a.has_recording)}::boolean, ${lit(a.sale_type)}::text, ${lit(a.deed_type)}::text,
      ${lit(a.recordation_date)}::date, ${lit(a.is_portfolio)}::boolean, ${lit(a.as_of)}::date);`, db);
    assert.equal(got, c.expect, c.name);
  }
});

const S = {
  dateOnlyRefused(db) {
    prop(db, 1);
    const lid = listing(db, 1);
    sidebar(db, 1, '2026-07-01');
    const d = runP(db);
    return JSON.stringify(Object.values(d)) === '["refuse_date_only"]' && nSales(db) === 0 && status(db, lid)[0] === 'active';
  },
  placeholderPartyIsNotAParty(db) {
    prop(db, 14);
    q(`insert into dia_sidebar_sale_candidate (entity_id, row_key, property_id, sale_date, buyer)
       values (gen_random_uuid(), 'r1', 14, '2026-07-01', 'Undisclosed');`, db);
    const d = runP(db);
    return JSON.stringify(Object.values(d)) === '["refuse_date_only"]' && nSales(db) === 0;
  },
  stagedTwicePromotesOnce(db) {
    prop(db, 15);
    sf(db, 'sfT', 15, '2026-07-20', 2000000);
    sf(db, 'sfT', 15, '2026-07-20', 2000000);
    const out = q("select decision from dia_promote_market_sales(false, '2020-01-01', null, 't1');", db).split('\n');
    return JSON.stringify(out) === '["promoted_market"]' && nSales(db) === 1;
  },
  priceDatePromotesAndCloses(db) {
    prop(db, 2);
    const lid = listing(db, 2, { seen: '2026-06-09', ask: 2200000 });
    sf(db, 'sfA', 2, '2026-07-06', 2200000);
    const d = runP(db);
    const sid = q("select sale_id from sales_transactions where notes like '%sfA%' and not exclude_from_market_metrics;", db);
    return d.sfA === 'promoted_market' && sid !== '' && JSON.stringify(status(db, lid)) === JSON.stringify(['sold', sid]);
  },
  duplicateWithin30dRefused(db) {
    prop(db, 3);
    q("insert into sales_transactions (property_id, sale_date, sold_price, transaction_state) values (3, '2026-07-01', 1500000, 'needs_review');", db);
    sf(db, 'sfB', 3, '2026-07-20', 2000000);
    const d = runP(db);
    return d.sfB === 'refuse_existing_sale_within_30d' && nSales(db) === 1;
  },
  secondRunWritesNothing(db) {
    prop(db, 4);
    listing(db, 4, { seen: '2026-05-19', ask: 2320000 });
    sf(db, 'sfC', 4, '2026-07-20', 2000000);
    sidebar(db, 4, '2025-01-01');
    runP(db, 'r1');
    const before = q('select count(*), max(last_changed_at) from dia_sale_promote_log;', db);
    const n1 = nSales(db);
    const d2 = runP(db, 'r2');
    const afterLog = q('select count(*), max(last_changed_at) from dia_sale_promote_log;', db);
    return n1 === 1 && nSales(db) === 1 && before === afterLog && d2.sfC === 'skip_already_promoted';
  },
  nonMarketRecordedAndReviewed(db) {
    prop(db, 5);
    const lid = listing(db, 5, { seen: '2026-08-05', ask: 1859000 });
    sidebar(db, 5, '2026-07-29', { price: 1600000, saleType: 'Owner User' });
    const d = runP(db);
    const ex = q('select exclude_from_market_metrics from sales_transactions where property_id = 5;', db);
    const rv = q(`select verdict from dia_listing_sale_review where listing_id = ${lid};`, db);
    return JSON.stringify(Object.values(d)) === '["promoted_non_market"]' && ex === 't'
      && status(db, lid)[0] === 'active' && rv === 'review_non_market_sale';
  },
  otherPropertyRefused(db) {
    prop(db, 6, '5340A W 159th St', 'Oak Forest', 'IL');
    prop(db, 7, '5340 159th St', 'Oak Forest', 'IL');
    const other = q("insert into sales_transactions (property_id, sale_date, sold_price) values (7, '2026-08-01', 3181500) returning sale_id;", db);
    const lid = listing(db, 6, { seen: '2026-06-09', ask: 3328000 });
    sf(db, 'sfD', 6, '2026-08-06', 3181500, 'IL');
    const d = runP(db);
    const rv = q(`select sale_id || ':' || verdict from dia_listing_sale_review where listing_id = ${lid};`, db);
    return d.sfD === 'refuse_sale_on_other_property' && nSales(db) === 1 && rv === `${other}:review_sale_on_other_property`;
  },
  staleRuleUsesCapture(db) {
    prop(db, 8);
    prop(db, 9);
    const freshOm = listing(db, 8, { seen: '2026-06-01', omd: '2019-03-01', conf: 'high', oms: 'sf_on_market_date' });
    const old = listing(db, 9, { seen: '2026-06-01', omd: '2019-03-01', conf: 'medium', oms: 'days_on_market' });
    const got = new Set(q('select listing_id from dia_route_stale_listings_to_verification(true);', db).split('\n'));
    return got.has(old) && !got.has(freshOm);
  },
};

for (const [name, fn] of Object.entries(S)) {
  test(`behaviour: ${name}`, { skip: SKIP }, () => { assert.ok(fn(freshDb(migration()))); });
}

const MUTATIONS = [
  ['dateOnlyRefused', [["     AND NOT coalesce(p_has_recording, false) THEN\n    RETURN 'refuse_date_only';",
    "     AND false THEN\n    RETURN 'refuse_date_only';"],
  ["NULL, false, '2026-09-25') <> 'refuse_date_only' THEN", "NULL, false, '2026-09-25') IS NULL THEN"]]],
  ['placeholderPartyIsNotAParty', [["CASE WHEN x.buyer ~* '^\\s*(undisclosed|", "CASE WHEN x.buyer ~* '^\\s*(neverneverxx|"]]],
  ['stagedTwicePromotesOnce', [['      FROM (SELECT DISTINCT ON (s0.sf_comp_id) s0.*', '      FROM (SELECT s0.*']]],
  ['priceDatePromotesAndCloses', [["IF NOT p_dry_run AND r.decision LIKE 'promote_%' THEN", "IF NOT p_dry_run AND r.decision LIKE 'promoteX%' THEN"]]],
  ['duplicateWithin30dRefused', [["AND abs(s.sale_date - c.sd) <= 30) THEN 'refuse_existing_sale_within_30d'",
    "AND abs(s.sale_date - c.sd) <= -1) THEN 'refuse_existing_sale_within_30d'"]]],
  ['secondRunWritesNothing', [["      WHEN lg.decision LIKE 'promoted_%' THEN 'skip_already_promoted'\n", ''],
    ["AND abs(s.sale_date - c.sd) <= 30) THEN 'refuse_existing_sale_within_30d'", "AND abs(s.sale_date - c.sd) <= -1) THEN 'refuse_existing_sale_within_30d'"],
    ['AND abs(s.sale_date - c.sd) <= 400', 'AND abs(s.sale_date - c.sd) <= -1']]],
  ['nonMarketRecordedAndReviewed', [["|partial interest|auction|foreclos|\\mreo\\M|condo)' THEN", "|partial interest|auction|foreclos|\\mreo\\M|condo)' AND false THEN"]]],
  ['otherPropertyRefused', [["AND abs(s.sold_price - c.sp) <= 0.005 * c.sp) THEN 'refuse_sale_on_other_property'",
    "AND abs(s.sold_price - c.sp) <= -1) THEN 'refuse_sale_on_other_property'"]]],
  ['staleRuleUsesCapture', [["  SELECT CASE WHEN p_on_market_source = 'sf_on_market_date' AND p_capture IS NOT NULL",
    '  SELECT CASE WHEN false AND p_capture IS NOT NULL']]],
];

for (const [name, pairs] of MUTATIONS) {
  test(`mutation turns red: ${name}`, { skip: SKIP }, () => {
    const db = freshDb(mutate(pairs)); // a mutation must not break the migration itself
    assert.equal(S[name](db), false);
  });
}
