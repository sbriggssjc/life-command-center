// news-alert.js — cross-vertical Google Alert classification + confidence gate.
//
// The lead-ingest edge function's news_alert action classifies a Google Alert
// into a domain (dialysis / government / netlease), scores it against Scott's
// tracked-tenant watchlist, and routes auto (developer_unknown) vs needs_review.
// This proves the pure logic the Deno handler shares (no drift).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchTenant, scoreNewsAlert, routeNewsAlert, parseGoogleAlert, tenantDedupKey,
  NEWS_ALERT_AUTO_THRESHOLD, DEFAULT_TRACKED_TENANTS,
} from '../supabase/functions/lead-ingest/news-alert.js';

describe('matchTenant — cross-vertical', () => {
  it('exact tenant match reports domain', () => {
    const m = matchTenant(['DaVita to build new dialysis center in Dallas']);
    assert.equal(m.match_kind, 'exact');
    assert.equal(m.tenant, 'DaVita');
    assert.equal(m.domain, 'dialysis');
  });

  it('alias match reports the canonical tenant', () => {
    const m = matchTenant(['FMC opens a new Phoenix clinic']);
    assert.equal(m.match_kind, 'alias');
    assert.equal(m.tenant, 'Fresenius');
    assert.equal(m.domain, 'dialysis');
  });

  it('government tenant classifies as government', () => {
    const m = matchTenant(['Social Security Administration signs new lease']);
    assert.equal(m.match_kind, 'exact');
    assert.equal(m.domain, 'government');
  });

  it('netlease tenant classifies as netlease', () => {
    const m = matchTenant(['Dollar General opening 40 new stores']);
    assert.equal(m.match_kind, 'exact');
    assert.equal(m.domain, 'netlease');
  });

  it('keyword-only match: no tenant, domain from keyword', () => {
    const m = matchTenant(['New dialysis center coming to town']);
    assert.equal(m.match_kind, 'keyword');
    assert.equal(m.tenant, null);
    assert.equal(m.domain, 'dialysis');
  });

  it('no match returns null', () => {
    assert.equal(matchTenant(['Local bakery expands downtown']), null);
  });

  it('word-boundary: VA not matched inside Nevada', () => {
    assert.equal(matchTenant(['Nevada Vanguard opens office']), null);
  });

  it('honors an override watchlist', () => {
    const wl = { netlease: { tenants: [{ name: 'WawaCo', aliases: ['Wawa Co'] }], keywords: [] } };
    const m = matchTenant(['WawaCo opening a new store'], wl);
    assert.equal(m.tenant, 'WawaCo');
    // Seed tenants are not present in the override.
    assert.equal(matchTenant(['DaVita opens clinic'], wl), null);
  });
});

describe('scoreNewsAlert — confidence gate', () => {
  const ex = { city: 'Dallas', state: 'TX', article_url: 'https://n/x' };

  it('exact match clears the auto threshold', () => {
    const s = scoreNewsAlert({ match_kind: 'exact', tenant: 'DaVita', domain: 'dialysis' }, ex);
    assert.ok(s >= NEWS_ALERT_AUTO_THRESHOLD);
  });

  it('keyword match never clears the threshold', () => {
    const s = scoreNewsAlert({ match_kind: 'keyword', tenant: null, domain: 'dialysis' }, ex);
    assert.ok(s < NEWS_ALERT_AUTO_THRESHOLD);
  });

  it('null match stays low', () => {
    assert.ok(scoreNewsAlert(null, ex) < NEWS_ALERT_AUTO_THRESHOLD);
  });
});

describe('routeNewsAlert', () => {
  it('auto -> developer_unknown + archive', () => {
    const r = routeNewsAlert(0.85);
    assert.equal(r.route, 'auto');
    assert.equal(r.status, 'developer_unknown');
    assert.equal(r.archive, true);
  });
  it('review -> needs_review, no archive', () => {
    const r = routeNewsAlert(0.5);
    assert.equal(r.route, 'review');
    assert.equal(r.status, 'needs_review');
    assert.equal(r.archive, false);
  });
});

