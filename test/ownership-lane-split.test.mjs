// A1 — the `establish_ownership_history` lane split.
//
// WHAT THIS PINS, AND WHY IT IS ANCHORED THE WAY IT IS.
//
// The classification MUST come from the structured payload — the boolean
// `terminates_at_current_owner` and the enum-valued `insufficient_reason` —
// never from the drafter's `reason` prose. Measured 2026-08-27 the prose
// detector `reason ilike '%does not match the current owner%'` agrees with the
// boolean on all 73 mismatch rows, so a test that merely compared their OUTPUT
// would pass over the broken implementation. It is wrong for two structural
// reasons instead: it is a text detector over prose the drafter generates
// (P182), and it is BLIND to the 74/18 split, which exists only in
// `insufficient_reason`.
//
// So the assertions anchor on FIELD NAMES inside the migration's view body,
// and on the exported vocabulary — never on a line number, never on a `reason`
// substring, and never on a sliced source region between banners (the
// block-slice footgun that has produced three false failures in this repo).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  OWNERSHIP_LANE_ACTIONS, OWNERSHIP_LANE_PENDING_STATES, OWNERSHIP_LANE_HUMAN_ACTIONS,
  OWNERSHIP_LANE_SPLIT_VIEW, OWNERSHIP_LANE_ACTIONS_VIEW, OWNERSHIP_LANE_TYPE,
  isOwnershipLaneAction, isOwnershipLaneBucket, ownershipLaneBucketFilter,
  fetchOwnershipLaneTaskIds, reorderByIds,
} from '../api/_shared/ownership-lane-split.js';

// A3 (2026-08-27) re-issued the WHOLE split-view body to add the `sponsor_spe`
// action. Both migrations are read, so these structural guards describe the
// CURRENT definition rather than a superseded one — a guard pinned to the older
// file would keep passing while the shipped view drifted away from it.
const MIGRATION = readdirSync('supabase/migrations')
  .filter((f) => f.includes('ownership_history_lane_split')
              || f.includes('ownership_mismatch_sponsor_family')
              // B1 (2026-08-28) re-issued the WHOLE split-view body again to add
              // the human value gate. A guard pinned to the older files keeps
              // passing while the shipped view drifts away from it (P197).
              || f.includes('b1_split_chain_value_floor')
              // PR-scanner-3 (2026-09-12) re-issued the WHOLE split-view body
              // again to add the county_records_needed reclassification.
              || f.includes('pr_scanner3_county_records_needed'))
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  .join('\n');

// The view body only — comments in this migration legitimately quote the words
// the classifier must not read, and matching them would be a false positive.
const VIEW_SQL = MIGRATION.split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');

test('the migration exists and defines both split views', () => {
  assert.ok(MIGRATION.length > 0, 'A1 migration not found in supabase/migrations');
  assert.match(VIEW_SQL, new RegExp(`create or replace view ${OWNERSHIP_LANE_SPLIT_VIEW}\\b`, 'i'));
  assert.match(VIEW_SQL, new RegExp(`create or replace view ${OWNERSHIP_LANE_ACTIONS_VIEW}\\b`, 'i'));
});

test('the classifier reads the STRUCTURED booleans, by field name', () => {
  // These two field names ARE the classifier. If either disappears the split
  // is being derived from something else.
  assert.match(VIEW_SQL, /terminates_at_current_owner/,
    'the mismatch/agrees split must read the terminates_at_current_owner boolean');
  assert.match(VIEW_SQL, /insufficient_reason/,
    'the no_records/all_guarded split must read the insufficient_reason key');
  assert.match(VIEW_SQL, /draftable/,
    'the draftable boolean gates which half of the CASE applies');
  // Both enum values, distinctly. Collapsing them is the P181 failure.
  assert.match(VIEW_SQL, /'no_transitions_on_file'/);
  assert.match(VIEW_SQL, /'all_transitions_guarded'/);
});

test('the classifier NEVER greps the reason prose', () => {
  // The specific shape that must not appear: a text match against `reason`.
  assert.doesNotMatch(VIEW_SQL, /\breason\s+(i?like|~\*?|similar to)/i,
    'the split must not pattern-match the drafter-generated reason prose (P182)');
  assert.doesNotMatch(VIEW_SQL, /does not match the current owner/i,
    'a prose literal in the classifier is the P182 trap, however well it scores today');
});

test('it LEFT JOINs, so an undrafted task is visible rather than dropped', () => {
  assert.match(VIEW_SQL, /left join/i,
    'an INNER JOIN would silently drop a task the drafter has not reached yet');
  // And such a row is named, not folded into a bucket it does not belong to.
  assert.match(VIEW_SQL, /'awaiting_draft'/);
  assert.match(VIEW_SQL, /'unrecognised_payload'/);
});

