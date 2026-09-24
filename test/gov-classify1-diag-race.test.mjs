// ============================================================================
// GOV-CLASSIFY1-diag-race (2026-09-24) — concurrent sidebar runs overwrote each
// other's classifier diagnostics.
//
// Measured in POSTSHIP-R73: six force re-runs overlapped Scott's save of
// 910 4th Ave, Asbury Park (82f261fe…). Saginaw 6c85fe57… ended up storing a
// _classifier_diag whose existingRecord + fieldSources belonged to the Asbury
// Park run (gov 16239). Cause: `_lastClassifierDiag` was a MODULE-LEVEL global.
// serializeSidebarRun serializes runs per ENTITY only, so runs over different
// entities interleave at every await, and a run read whichever diag was written
// last. The domain decision used locals and was unaffected — but the diag also
// drives shouldAlertPipelineFailure (thin no_domain suppression) and the
// top-level domain_mismatch_warning, so one run could suppress or raise
// another run's alert.
//
// This test drives the REAL processSidebarExtraction twice, interleaved with an
// injected delay: run A (a thin capture) is parked on its first await after
// classification while run B (a substantive capture) classifies and finishes.
// With the global reintroduced, A stores B's diag and raises B's alert — both
// assertions below go RED (mutation-verified).
// ============================================================================

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processSidebarExtraction, upsertDomainProperty } from '../api/_handlers/sidebar-pipeline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok, status,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

// A: thin, out-of-scope capture — lands no_domain, alert SUPPRESSED.
const ENTITY_A = {
  id: 'ent-A', workspace_id: 'ws', entity_type: 'asset',
  name: 'Saginaw Retail', address: '100 Genesee Ave', city: 'Saginaw', state: 'MI',
  metadata: { source: 'costar' },
};
// B: substantive capture with sale notes but no dia/gov tenant — lands
// no_domain, alert RAISED (a potential classifier gap).
const ENTITY_B = {
  id: 'ent-B', workspace_id: 'ws', entity_type: 'asset',
  name: 'Asbury Park Office', address: '910 4th Ave', city: 'Asbury Park', state: 'NJ',
  metadata: {
    source: 'costar',
    sale_notes_raw: 'Asbury Park multi-tenant office building sold to a private investor in an off-market transaction with seller financing and a long escrow.',
  },
};

