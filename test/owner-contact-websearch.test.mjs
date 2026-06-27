// owner-contact-websearch proxy — provider-JSON → [{title,snippet,url}] mapping.
//
// The proxy's ONLY job is to map a free-tier search provider's JSON into the
// shape the LCC parser (web-search-enrich.js::extractPrincipalCandidates)
// consumes. The parser has its own tests; this proves the proxy returns the
// shape the parser expects, and degrades to [] on anything unexpected. The
// mapping lives in a pure ESM module shared by the Deno edge function and this
// test (no drift).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBraveResults,
  normalizeSerperResults,
  normalizeProviderResults,
} from '../supabase/functions/owner-contact-websearch/normalize.js';
import { extractPrincipalCandidates } from '../api/_shared/web-search-enrich.js';

describe('normalizeBraveResults', () => {
  it('maps web.results {title, description, url} → {title, snippet, url}', () => {
    const out = normalizeBraveResults({
      web: { results: [
        { title: 'Acme LLC — Florida', description: 'Manager: John A. Smith. Active.', url: 'https://sos.fl/acme' },
        { title: 'Other', description: 'nothing here', url: 'https://x.test' },
      ] },
    });
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { title: 'Acme LLC — Florida', snippet: 'Manager: John A. Smith. Active.', url: 'https://sos.fl/acme' });
  });

  it('skips rows with no title AND no snippet', () => {
    const out = normalizeBraveResults({ web: { results: [{ url: 'https://x.test' }, { title: 'Keep' }] } });
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'Keep');
  });

  it('caps at max results', () => {
    const results = Array.from({ length: 25 }, (_, i) => ({ title: `r${i}`, description: 'd', url: 'u' }));
    const out = normalizeBraveResults({ web: { results } }, 10);
    assert.equal(out.length, 10);
  });

  it('returns [] on malformed / missing payload', () => {
    assert.deepEqual(normalizeBraveResults(null), []);
    assert.deepEqual(normalizeBraveResults({}), []);
    assert.deepEqual(normalizeBraveResults({ web: {} }), []);
    assert.deepEqual(normalizeBraveResults({ web: { results: 'nope' } }), []);
  });
});

describe('normalizeSerperResults', () => {
  it('maps organic {title, snippet, link} → {title, snippet, url}', () => {
    const out = normalizeSerperResults({
      organic: [{ title: 'Acme', snippet: 'Registered agent: Dana Cole', link: 'https://x.test/acme' }],
    });
    assert.deepEqual(out[0], { title: 'Acme', snippet: 'Registered agent: Dana Cole', url: 'https://x.test/acme' });
  });

  it('includes a knowledgeGraph card when present', () => {
    const out = normalizeSerperResults({
      knowledgeGraph: { title: 'Acme LLC', description: 'Managing member: Jane Doe', website: 'https://acme.test' },
      organic: [],
    });
    assert.equal(out[0].title, 'Acme LLC');
    assert.equal(out[0].snippet, 'Managing member: Jane Doe');
  });

  it('returns [] on malformed payload', () => {
    assert.deepEqual(normalizeSerperResults(null), []);
    assert.deepEqual(normalizeSerperResults({}), []);
  });
});

describe('normalizeProviderResults switch', () => {
  it('routes to brave by default / on unknown provider', () => {
    const payload = { web: { results: [{ title: 't', description: 's', url: 'u' }] } };
    assert.equal(normalizeProviderResults('brave', payload).length, 1);
    assert.equal(normalizeProviderResults('', payload).length, 1);
    assert.equal(normalizeProviderResults('mystery', payload).length, 1);
  });

  it('routes to serper when selected', () => {
    const payload = { organic: [{ title: 't', snippet: 's', link: 'u' }] };
    assert.equal(normalizeProviderResults('serper', payload).length, 1);
  });

  it('never throws — returns [] on a hostile shape', () => {
    assert.deepEqual(normalizeProviderResults('brave', undefined), []);
    assert.deepEqual(normalizeProviderResults('serper', 42), []);
  });
});

describe('end-to-end: proxy output feeds the LCC parser', () => {
  it('a Brave result with a labeled role cue → the parser extracts the principal', () => {
    const braveJson = {
      web: { results: [
        { title: 'Acme Holdings LLC', description: 'Florida LLC. Manager: John A. Smith. Status Active.', url: 'https://sos.fl/acme' },
      ] },
    };
    const results = normalizeProviderResults('brave', braveJson);
    const cand = extractPrincipalCandidates(results, 'Acme Holdings LLC');
    assert.equal(cand.person_name, 'John A. Smith');
    assert.equal(cand.role, 'manager');
  });

  it('an empty proxy result → the parser abstains (null) → manual worklist', () => {
    const cand = extractPrincipalCandidates(normalizeProviderResults('brave', { web: { results: [] } }), 'Acme LLC');
    assert.equal(cand, null);
  });
});
