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

  describe('_perf beacon (anonymous client telemetry)', () => {
    const validWs = '11111111-1111-1111-1111-111111111111';
    const validUser = '22222222-2222-2222-2222-222222222222';

    it('persists a render:my_work beacon to perf_metrics without requiring auth', async () => {
      const calls = [];
      global.fetch = async (url, opts = {}) => {
        const method = opts.method || 'GET';
        const target = String(url);
        calls.push({ url: target, method, body: opts.body });
        if (target.endsWith('/rest/v1/perf_metrics') && method === 'POST') {
          return jsonResponse([{ id: 1 }], true, 201);
        }
        throw new Error(`Unexpected fetch: ${method} ${target}`);
      };

      const handler = await loadHandler();
      // Note: no Authorization or X-LCC-Key headers — this is the sendBeacon path.
      const req = {
        method: 'POST',
        query: { _version: 'v2', view: '_perf' },
        headers: {},
        body: {
          metric_type: 'client_render',
          endpoint: 'render:my_work',
          duration_ms: 742,
          workspace_id: validWs,
          user_id: validUser
        }
      };
      const res = mockRes();
      await handler(req, res);

      assert.equal(res._status, 204);
      const insert = calls.find((c) => c.url.endsWith('/rest/v1/perf_metrics') && c.method === 'POST');
      assert.ok(insert, 'expected a perf_metrics insert');
      const row = JSON.parse(insert.body);
      assert.equal(row.metric_type, 'client_render');
      assert.equal(row.endpoint, 'render:my_work');
      assert.equal(row.duration_ms, 742);
      assert.equal(row.workspace_id, validWs);
      assert.equal(row.user_id, validUser);
    });

    it('parses a string body (sendBeacon text/plain fallback)', async () => {
      const calls = [];
      global.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
        return jsonResponse([{ id: 1 }], true, 201);
      };
      const handler = await loadHandler();
      const req = {
        method: 'POST',
        query: { _version: 'v2', view: '_perf' },
        headers: {},
        body: JSON.stringify({
          metric_type: 'page_load',
          endpoint: 'api:view=work_counts',
          duration_ms: 332,
          workspace_id: validWs
        })
      };
      const res = mockRes();
      await handler(req, res);

      assert.equal(res._status, 204);
      const insert = calls.find((c) => c.url.endsWith('/rest/v1/perf_metrics'));
      assert.ok(insert, 'expected a perf_metrics insert');
      assert.equal(JSON.parse(insert.body).endpoint, 'api:view=work_counts');
    });

    it('rejects unknown metric_type without inserting', async () => {
      const calls = [];
      global.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), method: opts.method || 'GET' });
        return jsonResponse([], true, 201);
      };
      const handler = await loadHandler();
      const req = {
        method: 'POST',
        query: { _version: 'v2', view: '_perf' },
        headers: {},
        body: { metric_type: 'evil', endpoint: 'render:my_work', duration_ms: 100 }
      };
      const res = mockRes();
      await handler(req, res);
      assert.equal(res._status, 204);
      assert.equal(calls.length, 0, 'should not have hit Supabase');
    });

    it('clamps duration_ms and rejects non-printable endpoint', async () => {
      let inserted = null;
      global.fetch = async (url, opts = {}) => {
        if (String(url).endsWith('/rest/v1/perf_metrics')) {
          inserted = JSON.parse(opts.body);
        }
        return jsonResponse([{ id: 1 }], true, 201);
      };
      const handler = await loadHandler();

      // duration well over the 60s cap should clamp
      const r1 = mockRes();
      await handler({
        method: 'POST',
        query: { _version: 'v2', view: '_perf' },
        headers: {},
        body: { metric_type: 'page_load', endpoint: 'render:metrics', duration_ms: 999999, workspace_id: validWs }
      }, r1);
      assert.equal(r1._status, 204);
      assert.equal(inserted.duration_ms, 60000);

      // Non-printable endpoint should be dropped before insert
      inserted = null;
      const r2 = mockRes();
      await handler({
        method: 'POST',
        query: { _version: 'v2', view: '_perf' },
        headers: {},
        body: { metric_type: 'page_load', endpoint: 'bad\x01endpoint', duration_ms: 50, workspace_id: validWs }
      }, r2);
      assert.equal(r2._status, 204);
      assert.equal(inserted, null, 'expected no insert for non-printable endpoint');
    });

    it('drops malformed UUIDs but still records the metric anonymously', async () => {
      let inserted = null;
      global.fetch = async (url, opts = {}) => {
        if (String(url).endsWith('/rest/v1/perf_metrics')) inserted = JSON.parse(opts.body);
        return jsonResponse([{ id: 1 }], true, 201);
      };
      const handler = await loadHandler();
      const res = mockRes();
      await handler({
        method: 'POST',
        query: { _version: 'v2', view: '_perf' },
        headers: {},
        body: {
          metric_type: 'client_render',
          endpoint: 'render:metrics',
          duration_ms: 401,
          workspace_id: 'not-a-uuid',
          user_id: 'also-not-a-uuid'
        }
      }, res);
      assert.equal(res._status, 204);
      assert.ok(inserted, 'expected an insert');
      assert.equal(inserted.workspace_id, null);
      assert.equal(inserted.user_id, null);
    });

    it('returns 204 silently when ops DB is not configured', async () => {
      delete process.env.OPS_SUPABASE_URL;
      delete process.env.OPS_SUPABASE_KEY;
      let calledFetch = false;
      global.fetch = async () => { calledFetch = true; return jsonResponse([], true, 201); };
      const handler = await loadHandler();
      const res = mockRes();
      await handler({
        method: 'POST',
        query: { _version: 'v2', view: '_perf' },
        headers: {},
        body: { metric_type: 'page_load', endpoint: 'render:my_work', duration_ms: 100 }
      }, res);
      assert.equal(res._status, 204);
      assert.equal(calledFetch, false, 'should not hit Supabase when ops creds missing');
    });
  });
});
