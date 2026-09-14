// RAILWAY-PA-SECRET-log (2026-09-10) — guard for `webhookAuth()` in api/sync.js,
// the single gate the seven PA webhook handlers dispatch through.
//
// Structural: every handler calls webhookAuth(); nothing calls
// authenticateWebhook(req) directly outside its definition/helper.
// Behavioural: 'log' mode never 401s and logs a DENY-WOULD line naming the
// route/fallback-path/ua/ip when PA_WEBHOOK_SECRET is set and the fallback
// would deny; 'enforce' mode returns the fallback's real status; with
// PA_WEBHOOK_SECRET unset nothing is logged and nothing is refused; the log
// line never contains the secret or the API key value.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SYNC_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'sync.js');

const ENV_KEYS = [
  'OPS_SUPABASE_URL', 'OPS_SUPABASE_KEY', 'DIA_SUPABASE_URL', 'DIA_SUPABASE_KEY',
  'LCC_API_KEY', 'LCC_ENV', 'PA_WEBHOOK_SECRET', 'PA_WEBHOOK_AUTH_MODE', 'PA_WEBHOOK_KNOWN_IPS',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

function mockRes() {
  return {
    _status: null,
    _json: null,
    headersSent: false,
    _headers: {},
    setHeader(name, value) { this._headers[name] = value; },
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
  };
}

function mockReq({ method = 'POST', route, headers = {}, body = {} } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    method,
    url: `/api/sync?_route=${route}`,
    query: { _route: route },
    headers: lower,
    body,
    socket: { remoteAddress: '10.0.0.1' },
  };
}

async function loadHandler() {
  return (await import(`../api/sync.js?t=${Date.now()}-${Math.random()}`)).default;
}

function captureConsoleLog() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.map(String).join(' ')); };
  return { lines, restore: () => { console.log = original; } };
}

