// R52b — stop masking Salesforce/PA flow errors (the `.slice is not a function`
// bug). A non-2xx PA flow body commonly arrives with an OBJECT `error` (e.g.
// `{error:{message:"Object with id '003x' does not exist"}}`), so the old
// `(json.error || ...).slice(0,300)` called `.slice` on an object and threw a
// TypeError that masked the real Salesforce error. `pickFlowMessage` coerces
// any shape to a string before slicing.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSalesforceAccountById, pickFlowMessage } from '../api/_shared/salesforce.js';

// Mirror of the production slice so each case proves "no throw under any shape".
const summarize = (raw) => String(raw || '').slice(0, 500);

describe('pickFlowMessage', () => {
  it('digs the message out of a nested SF/connector error object', () => {
    const v = { code: 'NOT_FOUND', message: "Object with id '003x' does not exist" };
    assert.equal(pickFlowMessage(v), "Object with id '003x' does not exist");
  });

  it('handles an array-shaped error (first {message})', () => {
    assert.equal(pickFlowMessage([{ message: 'X' }, { message: 'Y' }]), 'X');
  });

  it('passes a plain string through', () => {
    assert.equal(pickFlowMessage('plain text error'), 'plain text error');
  });

  it('returns empty string for null / undefined', () => {
    assert.equal(pickFlowMessage(null), '');
    assert.equal(pickFlowMessage(undefined), '');
  });

  it('recognizes error_description / errorMessage variants', () => {
    assert.equal(pickFlowMessage({ error_description: 'desc' }), 'desc');
    assert.equal(pickFlowMessage({ errorMessage: 'em' }), 'em');
  });

  it('falls back to JSON for an object with no known message key', () => {
    assert.equal(pickFlowMessage({ foo: 'bar' }), '{"foo":"bar"}');
  });

  it('never throws / is always sliceable across every shape', () => {
    const shapes = [
      { error: { message: "Object with id '003x' does not exist" } },
      { error: [{ message: 'X' }] },
      { error: 'a flat string error' },
      { error: { code: 'E', detail: { nested: true } } },
      null,
      undefined,
      'just text',
    ];
    for (const s of shapes) {
      const raw = pickFlowMessage(s && s.error !== undefined ? s.error : s);
      assert.doesNotThrow(() => summarize(raw));
      assert.equal(typeof summarize(raw), 'string');
    }
    // The exact masking case from the live drain resolves to the real message.
    const detail = summarize(
      pickFlowMessage({ message: "Object with id '003Vs000015j8hMIAQ' does not exist" }),
    );
    assert.equal(detail, "Object with id '003Vs000015j8hMIAQ' does not exist");
  });
});

describe('getSalesforceAccountById', () => {
  it('falls back to generic record lookup when the lookup flow cannot validate by id', async () => {
    const out = await getSalesforceAccountById('0018W00002MMNwAQAX', {
      lookupFlow: async () => ({ ok: false, reason: 'flow_http_error', status: 500, detail: 'Switch case missing' }),
      recordLookup: async (args) => {
        assert.equal(args.objectType, 'Account');
        assert.deepEqual(args.ids, ['0018W00002MMNwAQAX']);
        return { ok: true, records: [{ Id: '0018W00002MMNwAQAX', Name: 'US Federal Properties Trust', Type: 'Investor' }] };
      },
    });

    assert.equal(out.ok, true);
    assert.equal(out.source, 'sf_record_lookup');
    assert.deepEqual(out.account, {
      Id: '0018W00002MMNwAQAX',
      Name: 'US Federal Properties Trust',
      Type: 'Investor',
      Industry: null,
    });
  });

  it('keeps the primary flow error detail when fallback lookup also fails', async () => {
    const out = await getSalesforceAccountById('0018W00002MMNwAQAX', {
      lookupFlow: async () => ({ ok: false, reason: 'flow_http_error', status: 502, detail: 'find_account_by_id failed' }),
      recordLookup: async () => ({ ok: false, reason: 'flow_http_error', errors: [{ detail: 'record lookup failed' }] }),
    });

    assert.equal(out.ok, false);
    assert.equal(out.reason, 'flow_http_error');
    assert.equal(out.detail, 'record lookup failed');
    assert.deepEqual(out.lookup_flow, {
      reason: 'flow_http_error',
      status: 502,
      detail: 'find_account_by_id failed',
    });
  });
});
