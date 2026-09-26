// DUP-RECORDS1 (2026-09-26) — duplicate dia property rows merge only on TWO independent signals,
// a junk address is refused at the property writer, and one capture resolves one property.
//
// Behavioural. supabase/migrations/dialysis/20261016120000_dia_dup_records1_property_merge.sql and
// 20261016130000_dia_dup_records1_junk_address_guard.sql are applied, byte for byte, to a throwaway
// Postgres cluster over the live address normalizers (test/fixtures/dia-address-normalizers.sql) and
// a minimal seed. dia_merge_property_reversible is a stub that behaves like the real one where it
// matters here: it repoints children and DELETES the drop row's active listings when the keep row has
// one (that is why dia_dup1_merge_pair supersedes first).
//   * two signals (address + year/lot) merge; one signal files a card and writes nothing;
//   * a human confirmation is the second signal;
//   * a duplicate active listing is superseded (kept, logged), never deleted, and its blanks fill the keep listing;
//   * dia_dup1_restore puts every write back;
//   * the junk-address trigger refuses a "For Sale | ..." insert and an address change to one, and leaves
//     an existing junk row's other columns writable.
// The JS half: addressesIdentityEquivalent treats "5340A W 159th St" == "5340 159th St" and
// "802 N John Young Pky" == "802 John Young Parkway", never 100A == 100B.
// Each rule has a mutation that must turn its case red. Skips when no PostgreSQL binaries exist.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, chmodSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addressesIdentityEquivalent, splitCivicUnitLetter } from '../api/_handlers/sidebar-pipeline.js';
import { buildStagingRows, runSidebarSaleFeed } from '../api/_handlers/sidebar-sale-feed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'supabase', 'migrations', 'dialysis');
const MERGE = join(DIR, '20261016120000_dia_dup_records1_property_merge.sql');
const GUARD = join(DIR, '20261016130000_dia_dup_records1_junk_address_guard.sql');
const NORMALIZERS = readFileSync(join(ROOT, 'test', 'fixtures', 'dia-address-normalizers.sql'), 'utf8');
const PORT = '55467';

