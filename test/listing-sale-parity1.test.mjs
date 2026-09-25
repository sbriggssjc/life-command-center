// LISTING-SALE-PARITY1 (2026-09-24) — a dia listing closes when its property sells, in both
// directions, through the SAME judgement gov uses.
//
// Behavioural. supabase/migrations/dialysis/20261014120000_dia_listing_sale_parity1.sql is applied,
// byte for byte, to a throwaway Postgres cluster seeded with the live dia shape it touches (the
// status vocabulary + normalizer, is_active, the one-active-per-property unique index, the pre-fix
// triggers). Then:
//   * lcc_listing_sale_verdict answers every case in test/fixtures/listing_sale_verdict_cases.json
//     (the SAME fixture the gov copy runs in government-lease tests/unit/test_listing_sale_parity1.py),
//     and its text matches the md5 pinned in both repos, so dia and gov cannot drift silently;
//   * a market sale closes every open listing and links it; a re-listing > 90 days later survives;
//   * the reverse check closes a listing captured after its sale and queues an ambiguous one;
//   * a HISTORICAL sale inserted today no longer closes a current re-listing (the old dia bug);
//   * a twin's sale is review-only; a restored close is not re-closed; the guard alerts/resolves;
//   * the hygiene sweep's crude closer is replaced by the writer.
// Each rule has a mutation that must turn a case red. Skips when no PostgreSQL binaries exist.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, chmodSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(ROOT, 'supabase', 'migrations', 'dialysis', '20261014120000_dia_listing_sale_parity1.sql');
const CASES = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'listing_sale_verdict_cases.json'), 'utf8'));
const BEGIN = '-- ===== BEGIN lcc_listing_sale_verdict';
const END = '-- ===== END lcc_listing_sale_verdict =====';
// Pinned in both repos (government-lease tests/unit/test_listing_sale_parity1.py). Change the
// function on BOTH DBs and both pins together, or not at all.
const VERDICT_MD5 = '3fef339879c35244f2d085551f525261';
const PORT = '55453';

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

