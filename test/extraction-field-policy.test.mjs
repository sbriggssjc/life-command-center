// Stage B Unit 0 — the advisory write-path guard. These assertions ARE the
// boundary: a price/cap advisory or an internal economic-cap can never land in a
// reported market field, and internal analytics are never promotable.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyValuation, isReportedField, valuationDestination, guardValuationWrite,
} from '../api/_shared/extraction-field-policy.js';

describe('Stage B field policy — classification', () => {
  it('classifies the promotable client-pricing advisories', () => {
    for (const v of ['ask', 'trade_low', 'trade_high', 'recommended_value', 'recommended_cap']) {
      assert.equal(classifyValuation(v), 'advisory_promotable', v);
    }
  });
  it('classifies the internal valuation analytics', () => {
    for (const v of ['stabilized_noi', 'discount_rate', 'economic_cap', 'implied_cap']) {
      assert.equal(classifyValuation(v), 'internal_analytic', v);
    }
  });
  it('flags reported market fields', () => {
    assert.equal(isReportedField('asking_cap'), true);
    assert.equal(isReportedField('sold_cap_rate'), true);
    assert.equal(isReportedField('annual_rent'), false);   // factual lease field
    assert.equal(isReportedField('amount'), false);        // advisory store field
  });
});

describe('Stage B field policy — destinations (the two-destiny split)', () => {
  it('routes promotable advisories to the advisory store, promotable', () => {
    const d = valuationDestination('recommended_cap');
    assert.equal(d.store, 'property_valuation_advisory');
    assert.equal(d.promotable, true);
  });
  it('routes internal analytics to the #64 ledgers, NEVER promotable', () => {
    assert.deepEqual(valuationDestination('economic_cap'), { store: 'cap_rate_history', promotable: false, class: 'internal_analytic' });
    assert.deepEqual(valuationDestination('stabilized_noi'), { store: 'property_financials', promotable: false, class: 'internal_analytic' });
    assert.equal(valuationDestination('discount_rate').promotable, false);
  });
});

describe('Stage B field policy — THE GUARD (no leak to reported)', () => {
  it('rejects an advisory value targeting a reported field (no confirmed listing)', () => {
    const r = guardValuationWrite({ valueType: 'recommended_cap', targetField: 'asking_cap' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'advisory_not_promotable_until_listing_confirmed');
  });
  it('PERMANENTLY rejects an internal economic-cap targeting a reported cap — even with a confirmed listing', () => {
    const r = guardValuationWrite({ valueType: 'economic_cap', targetField: 'sold_cap_rate', listingConfirmed: true });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'internal_analytic_cannot_reach_reported');
  });
  it('allows the gated promotion of a recommendation once the listing is confirmed', () => {
    const r = guardValuationWrite({ valueType: 'recommended_cap', targetField: 'asking_cap', listingConfirmed: true });
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'promoted_listing_confirmed');
  });
  it('allows an advisory value into its OWN store (non-reported field) without a listing', () => {
    assert.equal(guardValuationWrite({ valueType: 'ask', targetField: 'amount' }).ok, true);
  });
  it('never lets an unclassified value reach a reported field', () => {
    const r = guardValuationWrite({ valueType: 'gut_feel', targetField: 'asking_price' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unclassified_valuation_to_reported');
  });
});
