// P120 — Move-Queue Executor. Handler tests over injected deps (no live DB / AI).
//
// The TERMINAL-ERROR decision itself is pure SQL (lcc_mailbox_mirror_error_is_terminal,
// reused verbatim from P119) and the queue gate is the view v_lcc_move_queue_worklist;
// both are verified live via a self-rolling-back synthetic fixture (see the PR
// description). These JS tests guard the HTTP surface: flag gate, query shaping,
// batch ack mapping, honest counters, and the no-JS-classifier invariant.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handleMoveQueueWorklist, handleMoveQueueAck } from '../api/_handlers/move-queue.js';

const root = dirname(fileURLToPath(import.meta.url));

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const okUser = { id: 'U1', memberships: [{ workspace_id: 'WS1' }] };
const authOk = async () => okUser;

describe('move queue — flag gate', () => {
  it('worklist returns skipped:flag_off when MOVE_QUEUE_EXECUTOR unset', async () => {
    delete process.env.MOVE_QUEUE_EXECUTOR;
    const res = mockRes();
    await handleMoveQueueWorklist({ method: 'GET', headers: {}, query: {} }, res, { authenticate: authOk });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.skipped, 'flag_off');
  });

  it('ack returns skipped:flag_off when disabled', async () => {
    delete process.env.MOVE_QUEUE_EXECUTOR;
    const res = mockRes();
    await handleMoveQueueAck({ method: 'POST', headers: {}, query: {}, body: {} }, res, { authenticate: authOk });
    assert.equal(res.body.skipped, 'flag_off');
  });

  it('?force=1 bypasses the flag for a dry-run read', async () => {
    delete process.env.MOVE_QUEUE_EXECUTOR;
    const res = mockRes();
    const opsQuery = async () => ({ ok: true, data: [] });
    await handleMoveQueueWorklist({ method: 'GET', headers: {}, query: { force: '1' } }, res,
      { authenticate: authOk, opsQuery });
    assert.equal(res.body.skipped, undefined);
    assert.equal(res.body.ok, true);
  });
});

describe('move queue — worklist shaping', () => {
  it('reads the canonical view FIFO, workspace-scoped, capped', async () => {
    process.env.MOVE_QUEUE_EXECUTOR = 'true';
    let seenPath = null;
    const opsQuery = async (_m, path) => { seenPath = path; return { ok: true, data: [] }; };
    const res = mockRes();
    await handleMoveQueueWorklist(
      { method: 'GET', headers: { 'x-lcc-workspace': 'WS9' }, query: { limit: '5' } },
      res, { authenticate: authOk, opsQuery });
    assert.match(seenPath, /^v_lcc_move_queue_worklist\?/);
    assert.match(seenPath, /order=created_at\.asc/);   // FIFO — oldest first
    assert.match(seenPath, /limit=5/);
    assert.match(seenPath, /workspace_id=eq\.WS9/);
    assert.match(seenPath, /clear_flag/);              // the mover needs the flag lever
  });

  it('caps limit at MAX_LIMIT and floors a bad limit to the default', async () => {
    process.env.MOVE_QUEUE_EXECUTOR = 'true';
    let seenPath = null;
    const opsQuery = async (_m, p) => { seenPath = p; return { ok: true, data: [] }; };
    await handleMoveQueueWorklist({ method: 'GET', headers: {}, query: { limit: '9999' } },
      mockRes(), { authenticate: authOk, opsQuery });
    assert.match(seenPath, /limit=200/);
    await handleMoveQueueWorklist({ method: 'GET', headers: {}, query: { limit: 'abc' } },
      mockRes(), { authenticate: authOk, opsQuery });
    assert.match(seenPath, /limit=25/);
  });

  it('surfaces a query failure honestly (never a false empty queue)', async () => {
    process.env.MOVE_QUEUE_EXECUTOR = 'true';
    const opsQuery = async () => ({ ok: false, status: 500, data: { message: 'boom' } });
    const res = mockRes();
    await handleMoveQueueWorklist({ method: 'GET', headers: {}, query: {} }, res,
      { authenticate: authOk, opsQuery });
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'worklist_query_failed');
  });
});

