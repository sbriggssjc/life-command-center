// Prompt 52 — comps engine: prefer enriched record, exclude bare duplicates, don't
// pin the subject's operator, rank on the displayed cap (rent ÷ price).
//   1. Appraisal pull for a DaVita subject returns a MIXED-operator set (not DaVita-only).
//   2. Bare duplicate records sharing an address never appear; the enriched record is used.
//   3. Ranking/discipline use the DISPLAYED cap (rent÷price); a stored cap that disagrees
//      by >25 bps is flagged; the appraisal set average holds below the subject.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runComps, runSynthesize, dropBareAddressDuplicates, dedupe, computeReviewSignals,
} from '../mcp/comps-tools.js';

const DAY = 86400000;
const daysAgoISO = n => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

// A mixed-operator dialysis sold universe (all recent, similar size/cap).
const MIXED = [
  { comp_id: 'dv1', source: 'dialysis_db', vertical: 'dialysis', is_government: false, comp_type: 'sale', on_market: false,
    tenant: 'DaVita', address: '10 Palm St', city: 'The Villages', state: 'FL', sale_date: daysAgoISO(60),  sale_price: 5000000, annual_rent: 300000, cap_rate: 0.060, building_sf: 8000, confidence: 0.85 },
  { comp_id: 'fr1', source: 'dialysis_db', vertical: 'dialysis', is_government: false, comp_type: 'sale', on_market: false,
    tenant: 'Fresenius Medical Care', address: '20 Oak Ave', city: 'Ocala', state: 'FL', sale_date: daysAgoISO(90), sale_price: 5200000, annual_rent: 312000, cap_rate: 0.060, building_sf: 8200, confidence: 0.85 },
  { comp_id: 'us1', source: 'dialysis_db', vertical: 'dialysis', is_government: false, comp_type: 'sale', on_market: false,
    tenant: 'U.S. Renal Care', address: '30 Pine Rd', city: 'Leesburg', state: 'FL', sale_date: daysAgoISO(120), sale_price: 4900000, annual_rent: 294000, cap_rate: 0.060, building_sf: 7900, confidence: 0.85 },
  { comp_id: 'ind1', source: 'dialysis_db', vertical: 'dialysis', is_government: false, comp_type: 'sale', on_market: false,
    tenant: 'Community Kidney Center', address: '40 Elm Ct', city: 'Wildwood', state: 'FL', sale_date: daysAgoISO(150), sale_price: 4700000, annual_rent: 282000, cap_rate: 0.060, building_sf: 7600, confidence: 0.85 },
];

function depsFrom(universe) {
  const diaQuery = async (method, path, body) => {
    if (path === 'rpc/rpc_query_comps') {
      const rows = universe.filter(r => {
        if (body.p_date_from && r.sale_date < body.p_date_from) return false;
        if (body.p_tenant) {
          const t = String(body.p_tenant).toLowerCase();
          if (t.includes('davita') && !r.tenant.toLowerCase().includes('davita')) return false;
        }
        return true;
      }).map(r => ({ ...r }));
      return { ok: true, status: 200, data: rows };
    }
    return { ok: false, status: 500, data: null };
  };
  const govQuery = async () => ({ ok: true, status: 200, data: [] });
  return { diaQuery, govQuery };
}

describe('Prompt 52 — operator is a similarity anchor, not a universe filter', () => {
  it('appraisal pull for a DaVita subject returns a MIXED-operator set', async () => {
    const deps = depsFrom(MIXED);
    const res = await runSynthesize({
      request: 'Build an appraisal comp set for our The Villages DaVita dialysis deal at a 6% cap',
    }, deps);
    assert.equal(res.interpreted_query.appraisal_mode, true);
    const tenants = new Set(res.comps.map(c => String(c.tenant || '').toLowerCase()));
    // DaVita is NOT the only operator returned.
    assert.ok(res.comps.length > 1, 'expected more than one comp');
    const nonDavita = res.comps.filter(c => !/davita/i.test(String(c.tenant || '')));
    assert.ok(nonDavita.length > 0, `expected non-DaVita comps, got tenants ${[...tenants].join(', ')}`);
  });

  it('an EXPLICIT "DaVita comps" request keeps the operator filter', async () => {
    const deps = depsFrom(MIXED);
    // No subject anchor → hard operator scope honored via the RPC p_tenant filter.
    const res = await runComps({ request: 'Pull DaVita comps in Florida' }, deps);
    assert.ok(res.comps.length >= 1);
    assert.ok(res.comps.every(c => /davita/i.test(String(c.tenant || ''))),
      'explicit DaVita request should return DaVita-only');
  });
});

