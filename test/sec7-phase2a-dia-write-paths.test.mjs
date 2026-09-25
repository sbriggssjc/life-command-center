// SEC7-PHASE2A (2026-09-24) — dia: anon/authenticated can no longer write through a definer
// view or through a `WITH CHECK (true)` / explicit anon-write policy, and every read survives.
//
// Behavioural. supabase/migrations/dialysis/20261013140000_dia_sec7_phase2a_write_paths.sql is
// applied, byte for byte, to a throwaway Postgres cluster seeded with the live pre-fix shapes:
//   * v_sales_feed_portfolio: a DEFINER view over one table (auto-updatable, anon holds ALL);
//   * scrub_cache: a view with INSTEAD OF triggers over scrub_cache_backing;
//   * ingestion_tracker / cmbs_*: USING (auth.role()='service_role') WITH CHECK (true), TO public;
//   * the explicit anon/public write policies, with the live read policies beside them.
// Each clause has a mutation that must turn a case red. Skips when no PostgreSQL binaries exist.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, chmodSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(ROOT, 'supabase', 'migrations', 'dialysis', '20261013140000_dia_sec7_phase2a_write_paths.sql');
const PORT = '55451';

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
function run(cmd, opts = {}) {
  const [c, ...a] = asPg(cmd);
  return spawnSync(c, a, { encoding: 'utf8', timeout: 60000, ...opts });
}
function psql(sql, db = 'postgres', check = true) {
  const r = spawnSync(join(BIN, 'psql'), ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1',
    '-h', dir, '-p', PORT, '-U', 'postgres', '-d', db], { input: sql, encoding: 'utf8' });
  if (check && r.status !== 0) throw new Error(r.stderr);
  return r;
}

const TABLES = ['ingestion_tracker', 'cmbs_loans', 'cmbs_loan_properties', 'salesforce_accounts',
  'lease_rent_schedule', 'lease_extensions', 'lease_options', 'facility_patient_counts',
  'ingestion_log', 'bd_execution_log', 'loopnet_listing_map', 'marketing_leads',
  'scrub_cache_backing', 'user_interactions'];

const SEED = `
create schema auth;
create function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
grant usage on schema auth to public;
grant usage on schema public to anon, authenticated, service_role;
${TABLES.map((t) => `create table ${t} (id bigserial primary key, note text, run_status text);
insert into ${t} (note) values ('seed');
alter table ${t} enable row level security;
grant all on ${t} to anon, authenticated, service_role;
grant all on sequence ${t}_id_seq to anon, authenticated, service_role;`).join('\n')}
-- live policies (pre-fix), SEC7-LEDGERS §4 / pg_policy 2026-09-24
create policy ingestion_tracker_service_role_rw on ingestion_tracker for all
  using (auth.role() = 'service_role') with check (true);
create policy anon_read_it on ingestion_tracker for select to anon using (true);
create policy cmbs_loans_service_role_rw on cmbs_loans for all
  using (auth.role() = 'service_role') with check (true);
create policy cmbs_loan_properties_service_role_rw on cmbs_loan_properties for all
  using (auth.role() = 'service_role') with check (true);
create policy "Allow anon full access to salesforce_accounts" on salesforce_accounts for all to anon using (true) with check (true);
create policy "Allow anon read lease_rent_schedule" on lease_rent_schedule for select to anon using (true);
create policy "Allow anon write lease_rent_schedule" on lease_rent_schedule for all to anon using (true) with check (true);
create policy "Allow anon read lease_extensions" on lease_extensions for select to anon using (true);
create policy "Allow anon write lease_extensions" on lease_extensions for all to anon using (true) with check (true);
create policy "Allow all for lease_options" on lease_options for all using (true) with check (true);
create policy anon_read_fpc on facility_patient_counts for select to anon using (true);
create policy facility_patient_counts_service_role_rw on facility_patient_counts for all to service_role using (true) with check (true);
create policy ingestor_can_insert on facility_patient_counts for insert to anon, authenticated with check (true);
create policy ingestor_can_select on facility_patient_counts for select to anon, authenticated using (true);
create policy "Allow anon read ingestion_log" on ingestion_log for select to anon using (true);
create policy "Allow anon write ingestion_log" on ingestion_log for all to anon using (true) with check (true);
create policy anon_insert on bd_execution_log for insert to anon with check (true);
create policy anon_read on bd_execution_log for select to anon using (true);
create policy service_role_all on bd_execution_log for all to service_role using (true) with check (true);
create policy "Allow service role full access" on loopnet_listing_map for all using (true) with check (true);
create policy "Allow service role full access" on marketing_leads for all using (true) with check (true);
create policy "Allow all for authenticated" on scrub_cache_backing for all using (true) with check (true);
create policy dev_all on user_interactions for all using (true) with check (true);
create policy p_insert_service on user_interactions for insert to authenticated with check (true);
-- the comps spine behind a DEFINER view over one table (auto-updatable)
create table sales_transactions (sale_id bigserial primary key, sold_price numeric);
insert into sales_transactions (sold_price) values (100);
alter table sales_transactions enable row level security;
create view v_sales_feed_portfolio with (security_invoker = off) as
  select sale_id, sold_price from sales_transactions;
grant all on v_sales_feed_portfolio to anon, authenticated, service_role;
-- an INVOKER view is not a bypass (the caller's own rights apply): left alone, not flagged
create view v_invoker_ok with (security_invoker = on) as select sale_id from sales_transactions;
grant all on v_invoker_ok to anon, authenticated, service_role;
-- a view written through INSTEAD OF triggers (the live scrub_cache shape)
create view scrub_cache as select id, note from scrub_cache_backing;
create function scrub_cache_insert_fn() returns trigger language plpgsql as
  $$ begin insert into scrub_cache_backing (note) values (new.note) returning id into new.id; return new; end $$;
create trigger scrub_cache_insert_trigger instead of insert on scrub_cache
  for each row execute function scrub_cache_insert_fn();
grant all on scrub_cache to anon, authenticated, service_role;
`;

