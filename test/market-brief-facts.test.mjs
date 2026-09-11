// MB-a — pure fact-builder / supersede / small-n / conflict tests, all fixture-based (no network, no DB).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_N_CAP_BAND,
  sectionTtlDays,
  staleAfterIso,
  median,
  iqrStats,
  buildCapRateBandFact,
  buildOnMarketFacts,
  buildTradesSinceLastRunFact,
  buildTradesZeroFact,
  buildCmsOperatorFacts,
  decideFactWrite,
  numericTokens,
  claimNumbersAreVerbatim,
} from '../api/_shared/market-brief-facts.js';

// ---------------------------------------------------------------------------
// TTL
// ---------------------------------------------------------------------------

test('sectionTtlDays: rss is 7 days regardless of section', () => {
  assert.equal(sectionTtlDays({ origin: 'rss' }), 7);
});

test('sectionTtlDays: onbox_sql on_market_count is 2 days', () => {
  assert.equal(sectionTtlDays({ origin: 'onbox_sql', subtype: 'on_market_count' }), 2);
});

test('sectionTtlDays: onbox_sql comps/trades default to 30 days', () => {
  assert.equal(sectionTtlDays({ origin: 'onbox_sql', subtype: 'trades' }), 30);
  assert.equal(sectionTtlDays({ origin: 'onbox_sql', subtype: 'cap_rate_band' }), 30);
});

