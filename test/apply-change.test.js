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
    }
  };
}

async function loadHandler() {
  return (await import(`../api/apply-change.js?test=${Date.now()}-${Math.random()}`)).default;
}

describe('apply-change handler', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.DIA_SUPABASE_URL = 'https://dia.example.com';
    process.env.DIA_SUPABASE_KEY = 'dia-key';
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

  it('applies composite-filter PATCH mutations', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), opts });
      return jsonResponse([{ id: 'row-1', status: 'Completed' }]);
    };

    const handler = await loadHandler();
    const req = {
      method: 'POST',
      headers: {},
      body: {
        actor: 'Tester',
        source_surface: 'unit_test',
        target_table: 'salesforce_activities',
        target_source: 'dia',
        record_identifier: 'contact-1',
        id_column: 'sf_contact_id',
        match_filters: [{ column: 'subject', value: 'Call owner' }],
        changed_fields: { status: 'Completed' }
      }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._json.ok, true);
    assert.equal(res._json.applied_mode, 'mutation_service');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.method, 'PATCH');
    assert.match(calls[0].url, /sf_contact_id=eq\.contact-1/);
    assert.match(calls[0].url, /subject=eq\.Call%20owner/);
  });

  it('applies audited insert mutations and returns inserted rows', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), opts });
      return jsonResponse([{ outcome_id: 'outcome-1', clinic_id: 'clinic-1', status: 'completed' }]);
    };

    const handler = await loadHandler();
    const req = {
      method: 'POST',
      headers: {},
      body: {
        actor: 'Tester',
        source_surface: 'unit_test',
        target_table: 'research_queue_outcomes',
        target_source: 'dia',
        mutation_mode: 'insert',
        record_identifier: 'clinic-1',
        id_column: 'clinic_id',
        changed_fields: {
          queue_type: 'clinic_lead',
          clinic_id: 'clinic-1',
          status: 'completed'
        }
      }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._json.ok, true);
    assert.equal(res._json.applied_mode, 'mutation_insert');
    assert.deepEqual(res._json.rows, [{ outcome_id: 'outcome-1', clinic_id: 'clinic-1', status: 'completed' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.method, 'POST');
    assert.match(calls[0].url, /\/research_queue_outcomes$/);
    assert.match(calls[0].opts.headers.Prefer, /resolution=ignore-duplicates/);
  });

  it('creates a pending review record when a patch mutation fails', async () => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';

    const calls = [];
    global.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), opts });
      if (String(url).includes('dia.example.com/rest/v1/salesforce_activities')) {
        return jsonResponse({ message: 'boom' }, false, 500);
      }
      if (String(url).includes('ops.example.com/rest/v1/pending_updates') && opts.method === 'POST') {
        return jsonResponse([{ id: 'pending-1', status: 'needs_review' }]);
      }
      throw new Error(`Unexpected fetch: ${opts.method} ${url}`);
    };

    const handler = await loadHandler();
    const req = {
      method: 'POST',
      headers: {},
      body: {
        actor: 'Tester',
        source_surface: 'unit_test_failure',
        target_table: 'salesforce_activities',
        target_source: 'dia',
        record_identifier: 'contact-1',
        id_column: 'sf_contact_id',
        changed_fields: { status: 'Completed' }
      }
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 500);
    assert.equal(res._json.ok, false);
    assert.equal(res._json.pending_review.id, 'pending-1');
    assert.ok(calls.some((call) => call.url.includes('/rest/v1/pending_updates') && call.opts.method === 'POST'));
  });
});
