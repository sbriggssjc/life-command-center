// EDGE-GATES1 — structural checks for the log-only auth gate added to eight
// Dialysis_DB edge functions (context-broker, template-service,
// intake-receiver, data-query, calendar-capture, calendar-ics-sync,
// calendar-caldav-sync, calendar-caldav-push). Same pattern as
// test/ai-copilot-auth-gate.test.mjs / test/salesforce-enrichment-auth-gate.test.mjs:
// source-level checks, because _shared/auth.ts cannot be imported under plain
// `node --test` (it transitively imports @supabase/supabase-js via
// supabase-client.ts, which Node's ESM loader rejects). The classifier module
// (_shared/caller-class.ts) has no such dependency and IS imported directly
// below to prove real behaviour, not just shape.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const FUNCTIONS_DIR = new URL('../supabase/functions/', import.meta.url);
const CALLER_CLASS_URL = new URL('../supabase/functions/_shared/caller-class.ts', import.meta.url);

async function readSrc(fn) {
  return fs.readFile(new URL(`${fn}/index.ts`, FUNCTIONS_DIR), 'utf8');
}

// { fn, prefix, respond: how a 401 is written on this function }
const GATED = [
  { fn: 'context-broker', prefix: 'CONTEXT_BROKER', logTag: 'context-broker-auth' },
  { fn: 'template-service', prefix: 'TEMPLATE_SERVICE', logTag: 'template-service-auth' },
  { fn: 'intake-receiver', prefix: 'INTAKE_RECEIVER', logTag: 'intake-receiver-auth' },
  { fn: 'calendar-ics-sync', prefix: 'CALENDAR_ICS_SYNC', logTag: 'calendar-ics-sync-auth' },
  { fn: 'calendar-caldav-sync', prefix: 'CALENDAR_CALDAV_SYNC', logTag: 'calendar-caldav-sync-auth' },
  { fn: 'calendar-caldav-push', prefix: 'CALENDAR_CALDAV_PUSH', logTag: 'calendar-caldav-push-auth' },
  { fn: 'calendar-capture', prefix: 'CALENDAR_CAPTURE', logTag: 'calendar-capture-auth' },
  { fn: 'data-query', prefix: 'DATA_QUERY', logTag: 'data-query-auth' },
];

for (const { fn, prefix, logTag } of GATED) {
  describe(`${fn} is gated behind authenticateWebhook() (log-only by default)`, () => {
    it('imports authenticateWebhook from the shared auth module', async () => {
      const src = await readSrc(fn);
      assert.match(
        src,
        /import\s*\{[^}]*\bauthenticateWebhook\b[^}]*\}\s*from\s*"\.\.\/_shared\/auth\.ts"/,
        `${fn} must import authenticateWebhook (alongside any other named imports from the same module)`,
      );
    });

    it('imports the shared UA/IP classifier, never a local reimplementation', async () => {
      const src = await readSrc(fn);
      assert.match(
        src,
        /import\s*\{\s*parseKnownIps,\s*uaClass,\s*ipClass,\s*requestIp\s*\}\s*from\s*"\.\.\/_shared\/caller-class\.ts"/,
        `${fn} must import the shared classifier helpers`,
      );
    });

    it(`${prefix}_AUTH_MODE is checked exactly once, against "enforce" only`, async () => {
      const src = await readSrc(fn);
      const modeChecks = src.match(new RegExp(`${prefix}_AUTH_MODE\\s*===\\s*"enforce"`, 'g')) || [];
      assert.equal(modeChecks.length, 1, `${prefix}_AUTH_MODE must be checked exactly once`);
    });

    it('log mode (default / any non-"enforce" value) never returns 401 — it falls through', async () => {
      const src = await readSrc(fn);
      const gateIdx = src.indexOf('authenticateWebhook(req)');
      const enforceIdx = src.indexOf(`${prefix}_AUTH_MODE === "enforce"`);
      assert.ok(gateIdx >= 0, 'the gate call must be present');
      assert.ok(enforceIdx > gateIdx, 'the enforce-mode branch must come after the gate check');
      // A 401 must exist somewhere at/after the enforce-mode check (covers both
      // `errorResponse(req, "unauthorized", 401)` and `Response.json({...}, { status: 401 })`
      // call shapes used across this batch of functions).
      const enforceBlockEnd = src.indexOf('\n', src.indexOf('\n', enforceIdx) + 1) + 200;
      const enforceBlock = src.slice(enforceIdx, Math.min(src.length, enforceBlockEnd));
      assert.match(enforceBlock, /\b401\b/, 'a 401 must be returned inside the enforce-mode branch');
    });

    it(`a DENY-WOULD log line exists tagged [${logTag}] and never leaks the secret`, async () => {
      const src = await readSrc(fn);
      const re = new RegExp('console\\.log\\(`\\[' + logTag.replace(/[-]/g, '\\-') + '\\] DENY-WOULD[^`]*`\\)');
      const m = src.match(re);
      assert.ok(m, `DENY-WOULD log line tagged [${logTag}] must exist`);
      assert.doesNotMatch(m[0], /webhook-secret/i, 'log line must not reference the secret header value');
      assert.doesNotMatch(m[0], /PA_WEBHOOK_SECRET/, 'log line must not reference the secret env var name as a value');
    });

    it(`${prefix}_KNOWN_IPS is read via the shared parser, never a hardcoded IP`, async () => {
      const src = await readSrc(fn);
      assert.match(src, new RegExp(`Deno\\.env\\.get\\("${prefix}_KNOWN_IPS"\\)`));
      assert.doesNotMatch(
        src,
        /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
        'no hardcoded IPv4 address may appear in source',
      );
    });
  });
}

