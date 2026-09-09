// RAILWAY-PA-SECRET-log — pins the log-only webhook auth mode on Railway's
// PA_WEBHOOK_SECRET door (api/sync.js). See
// docs/claude-code/prompts/RAILWAY-PA-SECRET-log.md and
// docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md §4a.
//
// Structural: every webhook handler dispatches its auth through `webhookAuth`,
// never `authenticateWebhook(req)` directly — a positive control proves the
// detector actually catches a direct call.
// Behavioural: `log` mode never returns a 401 from the helper; `enforce` mode
// lets the fallback's own status stand; the secret path short-circuits before
// ever touching `authenticate()`; the DENY-WOULD log line never carries the
// secret or an API key value.
//
// `PA_WEBHOOK_SECRET` (like the rest of sync.js's env-derived config) is read
// into a module-level `const` at import time, matching how it actually runs
// on Railway (env is fixed for the process's life). Each scenario below that
// needs a different PA_WEBHOOK_SECRET/LCC_ENV therefore re-imports the module
// under a cache-busting specifier so the top-level reads re-run against the
// env set just before — no source change, no network (pure env + in-memory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SYNC_PATH = `${repoRoot}api/sync.js`;
const SYNC_URL = new URL('../api/sync.js', import.meta.url).href;

let seq = 0;
async function freshImport() {
  seq += 1;
  return import(`${SYNC_URL}?probe=${seq}`);
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Matches a CALL to authenticateWebhook(req), never the `function
// authenticateWebhook(req) {` declaration line.
const AUTH_WEBHOOK_CALL = /(?<!function )authenticateWebhook\(req\)/g;

test('every authenticateWebhook(req) call site is inside webhookAuth, not a handler', () => {
  const src = stripComments(readFileSync(SYNC_PATH, 'utf8'));
  const matches = [...src.matchAll(AUTH_WEBHOOK_CALL)];
  // Exactly one live call: the short-circuit inside webhookAuth itself.
  assert.equal(matches.length, 1,
    `expected exactly one authenticateWebhook(req) call (inside webhookAuth); found ${matches.length}`);
});

test('positive control — a synthetic direct call is caught by the same detector', () => {
  const synthetic = `
    async function handleSomethingElse(req, res) {
      if (!authenticateWebhook(req)) {
        const user = await authenticate(req, res);
        if (!user) return;
      }
    }
  `;
  const matches = [...stripComments(synthetic).matchAll(AUTH_WEBHOOK_CALL)];
  assert.ok(matches.length > 0, 'the detector must be able to see a direct call at all');
});

test('all seven webhook handlers route through webhookAuth(req, res, <route>, ...)', () => {
  const src = readFileSync(SYNC_PATH, 'utf8');
  const routes = [
    'rcm-ingest',
    'rcm-backfill',
    'loopnet-ingest',
    'processing-complete',
    'todo-completion-poll',
    'listing-webhook',
    'cross-domain-match',
  ];
  for (const route of routes) {
    assert.match(src, new RegExp(`webhookAuth\\(req,\\s*res,\\s*'${route}'`),
      `handler for '${route}' does not call webhookAuth`);
  }
});

function makeReq(headers = {}) {
  return { headers, socket: {} };
}

function makeRes() {
  const calls = { status: [], json: [] };
  const res = {
    status(code) { calls.status.push(code); return res; },
    json(body) { calls.json.push(body); return res; },
    setHeader() {},
  };
  res._calls = calls;
  return res;
}

async function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('PA_WEBHOOK_SECRET unset — behaves exactly like the transitional authenticateWebhook (allow, no log)', async () => {
  await withEnv({ PA_WEBHOOK_SECRET: undefined, PA_WEBHOOK_AUTH_MODE: 'log', LCC_ENV: undefined }, async () => {
    const mod = await freshImport();
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      const result = await mod.webhookAuth(makeReq({}), makeRes(), 'unit-test-route');
      assert.equal(result.ok, true);
      assert.equal(warns.length, 0, 'no PA_WEBHOOK_SECRET configured — nothing to log');
    } finally {
      console.warn = orig;
    }
  });
});

test('secret header matches — short-circuits before authenticate(), no log line, never touches res', async () => {
  await withEnv({ PA_WEBHOOK_SECRET: 'unit-test-secret-value', PA_WEBHOOK_AUTH_MODE: 'log', LCC_ENV: 'production' }, async () => {
    const mod = await freshImport();
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      const req = makeReq({ 'x-pa-webhook-secret': 'unit-test-secret-value' });
      const res = makeRes();
      const result = await mod.webhookAuth(req, res, 'unit-test-route');
      assert.equal(result.ok, true);
      assert.equal(result.user, null);
      assert.equal(warns.length, 0);
      assert.equal(res._calls.status.length, 0, 'must never touch res on the secret path');
    } finally {
      console.warn = orig;
    }
  });
});

