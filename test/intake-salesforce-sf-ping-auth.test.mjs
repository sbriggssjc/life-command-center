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
    const body = src.slice(start, start + 1500);
    assert.doesNotMatch(body, /SF_PASSWORD/);
    assert.doesNotMatch(body, /SF_SECURITY_TOKEN/);
    assert.doesNotMatch(body, /sessionId/);
  });
});