describe('move queue — ack mapping', () => {
  it('forwards the mover error VERBATIM (the SQL fn is the only classifier)', async () => {
    process.env.MOVE_QUEUE_EXECUTOR = 'true';
    let payload = null;
    const opsQuery = async (_m, _p, b) => {
      payload = b;
      return { ok: true, data: { ok: true, move_outcome: 'already_out', terminal: true } };
    };
    const res = mockRes();
    await handleMoveQueueAck({
      method: 'POST', headers: {}, query: {},
      body: { internet_message_id: '<a@b>', moved: false, error: 'ErrorItemNotFound' },
    }, res, { authenticate: authOk, opsQuery });
    assert.equal(payload.p_error, 'ErrorItemNotFound');   // untouched, not pre-judged
    assert.equal(payload.p_moved, false);
    assert.equal(payload.p_internet_message_id, '<a@b>');
  });

  it('coerces PA string booleans for moved', async () => {
    process.env.MOVE_QUEUE_EXECUTOR = 'true';
    let payload = null;
    const opsQuery = async (_m, _p, b) => { payload = b; return { ok: true, data: { ok: true, move_outcome: 'moved' } }; };
    await handleMoveQueueAck({
      method: 'POST', headers: {}, query: {},
      body: { internet_message_id: '<a@b>', moved: 'true', target_folder: 'Processed/Deals' },
    }, mockRes(), { authenticate: authOk, opsQuery });
    assert.equal(payload.p_moved, true);
    assert.equal(payload.p_error, null);                  // a success carries no error
    assert.equal(payload.p_target_folder, 'Processed/Deals');
  });

  it('rejects an ack with no message key', async () => {
    process.env.MOVE_QUEUE_EXECUTOR = 'true';
    const res = mockRes();
    await handleMoveQueueAck({ method: 'POST', headers: {}, query: {}, body: { moved: true } },
      res, { authenticate: authOk, opsQuery: async () => ({ ok: true, data: {} }) });
    assert.equal(res.body.counts.failed_ack, 1);
    assert.equal(res.body.moves_performed, 0);
  });

  it('accepts a batch and reports HONEST counts — moves_performed excludes already_out', async () => {
    process.env.MOVE_QUEUE_EXECUTOR = 'true';
    const byId = {
      '<m1>': { ok: true, move_outcome: 'moved' },
      '<m2>': { ok: true, move_outcome: 'already_out', terminal: true },
      '<m3>': { ok: true, move_outcome: null, parked: false },       // retrying
      '<m4>': { ok: true, move_outcome: 'failed', parked: true },
      '<m5>': { ok: true, already_done: true, move_status: 'moved' },
    };
    const opsQuery = async (_m, _p, b) => ({ ok: true, data: byId[b.p_internet_message_id] });
    const res = mockRes();
    await handleMoveQueueAck({
      method: 'POST', headers: {}, query: {},
      body: {
        items: [
          { internet_message_id: '<m1>', moved: true },
          { internet_message_id: '<m2>', moved: false, error: 'not_found_or_not_in_source_folder' },
          { internet_message_id: '<m3>', moved: false, error: 'ErrorFolderNotFound' },
          { internet_message_id: '<m4>', moved: false, error: 'ErrorFolderNotFound' },
          { internet_message_id: '<m5>', moved: true },
        ],
      },
    }, res, { authenticate: authOk, opsQuery });

    assert.equal(res.body.acked, 5);
    // The whole point: the move-DELTA is 1, even though 3 rows left the queue.
    assert.equal(res.body.moves_performed, 1);
    assert.deepEqual(res.body.counts, {
      moved: 1, already_out: 1, retrying: 1, parked: 1, already_done: 1, failed_ack: 0,
    });
  });
});

describe('move queue — invariants', () => {
  it('contains NO JS copy of the terminal-error classifier (single SQL owner)', () => {
    const src = readFileSync(join(root, '..', 'api', '_handlers', 'move-queue.js'), 'utf8');
    // The handler may NAME the SQL function in prose, but must never implement a
    // regex/allowlist that decides terminality itself.
    assert.ok(!/not_?_?found[^\n]*=~|isTerminal\s*\(|TERMINAL_ERRORS|\/.*notfound.*\/i/i.test(src),
      'move-queue.js must not classify mover errors in JS — that is lcc_mailbox_mirror_error_is_terminal()');
  });

  it('imports no AI seam (deterministic path, no LLM)', () => {
    const src = readFileSync(join(root, '..', 'api', '_handlers', 'move-queue.js'), 'utf8');
    assert.ok(!/_shared\/ai\.js|invokeExtractionAI|invokeChatProvider/.test(src));
  });

  it('rejects non-GET on the worklist and non-POST on the ack', async () => {
    process.env.MOVE_QUEUE_EXECUTOR = 'true';
    const r1 = mockRes();
    await handleMoveQueueWorklist({ method: 'POST', headers: {}, query: {} }, r1, { authenticate: authOk });
    assert.equal(r1.statusCode, 405);
    const r2 = mockRes();
    await handleMoveQueueAck({ method: 'GET', headers: {}, query: {} }, r2, { authenticate: authOk });
    assert.equal(r2.statusCode, 405);
  });
});