function stubOps({ holdA }) {
  process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
  process.env.OPS_SUPABASE_KEY = 'test-key';
  const log = { patches: {}, alertPosts: [] };
  const aClassified = deferred();
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const m = opts.method || 'GET';
    if (m === 'GET' && u.includes('/entities?id=eq.ent-A')) return jsonResponse([ENTITY_A]);
    if (m === 'GET' && u.includes('/entities?id=eq.ent-B')) return jsonResponse([ENTITY_B]);
    if (m === 'POST' && u.endsWith('/signals')) {
      const body = JSON.parse(opts.body || '{}');
      // Run A's first await AFTER classification: park it until B is done.
      if (body.entity_id === 'ent-A') { aClassified.resolve(); await holdA.promise; }
      return jsonResponse([]);
    }
    if (m === 'PATCH' && u.includes('/entities?id=eq.')) {
      const id = u.match(/id=eq\.([^&]+)/)[1];
      const body = JSON.parse(opts.body || '{}');
      if (body.metadata?._pipeline_summary) log.patches[id] = body.metadata;
      return jsonResponse([]);
    }
    if (m === 'POST' && u.endsWith('/lcc_health_alerts')) {
      log.alertPosts.push(JSON.parse(opts.body || '{}').source);
      return jsonResponse([]);
    }
    return jsonResponse([]);
  };
  return { log, aClassified };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('GOV-CLASSIFY1-diag-race — each interleaved run keeps its own classifier diag', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('a run parked mid-pipeline does not pick up the diag of a run that classified after it', async () => {
    const holdA = deferred();
    const { log, aClassified } = stubOps({ holdA });

    const runA = processSidebarExtraction('ent-A', 'ws', 'u', { force: true });
    await aClassified.promise;                 // A has classified, now parked
    const outB = await processSidebarExtraction('ent-B', 'ws', 'u', { force: true });
    holdA.resolve();
    const outA = await runA;
    await flush();                              // alert writes are fire-and-forget

    // B, which never overlapped a later classification, is its own.
    assert.match(outB._classifier_diag.searchTextFirst200, /asbury park/);
    assert.equal(outB.thin_no_domain_suppressed, false);

    // A's returned + STORED diag describe A, not B.
    assert.match(outA._classifier_diag.searchTextFirst200, /saginaw/,
      'run A must return its own classifier diag, not the concurrent run B\'s');
    const storedA = log.patches['ent-A']._pipeline_summary._classifier_diag;
    assert.match(storedA.searchTextFirst200, /saginaw/, 'stored _classifier_diag must be run A\'s');
    assert.ok(!storedA.fieldSources.some((f) => /asbury/i.test(f)), 'no fieldSources from run B');

    // Alert decisions are per run: A (thin) suppressed, B (substantive) raised.
    assert.equal(outA.thin_no_domain_suppressed, true, 'A\'s alert decision must use A\'s diag');
    assert.ok(!log.alertPosts.includes('sidebar_promote:ent-A'), 'A must not raise B\'s alert');
    assert.ok(log.alertPosts.includes('sidebar_promote:ent-B'));
  });

  it('the reverse interleave: a substantive run parked behind a thin one keeps its alert', async () => {
    // Swap roles: A (thin) finishes while B (substantive) is parked.
    const holdB = deferred();
    process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
    process.env.OPS_SUPABASE_KEY = 'test-key';
    const bClassified = deferred();
    const patches = {}; const alertPosts = [];
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = opts.method || 'GET';
      if (m === 'GET' && u.includes('/entities?id=eq.ent-A')) return jsonResponse([ENTITY_A]);
      if (m === 'GET' && u.includes('/entities?id=eq.ent-B')) return jsonResponse([ENTITY_B]);
      if (m === 'POST' && u.endsWith('/signals')) {
        if (JSON.parse(opts.body || '{}').entity_id === 'ent-B') { bClassified.resolve(); await holdB.promise; }
        return jsonResponse([]);
      }
      if (m === 'PATCH' && u.includes('/entities?id=eq.')) {
        const body = JSON.parse(opts.body || '{}');
        if (body.metadata?._pipeline_summary) patches[u.match(/id=eq\.([^&]+)/)[1]] = body.metadata;
        return jsonResponse([]);
      }
      if (m === 'POST' && u.endsWith('/lcc_health_alerts')) { alertPosts.push(JSON.parse(opts.body).source); return jsonResponse([]); }
      return jsonResponse([]);
    };
    const runB = processSidebarExtraction('ent-B', 'ws', 'u', { force: true });
    await bClassified.promise;
    await processSidebarExtraction('ent-A', 'ws', 'u', { force: true });
    holdB.resolve();
    const outB = await runB;
    await flush();
    assert.match(patches['ent-B']._pipeline_summary._classifier_diag.searchTextFirst200, /asbury park/);
    assert.equal(outB.thin_no_domain_suppressed, false, 'B must not inherit A\'s thin suppression');
    assert.ok(alertPosts.includes('sidebar_promote:ent-B'), 'B\'s alert must still be raised');
    assert.ok(!alertPosts.includes('sidebar_promote:ent-A'));
  });
});

describe('GOV-CLASSIFY1-diag-race — upsertDomainProperty reports into a per-call sink', () => {
  it('a refusal reason lands on the caller\'s sink object, not module state', async () => {
    const sinkA = {}; const sinkB = {};
    const [a, b] = await Promise.all([
      upsertDomainProperty('government', { address: '6120 South Yale Avenue, Suite 300', city: 'Tulsa', state: 'OK' }, {}, sinkA),
      upsertDomainProperty('government', { address: '2 Lease Summary 110 Enterprise Dr', city: 'X', state: 'TX' }, {}, sinkB),
    ]);
    assert.equal(a, null); assert.equal(b, null);
    assert.match(String(sinkA.error), /own_firm_address_rejected/);
    assert.match(String(sinkB.error), /junk_address_rejected/);
  });
});

describe('GOV-CLASSIFY1-diag-race — no per-run module state in sidebar-pipeline.js', () => {
  it('declares no module-level _last* variable', () => {
    const src = readFileSync(join(ROOT, 'api/_handlers/sidebar-pipeline.js'), 'utf8');
    const offenders = src.split('\n').filter((l) => /^(let|var)\s+_last[A-Z]/.test(l));
    assert.deepEqual(offenders, [], 'per-run data must be returned/threaded, never held in module state');
  });
});
