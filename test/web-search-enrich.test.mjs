// CONTACT-SELECTION Slice 4 — Phase D web-search framework tests.
//
// The principal-candidate parser is pure, so it is validated here against
// realistic labeled-result fixtures. The search HTTP is a deferred fetcher.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractPrincipalCandidates, buildWebSearchAdapter } from '../api/_shared/web-search-enrich.js';

describe('extractPrincipalCandidates', () => {
  it('takes a name adjacent to a strong role cue (Manager:)', () => {
    const r = extractPrincipalCandidates([{ snippet: 'Florida LLC. Manager: John A. Smith. Active.' }], 'Acme LLC');
    assert.equal(r.person_name, 'John A. Smith');
    assert.equal(r.role, 'manager');
    assert.equal(r.confidence, 'medium');
  });

  it('handles SOS "LAST, FIRST" after an Authorized Person cue', () => {
    const r = extractPrincipalCandidates([{ snippet: 'Authorized Person(s): SMITH, JANE — Managing.' }], 'Acme LLC');
    assert.equal(r.person_name, 'JANE SMITH');
  });

  it('corroboration across ≥2 results → high confidence', () => {
    const r = extractPrincipalCandidates([
      { snippet: 'Manager: Dana Cole' }, { title: 'Registered agent: Dana Cole', snippet: '' },
    ], 'Acme LLC');
    assert.equal(r.person_name, 'Dana Cole');
    assert.equal(r.confidence, 'high');
    assert.equal(r.hits, 2);
  });

  it('never returns a firm / the owner name / an un-cued phrase', () => {
    assert.equal(extractPrincipalCandidates([{ snippet: 'Manager: ACME HOLDINGS LLC' }], 'x'), null);
    assert.equal(extractPrincipalCandidates([{ snippet: 'Manager: Carrollwood Investors' }], 'Carrollwood Investors'), null);
    assert.equal(extractPrincipalCandidates([{ snippet: 'John Smith is a great guy in town' }], 'x'), null);
    assert.equal(extractPrincipalCandidates([], 'x'), null);
  });
});

describe('buildWebSearchAdapter', () => {
  it('unconfigured → unconfigured', async () => {
    delete process.env.OWNER_ENRICH_WEBSEARCH_URL;
    const r = await buildWebSearchAdapter({ search: async () => [{ snippet: 'Manager: John Smith' }] })({ owner_name: 'Acme LLC' });
    assert.equal(r.reason, 'unconfigured');
  });

  it('configured + corroborated result → ok high', async () => {
    process.env.OWNER_ENRICH_WEBSEARCH_URL = 'https://example.test/search';
    try {
      const search = async () => [{ snippet: 'Manager: John Smith' }, { snippet: 'officer John Smith' }];
      const r = await buildWebSearchAdapter({ search })({ owner_name: 'Acme LLC', owner_state: 'FL' });
      assert.equal(r.ok, true);
      assert.equal(r.person_name, 'John Smith');
      assert.equal(r.confidence, 'high');
    } finally { delete process.env.OWNER_ENRICH_WEBSEARCH_URL; }
  });

  it('no labeled candidate → no_confident_match (→ worklist)', async () => {
    process.env.OWNER_ENRICH_WEBSEARCH_URL = 'https://example.test/search';
    try {
      const r = await buildWebSearchAdapter({ search: async () => [{ snippet: 'no principals named here' }] })({ owner_name: 'Acme LLC' });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'no_confident_match');
    } finally { delete process.env.OWNER_ENRICH_WEBSEARCH_URL; }
  });

  it('OWNER_ENRICH_WEBSEARCH_MIN=high rejects a single medium hit', async () => {
    process.env.OWNER_ENRICH_WEBSEARCH_URL = 'https://example.test/search';
    process.env.OWNER_ENRICH_WEBSEARCH_MIN = 'high';
    try {
      const r = await buildWebSearchAdapter({ search: async () => [{ snippet: 'Manager: Solo Person' }] })({ owner_name: 'Acme LLC' });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'below_confidence_floor');
    } finally { delete process.env.OWNER_ENRICH_WEBSEARCH_URL; delete process.env.OWNER_ENRICH_WEBSEARCH_MIN; }
  });
});
