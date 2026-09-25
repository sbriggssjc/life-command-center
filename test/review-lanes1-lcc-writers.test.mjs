// REVIEW-LANES1 (2026-09-25) — the LCC Opps review queues get a human-verdict writer, an undo, a
// safe auto-resolver and a backlog alert.
//
// Behavioural. supabase/migrations/20261102360000_lcc_review_lanes1_decision_writers.sql is applied,
// byte for byte, to a throwaway Postgres cluster seeded with the live shape it touches. The seed
// carries the REAL lcc_unify_gov_owners_tick, lcc_company_canonical_key, lcc_repoint_entity_property_id
// and lcc_unrepoint_entity_property_id bodies, sliced from their committed migrations, so the tick
// rewrite and the relink/undo round-trip run against the code that is live. Each rule has a mutation
// that must turn it red. Skips when no PostgreSQL binaries exist.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, chmodSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG = (f) => join(ROOT, 'supabase', 'migrations', f);
const MIGRATION = MIG('20261102360000_lcc_review_lanes1_decision_writers.sql');
const PORT = '55463';

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
const J = (db, sql) => JSON.parse(q(sql, db));

// Slice one committed function body out of a migration: from its CREATE line to the first line
// that is exactly the closing dollar-quote + ';' after it.
function slice(file, header, close) {
  const t = readFileSync(MIG(file), 'utf8');
  const i = t.indexOf(header);
  assert.ok(i >= 0, header);
  const j = t.indexOf(close, i);
  assert.ok(j > i, close);
  return t.slice(i, j + close.length);
}
const CGW = '20261102320000_lcc_contacts_gov_writer_hub_owner_unify.sql';
const LIVE_FNS = [
  slice(CGW, 'create or replace function public.lcc_company_canonical_key', '$$;'),
  slice(CGW, 'create or replace function public.lcc_unify_gov_owners_tick', 'END $$;'),
  slice('20261102310000_lcc_repoint_entity_property_id_short_domain.sql',
    'CREATE OR REPLACE FUNCTION public.lcc_repoint_entity_property_id', '$function$;'),
  slice('20261102330000_lcc_mergelog_gap_dangling_asset_links.sql',
    'CREATE OR REPLACE FUNCTION public.lcc_unrepoint_entity_property_id', '$function$;'),
].join('\n');

const SEED = String.raw`
create schema cron;
create function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
create function lcc_cron_post(text, jsonb, text) returns bigint language sql as $$ select 1::bigint $$;
create table unified_contacts (
  unified_id uuid primary key default gen_random_uuid(), contact_class text, company_name text,
  first_name text, last_name text, email text, phone text, sf_account_id text, state text,
  recorded_owner_id uuid, match_method text, match_confidence numeric, field_sources jsonb,
  full_name text generated always as (coalesce(first_name,'') || ' ' || coalesce(last_name,'')) stored,
  created_at timestamptz default now(), updated_at timestamptz default now());
create function touch_updated() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger trg_unified_contacts_updated before update on unified_contacts for each row execute function touch_updated();
create table contact_change_log (log_id uuid primary key default gen_random_uuid(),
  unified_id uuid references unified_contacts(unified_id) on delete set null, change_type text, merged_from uuid);
create table contact_merge_queue (queue_id uuid primary key default gen_random_uuid(),
  contact_a uuid references unified_contacts(unified_id) on delete cascade,
  contact_b uuid references unified_contacts(unified_id) on delete cascade, status text);
create table lcc_n15_sf_campaign_hub_mint_log (id bigserial primary key, unified_id uuid references unified_contacts(unified_id));
create table lcc_gov_recorded_owner_mirror (recorded_owner_id uuid primary key, name text, state text,
  merged_into_recorded_owner_id uuid, survivor_id uuid not null, is_generic boolean not null default false,
  source_created_at timestamptz, source_updated_at timestamptz, synced_at timestamptz not null default now());
create table lcc_gov_owner_unification_review (review_id bigserial primary key, recorded_owner_id uuid not null,
  owner_name text, candidate_unified_id uuid, match_tier int, match_score numeric, reason text not null,
  status text not null default 'open' check (status in ('open','resolved','dismissed')), batch text,
  created_at timestamptz not null default now());
create table lcc_gov_owner_contact_link_log (log_id bigserial primary key, batch text not null,
  action text not null constraint lcc_gov_owner_contact_link_log_action_check check (action in
    ('created','linked','merge_follow_repoint','merge_follow_conflict')),
  unified_id uuid, recorded_owner_id uuid, prior_recorded_owner_id uuid, prior_match_method text, detail jsonb,
  created_at timestamptz not null default now());
create function lcc_hub_gov_owner_merge_follow(boolean, text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function lcc_resolve_hub_company(p_name text, p_state text default null)
  returns table(unified_id uuid, match_tier integer, match_score numeric, ambiguous boolean) language sql as
  $$ select null::uuid, 1, 0.9::numeric, false where false $$;
create table entities (id uuid primary key default gen_random_uuid(), entity_type text, domain text, name text,
  metadata jsonb default '{}'::jsonb, merged_into_entity_id uuid, updated_at timestamptz);
create type research_status as enum ('queued','in_progress','completed','skipped');
create table research_tasks (id uuid primary key default gen_random_uuid(), status research_status default 'queued',
  updated_at timestamptz);
create table lcc_asset_property_link_resolution (id bigserial primary key, batch_tag text not null, domain text not null,
  entity_id uuid not null, dropped_property_id text not null, verdict text not null, kept_property_id text,
  evidence jsonb not null default '{}'::jsonb, research_task_id uuid, applied_at timestamptz, reversed_at timestamptz,
  created_at timestamptz not null default now());
create table lcc_decisions (id bigserial primary key, decision_type text, status text, decided_by uuid, decided_at timestamptz);
create table lcc_health_alerts (alert_id bigserial primary key, detected_at timestamptz default now(),
  alert_kind text, source text, severity text, summary text, details jsonb, resolved_at timestamptz, resolved_note text);
`;