function freshDb(migrationSql) {
  n += 1;
  const db = `sec7p2a_${n}`;
  psql(`create database ${db};`);
  psql(SEED, db);
  psql(migrationSql, db);
  return db;
}
function tryAs(db, role, stmt) {
  const r = psql(`do $$ begin
  set local role ${role};
  begin ${stmt}; exception when others then raise notice 'STATE %', sqlstate; return; end;
  raise notice 'STATE ok';
end $$;`, db);
  const line = r.stderr.split('\n').find((l) => l.includes('STATE '));
  assert.ok(line, r.stderr);
  return line.split('STATE ')[1].trim();
}
function countAs(db, role, rel) {
  return Number(psql(`set role ${role}; select count(*) from ${rel};`, db).stdout.trim());
}
const violations = (db) => Number(psql('select count(*) from dia_sec7_write_path_violations();', db).stdout.trim());

const migration = () => readFileSync(MIGRATION, 'utf8');
const SELF_CHECK = '-- 4. Assert on the catalog';
function mutate(...edits) {
  let t = migration();
  for (const [from, to] of edits) { assert.ok(t.includes(from), from); t = t.replace(from, to); }
  // Drop the self-check block so the weakened change applies; the lock itself is what is measured.
  return t.slice(0, t.indexOf(SELF_CHECK));
}

