// A2a — merging the duplicate entities that block the `ambiguous_entity`
// ownership chains.
//
// WHAT THIS PINS, AND WHY.
//
// The whole change is a set of GATES on a write that asserts who owned a
// building. Every one of them was measured on the live population before it
// shipped, and each has a specific way of silently disappearing:
//
//  1. IT IS NOT A SECOND MERGE IMPLEMENTATION. Every write must go through
//     P196's `lcc_merge_entity` and every reversal through
//     `lcc_unmerge_entity`. A hand-rolled UPDATE ... SET merged_into_entity_id
//     would pass any output comparison and lose the snapshot, the pivot fold and
//     the reversal in one move — which is exactly the state P195 had to work
//     around.
//
//  2. THE BANNED IDENTITY COMPARATORS STAY BANNED. `lcc_owner_strict_core`
//     collapses `BAMMF (8) LLC` onto `BAMMF (3) LLC` (A2 measured it on this
//     exact population) and `lcc_normalize_entity_name` returns NULL for
//     acronym firms and strips `group|partners|capital` (P189). Either one used
//     as the grouping or gate key here would merge different parties.
//
//  3. THE PERSON GATE READS `entity_type`, NOT `lcc_looks_like_person`. Over
//     these 43 names that regex returns TRUE for CANO FAMCO, Hokanson
//     Companies, HORAK DEVELOPMENT IV L.P., Matan Companies, Precor Ruffin and
//     USAA Real Estate — six organisations. It is the documented
//     two-capitalised-tokens false positive (A3, P196). Swapping the recorded
//     type for the regex would hold six real groups and read as "more careful".
//
//  4. THE HOLD REASONS ARE CLASSIFIED IN SQL, ONCE. A JS mirror of a SQL
//     classifier is the normaliser drift this repo warns about repeatedly
//     (A1 §"The SQL `action` CASE is the SINGLE owner").
//
// Anchored on object names, function-call tokens and quoted enum literals —
// never a line number and never a region sliced between banner comments
// (the block-slice footgun). `--` comment lines are stripped first, because
// this migration's header deliberately names the things the code must NOT do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = 'supabase/migrations';
const RAW = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && f.includes('a2a_merge_ambiguous_chain_entities'))
  .map((f) => readFileSync(`${MIGRATIONS}/${f}`, 'utf8'))
  .join('\n');

const uncommented = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const SQL = uncommented(RAW);

/** The body of one object, bounded by its own CREATE and the next CREATE. */
const objBody = (kind, name) => {
  const start = SQL.indexOf(`${kind} public.${name}`);
  assert.ok(start > 0, `${kind} ${name} not found in the A2a migration`);
  const rest = SQL.slice(start);
  const next = rest.slice(1).search(/create (or replace )?(function|view|table)/i);
  return next > 0 ? rest.slice(0, next + 1) : rest;
};

test('the A2a migration exists and defines the plan, the hold watch, the ledger and both drivers', () => {
  assert.ok(RAW.length > 0, 'A2a migration not found');
  for (const obj of [
    'v_lcc_a2a_ambiguity_merge_plan',
    'v_lcc_a2a_ambiguity_hold_watch',
    'lcc_a2a_merge_log',
    'lcc_a2a_merge_ambiguous_chain_entities',
    'lcc_a2a_unmerge',
  ]) assert.match(SQL, new RegExp(obj), `missing ${obj}`);
});

