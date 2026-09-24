// ============================================================================
// CONTACTS-GOV-WRITER (2026-09-24) — the gov owner→contact unification was
// ported from gov cron 17 (`unify_owners_tick`, which wrote the RETIRED gov
// unified_contacts copy) onto the LCC Opps hub. This guard reads the migration
// SOURCE (no DB in CI) and pins the properties the port depends on:
//
//   * the canonical-key function is byte-identical to gov's (one rule, two
//     copies that must not drift — gov's resolver built the links already on
//     the hub, so a divergent key would stop re-finding them);
//   * the tick never selects a merged-away owner and filters generic owners in
//     SELECTION (a loop-level skip lets them hold the LIMIT window — P136);
//   * merge-follow never repoints a conflict row, only logs it;
//   * the mirror pull strides 1,000 (PostgREST cap) and the finalizer counts
//     non-200 pages and a full last page instead of dropping them silently;
//   * every mutating function defaults to dry-run and is closed to anon.
//
// Comments are stripped first: the header quotes the retired gov behaviour.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG = 'supabase/migrations/20261102320000_lcc_contacts_gov_writer_hub_owner_unify.sql';
const RAW = readFileSync(join(ROOT, MIG), 'utf8');
const SRC = RAW.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

// Live gov public.company_canonical_key body, read 2026-09-24.
const GOV_CANONICAL_KEY_BODY =
  "SELECT regexp_replace(\n" +
  "           regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]', '', 'g'),\n" +
  "           '(llc|inc|incorporated|corporation|corp|ltd|lllp|llp|lp)+$', '')";

function fnBody(name) {
  const re = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`, 'i');
  const m = SRC.match(re);
  assert.ok(m, `function ${name} not found in ${MIG}`);
  return m[1];
}

test('lcc_company_canonical_key is byte-identical to gov company_canonical_key', () => {
  assert.equal(fnBody('lcc_company_canonical_key').trim(), GOV_CANONICAL_KEY_BODY);
});

test('tick selects only live (non-merged) owners and filters generics in the WHERE', () => {
  const body = fnBody('lcc_unify_gov_owners_tick');
  const sel = body.slice(body.indexOf('FOR r IN'), body.indexOf('LOOP'));
  assert.match(sel, /o\.survivor_id\s*=\s*o\.recorded_owner_id/);
  assert.match(sel, /NOT\s+o\.is_generic/);
  assert.match(sel, /LIMIT\s+p_limit/);
});

test('tick runs merge-follow before selecting owners', () => {
  const body = fnBody('lcc_unify_gov_owners_tick');
  assert.ok(body.indexOf('lcc_hub_gov_owner_merge_follow(') > -1);
  assert.ok(body.indexOf('lcc_hub_gov_owner_merge_follow(') < body.indexOf('FOR r IN'));
});

test('merge-follow repoints only non-conflict rows and logs conflicts', () => {
  const body = fnBody('lcc_hub_gov_owner_merge_follow');
  const upd = body.match(/UPDATE public\.unified_contacts u SET recorded_owner_id[\s\S]*?;/);
  assert.ok(upd, 'repoint UPDATE missing');
  assert.match(upd[0], /AND\s+NOT\s+f\.is_conflict/);
  assert.match(body, /'merge_follow_conflict'[\s\S]*WHERE is_conflict/);
  assert.match(body, /count\(\*\) OVER \(PARTITION BY t\.survivor_id\) > 1/);
});

test('mirror pull strides 1000 and the finalizer reports failure instead of dropping it', () => {
  assert.match(fnBody('lcc_sync_gov_recorded_owner_mirror'), /limit=1000&offset=' \|\| \(v_page \* 1000\)/);
  const fin = fnBody('lcc_finalize_gov_recorded_owner_mirror');
  assert.match(fin, /status_code IS DISTINCT FROM 200/);
  assert.match(fin, /jsonb_array_length\(content::jsonb\) = 1000/);
  assert.match(fin, /'gov_owner_mirror_sync_failed'/);
  assert.match(fin, /'retired_contacts_copy_written'/);
});

test('mutating functions default to dry-run', () => {
  assert.match(SRC, /lcc_hub_gov_owner_merge_follow\(\s*p_dry_run boolean default true/i);
  assert.match(SRC, /lcc_unify_gov_owners_tick\(\s*p_limit int default 200, p_dry_run boolean default true/i);
});

test('functions are revoked from public/anon/authenticated and asserted', () => {
  assert.match(SRC, /revoke all on function %s from public, anon, authenticated/);
  assert.match(SRC, /has_function_privilege\('anon', f, 'execute'\)/);
  for (const f of ['lcc_sync_gov_recorded_owner_mirror(int)', 'lcc_finalize_gov_recorded_owner_mirror()',
    'lcc_hub_gov_owner_merge_follow(boolean,text)', 'lcc_unify_gov_owners_tick(int,boolean,text)']) {
    assert.ok(SRC.includes(`'public.${f}'`), `${f} missing from the revoke list`);
  }
});
