import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = global.fetch;
const ENV_KEYS = ['OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function captureFetch(rangeHeader = null) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', headers: { ...opts.headers } });
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          if (name.toLowerCase() === 'content-range' && rangeHeader) return rangeHeader;
          return null;
        }
      },
      async text() { return '[]'; }
    };
  };
  return calls;
}

async function loadOpsQuery() {
  // Cache-bust so each test sees the env we just set.
  const mod = await import(`../api/_shared/ops-db.js?test=${Date.now()}-${Math.random()}`);
  return mod.opsQuery;
}

describe('opsQuery countMode', () => {
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

  it('defaults to count=exact on GET (backward compatible)', async () => {
    const calls = captureFetch();
    const opsQuery = await loadOpsQuery();
    await opsQuery('GET', 'foo?id=eq.1');
    assert.equal(calls[0].headers.Prefer, 'count=exact');
  });

  it('honors countMode=estimated', async () => {
    const calls = captureFetch();
    const opsQuery = await loadOpsQuery();
    await opsQuery('GET', 'foo?id=eq.1', undefined, { countMode: 'estimated' });
    assert.equal(calls[0].headers.Prefer, 'count=estimated');
  });

  it('omits the Prefer count header when countMode=none', async () => {
    const calls = captureFetch();
    const opsQuery = await loadOpsQuery();
    await opsQuery('GET', 'foo?id=eq.1', undefined, { countMode: 'none' });
    assert.equal(calls[0].headers.Prefer, undefined,
      'no Prefer header should be sent when count is suppressed');
  });

  it('falls back to count=exact when countMode is invalid', async () => {
    const calls = captureFetch();
    const opsQuery = await loadOpsQuery();
    await opsQuery('GET', 'foo', undefined, { countMode: 'evil' });
    assert.equal(calls[0].headers.Prefer, 'count=exact');
  });

  it('still parses the count from content-range when present', async () => {
    captureFetch('0-9/42');
    const opsQuery = await loadOpsQuery();
    const r = await opsQuery('GET', 'foo', undefined, { countMode: 'estimated' });
    assert.equal(r.count, 42);
  });

  it('returns count=0 when no content-range header is sent (countMode=none)', async () => {
    captureFetch(null);
    const opsQuery = await loadOpsQuery();
    const r = await opsQuery('GET', 'foo', undefined, { countMode: 'none' });
    assert.equal(r.count, 0);
  });

  it('preserves return=representation default for POST', async () => {
    const calls = captureFetch();
    const opsQuery = await loadOpsQuery();
    await opsQuery('POST', 'foo', { x: 1 });
    assert.equal(calls[0].headers.Prefer, 'return=representation');
  });

  it('countMode is GET-only — POST keeps return=representation regardless', async () => {
    const calls = captureFetch();
    const opsQuery = await loadOpsQuery();
    await opsQuery('POST', 'foo', { x: 1 }, { countMode: 'estimated' });
    assert.equal(calls[0].headers.Prefer, 'return=representation');
  });

  it('honors explicit headers via opts.headers (overrides default Prefer)', async () => {
    const calls = captureFetch();
    const opsQuery = await loadOpsQuery();
    await opsQuery('POST', 'foo', { x: 1 }, { headers: { Prefer: 'return=minimal' } });
    assert.equal(calls[0].headers.Prefer, 'return=minimal');
  });

  it('backward compat: legacy 4th-arg flat headers still work', async () => {
    const calls = captureFetch();
    const opsQuery = await loadOpsQuery();
    // Pre-existing call sites that pass a plain { Prefer: ... } object.
    await opsQuery('POST', 'foo', { x: 1 }, { Prefer: 'return=minimal' });
    assert.equal(calls[0].headers.Prefer, 'return=minimal');
  });

  it('returns 503 shape when ops env is missing (no fetch)', async () => {
    delete process.env.OPS_SUPABASE_URL;
    delete process.env.OPS_SUPABASE_KEY;
    let calledFetch = false;
    global.fetch = async () => { calledFetch = true; throw new Error('should not fetch'); };
    const opsQuery = await loadOpsQuery();
    const r = await opsQuery('GET', 'foo', undefined, { countMode: 'estimated' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
    assert.equal(calledFetch, false);
  });
});
