// A4 / A4b — retire the `no_records` bucket; adjudicate the `all_guarded` 18.
//
// WHAT THIS PINS, AND WHY IT IS ANCHORED THE WAY IT IS.
//
// A4 closes ONE of the split view's four actions. The two ways it could go
// silently wrong are both structural, so the assertions are structural:
//
//  1. RETIRING THE WRONG BUCKET. `no_records` and `all_guarded` wear nearly the
//     same surface wording ("no chain could be drafted") and are opposite
//     facts: the first has nothing recorded worth reading, the second has
//     recorded transfers we chose to distrust — and A4b measured that a
//     corrected guard unblocks 10 of those 18. Retiring them together would
//     discard real, recoverable ownership history with no error anywhere
//     (P181: one label, two facts).
//
//  2. A RETIRE THAT IS REALLY A DELETE. `lcc_generate_chain_research_tasks`
//     treats ONLY `status='skipped' AND outcome->>'terminal'='true'` as
//     terminal, so the retire must stamp `terminal` or it is re-minted at 05:10
//     (P176) — and having stamped it, it must own an inverse or the property is
//     excluded forever (P121).
//
// Anchors are identifiers — a function name, a column, a quoted enum, an action
// literal — never a line number and never a sliced source region between
// banners (the block-slice footgun, three false failures in this repo).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATION_FILE = readdirSync('supabase/migrations')
  .filter((f) => f.includes('a4_retire_no_records'));

const RAW = MIGRATION_FILE
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');

// Code only. This migration's header deliberately NAMES the things the code
// must not do ("never reads insufficient_reason", "all_guarded is different"),
// so matching the comments would be a guaranteed false positive — the same
// reason the A1 and A2 guards strip them.
const SQL = RAW.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const TICK = readFileSync('api/_handlers/ownership-chain-draft-tick.js', 'utf8');

test('A4 migration exists and is the single retire path', () => {
  assert.equal(MIGRATION_FILE.length, 1,
    'exactly one A4 retire migration — a second copy is the drift this repo keeps warning about');
  assert.match(SQL, /create or replace function public\.lcc_a4_retire_no_records/);
});

// -- 1. It reads the split view's `action`, not the prose, not the raw reason --

test('the retire selects on action = no_records from the split view', () => {
  assert.match(SQL, /v_lcc_ownership_history_lane_split/,
    'the split view is the single owner of the classification (A1)');
  assert.match(SQL, /s\.action\s*=\s*'no_records'/,
    "must select on action='no_records'");
});

test('the retire never classifies from prose or from insufficient_reason directly', () => {
  assert.doesNotMatch(SQL, /ilike/i,
    'a text detector over drafter-generated prose is the A1/P182 defect');
  assert.doesNotMatch(SQL, /insufficient_reason\s*=/,
    're-deriving the bucket outside the view is the normaliser drift this repo warns about');
});

// -- 2. It must never touch the other three actions --

test('the retire touches no other bucket', () => {
  for (const other of ['agrees', 'mismatch', 'all_guarded', 'sponsor_spe']) {
    assert.doesNotMatch(SQL, new RegExp(`action\\s*=\\s*'${other}'`),
      `A4 must never select action='${other}' — A2/A3/A4b own those buckets`);
  }
});

test('all_guarded is never folded into the retire', () => {
  assert.doesNotMatch(SQL, /all_transitions_guarded/,
    'the 18 all_guarded properties HAVE recorded transfers; 10 of 18 are '
    + 'recoverable by a corrected guard (A4b) and must not be retired');
});

// -- 3. terminal is load-bearing: without it cron 144 re-mints tonight --

test('the retire stamps outcome.terminal — the seeder’s only terminal test', () => {
  assert.match(SQL, /'terminal'\s*,\s*'true'/,
    "lcc_generate_chain_research_tasks excludes only skipped+outcome->>'terminal'='true'; "
    + 'a bare skipped is re-minted at 05:10 (P176)');
  assert.match(SQL, /status\s*=\s*'skipped'/);
});

// -- 4. having stamped terminal, it must own the inverse (P121) --

test('the retire ships an inverse that clears terminal', () => {
  assert.match(SQL, /create or replace function public\.lcc_a4_reopen_tasks/,
    'a terminal stamp with no re-open path is a delete, not a retire');
  assert.match(SQL, /-\s*'terminal'/,
    'the re-open must strip the terminal key, or the seeder still excludes the property');
  assert.match(SQL, /status\s*=\s*'queued'/,
    'the re-open must return the task to the open lane, not merely un-flag it');
});

test('the retire is reversible by batch tag and ledgers the prior outcome', () => {
  assert.match(SQL, /create or replace function public\.lcc_a4_unretire/);
  assert.match(SQL, /prior_outcome/,
    'restoring from the whole prior jsonb, not guessing what was there');
  assert.match(SQL, /lcc_a4_retire_log/);
});

