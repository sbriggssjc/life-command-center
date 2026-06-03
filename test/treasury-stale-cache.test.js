// QA#5 — handleTreasury last-good cache.
//
// Verifies that once a Treasury fetch succeeds, a subsequent total upstream
// outage degrades to the last-good payload (HTTP 200, stale:true) instead of
// returning 500 and blanking the rate widget.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = global.fetch;
const ENV_KEYS = ['OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY'];
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

// A treasury.gov XML response with two business days of 10yr/30yr rates.
function xmlResponse() {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed>
  <entry><content><m:properties>
    <d:NEW_DATE>2026-06-01T00:00:00</d:NEW_DATE>
    <d:BC_10YEAR>4.20</d:BC_10YEAR>
    <d:BC_30YEAR>4.40</d:BC_30YEAR>
  </m:properties></content></entry>
  <entry><content><m:properties>
    <d:NEW_DATE>2026-06-02T00:00:00</d:NEW_DATE>
    <d:BC_10YEAR>4.25</d:BC_10YEAR>
    <d:BC_30YEAR>4.45</d:BC_30YEAR>
  </m:properties></content></entry>
</feed>`;
  return {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    async text() { return body; },
    async json() { return {}; }
  };
}

async function loadHandler() {
  // Fresh module each time would reset the module-level cache, which we DON'T
  // want here — both requests must hit the same loaded module instance.
  return (await import('../api/admin.js')).default;
}

describe('admin /_route=treasury last-good cache', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('serves last-good stale data when all upstream sources fail after a prior success', async () => {
    const handler = await loadHandler();

    // 1) First call: treasury.gov XML succeeds and primes the cache.
    global.fetch = async (url) => {
      if (String(url).includes('home.treasury.gov')) return xmlResponse();
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const okRes = mockRes();
    await handler({ method: 'GET', query: { _route: 'treasury' }, headers: {} }, okRes);
    assert.equal(okRes._status, 200);
    assert.equal(okRes._json.ten_yr, 4.25, 'latest 10yr from primed fetch');
    assert.equal(okRes._json.stale, undefined, 'fresh data is not flagged stale');

    // 2) Second call: every upstream throws — should degrade to last-good.
    global.fetch = async () => { throw new Error('treasury.gov outage'); };
    const staleRes = mockRes();
    await handler({ method: 'GET', query: { _route: 'treasury' }, headers: {} }, staleRes);
    assert.equal(staleRes._status, 200, 'stale fallback returns 200, not 500');
    assert.equal(staleRes._json.stale, true, 'fallback payload is flagged stale');
    assert.equal(staleRes._json.ten_yr, 4.25, 'returns the cached 10yr value');
    assert.equal(staleRes._json.as_of, '2026-06-02', 'as_of reflects the cached date');
  });

  it('returns 500 when upstream fails and no cache exists yet', async () => {
    // Force a brand-new module instance (empty cache) via a cache-busting query.
    const freshHandler = (await import(`../api/admin.js?fresh=${Date.now()}-${Math.random()}`)).default;
    global.fetch = async () => { throw new Error('treasury.gov outage'); };
    const res = mockRes();
    await freshHandler({ method: 'GET', query: { _route: 'treasury' }, headers: {} }, res);
    assert.equal(res._status, 500, 'no cache → genuine 500');
  });
});
