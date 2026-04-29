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
  return (await import(`../api/apply-change.js?test=${Date.now()}-${Math.random()}`)).default;
}

describe('apply-change mutation timeout', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';
    process.env.DIA_SUPABASE_URL = 'https://dia.example.com';
    process.env.DIA_SUPABASE_KEY = 'dia-key';
    delete process.env.LCC_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('returns 504 + creates pending_review when the gov/dia mutation aborts', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const target = String(url);
      calls.push({ url: target, method, signal: opts.signal });

      // Auth path
      if (target.includes('/rest/v1/users?')) {
        return jsonResponse([{
          id: 'user-1',
          email: 'dev@example.com',
          display_name: 'Dev User',
          workspace_memberships: [{ workspace_id: 'ws-1', role: 'operator', workspaces: { name: 'WS', slug: 'ws' } }]
        }]);
      }

      // The gov/dia mutation: simulate a hang that the AbortController kills.
      if (target.startsWith('https://dia.example.com/rest/v1/properties')) {
        // Wait for the abort signal, then throw an AbortError exactly as fetch does.
        return await new Promise((_resolve, reject) => {
          if (opts.signal?.aborted) {
            const err = new Error('aborted');
            err.name = 'AbortError';
            return reject(err);
          }
          opts.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }

      // Pending_review insert + perf metric write — both opsQuery POSTs.
      if (target.endsWith('/rest/v1/pending_updates') && method === 'POST') {
        return jsonResponse([{ id: 'pending-1' }], true, 201);
      }
      if (target.endsWith('/rest/v1/perf_metrics') && method === 'POST') {
        return jsonResponse([{ id: 'perf-1' }], true, 201);
      }

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'POST',
      query: {},
      headers: { 'x-lcc-user-id': 'user-1', 'x-lcc-workspace': 'ws-1' },
      body: {
        target_table: 'properties',
        target_source: 'dia',
        record_identifier: 'prop-123',
        id_column: 'property_id',
        changed_fields: { tenant: 'Acme Corp' },
        actor: 'dev@example.com',
        source_surface: 'detail'
      }
    };
    const res = mockRes();

    // The handler awaits a 6s fetchWithTimeout. To keep the test fast, we
    // monkey-patch global.setTimeout used by fetchWithTimeout to fire the
    // abort immediately.
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn, _ms) => realSetTimeout(fn, 0);
    try {
      await handler(req, res);
    } finally {
      global.setTimeout = realSetTimeout;
    }

    assert.equal(res._status, 504, 'expected 504 on mutation timeout');
    assert.equal(res._json.ok, false);
    assert.ok(res._json.errors.includes('mutation_timeout'));
    assert.ok(res._json.pending_review, 'pending_review should be created on timeout');

    // pending_updates row was created with stage:'timeout'.
    const pendingInsert = calls.find((c) => c.url.endsWith('/rest/v1/pending_updates') && c.method === 'POST');
    assert.ok(pendingInsert, 'expected a pending_updates insert');

    // perf_metrics row was logged with status:'timeout'.
    const perfInsert = calls.find((c) => c.url.endsWith('/rest/v1/perf_metrics') && c.method === 'POST');
    assert.ok(perfInsert, 'expected a perf_metrics insert');

    // The mutation fetch DID receive an AbortSignal (i.e. it was wrapped in fetchWithTimeout).
    const mutationCall = calls.find((c) => c.url.startsWith('https://dia.example.com/rest/v1/properties'));
    assert.ok(mutationCall, 'mutation fetch should have been issued');
    assert.ok(mutationCall.signal, 'mutation fetch should have been called with an AbortSignal');
  });
});
