// Closing the Loop — the outbound PA move-message relay (Flow 1).
// Env-gated 503, single-event immediate POST, outcome-truthful, bounded retry.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const MOVE_URL = 'https://pa.test.local/move?sig=SECRET';
const noSleep = async () => {}; // never actually wait in tests

let mod;
beforeEach(async () => {
  process.env.PA_MOVE_MESSAGE_WEBHOOK_URL = MOVE_URL;
  mod = await import('../api/_shared/pa-move-message.js');
});
afterEach(() => {
  delete process.env.PA_MOVE_MESSAGE_WEBHOOK_URL;
});

function okRes(json = { ok: true }) {
  return { ok: true, status: 200, text: async () => JSON.stringify(json) };
}
function res(status, json) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(json) };
}

describe('postMoveMessage', () => {
  it('POSTs a single-event payload and resolves the move', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return okRes({ ok: true, server_relative_url: '/Processed/News/x.eml' });
    };
    const r = await mod.postMoveMessage({
      internetMessageId: '<abc@contoso.com>',
      targetFolder: 'Processed/News',
      outcome: 'auto_filed',
      fetchImpl,
      sleepImpl: noSleep,
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(r.attempts, 1);
    assert.equal(r.server_relative_url, '/Processed/News/x.eml');
    assert.equal(calls.length, 1, 'exactly one POST — never batched');
    assert.deepEqual(calls[0].body, {
      internet_message_id: '<abc@contoso.com>',
      target_folder: 'Processed/News',
      outcome: 'auto_filed',
      disposition: 'auto_filed',
    });
    assert.equal(calls[0].url, MOVE_URL);
  });

  it('forwards present passthrough fields and drops undefined ones', async () => {
    let sent = null;
    const fetchImpl = async (_url, opts) => { sent = JSON.parse(opts.body); return okRes(); };
    await mod.postMoveMessage({
      internetMessageId: '<a@b>', targetFolder: 'Processed/News', outcome: 'duplicate',
      passthrough: { correlation_id: 'g-1', schema_version: '1.0', subject: undefined },
      fetchImpl, sleepImpl: noSleep,
    });
    assert.equal(sent.correlation_id, 'g-1');
    assert.equal(sent.schema_version, '1.0');
    assert.equal('subject' in sent, false, 'undefined passthrough keys are dropped');
    assert.equal(sent.disposition, 'duplicate', 'outcome mirrored to disposition');
  });

  it('is a safe 503 no-op when the env URL is unset', async () => {
    delete process.env.PA_MOVE_MESSAGE_WEBHOOK_URL;
    let called = false;
    const r = await mod.postMoveMessage({
      internetMessageId: '<a@b>', targetFolder: 'Processed/News',
      fetchImpl: async () => { called = true; return okRes(); }, sleepImpl: noSleep,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
    assert.match(r.detail, /unset/);
    assert.equal(called, false, 'never POSTs when unconfigured');
  });

  it('rejects a missing internet_message_id / target_folder with 400 (no POST)', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return okRes(); };
    const a = await mod.postMoveMessage({ targetFolder: 'Processed/News', fetchImpl, sleepImpl: noSleep });
    assert.equal(a.status, 400);
    const b = await mod.postMoveMessage({ internetMessageId: '<a@b>', fetchImpl, sleepImpl: noSleep });
    assert.equal(b.status, 400);
    assert.equal(called, false);
  });

  it('treats an HTTP 200 with ok:false as a failure (logical-failure detection), no retry', async () => {
    let n = 0;
    const fetchImpl = async () => { n++; return okRes({ ok: false, error: 'message not found' }); };
    const r = await mod.postMoveMessage({
      internetMessageId: '<a@b>', targetFolder: 'Processed/News', fetchImpl, sleepImpl: noSleep,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 200);
    assert.match(r.detail, /message not found/);
    assert.equal(n, 1, '200-with-ok:false is not retried (the flow rejected it)');
  });

  it('does NOT retry a 4xx (permanent)', async () => {
    let n = 0;
    const fetchImpl = async () => { n++; return res(401, { error: 'bad sig' }); };
    const r = await mod.postMoveMessage({
      internetMessageId: '<a@b>', targetFolder: 'Processed/News', fetchImpl, sleepImpl: noSleep,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.equal(n, 1);
  });

  it('retries a 5xx with backoff then succeeds', async () => {
    let n = 0;
    const delays = [];
    const fetchImpl = async () => { n++; return n < 3 ? res(503, { error: 'busy' }) : okRes(); };
    const r = await mod.postMoveMessage({
      internetMessageId: '<a@b>', targetFolder: 'Processed/News', fetchImpl,
      sleepImpl: async (ms) => { delays.push(ms); },
    });
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 3);
    assert.equal(n, 3);
    assert.deepEqual(delays, [2000, 4000], 'exponential backoff between the 3 attempts');
  });

  it('retries a network error then gives up after maxRetries', async () => {
    let n = 0;
    const fetchImpl = async () => { n++; throw new Error('ECONNRESET'); };
    const r = await mod.postMoveMessage({
      internetMessageId: '<a@b>', targetFolder: 'Processed/News', fetchImpl,
      sleepImpl: noSleep, maxRetries: 2,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 0);
    assert.match(r.detail, /ECONNRESET/);
    assert.equal(n, 3, 'first attempt + 2 retries');
    assert.equal(r.attempts, 3);
  });
});
