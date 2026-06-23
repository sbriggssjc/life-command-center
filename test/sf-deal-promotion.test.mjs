// Phase 3 / Topic 3 — pure tests for the Closed-Won → sales_transactions
// promotion decision + the state-government routing cues. Both pure functions
// are the SAME code the sf-promotion-worker edge function runs (single source
// of truth: supabase/functions/_shared/sf-deal-promotion.ts, type-stripped by
// node --test).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planDealSalePromotion,
  isClosedWonStage,
  GOV_STATE_SIGNALS,
  MIN_SALE_PRICE,
} from '../supabase/functions/_shared/sf-deal-promotion.ts';
import { routeVertical } from '../supabase/functions/intake-salesforce/sf-config.ts';

const baseDeal = {
  sf_deal_id: '006DEAL0001',
  stage: 'Closed Won',
  deal_price: 1_250_000,
  expected_close_date: '2026-05-01',
  buyer_company_name: 'Acme Holdings LLC',
  seller_company_name: 'Old Owner LP',
  noi: 80_000,
  annual_rent: 110_000,
};

describe('isClosedWonStage', () => {
  it('matches Closed Won variants', () => {
    assert.equal(isClosedWonStage('Closed Won'), true);
    assert.equal(isClosedWonStage('ClosedWon'), true);
    assert.equal(isClosedWonStage('07 - Closed Won'), true);
    assert.equal(isClosedWonStage('closed_won'), true);
  });
  it('rejects non-closed-won', () => {
    assert.equal(isClosedWonStage('Negotiation'), false);
    assert.equal(isClosedWonStage('Closed Lost'), false);
    assert.equal(isClosedWonStage(null), false);
    assert.equal(isClosedWonStage(undefined), false);
  });
});

describe('planDealSalePromotion', () => {
  it('promotes a Closed-Won deal with property + price + date (gov columns)', () => {
    const r = planDealSalePromotion(baseDeal, 17257, 'gov', {});
    assert.equal(r.promote, true);
    assert.equal(r.reason, 'ok');
    assert.equal(r.saleRow.property_id, 17257);
    assert.equal(r.saleRow.sold_price, 1_250_000);
    assert.equal(r.saleRow.sale_date, '2026-05-01');
    assert.equal(r.saleRow.data_source, 'salesforce_deal');
    assert.equal(r.saleRow.sf_deal_id, '006DEAL0001');
    assert.equal(r.saleRow.buyer, 'Acme Holdings LLC');
    assert.equal(r.saleRow.seller, 'Old Owner LP');
    assert.equal(r.saleRow.noi, 80_000);
    assert.equal(r.saleRow.gross_rent, 110_000);
    // cap rate NEVER set — derived by the DB trigger
    assert.equal('sold_cap_rate' in r.saleRow, false);
    assert.equal('cap_rate' in r.saleRow, false);
  });

  it('uses dia party columns (buyer_name/seller_name, no gross_rent)', () => {
    const r = planDealSalePromotion(baseDeal, 28909, 'dia', {});
    assert.equal(r.promote, true);
    assert.equal(r.saleRow.buyer_name, 'Acme Holdings LLC');
    assert.equal(r.saleRow.seller_name, 'Old Owner LP');
    assert.equal('buyer' in r.saleRow, false);
    assert.equal('gross_rent' in r.saleRow, false); // dia has no gross_rent col
    assert.equal(r.saleRow.noi, 80_000);
  });

  it('skips a non-closed deal', () => {
    const r = planDealSalePromotion({ ...baseDeal, stage: 'Negotiation' }, 17257, 'gov', {});
    assert.equal(r.promote, false);
    assert.equal(r.reason, 'not_closed_won');
  });

  it('skips when no property resolved (never inserts a null property_id)', () => {
    const r = planDealSalePromotion(baseDeal, null, 'gov', {});
    assert.equal(r.promote, false);
    assert.equal(r.reason, 'unresolved_property');
  });

  it('skips when no deal_price (does NOT fall back to listing_price)', () => {
    const r = planDealSalePromotion(
      { ...baseDeal, deal_price: null, listing_price: 9_000_000 }, 17257, 'gov', {});
    assert.equal(r.promote, false);
    assert.equal(r.reason, 'no_sale_price');
  });

  it('skips when price below the $50k floor', () => {
    const r = planDealSalePromotion({ ...baseDeal, deal_price: 25_000 }, 17257, 'gov', {});
    assert.equal(r.promote, false);
    assert.equal(r.reason, 'price_below_floor');
    assert.equal(MIN_SALE_PRICE, 50_000);
  });

  it('skips when no sale date', () => {
    const r = planDealSalePromotion({ ...baseDeal, expected_close_date: null }, 17257, 'gov', {});
    assert.equal(r.promote, false);
    assert.equal(r.reason, 'no_sale_date');
  });

  it('skips (idempotent) when a sales row already carries this sf_deal_id', () => {
    const r = planDealSalePromotion(baseDeal, 17257, 'gov', { existingSale: true });
    assert.equal(r.promote, false);
    assert.equal(r.reason, 'already_promoted');
  });

  it('skips when a curated comp already exists near the sale date', () => {
    const r = planDealSalePromotion(baseDeal, 17257, 'gov', { curatedSaleExists: true });
    assert.equal(r.promote, false);
    assert.equal(r.reason, 'curated_sale_exists');
  });

  it('skips when sf_deal_id missing (no idempotency key)', () => {
    const r = planDealSalePromotion({ ...baseDeal, sf_deal_id: null }, 17257, 'gov', {});
    assert.equal(r.promote, false);
    assert.equal(r.reason, 'no_sf_deal_id');
  });

  it('tolerates Stage__c and string prices', () => {
    const r = planDealSalePromotion(
      { sf_deal_id: 'X', Stage__c: 'ClosedWon', deal_price: '$1,400,000', expected_close_date: '2026-06-01' },
      5, 'gov', {});
    assert.equal(r.promote, true);
    assert.equal(r.saleRow.sold_price, 1_400_000);
  });
});

describe('routeVertical — state-government cues', () => {
  it('routes a TX state-agency deal to gov', () => {
    const r = routeVertical({ deal_name: 'TX Dept of Family Protective Services HQ', property_type: 'Office' });
    assert.equal(r.vertical, 'gov');
    assert.equal(r.resolved, true);
  });
  it('routes a "State of ..." agency deal to gov', () => {
    const r = routeVertical({ tenant_names: 'State of Oklahoma Department of Human Services' });
    assert.equal(r.vertical, 'gov');
  });
  it('still routes a dialysis operator deal to dia (gov cue does not steal it)', () => {
    const r = routeVertical({ deal_name: 'DaVita Dialysis - Department of Energy Plaza', property_type: 'Medical' });
    assert.equal(r.vertical, 'dia');
    assert.equal(r.resolved, true);
  });
  it('routes a Fresenius deal to dia', () => {
    const r = routeVertical({ tenant_names: 'Fresenius Medical Care' });
    assert.equal(r.vertical, 'dia');
  });
  it('a generic office deal defaults to dia (unresolved)', () => {
    const r = routeVertical({ deal_name: 'Generic Office Tower', property_type: 'Office' });
    assert.equal(r.vertical, 'dia');
    assert.equal(r.resolved, false);
  });
  it('GOV_STATE_SIGNALS includes the Topic-1 state vocabulary', () => {
    assert.ok(GOV_STATE_SIGNALS.includes('human services'));
    assert.ok(GOV_STATE_SIGNALS.includes('parks and wildlife'));
    assert.ok(GOV_STATE_SIGNALS.includes('state of '));
  });
});