describe('Prompt 52 — bare duplicates dropped, enriched record kept', () => {
  const ENRICHED = { comp_id: 'good', source: 'dialysis_db', vertical: 'dialysis', is_government: false,
    comp_type: 'sale', on_market: false, tenant: 'DaVita', address: '9341 Center St', city: 'Snellville',
    state: 'GA', sale_date: daysAgoISO(80), sale_price: 6000000, annual_rent: 360000, cap_rate: 0.060,
    building_sf: 9000, confidence: 0.85, property_id: 37547 };
  const BARE = { comp_id: 'bare', source: 'dialysis_db', vertical: 'dialysis', is_government: false,
    comp_type: 'sale', on_market: false, tenant: null, address: '9341 Center Street', city: 'Snellville',
    state: 'GA', property_id: 45519, confidence: 0.85 };

  it('dropBareAddressDuplicates removes the bare sibling', () => {
    const out = dropBareAddressDuplicates([ENRICHED, BARE]);
    assert.equal(out.length, 1);
    assert.equal(out[0].comp_id, 'good');
  });

  it('a bare record with no enriched sibling is kept (never fabricate a drop)', () => {
    const out = dropBareAddressDuplicates([BARE]);
    assert.equal(out.length, 1);
  });

  it('runComps drops the bare duplicate end-to-end', async () => {
    const deps = depsFrom([ENRICHED, BARE]);
    const res = await runComps({ request: 'dialysis sales in Georgia, all operators' }, deps);
    assert.ok(res.comps.every(c => c.comp_id !== 'bare'), 'bare duplicate must not surface');
    assert.equal(res.meta.bare_duplicates_dropped, 1);
  });
});

describe('Prompt 52 — displayed cap (rent ÷ price) drives ranking + discipline', () => {
  it('flags a record whose stored cap disagrees with rent÷price by >25 bps', () => {
    // rent 943,794 / price 15,729,896 = 6.00%; stored 6.62% → disagreement flagged.
    const sig = computeReviewSignals({
      vertical: 'dialysis', is_government: false, sale_price: 15729896, annual_rent: 943794,
      cap_rate: 0.0662, raw: { cap_rate_final: 0.0600 },
    });
    assert.ok(sig, 'expected review signals');
    assert.ok(sig.review_flags.includes('stored_cap_disagrees_display'),
      `flags were ${JSON.stringify(sig.review_flags)}`);
  });

  it('does NOT flag when stored cap matches rent÷price', () => {
    const sig = computeReviewSignals({
      vertical: 'dialysis', is_government: false, sale_price: 5000000, annual_rent: 300000,
      cap_rate: 0.0600, raw: { cap_rate_final: 0.0600 },
    });
    assert.ok(!sig || !sig.review_flags.includes('stored_cap_disagrees_display'));
  });
});

describe('Prompt 52 — appraisal set average holds below subject', () => {
  it('trims highest-cap comps so the primary average is below the subject cap', async () => {
    // Subject cap 6.00%; a spread of higher-cap comps present. Displayed cap = rent÷price.
    const universe = [];
    for (let i = 0; i < 10; i++) {
      const cap = 0.055 + i * 0.002; // 5.5% .. 7.3%
      universe.push({ comp_id: `c${i}`, source: 'dialysis_db', vertical: 'dialysis', is_government: false,
        comp_type: 'sale', on_market: false, tenant: 'DaVita', address: `${i} Main St`, city: 'Ocala',
        state: 'FL', sale_date: daysAgoISO(60 + i * 5), sale_price: 5000000, annual_rent: Math.round(5000000 * cap),
        cap_rate: cap, building_sf: 8000, confidence: 0.85, property_id: 1000 + i });
    }
    const deps = depsFrom(universe);
    const res = await runSynthesize({
      request: 'Appraisal dialysis comps for our Ocala FL DaVita deal at a 6% cap', limit: 12,
    }, deps);
    assert.equal(res.interpreted_query.appraisal_mode, true);
    const avg = res.meta.appraisal_primary_avg_cap;
    assert.ok(avg != null, 'expected a primary average cap');
    assert.ok(avg < 0.060 + 1e-9, `primary average cap ${avg} should be below the 6.00% subject`);
  });
});
