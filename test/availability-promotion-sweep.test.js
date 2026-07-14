// Tests for the availability-promotion-sweep route in api/admin.js.
// Age-decoupling (2026-07-14): the sweep drives straight off
// v_listings_needing_manual_confirmation where
// confirmation_state='sale_match_promote' (a confirmed 1:1 same-property sale
// match) and promotes to Sold REGARDLESS of off_market_date age — a deed match
// is a sale at any age. It records the promotion with method='sale_imported'
// (valid for both lvh_method_check + lsh_source_check after the 2026-07-14
// reconcile) and preserves the existing off_market_date via the RPC.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = global.fetch;
const ENV_KEYS = [
  'LCC_API_KEY',
  'OPS_SUPABASE_URL',
  'OPS_SUPABASE_KEY',
  'DIA_SUPABASE_URL',
  'DIA_SUPABASE_KEY',
  'GOV_SUPABASE_URL',
  'GOV_SUPABASE_KEY',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function mockRes() {
  return {
    _status: null,
    _json: null,
    headersSent: false,
    _headers: {},
    setHeader(name, value) { this._headers[name] = value; },
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
  };
}

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) { return headers[name.toLowerCase()] || headers[name] || null; },
    },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

async function loadHandler() {
  return (await import(`../api/admin.js?test=${Date.now()}-${Math.random()}`)).default;
}

const USER_ROW = [{
  id: 'user-1', email: 'dev@example.com', display_name: 'Dev User',
  workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }],
}];

describe('admin /_route=availability-promotion-sweep', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';
    process.env.DIA_SUPABASE_URL = 'https://dia.example.com';
    process.env.DIA_SUPABASE_KEY = 'dia-key';
    process.env.GOV_SUPABASE_URL = 'https://gov.example.com';
    process.env.GOV_SUPABASE_KEY = 'gov-key';
    delete process.env.LCC_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('promotes a sale_match_promote row to sold — regardless of age — via sale_imported', async () => {
    const calls = [];
    let viewUrl = null;
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';
      calls.push({ url: target, method, body: opts.body });

      if (target.includes('/rest/v1/users?')) return jsonResponse(USER_ROW);

      // The sweep now drives off the view's classification.
      if (target.startsWith('https://gov.example.com/rest/v1/v_listings_needing_manual_confirmation')) {
        viewUrl = target;
        return jsonResponse([{
          listing_id: 'listing-uuid-1',
          property_id: 555,
          candidate_sale_id: 's-match',
          candidate_sale_date: '2017-02-01',   // ~9 years old — must still promote
          candidate_sold_price: 4200000,
        }]);
      }
      if (target.endsWith('/rest/v1/rpc/lcc_record_listing_check') && method === 'POST') {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { _route: 'availability-promotion-sweep', domain: 'gov', limit: 25 },
        headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      },
      res,
    );

    assert.equal(res._status, 200, JSON.stringify(res._json));
    assert.equal(res._json.scanned, 1);
    assert.equal(res._json.promoted_to_sold, 1);
    assert.equal(res._json.no_sale_evidence, 0);

    // Drives off the view, filters test rows, and applies NO age gate.
    assert.ok(viewUrl, 'expected the view query to fire');
    assert.match(viewUrl, /confirmation_state=eq\.sale_match_promote/);
    assert.match(viewUrl, /exclude_from_listing_metrics=not\.is\.true/);
    assert.ok(!/off_market_date=gte/.test(viewUrl), `no age gate expected in URL: ${viewUrl}`);
    // Never queries sales_transactions itself — the view already resolved the match.
    assert.ok(!calls.some((c) => c.url.includes('/rest/v1/sales_transactions')),
      'must not re-derive the sale from sales_transactions');

    const rpc = calls.find((c) => c.url.endsWith('/rest/v1/rpc/lcc_record_listing_check'));
    assert.ok(rpc, 'expected lcc_record_listing_check call');
    const body = JSON.parse(rpc.body);
    assert.equal(body.p_method, 'sale_imported');
    assert.equal(body.p_check_result, 'sold');
    assert.equal(body.p_off_market_reason, 'sold');
    assert.equal(body.p_effective_at, '2017-02-01');
    assert.match(body.p_notes, /availability-promotion-sweep/);
    assert.match(body.p_notes, /candidate_sale_id=s-match/);
  });

  it('promotes nothing when the view has no sale_match_promote rows', async () => {
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';

      if (target.includes('/rest/v1/users?')) return jsonResponse(USER_ROW);
      if (target.startsWith('https://dia.example.com/rest/v1/v_listings_needing_manual_confirmation')) {
        return jsonResponse([]); // aged_needs_research / awaiting_sweep only
      }
      if (target.endsWith('/rest/v1/rpc/lcc_record_listing_check') && method === 'POST') {
        throw new Error('RPC must not be called when there is nothing to promote');
      }
      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { _route: 'availability-promotion-sweep', domain: 'dia' },
        headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      },
      res,
    );

    assert.equal(res._status, 200, JSON.stringify(res._json));
    assert.equal(res._json.scanned, 0);
    assert.equal(res._json.promoted_to_sold, 0);
  });

  it('GET returns dry-run counts without calling the RPC', async () => {
    const rpcCalls = [];
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';
      if (target.endsWith('/rest/v1/rpc/lcc_record_listing_check')) {
        rpcCalls.push({ method, body: opts.body });
      }

      if (target.includes('/rest/v1/users?')) return jsonResponse(USER_ROW);
      if (target.startsWith('https://gov.example.com/rest/v1/v_listings_needing_manual_confirmation')) {
        return jsonResponse([{
          listing_id: 'listing-uuid-1',
          property_id: 555,
          candidate_sale_id: 's-match',
          candidate_sale_date: '2026-02-01',
          candidate_sold_price: 4200000,
        }]);
      }
      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { _route: 'availability-promotion-sweep', domain: 'gov' },
        headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      },
      res,
    );

    assert.equal(res._status, 200);
    assert.equal(res._json.mode, 'dry_run');
    assert.equal(res._json.promoted_to_sold, 1);
    assert.equal(rpcCalls.length, 0, 'dry-run must not call lcc_record_listing_check');
  });

  it('max_age_days does not gate the sale-match query (retained for cron compat)', async () => {
    let viewUrl = null;
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';

      if (target.includes('/rest/v1/users?')) return jsonResponse(USER_ROW);
      if (target.includes('/rest/v1/v_listings_needing_manual_confirmation')) {
        viewUrl = target;
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: {
          _route: 'availability-promotion-sweep',
          domain: 'dia',
          max_age_days: '30',
        },
        headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      },
      res,
    );

    assert.ok(viewUrl, 'expected the view query to fire');
    // The sale-match promotion is age-independent — no off_market_date cutoff.
    assert.ok(!/off_market_date=gte/.test(viewUrl), `no age gate expected in URL: ${viewUrl}`);
    // max_age_days is surfaced in the response for observability only.
    assert.equal(res._json.max_age_days, 30);
  });
});
