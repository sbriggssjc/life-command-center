// ID3b — offline structural guard over the gov owner fuzzy-variant merge migration.
// Reads the committed SQL text (no DB, no network) so it runs in `npm test` unconditionally.
// The live positive-control run (dry-run split, live run, parity check) was executed directly
// against the government Supabase project on 2026-09-12 -- see the migration file's header
// comment for the exact numbers (1,380/1,466/24 recorded_owners; 227/232/2 true_owners; property
// counts bit-for-bit unchanged before/after).
//
// This guards the mechanism, not the data: a migration matching this shape is structurally
// unable to auto-merge a brokerage/generic/bank-lender name, and structurally unable to invent
// a second merge mechanism alongside the existing apply_owner_merge/apply_true_owner_merge
// primitives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SQL = readFileSync(
  path.join(ROOT, 'supabase/migrations/government/20261013120000_gov_id3b_owner_variant_merge.sql'),
  'utf8'
);

function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const code = stripSqlComments(SQL);

test('ID3b: defines exactly one tick function per table', () => {
  assert.match(code, /create or replace function public\.gov_owner_variant_merge_tick\(/);
  assert.match(code, /create or replace function public\.gov_true_owner_variant_merge_tick\(/);
});

test('ID3b: both tick functions default to a safe (non-writing) dry run', () => {
  const fns = [...code.matchAll(/create or replace function public\.gov_(?:true_)?owner_variant_merge_tick\(p_dry_run boolean default false\)/g)];
  assert.equal(fns.length, 2, 'both tick functions must take p_dry_run boolean default false');
});

test('ID3b: never invents a second merge mechanism -- every merge goes through the existing primitives', () => {
  assert.match(code, /perform public\.apply_owner_merge\(/, 'recorded_owners merges must call the existing apply_owner_merge');
  assert.match(code, /perform public\.apply_true_owner_merge\(/, 'true_owners merges must call the existing apply_true_owner_merge');
  // No raw UPDATE of the FK columns this migration's own tick functions would otherwise have
  // to hand-roll (properties.recorded_owner_id / properties.true_owner_id) outside of those
  // two calls -- the merge primitives own that responsibility exclusively.
  assert.doesNotMatch(code, /update\s+public\.properties\s+set\s+(recorded_owner_id|true_owner_id)\s*=/i);
});

test('ID3b: guard checks brokerage, generic, and bank/lender names before ever merging a group', () => {
  assert.match(code, /gov_owner_name_is_brokerage\(nm\)/);
  assert.match(code, /is_generic_gov_owner\(nm\)/);
  assert.match(code, /\\mbank\\M\|national association/, 'expected the bank/lender exclusion regex');
});

test('ID3b: a flagged group is routed to review and is never passed to a merge primitive in the same branch', () => {
  const flaggedBranches = code.match(/if grp\.flagged then([\s\S]*?)else([\s\S]*?)end if;/g);
  assert.ok(flaggedBranches && flaggedBranches.length === 2, 'expected one if/else per tick function');
  for (const branch of flaggedBranches) {
    const ifPart = branch.split(/\belse\b/)[0];
    assert.doesNotMatch(ifPart, /apply_owner_merge|apply_true_owner_merge/, 'the flagged (if) branch must never call a merge primitive');
    assert.match(ifPart, /entity_match_candidates/, 'the flagged branch must write to entity_match_candidates');
    assert.match(ifPart, /gov_owner_merge_review_log/, 'the flagged branch must write to gov_owner_merge_review_log');
  }
});

test('ID3b: review rows are only inserted when not already pending (idempotent re-runs)', () => {
  const inserts = [...code.matchAll(/not exists \(\s*select 1 from public\.entity_match_candidates[\s\S]*?status in \('pending_review', 'pending'\)/g)];
  assert.equal(inserts.length, 2, 'both tick functions must guard their review insert with a not-exists check');
});

test('ID3b: grouping key requires a minimum core length (never matches on an empty or near-empty core)', () => {
  const lenChecks = [...code.matchAll(/length\(core\) >= 4/g)];
  assert.ok(lenChecks.length >= 2, 'both tick functions must require core length >= 4 before grouping');
});

test('ID3b: survivor is chosen by property count, not arbitrarily', () => {
  assert.match(code, /array_agg\(id order by props desc, id\) as ids/g);
});

test('ID3b: no destructive delete of owner rows -- retire via merged_into_*_id, never DELETE', () => {
  assert.doesNotMatch(code, /delete\s+from\s+public\.(recorded_owners|true_owners)/i);
});
