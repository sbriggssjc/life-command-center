// Task D — SF Task OwnerId reassign write-back helper.
// reassignSalesforceTaskOwner is feature-flagged on SF_TASK_REASSIGN_URL, guards
// its inputs, never throws, and maps the PA flow response to an honest result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reassignSalesforceTaskOwner } from '../api/_shared/salesforce.js';

const URL = 'https://example.test/reassign?sig=secret';
const realFetch = globalThis.fetch;
function stubFetch(fn) { globalThis.fetch = fn; }
function restore() { globalThis.fetch = realFetch; delete process.env.SF_TASK_REASSIGN_URL; }

test('unconfigured -> clean no-op (never calls the flow)', async () => {
  delete process.env.SF_TASK_REASSIGN_URL;
  let called = false;
  stubFetch(async () => { called = true; return new Response('{}'); });
  const r = await reassignSalesforceTaskOwner({ what_id: 'op1', new_owner: 'jane@nm.com' });
  restore();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'sf_reassign_not_configured');
  assert.equal(called, false);
});

test('guards: no new_owner, no task target', async () => {
  process.env.SF_TASK_REASSIGN_URL = URL;
  stubFetch(async () => { throw new Error('should not fetch'); });
  const noOwner = await reassignSalesforceTaskOwner({ what_id: 'op1', new_owner: '  ' });
  assert.equal(noOwner.reason, 'no_new_owner');
  const noTarget = await reassignSalesforceTaskOwner({ new_owner: 'jane@nm.com' });
  assert.equal(noTarget.reason, 'no_task_target');
  restore();
});

test('success maps ok:true + reassigned count; body carries operation + target', async () => {
  process.env.SF_TASK_REASSIGN_URL = URL;
  let sentBody = null, sentUrl = null;
  stubFetch(async (u, opts) => {
    sentUrl = u; sentBody = JSON.parse(opts.body);
    return new Response(JSON.stringify({ ok: true, reassigned: 2 }), { status: 200 });
  });
  const r = await reassignSalesforceTaskOwner({
    opp_id: 'op9', listing_id: 'ls9', sf_contact_id: '003x', new_owner: 'Jane Broker',
  });
  restore();
  assert.equal(r.ok, true);
  assert.equal(r.reassigned, 2);
  assert.equal(sentUrl, URL);
  assert.equal(sentBody.operation, 'reassign_task_owner');
  assert.equal(sentBody.what_id, 'op9');       // falls back to opp_id when no sf_task_id
  assert.equal(sentBody.new_owner, 'Jane Broker');
});

test('flow HTTP error -> ok:false with status + detail', async () => {
  process.env.SF_TASK_REASSIGN_URL = URL;
  stubFetch(async () => new Response('boom', { status: 500 }));
  const r = await reassignSalesforceTaskOwner({ what_id: 'op1', new_owner: 'x@y.com' });
  restore();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'flow_http_error');
  assert.equal(r.status, 500);
});

test('flow reported failure (ok!=true) -> ok:false, carries reason', async () => {
  process.env.SF_TASK_REASSIGN_URL = URL;
  stubFetch(async () => new Response(JSON.stringify({ ok: false, reason: 'task_not_found' }), { status: 200 }));
  const r = await reassignSalesforceTaskOwner({ what_id: 'op1', new_owner: 'x@y.com' });
  restore();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'task_not_found');
});

test('unreachable flow -> ok:false flow_unreachable (never throws)', async () => {
  process.env.SF_TASK_REASSIGN_URL = URL;
  stubFetch(async () => { throw new Error('ECONNRESET'); });
  const r = await reassignSalesforceTaskOwner({ what_id: 'op1', new_owner: 'x@y.com' });
  restore();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'flow_unreachable');
});
