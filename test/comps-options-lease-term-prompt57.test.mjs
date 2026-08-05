// Prompt 57 — comps engine: OPTIONS normalization + lease-term discipline.
//   1. normalizeRenewalOptions / renewalOptionsForWorkbook collapse every raw OPTIONS
//      spelling to the single canonical "(N) M-yr" (or "(N)" unknown-term / "None").
//   2. The DISPLAYED appraisal set excludes comps with no lease expiration, remaining
//      term at close < 3 yr, or (on-market) no price — routed to review / counted, not shipped.
//   3. Both tabs render OPTIONS identically; no raw spelling survives to the sheet.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRenewalOptions, renewalOptionsForWorkbook,
  applyLeaseTermPriceDiscipline, compRemainingTermYears, compHasNoUsablePrice,
  runGenerateCompsFromRequest,
} from '../mcp/comps-tools.js';

const DAY = 86400000;
const daysAgoISO = n => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const daysAheadISO = n => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

describe('Prompt 57 — OPTIONS normalizer', () => {
  it('collapses every raw spelling to canonical "(N) M-yr"', () => {
    const cases = [
      ['Two (2) Five (5) Year', '(2) 5-yr'],
      ['Two (2), Five (5) Year', '(2) 5-yr'],
      ['three five-year options', '(3) 5-yr'],
      ['One, Five-Year Period', '(1) 5-yr'],
      ['(3) 5-yr', '(3) 5-yr'],
      ['(2) 5-yr', '(2) 5-yr'],
      ['2, 5yr', '(2) 5-yr'],
      ['Three, 5-Year Options', '(3) 5-yr'],
      ['5-year option', '(1) 5-yr'],
    ];
    for (const [inp, exp] of cases) assert.equal(normalizeRenewalOptions(inp), exp, `${inp} → ${exp}`);
  });

  it('keeps a bare count but never assumes a 5-yr term', () => {
    assert.equal(normalizeRenewalOptions('3'), '(3)');
    assert.equal(normalizeRenewalOptions('three options'), '(3)');
  });

  it('collapses every no-options spelling to "None", and defaults blank → "None" for the workbook', () => {
    for (const v of ['None', 'none', 'N/A', 'No options', '0']) assert.equal(normalizeRenewalOptions(v), 'None');
    for (const v of ['', null, undefined]) assert.equal(renewalOptionsForWorkbook(v), 'None');
    assert.equal(renewalOptionsForWorkbook('Two (2) Five (5) Year'), '(2) 5-yr');
  });
});

describe('Prompt 57 — lease-term + price discipline (unit)', () => {
  it('excludes no-term, sub-3-yr, and no-price comps with the right reasons', () => {
    const comps = [
      { comp_id: 'ok', on_market: false, sale_date: daysAgoISO(60), lease_expiration: daysAheadISO(365 * 10), sale_price: 5e6, annual_rent: 3e5 },
      { comp_id: 'noterm', on_market: false, sale_date: daysAgoISO(60), sale_price: 5e6, annual_rent: 3e5 },
      { comp_id: 'short', on_market: false, sale_date: daysAgoISO(60), lease_expiration: daysAheadISO(80), sale_price: 5e6, annual_rent: 3e5 },
      { comp_id: 'expired_at_sale', on_market: false, sale_date: daysAgoISO(60), lease_expiration: daysAgoISO(400), sale_price: 5e6, annual_rent: 3e5 },
      { comp_id: 'mkt_ok', on_market: true, lease_expiration: daysAheadISO(365 * 8), last_price: 6e6, annual_rent: 3e5 },
      { comp_id: 'mkt_noprice', on_market: true, lease_expiration: daysAheadISO(365 * 8), annual_rent: 3e5 },
    ];
    const { kept, excluded } = applyLeaseTermPriceDiscipline(comps, { minTermYears: 3 });
    const keptIds = kept.map(c => c.comp_id).sort();
    assert.deepEqual(keptIds, ['mkt_ok', 'ok']);
    const byId = Object.fromEntries(excluded.map(x => [x.comp.comp_id, x.reasons]));
    assert.deepEqual(byId.noterm, ['no_lease_term']);
    assert.deepEqual(byId.short, ['short_lease_term']);
    // a lease that expired before the sale reads as no usable term, not a sub-year stub
    assert.deepEqual(byId.expired_at_sale, ['no_lease_term']);
    assert.deepEqual(byId.mkt_noprice, ['no_price', 'no_lease_term'].filter(r => byId.mkt_noprice.includes(r)));
    assert.ok(byId.mkt_noprice.includes('no_price'));
  });

  it('helpers: remaining term prefers expiration-at-close, price detects an empty ask', () => {
    assert.equal(compRemainingTermYears({ on_market: false, sale_date: daysAgoISO(0), lease_expiration: daysAgoISO(400) }), null);
    assert.ok(compRemainingTermYears({ remaining_term: 12 }) === 12);
    assert.ok(compHasNoUsablePrice({ on_market: true }));
    assert.ok(!compHasNoUsablePrice({ on_market: true, last_price: 4e6 }));
  });

  it('the floor is tunable', () => {
    const comps = [{ comp_id: 'two_yr', on_market: false, sale_date: daysAgoISO(0), lease_expiration: daysAheadISO(365 * 2), sale_price: 5e6, annual_rent: 3e5 }];
    assert.equal(applyLeaseTermPriceDiscipline(comps, { minTermYears: 3 }).kept.length, 0);
    assert.equal(applyLeaseTermPriceDiscipline(comps, { minTermYears: 1 }).kept.length, 1);
  });
});

