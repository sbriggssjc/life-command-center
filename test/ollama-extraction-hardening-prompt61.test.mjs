// Prompt 61 — W5.3 follow-up: ollama extraction hardening + seam fixes.
// Pure-unit coverage for: the hardened prompt builder (full schema keys +
// doc-type rubric + guards), the provider-stamp shape, per-surface Ollama
// gating, the misconfiguration warn, and the explicit-non-listing classify guard.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExtractionPrompt,
  buildProviderStamp,
  EXTRACTION_SCHEMA_KEYS,
  DOC_TYPE_RUBRIC,
} from '../api/_shared/intake-extraction-prompt.js';
import {
  ollamaEnabledForSurface,
  warnIfOllamaMisconfigured,
  isFlagOn,
} from '../api/_shared/ai.js';
import { isExplicitNonListingType } from '../api/_shared/intake-classify.js';

// ---------------------------------------------------------------------------
// #1 — Prompt builder: strict schema + rubric + guards
// ---------------------------------------------------------------------------
describe('Prompt 61 — extraction prompt builder', () => {
  const prompt = buildExtractionPrompt('Document (3 pages) — extracted text:\n\nSSA Falmouth OM …\n');

  it('embeds the document body', () => {
    assert.match(prompt, /SSA Falmouth OM/);
  });

  it('enumerates the FULL expected key list in-prompt', () => {
    // Every schema key (except document_type, which carries the enum) appears as "key".
    for (const key of EXTRACTION_SCHEMA_KEYS) {
      assert.ok(prompt.includes(`"${key}"`), `schema key missing from prompt: ${key}`);
    }
  });

  it('carries the responsibility keys that ollama was dropping', () => {
    for (const key of ['roof_responsibility', 'hvac_responsibility', 'structure_responsibility', 'parking_responsibility']) {
      assert.ok(prompt.includes(`"${key}"`), `responsibility key missing: ${key}`);
    }
  });

  it('includes the doc-type rubric with the real vocabulary', () => {
    for (const [value] of DOC_TYPE_RUBRIC) {
      assert.ok(prompt.includes(`"${value}"`), `rubric value missing: ${value}`);
    }
    // The specific misclassification targets from W5.3 must be present + defined.
    assert.match(prompt, /psa/);
    assert.match(prompt, /listing_agreement/);
    assert.match(prompt, /valuation_proposal/);
    assert.match(prompt, /DOCUMENT-TYPE RUBRIC/);
  });

  it('states the party-role guard (signature blocks are brokers, not sellers)', () => {
    assert.match(prompt, /PARTY-ROLE GUARD/);
    assert.match(prompt, /SIGNATURE BLOCK/);
  });

  it('states the sale-record guard (no sold_* on an on-market OM)', () => {
    assert.match(prompt, /SALE-RECORD GUARD/);
    assert.match(prompt, /leave "sold_price" and "sold_cap_rate" null/);
  });

  it('preserves abstain-don’t-fabricate', () => {
    assert.match(prompt, /NEVER fabricate/);
  });

  it('keeps cap_rate as a decimal fraction and single-JSON-object contract', () => {
    assert.match(prompt, /DECIMAL FRACTION/);
    assert.match(prompt, /single JSON object/);
    assert.match(prompt, /EXACTLY the keys/);
  });
});

// ---------------------------------------------------------------------------
// #2 — Provider stamp shape
// ---------------------------------------------------------------------------
describe('Prompt 61 — provider stamp', () => {
  it('derives final_provider / fell_back / chain from the ai call info', () => {
    const stamp = buildProviderStamp({
      final_provider: 'ollama',
      final_model: 'qwen2.5:14b',
      fell_back: false,
      tried: [{ stage: 'local', provider: 'ollama', status: 200 }],
    });
    assert.equal(stamp.final_provider, 'ollama');
    assert.equal(stamp.final_model, 'qwen2.5:14b');
    assert.equal(stamp.fell_back, false);
    assert.deepEqual(stamp.chain, ['local']);
  });

  it('is null-safe and normalizes a fallback chain', () => {
    assert.deepEqual(buildProviderStamp(null), {
      final_provider: null, final_model: null, fell_back: false, chain: [],
    });
    const s = buildProviderStamp({
      final_provider: 'openai', fell_back: true,
      tried: [{ stage: 'local' }, { stage: 'primary' }, { stage: 'fallback' }],
    });
    assert.deepEqual(s.chain, ['local', 'primary', 'fallback']);
    assert.equal(s.fell_back, true);
  });
});