test('exactly six actions, and awaiting/unrecognised are NOT among them', () => {
  // A3 added `sponsor_spe`; PR-scanner-3 added `county_records_needed`. Both
  // are ACTIONS (a bucket the operator can filter to and the rollup counts),
  // never a pending state.
  assert.deepEqual([...OWNERSHIP_LANE_ACTIONS].sort(),
    ['agrees', 'all_guarded', 'county_records_needed', 'mismatch', 'no_records', 'sponsor_spe']);
  for (const p of OWNERSHIP_LANE_PENDING_STATES) {
    assert.equal(isOwnershipLaneAction(p), false, `${p} is a split_state, not an action`);
    assert.equal(isOwnershipLaneBucket(p), true, `${p} must still be selectable/countable`);
  }
});

test('no_records and all_guarded are distinct buckets (P181)', () => {
  // "Nothing is recorded" and "we distrust everything recorded" call for
  // different actions: A4 auto-retires the first, A4b adjudicates the second.
  assert.notEqual(
    ownershipLaneBucketFilter('no_records'),
    ownershipLaneBucketFilter('all_guarded'),
  );
});

test('mismatch + all_guarded + county_records_needed count as human work', () => {
  assert.deepEqual([...OWNERSHIP_LANE_HUMAN_ACTIONS].sort(),
    ['all_guarded', 'county_records_needed', 'mismatch']);
  // agrees is a confirmation (A2 applies it); no_records is unanswerable (A4
  // retires it). A badge counting either is the badge-that-is-noise failure.
  assert.equal(OWNERSHIP_LANE_HUMAN_ACTIONS.includes('agrees'), false);
  assert.equal(OWNERSHIP_LANE_HUMAN_ACTIONS.includes('no_records'), false);
  // A3: a confirmed sponsor family has been ANSWERED — counting it as human
  // work would re-ask a question a human already settled once per sponsor.
  assert.equal(OWNERSHIP_LANE_HUMAN_ACTIONS.includes('sponsor_spe'), false);
  assert.match(VIEW_SQL, /human_actionable/,
    'the view must expose the honest badge count, not leave it to the client');
});

// ---------------------------------------------------------------------------
// PR-scanner-3 — county_records_needed reclassification (structural guards on
// the migration text; the live behaviour was verified against real gov data
// 2026-09-12: 68 human_actionable mismatch/all_guarded -> 27 reclassify,
// matching the PLANNED-BACKLOG figure exactly).
// ---------------------------------------------------------------------------

test('county_records_needed reclassifies ONLY mismatch/all_guarded, never agrees/sponsor_spe/no_records', () => {
  assert.match(VIEW_SQL, /county_records_needed/,
    'the view must define the reclassification action');
  // The reclassification's own guard must be scoped by an IN-list naming
  // exactly the two disputed-chain actions.
  assert.match(VIEW_SQL, /base_action\s+IN\s*\(\s*'mismatch'\s*,\s*'all_guarded'\s*\)/i,
    'county_records_needed must be scoped to mismatch/all_guarded only');
});

test('the reclassification requires a POSITIVE no-record signal, never an absence (unsynced != no record)', () => {
  // `IS FALSE` (never `= false`) is the whole point: a NULL from the LEFT
  // JOIN (property not yet synced into the coverage mirror) must leave the
  // base action alone, never guess it into county_records_needed.
  assert.match(VIEW_SQL, /has_trustworthy_record\s+IS\s+FALSE/i,
    'the coverage check must use IS FALSE so an unsynced (NULL) row is left alone');
  assert.doesNotMatch(VIEW_SQL, /has_trustworthy_record\s*=\s*false/i,
    '`= false` would also be false for NULL in some contexts — IS FALSE is the safe form');
});

test('the reclassification is gov-only, by construction', () => {
  assert.match(VIEW_SQL, /c\.domain\s*=\s*'gov'/,
    'county_records_needed must be scoped to domain=gov (the lane itself is gov-only, per B1)');
});

test('no_records is never touched by the reclassification — it stays A4-retired, distinct from county_records_needed', () => {
  // The CASE that produces county_records_needed only ever fires on
  // base_action IN ('mismatch','all_guarded') — no_records/agrees/sponsor_spe
  // pass through unchanged. Regression check against A4's retirement: the
  // literal 'no_records' must never appear inside the county_records_needed
  // CASE's own condition.
  const reclassBlock = VIEW_SQL.match(/CASE\s+WHEN\s+c\.base_action[\s\S]{0,300}?END AS action/i);
  assert.ok(reclassBlock, 'could not locate the action-reclassification CASE');
  assert.doesNotMatch(reclassBlock[0], /'no_records'/,
    'no_records must never be reachable from the county_records_needed reclassification');
});

