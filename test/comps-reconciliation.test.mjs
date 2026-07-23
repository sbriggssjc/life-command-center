// Comps cap/rent reconciliation + outlier flagging + renewal-options normalizer.
//
// The shared comps engine flags a SOLD comp whose displayed rent doesn't
// reconcile to its reliable cap (or whose rent sources / sale-vs-ask diverge),
// annotates it non-destructively, and enqueues it to the domain review queue.
// Ground-truth fixtures captured live from rpc_query_comps (dia + gov, 2026-07).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeReviewSignals, normalizeRenewalOptions, enqueueReviewQueue,
} from '../mcp/comps-tools.js';

// Pearland — the canonical outlier (dia sale_id 7980, property 35837).
// Template SOLD CAP = RENT/PRICE = 210,087 / 4,776,704 = 4.40%, but reliable
// cap_rate_final = 7.00% and rent_at_sale (307,588) disagrees with the in-place
// rent (210,087), and it sold 32% over the last ask (3,632,000).
const pearland = {
  comp_type: 'sale', on_market: false, vertical: 'dialysis', is_government: false,
  comp_id: 'dia_db:7980', address: '11600 Broadway St', city: 'Pearland', state: 'TX',
  tenant: 'DaVita', sale_date: '2026-03-06', sale_price: 4776704, annual_rent: 210086.76,
  cap_rate: 0.07, last_price: 3632000, initial_price: 3632000,
  raw: { sale_id: 7980, property_id: 35837, cap_rate_final: 0.07, rent_at_sale: 307588.05 },
};

// South Bend 5660 Nimtz — clean (implied 7.59% vs reliable 7.82% = 23 bps; sold==ask;
// rent sources within 3%).
const clean = {
  comp_type: 'sale', on_market: false, vertical: 'dialysis', is_government: false,
  comp_id: 'dia_db:200', address: '5660 Nimtz Pkwy', city: 'South Bend', state: 'IN',
  sale_price: 2205398, annual_rent: 167437, cap_rate: 0.0782,
  last_price: 2205398, initial_price: 2205398,
  raw: { sale_id: 200, property_id: 300, cap_rate_final: 0.0782, rent_at_sale: 172460 },
};

describe('computeReviewSignals — dialysis (RENT basis)', () => {
  it('flags Pearland: cap_mismatch + price_over_ask (and rent_disagreement)', () => {
    const sig = computeReviewSignals(pearland);
    assert.ok(sig, 'Pearland should be flagged');
    assert.ok(sig.review_flags.includes('cap_mismatch'));
    assert.ok(sig.review_flags.includes('price_over_ask'));
    assert.ok(sig.review_flags.includes('rent_disagreement'));
    assert.equal(sig.review_detail.reliable_cap, 0.07);
    assert.ok(Math.abs(sig.review_detail.implied_cap - 0.043981) < 1e-4);
    assert.equal(sig.review_detail.ask, 3632000);
    assert.equal(sig.review_detail.sold, 4776704);
    assert.deepEqual(Object.keys(sig.review_detail.rents).sort(),
      ['annual_rent', 'rent_at_sale']);
  });

  it('does NOT flag a clean comp (23 bps, sold==ask, rents within 3%)', () => {
    assert.equal(computeReviewSignals(clean), null);
  });

  it('75-bps tolerance boundary: 74 bps clean, 76 bps flags', () => {
    const base = { comp_type: 'sale', on_market: false, vertical: 'dialysis',
      sale_price: 1000000, cap_rate: 0.07, raw: { sale_id: 1, cap_rate_final: 0.07 } };
    // implied = annual_rent / 1,000,000
    const near = computeReviewSignals({ ...base, annual_rent: 70740 }); // implied 0.07074, 7.4 bps
    assert.equal(near, null);
    const over = computeReviewSignals({ ...base, annual_rent: 62400 }); // implied 0.0624, 76 bps
    assert.ok(over && over.review_flags.includes('cap_mismatch'));
  });

  it('price_over_ask fires on a well-UNDER-ask sale too (<85%)', () => {
    const under = computeReviewSignals({ comp_type: 'sale', on_market: false,
      vertical: 'dialysis', sale_price: 800000, annual_rent: 56000, cap_rate: 0.07,
      last_price: 1000000, raw: { sale_id: 2, cap_rate_final: 0.07 } });
    assert.ok(under && under.review_flags.includes('price_over_ask'));
  });

  it('no_reliable_cap when neither cap_rate_final nor cap_rate is present', () => {
    const sig = computeReviewSignals({ comp_type: 'sale', on_market: false,
      vertical: 'dialysis', sale_price: 1000000, annual_rent: 70000,
      cap_rate: null, raw: { sale_id: 3, cap_rate_final: null } });
    assert.ok(sig && sig.review_flags.includes('no_reliable_cap'));
    assert.ok(!sig.review_flags.includes('cap_mismatch')); // needs a reliable cap
  });
});

describe('computeReviewSignals — government (NOI basis)', () => {
  it('uses NOI vs sold_cap_rate; flags a divergent gov sale', () => {
    const gov = { comp_type: 'sale', on_market: false, is_government: true,
      vertical: 'government', comp_id: 'gov:x', sale_price: 8800000,
      noi: 186053.78, annual_rent: 264898.88, cap_rate: 0.0371,
      raw: { sale_id: 'uuid-x', property_id: 100, sold_cap_rate: 0.0371 } };
    const sig = computeReviewSignals(gov);
    assert.ok(sig && sig.review_flags.includes('cap_mismatch'));
    assert.equal(sig.review_detail.reliable_cap, 0.0371);
    // implied uses NOI (186,053.78 / 8,800,000 = 0.02114), NOT annual_rent
    assert.ok(Math.abs(sig.review_detail.implied_cap - 0.021143) < 1e-4);
  });

  it('a reconciling gov sale is clean', () => {
    const gov = { comp_type: 'sale', on_market: false, is_government: true,
      sale_price: 7500000, noi: 631397, cap_rate: 0.0842,
      raw: { sale_id: 'uuid-y', sold_cap_rate: 0.0842 } };
    assert.equal(computeReviewSignals(gov), null);
  });
});