test('every merge goes through lcc_merge_entity — A2a never writes merged_into_entity_id itself', () => {
  const driver = objBody('create or replace function', 'lcc_a2a_merge_ambiguous_chain_entities');
  assert.match(driver, /public\.lcc_merge_entity\(/,
    'the driver must call lcc_merge_entity — a second merge implementation loses the P196 snapshot, the pivot fold and the reversal');
  assert.doesNotMatch(SQL, /merged_into_entity_id\s*=\s*[^ ]*winner/i,
    'A2a must never set merged_into_entity_id itself');
  assert.doesNotMatch(SQL, /lcc_reconcile_tombstone_backrefs|lcc_merge_snapshot_loser|lcc_merge_fold_pivot/,
    'A2a must not re-invoke the merge internals directly — lcc_merge_entity owns that sequence');
});

test('every reversal goes through lcc_unmerge_entity — no bespoke restore', () => {
  const rev = objBody('create or replace function', 'lcc_a2a_unmerge');
  assert.match(rev, /public\.lcc_unmerge_entity\(/,
    'the reversal must call lcc_unmerge_entity; a hand-rolled restore re-opens the P177 trigger trap');
  assert.doesNotMatch(rev, /insert\s+into\s+public\.(entity_relationships|external_identities|lcc_entity_portfolio_facts)/i,
    'the reversal must not re-insert backref rows itself');
});

test('the banned identity comparators are not used anywhere in A2a', () => {
  for (const banned of ['lcc_owner_strict_core', 'lcc_normalize_entity_name', 'nameSimilarity', 'ownerCore']) {
    assert.doesNotMatch(SQL, new RegExp(banned),
      `${banned} is banned for identity — A2 and P189 measured it merging different parties`);
  }
  assert.match(SQL, /lcc_ownership_chain_name_key\(/,
    'the grouping key must remain lcc_ownership_chain_name_key, the comparator A2 already uses');
});

test('the case-only gate compares lower(name), not a stripped or sorted core', () => {
  const plan = objBody('create or replace view', 'v_lcc_a2a_ambiguity_merge_plan');
  assert.match(plan, /count\(distinct lower\(m\.name\)\)\s*=\s*1/,
    'g_case_only must be `count(distinct lower(name)) = 1` — byte-identical-after-case is the safe core (P195)');
});

test('the person gate reads the recorded entity_type, never lcc_looks_like_person', () => {
  const plan = objBody('create or replace view', 'v_lcc_a2a_ambiguity_merge_plan');
  assert.match(plan, /count\(\*\) filter \(where m\.entity_type = 'person'\) = 0/,
    'g_all_organization must gate on the recorded entity_type');
  assert.doesNotMatch(SQL, /lcc_looks_like_person/,
    'lcc_looks_like_person returns TRUE for CANO FAMCO / Hokanson Companies / USAA Real Estate — six organisations in this very population');
});

test('the rival-identity gate requires DIFFERENT external_ids on the same (system, type)', () => {
  const plan = objBody('create or replace view', 'v_lcc_a2a_ambiguity_merge_plan');
  assert.match(plan, /count\(distinct x\.external_id\)\s*>\s*1/,
    'two members sharing one identity value is corroboration; only DIFFERING values are a conflict');
  assert.match(plan, /count\(distinct m\.entity_id\)\s*>\s*1/,
    'the conflict must span more than one member — two Salesforce Accounts on ONE entity is not a rival identity');
});

test('the winner rule is P195 ownership-first, in that order', () => {
  const plan = objBody('create or replace view', 'v_lcc_a2a_ambiguity_merge_plan');
  const order = plan.slice(plan.indexOf('row_number() over ('));
  const seq = ['owns_assets desc', 'current_rent desc', 'portfolio_facts desc',
    'external_ids desc', 'relationships desc'];
  let at = -1;
  for (const term of seq) {
    const i = order.indexOf(term);
    assert.ok(i > at, `winner rule must rank by ${term} after the preceding term — ownership-first, never rent-first`);
    at = i;
  }
  assert.doesNotMatch(order, /pivots desc/,
    'the winner rule must NOT promote the pivot-bearing member: lcc_merge_fold_pivot preserves the contact regardless of who wins');
});

test('verdict is decided by one SQL CASE and the hold reasons are named, not lumped', () => {
  const plan = objBody('create or replace view', 'v_lcc_a2a_ambiguity_merge_plan');
  for (const reason of [
    "'held:placeholder_or_brokerage_name'",
    "'held:generic_name_no_distinctive_token'",
    "'held:name_variant_beyond_case'",
    "'held:person_typed_member'",
    "'held:rival_identity_same_system'",
    "'merge'",
  ]) assert.ok(plan.includes(reason), `the verdict CASE must emit ${reason}`);

  // one owner: the driver reads the verdict, it never re-derives the gates.
  const driver = objBody('create or replace function', 'lcc_a2a_merge_ambiguous_chain_entities');
  assert.match(driver, /p\.verdict = 'merge'/,
    'the driver must select on the verdict the view decided');
  assert.doesNotMatch(driver, /lower\(.*name.*\)|entity_type\s*=\s*'person'/,
    're-deriving a gate in the driver is the JS-mirror-of-a-SQL-classifier drift (A1)');
});

test('the driver is dry-run by default and snapshots its write set before mutating', () => {
  const driver = objBody('create or replace function', 'lcc_a2a_merge_ambiguous_chain_entities');
  assert.match(driver, /p_dry_run\s+boolean\s+default\s+true/,
    'dry-run must be the default');
  const snapshotAt = driver.search(/into\s+v_set/);
  const mergeAt = driver.indexOf('public.lcc_merge_entity(');
  assert.ok(snapshotAt > 0 && snapshotAt < mergeAt,
    'the write set must be read BEFORE the first merge — the plan view is derived from the live lane, so merging changes what it returns');
  // ...and the loop must iterate that SNAPSHOT, not re-read the view: a cursor
  // over the plan while merging is a cursor over a moving target.
  assert.match(driver, /for v_elem in select value from jsonb_array_elements\(v_set\) loop/,
    'the merge loop must iterate the snapshotted write set, never the live plan view');
});

test('the driver re-verifies liveness at execution time rather than trusting the snapshot', () => {
  const driver = objBody('create or replace function', 'lcc_a2a_merge_ambiguous_chain_entities');
  assert.match(driver, /merged_into_entity_id is null[\s\S]*?then\s*\n\s*continue;/,
    'a member merged by another path since the plan was read must be skipped, not merged again');
});

test('the batch is reversible as a unit and the ledger cannot lose a loser', () => {
  assert.match(SQL, /uq_lcc_a2a_merge_log_open[\s\S]*?where unmerged_at is null/,
    'one open ledger row per loser, so a double merge cannot orphan a reversal');
  const rev = objBody('create or replace function', 'lcc_a2a_unmerge');
  assert.match(rev, /order by id desc/,
    'a 3-member group must unwind newest-first, the reverse of the order it was built');
  assert.match(rev, /unmerge_note/,
    'the per-row note must be recorded — `restored_with_residue:` is a partial restore, not a clean one');
});

test('nothing here schedules an unattended merge sweep', () => {
  assert.doesNotMatch(SQL, /cron\.schedule/,
    'P196 deliberately left lcc_apply_fuzzy_merges unwired at auto_mergeable = 3,053; reversibility lowers the cost of being wrong, it does not replace the grading');
});
