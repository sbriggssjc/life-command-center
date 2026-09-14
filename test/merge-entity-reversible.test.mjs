// P196 Unit 1 (backlog N11) — the SHARED merge path is reversible.
//
// WHAT THIS PINS, AND WHY IT IS ANCHORED THE WAY IT IS.
//
// Three ORDERING/SHAPE facts carry the whole change, and none of them is visible
// in any output comparison:
//
//  1. THE PIVOT IS FOLDED BEFORE IT IS DELETED. lcc_merge_entity DELETEs the
//     loser's owner_contact_pivot whenever the winner has one. Measured live on
//     `bamproperties` (P195): the winner named NOBODY and the loser carried the
//     group's only named contact. Reorder the fold after the delete and the bug
//     is silent again — no error, no ledger, in the lane that exists to clean it.
//
//  2. THE RECONCILE IS CALLED WITH SNAPSHOT ON. It used to be called with
//     `false`, which is what made every dedup DELETE unrecoverable.
//
//  3. THE UNMERGE REPOINTS SURVIVING ROWS WITH `UPDATE`, NOT `ON CONFLICT DO
//     UPDATE`. entity_relationships and external_identities carry BEFORE INSERT
//     survivor-resolving triggers (P177/P178), and P177's SKIPS a row that
//     duplicates an edge the resolved entity already holds — it returns NULL, so
//     the row never reaches the ON CONFLICT clause. The first cut of this
//     migration did exactly that and silently left 2 of 3 byte-identical Monaco
//     Holdings edges on the winner while reporting `restored`. Only the live
//     round trip caught it. This is the regression that must never come back.
//
// Anchored on FUNCTION NAMES and call-site tokens — never a line number, never a
// sliced region between banners (the block-slice footgun).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = 'supabase/migrations';
const P196 = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && f.includes('p196_merge_entity_reversible'))
  .map((f) => readFileSync(`${MIGRATIONS}/${f}`, 'utf8'))
  .join('\n');

const uncommented = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const SQL = uncommented(P196);

/** The body of one function, bounded by its own CREATE and the next one. */
const fnBody = (name) => {
  const start = SQL.indexOf(`function public.${name}(`);
  assert.ok(start > 0, `function ${name} not found in the P196 migration`);
  const rest = SQL.slice(start);
  const next = rest.slice(1).search(/create or replace (function|view)/i);
  return next > 0 ? rest.slice(0, next + 1) : rest;
};

test('the P196 migration is present and defines the ledger, helpers and reversal', () => {
  assert.ok(P196.length > 0, 'P196 unit-1 migration not found');
  for (const obj of [
    'lcc_entity_merge_log',
    'lcc_merge_snapshot_loser',
    'lcc_merge_fold_pivot',
    'lcc_merge_entity',
    'lcc_unmerge_entity',
    'v_lcc_entity_merge_reversibility',
  ]) assert.match(SQL, new RegExp(obj), `missing ${obj}`);
});

test('lcc_merge_entity snapshots, then folds, then merges — in that order', () => {
  const m = fnBody('lcc_merge_entity');
  const snap = m.indexOf('lcc_merge_snapshot_loser(p_loser');
  const fold = m.indexOf('lcc_merge_fold_pivot(p_loser');
  const del = m.indexOf('DELETE FROM public.owner_contact_pivot');
  assert.ok(snap > 0, 'lcc_merge_entity must snapshot the loser side');
  assert.ok(fold > 0, 'lcc_merge_entity must fold the pivot');
  assert.ok(del > 0, 'the pivot dedup DELETE should still be there');
  assert.ok(snap < fold, 'snapshot before anything mutates the loser');
  assert.ok(fold < del, 'fold the pivot BEFORE the dedup DELETE destroys it');
});

test('the reconcile is called with the snapshot ON', () => {
  const m = fnBody('lcc_merge_entity');
  assert.match(m, /lcc_reconcile_tombstone_backrefs\(p_loser,\s*v_winner,\s*true\)/,
    'p_snapshot must be true — false is what made every dedup DELETE unrecoverable');
  assert.doesNotMatch(m, /lcc_reconcile_tombstone_backrefs\([^)]*false\s*\)/,
    'no call site may still pass p_snapshot => false');
});