// ── End-to-end: the shipped workbook is clean of no-term / short-term / no-price rows,
//    OPTIONS renders identically on both tabs, and the exclusions are reported. ──
function universe() {
  const rows = [];
  const clean = [[0.0645, 'Two (2) Five (5) Year'], [0.0660, 'three five-year options'],
    [0.0680, 'One, Five-Year Period'], [0.0700, '(2) 5-yr'], [0.0655, '3'], [0.0670, null]];
  clean.forEach(([cap, opts], i) => {
    const price = 5_000_000, rent = Math.round(price * cap), rba = Math.round(rent / 30);
    rows.push({ comp_id: `sold${i}`, source: 'dialysis_db', vertical: 'dialysis', is_government: false,
      comp_type: 'sale', on_market: false, tenant: 'DaVita', address: `${i} Clean St`, city: 'The Villages',
      state: 'FL', sale_date: daysAgoISO(60 + i * 20), sale_price: price, annual_rent: rent,
      lease_expiration: daysAheadISO(365 * 10), building_sf: rba, cap_rate: cap, renewal_options: opts,
      confidence: 0.85, property_id: 500 + i, raw: { sale_id: 500 + i, property_id: 500 + i } });
  });
  // sold with NO lease expiration — must be excluded (no_lease_term)
  rows.push({ comp_id: 'soldNoTerm', source: 'dialysis_db', vertical: 'dialysis', is_government: false,
    comp_type: 'sale', on_market: false, tenant: 'DaVita', address: '2520 B F Terry Blvd', city: 'Rosenberg',
    state: 'TX', sale_date: daysAgoISO(120), sale_price: 5_000_000, annual_rent: 330_000, building_sf: 11000,
    cap_rate: 0.0660, confidence: 0.85, property_id: 610, raw: { sale_id: 610, property_id: 610 } });
  // sold with < 3 yr remaining at close — must be excluded (short_lease_term)
  rows.push({ comp_id: 'soldShort', source: 'dialysis_db', vertical: 'dialysis', is_government: false,
    comp_type: 'sale', on_market: false, tenant: 'DaVita', address: '320 Gideon Creek Way', city: 'Fuquay',
    state: 'NC', sale_date: daysAgoISO(90), lease_expiration: daysAheadISO(80), sale_price: 5_000_000,
    annual_rent: 330_000, building_sf: 11000, cap_rate: 0.0660, confidence: 0.85,
    property_id: 611, raw: { sale_id: 611, property_id: 611 } });
  // on-market with NO price — must be excluded (no_price)
  rows.push({ comp_id: 'mktNoPrice', source: 'dialysis_db', vertical: 'dialysis', is_government: false,
    comp_type: 'sale', on_market: true, tenant: 'DaVita', address: '1550 Goodman Ave', city: 'Columbus',
    state: 'OH', lease_expiration: daysAheadISO(365 * 8), annual_rent: 330_000, building_sf: 11000,
    confidence: 0.75, property_id: 700, raw: { listing_id: 700, property_id: 700 } });
  // on-market with NO lease details — must be excluded (no_lease_term)
  rows.push({ comp_id: 'mktNoTerm', source: 'dialysis_db', vertical: 'dialysis', is_government: false,
    comp_type: 'sale', on_market: true, tenant: 'DaVita', address: '1775 NW 80th Blvd', city: 'Gainesville',
    state: 'FL', last_price: 5_000_000, annual_rent: 330_000, building_sf: 11000,
    current_cap_rate: 0.0660, confidence: 0.75, property_id: 701, raw: { listing_id: 701, property_id: 701 } });
  // a clean on-market comp that SHOULD ship (real term + price)
  rows.push({ comp_id: 'mktOk', source: 'dialysis_db', vertical: 'dialysis', is_government: false,
    comp_type: 'sale', on_market: true, tenant: 'DaVita', address: '900 Market Ok Dr', city: 'Ocala',
    state: 'FL', last_price: 5_000_000, annual_rent: 335_000, building_sf: Math.round(335_000 / 30),
    lease_expiration: daysAheadISO(365 * 9), on_market_date: daysAgoISO(46), current_cap_rate: 0.0670,
    renewal_options: 'Two (2), Five (5) Year', confidence: 0.75, property_id: 702, raw: { listing_id: 702, property_id: 702 } });
  return rows;
}

