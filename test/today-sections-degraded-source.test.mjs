// HP1 Finding 1 (P0, 2026-09-12) — guard for the `today_sections` handler's
// Promise.allSettled fix.
//
// The assertion is NOT "the call succeeds" — it is that a THROWN source
// (opsQuery's fetchWithTimeout rejects on abort; it does not resolve
// {ok:false}) degrades EXACTLY ONE lane and the endpoint STILL returns 200
// with the other two lanes intact. Before this fix, one rejected source in
// the handler's `Promise.all` rejected the whole call, which `withErrorHandler`
// turned into a blanket HTTP 500 across all three Today lanes at once — the
// exact symptom Scott reported (one endpoint, drawn three times).
//
// Fetch is stubbed directly (the `marketing-reassign` pattern this suite
// already uses) rather than exercised against a real host — net-guard would
// block a real host anyway, and a stub is the deterministic way to force a
// REJECTION (as opposed to a resolved non-2xx), which is the specific failure
// mode this guard exists to catch.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const ENV_KEYS = [
  'OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY',
  'GOV_SUPABASE_URL', 'GOV_SUPABASE_SERVICE_KEY', 'GOV_SUPABASE_KEY',
  'DIA_SUPABASE_URL', 'DIA_SUPABASE_SERVICE_KEY', 'DIA_SUPABASE_KEY',
];

function fakeResponse(status, body, headers = {}) {
  const text = body === null ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
  };
}

describe('HP1 Finding 1 — today_sections degrades exactly one lane and still returns 200', () => {
  let savedEnv = {};
  let savedFetch;
  let getTodaySections;

  before(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.OPS_SUPABASE_URL = 'http://ops.test.local';
    process.env.OPS_SUPABASE_KEY = 'ops-test-key';
    process.env.GOV_SUPABASE_URL = 'http://gov.test.local';
    process.env.GOV_SUPABASE_SERVICE_KEY = 'gov-test-key';
    process.env.DIA_SUPABASE_URL = 'http://dia.test.local';
    process.env.DIA_SUPABASE_SERVICE_KEY = 'dia-test-key';

    ({ getTodaySections } = await import('../api/operations.js'));
  });

  after(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('a thrown seller-prospect-queue source empties ONLY Significant, names it, and the endpoint returns 200', async () => {
    savedFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('v_lcc_seller_prospect_queue')) {
        // Simulates fetchWithTimeout's AbortController firing: fetch REJECTS,
        // it does not resolve {ok:false}.
        throw new Error('The operation was aborted');
      }
      if (url.includes('bd_opportunities')) {
        return fakeResponse(200, [
          { id: 'opp1', entity_id: 'ent-1', type: 'buyer', stage: 'Prospecting', amount: 750000, expected_close_date: null, opened_at: null },
        ]);
      }
      if (url.includes('action_items')) {
        return fakeResponse(200, [
          { id: 'ai1', entity_id: 'ent-2', action_type: 'reply_overdue', title: 'Reply overdue', due_date: '2020-01-01', status: 'open' },
        ]);
      }
      if (url.includes('v_lcc_bd_worklist')) {
        return fakeResponse(200, []);
      }
      if (url.includes('v_owner_source_conflict')) {
        return fakeResponse(200, []);
      }
      if (url.includes('/entities?')) {
        return fakeResponse(200, [{ id: 'ent-1', name: 'Acme Holdings LLC' }, { id: 'ent-2', name: 'Beta Corp' }]);
      }
      throw new Error('unexpected fetch in test: ' + url);
    };

    try {
      let statusCode = null;
      let jsonBody = null;
      const res = {
        status(code) { statusCode = code; return this; },
        json(body) { jsonBody = body; return this; },
      };
      const req = { query: {} };

      await getTodaySections(req, res, { id: 'u1' }, 'ws1');

      // The endpoint itself must return 200 — the whole point of the fix.
      assert.equal(statusCode, 200, 'a thrown source must not 500 the endpoint');
      assert.equal(jsonBody.ok, true);

      // Significant is the ONLY lane the thrown source touches.
      assert.deepEqual(jsonBody.significant.items, [], 'Significant is emptied by its own source failure');
      assert.ok(jsonBody.significant.source_error, 'Significant must name why it is empty');
      assert.match(jsonBody.significant.source_error, /aborted/i);

      // Important and Urgent are UNTOUCHED by Significant's failure.
      assert.equal(jsonBody.important.items.length, 1, 'Important must survive Significant throwing');
      assert.equal(jsonBody.important.source_error, null);
      assert.equal(jsonBody.important.items[0].who, 'Acme Holdings LLC');

      assert.equal(jsonBody.urgent.items.length, 1, 'Urgent must survive Significant throwing');
      assert.equal(jsonBody.urgent.source_error, null);
      assert.equal(jsonBody.urgent.items[0].who, 'Beta Corp');

      // named_gaps carries the degraded-this-request note under the existing
      // contract (a list of strings), alongside the permanent design gaps.
      assert.ok(Array.isArray(jsonBody.named_gaps));
      assert.ok(jsonBody.named_gaps.some((g) => /^Significant:.*degraded this request/.test(g)));
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('a thrown Important source (bd_opportunities) empties ONLY Important', async () => {
    savedFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('bd_opportunities')) throw new Error('fetch failed: socket hang up');
      if (url.includes('v_lcc_seller_prospect_queue')) {
        return fakeResponse(200, [
          { entity_id: 'ent-3', source_domain: 'gov', property_id: 900, rank_value: 5000000, reach_state: 'never_touched' },
        ]);
      }
      if (url.includes('action_items')) return fakeResponse(200, []);
      if (url.includes('v_lcc_bd_worklist')) return fakeResponse(200, []);
      if (url.includes('v_owner_source_conflict')) return fakeResponse(200, []);
      if (url.includes('/entities?')) return fakeResponse(200, []);
      throw new Error('unexpected fetch in test: ' + url);
    };

    try {
      let statusCode = null;
      let jsonBody = null;
      const res = { status(code) { statusCode = code; return this; }, json(body) { jsonBody = body; return this; } };
      const req = { query: {} };

      await getTodaySections(req, res, { id: 'u1' }, 'ws1');

      assert.equal(statusCode, 200);
      assert.equal(jsonBody.ok, true);

      assert.deepEqual(jsonBody.important.items, []);
      assert.ok(jsonBody.important.source_error);
      assert.match(jsonBody.important.source_error, /socket hang up/i);

      // Significant survives Important throwing.
      assert.equal(jsonBody.significant.items.length, 1);
      assert.equal(jsonBody.significant.source_error, null);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