const SEED = String.raw`
create table properties (property_id integer primary key, address text, city text, state varchar);
create table sales_transactions (
  sale_id serial primary key, property_id integer, sale_date date, sold_price numeric,
  transaction_state text default 'live', exclude_from_market_metrics boolean default false);
create table property_sale_events (sale_event_id serial primary key, property_id integer, sale_date date,
  price numeric, sales_transaction_id integer);
create table available_listings (
  listing_id serial primary key, property_id integer, status varchar, is_active boolean,
  listing_date date, listing_date_source text, on_market_date date, on_market_date_confidence text,
  last_seen date, created_at timestamptz, last_price numeric, initial_price numeric,
  off_market_date date, off_market_reason text, sold_date date, sold_price numeric,
  sale_transaction_id integer, notes text, last_verified_at timestamptz, verification_due_at timestamptz,
  verification_priority text default 'normal', exclude_from_listing_metrics boolean default false,
  constraint chk_dia_listing_status_vocab check (status is null or status::text = any
    (array['active','sold','superseded','under_contract','withdrawn','off_market','orphan'])));
create unique index available_listings_one_active_per_property on available_listings (property_id)
  where is_active is true and property_id is not null;
create table listing_change_events (id serial primary key, listing_id integer, property_id integer,
  event_type text, priority text, description text, old_value text, new_value text,
  event_date timestamptz, created_at timestamptz);
create table lcc_health_alerts (alert_id bigserial primary key, detected_at timestamptz default now(),
  alert_kind text, source text, severity text, summary text, details jsonb, resolved_at timestamptz, resolved_note text);
create function dia_normalize_address(addr text) returns text language sql immutable as
  $$ select btrim(regexp_replace(lower(coalesce(addr,'')), '[^a-z0-9]+', ' ', 'g')) $$;
create function dia_normalize_state(s text) returns text language sql immutable as $$ select upper(btrim(s)) $$;
create function dia_norm_listing_status(s text) returns text language sql immutable as $$
  select case lower(btrim(coalesce(s,''))) when '' then null when 'sold' then 'sold' when 'superseded' then 'superseded'
    when 'active' then 'active' when 'available' then 'active' when 'withdrawn' then 'withdrawn'
    when 'under contract' then 'under_contract' when 'under_contract' then 'under_contract'
    when 'orphan' then 'orphan' else 'off_market' end $$;
create function zzz_normalize_listing_status() returns trigger language plpgsql as $$
begin if new.status is not null then new.status := dia_norm_listing_status(new.status); end if; return new; end $$;
create trigger zzz_normalize_listing_status before insert or update on available_listings
  for each row execute function zzz_normalize_listing_status();
-- the pre-fix dia triggers, in shape
create function close_listing_on_sale() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trg_close_listing_on_sale after insert or update of sale_date, property_id on sales_transactions
  for each row execute function close_listing_on_sale();
create function fn_sale_event_mark_listings_sold() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trg_sale_event_mark_listings_sold after insert on property_sale_events
  for each row execute function fn_sale_event_mark_listings_sold();
create function fn_listing_close_if_sold() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trg_listing_close_if_sold before insert or update of listing_date, is_active, status, property_id
  on available_listings for each row execute function fn_listing_close_if_sold();
-- the hygiene sweep's closer, as live
create function lcc_data_hygiene_sweep() returns jsonb language plpgsql as $$
declare n_close_listings int := 0; begin
  UPDATE public.available_listings al
     SET status = 'Sold', is_active = FALSE,
         off_market_date = COALESCE(al.off_market_date, s.sale_date)
   FROM public.sales_transactions s
   WHERE s.property_id = al.property_id
     AND al.status NOT IN ('Sold','Withdrawn','Expired') AND al.is_active = TRUE
     AND s.sale_date >= COALESCE(al.listing_date, '1970-01-01'::date);
  GET DIAGNOSTICS n_close_listings = ROW_COUNT;
  return jsonb_build_object('close_listings', n_close_listings); end $$;
`;

function freshDb(sql) {
  n += 1;
  const db = `lsp1dia_${n}`;
  psql(`create database ${db};`);
  psql(SEED, db);
  psql(sql, db);
  return db;
}
const migration = () => readFileSync(MIGRATION, 'utf8');
function mutate(pairs) {
  let t = migration();
  for (const [o, nw] of pairs) { assert.ok(t.includes(o), o); t = t.replace(o, nw); }
  return t;
}
const lit = (v) => (v === null || v === undefined ? 'null' : `'${v}'`);
function prop(db, pid, addr = '100 Main St') { q(`insert into properties values (${pid}, '${addr}', 'Austin', 'TX');`, db); }
function listing(db, pid, { seen = '2026-05-01', omd = null, conf = null, ask = null, lds = 'capture_date_fallback',
  ld = null, status = 'active', active = true } = {}) {
  return q(`insert into available_listings (property_id, status, is_active, listing_date, listing_date_source,
    on_market_date, on_market_date_confidence, last_seen, last_price) values (${pid}, '${status}', ${active},
    ${lit(ld ?? seen)}, ${lit(lds)}, ${lit(omd)}, ${lit(conf)}, ${lit(seen)}, ${lit(ask)}) returning listing_id;`, db);
}
function sale(db, pid, d, price, state = 'live', ex = false) {
  return q(`insert into sales_transactions (property_id, sale_date, sold_price, transaction_state, exclude_from_market_metrics)
    values (${pid}, '${d}', ${price}, '${state}', ${ex}) returning sale_id;`, db);
}
const row = (db, lid) => q(`select status, is_active, coalesce(sale_transaction_id::text,'') from available_listings where listing_id = ${lid};`, db).split('|');