test('the retire counts from the write, never from the ledger join', () => {
  // A2 defect 2: a count taken off a join back to the plan over-reported by 18
  // while `on conflict do nothing` silently dropped the difference.
  assert.match(SQL, /returning 1/);
  assert.match(SQL, /tasks_retired/);
  assert.doesNotMatch(SQL, /tasks_scanned/,
    'a scan tally reads exactly like throughput (P159a)');
});

test('the retire is dry-run by default', () => {
  assert.match(SQL, /p_dry_run\s+boolean\s+default\s+true/);
});

test('two calls in one transaction cannot collide on the temp table', () => {
  // Found by the live round trip, not by any dry run: `on commit drop` drops at
  // COMMIT, so a caller sweeping gov and dia in one transaction hit 42P07.
  for (const tmp of ['_a4_plan', '_a4_reopen']) {
    assert.match(SQL, new RegExp(`drop table if exists ${tmp};`),
      `${tmp} must be dropped defensively before create`);
  }
});

// -- 5. the sensor: the re-open eye lives in the drafter, and must not loop --

test('the re-open sensor reuses the drafter’s own gov reader', () => {
  assert.match(TICK, /runA4ReopenPass/);
  assert.match(TICK, /rpc\/lcc_a4_reopen_tasks/);
  // LCC Opps holds no mirror of gov.ownership_history, so the tick is the only
  // possible eye — and it must not grow a SECOND gov fetcher beside the one the
  // drafts are built from.
  assert.match(TICK, /fetchTransitionsFor\(domain, propertyIds\)/,
    'the re-open pass must call the existing transitions reader');
  // Count only in CODE: the file's header and the a4 banner legitimately name
  // the view in prose, and matching those is the block-slice false positive.
  const tickCode = TICK.split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('+ \''))
    .join('\n');
  const fetchers = (tickCode.match(/`v_ownership_transitions_portfolio\?select=/g) || []).length;
  assert.equal(fetchers, 1,
    'exactly one gov transitions fetch path in the tick — a second copy drifts '
    + 'from the one the drafts are built on');
});

test('a re-open supersedes the stale draft, or it re-retires the same night', () => {
  // `fresh` excludes any task whose subject_ref already carries a proposal, and
  // a retired task still carries the `no_records` draft that got it retired. So
  // without this the re-opened task is never re-drafted, stays classified
  // no_records, and the 06:51 retire closes it again — a silent loop that reads
  // exactly like a working re-open.
  // Anchored on the EFFECT (a PATCH of the drafter's own proposal source to
  // 'superseded') and on the call being wired into the re-open pass with the
  // landed properties — not on a helper's name, which a rename walks straight
  // through.
  assert.match(TICK, /lcc_clean_assist_proposals\?source=eq\.\$\{OCD\.OCD_SOURCE\}/,
    'the supersede must target the drafter’s own proposals');
  assert.match(TICK, /\{ status: 'superseded' \}/,
    "the stale draft must be moved off 'proposed', or `fresh` still skips the task");
  assert.match(TICK, /out\.drafts_superseded \+= await supersedeStaleDrafts\(\s*landed\.map/,
    'the supersede must be called from the re-open pass with the landed properties');
});

test('a failed gov fetch never reads as "records landed"', () => {
  assert.match(TICK, /\(byProp\.get\(id\) \|\| \[\]\)\.length > 0/,
    're-open must be gated on the view actually returning a transition; an empty '
    + 'or failed fetch must re-open nothing');
});

test('the re-open pass runs before the open-lane read', () => {
  const reopenAt = TICK.indexOf('await runA4ReopenPass(');
  const laneAt = TICK.indexOf('await fetchOpenLaneRows(');
  assert.ok(reopenAt > -1 && laneAt > -1);
  assert.ok(reopenAt < laneAt,
    'a property whose records landed must be back in the lane before this run '
    + 'reads it, or it waits an extra night');
});

test('the re-open pass is reported, never silent', () => {
  assert.match(TICK, /a4_reopen: a4Reopen/,
    'a pass whose output is invisible cannot be distinguished from one that '
    + 'never ran');
});

// -- 6. A4b shipped a MEASUREMENT, not a guard change --

test('A4b loosened no guard', () => {
  const all = readdirSync('supabase/migrations')
    .filter((f) => f.includes('a4'))
    .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
    .join('\n')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const guard of ['gov_is_strong_junk_owner_name', 'gov_is_artifact_owner_name',
    'gov_owner_name_is_brokerage', 'v_ownership_transitions_portfolio']) {
    assert.doesNotMatch(all, new RegExp(`create or replace function[\\s\\S]{0,80}${guard}`),
      `A4b is a measurement: it must not redefine ${guard}. The correction is a `
      + 'sized finding for the gov repo, graded on named rows first.');
  }
});
