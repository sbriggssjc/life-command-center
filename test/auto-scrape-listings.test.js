// Tests for the lcc-auto-scrape-listings cron handler in api/admin.js.
// Focus: the new ±3-year window + closest-sale picker that mirrors the
// JS sidebar pickClosestListing rule. Both paths now converge on the
// same listing→sale pairing.

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
  'GOV_SUPABASE_KEY'
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function mockRes() {
  return {
    _status: null,
    _json: null,
    headersSent: false,
    _headers: {},
    setHeader(name, value) { this._headers[name] = value; },
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; }
  };
}

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || headers[name] || null;
      }
    },
    async text() { return JSON.stringify(body); },
    async json() { return body; }
  };
}

async function loadHandler() {
  return (await import(`../api/admin.js?test=${Date.now()}-${Math.random()}`)).default;
}

describe('admin /_route=auto-scrape-listings', () => {
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

  it('queries the ±3-year window and picks the closest sale on/after listing_date', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';
      calls.push({ url: target, method, body: opts.body });

      // Auth lookup
      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1',
          email: 'dev@example.com',
          display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }

      // The active-listings list — we serve one overdue listing.
      if (target.includes('/rest/v1/available_listings?listing_status=eq.active')) {
        return jsonResponse([{
          listing_id: 42,
          property_id: 100,
          listing_date: '2026-01-15',
          verification_due_at: '2026-04-01T00:00:00Z',
          consecutive_check_failures: 0
        }]);
      }

      // The candidate sales — three within window, one outside.
      if (target.startsWith('https://gov.example.com/rest/v1/sales_transactions')) {
        // Spec: lower bound 2023-01-15, upper bound 2029-01-15 (±~3y).
        // Verify both bounds are in the URL.
        assert.ok(target.includes('sale_date=gte.2023-01-1'),
          `expected ±3y lower bound in URL: ${target}`);
        assert.ok(target.includes('sale_date=lte.2029-01-1'),
          `expected ±3y upper bound in URL: ${target}`);
        // Deterministic order=sale_date.asc so tiebreaks are stable.
        assert.ok(target.includes('order=sale_date.asc'),
          `expected order=sale_date.asc in URL: ${target}`);
        return jsonResponse([
          { sale_id: 'old',     sale_date: '2024-12-01' }, // 45d before listing — close
          { sale_id: 'closer',  sale_date: '2026-02-01' }, // 17d after listing — closest
          { sale_id: 'further', sale_date: '2027-06-01' }  // ~16mo after — far
        ]);
      }

      // RPC: lcc_record_listing_check
      if (target.endsWith('/rest/v1/rpc/lcc_record_listing_check') && method === 'POST') {
        return jsonResponse({ ok: true });
      }

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'POST',
      query: { _route: 'auto-scrape-listings', domain: 'gov', limit: 50 },
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' }
    };
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 200, JSON.stringify(res._json));
    assert.equal(res._json.auto_marked_sold, 1);
    assert.equal(res._json.auto_verified_available, 0);

    // The RPC call must reference the closest sale ('closer'), not the
    // arbitrary first one or the further-but-also-on-or-after one.
    const rpcCall = calls.find((c) => c.url.endsWith('/rest/v1/rpc/lcc_record_listing_check'));
    assert.ok(rpcCall, 'expected RPC call');
    const rpcBody = JSON.parse(rpcCall.body);
    assert.equal(rpcBody.p_check_result, 'sold');
    assert.match(rpcBody.p_notes, /sale_id=closer/);
  });

  it('breaks distance ties in favor of sale on-or-after listing_date', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';
      calls.push({ url: target, method, body: opts.body });

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1', email: 'dev@example.com', display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      if (target.includes('/rest/v1/available_listings?listing_status=eq.active')) {
        return jsonResponse([{
          listing_id: 99, property_id: 200,
          listing_date: '2026-04-15',
          verification_due_at: '2026-04-01T00:00:00Z'
        }]);
      }
      if (target.startsWith('https://gov.example.com/rest/v1/sales_transactions')) {
        // Two sales equidistant (10 days each side). Tiebreak should pick
        // the on-or-after one ('after').
        return jsonResponse([
          { sale_id: 'before', sale_date: '2026-04-05' }, // 10d before
          { sale_id: 'after',  sale_date: '2026-04-25' }  // 10d after
        ]);
      }
      if (target.endsWith('/rest/v1/rpc/lcc_record_listing_check') && method === 'POST') {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    await handler(
      {
        method: 'POST',
        query: { _route: 'auto-scrape-listings', domain: 'gov' },
        headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' }
      },
      mockRes()
    );

    const rpcCall = calls.find((c) => c.url.endsWith('/rest/v1/rpc/lcc_record_listing_check'));
    assert.ok(rpcCall, 'expected RPC call');
    assert.match(JSON.parse(rpcCall.body).p_notes, /sale_id=after/);
  });

  it('returns still_available when no sale falls inside the window', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';
      calls.push({ url: target, method, body: opts.body });

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1', email: 'dev@example.com', display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      if (target.includes('/rest/v1/available_listings?listing_status=eq.active')) {
        return jsonResponse([{
          listing_id: 1, property_id: 1,
          listing_date: '2026-04-01',
          verification_due_at: '2026-04-01T00:00:00Z'
        }]);
      }
      if (target.startsWith('https://gov.example.com/rest/v1/sales_transactions')) {
        // PostgREST returns empty array when no sales in window.
        return jsonResponse([]);
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
        query: { _route: 'auto-scrape-listings', domain: 'gov' },
        headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' }
      },
      res
    );

    assert.equal(res._status, 200);
    assert.equal(res._json.auto_marked_sold, 0);
    assert.equal(res._json.auto_verified_available, 1);

    const rpcCall = calls.find((c) => c.url.endsWith('/rest/v1/rpc/lcc_record_listing_check'));
    assert.ok(rpcCall);
    const body = JSON.parse(rpcCall.body);
    assert.equal(body.p_check_result, 'still_available');
    assert.equal(body.p_off_market_reason, null);
  });

  it('GET (dry-run) does not call the RPC', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      calls.push({ url: target, method: opts.method || 'GET' });

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1', email: 'dev@example.com', display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      if (target.includes('/rest/v1/available_listings')) {
        return jsonResponse([{
          listing_id: 1, property_id: 1,
          listing_date: '2026-04-01',
          verification_due_at: '2026-04-01T00:00:00Z'
        }]);
      }
      if (target.startsWith('https://gov.example.com/rest/v1/sales_transactions')) {
        return jsonResponse([{ sale_id: 'x', sale_date: '2026-04-15' }]);
      }
      throw new Error(`Unexpected fetch: ${target}`);
    };

    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        query: { _route: 'auto-scrape-listings', domain: 'gov' },
        headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' }
      },
      res
    );

    assert.equal(res._status, 200);
    assert.equal(res._json.mode, 'dry_run');
    // In dry-run, the global auto_marked_sold counter stays 0; only the
    // per-domain summary's `sold` counter records the would-have-been action.
    assert.equal(res._json.auto_marked_sold, 0);
    assert.equal(res._json.by_domain.government.sold, 1);
    const rpcCalls = calls.filter((c) => c.url.endsWith('/rest/v1/rpc/lcc_record_listing_check'));
    assert.equal(rpcCalls.length, 0, 'dry-run must not invoke the RPC');
  });

  it('listings query uses an OR filter that includes NULL verification_due_at', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';
      calls.push({ url: target, method });

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1', email: 'dev@example.com', display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      if (target.includes('/rest/v1/available_listings?listing_status=eq.active')) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    await handler(
      {
        method: 'GET',
        query: { _route: 'auto-scrape-listings', domain: 'gov' },
        headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' }
      },
      mockRes()
    );

    const listingsCall = calls.find((c) => c.url.includes('/rest/v1/available_listings?listing_status=eq.active'));
    assert.ok(listingsCall, 'expected listings fetch');
    // The new filter is: or=(verification_due_at.is.null,and(...gte...,...lte...))
    assert.ok(
      listingsCall.url.includes('or=(verification_due_at.is.null'),
      `expected NULL-inclusive OR filter in URL: ${listingsCall.url}`
    );
    // The window bounds (gte cutoff, lte now) must be inside the AND group.
    assert.ok(
      listingsCall.url.includes('and(verification_due_at.gte.'),
      `expected AND-grouped non-NULL window in URL: ${listingsCall.url}`
    );
    assert.ok(
      listingsCall.url.includes('verification_due_at.lte.'),
      `expected upper bound in URL: ${listingsCall.url}`
    );
    // The old flat-filter form must be gone — those would silently exclude NULLs.
    assert.ok(
      !listingsCall.url.includes('&verification_due_at=lte.'),
      `flat lte filter must be removed (it excluded NULLs): ${listingsCall.url}`
    );
    assert.ok(
      !listingsCall.url.includes('&verification_due_at=gte.'),
      `flat gte filter must be removed (it excluded NULLs): ${listingsCall.url}`
    );
  });

  it('processes a listing with NULL verification_due_at as if due now', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      const method = opts.method || 'GET';
      calls.push({ url: target, method, body: opts.body });

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1', email: 'dev@example.com', display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      // The bug case: listing with NULL verification_due_at. Cron should
      // pick it up via the new OR filter, then process it normally.
      if (target.includes('/rest/v1/available_listings?listing_status=eq.active')) {
        return jsonResponse([{
          listing_id: 7,
          property_id: 700,
          listing_date: '2025-12-01',
          verification_due_at: null,
          consecutive_check_failures: 0
        }]);
      }
      if (target.startsWith('https://gov.example.com/rest/v1/sales_transactions')) {
        return jsonResponse([]); // no sales — should mark still_available
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
        query: { _route: 'auto-scrape-listings', domain: 'gov' },
        headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' }
      },
      res
    );

    assert.equal(res._status, 200);
    assert.equal(res._json.scanned, 1);
    assert.equal(res._json.auto_verified_available, 1);
    const rpcCall = calls.find((c) => c.url.endsWith('/rest/v1/rpc/lcc_record_listing_check'));
    assert.ok(rpcCall, 'expected RPC call to fire on the NULL-due listing');
    const body = JSON.parse(rpcCall.body);
    assert.equal(body.p_listing_id, 7);
    assert.equal(body.p_check_result, 'still_available');
  });
});
