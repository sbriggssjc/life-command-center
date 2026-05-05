// Smoke tests for the availability-checker Edge Function's per-site
// HTML parsers. The Edge Function itself runs on Deno; this test loads
// supabase/functions/availability-checker/parsers.ts via tsx and
// exercises the marker matrix that powers off-market detection.
//
// What we cover:
//   - CREXi / CoStar / LoopNet active page → still_available
//   - "no longer available" / "off market" / "under contract" banners → off_market
//   - Sold banners and JSON-LD availability → off_market_sold_hint
//     (worker NEVER promotes these to status='sold' — see index.ts notes)
//   - 4xx / 5xx / Cloudflare interstitial → unreachable
//   - Per-site redirect-to-search fingerprints → off_market

// Run with: npx tsx --test test/availability-checker-parsers.test.js
// (tsx's loader handles the .ts import below; no register() needed.)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { parseListing } = await import(
  '../supabase/functions/availability-checker/parsers.ts'
);

describe('availability-checker parsers', () => {
  it('classifies a CREXi active page as still_available', () => {
    const html = '<html><body><h1>For Sale</h1>' +
      '<div>Asking Price: $4,250,000</div>' +
      '<div>Investment Highlights</div></body></html>';
    const r = parseListing(html, 'https://www.crexi.com/properties/12345/sample', 200);
    assert.equal(r.outcome, 'still_available');
    assert.equal(r.parser, 'crexi');
    assert.equal(r.http_status, 200);
  });

  it('classifies a CREXi "no longer available" banner as off_market', () => {
    const html = '<html><body><h1>This Listing Is No Longer Available</h1></body></html>';
    const r = parseListing(html, 'https://www.crexi.com/properties/9999/sample', 200);
    assert.equal(r.outcome, 'off_market');
    assert.equal(r.reason, 'withdrawn');
  });

  it('classifies CREXi JSON-LD availability=SoldOut as off_market_sold_hint', () => {
    const html = '<script type="application/ld+json">' +
      '{"@type":"Offer","availability":"https://schema.org/SoldOut"}</script>';
    const r = parseListing(html, 'https://www.crexi.com/properties/8888/sample', 200);
    assert.equal(r.outcome, 'off_market_sold_hint');
    assert.equal(r.reason, 'unverified_assumed_off');
  });

  it('classifies a 404 as unreachable (not off_market)', () => {
    const r = parseListing('Not Found', 'https://www.crexi.com/properties/zzz/sample', 404);
    assert.equal(r.outcome, 'unreachable');
    assert.equal(r.http_status, 404);
  });

  it('detects a CREXi redirect to /properties as off_market', () => {
    const r = parseListing('<html>search shell</html>', 'https://www.crexi.com/properties', 200);
    assert.equal(r.outcome, 'off_market');
    assert.match(r.matched, /redirect-to-search/);
  });

  it('classifies CoStar "property has been sold" as off_market_sold_hint', () => {
    const r = parseListing(
      '<html><body>This property has been sold.</body></html>',
      'https://www.costar.com/property/123',
      200,
    );
    assert.equal(r.outcome, 'off_market_sold_hint');
    assert.equal(r.parser, 'costar');
  });

  it('detects a CoStar redirect to /search as off_market', () => {
    const r = parseListing(
      '<html>search results</html>',
      'https://www.costar.com/search?foo=1',
      200,
    );
    assert.equal(r.outcome, 'off_market');
    assert.equal(r.parser, 'costar');
  });

  it('classifies a LoopNet "Under Contract" page as off_market', () => {
    const r = parseListing(
      '<html>Status: Under Contract</html>',
      'https://www.loopnet.com/Listing/abc',
      200,
    );
    assert.equal(r.outcome, 'off_market');
    assert.equal(r.parser, 'loopnet');
  });

  it('classifies a LoopNet 503 as unreachable', () => {
    const r = parseListing('Service Unavailable', 'https://www.loopnet.com/Listing/xyz', 503);
    assert.equal(r.outcome, 'unreachable');
    assert.equal(r.http_status, 503);
  });

  it('classifies a LoopNet active page as still_available', () => {
    const html = '<html><body>For Sale by Northmarq. Asking price $5M. ' +
      'Investment Highlights below.</body></html>';
    const r = parseListing(html, 'https://www.loopnet.com/Listing/healthy', 200);
    assert.equal(r.outcome, 'still_available');
    assert.equal(r.parser, 'loopnet');
  });

  it('detects a Cloudflare interstitial (200 with challenge body) as unreachable', () => {
    const html = '<html>checking your browser before accessing... ' +
      'cf-browser-verification</html>';
    const r = parseListing(html, 'https://www.crexi.com/properties/blocked', 200);
    assert.equal(r.outcome, 'unreachable');
  });
});
