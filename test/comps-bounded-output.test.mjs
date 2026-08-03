import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseRequest, runSynthesize } from '../mcp/comps-tools.js';

const rows = [
  {
    comp_id: 'dia-1',
    source: 'dialysis_db',
    vertical: 'dialysis',
    tenant: 'DaVita',
    address: '100 Main St',
    city: 'The Villages',
    state: 'FL',
    building_sf: 9500,
    chairs: 18,
    patient_count: 112,
    sale_price: 4200000,
    cap_rate: 0.071,
    annual_rent: 298200,
    sale_date: '2025-05-01',
    confidence: 0.9,
  },
  {
    comp_id: 'dia-2',
    source: 'dialysis_db',
    vertical: 'dialysis',
    tenant: 'DaVita',
    address: '200 Main St',
    city: 'Orlando',
    state: 'FL',
    building_sf: 10000,
    sale_price: 5000000,
    cap_rate: 0.07,
    annual_rent: 350000,
    sale_date: '2025-06-01',
    confidence: 0.9,
  },
  {
    comp_id: 'dia-3',
    source: 'dialysis_db',
    vertical: 'dialysis',
    tenant: 'Fresenius',
    address: '300 Main St',
    city: 'The Villages',
    state: 'FL',
    building_sf: 10000,
    sale_price: 5000000,
    cap_rate: 0.07,
    annual_rent: 350000,
    sale_date: '2025-06-01',
    confidence: 0.9,
  },
];

function makeQuery(domain) {
  return async (method, path, body) => {
    if (method === 'POST' && path === 'rpc/rpc_query_comps') {
      assert.equal(body.p_tenant, null);
      assert.deepEqual(body.p_states, ['FL']);
      assert.deepEqual(body.p_metros, ['Wildwood-The Villages']);
      return { ok: true, status: 200, data: domain === 'dialysis' ? rows : [] };
    }
    if (method === 'POST' && /_engine_noi_batch$/.test(path)) {
      return { ok: true, status: 200, data: [] };
    }
    if (method === 'POST' && /_comp_review_queue/.test(path)) {
      return { ok: true, status: 200, data: [] };
    }
    return { ok: true, status: 200, data: [] };
  };
}

describe('comps engine bounded output', () => {
  it('parses DaVita/The Villages FL and returns bounded template-ready rows', async () => {
    const parsed = parseRequest('DaVita, The Villages, FL comps');
    assert.equal(parsed.tenant, 'DaVita');
    assert.deepEqual(parsed.states, ['FL']);
    assert.deepEqual(parsed.metros, ['Wildwood-The Villages']);
    assert.deepEqual(parsed.property_types, ['dialysis']);
    assert.equal(parsed.appraisal_mode, false);

    const result = await runSynthesize(
      { request: 'DaVita, The Villages, FL comps', tenant: null, limit: 10 },
      { govQuery: makeQuery('government'), diaQuery: makeQuery('dialysis') }
    );

    assert.equal(result.comps.length, 2);
    assert.deepEqual(result.comps.map(c => c.comp_id).sort(), ['dia-1', 'dia-3']);
    assert.equal(result.comps[0].raw, undefined);
    assert.equal(result.template_comps.length, 2);
    const davita = result.template_comps.find(c => c.comp_id === 'dia-1');
    assert.equal(davita.tenant, 'DaVita');
    assert.equal(davita.rba_sf, 9500);
    assert.equal(davita.chairs, 18);
    assert.equal(davita.patients, 112);
    assert.equal(davita.score_tier, 'A');
    assert.equal(result.meta.returned, 2);
    assert.ok(result.summary.includes('Methodology:'));
    assert.ok(result.transparency.includes('returned 2 of 2'));
  });

  it('turns a bare dialysis place request into appraisal mode defaults', () => {
    const parsed = parseRequest('I need dialysis comps for The Villages.');
    assert.deepEqual(parsed.states, ['FL']);
    assert.deepEqual(parsed.metros, ['Wildwood-The Villages']);
    assert.equal(parsed.subject.name, 'The Villages');
    assert.equal(parsed.appraisal_mode, true);
    assert.equal(parsed.include_unreliable_noi, true);
    assert.equal(parsed.include_on_market, true);
    assert.equal(parsed.comp_type, 'both');
    assert.equal(parsed.tenant, null);
  });

  it('parses operator lists without creating one tenant blob', () => {
    const parsed = parseRequest('DaVita and Fresenius sales nationwide since 2018.');
    assert.deepEqual(parsed.tenants, ['DaVita', 'Fresenius']);
    assert.equal(parsed.tenant, undefined);
    assert.deepEqual(parsed.property_types, ['dialysis']);
    assert.equal(parsed.date_from, '2018-01-01');
    assert.equal(parsed.comp_type, 'sale');
  });

  it('parses US Renal Texas trailing window as one tenant and TX state', () => {
    const parsed = parseRequest('US Renal comps in Texas, last 12 months.');
    assert.equal(parsed.tenant, 'US Renal');
    assert.deepEqual(parsed.states, ['TX']);
    assert.deepEqual(parsed.property_types, ['dialysis']);
    assert.match(parsed.date_from, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('routes government medical-office requests to government, not dialysis defaults', async () => {
    const calls = [];
    const govRow = { ...rows[0], comp_id: 'gov-1', source: 'gov_db', vertical: 'government', is_government: true, tenant: 'VA' };
    const deps = {
      govQuery: async (method, path, body) => {
        if (path === 'rpc/rpc_query_comps') calls.push(['gov', body]);
        return { ok: true, status: 200, data: path === 'rpc/rpc_query_comps' ? [govRow] : [] };
      },
      diaQuery: async (method, path, body) => {
        if (path === 'rpc/rpc_query_comps') calls.push(['dia', body]);
        return { ok: true, status: 200, data: [] };
      },
    };
    const result = await runSynthesize({ request: 'Government medical-office comps in Texas, last 12 months.' }, deps);
    assert.deepEqual(calls.map(c => c[0]), ['gov']);
    assert.deepEqual(result.interpreted_query.verticals, ['government']);
    assert.equal(result.interpreted_query.government_only, true);
    assert.equal(result.interpreted_query.include_unreliable_noi, false);
  });
});
