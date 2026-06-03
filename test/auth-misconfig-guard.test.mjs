import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectAuthMisconfig, authReadiness } from '../api/_shared/auth.js';

// ----------------------------------------------------------------------------
// detectAuthMisconfig — the lockout-prevention guard.
// Misconfigured ONLY when enforcement is on AND there is no credential source
// (no LCC_API_KEY for X-LCC-Key AND no OPS_SUPABASE_URL for JWT verification).
// ----------------------------------------------------------------------------
describe('detectAuthMisconfig', () => {
  it('flags production with no API key and no JWT verification', () => {
    const m = detectAuthMisconfig({ LCC_ENV: 'production' });
    assert.equal(m.enforcing, true);
    assert.equal(m.hasApiKey, false);
    assert.equal(m.hasJwtVerification, false);
    assert.equal(m.misconfigured, true);
  });

  it('flags staging with no credential source', () => {
    const m = detectAuthMisconfig({ LCC_ENV: 'staging' });
    assert.equal(m.misconfigured, true);
  });

  it('is safe when production has an API key configured', () => {
    const m = detectAuthMisconfig({ LCC_ENV: 'production', LCC_API_KEY: 'secret' });
    assert.equal(m.enforcing, true);
    assert.equal(m.misconfigured, false);
  });

  it('is safe when production has JWT verification configured', () => {
    const m = detectAuthMisconfig({ LCC_ENV: 'production', OPS_SUPABASE_URL: 'https://x.supabase.co' });
    assert.equal(m.enforcing, true);
    assert.equal(m.hasJwtVerification, true);
    assert.equal(m.misconfigured, false);
  });

  it('never flags development even with no credential source', () => {
    const m = detectAuthMisconfig({ LCC_ENV: 'development' });
    assert.equal(m.enforcing, false);
    assert.equal(m.misconfigured, false);
  });

  it('defaults LCC_ENV to development when unset', () => {
    const m = detectAuthMisconfig({});
    assert.equal(m.lccEnv, 'development');
    assert.equal(m.misconfigured, false);
  });
});

// ----------------------------------------------------------------------------
// authReadiness — read-only probe of the current request's credentials.
// ----------------------------------------------------------------------------
describe('authReadiness', () => {
  it('reports has_jwt for a Bearer token', () => {
    const r = authReadiness({ headers: { authorization: 'Bearer abc.def.ghi' }, query: {} });
    assert.equal(r.has_jwt, true);
    assert.equal(r.would_pass_in_production, true);
  });

  it('a bare "Bearer " with no token is not treated as a JWT', () => {
    const r = authReadiness({ headers: { authorization: 'Bearer ' }, query: {} });
    assert.equal(r.has_jwt, false);
    assert.equal(r.would_pass_in_production, false);
  });

  it('reports has_api_key but api_key_valid=false when LCC_API_KEY is unset', () => {
    // No LCC_API_KEY in this test process → verifyApiKey returns false.
    const r = authReadiness({ headers: { 'x-lcc-key': 'whatever' }, query: {} });
    assert.equal(r.has_api_key, true);
    assert.equal(r.api_key_valid, false);
  });

  it('a no-credential request would NOT pass in production', () => {
    const r = authReadiness({ headers: {}, query: {} });
    assert.equal(r.has_jwt, false);
    assert.equal(r.has_api_key, false);
    assert.equal(r.would_pass_in_production, false);
  });

  it('a copilot passthrough request would pass', () => {
    const r = authReadiness({ headers: {}, query: { _copilot_path: '/foo' } });
    assert.equal(r.is_copilot_path, true);
    assert.equal(r.would_pass_in_production, true);
  });
});
