// mobile-share.js — iPhone Share Sheet ingestion classification + routing.
//
// The mobile-share route reuses the news-alert scoring module (no drift) to
// classify a shared URL/title into a domain + confidence, then routes it to a
// touch (existing entity), a lead (new strong signal), or review (low conf).
// This proves the PURE logic the HTTP handler depends on, without the DB.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMobileShare, decideMobileShareOutcome, extractCityState,
} from '../api/_handlers/mobile-share.js';

describe('classifyMobileShare — source detection', () => {
  it('a linkedin.com URL is tagged linkedin', () => {
    const c = classifyMobileShare({ url: 'https://www.linkedin.com/posts/foo_abc', title: 'x' });
    assert.equal(c.source, 'linkedin');
  });

  it('a linkedin subdomain is tagged linkedin', () => {
    const c = classifyMobileShare({ url: 'https://uk.linkedin.com/in/someone', title: 'x' });
    assert.equal(c.source, 'linkedin');
  });

  it('a non-linkedin URL is tagged web_share', () => {
    const c = classifyMobileShare({ url: 'https://www.bizjournals.com/story', title: 'x' });
    assert.equal(c.source, 'web_share');
  });

  it('a lookalike host (linkedin.com.evil.co) is NOT linkedin', () => {
    const c = classifyMobileShare({ url: 'https://linkedin.com.evil.co/x', title: 'x' });
    assert.equal(c.source, 'web_share');
  });
});

describe('classifyMobileShare — reuses news-alert scoring', () => {
  it('exact tracked tenant in the title → high-confidence auto, domain resolved', () => {
    const c = classifyMobileShare({
      url: 'https://www.linkedin.com/posts/x',
      title: 'DaVita to build a new dialysis center in Dallas, TX',
    });
    assert.equal(c.match_kind, 'exact');
    assert.equal(c.tenant, 'DaVita');
    assert.equal(c.domain, 'dialysis');
    assert.equal(c.route.route, 'auto');
    assert.equal(c.city, 'Dallas');
    assert.equal(c.state, 'TX');
    assert.ok(c.confidence >= 0.7);
  });

  it('alias in selected_text → auto, canonical tenant', () => {
    const c = classifyMobileShare({
      url: 'https://example.com/a',
      title: 'New medical building',
      selected_text: 'FMC signed a lease for a new Phoenix clinic',
    });
    assert.equal(c.match_kind, 'alias');
    assert.equal(c.tenant, 'Fresenius');
    assert.equal(c.route.route, 'auto');
  });

  it('government tenant classifies as government', () => {
    const c = classifyMobileShare({
      url: 'https://example.com/g',
      title: 'Social Security Administration signs a new office lease',
    });
    assert.equal(c.domain, 'government');
    assert.equal(c.route.route, 'auto');
  });

  it('keyword-only → review (no tenant, never auto-creates)', () => {
    const c = classifyMobileShare({
      url: 'https://example.com/k',
      title: 'A new dialysis center is coming to town',
    });
    assert.equal(c.match_kind, 'keyword');
    assert.equal(c.tenant, null);
    assert.equal(c.route.route, 'review');
  });

  it('no recognizable content → review', () => {
    const c = classifyMobileShare({ url: 'https://example.com/z', title: 'My weekend photos' });
    assert.equal(c.match_kind, 'none');
    assert.equal(c.route.route, 'review');
  });

  it('a non-http url is not treated as an article_url', () => {
    const c = classifyMobileShare({ url: 'about:blank', title: 'DaVita opens Dallas, TX clinic' });
    assert.equal(c.article_url, null);
  });
});

describe('decideMobileShareOutcome — routing tree', () => {
  const auto = { route: { route: 'auto' } };
  const review = { route: { route: 'review' } };

  it('existing entity → logged (touch), even for an auto signal', () => {
    assert.equal(decideMobileShareOutcome(auto, { existingEntity: { id: 'e1' } }), 'logged');
  });

  it('auto signal + no existing entity → lead_created', () => {
    assert.equal(decideMobileShareOutcome(auto, { existingEntity: null }), 'lead_created');
  });

  it('review signal + no existing entity → needs_review', () => {
    assert.equal(decideMobileShareOutcome(review, {}), 'needs_review');
  });

  it('an entity object without an id does not count as a match', () => {
    assert.equal(decideMobileShareOutcome(auto, { existingEntity: {} }), 'lead_created');
  });
});

describe('extractCityState', () => {
  it('pulls the first City, ST', () => {
    assert.deepEqual(extractCityState('opening in Dallas, TX next year'), { city: 'Dallas', state: 'TX' });
  });
  it('null when absent', () => {
    assert.deepEqual(extractCityState('no location here'), { city: null, state: null });
  });
});
