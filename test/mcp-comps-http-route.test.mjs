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

describe('MCP /api/comps one-shot HTTP route', () => {
  let server;
  let port;

  before(async () => {
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
          expires_in_seconds: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${u}`);
    };

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