const SEED = String.raw`
create extension if not exists pgcrypto;
-- Stand-in for the live operator normalizer: enough brands for the veto tests.
create function dia_normalize_operator(t text) returns text language sql immutable as $$
  select case when t is null or btrim(t) = '' then null
              when t ~* 'davita' then 'davita' when t ~* '(fresenius|rcg|qualicenters)' then 'fresenius'
              when t ~* '(u\.?s\.? renal|usrc)' then 'usrc' when t ~* 'vacant' then 'vacant'
              else lower(split_part(t, ' ', 1)) end $$;
create table properties (property_id integer primary key, address text, city text, state varchar,
  zip_code text, county text, parcel_number text, medicare_id text, year_built integer, year_renovated integer,
  lot_sf numeric, land_area numeric, building_size numeric, recorded_owner_id uuid, true_owner_id uuid,
  recorded_owner_name text, true_owner_name text, tenant text, operator text, merged_into_property_id integer);
create table sales_transactions (sale_id serial primary key, property_id integer, sale_date date, sold_price numeric);
create table available_listings (listing_id serial primary key, property_id integer, status varchar, is_active boolean,
  last_price numeric, cap_rate numeric, seller_name text, listing_broker text, listing_broker_id integer,
  broker_email text, price_per_sf numeric, listing_url text, on_market_date date, off_market_date date,
  off_market_reason text, exclude_from_listing_metrics boolean default false, notes text);
create table dia_property_twin_review (id bigserial primary key, shadow_property_id integer, anchor_property_id integer,
  classification text, distance_miles numeric, detail jsonb, status text default 'pending', batch_tag text,
  backup_id bigint, created_at timestamptz default now(), resolved_at timestamptz, resolution_note text);
create unique index uq_dia_twin_review_pair on dia_property_twin_review (shadow_property_id, anchor_property_id);
create table dia_property_merge_backup (backup_id bigserial primary key, kept_property_id integer, dropped_property_id integer, row_json jsonb,
  rewired jsonb, unmerged_at timestamptz);
create table dia_listing_sale_review (review_id bigserial primary key, listing_id integer, sale_id integer, verdict text,
  status text default 'open', resolved_at timestamptz, decided_by text, decision jsonb);
create table dia_listing_sale_close_log (log_id bigserial primary key, batch_tag text, listing_id integer, action text,
  prior jsonb, applied_at timestamptz default clock_timestamp(), restored_at timestamptz);
create table merge_calls (keep integer, drop_id integer);

create function dia_merge_property_reversible(p_keep integer, p_drop integer, p_tag text) returns bigint
language plpgsql as $$ declare b bigint; begin
  insert into merge_calls values (p_keep, p_drop);
  if exists (select 1 from available_listings where property_id = p_keep and is_active) then
    delete from available_listings where property_id = p_drop and is_active;
  end if;
  insert into dia_property_merge_backup (kept_property_id, dropped_property_id, row_json, rewired)
  select p_keep, p_drop, to_jsonb(p.*), '{}'::jsonb from properties p where property_id = p_drop returning backup_id into b;
  update available_listings set property_id = p_keep where property_id = p_drop;
  update sales_transactions set property_id = p_keep where property_id = p_drop;
  delete from properties where property_id = p_drop;
  return b; end $$;
create function dia_unmerge_property(p_backup bigint) returns jsonb language plpgsql as $$ declare r record; begin
  select * into r from dia_property_merge_backup where backup_id = p_backup;
  insert into properties select * from jsonb_populate_record(null::properties, r.row_json);
  update dia_property_merge_backup set unmerged_at = now() where backup_id = p_backup;
  return '{}'::jsonb; end $$;
create function dia_reconcile_listing_sales(integer[], boolean, text)
  returns table(listing_id integer, sale_id integer, verdict text, action text)
  language sql as $$ select null::integer, null::integer, null::text, null::text where false $$;
create function dia_restore_listing_sale_close(text, integer default null) returns integer language sql as $$ select 0 $$;
`;

function pgBin() {
  const base = '/usr/lib/postgresql';
  if (!existsSync(base)) return null;
  for (const v of readdirSync(base).sort((a, b) => Number(b) - Number(a))) {
    if (existsSync(join(base, v, 'bin', 'initdb'))) return join(base, v, 'bin');
  }
  return null;
}
const isRoot = typeof process.geteuid === 'function' && process.geteuid() === 0;
const asPg = (cmd) => (isRoot ? ['runuser', '-u', 'postgres', '--', ...cmd] : cmd);
const BIN = pgBin();
const SKIP = !BIN || (isRoot && spawnSync('which', ['runuser']).status !== 0) ? 'no PostgreSQL binaries available' : false;

let dir; let n = 0;
const run = (cmd) => { const [c, ...a] = asPg(cmd); return spawnSync(c, a, { encoding: 'utf8', timeout: 60000 }); };
function psql(sql, db = 'postgres', check = true) {
  const r = spawnSync(join(BIN, 'psql'), ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1',
    '-h', dir, '-p', PORT, '-U', 'postgres', '-d', db], { input: sql, encoding: 'utf8' });
  if (check && r.status !== 0) throw new Error(r.stderr);
  return r;
}
const q = (sql, db) => psql(sql, db).stdout.trim();
const text = (f) => readFileSync(f, 'utf8');
function mutate(src, pairs) {
  let t = src;
  for (const [o, nw] of pairs) { assert.ok(t.includes(o), `mutation anchor missing: ${o}`); t = t.split(o).join(nw); }
  return t;
}
function freshDb(mergeSql = text(MERGE), guardSql = text(GUARD)) {
  n += 1;
  const db = `dup1_${n}`;
  psql(`create database ${db};`);
  for (const s of [NORMALIZERS, SEED, mergeSql, guardSql]) psql(s, db);
  return db;
}
function prop(db, pid, addr, { city = 'Kissimmee', state = 'FL', year = 2002, lot = 31799, parcel = null, mcr = null, owner = null, op = null, tenant = null } = {}) {
  // Fixture rows are pre-existing data: the junk guard (tested separately) must not stop them.
  q(`alter table properties disable trigger trg_dia_property_junk_address_guard;
     insert into properties (property_id, address, city, state, year_built, lot_sf, parcel_number, medicare_id,
                             recorded_owner_name, operator, tenant)
     values (${pid}, $$${addr}$$, '${city}', '${state}', ${year ?? 'null'}, ${lot ?? 'null'},
             ${parcel ? `'${parcel}'` : 'null'}, ${mcr ? `'${mcr}'` : 'null'}, ${owner ? `'${owner}'` : 'null'},
             ${op ? `'${op}'` : 'null'}, ${tenant ? `'${tenant}'` : 'null'});
     alter table properties enable trigger trg_dia_property_junk_address_guard;`, db);
}
const listing = (db, pid, { price = null, cap = null, seller = null } = {}) => q(
  `insert into available_listings (property_id, status, is_active, last_price, cap_rate, seller_name)
   values (${pid}, 'active', true, ${price ?? 'null'}, ${cap ?? 'null'}, ${seller ? `'${seller}'` : 'null'}) returning listing_id;`, db);
