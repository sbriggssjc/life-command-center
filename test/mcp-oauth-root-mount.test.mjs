import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

process.env.BOV_API_KEY = process.env.BOV_API_KEY || 'test-bov-key';
process.env.BOV_SERVICE_URL = process.env.BOV_SERVICE_URL || 'https://bov.test';
process.env.LCC_API_KEY = 'prompt33-test-key';
process.env.MCP_BASE_URL = 'https://tranquil-delight-production-633f.up.railway.app';
process.env.DIA_SUPABASE_URL = process.env.DIA_SUPABASE_URL || 'https://dia.test';
process.env.DIA_SUPABASE_KEY = process.env.DIA_SUPABASE_KEY || 'dia-key';
process.env.GOV_SUPABASE_URL = process.env.GOV_SUPABASE_URL || 'https://gov.test';
process.env.GOV_SUPABASE_KEY = process.env.GOV_SUPABASE_KEY || 'gov-key';

function localRequest(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }
        : undefined,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('MCP OAuth routes on a root-mounted app', () => {
  let server;
  let port;

  before(async () => {
    const express = (await import('express')).default;
    const { mountLccMcp } = await import('../mcp/server.js');
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    mountLccMcp(app);
    app.get('*', (_req, res) => res.type('html').send('<!doctype html><title>SPA</title>'));
    server = await new Promise(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('serves OAuth authorization metadata as JSON instead of the SPA fallback', async () => {
    const res = await localRequest(port, 'GET', '/.well-known/oauth-authorization-server');

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] || '', /application\/json/);
    assert.equal(res.json.issuer, 'https://tranquil-delight-production-633f.up.railway.app');
    assert.equal(res.json.authorization_endpoint, 'https://tranquil-delight-production-633f.up.railway.app/authorize');
    assert.equal(res.json.token_endpoint, 'https://tranquil-delight-production-633f.up.railway.app/oauth/token');
    assert.equal(res.json.registration_endpoint, 'https://tranquil-delight-production-633f.up.railway.app/register');
    assert.doesNotMatch(res.text, /<!doctype html>/i);
  });

  it('serves protected-resource metadata for the root /mcp resource', async () => {
    const res = await localRequest(port, 'GET', '/.well-known/oauth-protected-resource');

    assert.equal(res.status, 200);
    assert.equal(res.json.resource, 'https://tranquil-delight-production-633f.up.railway.app/mcp');
    assert.deepEqual(res.json.authorization_servers, ['https://tranquil-delight-production-633f.up.railway.app']);
  });

  it('accepts dynamic client registration and returns LCC_API_KEY as client_secret', async () => {
    const res = await localRequest(port, 'POST', '/register', {
      client_name: 'Cowork LCC Deal Intelligence',
      redirect_uris: ['https://example.test/callback'],
    });

    assert.equal(res.status, 201);
    assert.match(res.json.client_id, /^lcc-/);
    assert.equal(res.json.client_secret, 'prompt33-test-key');
    assert.equal(res.json.client_secret_expires_at, 0);
    assert.equal(res.json.token_endpoint_auth_method, 'client_secret_post');
  });
});
