// SEC7-PHASE2A (2026-09-24) — LCC Opps: anon/authenticated can no longer write through a
// DEFINER view, and the view reads survive.
//
// Behavioural. supabase/migrations/20261102350000_lcc_sec7_phase2a_writable_views.sql is applied,
// byte for byte, to a throwaway cluster seeded with the live pre-fix shape: a review table with
// RLS on and no client policy, and a DEFINER view over it (auto-updatable, anon holds ALL). An
// INVOKER view beside it is left alone and never flagged. Skips when no PostgreSQL binaries exist.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, chmodSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261102350000_lcc_sec7_phase2a_writable_views.sql');
const PORT = '55455';

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

const SEED = `
grant usage on schema public to anon, authenticated, service_role;
create table junk_entity_review (id bigserial primary key, verdict text, status text);
insert into junk_entity_review (verdict, status) values ('uncertain', 'open');
alter table junk_entity_review enable row level security;
grant all on junk_entity_review to service_role;
create view v_junk_entity_review_open as
  select id, verdict, status from junk_entity_review where status = 'open';
grant all on v_junk_entity_review_open to anon, authenticated, service_role;
create table market_brief (id bigserial primary key, body text);
insert into market_brief (body) values ('b');
create view v_market_brief_live as select id, body from market_brief;
grant all on v_market_brief_live to anon, authenticated, service_role;
create view v_invoker_ok with (security_invoker = on) as select id from market_brief;
grant all on v_invoker_ok to anon, authenticated, service_role;
`;

function freshDb(sql) {
  n += 1;
  const db = `sec7lcc_${n}`;
  psql(`create database ${db};`);
  psql(SEED, db);
  psql(sql, db);
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
const violations = (db) => Number(psql('select count(*) from lcc_sec7_write_path_violations();', db).stdout.trim());
const migration = () => readFileSync(MIGRATION, 'utf8');
const SELF_CHECK = '-- 3. Assert on the catalog';
const VIEW_REVOKE = "execute format('revoke insert, update, delete, truncate on %s from public, anon, authenticated', v.rel);";
const VERDICT = "update v_junk_entity_review_open set verdict = 'dismiss'";

before(() => {
  if (SKIP) return;
  dir = mkdtempSync(join(tmpdir(), 'sec7lcc_'));
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

test('premise: before the fix anon sets a review verdict through the view, past RLS', { skip: SKIP }, () => {
  const db = freshDb('select 1;');
  assert.equal(tryAs(db, 'anon', VERDICT), 'ok');
  assert.equal(psql('select verdict from junk_entity_review;', db).stdout.trim(), 'dismiss');
});

test('after the fix: client writes through every definer view are refused, reads work', { skip: SKIP }, () => {
  const db = freshDb(migration());
  for (const role of ['anon', 'authenticated']) {
    assert.equal(tryAs(db, role, VERDICT), '42501', role);
    assert.equal(tryAs(db, role, "insert into v_market_brief_live (body) values ('x')"), '42501', role);
    assert.equal(tryAs(db, role, 'delete from v_market_brief_live'), '42501', role);
    assert.equal(tryAs(db, role, 'perform 1 from v_junk_entity_review_open'), 'ok', role);
  }
  assert.equal(psql('select verdict from junk_entity_review;', db).stdout.trim(), 'uncertain');
  assert.equal(tryAs(db, 'service_role', VERDICT), 'ok');
});

test('guard reads zero, counts a re-opened view grant or a WITH CHECK (true) policy, ignores invoker views', { skip: SKIP }, () => {
  const db = freshDb(migration());
  assert.equal(violations(db), 0);
  psql('grant insert on v_market_brief_live to authenticated;', db);
  assert.equal(violations(db), 1);
  psql('revoke insert on v_market_brief_live from authenticated;', db);
  psql('create policy reopened on junk_entity_review for insert with check (true);', db);
  assert.equal(violations(db), 1);
  psql('drop policy reopened on junk_entity_review; grant all on v_invoker_ok to anon;', db);
  assert.equal(violations(db), 0);
  assert.equal(tryAs(db, 'anon', 'perform lcc_sec7_write_path_violations()'), '42501');
});

test('mutation: without the view revoke anon sets the verdict and the guard fires', { skip: SKIP }, () => {
  const t = migration();
  assert.ok(t.includes(VIEW_REVOKE));
  const weakened = t.replace(VIEW_REVOKE, 'null;');
  const db = freshDb(weakened.slice(0, weakened.indexOf(SELF_CHECK)));
  assert.equal(tryAs(db, 'anon', VERDICT), 'ok');
  assert.ok(violations(db) > 0);
});

test('mutation: the migration self-check aborts a weakened change', { skip: SKIP }, () => {
  psql('create database sec7lcc_selfcheck;');
  psql(SEED, 'sec7lcc_selfcheck');
  const r = psql(migration().replace(VIEW_REVOKE, 'null;'), 'sec7lcc_selfcheck', false);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SEC7-PHASE2A/);
});
