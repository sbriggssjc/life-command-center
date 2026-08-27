// P195 — merging the byte-identical owner groups P189 surfaced.
//
// WHAT THIS PINS, AND WHY IT IS ANCHORED THE WAY IT IS.
//
// Two invariants carry the whole pass, and both are ORDERING or SHAPE facts that
// no output comparison can see:
//
//  1. THE GATE. `v_lcc_merge_candidates_normalizer_blind` selects names that
//     reduce to NOTHING under lcc_normalize_entity_name's generic-CRE stoplist.
//     That set holds acronym-named REAL firms ("NGP Capital" -> "ngp", below the
//     4-char floor) AND pure-generic FRAGMENTS ("Capital", "Partners Group"),
//     which are failed extractions. Merging the second kind fabricates a party.
//     The gate is only meaningful while its stoplist is the SAME stoplist the
//     normalizer uses -- if the normalizer gains a word and the gate does not,
//     the gate silently stops describing the population it was measured on. So
//     the stoplist is compared token-for-token against the normalizer's own.
//
//  2. THE PIVOT FOLD RUNS BEFORE THE MERGE. lcc_merge_entity DELETES the loser's
//     owner_contact_pivot whenever the winner has one (uncorrelated EXISTS) and
//     calls the reconcile with p_snapshot => false, so the row is unrecoverable.
//     Measured live on `bamproperties`: the winner had no contact and the loser
//     carried the only named one. Reorder those two calls and the bug is silent.
//
// Anchored on FUNCTION NAMES and the stoplist token set -- never a line number,
// never a sliced region between banners (the block-slice footgun), never a
// literal that a later edit moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const readMigrations = (needle) => readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql') && f.includes(needle))
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  .join('\n');

const P195 = readMigrations('p195_merge_byte_identical');
const uncommented = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const P195_SQL = uncommented(P195);

// the stoplist alternation out of a `\m(...)\M` group
const stoplistOf = (sql) => {
  const m = sql.match(/\\m\(((?:[a-z0-9|\\.]|\s)+)\)\\M/);
  return m ? m[1].split('|').map((s) => s.trim()).sort() : null;
};

test('P195 migration is present and defines the gate, plan, driver and reversal', () => {
  assert.ok(P195.length > 0, 'p195 migration not found');
  for (const obj of [
    'lcc_p195_name_has_distinctive_residue',
    'v_lcc_p195_merge_plan',
    'lcc_p195_merge_log',
    'lcc_p195_snapshot_loser',
    'lcc_p195_fold_pivot',
    'lcc_p195_merge_byte_identical',
    'lcc_p195_unmerge',
    'v_lcc_p195_resurrection_watch',
    'lcc_p195_check_resurrection',
  ]) assert.match(P195_SQL, new RegExp(obj), `missing ${obj}`);
});

test('the gate strips exactly the normalizer stoplist, and demands a non-empty residue', () => {
  const gate = stoplistOf(P195_SQL);
  assert.ok(gate, 'gate stoplist not found');

  // the same stoplist lcc_normalize_entity_name uses. Whichever migration defines
  // that function is the authority; the gate must not drift from it.
  const normalizerSql = readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
    .filter((s) => /create\s+or\s+replace\s+function\s+public\.lcc_normalize_entity_name\s*\(\s*p_name\s+text\s*\)/i.test(s))
    .pop();
  if (normalizerSql) {
    assert.deepEqual(gate, stoplistOf(normalizerSql),
      'P195 gate stoplist has drifted from lcc_normalize_entity_name');
  }

  // the gate is emptiness of the residue, not a length floor: a 3-char acronym
  // ("ngp") must pass, which is the whole reason this population was invisible.
  assert.match(P195_SQL, /<>\s*''\s*;/, 'gate must test for a NON-EMPTY residue');
  assert.doesNotMatch(P195_SQL.slice(0, P195_SQL.indexOf('v_lcc_p195_merge_plan')),
    /length\s*\(/i, 'the gate must not re-impose a length floor');
});

test('the pivot is folded BEFORE lcc_merge_entity is called', () => {
  const fold = P195_SQL.indexOf('lcc_p195_fold_pivot(rec.loser_id');
  const snap = P195_SQL.indexOf('lcc_p195_snapshot_loser(rec.loser_id');
  const merge = P195_SQL.indexOf('lcc_merge_entity(rec.loser_id');
  assert.ok(snap > 0 && fold > 0 && merge > 0, 'driver call sites not found');
  assert.ok(snap < fold, 'the loser must be snapshotted before anything mutates it');
  assert.ok(fold < merge,
    'lcc_merge_entity deletes the loser pivot without a snapshot -- fold it first');
});

test('the fold is fill-blanks: it never overwrites a contact the winner already names', () => {
  assert.match(P195_SQL, /winner_contact_kept_loser_contact_snapshotted_only/,
    'the fold must have a branch that keeps the winner contact');
});

test('the driver never touches auto_mergeable and never calls the fuzzy auto-merge loop', () => {
  assert.doesNotMatch(P195_SQL, /auto_mergeable/,
    'auto_mergeable feeds lcc_apply_fuzzy_merges -- P195 drives merges explicitly');
  assert.doesNotMatch(P195_SQL, /lcc_apply_fuzzy_merges/);
});

test('the driver is dry-run by default', () => {
  assert.match(P195_SQL, /p_dry_run\s+boolean\s+default\s+true/i);
});

test('unmerge clears the tombstone before restoring survivor-resolving tables', () => {
  const u = P195_SQL.slice(P195_SQL.indexOf('function public.lcc_p195_unmerge'));
  const clear = u.indexOf('merged_into_entity_id = null');
  const rels = u.indexOf('insert into public.entity_relationships');
  const xids = u.indexOf('insert into public.external_identities');
  assert.ok(clear > 0 && rels > 0 && xids > 0);
  // P177/P178 resolve both endpoints to the survivor at INSERT; restoring while
  // the loser is still a tombstone sends every row straight back to the winner.
  assert.ok(clear < rels && clear < xids,
    'the tombstone must be cleared first or the unmerge is a silent no-op');
});

test('the portfolio-fact restore omits the GENERATED column', () => {
  const u = P195_SQL.slice(P195_SQL.indexOf('function public.lcc_p195_unmerge'));
  const stmt = u.slice(u.indexOf('insert into public.lcc_entity_portfolio_facts'));
  const head = stmt.slice(0, stmt.indexOf('on conflict'));
  assert.doesNotMatch(head, /\bis_current\b(?!')/,
    'is_current is GENERATED ALWAYS -- a bare select * restore fails 428C9');
  assert.match(head, /'is_current'/, "strip is_current from the snapshotted jsonb");
});

test('the Class-8 re-sweep is scheduled, not a manual chore', () => {
  assert.match(P195_SQL, /cron\.schedule\(\s*'lcc-p195-resurrection-watch'/);
  assert.match(P195_SQL, /p195_duplicate_owner_resurrection/);
});
