// SEC7-LEDGERS (2026-09-24) — anon/authenticated cannot write the dia merge ledgers.
//
// Behavioural. supabase/migrations/dialysis/20261013130000_dia_sec7_ledgers_lock.sql is applied,
// byte for byte, to a throwaway Postgres cluster seeded with the live pre-lock shape: RLS off,
// Supabase's default ALL grants, and v_dia_property_redirect_resolved as a DEFINER view over one
// table — which Postgres makes auto-updatable, so it was a second anon write path.
//
//   * anon/authenticated are refused on both tables AND through the view (42501);
//   * the legitimate paths still work: a SECURITY DEFINER merge writer called as service_role,
//     the Railway reconciled_lcc_* stamp PATCH as service_role, the service_role view read;
//   * dia_sec7_ledger_privilege_violations() reads 0 and fires when a grant or RLS flag returns.
// Each clause has a mutation that must turn a case red. Skips when no PostgreSQL binaries exist.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, chmodSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(ROOT, 'supabase', 'migrations', 'dialysis', '20261013130000_dia_sec7_ledgers_lock.sql');
const PORT = '55449';

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
create table dia_property_redirects (
  redirect_id bigserial primary key, dropped_property_id bigint, kept_property_id bigint,
  merged_at timestamptz default now(), source text, batch_tag text, note text,
  reversed_at timestamptz, reconciled_lcc_at timestamptz, reconciled_lcc_count int);
create table dia_property_merge_backup (
  backup_id bigserial primary key, kept_property_id bigint, dropped_property_id bigint,
  batch_tag text, merged_at timestamptz default now(), unmerged_at timestamptz,
  reconciled_lcc_at timestamptz, unmerge_reconciled_lcc_at timestamptz);
insert into dia_property_redirects (dropped_property_id, kept_property_id) values (2, 1);
insert into dia_property_merge_backup (kept_property_id, dropped_property_id) values (1, 2);
-- A definer view over ONE table: auto-updatable (the live shape, minus the resolver column).
create view v_dia_property_redirect_resolved as
  select r.dropped_property_id, r.kept_property_id as recorded_survivor_id, r.source, r.batch_tag,
         r.merged_at, r.reversed_at, r.note, r.redirect_id, r.reconciled_lcc_at, r.reconciled_lcc_count
    from dia_property_redirects r;
grant usage on schema public to anon, authenticated, service_role;
grant all on dia_property_redirects, dia_property_merge_backup, v_dia_property_redirect_resolved
  to anon, authenticated, service_role;
grant all on sequence dia_property_redirects_redirect_id_seq, dia_property_merge_backup_backup_id_seq
  to anon, authenticated, service_role;
-- A definer writer shaped like dia_merge_property_reversible (owner postgres, service_role EXECUTE).
create function dia_merge_property_reversible(p_keep int, p_drop int, p_tag text)
returns bigint language plpgsql security definer set search_path = public as $$
declare b bigint; begin
  insert into dia_property_merge_backup (kept_property_id, dropped_property_id, batch_tag)
    values (p_keep, p_drop, p_tag) returning backup_id into b;
  insert into dia_property_redirects (dropped_property_id, kept_property_id, batch_tag)
    values (p_drop, p_keep, p_tag);
  return b; end $$;
