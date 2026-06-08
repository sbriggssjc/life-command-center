// Round 74 Task 2 — sf-nm-classifier unit tests.
// Validates the three judgments (vertical / NM-listing / comp-exclusion) and
// the multi-strategy + multi-tenant rules that Scott's integrity constraint
// demands. Run: node --test test/sf-nm-classifier.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyVertical, classifyNmListing, isExcludedFromComps, classifyDeal, normalizeDealRow,
} from '../api/_shared/sf-nm-classifier.js';

describe('classifyVertical — dialysis membership (multi-strategy)', () => {
  it('named operator tenant → dia', () => {
    const v = classifyVertical({ tenant: 'DaVita Dialysis - Auburn', deal_name: 'DaVita - Auburn' });
    assert.equal(v.vertical, 'dia');
    assert.ok(v.operators.includes('DaVita'));
    assert.equal(v.generic_only, false);
  });

  it('Fresenius aliases (FMC / Bio-Med) → dia', () => {
    assert.equal(classifyVertical({ tenant: 'FMC' }).vertical, 'dia');
    assert.equal(classifyVertical({ tenant: 'Fresenius Medical Care|Bio-Med' }).vertical, 'dia');
  });

  it('MULTI-TENANT building (Bank of America|DaVita) still classifies dia', () => {
    const v = classifyVertical({ tenant: 'Bank of America|DaVita Dialysis' });
    assert.equal(v.vertical, 'dia');
    assert.ok(v.operators.includes('DaVita'));
  });

  it('property_use=Dialysis with no operator name → dia', () => {
    const v = classifyVertical({ tenant: 'Confidential', property_use: 'Dialysis' });
    assert.equal(v.vertical, 'dia');
  });

  it('non-dialysis tenant does NOT false-positive on substring', () => {
    const v = classifyVertical({ tenant: 'Bank of America' });
    assert.equal(v.dia, false);
  });
});

describe('classifyVertical — government membership', () => {
  it('GSA / agency tenant → gov', () => {
    assert.equal(classifyVertical({ tenant: 'GSA - Social Security Administration' }).vertical, 'gov');
    assert.equal(classifyVertical({ tenant: 'Department of Veterans Affairs' }).vertical, 'gov');
  });

  it('is_government flag → gov even with vague tenant', () => {
    const v = classifyVertical({ tenant: 'Confidential Office', is_government: 'Y' });
    assert.equal(v.vertical, 'gov');
    assert.ok(v.signals.includes('flag:is_government'));
  });

  it('gov lease-number format → gov', () => {
    const v = classifyVertical({ tenant: 'Office', lease_number: 'GS-03B-12345' });
    assert.equal(v.vertical, 'gov');
    assert.ok(v.signals.includes('lease_number:gov'));
  });

  it('INCLUSIVE-dia: fed building that also has a named dialysis tenant → dia', () => {
    const v = classifyVertical({ tenant: 'GSA|DaVita Dialysis' });
    assert.equal(v.vertical, 'dia'); // named operator wins over agency
    assert.equal(v.gov, true);       // but gov membership is still reported
  });

  it('generic-only dia keyword defers to a strong gov signal', () => {
    const v = classifyVertical({ deal_name: 'kidney institute building', is_government: 'Y', tenant: 'GSA' });
    assert.equal(v.vertical, 'gov');
  });
});

describe('classifyNmListing — Scott\'s NM-LISTED rule', () => {
  it('Direct (Both) on a NM team → NM-listed', () => {
    const r = classifyNmListing({ direct_co_broke: 'Direct (Both)', broker_team: 'Team Briggs' });
    assert.equal(r.is_northmarq, true);
    assert.equal(r.is_northmarq_buyside, false);
  });

  it('Co-Broke (Seller) → NM-listed', () => {
    assert.equal(classifyNmListing({ direct_co_broke: 'Co-Broke (Seller)', broker_team: 'Team Scrivner' }).is_northmarq, true);
  });

  it('Co-Broke (Buyer) → buy-side only, NOT NM-listed', () => {
    const r = classifyNmListing({ direct_co_broke: 'Co-Broke (Buyer)', broker_team: 'Team Briggs' });
    assert.equal(r.is_northmarq, false);
    assert.equal(r.is_northmarq_buyside, true);
  });

  it('listing-side with MISSING team is still NM-listed (closed-won universe)', () => {
    const r = classifyNmListing({ direct_co_broke: 'Co-Broke (Seller)', broker_team: null });
    assert.equal(r.is_northmarq, true);
    assert.equal(r.nm_team_source, 'assumed_from_universe');
  });

  it('positively-external team demotes a listing-side deal', () => {
    const r = classifyNmListing({ direct_co_broke: 'Co-Broke (Seller)', broker_team: 'External Co-Broke Only' });
    assert.equal(r.is_northmarq, false);
  });

  it('null Direct/Co-Broke → neither', () => {
    const r = classifyNmListing({ direct_co_broke: null, broker_team: 'Team Briggs' });
    assert.equal(r.is_northmarq, false);
    assert.equal(r.is_northmarq_buyside, false);
  });
});

describe('isExcludedFromComps — Task 4 non-comp filter', () => {
  it('referral fee deal excluded', () => {
    const r = isExcludedFromComps({ deal_name: 'DaVita - Tuscaloosa (Referral Fee)', sale_price: null });
    assert.equal(r.excluded, true);
    assert.ok(r.reasons.includes('no_sale_price'));
  });

  it('portfolio row excluded', () => {
    assert.equal(isExcludedFromComps({ deal_name: 'Fresenius Portfolio (5 assets)', sale_price: 50000000 }).excluded, true);
  });

  it('real single-asset sale kept', () => {
    assert.equal(isExcludedFromComps({ deal_name: 'DaVita - Auburn - WA', sale_price: 7120503 }).excluded, false);
  });
});

describe('classifyDeal — merged verdict + header normalization', () => {
  it('normalizes truncated Excel headers via row+headers form', () => {
    const headers = ['DEAL NAME', 'TENANT', 'DIRECT / CO-BROKE', 'BROKER TEAM', 'SALE PRICE', 'CAP RATE', 'STATE', 'CLOSE DATE'];
    const row = ['DaVita - Auburn - WA', 'DaVita Dialysis', 'Co-Broke (Seller)', 'Team Briggs', '7120503', '6.35', 'WA', '2025-06-23'];
    const v = classifyDeal(normalizeDealRow(row, headers));
    assert.equal(v.vertical, 'dia');
    assert.equal(v.is_northmarq, true);
    assert.equal(v.is_comp, true);
    assert.equal(v.is_northmarq_source, 'salesforce');
    assert.equal(v.sale_price, 7120503);
  });
});
