// W7.6 — Mailbox Mirror. Handler tests over injected deps (no live DB / AI).
//
// The CLOSURE GATE itself is pure SQL (v_lcc_mailbox_reconcile_worklist) and is
// verified live via a self-rolling-back synthetic fixture (see the PR
// description): open to-dos → excluded; all to-dos terminal → included; a later
// in-thread outbound reply → included; inbox triaged (dismissed/archived) →
// included; open offer_review → withheld; ledger-moved → excluded. These JS
// tests guard the HTTP surface: flag gate, query shaping, ack mapping/validation,
// and the no-LLM invariant.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handleMailboxWorklist, handleMailboxAck } from '../api/_handlers/mailbox-reconcile.js';

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

describe('mailbox mirror — flag gate', () => {
  it('worklist returns skipped:flag_off when MAILBOX_MIRROR unset and no ?force', async () => {
    delete process.env.MAILBOX_MIRROR;
    const res = mockRes();
    await handleMailboxWorklist({ method: 'GET', headers: {}, query: {} }, res, { authenticate: authOk });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.skipped, 'flag_off');
  });

  it('ack returns skipped:flag_off when disabled', async () => {
    delete process.env.MAILBOX_MIRROR;
    const res = mockRes();
    await handleMailboxAck({ method: 'POST', headers: {}, query: {}, body: {} }, res, { authenticate: authOk });
    assert.equal(res.body.skipped, 'flag_off');
  });

  it('?force=1 bypasses the flag for a dry-run read', async () => {
    delete process.env.MAILBOX_MIRROR;
    const res = mockRes();
    const opsQuery = async () => ({ ok: true, data: [] });
    await handleMailboxWorklist({ method: 'GET', headers: {}, query: { force: '1' } }, res, { authenticate: authOk, opsQuery });
    assert.equal(res.body.skipped, undefined);
    assert.equal(res.body.ok, true);
  });
});

describe('mailbox mirror — worklist shaping', () => {
  it('reads the canonical view, oldest-closed first, workspace-scoped, capped', async () => {
    process.env.MAILBOX_MIRROR = 'true';
    let seenPath = null;
    const opsQuery = async (m, path) => {
      seenPath = path;
      return { ok: true, data: [{ internet_message_id: 'A', reason: 'inbox_triaged', closed_at: '2026-08-01', attempts: 0 }] };
    };
    const res = mockRes();
    await handleMailboxWorklist({ method: 'GET', headers: {}, query: { limit: '10' } }, res, { authenticate: authOk, opsQuery });
    assert.ok(seenPath.startsWith('v_lcc_mailbox_reconcile_worklist?'));
    assert.ok(seenPath.includes('order=closed_at.asc'));
    assert.ok(seenPath.includes('limit=10'));
    assert.ok(seenPath.includes('workspace_id=eq.WS1'));
    assert.equal(res.body.count, 1);
    assert.equal(res.body.rows[0].internet_message_id, 'A');
  });

  it('caps an over-large limit at 200', async () => {
    process.env.MAILBOX_MIRROR = 'true';
    let seenPath = null;
    const opsQuery = async (m, path) => { seenPath = path; return { ok: true, data: [] }; };
    const res = mockRes();
    await handleMailboxWorklist({ method: 'GET', headers: {}, query: { limit: '99999' } }, res, { authenticate: authOk, opsQuery });
    assert.ok(seenPath.includes('limit=200'));
  });

  it('405s a non-GET', async () => {
    process.env.MAILBOX_MIRROR = 'true';
    const res = mockRes();
    await handleMailboxWorklist({ method: 'POST', headers: {}, query: {} }, res, { authenticate: authOk });
    assert.equal(res.statusCode, 405);
  });
});

describe('mailbox mirror — ack mapping + validation', () => {
  it('requires internet_message_id', async () => {
    process.env.MAILBOX_MIRROR = 'true';
    const res = mockRes();
    await handleMailboxAck({ method: 'POST', headers: {}, query: {}, body: { moved: true } }, res, { authenticate: authOk });
    assert.equal(res.statusCode, 400);
  });

  it('maps moved:true → RPC with p_moved true and no error', async () => {
    process.env.MAILBOX_MIRROR = 'true';
    let call = null;
    const opsQuery = async (m, path, body) => { call = { path, body }; return { ok: true, data: [{ ok: true, moved: true }] }; };
    const res = mockRes();
    await handleMailboxAck({ method: 'POST', headers: {}, query: {},
      body: { internet_message_id: 'X', moved: true, reason: 'inbox_triaged' } }, res, { authenticate: authOk, opsQuery });
    assert.equal(call.path, 'rpc/lcc_mailbox_reconcile_ack');
    assert.equal(call.body.p_internet_message_id, 'X');
    assert.equal(call.body.p_moved, true);
    assert.equal(call.body.p_error, null);
    assert.equal(call.body.p_reason, 'inbox_triaged');
    assert.equal(res.body.result.moved, true);
  });

  it('maps moved:false (and the "false" string) → p_moved false and carries the error', async () => {
    process.env.MAILBOX_MIRROR = 'true';
    let call = null;
    const opsQuery = async (m, path, body) => { call = { body }; return { ok: true, data: [{ ok: true, moved: false, attempts: 1 }] }; };
    const res = mockRes();
    await handleMailboxAck({ method: 'POST', headers: {}, query: {},
      body: { internet_message_id: 'Y', moved: 'false', error: 'not_found' } }, res, { authenticate: authOk, opsQuery });
    assert.equal(call.body.p_moved, false);
    assert.equal(call.body.p_error, 'not_found');
  });

  it('defaults a failed ack error to a non-null marker', async () => {
    process.env.MAILBOX_MIRROR = 'true';
    let call = null;
    const opsQuery = async (m, path, body) => { call = { body }; return { ok: true, data: [{}] }; };
    const res = mockRes();
    await handleMailboxAck({ method: 'POST', headers: {}, query: {},
      body: { internet_message_id: 'Z', moved: false } }, res, { authenticate: authOk, opsQuery });
    assert.equal(call.body.p_moved, false);
    assert.equal(call.body.p_error, 'unknown_error');
  });
});

describe('mailbox mirror — no-LLM invariant', () => {
  it('the module imports no ai / LLM seam', () => {
    const src = readFileSync(join(root, '..', 'api', '_handlers', 'mailbox-reconcile.js'), 'utf8');
    assert.ok(!/from '\.\.\/_shared\/ai\.js'/.test(src), 'must not import the ai seam');
    assert.ok(!/invokeExtractionAI|invokeChatProvider|deriveNextStep|next-step-ai|action-summary/.test(src),
      'must not reference any LLM helper');
  });
});
