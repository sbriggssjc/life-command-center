// P133 — the ownership-chain drafter runs on a schedule, and the schedule is
// observable.
//
// These pin the two things that would silently rot: the cron actually POSTs the
// apply route (a GET is a dry run and would drain nothing, forever, while the
// job reported success), and the handler's run log is OPENED BEFORE THE WORK so
// a dropped run leaves a 'started' row rather than nothing at all. Both are
// asserted structurally because the live behaviour needs three databases; the
// planner's own guarantees are covered in ownership-chain-draft-planner.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url);
const migration = (needle) => {
  const f = readdirSync(MIG_DIR).find((n) => n.includes(needle));
  assert.ok(f, `migration matching ${needle} is missing`);
  return readFileSync(new URL(f, MIG_DIR), 'utf8');
};
const HANDLER = readFileSync(
  new URL('../api/_handlers/ownership-chain-draft-tick.js', import.meta.url), 'utf8');

test('the drafter is scheduled, and scheduled in APPLY mode', () => {
  const sql = migration('p133_ownership_chain_draft_cron');
  const call = sql.match(/cron\.schedule\(\s*'lcc-ownership-chain-draft'\s*,\s*'([^']+)'/);
  assert.ok(call, 'no cron.schedule for lcc-ownership-chain-draft');

  const [minute, hour, ...rest] = call[1].split(/\s+/);
  assert.match(minute, /^\d+$/, 'schedule must pin a single minute, not a range/step');
  assert.match(hour, /^\d+$/, 'schedule must pin a single hour — this is a nightly sweep');
  assert.deepEqual(rest, ['*', '*', '*'], 'must run every night, not on selected days');

  // lcc_cron_post issues an HTTP POST, which is the tick's apply mode. A GET
  // would be a dry run: green job, zero drafts, forever.
  assert.match(sql, /lcc_cron_post\('\/api\/ownership-chain-draft-tick'/,
    'must go through lcc_cron_post (Vault key -> pg_net -> Railway)');
  assert.match(sql, /"apply"\s*:\s*true/, 'cron body must request apply mode');
  assert.match(sql, /"trigger_source"\s*:\s*"cron"/,
    'cron body must identify itself so the run log can separate cron from hand runs');

  // The cron must NOT be conditioned on the feature flag: a fired-and-skipped
  // run is visible in the run log, a never-scheduled job is not.
  assert.doesNotMatch(sql, /feature_flags_registry[\s\S]{0,400}?cron\.schedule/,
    'the schedule must not be gated on the feature flag');
});

test('the run-log table exists before the writer, with the started/completed lifecycle', () => {
  const sql = migration('p133_ownership_chain_draft_run_log');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.lcc_ownership_chain_draft_run_log/);
  assert.match(sql, /status\s+text NOT NULL DEFAULT 'started'/,
    "the row is opened before the work, so its default state must be 'started'");
  assert.match(sql, /CHECK \(status IN \('started', 'completed', 'failed'\)\)/);
  for (const col of ['written_draftable', 'already_drafted', 'backlog_remaining',
    'capped', 'budget_stopped', 'lane_scan_capped', 'source_run_id']) {
    assert.ok(sql.includes(col), `run log is missing the ${col} column`);
  }
  assert.match(sql, /v_lcc_ownership_chain_draft_stalled_runs/,
    'a run that never came back must be queryable');
});

test('the handler opens the run log BEFORE the scan and closes it on every apply exit', () => {
  const open = HANDLER.indexOf('await openRunLog({');
  const scan = HANDLER.indexOf('await fetchOpenLaneRows(');
  assert.ok(open > 0 && scan > 0, 'expected both an openRunLog and a lane scan');
  assert.ok(open < scan,
    'the run-log row must be opened before the work — a row written only on the way out '
    + 'cannot record a run that died mid-flight');

  // Three apply exits: feature-flag skip, thrown failure, normal completion.
  const closes = HANDLER.match(/await closeRunLog\(/g) || [];
  assert.ok(closes.length >= 3,
    `every POST exit must close the row; found ${closes.length} closeRunLog calls`);
  assert.match(HANDLER, /status: 'failed'/, 'a thrown run must close as failed, not linger as started');
});

test('a capped run does not report itself as done', () => {
  assert.match(HANDLER, /summary\.capped = summary\.backlog_remaining > 0/,
    'capped must be derived from the undrafted remainder, not assumed false');
  assert.match(HANDLER, /NOT done: \$\{summary\.backlog_remaining\}/,
    'the response note must say work remains when the batch cap bit');
  assert.match(HANDLER, /laneScanCapped/,
    'a bounded lane scan makes backlog_remaining a floor — that must be surfaced');
});
