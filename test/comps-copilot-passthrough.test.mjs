// ============================================================================
// Comps auth via the shared authenticate() passthrough (Prompt 68, 2026-08-07)
//
// THE INCIDENT this prevents: on the Copilot LCC Deal Agent, briefing/queue
// worked but comps failed with ConnectorAuthorizationError. Cause: comps was the
// only tool that validated the connection's LCC_API_KEY (bespoke
// `providedKey !== LCC_API_KEY → 401`), while the other 19 tools ride
// authenticate()'s M365 passthrough (_copilot_path → allowed, no key checked).
// Prompt 68 routes comps through the SAME authenticate(), so:
//   • Copilot-namespaced call (has _copilot_path, no key) → passthrough → allowed.
//   • Flat-route ChatGPT/MCP call (real LCC_API_KEY) → validated → allowed.
//   • Anonymous flat-route call in production → still 401 (no downgrade).
// Plus a bearer-parse hardening: a doubled "Bearer Bearer <key>" still validates.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    type() { return this; },
    send(body) { this.body = body; return this; },
    end() { return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

async function freshAuth(tag) {
  return import(`../api/_shared/auth.js?case=${tag}-${Date.now()}-${Math.random()}`);
}

describe('Prompt 68 — comps ride the shared authenticate() passthrough', () => {
  it('copilot-namespaced request (has _copilot_path, no key) authenticates via passthrough', async () => {
    process.env.LCC_API_KEY = 'real-key';
    process.env.LCC_ENV = 'production';
    delete process.env.OPS_SUPABASE_URL;
    delete process.env.OPS_SUPABASE_KEY;

    const { authenticate } = await freshAuth('copilot');
    const req = { headers: {}, query: { _copilot_path: 'query-comps' } };
    const res = mockRes();

    const user = await authenticate(req, res);
    assert.equal(res.statusCode, null, 'passthrough must not 401');
    assert.ok(user && user._copilot_plugin, 'returns the copilot-plugin user');
  });

  it('flat request with no credentials still 401s in production', async () => {
    process.env.LCC_API_KEY = 'real-key';
    process.env.LCC_ENV = 'production';
    delete process.env.OPS_SUPABASE_URL;
    delete process.env.OPS_SUPABASE_KEY;

    const { authenticate } = await freshAuth('flat-anon');
    const req = { headers: {}, query: {} };
    const res = mockRes();

    const user = await authenticate(req, res);
    assert.equal(user, null, 'anonymous flat-route call is rejected');
    assert.equal(res.statusCode, 401, 'still 401 in production — no security downgrade');
  });

  it('flat request with a valid X-LCC-Key authenticates (ChatGPT/MCP surface)', async () => {
    process.env.LCC_API_KEY = 'real-key';
    process.env.LCC_ENV = 'production';
    delete process.env.OPS_SUPABASE_URL;
    delete process.env.OPS_SUPABASE_KEY;

    const { authenticate } = await freshAuth('flat-keyed');
    const req = { headers: { 'x-lcc-key': 'real-key' }, query: {} };
    const res = mockRes();

    const user = await authenticate(req, res);
    assert.equal(res.statusCode, null, 'valid key must not 401');
    assert.ok(user, 'returns an authenticated user');
  });

  it('hardened bearer parse: a doubled "Bearer Bearer <key>" still validates', async () => {
    process.env.LCC_API_KEY = 'real-key';
    process.env.LCC_ENV = 'production';
    delete process.env.OPS_SUPABASE_URL;
    delete process.env.OPS_SUPABASE_KEY;

    const { authenticate } = await freshAuth('doubled-bearer');
    const req = { headers: { authorization: 'Bearer Bearer real-key' }, query: {} };
    const res = mockRes();

    const user = await authenticate(req, res);
    assert.equal(res.statusCode, null, 'doubled Bearer prefix must not 401');
    assert.ok(user, 'returns an authenticated user');
  });
});

describe('Prompt 68 — comps handlers gate on authenticate()', () => {
  it('queryCompsHandler on the copilot path passes auth (no 401) with no key', async () => {
    process.env.LCC_API_KEY = 'real-key';
    process.env.LCC_ENV = 'production';
    delete process.env.OPS_SUPABASE_URL;
    delete process.env.OPS_SUPABASE_KEY;

    const { default: queryCompsHandler } = await import(`../api/query-comps.js?case=${Date.now()}`);
    // GET → the handler returns 405 AFTER auth, proving auth passed (not 401)
    // and avoiding any outbound fetch to the comps engine.
    const req = { method: 'GET', headers: {}, query: { _copilot_path: 'query-comps' }, path: '/api/copilot/comps/query-comps' };
    const res = mockRes();

    await queryCompsHandler(req, res);
    assert.notEqual(res.statusCode, 401, 'copilot-path comps call must not be rejected by auth');
    assert.equal(res.statusCode, 405, 'auth passed; method gate returns 405 for GET');
  });

  it('compsHandler on the copilot path passes auth (no 401) with no key', async () => {
    process.env.LCC_API_KEY = 'real-key';
    process.env.LCC_ENV = 'production';
    delete process.env.OPS_SUPABASE_URL;
    delete process.env.OPS_SUPABASE_KEY;
    delete process.env.BOV_API_KEY; // force the post-auth 500 rather than an outbound fetch

    const { default: compsHandler } = await import(`../api/comps.js?case=${Date.now()}`);
    const req = { method: 'POST', headers: {}, query: { _copilot_path: 'generate-comps' }, body: { comp_type: 'sales', sold: [{}] } };
    const res = mockRes();

    await compsHandler(req, res);
    assert.notEqual(res.statusCode, 401, 'copilot-path comps call must not be rejected by auth');
    assert.equal(res.statusCode, 500, 'auth passed; BOV_API_KEY-not-configured 500 (server-side, not inbound auth)');
  });

  it('queryCompsHandler on a flat route with no credentials 401s in production', async () => {
    process.env.LCC_API_KEY = 'real-key';
    process.env.LCC_ENV = 'production';
    delete process.env.OPS_SUPABASE_URL;
    delete process.env.OPS_SUPABASE_KEY;

    const { default: queryCompsHandler } = await import(`../api/query-comps.js?case=${Date.now()}-flat`);
    const req = { method: 'POST', headers: {}, query: {}, path: '/api/query-comps', body: {} };
    const res = mockRes();

    await queryCompsHandler(req, res);
    assert.equal(res.statusCode, 401, 'anonymous flat-route comps call still 401s');
  });
});