const migration = () => readFileSync(MIGRATION, 'utf8');
function mutate(pairs) {
  let t = migration();
  for (const [o, nw] of pairs) { assert.ok(t.includes(o), o); t = t.replace(o, nw); }
  return t;
}
function freshDb(sql) {
  n += 1;
  const db = `rl1lcc_${n}`;
  psql(`create database ${db};`);
  psql(SEED, db);
  psql(LIVE_FNS, db);
  psql(sql, db);
  return db;
}
const uuid = (db) => q('select gen_random_uuid();', db);
function owner(db, name, state = null, survivor = null) {
  const id = uuid(db);
  q(`insert into lcc_gov_recorded_owner_mirror (recorded_owner_id, name, state, survivor_id)
     values ('${id}', $n$${name}$n$, ${state ? `'${state}'` : 'null'}, '${survivor || id}');`, db);
  return id;
}
function contact(db, company, ownerId = null, cls = 'business') {
  return q(`insert into unified_contacts (contact_class, company_name, recorded_owner_id, match_method, match_confidence)
    values ('${cls}', $n$${company}$n$, ${ownerId ? `'${ownerId}'` : 'null'}, 'orig', 0.4) returning unified_id;`, db);
}
function review(db, ownerId, name, cand, reason) {
  return q(`insert into lcc_gov_owner_unification_review (recorded_owner_id, owner_name, candidate_unified_id, match_tier,
    match_score, reason) values ('${ownerId}', $n$${name}$n$, ${cand ? `'${cand}'` : 'null'}, 0, 1.0, '${reason}') returning review_id;`, db);
}
const RS = (db, rid) => q(`select status from lcc_gov_owner_unification_review where review_id = ${rid};`, db);
const OWNER_OF = (db, uid) => q(`select coalesce(recorded_owner_id::text,'') from unified_contacts where unified_id = '${uid}';`, db);

