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
    },
    end() {
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
  return (await import(`../api/queue.js?test=${Date.now()}-${Math.random()}`)).default;
}

describe('queue/inbox handler verification', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';
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

  it('triages an inbox item and records transition activity', async () => {
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
      if (target.includes('/rest/v1/inbox_items?id=eq.inbox-1&workspace_id=eq.ws-1&select=*') && method === 'GET') {
        return jsonResponse([{
          id: 'inbox-1',
          workspace_id: 'ws-1',
          title: 'Review email',
          status: 'new',
          source_user_id: 'user-1',
          assigned_to: null,
          entity_id: 'entity-1',
          domain: 'government'
        }]);
      }
      if (target.endsWith('/rest/v1/activity_events') && method === 'POST') {
        return jsonResponse([{ id: 'activity-1' }]);
      }
      if (target.includes('/rest/v1/inbox_items?id=eq.inbox-1&workspace_id=eq.ws-1') && method === 'PATCH') {
        return jsonResponse([{ id: 'inbox-1', status: 'triaged' }]);
      }

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'PATCH',
      query: { _route: 'inbox', id: 'inbox-1' },
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      body: { status: 'triaged' }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._json.item.status, 'triaged');
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/activity_events') && call.method === 'POST'));
    assert.ok(calls.some((call) => call.url.includes('/rest/v1/inbox_items?id=eq.inbox-1&workspace_id=eq.ws-1') && call.method === 'PATCH'));
  });

  it('promotes a triaged inbox item into an action item and updates inbox status', async () => {
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
      if (target.includes('/rest/v1/inbox_items?id=eq.inbox-2&workspace_id=eq.ws-1&select=*') && method === 'GET') {
        return jsonResponse([{
          id: 'inbox-2',
          workspace_id: 'ws-1',
          title: 'Call owner',
          body: 'Needs follow-up',
          status: 'triaged',
          source_user_id: 'user-1',
          assigned_to: 'user-1',
          priority: 'high',
          entity_id: 'entity-2',
          domain: 'government',
          source_connector_id: 'conn-1',
          external_id: 'sf-task-1',
          external_url: 'https://salesforce.example.com/task/1'
        }]);
      }
      if (target.endsWith('/rest/v1/action_items') && method === 'POST') {
        return jsonResponse([{ id: 'action-1', title: 'Call owner', status: 'open' }]);
      }
      if (target.includes('/rest/v1/inbox_items?id=eq.inbox-2&workspace_id=eq.ws-1') && method === 'PATCH') {
        return jsonResponse([{ id: 'inbox-2', status: 'promoted' }]);
      }
      if (target.endsWith('/rest/v1/activity_events') && method === 'POST') {
        return jsonResponse([{ id: 'activity-2' }]);
      }

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'POST',
      query: { _route: 'inbox', action: 'promote', id: 'inbox-2' },
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      body: { due_date: '2026-03-25' }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 201);
    assert.equal(res._json.inbox_status, 'promoted');
    assert.equal(res._json.action.id, 'action-1');
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/action_items') && call.method === 'POST'));
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/activity_events') && call.method === 'POST'));
  });
});
