// ACI-phase2-unitC — reversibility + wiring guard for the bench-rank write
// path. This does NOT hit the live DB (no network in the test suite, per the
// TEST-NET-LEAK hermetic-suite doctrine) — it statically pins the ledger
// migration's shape and the module wiring (server.js -> admin.js dispatch),
// mirroring how b1-chain-value-floor-split.test.mjs and its siblings verify
// a migration's shape without applying it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIG_FILE = readdirSync('supabase/migrations')
  .find((f) => f.includes('lcc_bench_rank_run_log'));

test('the reversibility ledger migration exists and is named per the batch_tag convention used elsewhere', () => {
  assert.ok(MIG_FILE, 'expected a supabase/migrations/*_lcc_bench_rank_run_log.sql file');
});

const RAW = readFileSync(`supabase/migrations/${MIG_FILE}`, 'utf8');
// Comments stripped before matching (A5c/N18 doctrine) — the header explains
// the ledger shape at length, which would satisfy a naive grep even if the
// executable DDL were deleted.
const SQL = RAW.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('the write-log ledger carries BOTH prior_bench and new_bench (a batch reverses exactly, not just "changed")', () => {
  assert.match(SQL, /lcc_bench_rank_write_log/);
  assert.match(SQL, /prior_bench\s+jsonb/);
  assert.match(SQL, /new_bench\s+jsonb/);
  assert.match(SQL, /batch_tag/);
  assert.match(SQL, /reverted_at/);
});

test('the ledger is never hard-deleted on reversal — reverted_at marks it, no DELETE statement in the DDL', () => {
  assert.doesNotMatch(SQL, /DELETE\s+FROM\s+public\.lcc_bench_rank_write_log/i);
});

test('the migration is purely additive (CREATE TABLE IF NOT EXISTS only, no DROP/ALTER of an existing table)', () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.lcc_bench_rank_run_log/);
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.lcc_bench_rank_write_log/);
  assert.doesNotMatch(SQL, /ALTER TABLE public\.owner_contact_pivot/i);
});

test('the revert runbook is present in the file (never a migration with no way back)', () => {
  assert.match(RAW, /REVERT RUNBOOK/);
  assert.match(RAW, /DROP TABLE IF EXISTS public\.lcc_bench_rank_write_log/);
  assert.match(RAW, /DROP TABLE IF EXISTS public\.lcc_bench_rank_run_log/);
});

// --------------------------------------------------------------------------
// Wiring — server.js -> admin.js -> the handler, the exact pattern
// tier0-auto-attach-tick.js uses (test/operations-subroutes.test.mjs already
// guards the general "every mounted _route has a dispatch" invariant; this
// pins the SPECIFIC route this prompt adds).
// --------------------------------------------------------------------------
const SERVER_JS = readFileSync('server.js', 'utf8');
const ADMIN_JS = readFileSync('api/admin.js', 'utf8');

test('server.js mounts /api/bench-rank-tick and sets _route=bench-rank-tick', () => {
  assert.match(SERVER_JS, /app\.all\('\/api\/bench-rank-tick'.*_route\s*=\s*'bench-rank-tick'/);
});

test('admin.js dispatches bench-rank-tick to handleBenchRankTick, imported from _handlers', () => {
  assert.match(ADMIN_JS, /import\s*\{\s*handleBenchRankTick\s*\}\s*from\s*'\.\/_handlers\/bench-rank-tick\.js'/);
  assert.match(ADMIN_JS, /case\s+'bench-rank-tick':\s*return\s+handleBenchRankTick\(req,\s*res\)/);
});

// --------------------------------------------------------------------------
// The handler's own source: GET must be an unconditional dry run (never
// writes regardless of the flag), and every real write goes through the
// pure planners this suite otherwise tests directly — never a second,
// inline ranking implementation drifting from bench-ranking-planner.js.
// --------------------------------------------------------------------------
const HANDLER_SRC = readFileSync('api/_handlers/bench-rank-tick.js', 'utf8');
const HANDLER_NOCOMMENT = HANDLER_SRC.split('\n')
  .filter((l) => !l.trim().startsWith('//')).join('\n');

test('the handler imports rankBench/inferBenchRoles rather than re-deriving ranking logic inline', () => {
  assert.match(HANDLER_NOCOMMENT, /from\s+'\.\.\/_shared\/bench-ranking-planner\.js'/);
  assert.match(HANDLER_NOCOMMENT, /from\s+'\.\.\/_shared\/bench-role-inference-planner\.js'/);
});

test('the handler gates the value floor via cadenceSignalFloor() (cadence-engine.js), not a new threshold', () => {
  assert.match(HANDLER_NOCOMMENT, /from\s+'\.\.\/_shared\/cadence-engine\.js'/);
  assert.match(HANDLER_NOCOMMENT, /cadenceSignalFloor\(\)/);
  assert.doesNotMatch(HANDLER_NOCOMMENT, /CADENCE_SIGNAL_MIN_VALUE\s*=\s*['"]?\d/); // no re-declared literal default
});

test('the write branch is gated on dryRun===false AND flagOn (never writes on GET, never writes with the flag off)', () => {
  assert.match(HANDLER_NOCOMMENT, /if\s*\(!dryRun\s*&&\s*flagOn\)/);
});

test('a batch_tag is computed for every request, including dry runs (so a grade and a write share the same identity scheme)', () => {
  assert.match(HANDLER_NOCOMMENT, /function batchTag/);
  assert.match(HANDLER_NOCOMMENT, /'bench_rank_'/);
});

test('the ledger write happens BEFORE the pivot PATCH (reversibility precedes the effect)', () => {
  const idx = HANDLER_NOCOMMENT.indexOf('ledgerBeforeWrite(tag');
  const patchIdx = HANDLER_NOCOMMENT.indexOf("'owner_contact_pivot?entity_id=eq.'");
  assert.ok(idx >= 0, 'expected a ledgerBeforeWrite(...) call in the write branch');
  assert.ok(patchIdx >= 0, 'expected the pivot PATCH call');
  assert.ok(idx < patchIdx, 'ledger write must run before the pivot PATCH');
});
