// CoStar portfolio capture: domain classification + per-property price guard
// (2026-06-25)
//
// The SVEA New Mexico portfolio (CoStar Sale Comp 5850493) — a $119.08M bulk
// sale of 40 NM office buildings — classified as no_domain and stamped the
// $119M deal aggregate onto its single captured subject property (445 Camino
// Del Rey Dr). Two pipeline bugs:
//
//   1. classifyDomain truncated sales_history[].sale_notes_raw to 300 chars,
//      and this portfolio's gov tenant signal ("Government tenants … The State
//      of New Mexico … leased to the GSA") sits past char ~325 behind a long
//      physical-description preamble — so /\bstate of\b/ + /\bgsa\b/ never saw
//      it. Fixed by raising the cap to SALE_NOTES_CLASSIFY_MAXLEN.
//
//   2. detectSalePriceBleed only nulls a portfolio aggregate once a SECOND
//      constituent property arrives with the same price+date; the first/only
//      capture had no sibling. isPortfolioAggregateSale reads the Bulk/Portfolio
//      signal straight off the sale.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyDomain,
  isPortfolioAggregateSale,
  derivePortfolioDeal,
  buildConstituentInputs,
  SALE_NOTES_CLASSIFY_MAXLEN,
} from '../api/_handlers/sidebar-pipeline.js';

// The exact narrative captured for Comp 5850493 (in sales_history[0]).
const SVEA_NOTES =
  'This transaction represents the sale of 40 suburban office buildings ' +
  'totaling 652,850 SF in various locations in New Mexico. The average size of ' +
  'the buildings is approximately 16,321 SF on approximately 67.64 acres. The ' +
  'properties delivered between 1997 and 2009.Occupancy at the time of sale was ' +
  'approximately 97.2% with 21 tenants; Government tenants account for 91.8% of ' +
  'the net rentable area. The State of New Mexico occupies 86.7% of the net ' +
  'rentable area, and 5.1% of the net rentable area is leased to the GSA. The ' +
  'reported cap rate was based on the in-place income and expenses. All ' +
  'information is based on public record and SEC / CMBS filings.';

describe('classifyDomain — portfolio sale-notes gov signal past char 300', () => {
  it('confirms the gov signal really sits past the old 300-char cap', () => {
    // Regression guard: if CoStar ever leads with the tenant info this test
    // would pass for the wrong reason. The signal MUST be in the back half.
    assert.ok(SVEA_NOTES.indexOf('State of New Mexico') > 300,
      '"State of New Mexico" must be past char 300');
    assert.ok(SVEA_NOTES.indexOf('GSA') > 300, '"GSA" must be past char 300');
    assert.equal(SALE_NOTES_CLASSIFY_MAXLEN >= SVEA_NOTES.length, true,
      'the new cap must cover the whole narrative');
  });

  it('classifies government from sales_history[].sale_notes_raw', () => {
    const metadata = {
      tenant_name: null,
      building_name: '445 Camino Del Rey Dr',
      sales_history: [{ _comp_id: '5850493', sale_notes_raw: SVEA_NOTES }],
    };
    const entityFields = { name: '445 Camino Del Rey Dr', asset_type: null };
    assert.equal(classifyDomain(metadata, entityFields), 'government');
  });

  it('still returns null when the notes carry no domain tenant', () => {
    const metadata = {
      building_name: 'Generic Strip Center',
      sales_history: [{ sale_notes_raw:
        'A multi-tenant retail strip sold to a private investor. ' +
        'Tenants include a nail salon, a pizzeria, and a phone store.' }],
    };
    assert.equal(classifyDomain(metadata, { name: 'Generic Strip Center' }), null);
  });

  it('truncation regression: a 300-char preamble no longer hides the signal', () => {
    const preamble = 'x'.repeat(310) + ' ';
    const metadata = { sales_history: [{ sale_notes_raw: preamble + 'leased to the GSA' }] };
    assert.equal(classifyDomain(metadata, { name: 'subject' }), 'government');
  });
});

