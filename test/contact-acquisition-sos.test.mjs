// W9.1 Stage 2 — SOS-direct wiring in the contact-acquisition engine.
// Unit-covers the flag gate + the CF-Access-headed webhook fetch seam. The live
// SOS fetch itself is the residential proxy's job (validated post-install).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sosDirectEnabled, sosWebhookFetcher } from '../api/_handlers/contact-acquisition-engine.js';

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

test('sosDirectEnabled: env flag OR registry row', () => {
  withEnv({ W9_1_SOS_DIRECT: undefined }, () => {
    assert.equal(sosDirectEnabled(null), false);
    assert.equal(sosDirectEnabled({ state: 'off' }), false);
    assert.equal(sosDirectEnabled({ state: 'on' }), true);
  });
  withEnv({ W9_1_SOS_DIRECT: 'true' }, () => {
    assert.equal(sosDirectEnabled(null), true);
  });
});

test('sosWebhookFetcher is undefined without OWNER_ENRICH_SOS_URL', () => {
  withEnv({ OWNER_ENRICH_SOS_URL: undefined }, () => {
    assert.equal(sosWebhookFetcher(), undefined);
  });
});

test('sosWebhookFetcher attaches the DEDICATED CF Access service-token headers', async () => {
  const captured = {};
  const savedFetch = global.fetch;
  global.fetch = async (url, init) => {
    captured.url = url; captured.init = init;
    return { ok: true, status: 200, async json() { return { person_name: 'Real Person', role: 'managing_member' }; } };
  };
  try {
    await withEnv({
      OWNER_ENRICH_SOS_URL: 'https://sos-proxy.example.com/lookup',
      SOS_PROXY_CF_ACCESS_CLIENT_ID: 'cid.access',
      SOS_PROXY_CF_ACCESS_CLIENT_SECRET: 'csecret',
    }, async () => {
      const fetcher = sosWebhookFetcher();
      const body = await fetcher({ state: 'FL', search_hint: 'https://search.sunbiz.org' }, 'ACME LLC', 'FL');
      assert.equal(captured.url, 'https://sos-proxy.example.com/lookup');
      assert.equal(captured.init.headers['CF-Access-Client-Id'], 'cid.access');
      assert.equal(captured.init.headers['CF-Access-Client-Secret'], 'csecret');
      assert.equal(body.person_name, 'Real Person');
    });
  } finally { global.fetch = savedFetch; }
});

test('sosWebhookFetcher throws on a non-ok webhook (honest-blocked, not silent)', async () => {
  const savedFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 403, async json() { return {}; } });
  try {
    await withEnv({ OWNER_ENRICH_SOS_URL: 'https://x/lookup' }, async () => {
      const fetcher = sosWebhookFetcher();
      await assert.rejects(() => fetcher({ state: 'FL' }, 'ACME LLC', 'FL'), /403/);
    });
  } finally { global.fetch = savedFetch; }
});