test('every P160 dedup DELETE is action-labelled in the ledger before it runs', () => {
  const m = fnBody('lcc_merge_entity');
  for (const [action, del] of [
    ['p196_po_dedup_delete', 'DELETE FROM public.lcc_property_owner'],
    ['p196_ev_dedup_delete', 'DELETE FROM public.lcc_property_owner_evidence'],
    ['p196_pivot_dedup_delete', 'DELETE FROM public.owner_contact_pivot'],
  ]) {
    const a = m.indexOf(action);
    const d = m.indexOf(del);
    assert.ok(a > 0, `missing ledger action ${action}`);
    assert.ok(a < d, `${action} must be written BEFORE ${del}`);
  }
});

test('the fold is fill-blanks and carries active_source VERBATIM', () => {
  const f = fnBody('lcc_merge_fold_pivot');
  assert.match(f, /winner_contact_kept_loser_contact_snapshotted_only/,
    'a winner that already names someone must keep them');
  // P194: the Tier 0 lane reads active_source with `<>` and `IN`. A new value there
  // silently satisfies every inequality written against the old one.
  assert.match(f, /active_source\s*=\s*coalesce\(l\.active_source,\s*active_source\)/,
    'active_source must be carried across, never restamped with a new literal');
});

test('the unmerge clears the tombstone before touching survivor-resolving tables', () => {
  const u = fnBody('lcc_unmerge_entity');
  const clear = u.indexOf('merged_into_entity_id = null');
  const rels = u.indexOf('public.entity_relationships');
  const xids = u.indexOf('public.external_identities');
  assert.ok(clear > 0 && rels > 0 && xids > 0);
  assert.ok(clear < rels && clear < xids,
    'P177/P178 resolve to the survivor at INSERT — restoring under a live tombstone is a no-op');
});

test('the unmerge repoints SURVIVING rows with UPDATE, never ON CONFLICT DO UPDATE', () => {
  const u = fnBody('lcc_unmerge_entity');
  // The exact regression the live round trip caught: P177 SKIPS a duplicate edge, so
  // the row never reaches ON CONFLICT and the DO UPDATE never runs.
  assert.doesNotMatch(u, /on conflict \(id\) do update/i,
    'a trigger-skipped INSERT never reaches ON CONFLICT — repoint with UPDATE instead');
  assert.match(u, /update public\.entity_relationships r\s*\n\s*set from_entity_id/,
    'surviving relationships must be repointed by UPDATE');
  assert.match(u, /update public\.external_identities x set entity_id/,
    'surviving identities must be repointed by UPDATE');
  // and the INSERT half must only cover rows the merge actually DELETED.
  assert.match(u, /not exists \(select 1 from public\.entity_relationships r2/,
    'only re-INSERT relationships whose id is gone');
});

test('a partial restore is reported, never passed off as clean', () => {
  const u = fnBody('lcc_unmerge_entity');
  assert.match(u, /relationships_not_restored/,
    'the unmerge must count what came back and name the shortfall');
  assert.match(u, /restored_with_residue/);
});

test('the portfolio-fact restore omits the GENERATED column', () => {
  const u = fnBody('lcc_unmerge_entity');
  const stmt = u.slice(u.indexOf('insert into public.lcc_entity_portfolio_facts'));
  const head = stmt.slice(0, stmt.indexOf('on conflict'));
  assert.doesNotMatch(head, /\bis_current\b(?!')/,
    'is_current is GENERATED ALWAYS — a bare select * restore fails 428C9');
  assert.match(head, /'is_current'/, 'strip is_current from the snapshotted jsonb');
});

test('P196 does not arm the unattended auto-merge loop', () => {
  // Making the path reversible is not a decision to run 3,053 merges unattended.
  assert.doesNotMatch(SQL, /lcc_apply_fuzzy_merges/,
    'wiring up the fuzzy auto-merge loop is a separate decision');
  assert.doesNotMatch(SQL, /cron\.schedule/,
    'P196 unit 1 schedules nothing');
});
