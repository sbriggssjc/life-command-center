// COPILOT-OPEN-gate — index.ts sits behind authenticateWebhook() (via
// ../_shared/auth.ts) on every route except /health, before the GET/POST
// action switch. `_shared/auth.ts` cannot be imported under plain
// `node --test` (it transitively imports `https://esm.sh/@supabase/
// supabase-js@2` via supabase-client.ts, which Node's ESM loader rejects —
// `ERR_UNSUPPORTED_ESM_URL_SCHEME`), so this is a structural/source check,
// the same pattern test/intake-salesforce-sf-ping-auth.test.mjs already
// uses for the sibling function. The behavioural 401-without-secret /
// 200-with-secret check runs against the deployed function.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const SRC_URL = new URL('../supabase/functions/ai-copilot/index.ts', import.meta.url);

async function readSrc() {
  return fs.readFile(SRC_URL, 'utf8');
}

describe('ai-copilot is gated behind authenticateWebhook() except /health', () => {
  it('imports authenticateWebhook from the shared auth module', async () => {
    const src = await readSrc();
    assert.match(src, /import\s*\{\s*authenticateWebhook\s*\}\s*from\s*"\.\.\/_shared\/auth\.ts"/);
  });

  it('the gate runs BEFORE the try/dispatch block, for every request', async () => {
    const src = await readSrc();
    const gateIdx = src.indexOf('if (!authenticateWebhook(req))');
    const tryIdx = src.indexOf('try {');
    assert.ok(gateIdx >= 0, 'authenticateWebhook gate must be present');
    assert.ok(tryIdx > gateIdx, 'the GET/POST dispatch (inside try{}) must come after the gate');
  });

  it('/health is excluded from the gate, and only /health', async () => {
    const src = await readSrc();
    const gateBlockStart = src.indexOf('if (path !== "/health" && path !== "/health/") {');
    const gateCallIdx = src.indexOf('if (!authenticateWebhook(req))');
    assert.ok(gateBlockStart >= 0, 'the gate must be wrapped in a path !== /health check');
    assert.ok(gateCallIdx > gateBlockStart, 'authenticateWebhook must be called inside the /health exclusion, not before it');
  });

  it('every other GET/POST route is dispatched only after the gate check (structurally, by source order)', async () => {
    const src = await readSrc();
    const gateIdx = src.indexOf('if (!authenticateWebhook(req))');
    const dispatchRoutes = [
      'path === "/bd/config"',
      'path === "/sync/sf-tasks"',
      'path === "/sync/activities"',
      'path === "/chat"',
      'path === "/enrich"',
    ];
    for (const route of dispatchRoutes) {
      const idx = src.indexOf(route);
      assert.ok(idx > gateIdx, `${route} dispatch must be reached only after the auth gate`);
    }
  });

  it('log mode (default / unrecognised value) never returns 401 — it only logs DENY-WOULD and falls through', async () => {
    const src = await readSrc();
    // The only path that can return 401 is behind an explicit enforce check.
    const enforceIdx = src.indexOf('if (COPILOT_AUTH_MODE === "enforce")');
    const status401Idx = src.indexOf('jsonResponse({ error: "unauthorized" }, 401)');
    assert.ok(enforceIdx >= 0, 'an explicit enforce-mode branch must exist');
    assert.ok(status401Idx > enforceIdx, '401 must be returned only inside the enforce branch');
    assert.match(src, /console\.log\(`\[copilot-auth\] DENY-WOULD/, 'a DENY-WOULD log line must exist for the log-mode path');
  });

  it('the DENY-WOULD log line never includes the raw secret or header value', async () => {
    const src = await readSrc();
    const logLineMatch = src.match(/console\.log\(`\[copilot-auth\] DENY-WOULD[^`]*`\);/);
    assert.ok(logLineMatch, 'DENY-WOULD log line must exist');
    const logLine = logLineMatch[0];
    assert.doesNotMatch(logLine, /webhook-secret/i, 'log line must not reference the secret header value');
    assert.doesNotMatch(logLine, /PA_WEBHOOK_SECRET/, 'log line must not reference the secret env var');
  });

  it('COPILOT_AUTH_MODE has no third value — anything other than "enforce" behaves as log', async () => {
    const src = await readSrc();
    // There must be exactly one branch on COPILOT_AUTH_MODE, and it is the enforce check.
    const modeChecks = src.match(/COPILOT_AUTH_MODE\s*===/g) || [];
    assert.equal(modeChecks.length, 1, 'COPILOT_AUTH_MODE must be checked exactly once, against "enforce" only');
  });

  it('COPILOT_KNOWN_IPS is read from env, never a hardcoded address', async () => {
    const src = await readSrc();
    assert.match(src, /Deno\.env\.get\("COPILOT_KNOWN_IPS"\)/);
    // No literal dotted-quad IPv4 address anywhere in source.
    assert.doesNotMatch(src, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'no hardcoded IP address may appear in source');
  });
});

// COPILOT-OPEN-gate Unit 2 — the browser cannot hold PA_WEBHOOK_SECRET, so it
// must never call the ai-copilot edge URL directly (P194 doctrine: a browser
// caller can never be given the secret — route it through Railway). This is
// scoped to the front-end/extension files, NOT the whole repo — server.js,
// api/sync.js and supabase/functions/ all legitimately hold that URL as the
// real proxy target.
describe('the front end never calls the ai-copilot edge URL directly', () => {
  const FRONT_END_FILES = ['app.js', 'detail.js'];

  it('app.js and detail.js contain no reference to the edge function URL', async () => {
    for (const file of FRONT_END_FILES) {
      const src = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(
        src,
        /functions\/v1\/ai-copilot/,
        `${file} must read the ai-copilot edge function through /api/sync?_route=copilot-read, never the edge URL directly`
      );
    }
  });

  it('every extension source file contains no reference to the edge function URL', async () => {
    const path = await import('node:path');
    const extDir = path.join(new URL('..', import.meta.url).pathname, 'extension');
    let stack;
    try {
      stack = [extDir];
    } catch (_) {
      return; // no extension/ directory in this checkout — nothing to check
    }
    const checked = [];
    while (stack.length) {
      const dir = stack.pop();
      let dirents;
      try { dirents = await fs.readdir(dir, { withFileTypes: true }); } catch (_) { continue; }
      for (const d of dirents) {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) { stack.push(full); continue; }
        if (!/\.(js|ts|json)$/.test(d.name)) continue;
        const src = await fs.readFile(full, 'utf8');
        checked.push(full);
        assert.doesNotMatch(
          src,
          /functions\/v1\/ai-copilot/,
          `extension file ${full} must not hold the ai-copilot edge URL directly (P194 — a browser/extension caller can never hold the secret)`
        );
      }
    }
    assert.ok(checked.length > 0, 'sanity: the extension/ directory must exist and be walkable for this test to mean anything');
  });

  it('positive control — the check actually matches the banned string', () => {
    assert.match('https://x.supabase.co/functions/v1/ai-copilot', /functions\/v1\/ai-copilot/);
  });
});