// ---------------------------------------------------------------------------
// #5 — Per-surface Ollama gating + #3 misconfiguration warn
// ---------------------------------------------------------------------------
describe('Prompt 61 — per-surface Ollama gating', () => {
  const saved = { url: process.env.OLLAMA_URL, surfaces: process.env.OLLAMA_SURFACES, flag: process.env.OLLAMA_EXTRACTION };
  afterEach(() => {
    process.env.OLLAMA_URL = saved.url ?? '';
    process.env.OLLAMA_SURFACES = saved.surfaces ?? '';
    process.env.OLLAMA_EXTRACTION = saved.flag ?? '';
    if (saved.url === undefined) delete process.env.OLLAMA_URL;
    if (saved.surfaces === undefined) delete process.env.OLLAMA_SURFACES;
    if (saved.flag === undefined) delete process.env.OLLAMA_EXTRACTION;
  });

  it('disables every surface when OLLAMA_URL is unset', () => {
    delete process.env.OLLAMA_URL;
    assert.equal(ollamaEnabledForSurface('intake'), false);
    assert.equal(ollamaEnabledForSurface('summaries'), false);
  });

  it('enables all surfaces when OLLAMA_URL set and OLLAMA_SURFACES unset (prior global behavior)', () => {
    process.env.OLLAMA_URL = 'http://gary.local:11434';
    delete process.env.OLLAMA_SURFACES;
    assert.equal(ollamaEnabledForSurface('intake'), true);
    assert.equal(ollamaEnabledForSurface('narrations'), true);
    assert.equal(ollamaEnabledForSurface(undefined), true);
  });

  it('restricts to listed surfaces — the interim revert (intake cloud, narrative local)', () => {
    process.env.OLLAMA_URL = 'http://gary.local:11434';
    process.env.OLLAMA_SURFACES = 'summaries,roles,narrations,next_step';
    assert.equal(ollamaEnabledForSurface('intake'), false);       // reverted to cloud
    assert.equal(ollamaEnabledForSurface('summaries'), true);
    assert.equal(ollamaEnabledForSurface('roles'), true);
    assert.equal(ollamaEnabledForSurface('narrations'), true);
    assert.equal(ollamaEnabledForSurface('next_step'), true);
  });

  it('warns loudly when OLLAMA_EXTRACTION is on but OLLAMA_URL is unset', () => {
    delete process.env.OLLAMA_URL;
    process.env.OLLAMA_EXTRACTION = '1';
    assert.equal(warnIfOllamaMisconfigured(), true);
  });

  it('does not warn when correctly configured', () => {
    process.env.OLLAMA_URL = 'http://gary.local:11434';
    process.env.OLLAMA_EXTRACTION = '1';
    assert.equal(warnIfOllamaMisconfigured(), false);
  });

  it('isFlagOn parses the common truthy/falsey spellings', () => {
    for (const v of ['1', 'true', 'YES', 'on']) assert.equal(isFlagOn(v), true, v);
    for (const v of ['0', 'false', 'no', '', undefined]) assert.equal(isFlagOn(v), false, String(v));
    assert.equal(isFlagOn(undefined, true), true); // fallback honored
  });
});

// ---------------------------------------------------------------------------
// classify guard — explicit non-listing deal types never rescue to 'om'
// ---------------------------------------------------------------------------
describe('Prompt 61 — explicit non-listing classify guard', () => {
  it('flags psa / listing_agreement / valuation_proposal', () => {
    assert.equal(isExplicitNonListingType('psa'), true);
    assert.equal(isExplicitNonListingType('LISTING_AGREEMENT'), true);
    assert.equal(isExplicitNonListingType(' valuation_proposal '), true);
  });
  it('does not flag listing / deal-adjacent types', () => {
    for (const t of ['om', 'flyer', 'marketing_brochure', 'comp', 'unknown', null, '']) {
      assert.equal(isExplicitNonListingType(t), false, String(t));
    }
  });
});