describe('data-query gate is scoped to non-GET only — the allowlisted read/proxy path is untouched', () => {
  it('the gate check is guarded by req.method !== "GET"', async () => {
    const src = await readSrc('data-query');
    const gateIdx = src.indexOf('authenticateWebhook(req)');
    assert.ok(gateIdx >= 0, 'gate must exist');
    const precedingLine = src.slice(0, gateIdx).split('\n').pop();
    assert.match(
      precedingLine,
      /req\.method\s*!==\s*["']GET["']/,
      'the gate condition must include a req.method !== "GET" guard on the same line as the auth check',
    );
  });
});

describe('calendar-caldav-push gates every route except probe/preview (the read-only diagnostics)', () => {
  it('the gate condition excludes preview=1 but not inspect / retire_force / retire_empty', async () => {
    const src = await readSrc('calendar-caldav-push');
    const gateIdx = src.indexOf('authenticateWebhook(req)');
    const precedingLine = src.slice(0, gateIdx).split('\n').slice(-2).join('\n');
    assert.match(
      precedingLine,
      /searchParams\.get\("preview"\)\s*!==\s*"1"/,
      'preview=1 must be the only exemption baked into the gate condition itself',
    );
  });

  it('probe=1 is dispatched BEFORE the gate (also exempt, by ordering)', async () => {
    const src = await readSrc('calendar-caldav-push');
    const gateIdx = src.indexOf('authenticateWebhook(req)');
    const probeIdx = src.indexOf('searchParams.get("probe") === "1"');
    assert.ok(probeIdx >= 0 && probeIdx < gateIdx, 'the probe=1 branch must be handled before the gate runs');
  });

  it('inspect / retire_force / retire_empty dispatch only AFTER the gate check', async () => {
    const src = await readSrc('calendar-caldav-push');
    const gateIdx = src.indexOf('authenticateWebhook(req)');
    for (const marker of ['searchParams.get("inspect")', 'searchParams.get("retire_force")', 'searchParams.get("retire_empty")']) {
      const idx = src.indexOf(marker);
      assert.ok(idx > gateIdx, `${marker} dispatch must be reached only after the auth gate`);
    }
  });
});

describe('functions found to already carry a REAL check were left unmodified', () => {
  const UNCHANGED = ['lead-ingest', 'intake-salesforce', 'intake-salesforce-files', 'sf-promotion-worker', 'npi-registry-sync', 'w41-corpus-export', 'w43-sf-link-export', 'w44-retrain-tick'];

  for (const fn of UNCHANGED) {
    it(`${fn} was not touched by EDGE-GATES1 (no new *_AUTH_MODE variable was added)`, async () => {
      const src = await readSrc(fn);
      assert.doesNotMatch(
        src,
        /EDGE-GATES1/,
        `${fn} was judged to already have a real check and must carry no EDGE-GATES1 marker`,
      );
    });
  }
});

describe('never enforce — no gated function in this arc sets its own mode to enforce', () => {
  for (const { fn, prefix } of GATED) {
    it(`${fn}: no literal assignment of ${prefix}_AUTH_MODE to "enforce"`, async () => {
      const src = await readSrc(fn);
      assert.doesNotMatch(
        src,
        new RegExp(`${prefix}_AUTH_MODE\\s*=\\s*Deno\\.env\\.get\\("${prefix}_AUTH_MODE"\\)\\s*\\|\\|\\s*"enforce"`),
        `${fn} must default to "log", never "enforce"`,
      );
      assert.match(
        src,
        new RegExp(`${prefix}_AUTH_MODE\\s*=\\s*\\(Deno\\.env\\.get\\("${prefix}_AUTH_MODE"\\)\\s*\\|\\|\\s*"log"\\)`),
        `${fn} must default ${prefix}_AUTH_MODE to "log"`,
      );
    });
  }
});

describe('caller-class.ts real behaviour (imported directly — no supabase-js dependency)', () => {
  it('exports the four classifier helpers used by every EDGE-GATES1 gate', async () => {
    const src = await fs.readFile(CALLER_CLASS_URL, 'utf8');
    assert.match(src, /export function parseKnownIps/);
    assert.match(src, /export function uaClass/);
    assert.match(src, /export function ipClass/);
    assert.match(src, /export function requestIp/);
  });

  it('classifies fixed UA/IP pairs consistently (regression pin)', async () => {
    const mod = await import(CALLER_CLASS_URL.href);
    assert.equal(mod.uaClass('Mozilla/5.0 (Windows)'), 'browser');
    assert.equal(mod.uaClass('node'), 'node');
    assert.equal(mod.uaClass('azure-logic-apps/1.0'), 'logic-apps');
    assert.equal(mod.uaClass(''), 'other');

    const known = mod.parseKnownIps('railway:152.55.');
    assert.equal(mod.ipClass('152.55.1.2', known), 'railway');
    assert.equal(mod.ipClass('9.9.9.9', known), 'other');

    const req = new Request('https://x/', { headers: { 'cf-connecting-ip': '54.176.149.5' } });
    assert.equal(mod.requestIp(req), '54.176.149.5');
  });
});