describe('isPortfolioAggregateSale — single-capture aggregate guard', () => {
  it('flags a Bulk/Portfolio sale_condition', () => {
    assert.equal(isPortfolioAggregateSale({ sale_condition: 'Bulk/Portfolio Sale' }), true);
  });

  it('flags a Portfolio transaction_type', () => {
    assert.equal(isPortfolioAggregateSale({ transaction_type: 'Portfolio' }), true);
  });

  it('flags the "sale of N buildings" narrative', () => {
    assert.equal(isPortfolioAggregateSale({ sale_notes_raw: SVEA_NOTES }), true);
  });

  it('does NOT flag an ordinary single-property sale', () => {
    assert.equal(isPortfolioAggregateSale({
      sale_condition: 'Confirmed', transaction_type: 'Investment',
      sale_notes_raw: 'Single-tenant VA clinic fully leased to the Department of Veterans Affairs.',
    }), false);
  });

  it('exempts a per-property-allocated record (carries its own real price)', () => {
    assert.equal(isPortfolioAggregateSale({
      sale_condition: 'Bulk/Portfolio Sale', _per_property_allocated: true,
    }), false);
  });

  it('is null/garbage tolerant', () => {
    assert.equal(isPortfolioAggregateSale(null), false);
    assert.equal(isPortfolioAggregateSale({}), false);
  });
});

describe('derivePortfolioDeal — deal-level fields off the subject sale', () => {
  const metadata = {
    asset_type: 'government_leased',
    sales_history: [
      { sale_date: 'Jan 5, 2022', sale_price: '$119,082,570', sale_condition: 'Bulk/Portfolio Sale',
        buyer: 'SVEA Real Estate Group', seller: 'Community Development Commission',
        sale_notes_raw: SVEA_NOTES },
    ],
  };
  const deal = derivePortfolioDeal(metadata);

  it('extracts the Bulk/Portfolio sale row', () => {
    assert.equal(deal.sale_date, 'Jan 5, 2022');
    assert.equal(deal.total_deal_price, '$119,082,570');
    assert.equal(deal.buyer, 'SVEA Real Estate Group');
    assert.equal(deal.seller, 'Community Development Commission');
    assert.equal(deal.asset_type, 'government_leased');
    assert.ok(deal.sale_notes_raw.includes('State of New Mexico'));
  });

  it('falls back to the most-recent dated sale when none is flagged portfolio', () => {
    const d = derivePortfolioDeal({ sales_history: [
      { sale_date: '2019-01-01', sale_price: '$1' },
      { sale_date: '2021-06-01', sale_price: '$9' },
    ]});
    assert.equal(d.total_deal_price, '$9');
  });
});

describe('buildConstituentInputs — per-property allocation', () => {
  const deal = {
    sale_date: 'Jan 5, 2022', buyer: 'SVEA Real Estate Group',
    seller: 'Community Development Commission', sale_condition: 'Bulk/Portfolio Sale',
    sale_notes_raw: SVEA_NOTES, asset_type: 'government_leased',
  };
  const constituent = {
    address: '445 Camino Del Rey Dr', city: 'Los Lunas', state: 'NM',
    property_type: 'Office', size_sf: 46635, sale_price: 8022379,
  };

  it('maps the constituent + writes its OWN per-property price (not the aggregate)', () => {
    const { entity, metadata } = buildConstituentInputs('government', deal, constituent);
    assert.equal(entity.address, '445 Camino Del Rey Dr');
    assert.equal(entity.city, 'Los Lunas');
    assert.equal(entity.state, 'NM');
    assert.equal(entity.domain, 'government');
    const sale = metadata.sales_history[0];
    assert.equal(sale.sale_price, '$8,022,379');
    assert.equal(sale.sale_date, 'Jan 5, 2022');
    assert.equal(sale.buyer, 'SVEA Real Estate Group');
  });

  it('flags the sale _per_property_allocated so the aggregate guard exempts it', () => {
    const { metadata } = buildConstituentInputs('government', deal, constituent);
    const sale = metadata.sales_history[0];
    assert.equal(sale._per_property_allocated, true);
    // even though the deal is a Bulk/Portfolio sale, this allocated row is NOT
    // treated as an aggregate (its price is the real per-property figure)
    assert.equal(isPortfolioAggregateSale(sale), false);
  });

  it('carries the deal notes so the constituent classifies into the same domain', () => {
    const { metadata } = buildConstituentInputs('government', deal, constituent);
    assert.equal(classifyDomain(metadata, { name: metadata.address }), 'government');
  });

  it('uses rba for gov and building_size for dia', () => {
    assert.equal(buildConstituentInputs('government', deal, constituent).metadata.rba, 46635);
    assert.equal(buildConstituentInputs('dialysis', deal, constituent).metadata.building_size, 46635);
  });

  it('returns null for a constituent without an address', () => {
    assert.equal(buildConstituentInputs('government', deal, { city: 'X', state: 'NM' }), null);
    assert.equal(buildConstituentInputs('government', deal, null), null);
  });

  it('tolerates a missing per-property price (no price written)', () => {
    const { metadata } = buildConstituentInputs('government', deal,
      { address: '1 Main St', state: 'NM' });
    assert.equal(metadata.sales_history[0].sale_price, null);
  });
});
