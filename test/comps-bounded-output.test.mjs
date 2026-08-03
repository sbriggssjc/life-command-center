import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { enforceHttpResponseSize } from '../mcp/http-response-bound.js';
import { parseRequest, runGenerateCompsFromRequest, runSynthesize } from '../mcp/comps-tools.js';

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

function makeAppraisalQuery(domain, calls) {
  const regionalRows = [
    {
      comp_id: 'subject-row',
      source: 'dialysis_db',
      vertical: 'dialysis',
      tenant: 'DaVita',
      address: '1050 Old Camp Rd',
      city: 'The Villages',
      state: 'FL',
      building_sf: 9500,
      sale_price: 4300000,
      cap_rate: 0.071,
      annual_rent: 305300,
      sale_date: '2026-01-01',
      confidence: 0.9,
    },
    ...Array.from({ length: 14 }, (_, i) => ({
      comp_id: `fl-${i + 1}`,
      source: 'dialysis_db',
      vertical: 'dialysis',
      tenant: i % 2 ? 'DaVita' : 'Fresenius',
      address: `${100 + i} Florida Ave`,
      city: i % 2 ? 'Orlando' : 'Tampa',
      state: 'FL',
      building_sf: 9000 + i,
      sale_price: 4000000 + i,
      cap_rate: 0.068 + i / 10000,
      annual_rent: 275000 + i,
      sale_date: `2025-${String((i % 9) + 1).padStart(2, '0')}-01`,
      confidence: 0.85,
    })),
  ];
  const nationalRows = Array.from({ length: 18 }, (_, i) => ({
    comp_id: `nat-${i + 1}`,
    source: 'dialysis_db',
    vertical: 'dialysis',
    tenant: i % 2 ? 'US Renal' : 'DaVita',
    address: `${200 + i} National Rd`,
    city: i % 2 ? 'Atlanta' : 'Phoenix',
    state: i % 2 ? 'GA' : 'AZ',
    building_sf: 8500 + i,
    sale_price: 3500000 + i,
    cap_rate: 0.07 + i / 10000,
    annual_rent: 250000 + i,
    sale_date: `2024-${String((i % 9) + 1).padStart(2, '0')}-01`,
    confidence: 0.8,
  }));
  return async (method, path, body) => {
    if (method === 'POST' && path === 'rpc/rpc_query_comps') {
      calls.push([domain, body]);
      if (domain !== 'dialysis') return { ok: true, status: 200, data: [] };
      return { ok: true, status: 200, data: body.p_states ? regionalRows : nationalRows };
    }
    if (method === 'POST' && /_engine_noi_batch$/.test(path)) return { ok: true, status: 200, data: [] };
    if (method === 'POST' && /_comp_review_queue/.test(path)) return { ok: true, status: 200, data: [] };
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

  it('uses appraisal subject geography as ranking anchors, not hard filters', async () => {
    const calls = [];
    const result = await runSynthesize(
      {
        request: 'dialysis comps for The Villages, FL for an appraiser, 20-25 comps',
        subject: {
          name: 'The Villages',
          state: 'FL',
          metro: 'Wildwood-The Villages',
          region: 'Southeast',
          kind: 'subject_candidate',
          address: '1050 Old Camp Rd',
        },
        limit: 25,
      },
      { govQuery: makeAppraisalQuery('government', calls), diaQuery: makeAppraisalQuery('dialysis', calls) }
    );

    const primaryDialysis = calls.find(([domain, body]) => domain === 'dialysis' && body.p_states);
    const fallbackDialysis = calls.find(([domain, body]) => domain === 'dialysis' && !body.p_states);
    assert.ok(primaryDialysis);
    assert.ok(fallbackDialysis);
    assert.equal(primaryDialysis[1].p_metros, null);
    assert.deepEqual(primaryDialysis[1].p_states, ['FL', 'GA', 'AL', 'SC', 'NC', 'TN', 'MS']);
    assert.equal(fallbackDialysis[1].p_states, null);
    assert.equal(fallbackDialysis[1].p_metros, null);
    assert.equal(result.comps.length, 25);
    assert.equal(result.comps.some(c => c.comp_id === 'subject-row'), false);
    assert.equal(result.meta.excluded_subject, 1);
    assert.ok(result.comps.some(c => c.state === 'FL'));
    assert.ok(result.comps.some(c => c.state !== 'FL'));
    assert.match(result.transparency, /returned 25 of \d+/);
  });

  it('builds appraisal workbook server-side from request and returns only compact link metadata', async () => {
    const calls = [];
    let workbookPayload = null;
    const result = await runGenerateCompsFromRequest(
      {
        request: 'dialysis comps for The Villages, FL for an appraisal workbook',
        comp_type: 'sales',
        subject: {
          name: 'The Villages',
          state: 'FL',
          metro: 'Wildwood-The Villages',
          region: 'Southeast',
          address: '1050 Old Camp Rd',
        },
        limit: 25,
      },
      { govQuery: makeAppraisalQuery('government', calls), diaQuery: makeAppraisalQuery('dialysis', calls) },
      async (payload) => {
        workbookPayload = payload;
        return {
          status: 'ok',
          filename: 'The Villages comps.xlsx',
          download_url: 'https://example.test/download/the-villages.xlsx',
          expires_in_seconds: 3600,
        };
      }
    );

    assert.equal(result.download_url, 'https://example.test/download/the-villages.xlsx');
    assert.equal(result.counts.total, 25);
    assert.equal(result.counts.sold, 25);
    assert.equal(result.counts.on_market, 0);
    assert.equal(result.flagged_count, 0);
    assert.equal(result.tiers.A + result.tiers.B + result.tiers.C, 25);
    assert.equal(result.comps, undefined);
    assert.equal(result.template_comps, undefined);
    assert.equal(workbookPayload.comp_type, 'sales');
    assert.equal(workbookPayload.vertical, 'dialysis');
    assert.equal(workbookPayload.sold.length, 25);
    assert.equal(workbookPayload.sold.some(r => r.address === '1050 Old Camp Rd'), false);
    assert.ok(workbookPayload.sold.some(r => r.chairs === undefined));
    assert.ok(calls.some(([domain, body]) => domain === 'dialysis' && body.p_comp_type === 'both'));
  });

  it('preserves template_comps when the HTTP guard shrinks an oversized comps response', () => {
    const templateComps = Array.from({ length: 25 }, (_, i) => ({
      comp_id: `row-${i}`,
      address: `${i} Main St`,
      city: 'Testville',
      state: 'FL',
      sale_price: 1000000 + i,
      cap_rate: 0.07,
    }));
    const fullComps = templateComps.map(r => ({ ...r, review_detail: { blob: 'x'.repeat(5000) } }));
    const bounded = enforceHttpResponseSize({
      comps: fullComps,
      template_comps: templateComps,
      markdown: 'table',
      meta: { returned: 25 },
    }, { max: 4500 });

    assert.equal(bounded.template_comps.length, 25);
    assert.equal(bounded.comps, undefined);
    assert.equal(bounded.truncated, true);
    assert.match(bounded.truncation_note, /preserved all template_comps/);
  });

  it('keeps a user-named metro as a hard filter outside appraisal mode', async () => {
    const calls = [];
    const tampaRows = [
      { ...rows[0], comp_id: 'tampa-1', city: 'Tampa', metro: 'Tampa-St. Petersburg', address: '1 Tampa St' },
      { ...rows[1], comp_id: 'orlando-1', city: 'Orlando', metro: 'Orlando', address: '1 Orlando St' },
    ];
    const q = async (method, path, body) => {
      if (method === 'POST' && path === 'rpc/rpc_query_comps') {
        calls.push(body);
        return { ok: true, status: 200, data: tampaRows };
      }
      if (method === 'POST' && /_engine_noi_batch$/.test(path)) return { ok: true, status: 200, data: [] };
      if (method === 'POST' && /_comp_review_queue/.test(path)) return { ok: true, status: 200, data: [] };
      return { ok: true, status: 200, data: [] };
    };
    const result = await runSynthesize(
      { request: 'dialysis comps in Tampa', limit: 10 },
      { govQuery: q, diaQuery: q }
    );

    assert.equal(result.interpreted_query.appraisal_mode, false);
    assert.deepEqual(result.interpreted_query.metros, ['Tampa-St. Petersburg']);
    assert.ok(calls.every(c => c.p_metros?.[0] === 'Tampa-St. Petersburg'));
    assert.deepEqual(result.comps.map(c => c.comp_id), ['tampa-1']);
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
