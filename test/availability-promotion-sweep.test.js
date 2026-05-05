// Tests for the availability-promotion-sweep route in api/admin.js
// (Round 76ej.h). The sweep finds listings the availability-checker
// stamped 'unverified_assumed_off' and re-checks them against
// sales_transactions; on a match it calls lcc_record_listing_check with
// check_result='sold' to upgrade the off_market_reason from
// 'unverified_assumed_off' to 'sold'.

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

  it('promotes a listing to sold when sales_transactions has a match in the ±3y window', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';
      calls.push({ url: target, method, body: opts.body });

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1', email: 'dev@example.com', display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }],
        }]);
      }

      // Promotion sweep query: filter on off_market_reason=eq.unverified_assumed_off.
      if (target.startsWith('https://gov.example.com/rest/v1/available_listings?off_market_reason=eq.unverified_assumed_off')) {
        return jsonResponse([{
          listing_id: 'listing-uuid-1',
          property_id: 555,
          listing_date: '2026-01-15',
          off_market_date: '2026-04-10',
          off_market_reason: 'unverified_assumed_off',
        }]);
      }

      if (target.startsWith('https://gov.example.com/rest/v1/sales_transactions')) {
        return jsonResponse([
          { sale_id: 's-old', sale_date: '2024-12-01' },     // 45d before listing
          { sale_id: 's-match', sale_date: '2026-02-01' },   // 17d after listing — closest
        ]);
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

    const rpc = calls.find((c) => c.url.endsWith('/rest/v1/rpc/lcc_record_listing_check'));
    assert.ok(rpc, 'expected lcc_record_listing_check call');
    const body = JSON.parse(rpc.body);
    assert.equal(body.p_check_result, 'sold');
    // off_market_reason must be 'sold' so the helper upgrades the listing
    // away from the scraper's 'unverified_assumed_off' stamp.
    assert.equal(body.p_off_market_reason, 'sold');
    assert.match(body.p_notes, /availability-promotion-sweep/);
    assert.match(body.p_notes, /sale_id=s-match/);
    assert.equal(body.p_effective_at, '2026-02-01');
  });

  it('records no_sale_evidence when nothing matches the window', async () => {
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1', email: 'dev@example.com', display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }],
        }]);
      }
      if (target.startsWith('https://dia.example.com/rest/v1/available_listings?off_market_reason=eq.unverified_assumed_off')) {
        return jsonResponse([{
          listing_id: 7,
          property_id: 1,
          listing_date: '2026-04-01',
          off_market_date: '2026-04-20',
          off_market_reason: 'unverified_assumed_off',
        }]);
      }
      if (target.startsWith('https://dia.example.com/rest/v1/sales_transactions')) {
        return jsonResponse([]); // no sales
      }
      if (target.endsWith('/rest/v1/rpc/lcc_record_listing_check') && method === 'POST') {
        throw new Error('RPC must not be called when there is no sale evidence');
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
    assert.equal(res._json.scanned, 1);
    assert.equal(res._json.promoted_to_sold, 0);
    assert.equal(res._json.no_sale_evidence, 1);
  });

  it('GET returns dry-run counts without calling the RPC', async () => {
    const rpcCalls = [];
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';
      if (target.endsWith('/rest/v1/rpc/lcc_record_listing_check')) {
        rpcCalls.push({ method, body: opts.body });
      }

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1', email: 'dev@example.com', display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }],
        }]);
      }
      if (target.startsWith('https://gov.example.com/rest/v1/available_listings?off_market_reason=eq.unverified_assumed_off')) {
        return jsonResponse([{
          listing_id: 'listing-uuid-1',
          property_id: 555,
          listing_date: '2026-01-15',
          off_market_date: '2026-04-10',
          off_market_reason: 'unverified_assumed_off',
        }]);
      }
      if (target.startsWith('https://gov.example.com/rest/v1/sales_transactions')) {
        return jsonResponse([{ sale_id: 's-match', sale_date: '2026-02-01' }]);
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

  it('applies the max_age_days cutoff to off_market_date', async () => {
    let listingsUrl = null;
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1', email: 'dev@example.com', display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }],
        }]);
      }
      if (target.includes('/rest/v1/available_listings?off_market_reason=eq.unverified_assumed_off')) {
        listingsUrl = target;
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
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
      mockRes(),
    );

    // 30 days ago, ISO-prefix yyyy-mm-dd. Recompute the same way the
    // handler does so the assertion is timezone-stable.
    const expected = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    assert.ok(listingsUrl, 'expected listings query to fire');
    assert.ok(
      listingsUrl.includes(`off_market_date=gte.${encodeURIComponent(expected)}`),
      `expected off_market_date=gte.${expected} in URL: ${listingsUrl}`,
    );
  });
});
