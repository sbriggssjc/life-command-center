// Gov Sale-Notes ingestion (2026-06-20)
//
// The CoStar sidebar capture parses the free-text "Sale Notes" narrative and,
// for gov, now routes the structured values into the gov cap-rate framework
// (NOI -> properties.noi confirmed_sale anchor) and the at-sale firm term
// (-> sales_transactions.firm_term_years_at_sale), and retains the raw +
// structured notes on the sale row. These tests cover the pure extraction +
// selection/guard helpers (the live DB writes are exercised separately).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSaleNotes,
  pickConfirmedSaleNoi,
  shouldWriteConfirmedSaleNoi,
  govSaleNotesTermFields,
} from '../api/_handlers/sidebar-pipeline.js';

// The exact narrative from the 13663 Mono Way (Sonora, CA — VA clinic) sale.
const SONORA_NOTES =
  'Subject property is an 8,000 square foot office building situated on a 0.50 acre lot ' +
  'located at 13663 Mono Way in Sonora. The property was constructed in 2009 and ' +
  'developed in accordance with specific requirements for the VA and meeting strict ' +
  'federal standards. The building is fully leased to the Department of Veterans ' +
  'Affairs Clinic on a long-term basis, with 11.5 years remaining on the lease term. ' +
  'The cap rate of 6.71% is based on an NOI of $268,545.';

describe('parseSaleNotes — Sonora VA narrative', () => {
  it('extracts NOI, decimal lease term, and stated cap rate', () => {
    const x = parseSaleNotes(SONORA_NOTES);
    assert.equal(x.noi, 268545, 'NOI of $268,545');
    assert.equal(x.stated_cap_rate, 6.71, 'cap rate of 6.71%');
    // Regression: "11.5 years remaining" must capture the fractional term
    // (the prior integer-only regex dropped the ".5").
    assert.equal(x.years_remaining, 11.5, '11.5 years remaining');
    assert.equal(x.building_sf, 8000, '8,000 square foot');
    assert.equal(x.acreage, 0.5, '0.50 acre');
  });

  it('returns {} for empty / missing notes', () => {
    assert.deepEqual(parseSaleNotes(''), {});
    assert.deepEqual(parseSaleNotes(null), {});
  });
});

describe('pickConfirmedSaleNoi — NOI source preference', () => {
  it('prefers structured metadata.noi over the narrative value', () => {
    assert.equal(pickConfirmedSaleNoi({ noi: '$268,545' }, { noi: 999 }), 268545);
  });
  it('falls back to the parsed narrative NOI when metadata has none', () => {
    assert.equal(pickConfirmedSaleNoi({}, { noi: 268545 }), 268545);
  });
  it('returns null when neither carries a positive NOI', () => {
    assert.equal(pickConfirmedSaleNoi({}, {}), null);
    assert.equal(pickConfirmedSaleNoi({ noi: '0' }, { noi: 0 }), null);
    assert.equal(pickConfirmedSaleNoi(null, null), null);
  });
});

describe('shouldWriteConfirmedSaleNoi — fill-blank-or-newer guard', () => {
  it('writes when the property has no NOI yet', () => {
    assert.equal(shouldWriteConfirmedSaleNoi(null, '2021-04-09'), true);
    assert.equal(shouldWriteConfirmedSaleNoi({ noi: null }, '2021-04-09'), true);
  });
  it('writes only when this sale is strictly newer than the existing anchor', () => {
    assert.equal(
      shouldWriteConfirmedSaleNoi({ noi: 200000, noi_as_of_date: '2019-01-01' }, '2021-04-09'),
      true, 'newer sale wins');
    assert.equal(
      shouldWriteConfirmedSaleNoi({ noi: 200000, noi_as_of_date: '2021-04-09' }, '2021-04-09'),
      false, 'same-date does not clobber');
    assert.equal(
      shouldWriteConfirmedSaleNoi({ noi: 200000, noi_as_of_date: '2023-01-01' }, '2021-04-09'),
      false, 'older sale never overwrites a more-recent NOI');
  });
  it('never clobbers an NOI with an unknown anchor date', () => {
    assert.equal(shouldWriteConfirmedSaleNoi({ noi: 200000, noi_as_of_date: null }, '2021-04-09'), false);
  });
});

describe('govSaleNotesTermFields — at-sale firm term seed', () => {
  it('maps a sane decimal term to firm_term_years_at_sale + costar_sale_notes source', () => {
    assert.deepEqual(
      govSaleNotesTermFields({ years_remaining: 11.5 }),
      { firm_term_years_at_sale: 11.5, firm_term_source: 'costar_sale_notes' });
  });
  it('drops absent or out-of-range terms (never seeds garbage)', () => {
    assert.deepEqual(govSaleNotesTermFields({}), {});
    assert.deepEqual(govSaleNotesTermFields({ years_remaining: 0 }), {});
    assert.deepEqual(govSaleNotesTermFields({ years_remaining: 99 }), {});
    assert.deepEqual(govSaleNotesTermFields(null), {});
  });
});
