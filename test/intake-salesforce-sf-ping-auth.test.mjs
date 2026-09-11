// SF-DIRECT — sf-ping sits behind the SAME authenticateWebhook() gate every
// other intake-salesforce action uses. `_shared/auth.ts` cannot be imported
// under plain `node --test` (it transitively imports
// `https://esm.sh/@supabase/supabase-js@2` via `supabase-client.ts`, which
// Node's ESM loader rejects — `ERR_UNSUPPORTED_ESM_URL_SCHEME`), so this is a
// structural/source check rather than a behavioural one: it proves sf-ping
// is (a) listed, (b) dispatched, and (c) sits AFTER the single, unconditional
// `authenticateWebhook(req)` gate that every other action in this file goes
// through — there is no per-action gate to test separately. The behavioural
// 401-without-secret / 200-with-secret check runs against the deployed
// function (see the SF-DIRECT response doc).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const SRC_URL = new URL('../supabase/functions/intake-salesforce/index.ts', import.meta.url);

describe('sf-ping is registered and gated the same as every other action', () => {
  it('is listed in the bare-GET service action listing', async () => {
    const src = await fs.readFile(SRC_URL, 'utf8');
    assert.match(src, /actions:\s*\[[^\]]*"sf-ping"[^\]]*\]/, 'sf-ping must be listed in the actions array');
  });

  it('GET dispatch routes action=sf-ping to a handler', async () => {
    const src = await fs.readFile(SRC_URL, 'utf8');
    assert.match(src, /action === "sf-ping"/, 'GET dispatch must route action=sf-ping');
    assert.match(src, /handleSfPing/, 'a handleSfPing function must exist and be called');
  });

  it('the authenticateWebhook(req) gate runs BEFORE the GET/POST action switch — sf-ping cannot bypass it', async () => {
    const src = await fs.readFile(SRC_URL, 'utf8');
    const gateIdx = src.indexOf('if (!authenticateWebhook(req))');
    const dispatchIdx = src.indexOf('if (req.method === "GET")', gateIdx + 1);
    const pingIdx = src.indexOf('action === "sf-ping"');
    assert.ok(gateIdx >= 0, 'authenticateWebhook gate must be present');
    assert.ok(dispatchIdx > gateIdx, 'the GET/POST dispatch must come after the auth gate');
    assert.ok(pingIdx > gateIdx, 'sf-ping dispatch must be reached only after the auth gate');
  });

  it('handleSfPing never returns SF_PASSWORD, SF_SECURITY_TOKEN, or a session id in its response', async () => {
    const src = await fs.readFile(SRC_URL, 'utf8');
    const start = src.indexOf('async function handleSfPing');
    assert.ok(start >= 0, 'handleSfPing must exist');
    const body = src.slice(start, start + 2500);
    assert.doesNotMatch(body, /SF_PASSWORD/);
    assert.doesNotMatch(body, /SF_SECURITY_TOKEN/);
    assert.doesNotMatch(body, /sessionId/);
  });
});

