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
      assert.equal(body.p_tenant, 'DaVita');
      assert.deepEqual(body.p_states, ['FL']);
      assert.deepEqual(body.p_metros, ['The Villages']);
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
    assert.deepEqual(parsed.metros, ['The Villages']);
    assert.deepEqual(parsed.property_types, ['dialysis']);

    const result = await runSynthesize(
      { request: 'DaVita, The Villages, FL comps', limit: 10 },
      { govQuery: makeQuery('government'), diaQuery: makeQuery('dialysis') }
    );

    assert.equal(result.comps.length, 1);
    assert.equal(result.comps[0].comp_id, 'dia-1');
    assert.equal(result.comps[0].raw, undefined);
    assert.equal(result.template_comps.length, 1);
    assert.equal(result.template_comps[0].tenant, 'DaVita');
    assert.equal(result.template_comps[0].rba_sf, 9500);
    assert.equal(result.template_comps[0].chairs, 18);
    assert.equal(result.template_comps[0].patients, 112);
    assert.equal(result.meta.returned, 1);
  });
});