before(() => {
  if (SKIP) return;
  dir = mkdtempSync(join(tmpdir(), 'rl1lcc_'));
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
  linkWritesTheOwnerAndUndoRestores(db) {
    const o = owner(db, 'Acme Plaza LLC');
    const c = contact(db, 'Acme Plaza Partners');
    const rid = review(db, o, 'Acme Plaza LLC', c, 'tier1_fuzzy');
    const d = J(db, `select lcc_decide_gov_owner_review(${rid}, 'link', 'scott')`);
    const linked = OWNER_OF(db, c) === o && RS(db, rid) === 'resolved';
    const u = J(db, `select lcc_undo_gov_owner_review(${rid}, 'scott')`);
    const back = q(`select coalesce(recorded_owner_id::text,'') || '|' || match_method from unified_contacts where unified_id = '${c}';`, db);
    return d.ok && linked && u.ok && back === '|orig' && RS(db, rid) === 'open';
  },
  linkRefusesACandidateAlreadyLinked(db) {
    const other = owner(db, 'Someone Else LLC');
    const o = owner(db, 'Acme Plaza LLC');
    const c = contact(db, 'Acme Plaza LLC', other);
    const rid = review(db, o, 'Acme Plaza LLC', c, 'unified_row_already_linked');
    const d = J(db, `select lcc_decide_gov_owner_review(${rid}, 'link', 'scott')`);
    return d.ok === false && d.error === 'candidate_already_linked' && OWNER_OF(db, c) === other && RS(db, rid) === 'open';
  },
  createMintsAContactAndUndoDeletesIt(db) {
    const o = owner(db, 'Birch Holdings LLC', 'TX');
    const rid = review(db, o, 'Birch Holdings LLC', contact(db, 'Birch Co'), 'tier1_fuzzy');
    const d = J(db, `select lcc_decide_gov_owner_review(${rid}, 'create', 'scott')`);
    const made = q(`select count(*) from unified_contacts where recorded_owner_id = '${o}';`, db);
    J(db, `select lcc_undo_gov_owner_review(${rid}, 'scott')`);
    const after = q(`select count(*) from unified_contacts where recorded_owner_id = '${o}';`, db);
    return d.ok && made === '1' && after === '0' && RS(db, rid) === 'open';
  },
  autoresolveTakesOnlyTheSafeClass(db) {
    // same company, both live gov owners, compatible states → safe
    const dup = owner(db, 'Graham Office, LLC', 'TX');
    const o1 = owner(db, 'GRAHAM OFFICE LLC', 'TX');
    const safe = review(db, o1, 'GRAHAM OFFICE LLC', contact(db, 'Graham Office, LLC', dup), 'unified_row_already_linked');
    // same key, conflicting states → human
    const dup2 = owner(db, 'Ray Fuller Farms, Inc.', 'TX');
    const o2 = owner(db, 'RAY FULLER FARMS, INC', 'AR');
    const statey = review(db, o2, 'RAY FULLER FARMS, INC', contact(db, 'Ray Fuller Farms Inc', dup2), 'unified_row_already_linked');
    // different company → human
    const dup3 = owner(db, 'Duke Realty', null);
    const o3 = owner(db, 'Duke Realty Corporation Trust', null);
    const diff = review(db, o3, 'Duke Realty Corporation Trust', contact(db, 'Duke Realty', dup3), 'unified_row_already_linked');
    // fuzzy with an unlinked candidate → human
    const o4 = owner(db, 'Kite Road LLC');
    const fuzzy = review(db, o4, 'Kite Road LLC', contact(db, 'Kite Rd Partners'), 'tier1_fuzzy');
    const dry = q('select count(*) from lcc_autoresolve_gov_owner_reviews(true);', db);
    q('select count(*) from lcc_autoresolve_gov_owner_reviews(false);', db);
    return dry === '1' && RS(db, safe) === 'resolved'
      && RS(db, statey) === 'open' && RS(db, diff) === 'open' && RS(db, fuzzy) === 'open';
  },
  tickNoLongerRequeuesADecidedOwner(db) {
    const o = owner(db, 'Cedar Lane LLC');
    const rid = review(db, o, 'Cedar Lane LLC', contact(db, 'Cedar Co'), 'tier1_fuzzy');
    J(db, `select lcc_decide_gov_owner_review(${rid}, 'not_same', 'scott')`);
    const t = J(db, 'select lcc_unify_gov_owners_tick(200, false)');
    const reviews = q(`select count(*) from lcc_gov_owner_unification_review where recorded_owner_id = '${o}';`, db);
    const minted = q(`select count(*) from unified_contacts where recorded_owner_id = '${o}';`, db);
    return t.new === 0 && reviews === '1' && minted === '0';
  },
  relinkRepointsAndUndoPutsItBack(db) {
    const e = q(`insert into entities (entity_type, domain, name, metadata) values ('asset', 'dia', '1 Main',
      '{"domain_property_id":"999","domain_property_missing":{"verdict":"candidate"}}') returning id;`, db);
    const t = q(`insert into research_tasks default values returning id;`, db);
    const l = q(`insert into lcc_asset_property_link_resolution (batch_tag, domain, entity_id, dropped_property_id, verdict,
      evidence, research_task_id) values ('b', 'dia', '${e}', '999', 'candidate', '{"candidates":["37545","29507"]}', '${t}') returning id;`, db);
    const bad = J(db, `select lcc_decide_asset_property_link(${l}, 'relink', '12345', 'scott')`);
    const d = J(db, `select lcc_decide_asset_property_link(${l}, 'relink', '29507', 'scott')`);
    const moved = q(`select (metadata->>'domain_property_id') || '|' || (metadata ? 'domain_property_missing')::text from entities where id = '${e}';`, db);
    const task = q(`select status from research_tasks where id = '${t}';`, db);
    J(db, `select lcc_undo_asset_property_link(${l}, 'scott')`);
    const back = q(`select (metadata->>'domain_property_id') || '|' || (metadata ? 'domain_property_missing')::text from entities where id = '${e}';`, db);
    const task2 = q(`select status from research_tasks where id = '${t}';`, db);
    return bad.error === 'kept_not_a_candidate' && d.ok && moved === '29507|false' && task === 'completed'
      && back === '999|true' && task2 === 'queued';
  },
  conflictMergeUndoRestoresBothContacts(db) {
    const surv = owner(db, 'Sea Stone Group LP');
    const tomb = owner(db, 'SEA STONE GROUP LP', null, surv);
    const holder = contact(db, 'THE SEASTONE GROUP LP', surv);
    const b = contact(db, 'SEA STONE GROUP LP', tomb);
    q(`update unified_contacts set email = 'ops@seastone.com' where unified_id = '${b}';
       insert into contact_change_log (unified_id, change_type) values ('${b}', 'ingest');
       insert into contact_merge_queue (contact_a, contact_b, status) values ('${holder}', '${b}', 'pending');`, db);
    const log = q(`insert into lcc_gov_owner_contact_link_log (batch, action, unified_id, recorded_owner_id, prior_recorded_owner_id)
      values ('mf', 'merge_follow_conflict', '${b}', '${surv}', '${tomb}') returning log_id;`, db);
    const snap = J(db, `select lcc_snapshot_contact_conflict_merge(${log}, 'scott')`);
    // what the contact merge path does: fill the holder's blanks, then delete the dropped contact
    q(`update unified_contacts set email = 'ops@seastone.com' where unified_id = '${holder}';
       delete from unified_contacts where unified_id = '${b}';`, db);
    const u = J(db, `select lcc_undo_contact_conflict_merge(${snap.backup_id})`);
    const state = q(`select (select coalesce(email,'') from unified_contacts where unified_id = '${holder}') || '|'
      || (select email || ':' || recorded_owner_id from unified_contacts where unified_id = '${b}') || '|'
      || (select count(*) from contact_change_log where unified_id = '${b}') || '|'
      || (select count(*) from contact_merge_queue where contact_b = '${b}');`, db);
    return snap.ok && u.ok && state === `|ops@seastone.com:${tomb}|1|1`;
  },
  conflictMergeRefusesPersonIntoCompany(db) {
    const surv = owner(db, 'Welsh Properties LP');
    const tomb = owner(db, 'Welsh Properties', null, surv);
    contact(db, 'WELSH PROPERTIES LIMITED PARTNERSHIP', surv, 'business');
    const b = contact(db, 'Welsh Properties', tomb, 'person');
    const log = q(`insert into lcc_gov_owner_contact_link_log (batch, action, unified_id, recorded_owner_id, prior_recorded_owner_id)
      values ('mf', 'merge_follow_conflict', '${b}', '${surv}', '${tomb}') returning log_id;`, db);
    const snap = J(db, `select lcc_snapshot_contact_conflict_merge(${log}, 'scott')`);
    return snap.ok === false && snap.error === 'contact_class_differs';
  },
  conflictRepointAndUndo(db) {
    const surv = owner(db, 'Baker Properties LP');
    const tomb = owner(db, 'BAKER PROPERTIES, L.L.C.', null, surv);
    const b = contact(db, 'BAKER PROPERTIES, L.L.C.', tomb);
    const log = q(`insert into lcc_gov_owner_contact_link_log (batch, action, unified_id, recorded_owner_id, prior_recorded_owner_id)
      values ('mf', 'merge_follow_conflict', '${b}', '${surv}', '${tomb}') returning log_id;`, db);
    const d = J(db, `select lcc_decide_contact_hub_conflict(${log}, 'repoint_to_survivor', 'scott')`);
    const on = OWNER_OF(db, b);
    const u = J(db, `select lcc_undo_contact_hub_conflict_repoint(${log}, 'scott')`);
    return d.ok && on === surv && u.ok && OWNER_OF(db, b) === tomb;
  },
  backlogAlertOpensAndResolves(db) {
    const rows = (open, oldest) => `'[{"lane_key":"listing_sale_review","decision_type":"listing_sale_review","open_count":${open},"oldest_open_at":"${oldest}"}]'`;
    J(db, `select lcc_record_review_lane_backlog(${rows(8, '2026-08-01')})`);
    const opened = q(`select count(*) from lcc_health_alerts where alert_kind = 'review_lane_backlog' and resolved_at is null;`, db);
    J(db, `select lcc_record_review_lane_backlog(${rows(8, '2026-08-01')})`);
    const deduped = q(`select count(*) from lcc_health_alerts where alert_kind = 'review_lane_backlog';`, db);
    J(db, `select lcc_record_review_lane_backlog(${rows(0, '2026-08-01')})`);
    const open2 = q(`select count(*) from lcc_health_alerts where alert_kind = 'review_lane_backlog' and resolved_at is null;`, db);
    // fresh work is not a stall
    J(db, `select lcc_record_review_lane_backlog(${rows(5, new Date().toISOString())})`);
    const open3 = q(`select count(*) from lcc_health_alerts where alert_kind = 'review_lane_backlog' and resolved_at is null;`, db);
    return opened === '1' && deduped === '1' && open2 === '0' && open3 === '0';
  },
};

for (const [name, fn] of Object.entries(S)) {
  test(`behaviour: ${name}`, { skip: SKIP }, () => { assert.ok(fn(freshDb(migration()))); });
}

const MUTATIONS = {
  linkWritesTheOwnerAndUndoRestores: [["match_method = r.resolution->>'prior_match_method',", 'match_method = match_method,']],
  linkRefusesACandidateAlreadyLinked: [["IF u.recorded_owner_id IS NOT NULL THEN\n      RETURN jsonb_build_object('ok', false, 'error', 'candidate_already_linked',\n                                'linked_to', u.recorded_owner_id);\n    END IF;", '']],
  createMintsAContactAndUndoDeletesIt: [['DELETE FROM public.unified_contacts WHERE unified_id = v_uid;', 'PERFORM 1;']],
  autoresolveTakesOnlyTheSafeClass: [['AND (r.own_state IS NULL OR r.cand_state IS NULL OR upper(r.own_state) = upper(r.cand_state))', '']],
  tickNoLongerRequeuesADecidedOwner: [["EXECUTE replace(d, v_old, 'WHERE q.recorded_owner_id = o.recorded_owner_id)');", 'NULL;']],
  relinkRepointsAndUndoPutsItBack: [["v_n := public.lcc_unrepoint_entity_property_id(l.domain, l.dropped_property_id, l.decision->>'kept');", 'v_n := 1;']],
  conflictMergeUndoRestoresBothContacts: [["EXECUTE format('INSERT INTO public.unified_contacts (unified_id, %1$s) SELECT unified_id, %1$s '", "EXECUTE format('SELECT 1 WHERE false AND %1$L IS NULL AND %1$L IS NULL '"]],
  conflictMergeRefusesPersonIntoCompany: [["IF coalesce(c.contact_class, '') IS DISTINCT FROM coalesce(c.holder_class, '') THEN", 'IF false THEN']],
  conflictRepointAndUndo: [['UPDATE public.unified_contacts SET recorded_owner_id = r.prior_recorded_owner_id', 'UPDATE public.unified_contacts SET recorded_owner_id = r.recorded_owner_id']],
  backlogAlertOpensAndResolves: [["IF v_open > 0 AND v_dec = 0 AND v_oldest < now() - interval '14 days' THEN", 'IF v_open > 0 AND v_dec = 0 THEN']],
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
  const bad = q(`select string_agg(p.proname, ',') from pg_proc p where p.proname like any (array['lcc_decide_%',
    'lcc_undo_%','lcc_autoresolve_%','lcc_snapshot_contact_conflict_merge','lcc_record_review_lane_backlog'])
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));`, db);
  assert.equal(bad, '');
});