before(() => {
  if (SKIP) return;
  dir = mkdtempSync(join(tmpdir(), 'sec7p2a_'));
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

const VIEW_WRITE = 'update v_sales_feed_portfolio set sold_price = 1';
const WATERMARK = "insert into ingestion_tracker (run_status) values ('watermark')";

test('premise: before the fix anon rewrites the comps spine through the view and plants a watermark', { skip: SKIP }, () => {
  const db = freshDb('select 1;');
  assert.equal(tryAs(db, 'anon', VIEW_WRITE), 'ok');
  assert.equal(psql('select sold_price from sales_transactions;', db).stdout.trim(), '1');
  assert.equal(tryAs(db, 'anon', WATERMARK), 'ok');
  assert.equal(tryAs(db, 'anon', "insert into salesforce_accounts (note) values ('x')"), 'ok');
  assert.equal(tryAs(db, 'anon', "insert into scrub_cache (note) values ('x')"), 'ok');
});

test('after the fix: every client write is refused on the views and the tables', { skip: SKIP }, () => {
  const db = freshDb(migration());
  for (const role of ['anon', 'authenticated']) {
    assert.equal(tryAs(db, role, VIEW_WRITE), '42501', role);
    assert.equal(tryAs(db, role, 'insert into v_sales_feed_portfolio (sold_price) values (5)'), '42501', role);
    assert.equal(tryAs(db, role, 'delete from v_sales_feed_portfolio'), '42501', role);
    assert.equal(tryAs(db, role, "insert into scrub_cache (note) values ('x')"), '42501', role);
    for (const t of TABLES) {
      assert.equal(tryAs(db, role, `insert into ${t} (note) values ('x')`), '42501', `${role} insert ${t}`);
      assert.equal(tryAs(db, role, `update ${t} set note = 'x'`), '42501', `${role} update ${t}`);
    }
  }
  assert.equal(psql('select sold_price from sales_transactions;', db).stdout.trim(), '100');
  assert.equal(psql("select count(*) from ingestion_tracker where run_status = 'watermark';", db).stdout.trim(), '0');
});

test('after the fix: every client read that existed still returns rows', { skip: SKIP }, () => {
  const db = freshDb(migration());
  assert.equal(countAs(db, 'anon', 'v_sales_feed_portfolio'), 1);
  // anon_read_it / anon_read_fpc / ingestor_can_select / the explicit anon read policies were kept.
  for (const t of ['ingestion_tracker', 'facility_patient_counts', 'lease_rent_schedule',
    'lease_extensions', 'ingestion_log', 'bd_execution_log']) {
    assert.equal(countAs(db, 'anon', t), 1, t);
  }
  // the dropped policies that also granted reads are replaced by SELECT-only ones for the same roles.
  for (const t of ['salesforce_accounts', 'lease_options', 'marketing_leads', 'loopnet_listing_map',
    'scrub_cache_backing', 'user_interactions']) {
    assert.equal(countAs(db, 'anon', t), 1, `anon ${t}`);
  }
  assert.equal(countAs(db, 'authenticated', 'lease_options'), 1);
  // salesforce_accounts was anon-only: authenticated gains no read it did not have.
  assert.equal(countAs(db, 'authenticated', 'salesforce_accounts'), 0);
  // cmbs_* never let a client read (USING auth.role()='service_role'); still true.
  assert.equal(countAs(db, 'anon', 'cmbs_loans'), 0);
});

test('after the fix: the service_role writers still work, including through the trigger view', { skip: SKIP }, () => {
  const db = freshDb(migration());
  for (const t of TABLES) {
    assert.equal(tryAs(db, 'service_role', `insert into ${t} (note) values ('svc')`), 'ok', t);
  }
  assert.equal(tryAs(db, 'service_role', "insert into ingestion_tracker (run_status) values ('success')"), 'ok');
  assert.equal(tryAs(db, 'service_role', "insert into scrub_cache (note) values ('svc')"), 'ok');
  assert.equal(tryAs(db, 'service_role', 'update v_sales_feed_portfolio set sold_price = 101'), 'ok');
  assert.equal(countAs(db, 'service_role', 'cmbs_loans'), 2);
});

test('guard reads zero, counts a re-opened hole of each kind, and is not client-executable', { skip: SKIP }, () => {
  const db = freshDb(migration());
  assert.equal(violations(db), 0);
  psql('grant update on v_sales_feed_portfolio to anon;', db);
  assert.equal(violations(db), 1);
  psql('revoke update on v_sales_feed_portfolio from anon;', db);
  psql("create policy reopened on cmbs_loans for insert with check (true);", db);
  assert.equal(violations(db), 1);
  psql('drop policy reopened on cmbs_loans; grant insert on ingestion_tracker to authenticated;', db);
  assert.equal(violations(db), 1);
  psql('revoke insert on ingestion_tracker from authenticated;', db);
  // the invoker view was never a finding, with or without grants
  psql('grant all on v_invoker_ok to anon;', db);
  assert.equal(violations(db), 0);
  assert.equal(tryAs(db, 'anon', 'perform dia_sec7_write_path_violations()'), '42501');
});

// ── mutations ────────────────────────────────────────────────────────────────
const VIEW_REVOKE = ["execute format('revoke insert, update, delete, truncate on %s from public, anon, authenticated', v.rel);", 'null;'];
const POLICY_DROP = ["execute format('drop policy %I on public.%I', p.polname, t);", 'null;'];
const TABLE_REVOKE = ["execute format('revoke insert, update, delete, truncate on public.%I from public, anon, authenticated', t);", 'null;'];
const READ_KEEP = ["execute format('create policy %I on public.%I for select to %s using (true)',", "if false then execute format('%s %s %s',"];

test('mutation: without the view revoke, anon rewrites sales_transactions through the view', { skip: SKIP }, () => {
  const db = freshDb(mutate(VIEW_REVOKE));
  assert.equal(tryAs(db, 'anon', VIEW_WRITE), 'ok');
  assert.equal(psql('select sold_price from sales_transactions;', db).stdout.trim(), '1');
  assert.ok(violations(db) > 0);
});

test('mutation: without the policy drop AND the grant revoke, anon plants the CMS watermark', { skip: SKIP }, () => {
  const db = freshDb(mutate(POLICY_DROP, TABLE_REVOKE));
  assert.equal(tryAs(db, 'anon', WATERMARK), 'ok');
  assert.ok(violations(db) > 0);
});

test('mutation: without the policy drop alone, the guard reports the policies', { skip: SKIP }, () => {
  const db = freshDb(mutate(POLICY_DROP));
  assert.ok(Number(psql("select count(*) from dia_sec7_write_path_violations() where kind = 'client_write_policy';", db).stdout.trim()) > 0);
});

test('mutation: without the grant revoke alone, the guard reports the grants', { skip: SKIP }, () => {
  const db = freshDb(mutate(TABLE_REVOKE));
  assert.ok(Number(psql("select count(*) from dia_sec7_write_path_violations() where kind = 'client_write_grant';", db).stdout.trim()) > 0);
});

test('mutation: without the replacement SELECT policy, anon loses its read of lease_options', { skip: SKIP }, () => {
  const t = migration();
  const at = t.indexOf(READ_KEEP[0]);
  assert.ok(at > 0);
  // comment out the create-policy call (two lines) so no replacement read is created
  const end = t.indexOf(';', at) + 1;
  const weakened = (t.slice(0, at) + 'null;' + t.slice(end));
  const db = freshDb(weakened.slice(0, weakened.indexOf(SELF_CHECK)));
  assert.equal(countAs(db, 'anon', 'lease_options'), 0);
});

test('mutation: the migration self-check aborts a weakened change', { skip: SKIP }, () => {
  psql('create database sec7p2a_selfcheck;');
  psql(SEED, 'sec7p2a_selfcheck');
  const r = psql(migration().replace(VIEW_REVOKE[0], VIEW_REVOKE[1]), 'sec7p2a_selfcheck', false);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SEC7-PHASE2A/);
});
