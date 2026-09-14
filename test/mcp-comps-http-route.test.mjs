import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

process.env.BOV_API_KEY = process.env.BOV_API_KEY || 'test-bov-key';
process.env.BOV_SERVICE_URL = process.env.BOV_SERVICE_URL || 'https://bov.test';
process.env.LCC_API_KEY = '';
process.env.DIA_SUPABASE_URL = process.env.DIA_SUPABASE_URL || 'https://dia.test';
process.env.DIA_SUPABASE_KEY = process.env.DIA_SUPABASE_KEY || 'dia-key';
process.env.GOV_SUPABASE_URL = process.env.GOV_SUPABASE_URL || 'https://gov.test';
process.env.GOV_SUPABASE_KEY = process.env.GOV_SUPABASE_KEY || 'gov-key';

const originalFetch = globalThis.fetch;

// Shared mock — the same shape for the MCP HTTP route AND the tranquil-delight
// api/comps.js one-shot, so both are proven to drive the ONE shared renderer.
// remaining_term is present so the appraisal lease-term discipline keeps the rows.
function installCompsFetchMock() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/rpc/rpc_query_comps')) {
      const body = JSON.parse(opts.body || '{}');
      const rows = body.p_include_onmkt ? [
        {
          comp_id: 'route-market-1',
          source: 'dialysis_db',
          vertical: 'dialysis',
          comp_type: 'listing',
          on_market: true,
          tenant: 'DaVita',
          address: '2 Listing Ln',
          city: 'Orlando',
          state: 'FL',
          building_sf: 9000,
          ask_price: 5100000,
          cap_rate: 0.059,
          annual_rent: 300900,
          remaining_term: 12,
          listing_date: '2026-01-01',
          confidence: 0.9,
        },
      ] : [
        {
          comp_id: 'route-sold-1',
          source: 'dialysis_db',
          vertical: 'dialysis',
          tenant: 'DaVita',
          address: '1 Sold St',
          city: 'Orlando',
          state: 'FL',
          building_sf: 9000,
          sale_price: 5000000,
          cap_rate: 0.06,
          annual_rent: 300000,
          remaining_term: 12,
          sale_date: '2025-01-01',
          confidence: 0.9,
        },
      ];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/\/rest\/v1\/rpc\/.*_engine_noi_batch/.test(u) || /_comp_review_queue/.test(u)) {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u === 'https://bov.test/generate-comps') {
      return new Response(JSON.stringify({
        status: 'ok',
        filename: 'route-comps.xlsx',
        download_url: 'https://download.test/route-comps.xlsx',
        comp_type: 'sales',
        expires_in_seconds: 3600,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
}

function localPost(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Minimal Express-shaped req/res for calling a handler directly.
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { return this; },
  };
  return res;
}

describe('MCP /api/comps one-shot HTTP route', () => {
  let server;
  let port;

  before(async () => {
    installCompsFetchMock();
    const express = (await import('express')).default;
    const { mountLccMcp } = await import('../mcp/server.js');
    const app = express();
    mountLccMcp(app, { installMiddleware: true });
    server = await new Promise(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    port = server.address().port;
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('returns 200 for one-shot workbook requests instead of ReferenceError', async () => {
    const res = await localPost(port, '/api/comps', {
      request: 'dialysis comps for The Villages, FL for an appraisal workbook at 6.00% cap',
      limit: 25,
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.download_url, 'https://download.test/route-comps.xlsx');
    assert.equal(res.json.counts.sold, 1);
    assert.equal(res.json.counts.on_market, 1);
    assert.doesNotMatch(res.text, /enforceHttpResponseSize is not defined|ReferenceError/);
  });
});

// Prompt 70 — tranquil-delight is a PROXY with no DB env. Its one-shot `request` mode
// forwards to the engine's own one-shot (${MCP_BASE}/api/comps) — the SAME pattern
// api/query-comps.js uses — instead of hitting the DB directly. Row-mode still builds
// directly through the BOV service.
describe('tranquil-delight api/comps.js', () => {
  let compsHandler;
  const ENGINE_BASE = 'https://engine.test';

  // Mock the engine one-shot upstream + the BOV row-mode upstream.
  function installProxyMock(engineHandler) {
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u === `${ENGINE_BASE}/api/comps`) return engineHandler(opts);
      if (u === 'https://bov.test/generate-comps') {
        return new Response(JSON.stringify({
          status: 'ok',
          filename: 'route-comps.xlsx',
          download_url: 'https://download.test/route-comps.xlsx',
          comp_type: 'sales',
          expires_in_seconds: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${u}`);
    };
  }

  before(async () => {
    process.env.GOV_API_URL = ENGINE_BASE;
    process.env.BOV_API_KEY = process.env.BOV_API_KEY || 'test-bov-key';
    compsHandler = (await import('../api/comps.js')).default;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('one-shot `request` forwards to ${MCP_BASE}/api/comps and returns its download link + counts', async () => {
    let forwarded = null;
    installProxyMock((opts) => {
      forwarded = JSON.parse(opts.body || '{}');
      return new Response(JSON.stringify({
        status: 'ok',
        filename: 'route-comps.xlsx',
        download_url: 'https://download.test/route-comps.xlsx',
        counts: { sold: 1, on_market: 1 },
        cap_rate_range: { min: 0.0529, max: 0.0708 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const res = mockRes();
    await compsHandler(
      { method: 'POST', headers: {}, query: {}, body: {
        request: 'dialysis sales comps for The Villages, FL for an appraisal workbook at 6.00% cap',
        limit: 25,
      } },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.download_url, 'https://download.test/route-comps.xlsx');
    assert.equal(res.body.counts.sold, 1);
    assert.equal(res.body.counts.on_market, 1);
    // The natural-language request (and one-shot fields) are passed straight through.
    assert.equal(forwarded.request, 'dialysis sales comps for The Villages, FL for an appraisal workbook at 6.00% cap');
    assert.equal(forwarded.limit, 25);
    // Compact result only — no raw support rows leak through the connector.
    assert.equal(res.body.comps, undefined);
  });

  it('one-shot upstream 5xx → 502', async () => {
    installProxyMock(() => new Response('engine boom', { status: 503 }));

    const res = mockRes();
    await compsHandler(
      { method: 'POST', headers: {}, query: {}, body: { request: 'dialysis comps for The Villages, FL' } },
      res,
    );
    assert.equal(res.statusCode, 502);
    assert.match(String(res.body.error || ''), /engine error 503/);
  });

  it('row-mode (explicit comp_type + rows) still builds directly, no synthesize', async () => {
    installProxyMock(() => { throw new Error('one-shot upstream must not be called in row mode'); });

    const res = mockRes();
    await compsHandler(
      { method: 'POST', headers: {}, query: {}, body: {
        comp_type: 'sales',
        sold: [{ tenant: 'DaVita', address: '1 Sold St', sale_price: 5000000, cap_rate: 0.06 }],
      } },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.download_url, 'https://download.test/route-comps.xlsx');
  });

  it('neither `request` nor rows → 400', async () => {
    installProxyMock(() => { throw new Error('no upstream in the 400 guard path'); });

    const res = mockRes();
    await compsHandler(
      { method: 'POST', headers: {}, query: {}, body: {} },
      res,
    );
    assert.equal(res.statusCode, 400);
    assert.match(String(res.body.error || ''), /comp_type|request/);
  });
});
