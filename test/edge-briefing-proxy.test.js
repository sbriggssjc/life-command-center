// Replaces the previous test/daily-briefing.test.js, which targeted
// api/daily-briefing.js — a top-level Vercel function that no longer exists.
// The briefing assembly logic now lives in the LCC Opps `daily-briefing`
// Supabase Edge Function (see CLAUDE.md). What remains in this repo is a
// thin proxy on /api/admin?_route=edge-brief that this test covers.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = global.fetch;
const ENV_KEYS = ['OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY', 'LCC_API_KEY'];
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

describe('admin /_route=edge-brief proxy', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';
    delete process.env.LCC_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('forwards GET query params to the edge function and returns its body', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      calls.push({ url: target, method: opts.method || 'GET' });

      // Auth lookup
      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1',
          email: 'dev@example.com',
          display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }

      // The edge function call.
      if (target.startsWith('https://xengecqvemvfknjvbvrq.supabase.co/functions/v1/daily-briefing')) {
        return jsonResponse({ ok: true, role_view: 'broker', subject: 'Daily briefing' });
      }

      throw new Error(`Unexpected fetch: ${opts.method || 'GET'} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'GET',
      query: { _route: 'edge-brief', role_view: 'broker', date: '2026-04-29' },
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' }
    };
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._json.role_view, 'broker');

    const edgeCall = calls.find((c) => c.url.includes('/functions/v1/daily-briefing'));
    assert.ok(edgeCall, 'expected an edge-function call');

    // _route is stripped, the rest of the query is forwarded.
    assert.ok(edgeCall.url.includes('role_view=broker'));
    assert.ok(edgeCall.url.includes('date=2026-04-29'));
    assert.ok(!edgeCall.url.includes('_route='));
  });

  it('returns 502 with a detail when the edge function is unreachable', async () => {
    global.fetch = async (url, opts = {}) => {
      const target = String(url);
      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1',
          email: 'dev@example.com',
          display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'owner', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      if (target.startsWith('https://xengecqvemvfknjvbvrq.supabase.co/functions/v1/daily-briefing')) {
        throw new Error('connect ECONNREFUSED');
      }
      throw new Error(`Unexpected fetch: ${opts.method || 'GET'} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'GET',
      query: { _route: 'edge-brief' },
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' }
    };
    const res = mockRes();
    await handler(req, res);

    assert.equal(res._status, 502);
    assert.equal(res._json.error, 'Edge function unavailable');
    assert.ok(res._json.detail.includes('ECONNREFUSED'));
  });
});