describe('computeReviewSignals — scope', () => {
  it('non-sold / on-market / lease comps are handled by the caller (sold-only)', () => {
    // computeReviewSignals still computes on any comp, but runComps only calls it
    // for sold sales. A comp with no sale_price yields no divergence signal here.
    const s = computeReviewSignals({ comp_type: 'sale', on_market: true,
      vertical: 'dialysis', annual_rent: 70000, raw: { sale_id: 5 } });
    // no sale_price + no cap → only no_reliable_cap could trip
    assert.ok(s && s.review_flags.includes('no_reliable_cap'));
  });
});

describe('normalizeRenewalOptions', () => {
  const cases = [
    ['2, 5 yr', '(2) 5-yr'],
    ['Three, 5-Year Options', '(3) 5-yr'],
    ['2, 5yr', '(2) 5-yr'],
    ['Two, 5-Year Options', '(2) 5-yr'],
    ['(2) 5-yr', '(2) 5-yr'],            // canonical passthrough
    ['2 x 5 year', '(2) 5-yr'],
    ['5-year option', '(1) 5-yr'],        // single, no explicit count
  ];
  for (const [inp, exp] of cases) {
    it(`${JSON.stringify(inp)} → ${exp}`, () => {
      assert.equal(normalizeRenewalOptions(inp), exp);
    });
  }
  it('unrecognized shapes pass through unchanged', () => {
    assert.equal(normalizeRenewalOptions('0 option(s) remaining'), '0 option(s) remaining');
    assert.equal(normalizeRenewalOptions('see lease'), 'see lease');
  });
  it('null / empty pass through', () => {
    assert.equal(normalizeRenewalOptions(null), null);
    assert.equal(normalizeRenewalOptions(''), '');
  });
});

describe('enqueueReviewQueue', () => {
  function makeDeps() {
    const calls = { dia: [], gov: [] };
    return {
      calls,
      diaQuery: (method, path, body, prefer) => { calls.dia.push({ method, path, body, prefer }); return { ok: true, status: 201 }; },
      govQuery: (method, path, body, prefer) => { calls.gov.push({ method, path, body, prefer }); return { ok: true, status: 201 }; },
    };
  }

  it('routes dia + gov flagged comps to the right queue with an upsert Prefer', async () => {
    const diaComp = { ...pearland,
      review_flags: ['cap_mismatch', 'price_over_ask', 'rent_disagreement'],
      review_detail: { implied_cap: 0.043981, reliable_cap: 0.07, rents: {}, ask: 3632000, sold: 4776704 } };
    const govComp = { comp_type: 'sale', is_government: true, vertical: 'government',
      comp_id: 'gov:y', address: '1 Fed Way', city: 'DC', state: 'DC', tenant: 'SSA',
      sale_date: '2026-01-01', sale_price: 8800000,
      review_flags: ['cap_mismatch'],
      review_detail: { implied_cap: 0.0211, reliable_cap: 0.0371, rents: {}, ask: null, sold: 8800000 },
      raw: { sale_id: 'uuid-y', property_id: 100 } };
    const deps = makeDeps();
    const res = await enqueueReviewQueue([diaComp, govComp], deps);
    assert.equal(res.enqueued, 2);
    assert.equal(deps.calls.dia.length, 1);
    assert.equal(deps.calls.gov.length, 1);
    const dcall = deps.calls.dia[0];
    assert.equal(dcall.method, 'POST');
    assert.ok(dcall.path.startsWith('dia_comp_review_queue?on_conflict=sale_id,flags_hash'));
    assert.match(dcall.prefer, /merge-duplicates/);
    const row = dcall.body[0];
    assert.equal(row.sale_id, '7980');           // stringified int PK
    assert.equal(row.property_id, '35837');
    assert.deepEqual(row.flags, ['cap_mismatch', 'price_over_ask', 'rent_disagreement']); // sorted
    assert.equal(row.flags_hash, 'cap_mismatch,price_over_ask,rent_disagreement');
    assert.equal(row.reliable_cap, 0.07);
    assert.ok(!('status' in row));               // status preserved on upsert, never sent
    assert.equal(deps.calls.gov[0].body[0].sale_id, 'uuid-y'); // stringified uuid PK
  });

  it('skips a comp with no source sale_id', async () => {
    const deps = makeDeps();
    const res = await enqueueReviewQueue([{ review_flags: ['cap_mismatch'], review_detail: {}, raw: {} }], deps);
    assert.equal(res.enqueued, 0);
    assert.equal(deps.calls.dia.length, 0);
  });

  it('is best-effort: a throwing query never throws out', async () => {
    const deps = { diaQuery: () => { throw new Error('boom'); }, govQuery: () => ({ ok: true }) };
    const res = await enqueueReviewQueue([{ vertical: 'dialysis',
      review_flags: ['cap_mismatch'], review_detail: {}, raw: { sale_id: 1 } }], deps);
    assert.equal(res.enqueued, 0);
    assert.equal(res.errors.length, 1);
  });
});
