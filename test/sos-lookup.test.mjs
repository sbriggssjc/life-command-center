// CONTACT-SELECTION Slice 4 — Phase B: SOS framework tests.
//
// FRAMEWORK only (no live scraper): state inference, the person guard, the
// adapter registry/dispatch, and the unconfigured/feature-flag behavior. The
// per-state response PARSERS are deferred (validated against captured responses
// post-deploy), so the registry ships with all states `enabled:false`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferFilingStates, sanitizeSosResult, enabledSosStates,
  buildSosLookupAdapter, SOS_STATE_ADAPTERS,
} from '../api/_shared/sos-lookup.js';

describe('inferFilingStates', () => {
  it('filing state first, owner-state proxy, then DE/NV fallbacks', () => {
    assert.deepEqual(inferFilingStates({ state_of_incorporation: 'fl', owner_state: 'tx' }), ['FL', 'TX', 'DE', 'NV']);
  });
  it('only owner state → that state then DE/NV', () => {
    assert.deepEqual(inferFilingStates({ owner_state: 'CA' }), ['CA', 'DE', 'NV']);
  });
  it('nothing known → DE/NV only', () => {
    assert.deepEqual(inferFilingStates({}), ['DE', 'NV']);
  });
  it('dedupes (DE owner state collapses with the DE fallback)', () => {
    assert.deepEqual(inferFilingStates({ state_of_incorporation: 'DE', owner_state: 'de' }), ['DE', 'NV']);
  });
  it('rejects non-2-letter junk', () => {
    assert.deepEqual(inferFilingStates({ state_of_incorporation: 'Delaware', owner_state: '' }), ['DE', 'NV']);
  });
});

describe('sanitizeSosResult (person guard)', () => {
  it('accepts a plausible human + defaults role', () => {
    assert.deepEqual(sanitizeSosResult({ person_name: '  John  Smith ' }), { person_name: 'John Smith', role: 'managing_member' });
  });
  it('rejects an agent firm / non-person', () => {
    assert.equal(sanitizeSosResult({ person_name: 'Corporation Service Company' }), null);
    assert.equal(sanitizeSosResult({ person_name: 'ACME HOLDINGS LLC' }), null);
    assert.equal(sanitizeSosResult({}), null);
  });
});

describe('registry ships with parsers deferred', () => {
  it('no state is enabled yet (parsers validated post-deploy)', () => {
    assert.equal(enabledSosStates().length, 0);
    for (const a of Object.values(SOS_STATE_ADAPTERS)) { assert.equal(a.enabled, false); assert.equal(a.parse, null); }
  });
});

describe('buildSosLookupAdapter (dispatch + flag)', () => {
  it('unconfigured (no URL) → unconfigured', async () => {
    delete process.env.OWNER_ENRICH_SOS_URL;
    const r = await buildSosLookupAdapter({ fetch: async () => '<html/>' })({ owner_name: 'Acme LLC', owner_state: 'FL' });
    assert.equal(r.reason, 'unconfigured');
  });

  it('URL set but no enabled adapter → unconfigured (parsers deferred)', async () => {
    process.env.OWNER_ENRICH_SOS_URL = 'https://example.test/sos';
    try {
      const r = await buildSosLookupAdapter({ fetch: async () => '<html/>' })({ owner_name: 'Acme LLC', owner_state: 'FL' });
      assert.equal(r.reason, 'unconfigured');
    } finally { delete process.env.OWNER_ENRICH_SOS_URL; }
  });

  it('with an enabled fixture adapter → fetch → parse → guarded attach result', async () => {
    process.env.OWNER_ENRICH_SOS_URL = 'https://example.test/sos';
    try {
      const adapters = {
        FL: { state: 'FL', enabled: true, parse: (body) => (body.includes('PARK') ? { person_name: 'Jennifer Park', role: 'manager' } : null) },
      };
      let fetched = null;
      const fetch = async (adapter, name, st) => { fetched = { name, st }; return 'OFFICER: PARK, JENNIFER'; };
      const r = await buildSosLookupAdapter({ adapters, fetch })({ owner_name: 'DV Wyoming LLC', owner_state: 'FL' });
      assert.equal(r.ok, true);
      assert.equal(r.state_resolved, 'FL');
      assert.equal(r.person_name, 'Jennifer Park');
      assert.deepEqual(fetched, { name: 'DV Wyoming LLC', st: 'FL' });
    } finally { delete process.env.OWNER_ENRICH_SOS_URL; }
  });

  it('enabled adapter but parse yields nothing → no_result, owner stays queued', async () => {
    process.env.OWNER_ENRICH_SOS_URL = 'https://example.test/sos';
    try {
      const adapters = { NV: { state: 'NV', enabled: true, parse: () => null } };
      const r = await buildSosLookupAdapter({ adapters, fetch: async () => 'no match' })({ owner_name: 'Clayron LP', owner_state: 'ZZ' });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'no_result'); // NV fallback tried
    } finally { delete process.env.OWNER_ENRICH_SOS_URL; }
  });
});