test('staleAfterIso adds the right number of days', () => {
  const out = staleAfterIso('2026-09-11T00:00:00.000Z', 2);
  assert.equal(out, '2026-09-13T00:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

test('median of an odd-length array', () => {
  assert.equal(median([1, 3, 2]), 2);
});

test('median of an even-length array averages the middle two', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('iqrStats returns null for an empty input', () => {
  assert.equal(iqrStats([]), null);
});

test('iqrStats computes n/median/q1/q3', () => {
  const s = iqrStats([0.06, 0.065, 0.07, 0.075, 0.08]);
  assert.equal(s.n, 5);
  assert.equal(s.median, 0.07);
  assert.ok(s.q1 < s.median && s.q3 > s.median);
});

// ---------------------------------------------------------------------------
// buildCapRateBandFact — small-n suppression
// ---------------------------------------------------------------------------

test('buildCapRateBandFact suppresses a band below the small-n floor', () => {
  const rates = new Array(MIN_N_CAP_BAND - 1).fill(0.07);
  const fact = buildCapRateBandFact({ lane: 'dialysis', capRates: rates, sourceLabel: 'test', asOfIso: '2026-09-11T00:00:00Z' });
  assert.equal(fact, null);
});

test('buildCapRateBandFact emits a whole-market band at exactly the floor', () => {
  const rates = new Array(MIN_N_CAP_BAND).fill(0).map((_, i) => 0.06 + i * 0.001);
  const fact = buildCapRateBandFact({ lane: 'dialysis', capRates: rates, sourceLabel: 'test', asOfIso: '2026-09-11T00:00:00Z' });
  assert.ok(fact);
  assert.equal(fact.lane, 'dialysis');
  assert.equal(fact.section, 'capital_markets');
  assert.equal(fact.origin, 'onbox_sql');
  assert.equal(fact.fact_kind, 'derived');
  assert.equal(fact.fact_key, 'cap_rate_ttm_band');
  assert.match(fact.claim_text, /n=5/);
  assert.ok(fact.value > 0 && fact.value < 1);
});

test('buildCapRateBandFact scopes fact_key to the operator segment', () => {
  const rates = new Array(MIN_N_CAP_BAND).fill(0.07);
  const fact = buildCapRateBandFact({ lane: 'dialysis', capRates: rates, operator: 'DaVita Inc.', sourceLabel: 'test', asOfIso: '2026-09-11T00:00:00Z' });
  assert.equal(fact.fact_key, 'cap_rate_ttm_band:davita_inc');
  assert.match(fact.claim_text, /DaVita Inc\./);
});

// ---------------------------------------------------------------------------
// buildOnMarketFacts / trades
// ---------------------------------------------------------------------------

test('buildOnMarketFacts emits both a count and a median-ask-cap fact when both are present', () => {
  const facts = buildOnMarketFacts({ lane: 'dialysis', count: 42, medianAskCap: 0.065, sourceLabel: 'v_dia_on_market', asOfIso: '2026-09-11T00:00:00Z' });
  assert.equal(facts.length, 2);
  assert.equal(facts[0].fact_key, 'on_market_count');
  assert.equal(facts[0].value, 42);
  assert.equal(facts[1].fact_key, 'on_market_median_ask_cap');
});

test('buildOnMarketFacts omits the ask-cap fact when no ask caps are present', () => {
  const facts = buildOnMarketFacts({ lane: 'dialysis', count: 5, medianAskCap: null, sourceLabel: 'v_dia_on_market', asOfIso: '2026-09-11T00:00:00Z' });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].fact_key, 'on_market_count');
});

test('buildTradesSinceLastRunFact returns null on an empty trade list (use buildTradesZeroFact instead)', () => {
  assert.equal(buildTradesSinceLastRunFact({ lane: 'dialysis', trades: [], sinceIso: null, sourceLabel: 'x', asOfIso: '2026-09-11T00:00:00Z' }), null);
});

test('buildTradesSinceLastRunFact summarizes count + median price + median cap', () => {
  const trades = [
    { sold_price: 1_000_000, cap_rate: 0.06 },
    { sold_price: 2_000_000, cap_rate: 0.07 },
    { sold_price: 3_000_000, cap_rate: 0.08 },
  ];
  const fact = buildTradesSinceLastRunFact({ lane: 'dialysis', trades, sinceIso: '2026-08-01T00:00:00Z', sourceLabel: 'x', asOfIso: '2026-09-11T00:00:00Z' });
  assert.equal(fact.value, 3);
  assert.match(fact.claim_text, /3 dialysis sales/);
  assert.match(fact.claim_text, /\$2,000,000/);
  assert.match(fact.claim_text, /7\.00%/);
});

test('buildTradesZeroFact states an honest zero, never fabricated as absence of a fact', () => {
  const fact = buildTradesZeroFact({ lane: 'dialysis', sinceIso: '2026-08-01T00:00:00Z', sourceLabel: 'x', asOfIso: '2026-09-11T00:00:00Z' });
  assert.equal(fact.value, 0);
  assert.match(fact.claim_text, /No dialysis sales/);
});

// ---------------------------------------------------------------------------
// CMS operator counts + net change (no fabricated baseline)
// ---------------------------------------------------------------------------

test('buildCmsOperatorFacts emits a count fact per operator', () => {
  const facts = buildCmsOperatorFacts({
    lane: 'dialysis', counts: [{ operator: 'DaVita Inc.', count: 2600 }, { operator: 'Fresenius', count: 1900 }],
    priorCounts: new Map(), sourceLabel: 'medicare_clinics', asOfIso: '2026-09-11T00:00:00Z',
  });
  assert.equal(facts.length, 2);
  assert.equal(facts[0].fact_key, 'cms_clinic_count:davita_inc');
});

test('buildCmsOperatorFacts adds a net-change fact only when a prior count exists', () => {
  const priorCounts = new Map([['DaVita Inc.', 2590]]);
  const facts = buildCmsOperatorFacts({
    lane: 'dialysis', counts: [{ operator: 'DaVita Inc.', count: 2600 }, { operator: 'Fresenius', count: 1900 }],
    priorCounts, sourceLabel: 'medicare_clinics', asOfIso: '2026-09-11T00:00:00Z',
  });
  const netChange = facts.filter((f) => f._subtype === 'cms_clinic_net_change');
  assert.equal(netChange.length, 1);
  assert.equal(netChange[0].value, 10);
  assert.match(netChange[0].claim_text, /grew by 10/);
});

test('buildCmsOperatorFacts never invents a net-change fact with no baseline', () => {
  const facts = buildCmsOperatorFacts({
    lane: 'dialysis', counts: [{ operator: 'Independent Clinic', count: 1 }],
    priorCounts: new Map(), sourceLabel: 'medicare_clinics', asOfIso: '2026-09-11T00:00:00Z',
  });
  assert.equal(facts.filter((f) => f._subtype === 'cms_clinic_net_change').length, 0);
});

test('buildCmsOperatorFacts skips a net-change fact when the count did not move', () => {
  const priorCounts = new Map([['DaVita Inc.', 2600]]);
  const facts = buildCmsOperatorFacts({
    lane: 'dialysis', counts: [{ operator: 'DaVita Inc.', count: 2600 }],
    priorCounts, sourceLabel: 'medicare_clinics', asOfIso: '2026-09-11T00:00:00Z',
  });
  assert.equal(facts.filter((f) => f._subtype === 'cms_clinic_net_change').length, 0);
});

// ---------------------------------------------------------------------------
// decideFactWrite — the supersede chain + conflict marking
// ---------------------------------------------------------------------------

test('decideFactWrite inserts new when nothing is live yet', () => {
  const d = decideFactWrite({ existingLive: null, candidate: { claim_text: 'x', value: 1 } });
  assert.equal(d.action, 'insert_new');
});

test('decideFactWrite skips a byte-identical re-run (no duplicate row)', () => {
  const existing = { claim_text: 'same', value: 0.07, origin: 'onbox_sql' };
  const candidate = { claim_text: 'same', value: 0.07 };
  const d = decideFactWrite({ existingLive: existing, candidate });
  assert.equal(d.action, 'skip_duplicate');
});

test('decideFactWrite supersedes when our own prior onbox_sql derivation changed', () => {
  const existing = { claim_text: 'old claim', value: 0.06, origin: 'onbox_sql' };
  const candidate = { claim_text: 'new claim', value: 0.075 };
  const d = decideFactWrite({ existingLive: existing, candidate });
  assert.equal(d.action, 'supersede');
});

test('decideFactWrite marks conflict against a disagreeing seeded web_research fact', () => {
  const existing = { claim_text: 'web claim', value: 0.05, origin: 'web_research' };
  const candidate = { claim_text: 'our claim', value: 0.075 }; // >10% relative difference
  const d = decideFactWrite({ existingLive: existing, candidate });
  assert.equal(d.action, 'conflict');
});

test('decideFactWrite does NOT conflict a web_research fact that is within tolerance (treated as agreement, not a duplicate)', () => {
  const existing = { claim_text: 'web claim', value: 0.070, origin: 'web_research' };
  const candidate = { claim_text: 'our claim', value: 0.072 }; // <10% relative difference
  const d = decideFactWrite({ existingLive: existing, candidate });
  // Values agree within tolerance, so this is NOT the "don't pick" conflict
  // case the spec describes — that is reserved for genuine disagreement.
  assert.equal(d.action, 'supersede');
});

// ---------------------------------------------------------------------------
// RSS number-verbatim check
// ---------------------------------------------------------------------------

test('numericTokens extracts and normalizes comma-formatted numbers', () => {
  assert.deepEqual(numericTokens('CMS proposed a 2,500 patient cap and a 4.2% cut.'), ['2500', '4.2']);
});

test('claimNumbersAreVerbatim passes a claim with no numbers', () => {
  assert.equal(claimNumbersAreVerbatim('DaVita announced a new facility.', 'no numbers here either'), true);
});

test('claimNumbersAreVerbatim passes when every claimed number is in the source text', () => {
  assert.equal(
    claimNumbersAreVerbatim('CMS proposed a 4.2% payment cut.', 'The agency proposed a 4.2% reduction to the composite rate.'),
    true,
  );
});

test('claimNumbersAreVerbatim fails a fabricated/derived number not present in the source', () => {
  assert.equal(
    claimNumbersAreVerbatim('CMS proposed a 4.2% payment cut, roughly $312 million.', 'The agency proposed a 4.2% reduction to the composite rate.'),
    false,
  );
});
