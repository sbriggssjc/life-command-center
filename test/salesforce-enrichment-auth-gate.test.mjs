// SFENRICH-gate — index.ts sits behind authenticateWebhook() (via
// ../_shared/auth.ts) on EVERY route (there is no /health-equivalent bypass —
// the only GET route this function has is /diagnostics, which is itself a
// leak, not a health probe). Structural/source check for the same reason
// test/ai-copilot-auth-gate.test.mjs is: _shared/auth.ts cannot be imported
// under plain `node --test` (it transitively imports
// https://esm.sh/@supabase/supabase-js@2 via supabase-client.ts, which
// Node's ESM loader rejects). The behavioural 401-without-secret /
// 200-with-secret check runs against the deployed function.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const SRC_URL = new URL('../supabase/functions/salesforce-enrichment/index.ts', import.meta.url);
const CALLER_CLASS_URL = new URL('../supabase/functions/_shared/caller-class.ts', import.meta.url);

async function readSrc() {
  return fs.readFile(SRC_URL, 'utf8');
}

describe('salesforce-enrichment is gated behind authenticateWebhook() on every route', () => {
  it('imports authenticateWebhook from the shared auth module', async () => {
    const src = await readSrc();
    assert.match(src, /import\s*\{\s*authenticateWebhook\s*\}\s*from\s*"\.\.\/_shared\/auth\.ts"/);
  });

  it('the gate runs BEFORE the try/dispatch block, for every request', async () => {
    const src = await readSrc();
    const gateIdx = src.indexOf('if (!authenticateWebhook(req))');
    const tryIdx = src.lastIndexOf('try {');
    assert.ok(gateIdx >= 0, 'authenticateWebhook gate must be present');
    assert.ok(tryIdx > gateIdx, 'the GET/POST dispatch (inside try{}) must come after the gate');
  });

  it('there is no path exclusion around the gate — every route is gated', async () => {
    const src = await readSrc();
    // Unlike ai-copilot (which exempts /health), this function has no read
    // route worth exempting: /diagnostics IS the leak. The gate call must
    // not be wrapped in any `path !==` guard.
    const gateLineStart = src.lastIndexOf('\n', src.indexOf('if (!authenticateWebhook(req))'));
    const precedingLines = src.slice(0, gateLineStart);
    const lastFewLines = precedingLines.split('\n').slice(-4).join('\n');
    assert.doesNotMatch(lastFewLines, /path\s*!==\s*["']\/(health|diagnostics)/,
      'the gate must not be wrapped in a path exclusion for /health or /diagnostics');
  });

  it('/diagnostics dispatch is reached only after the gate check', async () => {
    const src = await readSrc();
    const gateIdx = src.indexOf('if (!authenticateWebhook(req))');
    const diagIdx = src.indexOf('path === "/diagnostics"');
    const runIdx = src.indexOf('path === "" || path === "/" || path === "/run"');
    assert.ok(diagIdx > gateIdx, '/diagnostics dispatch must be reached only after the auth gate');
    assert.ok(runIdx > gateIdx, '/run dispatch must be reached only after the auth gate');
  });

  it('log mode (default / unrecognised value) never returns 401 — it only logs DENY-WOULD and falls through', async () => {
    const src = await readSrc();
    const enforceIdx = src.indexOf('if (SFENRICH_AUTH_MODE === "enforce")');
    const status401Idx = src.indexOf('jsonResponse({ error: "unauthorized" }, 401)');
    assert.ok(enforceIdx >= 0, 'an explicit enforce-mode branch must exist');
    assert.ok(status401Idx > enforceIdx, '401 must be returned only inside the enforce branch');
    assert.match(src, /console\.log\(`\[sfenrich-auth\] DENY-WOULD/, 'a DENY-WOULD log line must exist for the log-mode path');
  });

  it('the DENY-WOULD log line never includes the raw secret or header value', async () => {
    const src = await readSrc();
    const logLineMatch = src.match(/console\.log\(`\[sfenrich-auth\] DENY-WOULD[^`]*`\);/);
    assert.ok(logLineMatch, 'DENY-WOULD log line must exist');
    const logLine = logLineMatch[0];
    assert.doesNotMatch(logLine, /webhook-secret/i, 'log line must not reference the secret header value');
    assert.doesNotMatch(logLine, /PA_WEBHOOK_SECRET/, 'log line must not reference the secret env var');
  });

  it('SFENRICH_AUTH_MODE has no third value — anything other than "enforce" behaves as log', async () => {
    const src = await readSrc();
    const modeChecks = src.match(/SFENRICH_AUTH_MODE\s*===/g) || [];
    assert.equal(modeChecks.length, 1, 'SFENRICH_AUTH_MODE must be checked exactly once, against "enforce" only');
  });

  it('SFENRICH_KNOWN_IPS is read from env via the shared parser, never a hardcoded address', async () => {
    const src = await readSrc();
    assert.match(src, /Deno\.env\.get\("SFENRICH_KNOWN_IPS"\)/);
    assert.match(src, /import\s*\{\s*parseKnownIps,\s*uaClass,\s*ipClass,\s*requestIp\s*\}\s*from\s*"\.\.\/_shared\/caller-class\.ts"/);
    assert.doesNotMatch(src, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'no hardcoded IP address may appear in source');
  });

  it('dry_run is the only request-derived input reaching the enrichment steps — every step query is a static template literal with no interpolation of request data', async () => {
    const src = await readSrc();
    // Positive control: a query string built by interpolating request data
    // would contain `${` inside the query template between `query: \`` and
    // its closing backtick. None of the 16 real step queries do.
    const queryBlocks = [...src.matchAll(/query:\s*`([\s\S]*?)`/g)].map((m) => m[1]);
    assert.ok(queryBlocks.length >= 15, `expected at least 15 step queries, found ${queryBlocks.length}`);
    for (const q of queryBlocks) {
      assert.doesNotMatch(q, /\$\{/, 'a step query must not interpolate any value — every query is a fixed template literal');
    }
    // dry_run is read from the URL and used only to choose whether to run
    // the steps at all, never fed into a query.
    assert.match(src, /url\.searchParams\.get\("dry_run"\)/);
  });

  it('positive control: an interpolated query would be caught', () => {
    const fakeSrc = 'const x = { query: `SELECT * FROM t WHERE id = ${req.id}` };';
    const queryBlocks = [...fakeSrc.matchAll(/query:\s*`([\s\S]*?)`/g)].map((m) => m[1]);
    assert.ok(queryBlocks.some((q) => /\$\{/.test(q)));
  });
});

describe('caller-class.ts is a shared module used by both ai-copilot and salesforce-enrichment', () => {
  it('exists and exports the four classifier helpers', async () => {
    const src = await fs.readFile(CALLER_CLASS_URL, 'utf8');
    assert.match(src, /export function parseKnownIps/);
    assert.match(src, /export function uaClass/);
    assert.match(src, /export function ipClass/);
    assert.match(src, /export function requestIp/);
  });

  it('both functions import it', async () => {
    const sfSrc = await readSrc();
    const copilotSrc = await fs.readFile(new URL('../supabase/functions/ai-copilot/index.ts', import.meta.url), 'utf8');
    assert.match(sfSrc, /from\s*"\.\.\/_shared\/caller-class\.ts"/);
    assert.match(copilotSrc, /from\s*"\.\.\/_shared\/caller-class\.ts"/);
  });

  it('ai-copilot no longer defines its own uaClass/ipClass/requestIp bodies — it delegates to the shared module', async () => {
    const copilotSrc = await fs.readFile(new URL('../supabase/functions/ai-copilot/index.ts', import.meta.url), 'utf8');
    // The old inline regex bodies must be gone from ai-copilot/index.ts itself.
    assert.doesNotMatch(copilotSrc, /azure-logic-apps/i, 'the UA regex body must live only in caller-class.ts now');
  });

  it('the classifier outputs are unchanged after the move (fixed UA/IP pairs)', async () => {
    // Import the real module to prove behaviour, not just shape.
    const mod = await import(CALLER_CLASS_URL.href);
    assert.equal(mod.uaClass('Mozilla/5.0 (Windows)'), 'browser');
    assert.equal(mod.uaClass('node-fetch/2.6.7'), 'node');
    assert.equal(mod.uaClass('azure-logic-apps/1.0'), 'logic-apps');
    assert.equal(mod.uaClass(''), 'other');
    assert.equal(mod.uaClass('SomeWeirdBot/1.0'), 'other');

    const known = mod.parseKnownIps('railway:152.55.,scott:10.0.0.');
    assert.equal(mod.ipClass('152.55.1.2', known), 'railway');
    assert.equal(mod.ipClass('10.0.0.5', known), 'scott');
    assert.equal(mod.ipClass('9.9.9.9', known), 'other');
    assert.equal(mod.ipClass('', known), 'other');

    const req1 = new Request('https://x/', { headers: { 'cf-connecting-ip': '1.2.3.4' } });
    assert.equal(mod.requestIp(req1), '1.2.3.4');
    const req2 = new Request('https://x/', { headers: { 'x-forwarded-for': '5.6.7.8, 9.9.9.9' } });
    assert.equal(mod.requestIp(req2), '5.6.7.8');
    const req3 = new Request('https://x/');
    assert.equal(mod.requestIp(req3), '');
  });
});