describe('PA webhook auth gate (webhookAuth in api/sync.js)', () => {
  beforeEach(() => {
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'ops-key';
    delete process.env.DIA_SUPABASE_URL;
    delete process.env.DIA_SUPABASE_KEY;
    delete process.env.LCC_API_KEY;
    delete process.env.LCC_ENV;
    delete process.env.PA_WEBHOOK_SECRET;
    delete process.env.PA_WEBHOOK_AUTH_MODE;
    delete process.env.PA_WEBHOOK_KNOWN_IPS;
  });

  afterEach(restoreEnv);

  // ── Structural ────────────────────────────────────────────────────────

  it('all seven webhook handlers dispatch through webhookAuth(); authenticateWebhook(req) appears nowhere else', () => {
    const raw = readFileSync(SYNC_PATH, 'utf8');
    // Strip // line comments and /* */ block comments before matching, so a
    // comment describing the old shape (or this test's own docstring, if it
    // were ever pasted into the file) cannot satisfy the assertion.
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    const dispatchSites = stripped.match(/await webhookAuth\(/g) || [];
    assert.equal(dispatchSites.length, 7, 'expected exactly 7 call sites dispatching through webhookAuth()');

    const allOccurrences = stripped.match(/authenticateWebhook\(req\)/g) || [];
    // Exactly two occurrences of the token `authenticateWebhook(req)` may
    // exist in the whole file: the function's own definition signature
    // (`function authenticateWebhook(req) {`) and the single call inside
    // webhookAuth() (`if (authenticateWebhook(req)) {`). Any handler calling
    // it directly (bypassing webhookAuth) adds a third occurrence.
    assert.equal(allOccurrences.length, 2, 'authenticateWebhook(req) must appear only in its own definition and inside webhookAuth()');

    // Positive control: a synthetic handler bypassing webhookAuth must fail
    // the same assertion (proves the count is load-bearing, not coincidence).
    const synthetic = stripped + `\nasync function handleSyntheticBypass(req, res) {\n  if (!authenticateWebhook(req)) { return res.status(401).json({}); }\n}\n`;
    const syntheticOccurrences = synthetic.match(/authenticateWebhook\(req\)/g) || [];
    assert.equal(syntheticOccurrences.length, 3, 'positive control sanity: the synthetic bypass must add a third occurrence');
  });

  it('webhookAuth() has a mode/log docstring naming both PA_WEBHOOK_AUTH_MODE values', () => {
    const raw = readFileSync(SYNC_PATH, 'utf8');
    assert.match(raw, /PA_WEBHOOK_AUTH_MODE/);
    assert.match(raw, /'enforce'/);
    assert.match(raw, /DENY-WOULD/);
  });

  // ── Behavioural ──────────────────────────────────────────────────────
  //
  // Deterministic non-DB path: an x-lcc-key header that does NOT match the
  // (unset) LCC_API_KEY takes authenticate()'s branch-2 "invalid API key"
  // arm, which never depends on LCC_ENV or a DB lookup — real and stub res
  // alike get a clean, reproducible deny with fallback-path 'api-key'.

  it('secret unset: no fallback ever runs, nothing is logged, nothing is refused', async () => {
    delete process.env.PA_WEBHOOK_SECRET;
    const handler = await loadHandler();
    const { lines, restore } = captureConsoleLog();
    try {
      const req = mockReq({ route: 'rcm-backfill', headers: { 'x-lcc-key': 'wrong-key' } });
      const res = mockRes();
      await handler(req, res);
      // Auth passed (no 401/403); DIA_SUPABASE_URL unset ⇒ falls through to
      // the handler's own 500, proving webhookAuth let it through.
      assert.equal(res._status, 500);
      assert.equal(lines.filter((l) => l.includes('[pa-webhook]')).length, 0);
    } finally {
      restore();
    }
  });

  it("log mode (default): fallback denies but the request still proceeds, and DENY-WOULD is logged", async () => {
    process.env.PA_WEBHOOK_SECRET = 'top-secret-value';
    delete process.env.PA_WEBHOOK_AUTH_MODE; // default = 'log'
    const handler = await loadHandler();
    const { lines, restore } = captureConsoleLog();
    try {
      const req = mockReq({ route: 'rcm-backfill', headers: { 'x-lcc-key': 'wrong-key' } });
      const res = mockRes();
      await handler(req, res);
      // Never 401/403 in log mode — falls through to the handler's own 500.
      assert.equal(res._status, 500);
      const denyLines = lines.filter((l) => l.startsWith('[pa-webhook] DENY-WOULD'));
      assert.equal(denyLines.length, 1);
      assert.match(denyLines[0], /^\[pa-webhook\] DENY-WOULD rcm-backfill api-key \S+ \S+$/);
    } finally {
      restore();
    }
  });

  it("enforce mode: the fallback's own 401 stands, and DENY-WOULD is still logged", async () => {
    process.env.PA_WEBHOOK_SECRET = 'top-secret-value';
    process.env.PA_WEBHOOK_AUTH_MODE = 'enforce';
    const handler = await loadHandler();
    const { lines, restore } = captureConsoleLog();
    try {
      const req = mockReq({ route: 'rcm-backfill', headers: { 'x-lcc-key': 'wrong-key' } });
      const res = mockRes();
      await handler(req, res);
      assert.equal(res._status, 401);
      assert.deepEqual(res._json, { error: 'Invalid API key' });
      const denyLines = lines.filter((l) => l.startsWith('[pa-webhook] DENY-WOULD'));
      assert.equal(denyLines.length, 1);
      assert.match(denyLines[0], /^\[pa-webhook\] DENY-WOULD rcm-backfill api-key \S+ \S+$/);
    } finally {
      restore();
    }
  });

  it('correct X-PA-Webhook-Secret always passes, in both modes, with no log line', async () => {
    for (const mode of [undefined, 'log', 'enforce']) {
      if (mode) process.env.PA_WEBHOOK_AUTH_MODE = mode; else delete process.env.PA_WEBHOOK_AUTH_MODE;
      process.env.PA_WEBHOOK_SECRET = 'top-secret-value';
      const handler = await loadHandler();
      const { lines, restore } = captureConsoleLog();
      try {
        const req = mockReq({ route: 'rcm-backfill', headers: { 'x-pa-webhook-secret': 'top-secret-value' } });
        const res = mockRes();
        await handler(req, res);
        assert.equal(res._status, 500, `mode=${mode}`); // past auth, DIA unset
        assert.equal(lines.filter((l) => l.includes('[pa-webhook]')).length, 0, `mode=${mode}`);
      } finally {
        restore();
      }
    }
  });

  it('a handler with requireOperatorRole:false (processing-complete) never 403s a bare authenticated caller', async () => {
    process.env.PA_WEBHOOK_SECRET = 'top-secret-value';
    process.env.PA_WEBHOOK_AUTH_MODE = 'log';
    const handler = await loadHandler();
    const { restore } = captureConsoleLog();
    try {
      // No credentials at all — 'none' fallback path, still allowed through in log mode.
      const req = mockReq({ route: 'processing-complete', body: {} });
      const res = mockRes();
      await handler(req, res);
      // Reaches its own validation (missing internet_message_id), never 401/403.
      assert.equal(res._status, 400);
    } finally {
      restore();
    }
  });

  it('the DENY-WOULD log line never contains the configured secret or the caller-supplied API key', async () => {
    process.env.PA_WEBHOOK_SECRET = 'super-secret-do-not-log';
    process.env.PA_WEBHOOK_AUTH_MODE = 'log';
    const handler = await loadHandler();
    const { lines, restore } = captureConsoleLog();
    try {
      const req = mockReq({ route: 'rcm-backfill', headers: { 'x-lcc-key': 'caller-supplied-key-value' } });
      const res = mockRes();
      await handler(req, res);
      const denyLines = lines.filter((l) => l.startsWith('[pa-webhook]'));
      assert.ok(denyLines.length >= 1);
      for (const line of denyLines) {
        assert.ok(!line.includes('super-secret-do-not-log'));
        assert.ok(!line.includes('caller-supplied-key-value'));
      }
    } finally {
      restore();
    }
  });

  it('PA_WEBHOOK_KNOWN_IPS classifies the caller IP in the log line', async () => {
    process.env.PA_WEBHOOK_SECRET = 'top-secret-value';
    process.env.PA_WEBHOOK_AUTH_MODE = 'log';
    process.env.PA_WEBHOOK_KNOWN_IPS = 'railway:10.0.0.';
    const handler = await loadHandler();
    const { lines, restore } = captureConsoleLog();
    try {
      const req = mockReq({ route: 'rcm-backfill', headers: { 'x-lcc-key': 'wrong-key', 'x-forwarded-for': '10.0.0.42' } });
      const res = mockRes();
      await handler(req, res);
      const denyLine = lines.find((l) => l.startsWith('[pa-webhook] DENY-WOULD'));
      assert.ok(denyLine, 'expected a DENY-WOULD line');
      assert.match(denyLine, / railway$/);
    } finally {
      restore();
    }
  });
});
