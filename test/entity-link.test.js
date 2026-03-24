import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ensureEntityLink, normalizeCanonicalName } from '../api/_shared/entity-link.js';

const originalFetch = global.fetch;

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

describe('entity-link helper', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('normalizes canonical names', () => {
    assert.equal(normalizeCanonicalName('Acme Holdings, LLC'), 'acme holdings');
  });

  it('creates a canonical entity and external identity when none exists', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method });
      const u = String(url);
      if (u.includes('/external_identities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.includes('/entities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.endsWith('/entities') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return jsonResponse([{ id: 'entity-1', ...body }]);
      }
      if (u.endsWith('/external_identities') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return jsonResponse([{ id: 'ext-1', ...body }]);
      }
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };

    const result = await ensureEntityLink({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceSystem: 'gov_supabase',
      sourceType: 'asset',
      externalId: 'prop-123',
      domain: 'government',
      seedFields: {
        name: '123 Main St',
        address: '123 Main St',
        city: 'Tulsa',
        state: 'OK',
        asset_type: 'government_leased'
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.entityId, 'entity-1');
    assert.equal(result.createdEntity, true);
    assert.equal(result.createdIdentity, true);
    assert.ok(calls.some(call => call.url.includes('/entities') && call.method === 'POST'));
    assert.ok(calls.some(call => call.url.includes('/external_identities') && call.method === 'POST'));
  });

  it('returns an error when external identity creation fails after entity creation', async () => {
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/external_identities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.includes('/entities?') && opts.method === 'GET') {
        return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
      }
      if (u.endsWith('/entities') && opts.method === 'POST') {
        return jsonResponse([{ id: 'entity-1', name: '123 Main St' }]);
      }
      if (u.endsWith('/external_identities') && opts.method === 'POST') {
        return jsonResponse({ error: 'duplicate conflict' }, false, 409);
      }
      throw new Error(`Unexpected fetch: ${opts.method} ${u}`);
    };

    const result = await ensureEntityLink({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceSystem: 'gov_supabase',
      sourceType: 'asset',
      externalId: 'prop-123',
      domain: 'government',
      seedFields: {
        name: '123 Main St',
        address: '123 Main St',
        city: 'Tulsa',
        state: 'OK',
        asset_type: 'government_leased'
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'Failed to create external identity link');
    assert.equal(result.entity.id, 'entity-1');
  });
});