const mergePair = (db, keep, drop, extra = '') =>
  JSON.parse(q(`select dia_dup1_merge_pair(${keep}, ${drop}, 't1', false${extra});`, db));

before(() => {
  if (SKIP) return;
  dir = mkdtempSync(join(tmpdir(), 'dup1_'));
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

// ── The signal rule ───────────────────────────────────────────────────────────
function kissimmee(db) {
  prop(db, 24669, '802 John Young Parkway', { mcr: '102569' });
  prop(db, 37696, 'For Sale | 802 N John Young Pky', { lot: 31755, parcel: '21-25-29-1908-0001-0010', owner: 'Zela Properties Solution, LLC' });
}

test('two signals (address + year/lot) merge; the drop row\'s facts fill the keep row\'s blanks', { skip: SKIP }, () => {
  const db = freshDb();
  kissimmee(db);
  const r = mergePair(db, 24669, 37696);
  assert.equal(r.outcome, 'merged', JSON.stringify(r));
  assert.deepEqual([r.signals.address, r.signals.physical, r.signals.n], [true, true, 2]);
  assert.equal(q('select count(*) from merge_calls;', db), '1');
  assert.equal(q('select parcel_number || \'|\' || recorded_owner_name from properties where property_id = 24669;', db),
    '21-25-29-1908-0001-0010|Zela Properties Solution, LLC');
});

test('one signal files a card and writes nothing', { skip: SKIP }, () => {
  const db = freshDb();
  // Birmingham shape: identical year/lot, street a typo, parcels differ by a leading digit.
  prop(db, 51242, '1929 32nd Ave N', { city: 'Birmingham', state: 'AL', year: 1999, lot: 23967, parcel: '22-00-14-3-027-001.000' });
  prop(db, 35815, '1929 324 Ave N', { city: 'Birmingham', state: 'AL', year: 1999, lot: 23967, parcel: '12200143027001000' });
  const r = mergePair(db, 51242, 35815);
  assert.equal(r.outcome, 'card');
  assert.equal(r.signals.n, 1);
  assert.equal(q('select count(*) from merge_calls;', db), '0');
  assert.equal(q('select count(*) from properties;', db), '2');
  assert.equal(q(`select classification from dia_property_twin_review where shadow_property_id = 35815;`, db), 'review_dup_records1');
  // One signal and nothing contradicting it is still a card: the gate, not a veto, stops it.
  prop(db, 52000, 'DaVita Birmingham', { city: 'Birmingham', state: 'AL', year: 1999, lot: 23967 });
  const r2 = mergePair(db, 51242, 52000);
  assert.equal(r2.outcome, 'card');
  assert.equal(r2.signals.address_conflict, false);
});

test('a human confirmation is the second signal', { skip: SKIP }, () => {
  const db = freshDb();
  prop(db, 27901, '1431 Business Center Ct', { city: 'Dayton', state: 'OH', year: 1993, lot: 82764 });
  prop(db, 38412, '1403-1431 Business Center Ct', { city: 'Dayton', state: 'OH', year: 1993, lot: null });
  assert.equal(mergePair(db, 27901, 38412).outcome, 'card');
  assert.equal(mergePair(db, 27901, 38412, ', null, true').outcome, 'merged');
});

test('a unit letter on one civic number only is the same address; two different letters are not', { skip: SKIP }, () => {
  const db = freshDb();
  const sig = (a, b) => JSON.parse(q(`select dia_dup1_signals('IL','Oak Forest',$$${a}$$,null,null,2013,78408,
    'IL','Oak Forest',$$${b}$$,null,null,2013,78914);`, db));
  assert.equal(sig('5340A W 159th St', '5340 159th St').address, true);
  assert.equal(sig('5340A W 159th St', '5340B W 159th St').address, false);
});

test('year built must agree for the physical signal, and a lot more than 1% apart is not the same lot', { skip: SKIP }, () => {
  const db = freshDb();
  const phys = (y1, l1, y2, l2) => JSON.parse(q(`select dia_dup1_signals('FL','X','1 A St',null,null,${y1},${l1},
    'FL','X','9 B St',null,null,${y2},${l2});`, db)).physical;
  assert.equal(phys(2002, 31799, 2002, 31755), true);
  assert.equal(phys(2002, 31799, 2003, 31799), false);
  assert.equal(phys(2002, 31799, 2002, 33000), false);
});

test('two different CCNs veto the merge: co-located clinics are not twins', { skip: SKIP }, () => {
  const db = freshDb();
  prop(db, 100, '10 Main St', { city: 'X', state: 'TX', mcr: '450001' });
  prop(db, 101, '10 Main St', { city: 'X', state: 'TX', mcr: '450002' });
  const r = mergePair(db, 100, 101);
  assert.equal(r.outcome, 'card');
  assert.equal(r.signals.ccn_conflict, true);
});

test('mutation: without the CCN veto, two clinics at one address merge', { skip: SKIP }, () => {
  const db = freshDb(mutate(text(MERGE), [["OR coalesce((v_sig->>'ccn_conflict')::boolean, false)", '']]));
  prop(db, 100, '10 Main St', { city: 'X', state: 'TX', mcr: '450001' });
  prop(db, 101, '10 Main St', { city: 'X', state: 'TX', mcr: '450002' });
  assert.equal(mergePair(db, 100, 101).outcome, 'merged');
});

test('operator conflict (tenant standing in for a blank operator) vetoes; legacy brands do not', { skip: SKIP }, () => {
  const db = freshDb();
  prop(db, 200, '1401 East Broadway St', { city: 'Altus', state: 'OK', year: 2000, lot: 40000, op: 'DaVita' });
  prop(db, 201, '1401 E Broadway St', { city: 'Altus', state: 'OK', year: 2000, lot: 40000, tenant: 'U.S. Renal Care' });
  assert.equal(mergePair(db, 200, 201).outcome, 'card');
  prop(db, 300, '1325 Highway 4 East', { city: 'Holly Springs', state: 'MS', year: 2000, lot: 40000, op: 'Fresenius' });
  prop(db, 301, '1325 Hwy 4 East', { city: 'Holly Springs', state: 'MS', year: 2000, lot: 40000, tenant: 'Rcg Holly Springs' });
  assert.equal(mergePair(db, 300, 301).outcome, 'merged');
});

test('a parcel match naming two different streets, or two opposite directionals, is a card', { skip: SKIP }, () => {
  const db = freshDb();
  prop(db, 400, '5820 Rd 68', { city: 'Pasco', state: 'WA', year: 2010, lot: 50000, parcel: '118-123-456' });
  prop(db, 401, '5820 Rd 76 Rd', { city: 'Pasco', state: 'WA', year: 2010, lot: 50000, parcel: '118-123-456' });
  const r = mergePair(db, 400, 401);
  assert.equal(r.outcome, 'card');
  assert.equal(r.signals.address_conflict, true);
  prop(db, 500, '178 E 162nd St', { city: 'South Holland', state: 'IL', year: 2010, lot: 50000, parcel: '29-22-100-001' });
  prop(db, 501, '178 W 162nd St', { city: 'South Holland', state: 'IL', year: 2010, lot: 50000, parcel: '29-22-100-001' });
  assert.equal(mergePair(db, 500, 501).outcome, 'card');
  prop(db, 600, '1208 Scottsville Rd Rochester', { city: 'Rochester', state: 'NY', year: 1990, lot: 20000 });
  prop(db, 601, '1208 Scottsville Rd', { city: 'Rochester', state: 'NY', year: 1990, lot: 20000 });
  assert.equal(mergePair(db, 601, 600).outcome, 'merged', 'a trailing city name is not a different street');
  // A city spelled two ways is not a street conflict: parcel + physical still merge.
  prop(db, 700, '1325 Highway 4 East', { city: 'Holly Springs (Mount Pleasant)', state: 'MS', year: 2000, lot: 40000, parcel: '1234-5678' });
  prop(db, 701, '1325 Hwy 4 East', { city: 'Holly Springs', state: 'MS', year: 2000, lot: 40000, parcel: '1234-5678' });
  const hs = mergePair(db, 700, 701);
  assert.equal(hs.signals.address_conflict, false);
  assert.equal(hs.outcome, 'merged');
});

test('mutation: without the address-conflict veto, the Pasco parcel pair merges', { skip: SKIP }, () => {
  const db = freshDb(mutate(text(MERGE), [["OR coalesce((v_sig->>'address_conflict')::boolean, false)", '']]));
  prop(db, 400, '5820 Rd 68', { city: 'Pasco', state: 'WA', year: 2010, lot: 50000, parcel: '118-123-456' });
  prop(db, 401, '5820 Rd 76 Rd', { city: 'Pasco', state: 'WA', year: 2010, lot: 50000, parcel: '118-123-456' });
  assert.equal(mergePair(db, 400, 401).outcome, 'merged');
});

test('mutation: without the directional check, E and W 162nd read as one address', { skip: SKIP }, () => {
  const db = freshDb(mutate(text(MERGE), [['AND NOT (da IS NOT NULL AND db IS NOT NULL AND da <> db)', '']]));
  const s = JSON.parse(q(`select dia_dup1_signals('IL','South Holland','178 E 162nd St',null,null,2010,50000,
    'IL','South Holland','178 W 162nd St',null,null,2010,50000);`, db));
  assert.equal(s.address, true);
});

// ── Listings on both rows ─────────────────────────────────────────────────────
test('a duplicate active listing is superseded and kept, never deleted; its blanks fill the keep listing', { skip: SKIP }, () => {
  const db = freshDb();
  kissimmee(db);
  const keepL = listing(db, 24669, { price: 4400000 });
  const dropL = listing(db, 37696, { price: 4400000, cap: 0.0626, seller: 'Zela' });
  mergePair(db, 24669, 37696);
  assert.equal(q(`select status || '|' || is_active from available_listings where listing_id = ${dropL};`, db), 'superseded|false');
  assert.equal(q(`select cap_rate || '|' || seller_name from available_listings where listing_id = ${keepL};`, db), '0.0626|Zela');
});

// ── Undo ──────────────────────────────────────────────────────────────────────
test('dia_dup1_restore puts every write back', { skip: SKIP }, () => {
  const db = freshDb();
  kissimmee(db);
  const keepL = listing(db, 24669, { price: 4400000 });
  const dropL = listing(db, 37696, { price: 4400000, cap: 0.0626 });
  mergePair(db, 24669, 37696);
  q(`select dia_dup1_restore('t1');`, db);
  assert.equal(q('select count(*) from properties;', db), '2');
  assert.equal(q('select coalesce(parcel_number, \'-\') from properties where property_id = 24669;', db), '-');
  assert.equal(q(`select status || '|' || is_active from available_listings where listing_id = ${dropL};`, db), 'active|true');
  assert.equal(q(`select coalesce(cap_rate::text, '-') from available_listings where listing_id = ${keepL};`, db), '-');
});

// ── Junk address guard ────────────────────────────────────────────────────────
test('the property writer refuses a junk address and leaves an existing junk row writable', { skip: SKIP }, () => {
  const db = freshDb();
  const ins = psql(`insert into properties (property_id, address) values (1, 'For Sale | 802 N John Young Pky');`, db, false);
  assert.notEqual(ins.status, 0);
  assert.match(ins.stderr, /junk_address_refused/);
  q(`insert into properties (property_id, address) values (2, '802 John Young Parkway');`, db);
  const upd = psql(`update properties set address = 'Sale Comps | 1550 Sheridan' where property_id = 2;`, db, false);
  assert.notEqual(upd.status, 0);
  // A pre-existing junk row (written before the trigger) keeps accepting writes to OTHER columns.
  q(`alter table properties disable trigger trg_dia_property_junk_address_guard;
     insert into properties (property_id, address) values (3, 'For Sale | 1164 Route 130 North');
     alter table properties enable trigger trg_dia_property_junk_address_guard;`, db);
  q(`update properties set tenant = 'x' where property_id = 3;`, db);
});

// ── Mutations: each rule, removed, must turn its case red ────────────────────
test('mutation: a one-signal gate merges the Birmingham card', { skip: SKIP }, () => {
  const db = freshDb(mutate(text(MERGE), [["(v_sig->>'n')::int < 2", "(v_sig->>'n')::int < 1"]]));
  // One signal (physical) and nothing contradicting it: one side has no street line at all.
  prop(db, 51242, '1929 32nd Ave N', { city: 'Birmingham', state: 'AL', year: 1999, lot: 23967 });
  prop(db, 35815, 'DaVita Birmingham', { city: 'Birmingham', state: 'AL', year: 1999, lot: 23967 });
  assert.equal(mergePair(db, 51242, 35815).outcome, 'merged', 'the gate is what stops this merge');
});

test('mutation: without the year check, a different building on the same lot size reads physical', { skip: SKIP }, () => {
  const db = freshDb(mutate(text(MERGE), [['a_year IS NOT NULL AND a_year = b_year', 'true']]));
  const s = JSON.parse(q(`select dia_dup1_signals('FL','X','1 A St',null,null,2002,31799,'FL','X','9 B St',null,null,2003,31799);`, db));
  assert.equal(s.physical, true);
});

test('mutation: without the unit-letter strip, Oak Forest has only one signal', { skip: SKIP }, () => {
  const db = freshDb(mutate(text(MERGE), [["'^(\\d+)[a-z]\\y', '\\1'", "'^$', ''"]]));
  const s = JSON.parse(q(`select dia_dup1_signals('IL','Oak Forest','5340A W 159th St',null,null,2013,78408,
    'IL','Oak Forest','5340 159th St',null,null,2013,78914);`, db));
  assert.equal(s.address, false);
});

test('mutation: without the supersede step, the merge deletes the duplicate listing', { skip: SKIP }, () => {
  const db = freshDb(mutate(text(MERGE), [['IF v_keep_listing IS NOT NULL THEN', 'IF false THEN']]));
  kissimmee(db);
  listing(db, 24669, { price: 4400000 });
  const dropL = listing(db, 37696, { price: 4400000 });
  mergePair(db, 24669, 37696);
  assert.equal(q(`select count(*) from available_listings where listing_id = ${dropL};`, db), '0');
});

test('mutation: a guard that fires on every UPDATE blocks writes to an existing junk row', { skip: SKIP }, () => {
  const db = freshDb(undefined, mutate(text(GUARD), [
    ["IF TG_OP = 'UPDATE' AND NEW.address IS NOT DISTINCT FROM OLD.address THEN", 'IF false THEN'],
    ['BEFORE INSERT OR UPDATE OF address ON', 'BEFORE INSERT OR UPDATE ON']]));
  q(`alter table properties disable trigger trg_dia_property_junk_address_guard;
     insert into properties (property_id, address) values (3, 'For Sale | 1164 Route 130 North');
     alter table properties enable trigger trg_dia_property_junk_address_guard;`, db);
  assert.notEqual(psql(`update properties set tenant = 'x' where property_id = 3;`, db, false).status, 0);
});

test('mutation: without the unmerge exemption, undoing a merge of a junk-address row fails', { skip: SKIP }, () => {
  const db = freshDb(undefined, mutate(text(GUARD), [['IF TG_OP = \'INSERT\' AND EXISTS', 'IF false AND EXISTS']]));
  kissimmee(db);
  mergePair(db, 24669, 37696);
  assert.notEqual(psql(`select dia_dup1_restore('t1');`, db, false).status, 0);
});

// ── JS: one capture resolves one property ────────────────────────────────────
test('the capture matcher treats the dup shapes as one building', () => {
  assert.equal(addressesIdentityEquivalent('802 N John Young Pky', '802 John Young Parkway', 'FL'), true);
  assert.equal(addressesIdentityEquivalent('For Sale | 802 N John Young Pky', '802 John Young Parkway', 'FL'), true);
  assert.equal(addressesIdentityEquivalent('5340 159th St', '5340A W 159th St', 'IL'), true);
  assert.equal(addressesIdentityEquivalent('5340A W 159th St', '5340B W 159th St', 'IL'), false);
  assert.equal(addressesIdentityEquivalent('1929 32nd Ave N', '1929 324 Ave N', 'AL'), false);
  assert.equal(addressesIdentityEquivalent('802 John Young Pky', '804 John Young Pky', 'FL'), false);
  assert.deepEqual(splitCivicUnitLetter('5340A W 159th St'), { address: '5340 W 159th St', letter: 'A' });
});

// ── The sidebar-sale feed ────────────────────────────────────────────────────
const RPC_ROW = {
  entity_id: '671e79cc-0fa4-42ee-81b2-28e16d9fac32', row_key: '2:e641b5a70adf02de18ed1875886e8cea', property_id: 23313,
  sale_date: '2024-11-27', sale_price: null, buyer: 'B', seller: 'S', sale_type: 'Arms Length / Resale',
  deed_type: 'Special Warranty Deed', document_number: '2024.451527', recordation_date: '2024-12-04',
  comp_status: null, price_status: null, raw: { source: 'lcc_entities.metadata.sales_history' },
};

test('buildStagingRows drops rows it cannot stage honestly and collapses duplicate keys', () => {
  const rows = buildStagingRows([RPC_ROW, { ...RPC_ROW }, { ...RPC_ROW, row_key: '3:x', sale_date: null },
    { ...RPC_ROW, row_key: '4:y', property_id: 'abc' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].property_id, 23313);
});

test('the feed is idempotent: a second run stages nothing', async () => {
  const staged = new Map();
  const deps = {
    opsQuery: async (m, path, body) => ({ ok: true, data: body.p_domain === 'dia' ? [RPC_ROW] : [] }),
    domainQuery: async (db, m, path, body, headers) => {
      if (m === 'GET') return { ok: true, data: [], count: staged.size };
      assert.match(path, /on_conflict=entity_id,row_key/);
      assert.match(headers.Prefer, /resolution=ignore-duplicates/);
      for (const r of body) { const k = `${r.entity_id}|${r.row_key}`; if (!staged.has(k)) staged.set(k, r); }
      return { ok: true, data: null };
    },
  };
  const first = await runSidebarSaleFeed({ apply: true, deps });
  const second = await runSidebarSaleFeed({ apply: true, deps });
  assert.equal(first.domains.dia.staged, 1);
  assert.equal(second.domains.dia.staged, 0);
  assert.equal(second.domains.dia.sent, 1, 'sent counts what was POSTed; staged is the truth');
  const dry = await runSidebarSaleFeed({ apply: false, deps });
  assert.equal(dry.domains.dia.sent, 0);
});
