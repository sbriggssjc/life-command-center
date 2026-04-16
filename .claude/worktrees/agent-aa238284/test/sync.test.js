import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = global.fetch;
const originalSetTimeout = global.setTimeout;
const ENV_KEYS = ['OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY', 'PA_COMPLETE_TASK_URL', 'LCC_API_KEY'];
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
  return (await import(`../api/sync.js?test=${Date.now()}-${Math.random()}`)).default;
}

describe('sync handler verification', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';
    delete process.env.LCC_API_KEY;
    delete process.env.PA_COMPLETE_TASK_URL;
    global.setTimeout = (fn, _delay, ...args) => {
      fn(...args);
      return 0;
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('returns Sync Health with outbound success rate and queue drift summary', async () => {
    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const target = String(url);

      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1',
          email: 'dev@example.com',
          display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'operator', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }
      if (target.includes('/rest/v1/connector_accounts?workspace_id=eq.ws-1&select=')) {
        return jsonResponse([
          { id: 'conn-1', user_id: 'user-1', connector_type: 'salesforce', status: 'healthy', last_sync_at: '2026-03-24T10:00:00Z', last_error: null, external_user_id: 'sf-user-1', execution_method: 'power_automate' },
          { id: 'conn-2', user_id: 'user-1', connector_type: 'outlook', status: 'degraded', last_sync_at: '2026-03-24T09:00:00Z', last_error: 'stale token', external_user_id: 'outlook-user-1', execution_method: 'direct_api' }
        ]);
      }
      if (target.includes('/rest/v1/sync_jobs?workspace_id=eq.ws-1&created_at=gte.')) {
        return jsonResponse([
          { id: 'job-1', connector_account_id: 'conn-1', status: 'completed', direction: 'outbound', entity_type: 'complete_sf_task', records_processed: 1, records_failed: 0, correlation_id: 'out-1', started_at: '2026-03-24T09:00:00Z', completed_at: '2026-03-24T09:01:00Z' },
          { id: 'job-2', connector_account_id: 'conn-1', status: 'failed', direction: 'outbound', entity_type: 'log_to_sf', records_processed: 0, records_failed: 1, correlation_id: 'out-2', started_at: '2026-03-24T08:00:00Z', completed_at: '2026-03-24T08:01:00Z' },
          { id: 'job-3', connector_account_id: 'conn-1', status: 'completed', direction: 'inbound', entity_type: 'sf_activity', records_processed: 7, records_failed: 0, correlation_id: 'sf-1', started_at: '2026-03-24T07:00:00Z', completed_at: '2026-03-24T07:02:00Z' }
        ]);
      }
      if (target.includes('/rest/v1/sync_errors?workspace_id=eq.ws-1&resolved_at=is.null')) {
        return jsonResponse([{ id: 'err-1', connector_account_id: 'conn-1', error_message: 'sync failed', is_retryable: true, retry_count: 0, created_at: '2026-03-24T08:01:00Z' }]);
      }
      if (target.includes('/rest/v1/inbox_items?workspace_id=eq.ws-1&source_type=eq.sf_task&status=in.(new,triaged)')) {
        return jsonResponse([{ id: 'task-1' }], true, 200, { 'content-range': '0-0/19' });
      }

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'GET',
      query: { action: 'health' },
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._json.summary.total_connectors, 2);
    assert.equal(res._json.summary.outbound_success_rate_24h, 0.5);
    assert.equal(res._json.queue_drift.salesforce_open_task_count, 19);
    assert.equal(res._json.queue_drift.last_sf_records_processed, 7);
    assert.equal(res._json.queue_drift.estimated_gap, 12);
    assert.equal(res._json.queue_drift.drift_flag, false);
  });

  it('records sync error and perf metrics when Salesforce task completion fails', async () => {
    process.env.PA_COMPLETE_TASK_URL = 'https://flows.example.com/complete-task';

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
      if (target.includes('/rest/v1/connector_accounts?user_id=eq.user-1&workspace_id=eq.ws-1&connector_type=eq.salesforce')) {
        return jsonResponse([{
          id: 'conn-1',
          workspace_id: 'ws-1',
          user_id: 'user-1',
          connector_type: 'salesforce',
          execution_method: 'power_automate',
          display_name: 'Salesforce',
          status: 'healthy',
          external_user_id: 'sf-user-1',
          config: { flow_id: 'flow-1' }
        }]);
      }
      if (target.endsWith('/rest/v1/sync_jobs') && method === 'POST') {
        return jsonResponse([{ id: 'job-1' }]);
      }
      if (target.includes('/rest/v1/sync_jobs?id=eq.job-1') && method === 'PATCH') {
        return jsonResponse([{ id: 'job-1', status: 'failed' }]);
      }
      if (target.endsWith('/rest/v1/sync_errors') && method === 'POST') {
        return jsonResponse([{ id: 'sync-error-1' }]);
      }
      if (target.includes('/rest/v1/connector_accounts?id=eq.conn-1') && method === 'PATCH') {
        return jsonResponse([{ id: 'conn-1', status: 'degraded' }]);
      }
      if (target.endsWith('/rest/v1/perf_metrics') && method === 'POST') {
        return jsonResponse([{ id: 'metric-1' }]);
      }
      if (target === 'https://flows.example.com/complete-task') {
        return jsonResponse({ error: 'flow failed' }, false, 500);
      }

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'POST',
      query: { action: 'complete_sf_task' },
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      body: {
        sf_contact_id: 'sf-contact-1',
        subject: 'Call owner',
        action: 'complete'
      }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 502);
    assert.equal(res._json.sync_job_id, 'job-1');
    assert.match(res._json.correlation_id, /^sf-task-complete-/);
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/sync_errors') && call.method === 'POST'));
    assert.ok(calls.some((call) => call.url.endsWith('/rest/v1/perf_metrics') && call.method === 'POST'));
    assert.ok(calls.some((call) => call.url === 'https://flows.example.com/complete-task'));
  });
});