test('log mode: secret set, no credential at all — still allows (never 401 from the helper)', async () => {
  await withEnv({ PA_WEBHOOK_SECRET: 'unit-test-secret-value', PA_WEBHOOK_AUTH_MODE: 'log', LCC_ENV: 'production' }, async () => {
    const mod = await freshImport();
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      const req = makeReq({}); // no x-pa-webhook-secret, no x-lcc-key, no authorization
      const res = makeRes();
      const result = await mod.webhookAuth(req, res, 'unit-test-route');
      assert.equal(result.ok, true, "log mode must allow, matching today's behaviour when unset");
      assert.equal(res._calls.status.includes(401), false);
      assert.equal(warns.length, 1, 'exactly one DENY-WOULD line for this caller shape');
      assert.match(warns[0], /^\[pa-webhook\] DENY-WOULD unit-test-route none /);
    } finally {
      console.warn = orig;
    }
  });
});

test("enforce mode: secret set, no credential — the fallback's own 401 stands", () => {
  // Every env-derived const in this module graph (sync.js AND api/_shared/auth.js's
  // own LCC_ENV) is read at import time. A same-process re-import via a
  // cache-busting specifier only refreshes sync.js's own top-level consts —
  // Node resolves sync.js's relative `./_shared/auth.js` import back to the
  // SAME cached module (the query string lives on the importer's URL, not the
  // resolved relative specifier), so auth.js's LCC_ENV stays frozen at
  // whichever value was in effect on this process's FIRST import of it. A
  // fresh child process is the only way to prove the enforce-mode 401 against
  // a real production LCC_ENV, matching how Railway actually runs (env fixed
  // for the process's life).
  const script = `
    const mod = await import(${JSON.stringify(SYNC_URL)});
    const req = { headers: {}, socket: {} };
    let status = null, body = null;
    const res = {
      status(c) { status = c; return res; },
      json(b) { body = b; return res; },
      setHeader() {},
    };
    const result = await mod.webhookAuth(req, res, 'unit-test-route');
    console.log(JSON.stringify({ ok: result.ok, status }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      PA_WEBHOOK_SECRET: 'unit-test-secret-value',
      PA_WEBHOOK_AUTH_MODE: 'enforce',
      LCC_ENV: 'production',
    },
    encoding: 'utf8',
  });
  const lastLine = out.trim().split('\n').pop();
  const parsed = JSON.parse(lastLine);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 401);
});

test('the DENY-WOULD log line never carries the secret value or an api-key value', async () => {
  await withEnv({ PA_WEBHOOK_SECRET: 'super-secret-do-not-log', PA_WEBHOOK_AUTH_MODE: 'log', LCC_ENV: 'production' }, async () => {
    const mod = await freshImport();
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      const req = makeReq({ 'x-pa-webhook-secret': 'wrong-value-entirely' });
      await mod.webhookAuth(req, makeRes(), 'unit-test-route');
      for (const line of warns) {
        assert.doesNotMatch(line, /super-secret-do-not-log/);
        assert.doesNotMatch(line, /wrong-value-entirely/);
      }
    } finally {
      console.warn = orig;
    }
  });
});

test('a caller carrying x-lcc-key is classified api-key and never logged, in either mode', async () => {
  await withEnv({ PA_WEBHOOK_SECRET: 'unit-test-secret-value', PA_WEBHOOK_AUTH_MODE: 'log', LCC_ENV: 'production' }, async () => {
    const mod = await freshImport();
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      const req = makeReq({ 'x-lcc-key': 'whatever-the-configured-key-is' });
      await mod.webhookAuth(req, makeRes(), 'unit-test-route');
      assert.equal(warns.length, 0, 'an api-key-bearing caller is never the DENY-WOULD population');
    } finally {
      console.warn = orig;
    }
  });
});

test('classifyCallerUa distinguishes pa/node/other/none', async () => {
  const mod = await freshImport();
  assert.equal(mod.classifyCallerUa(makeReq({})), 'none');
  assert.equal(mod.classifyCallerUa(makeReq({ 'user-agent': 'node' })), 'node');
  assert.equal(mod.classifyCallerUa(makeReq({ 'user-agent': 'PowerAutomate/1.0' })), 'pa');
  assert.equal(mod.classifyCallerUa(makeReq({ 'user-agent': 'curl/8.0' })), 'other');
});

test('classifyCallerIp matches a configured known-ip prefix, else unclassified', async () => {
  await withEnv({ PA_WEBHOOK_KNOWN_IPS: 'railway:152.55.,railway:162.220.232.' }, async () => {
    const mod = await freshImport();
    assert.equal(mod.classifyCallerIp(makeReq({ 'x-forwarded-for': '152.55.1.2' })), 'railway');
    assert.equal(mod.classifyCallerIp(makeReq({ 'x-forwarded-for': '9.9.9.9' })), 'unclassified');
    assert.equal(mod.classifyCallerIp(makeReq({})), 'unknown');
  });
});
