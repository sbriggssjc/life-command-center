import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = global.fetch;
const ENV_KEYS = ['OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY', 'GOV_SUPABASE_URL', 'GOV_SUPABASE_KEY', 'LCC_API_KEY'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function mockRes() {
  return {
    _status: null,
    _json: null,
    headersSent: false,
    _headers: {},
    setHeader(name, value) {
      this._headers[name] = value;
    },
    status(code) {
      this._status = code;
      return this;
    },
    json(data) {
      this._json = data;
      this.headersSent = true;
      return this;
    }
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
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    }
  };
}

async function loadHandler() {
  return (await import(`../api/contacts.js?test=${Date.now()}-${Math.random()}`)).default;
}

describe('contacts handler auditing', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';
    process.env.GOV_SUPABASE_URL = 'https://gov.example.com';
    process.env.GOV_SUPABASE_KEY = 'gov-key';
    delete process.env.LCC_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('classify writes to gov tables and ops audit tables', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const target = String(url);
      calls.push({ url: target, method, body: opts.body });

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1',
          email: 'dev@example.com',
          display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'operator', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      if (target.includes('/rest/v1/unified_contacts?unified_id=eq.contact-1&select=contact_class')) {
        return jsonResponse([{ unified_id: 'contact-1', contact_class: 'personal' }]);
      }
      if (target.includes('/rest/v1/unified_contacts?unified_id=eq.contact-1') && method === 'PATCH') {
        return jsonResponse([{ unified_id: 'contact-1', contact_class: 'business' }]);
      }
      if (target.endsWith('/rest/v1/contact_change_log') && method === 'POST') {
        return jsonResponse([{ id: 'log-1' }]);
      }
      if (target.endsWith('/rest/v1/data_corrections') && method === 'POST') {
        return jsonResponse([{ id: 'corr-1' }]);
      }
      if (target.endsWith('/rest/v1/pending_updates') && method === 'POST') {
        return jsonResponse([{ id: 'pending-1' }]);
      }

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'POST',
      query: { action: 'classify', id: 'contact-1' },
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      body: { contact_class: 'business' }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._json.new_class, 'business');
    assert.ok(calls.some((call) => call.url.includes('/rest/v1/unified_contacts?unified_id=eq.contact-1') && call.method === 'PATCH'));
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/contact_change_log') && call.method === 'POST'));
    assert.ok(calls.filter((call) => call.url.endsWith('/rest/v1/data_corrections') && call.method === 'POST').length >= 2);
  });

  it('creates a pending review record when an audited contact mutation fails', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const target = String(url);
      calls.push({ url: target, method, body: opts.body });

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1',
          email: 'dev@example.com',
          display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'operator', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      if (target.includes('/rest/v1/unified_contacts?unified_id=eq.contact-1&select=contact_class')) {
        return jsonResponse([{ unified_id: 'contact-1', contact_class: 'personal' }]);
      }
      if (target.includes('/rest/v1/unified_contacts?unified_id=eq.contact-1') && method === 'PATCH') {
        return jsonResponse({ error: 'write failed' }, false, 500);
      }
      if (target.endsWith('/rest/v1/pending_updates') && method === 'POST') {
        return jsonResponse([{ id: 'pending-1' }]);
      }

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'POST',
      query: { action: 'classify', id: 'contact-1' },
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      body: { contact_class: 'business' }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 500);
    assert.equal(res._json.error, 'Failed to classify contact');
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/pending_updates') && call.method === 'POST'));
    assert.ok(!calls.some((call) => call.url.endsWith('/rest/v1/contact_change_log') && call.method === 'POST'));
  });
});
