// REVIEW-LANES1 (2026-09-25) — the dia listing↔sale review queue gets a writer a human verdict
// goes through, an undo, and a safe auto-resolver.
//
// Behavioural. The LISTING-SALE-PARITY1 migration and then
// supabase/migrations/dialysis/20261015120000_dia_review_lanes1_listing_sale_decide.sql are applied,
// byte for byte, to a throwaway Postgres cluster seeded with the live dia shape (the same seed
// test/listing-sale-parity1.test.mjs uses). Each rule has a mutation that must turn it red.
// Skips when no PostgreSQL binaries exist.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, chmodSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PARITY = join(ROOT, 'supabase', 'migrations', 'dialysis', '20261014120000_dia_listing_sale_parity1.sql');
const MIGRATION = join(ROOT, 'supabase', 'migrations', 'dialysis', '20261015120000_dia_review_lanes1_listing_sale_decide.sql');
const PORT = '55461';

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

// The live dia shape the parity migration touches — copied from test/listing-sale-parity1.test.mjs.
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

const migration = () => readFileSync(MIGRATION, 'utf8');
function mutate(pairs) {
  let t = migration();
  for (const [o, nw] of pairs) { assert.ok(t.includes(o), o); t = t.replace(o, nw); }
  return t;
}
function freshDb(sql) {
  n += 1;
  const db = `rl1dia_${n}`;
  psql(`create database ${db};`);
  psql(SEED, db);
  psql(readFileSync(PARITY, 'utf8'), db);
  psql(sql, db);
  return db;
}
const lit = (v) => (v === null || v === undefined ? 'null' : `'${v}'`);
function prop(db, pid) { q(`insert into properties values (${pid}, '${pid} Main St', 'Austin', 'TX');`, db); }
function listing(db, pid, { seen = '2026-05-01', ask = null, active = true, status = 'active' } = {}) {
  return q(`insert into available_listings (property_id, status, is_active, listing_date, listing_date_source,
    last_seen, last_price) values (${pid}, '${status}', ${active}, '${seen}', 'capture_date_fallback', '${seen}',
    ${lit(ask)}) returning listing_id;`, db);
}
function sale(db, pid, d, price, state = 'live', ex = false) {
  // property_sale_events / sales triggers from the parity migration may act; the review rows are
  // inserted directly below so each scenario controls exactly what is open.
  return q(`insert into sales_transactions (property_id, sale_date, sold_price, transaction_state, exclude_from_market_metrics)
    values (${pid}, '${d}', ${price}, '${state}', ${ex}) returning sale_id;`, db);
}
// A sale that lands without the parity triggers acting on it (as if it arrived while the
// reconcile was paused), so the review stays open for the auto-resolver to judge.
function quietSale(db, pid, d, price) {
  return q(`set lcc.listing_sale_reconcile_off = 'on';
    insert into sales_transactions (property_id, sale_date, sold_price) values (${pid}, '${d}', ${price}) returning sale_id;`, db);
}
function review(db, lid, sid, verdict = 'review_sold_before_capture') {
  return q(`insert into dia_listing_sale_review (listing_id, sale_id, verdict) values (${lid}, ${sid}, '${verdict}')
    on conflict (listing_id, sale_id) do update set status = 'open' returning review_id;`, db);
}
// An ambiguous pair: sold 16 months before we first saw the listing, no asking price.
function ambiguous(db, pid) {
  prop(db, pid);
  const sid = sale(db, pid, '2025-01-10', 5000000);
  const lid = listing(db, pid, { seen: '2026-05-01' });
  return { lid, sid, rid: review(db, lid, sid) };
}
const L = (db, lid) => q(`select status, is_active, coalesce(sale_transaction_id::text,'') from available_listings where listing_id = ${lid};`, db).split('|');
const R = (db, rid) => q(`select status from dia_listing_sale_review where review_id = ${rid};`, db);
const J = (db, sql) => JSON.parse(q(sql, db));

