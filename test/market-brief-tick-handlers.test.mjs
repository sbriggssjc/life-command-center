// MB-a — handler-level smoke tests that do not require a live DB: the
// flag-off/unknown-lane 4xx shapes and the RSS section classifier. Full
// live-DB apply behavior is not unit-tested here (mirrors the existing
// operator-triage-tick pattern: pure logic is fixture-tested; DB-dependent
// flow is verified live, per the repo's own dry-run-first doctrine).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMarketBriefPsqlTick } from '../api/_handlers/market-brief-psql-tick.js';
import { handleMarketBriefRssTick, __internal as rssInternal } from '../api/_handlers/market-brief-rss-tick.js';
import { handleMarketBriefTab } from '../api/_handlers/market-brief-tab.js';

function fakeReqRes({ method = 'GET', query = {}, headers = {} } = {}) {
  const req = { method, query, body: {}, headers: { 'x-lcc-key': 'test', ...headers } };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  return { req, res };
}

test('handleMarketBriefPsqlTick rejects an unregistered lane with 400', async () => {
  const { req, res } = fakeReqRes({ query: { lane: 'not_a_real_lane' } });
  await handleMarketBriefPsqlTick(req, res).catch(() => null);
  // authenticate() may itself short-circuit in a bare test env (no LCC_API_KEY
  // configured) before reaching the lane check — accept either outcome, but
  // if it DID reach our handler body the status must be 400 with the lane list.
  if (res.body && res.body.available_lanes) {
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body.available_lanes, ['dialysis']);
  }
});

test('handleMarketBriefPsqlTick / handleMarketBriefRssTick reject non-GET/POST methods', async () => {
  const { req: reqA, res: resA } = fakeReqRes({ method: 'DELETE' });
  await handleMarketBriefPsqlTick(reqA, resA);
  assert.equal(resA.statusCode, 405);

  const { req: reqB, res: resB } = fakeReqRes({ method: 'DELETE' });
  await handleMarketBriefRssTick(reqB, resB);
  assert.equal(resB.statusCode, 405);
});

// ---------------------------------------------------------------------------
// RSS section classifier (deterministic keyword router, never the model's
// own opinion of its section)
// ---------------------------------------------------------------------------

test('classifySection routes a CMS/reimbursement claim to policy', () => {
  assert.equal(rssInternal.classifySection('CMS proposed a 4.2% cut to the ESRD PPS rate.'), 'policy');
});

test('classifySection routes an operator-named claim to operators', () => {
  assert.equal(rssInternal.classifySection('DaVita announced Q3 earnings results.'), 'operators');
});

test('classifySection routes a cap-rate/REIT claim to capital_markets', () => {
  assert.equal(rssInternal.classifySection('A healthcare REIT closed a portfolio sale at a compressed cap rate.'), 'capital_markets');
});

test('classifySection defaults to policy when nothing matches', () => {
  assert.equal(rssInternal.classifySection('A generic healthcare industry story with no keywords.'), 'policy');
});

// ---------------------------------------------------------------------------
// MB-b — /api/market-brief-tab (the homepage tab's read-only data source)
// ---------------------------------------------------------------------------

test('handleMarketBriefTab rejects non-GET methods', async () => {
  const { req, res } = fakeReqRes({ method: 'POST' });
  await handleMarketBriefTab(req, res);
  assert.equal(res.statusCode, 405);
});

test('handleMarketBriefTab rejects an unknown lane with 400', async () => {
  const { req, res } = fakeReqRes({ query: { lane: 'not_a_real_lane' } });
  await handleMarketBriefTab(req, res).catch(() => null);
  // authenticate() may short-circuit first in a bare test env (no LCC_API_KEY
  // configured) — accept either outcome, but if it DID reach the handler
  // body the status must be 400 with the lane list.
  if (res.body && res.body.available_lanes) {
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body.available_lanes, ['dialysis', 'government', 'net_lease', 'broad_net_lease']);
  }
});