// SF-DIRECT-b — sf-ping falls back to the PA gateway's `soql` operation when
// SOAP is refused by the org's SSO policy, and ONLY then. These are
// structural checks for the same reason the block above is: `_shared/
// auth.ts` cannot be imported under plain `node --test`, so the fallback's
// gating (auth first; SOAP first; only the two named fault codes trigger the
// fallback) is asserted from source rather than by invoking the handler.
describe('sf-ping falls back to the PA gateway only on a named SOAP-refusal fault, after the auth gate', () => {
  it('imports sfGatewayQuery / SfGatewayError from the gateway helper', async () => {
    const src = await fs.readFile(SRC_URL, 'utf8');
    assert.match(src, /import\s*\{\s*sfGatewayQuery,\s*SfGatewayError\s*\}\s*from\s*"\.\.\/_shared\/salesforce-gateway\.ts"/);
  });

  it('the fallback fault-code set contains exactly INVALID_SSO_GATEWAY_URL and INVALID_LOGIN', async () => {
    const src = await fs.readFile(SRC_URL, 'utf8');
    const m = src.match(/SF_PING_FALLBACK_FAULT_CODES\s*=\s*new Set\(\[([^\]]*)\]\)/);
    assert.ok(m, 'SF_PING_FALLBACK_FAULT_CODES must be defined as a Set literal');
    const codes = m[1].split(',').map((s) => s.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')).filter(Boolean);
    assert.deepEqual(codes.sort(), ['INVALID_LOGIN', 'INVALID_SSO_GATEWAY_URL'].sort());
  });

  it('the gateway call is reached only inside handleSfPing, after the SOAP try/catch has already run', async () => {
    const src = await fs.readFile(SRC_URL, 'utf8');
    const start = src.indexOf('async function handleSfPing');
    assert.ok(start >= 0);
    const body = src.slice(start, start + 3500);
    const soapCallIdx = body.indexOf('await sfLogin()');
    const gatewayCallIdx = body.indexOf('await sfGatewayQuery(');
    assert.ok(soapCallIdx >= 0, 'handleSfPing must still attempt sfLogin() first');
    assert.ok(gatewayCallIdx > soapCallIdx, 'the gateway fallback must be reached only after the SOAP attempt');
  });

  it('success/failure responses from the fallback path are tagged via: "pa_gateway" and never omit soap_fault_code', async () => {
    const src = await fs.readFile(SRC_URL, 'utf8');
    const start = src.indexOf('async function handleSfPing');
    const body = src.slice(start, start + 3500);
    const matches = body.match(/via:\s*"pa_gateway"/g) || [];
    assert.ok(matches.length >= 2, 'both the fallback success and failure branches must tag via: "pa_gateway"');
    assert.match(body, /soap_fault_code:\s*soapFault\?\.faultCode\s*\?\?\s*null/);
  });

  it('handleSfPing never returns SF_LOOKUP_WEBHOOK_URL or a raw record body from the fallback path', async () => {
    const src = await fs.readFile(SRC_URL, 'utf8');
    const start = src.indexOf('async function handleSfPing');
    const body = src.slice(start, start + 3500);
    assert.doesNotMatch(body, /SF_LOOKUP_WEBHOOK_URL/);
    assert.doesNotMatch(body, /result\.records/);
  });
});

// 2026-09-09 (Cowork): the live v26 answered `fault_code:"sf:INVALID_SSO_GATEWAY_URL"`
// without falling back — Salesforce namespaces SOAP fault codes and the gate compared
// bare names. Guard the normaliser's BEHAVIOUR on the prefixed form, not the Set's contents.
describe('sf-ping fallback gate — namespaced fault codes', () => {
  let src;
  let m;
  it('bareFaultCode exists and the gate uses it', async () => {
    src = await fs.readFile(new URL('../supabase/functions/intake-salesforce/index.ts', import.meta.url), 'utf8');
    m = src.match(/export function bareFaultCode\([^)]*\): string \{([\s\S]*?)\n\}/);
    assert.ok(m, 'bareFaultCode not found');
    assert.match(src, /SF_PING_FALLBACK_FAULT_CODES\.has\(bareFaultCode\(err\.faultCode\)\)/);
  });
  it('POSITIVE CONTROL: "sf:INVALID_SSO_GATEWAY_URL" and "sf:INVALID_LOGIN" normalise to gate members', () => {
    const bare = new Function('code', m[1]);
    for (const raw of ['sf:INVALID_SSO_GATEWAY_URL', 'sf:INVALID_LOGIN', 'INVALID_LOGIN', '  sf:INVALID_SSO_GATEWAY_URL ']) {
      assert.ok(['INVALID_SSO_GATEWAY_URL', 'INVALID_LOGIN'].includes(bare(raw)), raw);
    }
    assert.equal(bare('sf:LOGIN_MUST_USE_SECURITY_TOKEN'), 'LOGIN_MUST_USE_SECURITY_TOKEN');
    assert.equal(bare(null), '');
  });
});
