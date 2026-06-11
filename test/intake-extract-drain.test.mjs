// Phase 2 Slice 2d (Unit 3) — async OM staging + bounded extraction drain.
//
//   • stageOmIntake({ defer_extraction:true }) returns FAST as 'received' and
//     does NOT run inline extraction (no staged_intake_extractions read/write) —
//     the row stays status='queued' for the drain.
//   • handleIntakeExtractDrain (POST) picks up a queued intake and runs
//     processIntakeExtraction on it (bounded batch). GET is a no-write dry-run.
//
// Env set BEFORE import (db helpers capture *_SUPABASE_URL at load).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.DIA_SUPABASE_URL = 'https://dia.test.local';
process.env.DIA_SUPABASE_KEY = 'dia-key';
process.env.GOV_SUPABASE_URL = 'https://gov.test.local';
process.env.GOV_SUPABASE_KEY = 'gov-key';
process.env.LCC_API_KEY = '';
delete process.env.LCC_ENV; // auth permissive in tests

const { stageOmIntake } = await import('../api/_shared/intake-om-pipeline.js');
const { handleIntakeExtractDrain } = await import('../api/_handlers/intake-extract-drain.js');

const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok, status,
    headers: { get(n) { return headers[n.toLowerCase()] || headers[n] || null; } },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

let calls;
function installFetchMock({ queuedRows = [] } = {}) {
  calls = [];
  let id = 0;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch { /* ignore */ }
    calls.push({ method, url: u, body });

    // Drain queue lookup.
    if (u.includes('/rest/v1/staged_intake_items') && method === 'GET' && u.includes('status=eq.queued')) {
      return jsonResponse(queuedRows);
    }
    // processIntakeExtraction's own reads (item, cached extraction, artifacts).
    if (u.includes('/rest/v1/staged_intake_items') && method === 'GET') {
      return jsonResponse([{ intake_id: 'qd-1', workspace_id: null, raw_payload: {} }]);
    }
    if (u.includes('/rest/v1/staged_intake_extractions') && method === 'GET') {
      return jsonResponse([]); // no cached extraction
    }
    if (u.includes('/rest/v1/staged_intake_artifacts') && method === 'GET') {
      return jsonResponse([]); // no extractable artifacts → extractor returns failed fast
    }
    // user/membership/connector/inbox/staged inserts.
    if (method === 'POST') return jsonResponse([{ id: `row-${++id}` }], true, 201);
    if (method === 'PATCH') return jsonResponse([], true, 200);
    return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
  };
}

function mockRes() {
  return {
    _status: null, _json: null, headersSent: false,
    setHeader() {},
    status(c) { this._status = c; return this; },
    json(d) { this._json = d; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
  };
}

describe('async OM staging (Slice 2d Unit 3)', () => {
  beforeEach(() => installFetchMock());
  afterEach(() => { global.fetch = originalFetch; });

  it('defer_extraction stages FAST as received and runs no inline extraction', async () => {
    const result = await stageOmIntake(
      {
        storage_backend: 'sharepoint_pa',
        storage_ref: '/sites/x/PROPERTIES/D/DaVita/Tulsa, OK/om.pdf',
        size_bytes: 1234,
        file_name: 'DaVita Tulsa OM.pdf',
        mime_type: 'application/pdf',
        channel: 'folder_feed',
        defer_extraction: true,
        seed_data: { tags: ['folder_feed'], mode: 'enrich' },
      },
      { email: 'scott@example.com', name: 'Scott' },
      'a0000000-0000-0000-0000-000000000001',
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.status, 'received');
    assert.equal(result.body.extraction_status, 'processing');
    // The staged row was inserted with status='queued' for the drain…
    const staged = calls.find(c => c.url.includes('/staged_intake_items') && c.method === 'POST');
    assert.ok(staged, 'staged_intake_items inserted');
    assert.equal(staged.body.status, 'queued');
    // …and NO inline extraction ran (processIntakeExtraction never reached its
    // staged_intake_extractions / artifacts reads).
    assert.ok(!calls.some(c => c.url.includes('/staged_intake_extractions')),
      'no extraction read — extraction was deferred');
  });
});

describe('intake-extract-drain worker (Slice 2d Unit 3)', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('GET dry-run reports the queued batch without extracting', async () => {
    installFetchMock({ queuedRows: [{ intake_id: 'qd-1', created_at: '2026-06-01T00:00:00Z', workspace_id: null }] });
    const res = mockRes();
    await handleIntakeExtractDrain(
      { method: 'GET', url: '/api/intake-extract-drain', headers: {}, query: {} },
      res,
    );
    assert.equal(res._status, 200);
    assert.equal(res._json.mode, 'dry_run');
    assert.equal(res._json.queued_in_batch, 1);
    assert.equal(res._json.extracted, 0);
    // dry-run never reads extractions.
    assert.ok(!calls.some(c => c.url.includes('/staged_intake_extractions')));
  });

  it('POST drains a queued intake through processIntakeExtraction', async () => {
    installFetchMock({ queuedRows: [{ intake_id: 'qd-1', created_at: '2026-06-01T00:00:00Z', workspace_id: null }] });
    const res = mockRes();
    await handleIntakeExtractDrain(
      { method: 'POST', url: '/api/intake-extract-drain', headers: {}, query: { limit: '3' } },
      res,
    );
    assert.equal(res._status, 200);
    assert.equal(res._json.mode, 'drain');
    assert.equal(res._json.queued_in_batch, 1);
    assert.equal(res._json.extracted, 1);
    // The drain actually invoked the extractor (it read the artifacts table).
    assert.ok(calls.some(c => c.url.includes('/staged_intake_artifacts')),
      'extractor ran for the queued intake');
  });
});
