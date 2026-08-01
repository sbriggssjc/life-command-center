import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('authenticate Bearer API key compatibility', () => {
  it('accepts Authorization: Bearer <LCC_API_KEY> for Power Automate callers', async () => {
    process.env.LCC_API_KEY = 'pa-test-key';
    process.env.LCC_ENV = 'production';
    delete process.env.OPS_SUPABASE_URL;
    delete process.env.OPS_SUPABASE_KEY;

    const { authenticate, authReadiness } = await import(`../api/_shared/auth.js?case=bearer-${Date.now()}`);
    const req = {
      headers: { authorization: 'Bearer pa-test-key' },
      query: {},
    };
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      setHeader() {},
    };

    const user = await authenticate(req, res);
    assert.equal(res.statusCode, null);
    assert.equal(user.email, 'automation@lcc');
    assert.equal(user._api_key_auth, true);

    const ready = authReadiness(req);
    assert.equal(ready.has_api_key, true);
    assert.equal(ready.api_key_valid, true);
    assert.equal(ready.has_jwt, false);
    assert.equal(ready.would_pass_in_production, true);
  });
});