before(() => {
  if (SKIP) return;
  dir = mkdtempSync(join(tmpdir(), 'lsp1dia_'));
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

test('the verdict block matches the md5 pinned in both repos', () => {
  const t = migration();
  const block = t.slice(t.indexOf(BEGIN), t.indexOf(END) + END.length);
  assert.equal(createHash('md5').update(block).digest('hex'), VERDICT_MD5);
});

test('the shared verdict answers every fixture case', { skip: SKIP }, () => {
  const db = freshDb(migration());
  for (const c of CASES) {
    const got = q(`select lcc_listing_sale_verdict(${lit(c.omd)}::date, ${lit(c.conf)}::text, ${lit(c.cap)}::date,
      ${lit(c.ask)}::numeric, ${lit(c.sale)}::date, ${lit(c.sold)}::numeric, ${c.market});`, db);
    assert.equal(got, c.want, c.name);
  }
});

// ── scenarios (each returns true when the rule holds) ─────────────────────────
const S = {
  saleClosesAndLinks(db) {
    prop(db, 1);
    const lid = listing(db, 1, { seen: '2026-05-01' });
    const sid = sale(db, 1, '2026-07-15', 2000000);
    return JSON.stringify(row(db, lid)) === JSON.stringify(['sold', 'f', sid]);
  },
  relistingSurvives(db) {
    prop(db, 2);
    const lid = listing(db, 2, { seen: '2026-06-10', omd: '2025-04-12', conf: 'medium', ask: 6300000 });
    sale(db, 2, '2023-05-01', 6300000);
    return row(db, lid)[0] === 'active';
  },
  historicalSaleDoesNotCloseRelisting(db) {
    // the old dia forward trigger closed this: on_market NULL, and a 2019 backfilled sale lands today
    prop(db, 3);
    const lid = listing(db, 3, { seen: '2026-06-10', ask: 4000000 });
    sale(db, 3, '2019-03-08', 2500000);
    return row(db, lid)[0] === 'active';
  },
  reverseClosesPostSaleCapture(db) {
    prop(db, 4);
    const sid = sale(db, 4, '2026-06-09', 1800000);
    const lid = listing(db, 4, { seen: '2026-09-24', ask: 1650000 });
    return JSON.stringify(row(db, lid)) === JSON.stringify(['sold', 'f', sid]);
  },
  reverseFlagsAmbiguous(db) {
    prop(db, 5);
    const sid = sale(db, 5, '2026-02-10', 107500);
    const lid = listing(db, 5, { seen: '2026-05-06' });
    const queued = q(`select count(*) from dia_listing_sale_review where listing_id = ${lid} and sale_id = ${sid};`, db);
    return row(db, lid)[0] === 'active' && queued === '1';
  },
  twinIsReviewOnly(db) {
    prop(db, 7, '200 Oak Ave'); prop(db, 8, '200 Oak Ave');
    const lid = listing(db, 7, { seen: '2026-05-01' });
    sale(db, 8, '2026-07-15', 2000000);
    const v = q(`select verdict from dia_listing_sale_review where listing_id = ${lid};`, db);
    return row(db, lid)[0] === 'active' && v.startsWith('review_twin_');
  },
  restoreNotReclosed(db) {
    prop(db, 9);
    const lid = listing(db, 9, { seen: '2026-05-01' });
    sale(db, 9, '2026-07-15', 2000000);
    q("select dia_restore_listing_sale_close('sale_trigger');", db);
    q(`update available_listings set last_seen = current_date where listing_id = ${lid};`, db);
    q("select count(*) from dia_reconcile_listing_sales(null, false, 'again');", db);
    return row(db, lid)[0] === 'active';
  },
  nonMarketIgnored(db) {
    prop(db, 10);
    const lid = listing(db, 10, { seen: '2026-05-01' });
    sale(db, 10, '2026-07-15', 2000000, 'ownership_stub', true);
    q(`update available_listings set last_seen = current_date where listing_id = ${lid};`, db);
    return row(db, lid)[0] === 'active';
  },
  guardAlertsAndResolves(db) {
    prop(db, 11);
    psql('set session_replication_role = replica;', db);
    const lid = q(`set session_replication_role = replica; insert into sales_transactions (property_id, sale_date, sold_price) values (11, '2026-07-15', 2000000);
      insert into available_listings (property_id, status, is_active, listing_date, listing_date_source, last_seen)
      values (11, 'active', true, '2026-05-01', 'capture_date_fallback', '2026-05-01') returning listing_id;`, db).split('\n').pop();
    q('select dia_check_listing_sale_parity();', db);
    const fired = q("select count(*) from lcc_health_alerts where alert_kind = 'listing_sold_still_active' and resolved_at is null;", db);
    q("select count(*) from dia_reconcile_listing_sales(null, false, 'fix');", db);
    q('select dia_check_listing_sale_parity();', db);
    const left = q("select count(*) from lcc_health_alerts where alert_kind = 'listing_sold_still_active' and resolved_at is null;", db);
    return fired === '1' && left === '0' && row(db, lid)[0] === 'sold';
  },
  sweepUsesWriter(db) {
    prop(db, 12);
    const lid = listing(db, 12, { seen: '2026-06-10', ask: 4000000 });
    // a non-market sale after listing_date: the old sweep closed this listing
    q("set session_replication_role = replica; insert into sales_transactions (property_id, sale_date, sold_price, transaction_state, exclude_from_market_metrics) values (12, '2026-08-01', 100000, 'ownership_stub', true);", db);
    q('select lcc_data_hygiene_sweep();', db);
    return row(db, lid)[0] === 'active';
  },
};

for (const [name, fn] of Object.entries(S)) {
  test(`behaviour: ${name}`, { skip: SKIP }, () => { assert.ok(fn(freshDb(migration()))); });
}

const MUTATIONS = [
  ['saleClosesAndLinks', [["sale_transaction_id = coalesce(al.sale_transaction_id, CASE WHEN NOT r.via_twin THEN r.sale_id END),",
    'sale_transaction_id = al.sale_transaction_id,']]],
  ['relistingSurvives', [['v_entry > p_sale_date + 90', 'v_entry > p_sale_date + 99999']]],
  ['historicalSaleDoesNotCloseRelisting', [["  IF p_sale_date >= p_capture_date - 730 THEN\n    RETURN 'review_sold_before_capture';\n  END IF;\n  IF v_r IS NOT NULL AND abs(v_r - 1) <= 0.005 AND p_sale_date >= p_capture_date - 1461 THEN\n    RETURN 'review_same_price';\n  END IF;\n  RETURN 'keep_prior_sale';",
    "  RETURN 'close_sold_after_seen';"]]],
  ['reverseClosesPostSaleCapture', [['  BEFORE INSERT OR UPDATE OF listing_date, is_active, status, property_id, last_verified_at,',
    '  BEFORE UPDATE OF notes, is_active, status, property_id, last_verified_at,']]],
  ['reverseFlagsAmbiguous', [["  IF p_sale_date >= p_capture_date - 730 THEN\n    RETURN 'review_sold_before_capture';", "  IF false THEN\n    RETURN 'review_sold_before_capture';"]]],
  ['twinIsReviewOnly', [["WHEN c.via_twin AND c.base LIKE 'close_%' THEN 'review_twin_' || c.base", "WHEN c.via_twin AND c.base LIKE 'close_%' THEN c.base"]]],
  ['restoreNotReclosed', [['                          AND l.restored_at IS NOT NULL)', '                          AND false)']]],
  ['nonMarketIgnored', [['  IF p_sale_date IS NULL OR NOT coalesce(p_sale_is_market, false) THEN', '  IF p_sale_date IS NULL THEN']]],
  ['sweepUsesWriter', [["  IF position('dia_reconcile_listing_sales(NULL, false, ''hygiene_sweep'')' IN d) > 0 THEN", '  IF true THEN']]],
];

for (const [name, pairs] of MUTATIONS) {
  test(`mutation turns red: ${name}`, { skip: SKIP }, () => {
    let ok;
    try { ok = S[name](freshDb(mutate(pairs))); } catch { return; } // broke outright: red
    assert.equal(ok, false);
  });
}