function depsFrom(rows) {
  const enqueued = [];
  const diaQuery = async (method, path, body) => {
    if (path === 'rpc/rpc_query_comps') {
      const wantOnMkt = !!body.p_include_onmkt;
      const out = rows.filter(r => {
        if (!wantOnMkt && r.on_market === true) return false;
        if (body.p_date_from && !r.on_market && r.sale_date < body.p_date_from) return false;
        return true;
      }).map(r => ({ ...r }));
      return { ok: true, status: 200, data: out };
    }
    if (path.startsWith('dia_comp_review_queue')) { enqueued.push(...(body || [])); return { ok: true, status: 201, data: null }; }
    if (path === 'rpc/dia_engine_rent_batch') return { ok: true, status: 200, data: [] };
    return { ok: false, status: 500, data: null };
  };
  const govQuery = async () => ({ ok: true, status: 200, data: [] });
  return { diaQuery, govQuery, _enqueued: enqueued };
}

const SUBJECT = { name: 'The Villages DaVita', state: 'FL', cap_rate: 0.0675 };

describe('Prompt 57 — generate_comps ships a term-clean set with normalized OPTIONS', () => {
  it('excludes no-term / short-term / no-price rows and normalizes OPTIONS on both tabs', async () => {
    const deps = depsFrom(universe());
    let payload = null;
    const generateWorkbook = async p => { payload = p; return { status: 'ok', filename: 'x.xlsx', download_url: 'u', expires_in_seconds: 60 }; };
    const res = await runGenerateCompsFromRequest({
      request: 'Build an appraisal comp set for our The Villages DaVita — 1050 Old Camp Rd deal at a 6.75% cap',
      subject: SUBJECT, appraisal_mode: true,
    }, deps, generateWorkbook);

    const shipped = [...(payload.sold || []), ...(payload.on_market || [])];
    const shippedAddrs = shipped.map(r => r.address);
    // the four bad comps are gone from the displayed set
    for (const gone of ['2520 B F Terry Blvd', '320 Gideon Creek Way', '1550 Goodman Ave', '1775 NW 80th Blvd']) {
      assert.ok(!shippedAddrs.includes(gone), `${gone} must not ship`);
    }
    // the clean on-market comp with a real term + price still ships
    assert.ok(shippedAddrs.includes('900 Market Ok Dr'), 'clean on-market comp should ship');

    // OPTIONS is canonical on every shipped row and identical between tabs (never a raw spelling)
    const rawShapes = /Two \(2\)|Five \(5\)|five-year options|Five-Year Period|Three,/i;
    for (const r of shipped) {
      assert.ok(r.renewal_options && String(r.renewal_options).trim(), `row ${r.address} has blank OPTIONS`);
      assert.ok(!rawShapes.test(String(r.renewal_options)), `row ${r.address} OPTIONS still raw: ${r.renewal_options}`);
      assert.ok(/^\(\d+\)(\s\d+-yr)?$|^None$/.test(String(r.renewal_options)), `row ${r.address} OPTIONS not canonical: ${r.renewal_options}`);
    }

    // exclusions are reported (auditable) — 2 no-term, 1 short-term, 1 no-price
    assert.equal(res.excluded_for_review.no_lease_term, 2, 'two no-term exclusions');
    assert.equal(res.excluded_for_review.short_lease_term, 1, 'one short-term exclusion');
    assert.equal(res.excluded_for_review.no_price, 1, 'one no-price exclusion');
    assert.equal(res.excluded_for_review.min_remaining_term_years, 3);
  });
});
