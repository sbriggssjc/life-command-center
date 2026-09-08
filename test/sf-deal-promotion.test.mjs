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
  GOV_SIGNALS,
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

describe('routeVertical — state-government cues (DRIFT1-routing-gap, RESOLVED 2026-09-08)', () => {
  // DRIFT1-routing-gap found TWO government-routing vocabularies that
  // disagreed about the same Salesforce property: intake-salesforce's own
  // (deployed, federal-only) GOV_SIGNALS, and sf-deal-promotion.ts's
  // GOV_STATE_SIGNALS — exported, tested, and imported by NOTHING that
  // routes. A state-agency deal ("TX Dept of Family Protective Services HQ")
  // routed to gov on one door and to `{vertical:null, reason:'no_match'}`
  // (silently skipped — no row, no error) on the other.
  //
  // Sizing (see sf-deal-promotion.ts's GOV_SIGNALS header for the full
  // writeup): the skipped population leaves no row anywhere it can be
  // counted from (Class 20). A re-route replay of every row currently
  // staged in dia's AND gov's sf_property_staging/sf_comp_staging/
  // sf_listing_staging/sf_deal_staging tables (1,064 rows total) produced
  // zero flips — structurally, not as evidence of no gap, because a staging
  // table can only ever hold rows that already resolved to ITS vertical.
  // Live Salesforce access (the other honest sizing method) was not
  // reachable from this session.
  //
  // DECISION: merge into ONE canonical list (sf-deal-promotion.ts's
  // GOV_SIGNALS, now imported by sf-config.ts — GOV_STATE_SIGNALS no longer
  // exists as a separate export). Justified per-term, not by blanket merge:
  // every state-agency phrase adopted already has a live, word-boundary-
  // anchored precedent in api/_handlers/sidebar-pipeline.js's
  // GOV_TENANT_PATTERNS (the Topic-1 Texas Facilities Commission audit),
  // which has been minting gov properties from that vocabulary with no
  // reported false positive. "motor vehicles" was the one GOV_STATE_SIGNALS
  // term with NO such precedent (private auto dealers collide with it) and
  // was deliberately left OUT — filed as DRIFT1-routing-gap-motorvehicles
  // rather than guessed at.
  //
  // ⚠️ THIS CHANGE IS NOT DEPLOYED. intake-salesforce is a Supabase edge
  // function (project zqzrriwuavgrquhisnoa); editing sf-config.ts in this
  // repo does nothing until it is redeployed (the DRIFT1 lesson, run in
  // reverse). The tests below assert the NEW REPO behavior, which is a
  // decision, not yet a running fact — see docs/architecture/
  // edge-function-deploy-drift.md before deploying.
  it('a TX state-agency deal now routes to gov (the gap this unit closes)', () => {
    const r = routeVertical({ deal_name: 'TX Dept of Family Protective Services HQ', property_type: 'Office' });
    assert.equal(r.vertical, 'gov');
    assert.equal(r.resolved, true);
    assert.equal(r.reason, 'gov_tenant_kw');
  });
  it('routes a "State of ..." agency deal to gov', () => {
    const r = routeVertical({ tenant_names: 'State of Oklahoma Department of Human Services' });
    assert.equal(r.vertical, 'gov');
  });
  it('routes a bare state-agency phrase with no "state of"/"department of" prefix (comptroller)', () => {
    const r = routeVertical({ deal_name: 'Texas Comptroller of Public Accounts Annex' });
    assert.equal(r.vertical, 'gov');
  });
  it('routes "parks and wildlife" (Topic-1 vocabulary) to gov', () => {
    const r = routeVertical({ tenant_names: 'Texas Parks and Wildlife Department' });
    assert.equal(r.vertical, 'gov');
  });
  it('still routes a dialysis operator deal to dia (gov cue does not steal it — dia is checked first)', () => {
    const r = routeVertical({ deal_name: 'DaVita Dialysis - Department of Energy Plaza', property_type: 'Medical' });
    assert.equal(r.vertical, 'dia');
    assert.equal(r.resolved, true);
  });
  it('routes a Fresenius deal to dia', () => {
    const r = routeVertical({ tenant_names: 'Fresenius Medical Care' });
    assert.equal(r.vertical, 'dia');
  });
  it('a generic office deal stays unresolved (no default-to-dia; a state-agency default IS a fabrication)', () => {
    const r = routeVertical({ deal_name: 'Generic Office Tower', property_type: 'Office' });
    assert.equal(r.vertical, null);
    assert.equal(r.resolved, false);
  });
  it('a private auto dealer does NOT route to gov ("motor vehicles" deliberately excluded)', () => {
    const r = routeVertical({ deal_name: 'Regional Used Motor Vehicles Superstore', property_type: 'Retail' });
    assert.equal(r.vertical, null);
    assert.equal(r.resolved, false);
  });
  it('GOV_SIGNALS is the single exported list — GOV_STATE_SIGNALS no longer exists', async () => {
    const mod = await import('../supabase/functions/_shared/sf-deal-promotion.ts');
    assert.equal('GOV_STATE_SIGNALS' in mod, false);
    assert.ok(Array.isArray(mod.GOV_SIGNALS));
  });
  it('GOV_SIGNALS carries the federal terms (deployed baseline) and the Topic-1 state terms', () => {
    // Federal (deployed sf-2026-05-v8/v23 baseline — must not be lost in the merge)
    assert.ok(GOV_SIGNALS.includes('gsa'));
    assert.ok(GOV_SIGNALS.includes('federal'));
    assert.ok(GOV_SIGNALS.includes('veterans affairs'));
    // State (Topic-1 vocabulary, each with a sidebar-pipeline.js precedent)
    assert.ok(GOV_SIGNALS.includes('human services'));
    assert.ok(GOV_SIGNALS.includes('parks and wildlife'));
    assert.ok(GOV_SIGNALS.includes('state of '));
    assert.ok(GOV_SIGNALS.includes('comptroller'));
  });
  it('"motor vehicles" is deliberately absent from GOV_SIGNALS (no sidebar precedent, dealer collision risk)', () => {
    assert.equal(GOV_SIGNALS.includes('motor vehicles'), false);
  });
});