test('a pending bucket filters on action IS NULL *and* the split_state', () => {
  const f = ownershipLaneBucketFilter('awaiting_draft');
  assert.match(f, /action=is\.null/);
  assert.match(f, /split_state=eq\.awaiting_draft/);
  assert.equal(ownershipLaneBucketFilter('nonsense'), null);
  assert.equal(ownershipLaneBucketFilter(''), null);
});

test('an action bucket pages the VIEW server-side with an exact count', async () => {
  // A client-side chip filter over the visible page reports a reach it does
  // not have — the P139 "6 of 65" failure. Assert the query really is paged
  // and really asks for count=exact.
  let seenPath = null; let seenOpts = null;
  const stub = async (method, path, _body, opts) => {
    seenPath = path; seenOpts = opts;
    return { ok: true, status: 200, count: 73, data: [{ research_task_id: 'b' }, { research_task_id: 'a' }] };
  };
  const r = await fetchOwnershipLaneTaskIds(stub, { bucket: 'mismatch', limit: 25, offset: 50 });
  assert.equal(r.ok, true);
  assert.equal(seenOpts.countMode, 'exact', 'the chip count must be the whole bucket, not the page');
  assert.match(seenPath, new RegExp(`^${OWNERSHIP_LANE_SPLIT_VIEW}\\?`));
  assert.match(seenPath, /action=eq\.mismatch/);
  assert.match(seenPath, /limit=25/);
  assert.match(seenPath, /offset=50/);
  assert.equal(r.count, 73, 'count is the bucket universe, not items.length');
  assert.deepEqual(r.ids, ['b', 'a']);
});

test('an unknown bucket is refused, never silently unfiltered', async () => {
  const stub = async () => { throw new Error('must not query'); };
  const r = await fetchOwnershipLaneTaskIds(stub, { bucket: 'everything' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('a failed split read surfaces the DB message rather than a generic string', async () => {
  const stub = async () => ({ ok: false, status: 400, data: { message: 'PGRST100 boom' } });
  const r = await fetchOwnershipLaneTaskIds(stub, { bucket: 'mismatch' });
  assert.equal(r.ok, false);
  assert.match(r.error, /PGRST100 boom/);
});

test('hydrated rows are restored to the view ordering', () => {
  const ids = ['x', 'y', 'z'];
  const shuffled = [{ id: 'z' }, { id: 'x' }, { id: 'y' }];
  assert.deepEqual(reorderByIds(shuffled, ids).map((r) => r.id), ids);
});

// ---------------------------------------------------------------------------
// Wiring: both research branches must honour lane_action.
//
// V2_MAP rewrites /api/queue?view=research to the v2 handler the moment
// queue_v2_enabled flips. A filter implemented in only one branch would stop
// filtering with no error — serving the WHOLE 545-row lane under a chip that
// reads "mismatch 73".
// ---------------------------------------------------------------------------
const QUEUE = readFileSync('api/queue.js', 'utf8');

test('both v1 and v2 research branches read lane_action', () => {
  const hits = QUEUE.match(/req\.query\.lane_action/g) || [];
  assert.ok(hits.length >= 2,
    `lane_action must be handled in BOTH research branches (found ${hits.length}); `
    + 'V2_MAP reroutes this endpoint when queue_v2_enabled flips');
  // And both go through the shared selector rather than re-deriving the filter.
  const calls = QUEUE.match(/fetchOwnershipLaneTaskIds\s*\(/g) || [];
  assert.ok(calls.length >= 2, 'both branches must use the one shared selector');
});

test('neither the API nor the client re-derives the action', () => {
  const CLIENT = readFileSync('ops.js', 'utf8');
  for (const [name, src] of [['api/queue.js', QUEUE], ['ops.js', CLIENT]]) {
    assert.doesNotMatch(src, /does not match the current owner/i,
      `${name} must not classify from the drafter's reason prose`);
  }
  // The client renders a label for an action the server already decided; it
  // must not compute one from the payload.
  const CLIENT2 = readFileSync('ops.js', 'utf8');
  assert.doesNotMatch(CLIENT2,
    /lane_?action\s*=\s*[^;\n]*terminates_at_current_owner/,
    'the client must not derive the lane action — the SQL view owns that CASE');
});

test('the lane type is the one this split is about', () => {
  assert.equal(OWNERSHIP_LANE_TYPE, 'establish_ownership_history');
  assert.match(VIEW_SQL, /'establish_ownership_history'/);
});
