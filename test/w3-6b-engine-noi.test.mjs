// W3.6b — systemic comp-NOI fix: the review producer derives implied_cap from the
// CAP ENGINE's income (gov_compute_cap_rate NOI / dia_compute_cap_rate net rent),
// the same reconciled active-lease figure the engine uses, falling back to the
// stale properties value (gov: properties.noi; dia: annual_rent) only when the
// engine has nothing — and labels which source fed the number.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeReviewSignals, attachEngineIncome } from '../mcp/comps-tools.js';

// The canonical W3.6 gov row (70 Commercial St, Concord NH; property 9388, sale
// 6a20b2fb). Stale properties.noi = 186,053.78 @ estimated_comp_ratio → implied
// 2.11%; ingested sold_cap_rate (reliable) = 3.71%. The engine reconciles to
// 3.71% via the active GSA lease (NOI 326,480).
const govStale = {
  comp_type: 'sale', on_market: false, is_government: true, vertical: 'government',
  comp_id: 'gov:9388', sale_price: 8800000,
  noi: 186053.78, noi_source: 'estimated_comp_ratio', noi_as_of_date: '2026-03-31',
  annual_rent: 264898.88, cap_rate: 0.0371, sale_date: '2026-06-23',
  raw: { sale_id: '6a20b2fb', property_id: 9388, sold_cap_rate: 0.0371 },
};

describe('computeReviewSignals — engine income (gov NOI)', () => {
  it('FALLBACK (no engine income attached): still flags cap_mismatch off stale properties.noi', () => {
    const sig = computeReviewSignals(govStale);
    assert.ok(sig && sig.review_flags.includes('cap_mismatch'));
    assert.ok(Math.abs(sig.review_detail.implied_cap - 0.021143) < 1e-4);
    // labels the stale source
    assert.equal(sig.review_detail.implied_basis.source, 'estimated_comp_ratio');
    assert.equal(sig.review_detail.implied_basis.engine_used, false);
  });

  it('ENGINE income attached: clears cap_mismatch when the engine reconciles', () => {
    const c = { ...govStale,
      engine_income: 326480, engine_income_source: 'lease_rent_minus_anchored_opex',
      engine_income_confidence: 'high', engine_cap: 0.0371 };
    // implied = 326,480 / 8,800,000 = 3.71% == reliable 3.71% → no cap_mismatch
    const sig = computeReviewSignals(c);
    assert.equal(sig, null, 'engine-reconciled comp should not flag');
  });

  it('ENGINE income labels the source + as-of on a still-conflicting row', () => {
    // engine income of 500,000 → implied 5.68%, reliable 3.71% → still cap_mismatch
    const c = { ...govStale,
      engine_income: 500000, engine_income_source: 'lease_active',
      engine_income_confidence: 'medium', engine_cap: 0.0568 };
    const sig = computeReviewSignals(c);
    assert.ok(sig && sig.review_flags.includes('cap_mismatch'));
    const b = sig.review_detail.implied_basis;
    assert.equal(b.engine_used, true);
    assert.equal(b.value, 500000);
    assert.equal(b.kind, 'NOI');
    assert.equal(b.source, 'engine:lease_active (medium)');
    assert.equal(b.as_of, '2026-06-23');           // sale date, not the stale noi_as_of
  });
});

describe('computeReviewSignals — engine income (dia net rent)', () => {
  const diaStale = {
    comp_type: 'sale', on_market: false, vertical: 'dialysis', is_government: false,
    sale_price: 2045000, annual_rent: 130971, cap_rate: 0.0796,
    raw: { sale_id: '900', property_id: 555, cap_rate_final: 0.0796 },
  };
  it('FALLBACK: flags off stale annual_rent (implied 6.40% vs reliable 7.96%)', () => {
    const sig = computeReviewSignals(diaStale);
    assert.ok(sig && sig.review_flags.includes('cap_mismatch'));
    assert.ok(Math.abs(sig.review_detail.implied_cap - 0.064044) < 1e-3);
    assert.equal(sig.review_detail.implied_basis.source, 'cap_rate_final');
  });
  it('ENGINE net rent reconciles → clears; labels engine source', () => {
    const c = { ...diaStale,
      engine_income: 162782, engine_income_source: 'rolled_forward', engine_income_confidence: 'high' };
    // 162,782 / 2,045,000 = 7.96% == reliable 7.96%
    assert.equal(computeReviewSignals(c), null);
  });
});

describe('attachEngineIncome — batched enrichment', () => {
  function govComp(saleId, pid) {
    return { comp_type: 'sale', on_market: false, is_government: true, vertical: 'government',
      sale_price: 8800000, sale_date: '2026-06-23', noi: 186053.78,
      raw: { sale_id: saleId, property_id: pid, sold_cap_rate: 0.0371 } };
  }
  it('routes gov sold comps to gov_engine_noi_batch and attaches the engine income', async () => {
    const c = govComp('6a20b2fb', 9388);
    const calls = [];
    const deps = {
      govQuery: (method, path, body) => {
        calls.push({ method, path, body });
        return { ok: true, status: 200, data: [{ sale_id: '6a20b2fb', property_id: 9388,
          engine_income: 326480, engine_cap: 0.0371, income_source: 'lease_rent_minus_anchored_opex',
          income_confidence: 'high', income_type: 'NOI' }] };
      },
      diaQuery: () => ({ ok: true, data: [] }),
    };
    const res = await attachEngineIncome([c], deps);
    assert.equal(res.gov, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.ok(calls[0].path.startsWith('rpc/gov_engine_noi_batch'));
    assert.equal(calls[0].body.p_items[0].sale_id, '6a20b2fb');
    assert.equal(calls[0].body.p_items[0].property_id, 9388);
    assert.equal(c.engine_income, 326480);
    assert.equal(c.engine_income_source, 'lease_rent_minus_anchored_opex');
    assert.equal(c.engine_income_confidence, 'high');
    // and computeReviewSignals now clears it
    assert.equal(computeReviewSignals(c), null);
  });

  it('does NOT attach when the engine returns null income (gross_rent tier)', async () => {
    const c = govComp('nulltier', 100);
    const deps = { govQuery: () => ({ ok: true, data: [{ sale_id: 'nulltier', property_id: 100,
      engine_income: null, engine_cap: 0.09, income_source: 'property_gross_rent',
      income_confidence: 'low', income_type: 'gross_rent' }] }) };
    await attachEngineIncome([c], deps);
    assert.equal(c.engine_income, undefined, 'null engine income leaves the fallback in place');
  });

  it('is best-effort: a throwing query never throws out and leaves fallback', async () => {
    const c = govComp('boom', 1);
    const deps = { govQuery: () => { throw new Error('boom'); } };
    const res = await attachEngineIncome([c], deps);
    assert.equal(c.engine_income, undefined);
    assert.equal(res.errors.length, 1);
  });

  it('skips on-market / non-sale / no-property comps', async () => {
    const calls = [];
    const deps = { govQuery: (m, p, b) => { calls.push(b); return { ok: true, data: [] }; } };
    await attachEngineIncome([
      { comp_type: 'sale', on_market: true, is_government: true, sale_price: 1, raw: { sale_id: 'a', property_id: 1 } },
      { comp_type: 'lease', is_government: true, sale_price: 1, raw: { sale_id: 'b', property_id: 1 } },
      { comp_type: 'sale', is_government: true, sale_price: 1, raw: { sale_id: 'c' } }, // no property_id
    ], deps);
    assert.equal(calls.length, 0, 'nothing eligible → no RPC call');
  });
});