before(() => {
  if (SKIP) return;
  dir = mkdtempSync(join(tmpdir(), 'rl1dia_'));
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

const S = {
  confirmClosesThroughTheWriter(db) {
    const { lid, sid, rid } = ambiguous(db, 1);
    const out = J(db, `select dia_decide_listing_sale_review(${rid}, 'confirm_sold', 'scott')`);
    const logged = q(`select count(*) from dia_listing_sale_close_log where batch_tag = 'lsr_review_${rid}' and listing_id = ${lid};`, db);
    return out.ok && JSON.stringify(L(db, lid)) === JSON.stringify(['sold', 'f', sid])
      && R(db, rid) === 'confirmed_sold' && logged === '1';
  },
  rejectSkipsThePairForGood(db) {
    const { lid, rid } = ambiguous(db, 2);
    J(db, `select dia_decide_listing_sale_review(${rid}, 'reject', 'scott')`);
    q(`select count(*) from dia_reconcile_listing_sales(array[2], false, 'after_reject');`, db);
    const reproposed = q(`select count(*) from dia_listing_sale_review where listing_id = ${lid} and status = 'open';`, db);
    return R(db, rid) === 'rejected' && L(db, lid)[0] === 'active' && reproposed === '0';
  },
  undoConfirmRestoresTheListing(db) {
    const { lid, rid } = ambiguous(db, 3);
    J(db, `select dia_decide_listing_sale_review(${rid}, 'confirm_sold', 'scott')`);
    const u = J(db, `select dia_undo_listing_sale_review(${rid}, 'scott')`);
    return u.ok && u.restored === 1 && R(db, rid) === 'open'
      && JSON.stringify(L(db, lid)) === JSON.stringify(['active', 't', '']);
  },
  undoRejectReopens(db) {
    const { rid } = ambiguous(db, 4);
    J(db, `select dia_decide_listing_sale_review(${rid}, 'reject', 'scott')`);
    const u = J(db, `select dia_undo_listing_sale_review(${rid}, 'scott')`);
    return u.ok && R(db, rid) === 'open';
  },
  decisionOnlyOnce(db) {
    const { rid } = ambiguous(db, 5);
    J(db, `select dia_decide_listing_sale_review(${rid}, 'reject', 'scott')`);
    const again = J(db, `select dia_decide_listing_sale_review(${rid}, 'confirm_sold', 'scott')`);
    return again.ok === false && again.error === 'review_not_open';
  },
  autoresolveTakesOnlyTheSafeClasses(db) {
    const keep = ambiguous(db, 10);                          // genuinely ambiguous — must stay open
    const gone = ambiguous(db, 11);                          // another path closed the listing
    q(`update available_listings set status = 'withdrawn', is_active = false where listing_id = ${gone.lid};`, db);
    const excl = ambiguous(db, 12);                          // the sale was quarantined
    q(`update sales_transactions set exclude_from_market_metrics = true where sale_id = ${excl.sid};`, db);
    const foreign = ambiguous(db, 15);                       // another producer asked ABOUT a non-market sale
    q(`update dia_listing_sale_review set verdict = 'review_non_market_sale' where review_id = ${foreign.rid};
       update sales_transactions set exclude_from_market_metrics = true where sale_id = ${foreign.sid};`, db);
    const later = ambiguous(db, 13);                         // a later sale proves it sold
    const later2 = quietSale(db, 13, '2026-07-20', 5100000);
    const dry = q(`select count(*) from dia_autoresolve_listing_sale_reviews(true);`, db);
    q(`select count(*) from dia_autoresolve_listing_sale_reviews(false);`, db);
    const classes = q(`select string_agg(decision->>'auto_class', ',' order by review_id) from dia_listing_sale_review where status = 'superseded';`, db);
    return dry === '3' && classes === 'listing_no_longer_active,sale_no_longer_market,later_sale_settles'
      && R(db, keep.rid) === 'open' && R(db, foreign.rid) === 'open'
      && R(db, gone.rid) === 'superseded' && R(db, excl.rid) === 'superseded' && R(db, later.rid) === 'superseded'
      && JSON.stringify(L(db, later.lid)) === JSON.stringify(['sold', 'f', later2]);
  },
  autoresolveLeavesOtherProducersReviews(db) {
    const foreign = ambiguous(db, 16);
    q(`update dia_listing_sale_review set verdict = 'review_non_market_sale' where review_id = ${foreign.rid};
       update sales_transactions set exclude_from_market_metrics = true where sale_id = ${foreign.sid};`, db);
    return q(`select count(*) from dia_autoresolve_listing_sale_reviews(true);`, db) === '0';
  },
  undoAutoResolveRestoresTheReconcileClose(db) {
    const later = ambiguous(db, 14);
    quietSale(db, 14, '2026-07-20', 5100000);
    q(`select count(*) from dia_autoresolve_listing_sale_reviews(false);`, db);
    const closed = L(db, later.lid)[0];
    J(db, `select dia_undo_listing_sale_review(${later.rid}, 'scott')`);
    return closed === 'sold' && R(db, later.rid) === 'open' && L(db, later.lid)[0] === 'active';
  },
};

for (const [name, fn] of Object.entries(S)) {
  test(`behaviour: ${name}`, { skip: SKIP }, () => { assert.ok(fn(freshDb(migration()))); });
}

const MUTATIONS = {
  confirmClosesThroughTheWriter: [["v_action := public.dia_listing_sale_close_one(r.listing_id, r.sale_id, 'human_' || r.verdict, v_batch);", "v_action := 'closed';"]],
  rejectSkipsThePairForGood: [["SET status = 'rejected', resolved_at = now()", "SET status = 'open', resolved_at = now()"]],
  undoConfirmRestoresTheListing: [["v_restored := public.dia_restore_listing_sale_close(r.decision->>'batch', r.listing_id);", 'v_restored := 1;']],
  undoRejectReopens: [["SET status = 'open', resolved_at = NULL, decided_by = NULL,", "SET status = r.status, resolved_at = NULL, decided_by = NULL,"]],
  decisionOnlyOnce: [["IF r.status <> 'open' THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'review_not_open', 'status', r.status);\n  END IF;", ''],
    ["IF al.is_active IS NOT TRUE THEN\n      RETURN jsonb_build_object('ok', false, 'error', 'listing_not_active');\n    END IF;", '']],
  autoresolveTakesOnlyTheSafeClasses: [['CONTINUE WHEN v_class IS NULL;', "v_class := coalesce(v_class, 'unsafe');"]],
  autoresolveLeavesOtherProducersReviews: [["ELSIF NOT (r.verdict IN ('review_price_mismatch'", "ELSIF false AND NOT (r.verdict IN ('review_price_mismatch'"]],
  undoAutoResolveRestoresTheReconcileClose: [["IF r.decision ? 'batch' THEN", 'IF false THEN']],
};
for (const [name, pairs] of Object.entries(MUTATIONS)) {
  test(`mutation turns red: ${name}`, { skip: SKIP }, () => {
    let ok;
    try { ok = S[name](freshDb(mutate(pairs))); } catch { return; }
    assert.equal(ok, false, `${name} stayed green under its mutation`);
  });
}

test('every new function is service_role only', { skip: SKIP }, () => {
  const db = freshDb(migration());
  const bad = q(`select count(*) from pg_proc p where p.proname in ('dia_listing_sale_close_one',
    'dia_decide_listing_sale_review','dia_undo_listing_sale_review','dia_autoresolve_listing_sale_reviews')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));`, db);
  assert.equal(bad, '0');
});