describe('parseGoogleAlert', () => {
  it('extracts tenant, unwraps google redirect url, finds City, ST', () => {
    const subject = 'Google Alert - DaVita';
    const body = [
      'DaVita opens new dialysis center in Dallas, TX',
      'https://www.google.com/url?rct=j&sa=t&url=https%3A%2F%2Fnews.example%2Fdavita-dallas&ct=ga',
      'https://support.google.com/alerts',
    ].join('\n');
    const p = parseGoogleAlert(body, subject);
    assert.equal(p.match.tenant, 'DaVita');
    assert.equal(p.match.domain, 'dialysis');
    assert.equal(p.city, 'Dallas');
    assert.equal(p.state, 'TX');
    assert.equal(p.article_url, 'https://news.example/davita-dallas');
  });

  it('falls back to subject term when no tracked tenant matches', () => {
    const p = parseGoogleAlert('Acme Bakery opens a shop\nhttps://news.example/acme', 'Google Alert - Acme Bakery');
    assert.equal(p.match, null);
    assert.equal(p.tenant_name, 'Acme Bakery');
    assert.equal(p.article_url, 'https://news.example/acme');
  });

  it('skips google infra urls when picking the article link', () => {
    const p = parseGoogleAlert('https://policies.google.com/x\nhttps://news.example/real', 'Google Alert - x');
    assert.equal(p.article_url, 'https://news.example/real');
  });

  it('associates the headline line before the redirect link', () => {
    const subject = 'Google Alert - DaVita';
    const body = [
      'DaVita opens new dialysis center in Dallas, TX',
      'https://www.google.com/url?rct=j&sa=t&url=https%3A%2F%2Fnews.example%2Fdavita-dallas&ct=ga',
    ].join('\n');
    const p = parseGoogleAlert(body, subject);
    assert.equal(p.article_url, 'https://news.example/davita-dallas');
    assert.equal(p.article_title, 'DaVita opens new dialysis center in Dallas, TX');
  });

  // Bug 2026-07-20: html2text renders the header logo <img> as a bracketed URL
  // line; the parser grabbed it as article_url AND article_title/summary.
  it('never captures the Google Alerts header logo (real html2text shape)', () => {
    const subject = 'Google Alert - square foot clinic';
    const body = [
      '[https://www.google.com/intl/en_us/alerts/logo.png?cd=KhQxNzg2MjM3NTExNDMxODY5MTE3OA]',
      '',
      'square foot clinic',
      '',
      'Daily update ⋅ July 20, 2026',
      'NEWS',
      '',
      'New 12,000 square foot clinic opens in Springfield',
      '[https://www.google.com/url?rct=j&sa=t&url=https%3A%2F%2Fsjournal.example%2Fclinic&ct=ga&cd=YY&usg=ZZ]',
      'Springfield Journal',
      'The new dialysis facility will serve the east side of town.',
      '',
      'Flag as irrelevant',
    ].join('\n');
    const p = parseGoogleAlert(body, subject);
    assert.equal(p.article_url, 'https://sjournal.example/clinic');
    assert.equal(p.article_title, 'New 12,000 square foot clinic opens in Springfield');
    for (const f of [p.article_url, p.article_title, p.summary]) {
      assert.ok(!/logo\.png/i.test(String(f)), `logo url leaked into "${f}"`);
    }
  });

  it('handles the [Headline](redirect) markdown link shape', () => {
    const subject = 'Google Alert - Fresenius';
    const body = [
      '[https://www.google.com/intl/en_us/alerts/logo.png?cd=AAA]',
      '',
      '[Fresenius breaks ground on new clinic](https://www.google.com/url?url=https%3A%2F%2Fwire.example%2Ffmc&ct=ga)',
    ].join('\n');
    const p = parseGoogleAlert(body, subject);
    assert.equal(p.article_url, 'https://wire.example/fmc');
    assert.equal(p.article_title, 'Fresenius breaks ground on new clinic');
    assert.ok(!/logo\.png/i.test(String(p.article_url)));
    assert.ok(!/logo\.png/i.test(String(p.article_title)));
  });

  it('logo-only body yields no logo url and no logo title', () => {
    const body = '[https://www.google.com/intl/en_us/alerts/logo.png?cd=BBB]\n\nfresenius\n';
    const p = parseGoogleAlert(body, 'Google Alert - fresenius');
    assert.equal(p.article_url, null);            // no real article link present
    assert.ok(!/logo\.png/i.test(String(p.article_title)));
    assert.ok(!/logo\.png/i.test(String(p.summary)));
  });
});

describe('end-to-end classification', () => {
  it('a tracked government alert auto-routes', () => {
    const p = parseGoogleAlert('SSA to open new field office in Reno, NV\nhttps://news.example/ssa', 'Google Alert - SSA');
    const conf = scoreNewsAlert(p.match, p);
    const route = routeNewsAlert(conf);
    assert.equal(p.match.domain, 'government');
    assert.equal(route.route, 'auto');
  });

  it('a loose keyword-only alert routes to review', () => {
    const p = parseGoogleAlert('A new net lease property hits the market\nhttps://news.example/x', 'Google Alert - net lease');
    const conf = scoreNewsAlert(p.match, p);
    assert.equal(routeNewsAlert(conf).route, 'review');
  });
});

describe('tenantDedupKey', () => {
  it('normalizes for the repost guard', () => {
    assert.equal(tenantDedupKey('DaVita, Inc.'), tenantDedupKey('davita inc'));
    assert.equal(tenantDedupKey(null), '');
  });
});

describe('watchlist shape', () => {
  it('seed covers all three verticals', () => {
    assert.deepEqual(Object.keys(DEFAULT_TRACKED_TENANTS).sort(), ['dialysis', 'government', 'netlease']);
  });
});