revoke all on function dia_merge_property_reversible(int, int, text) from public;
grant execute on function dia_merge_property_reversible(int, int, text) to service_role;
`;

function freshDb(migrationSql) {
  n += 1;
  const db = `sec7dia_${n}`;
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
const violations = (db) => Number(psql('select count(*) from dia_sec7_ledger_privilege_violations();', db).stdout.trim());

const migration = () => readFileSync(MIGRATION, 'utf8');
function mutate(...olds) {
  let t = migration();
  for (const o of olds) { assert.ok(t.includes(o), o); t = t.replace(o, ''); }
  // Drop the self-check block so the weakened lock applies; the lock itself is what is measured.
  return t.slice(0, t.indexOf('-- 6. Assert on the catalog'));
}

before(() => {
  if (SKIP) return;
  dir = mkdtempSync(join(tmpdir(), 'sec7dia_'));
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

const CLIENT_WRITES = [
  "insert into dia_property_redirects (dropped_property_id, kept_property_id) values (9, 8)",
  "update dia_property_redirects set kept_property_id = 999",
  "delete from dia_property_redirects",
  "update v_dia_property_redirect_resolved set recorded_survivor_id = 999",
  "insert into v_dia_property_redirect_resolved (dropped_property_id, recorded_survivor_id) values (7, 6)",
  "update dia_property_merge_backup set unmerged_at = now()",
  "delete from dia_property_merge_backup",
  "perform 1 from dia_property_merge_backup",
];

test('premise: before the lock anon can re-point a redirect through the definer view', { skip: SKIP }, () => {
  const db = freshDb('select 1;');
  assert.equal(tryAs(db, 'anon', CLIENT_WRITES[3]), 'ok');
  assert.equal(psql('select kept_property_id from dia_property_redirects;', db).stdout.trim(), '999');
});

test('after the lock anon and authenticated are refused on tables and through the view', { skip: SKIP }, () => {
  const db = freshDb(migration());
  for (const role of ['anon', 'authenticated']) {
    for (const stmt of CLIENT_WRITES) assert.equal(tryAs(db, role, stmt), '42501', `${role}: ${stmt}`);
  }
  assert.equal(psql('select kept_property_id from dia_property_redirects;', db).stdout.trim(), '1');
});

test('the legitimate writers still work as service_role', { skip: SKIP }, () => {
  const db = freshDb(migration());
  assert.equal(tryAs(db, 'service_role', "perform dia_merge_property_reversible(3, 4, 'sec7')"), 'ok');
  assert.equal(psql("select count(*) from dia_property_redirects where batch_tag = 'sec7';", db).stdout.trim(), '1');
  assert.equal(psql("select count(*) from dia_property_merge_backup where batch_tag = 'sec7';", db).stdout.trim(), '1');
  // merge-log-reconcile.js stamps both ledgers and reads the view with the service key.
  assert.equal(tryAs(db, 'service_role', 'update dia_property_redirects set reconciled_lcc_at = now(), reconciled_lcc_count = 0'), 'ok');
  assert.equal(tryAs(db, 'service_role', 'update dia_property_merge_backup set unmerge_reconciled_lcc_at = now()'), 'ok');
  assert.equal(tryAs(db, 'service_role', 'perform 1 from v_dia_property_redirect_resolved'), 'ok');
});

test('guard reads zero, fires on a returned grant / RLS flag, and is not client-executable', { skip: SKIP }, () => {
  const db = freshDb(migration());
  assert.equal(violations(db), 0);
  psql('grant update on v_dia_property_redirect_resolved to anon;', db);
  assert.equal(violations(db), 1);
  psql('revoke update on v_dia_property_redirect_resolved from anon; grant insert on dia_property_redirects to public;', db);
  assert.equal(violations(db), 2); // PUBLIC reaches both client roles
  psql('revoke insert on dia_property_redirects from public; alter table dia_property_merge_backup disable row level security;', db);
  assert.equal(violations(db), 1);
  assert.equal(tryAs(db, 'anon', 'perform dia_sec7_ledger_privilege_violations()'), '42501');
});

// ── mutations ────────────────────────────────────────────────────────────────
const REVOKE_VIEW = 'revoke all on table public.v_dia_property_redirect_resolved from public, anon, authenticated;';
const REVOKE_REDIR = 'revoke all on table public.dia_property_redirects    from public, anon, authenticated;';
const REVOKE_BACKUP = 'revoke all on table public.dia_property_merge_backup from public, anon, authenticated;';
const RLS_REDIR = 'alter table public.dia_property_redirects    enable row level security;';
const RLS_BACKUP = 'alter table public.dia_property_merge_backup enable row level security;';

test('mutation: without the view revoke, anon re-points a redirect through the view', { skip: SKIP }, () => {
  // The base-table lock alone does not close it: a definer view writes as its owner, and the
  // owner bypasses RLS. This is the path a table-only fix would have left open.
  const db = freshDb(mutate(REVOKE_VIEW));
  assert.equal(tryAs(db, 'anon', CLIENT_WRITES[3]), 'ok');
  assert.equal(psql('select kept_property_id from dia_property_redirects;', db).stdout.trim(), '999');
  assert.ok(violations(db) > 0);
});

for (const clause of [REVOKE_REDIR, REVOKE_BACKUP]) {
  test(`mutation: without "${clause.slice(0, 60)}…" the guard fires`, { skip: SKIP }, () => {
    const db = freshDb(mutate(clause));
    assert.ok(violations(db) > 0);
  });
}

for (const [revoke, rls, table, col] of [
  [REVOKE_REDIR, RLS_REDIR, 'dia_property_redirects', 'kept_property_id'],
  [REVOKE_BACKUP, RLS_BACKUP, 'dia_property_merge_backup', 'kept_property_id'],
]) {
  test(`mutation: without both layers on ${table} the anon write lands`, { skip: SKIP }, () => {
    const db = freshDb(mutate(revoke, rls));
    assert.equal(tryAs(db, 'anon', `update ${table} set ${col} = 999`), 'ok');
    assert.equal(psql(`select ${col} from ${table};`, db).stdout.trim(), '999');
  });
}

for (const clause of [RLS_REDIR, RLS_BACKUP]) {
  test(`mutation: without "${clause}" the guard reports it`, { skip: SKIP }, () => {
    assert.equal(violations(freshDb(mutate(clause))), 1);
  });
}

test('mutation: the migration self-check aborts a weakened lock', { skip: SKIP }, () => {
  psql('create database sec7dia_selfcheck;');
  psql(SEED, 'sec7dia_selfcheck');
  const r = psql(migration().replace(REVOKE_VIEW, ''), 'sec7dia_selfcheck', false);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SEC7-LEDGERS/);
});
