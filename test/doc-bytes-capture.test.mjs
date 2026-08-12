// Capture-at-ingest durable document bytes — server-side unit tests (no live DB).
// storeClientDocBytes (extension in-session bytes → durable copy, keyed by
// domain+source_url) and backfillDocBytes (server-side re-fetch for the
// non-session-bound subset), both deps-injected.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  storeClientDocBytes, backfillDocBytes, uploadDocBuffer,
} from '../api/_handlers/sidebar-pipeline.js';

const CREDS = { url: 'https://x.supabase.co', key: 'k' };
const b64 = (s) => Buffer.from(s).toString('base64');

function makeDeps({ row, uploadOk = true, patchOk = true } = {}) {
  const calls = { get: [], patch: [], upload: [] };
  return {
    calls,
    getDomainCredentials: () => CREDS,
    uploadImpl: async (args) => { calls.upload.push(args); return uploadOk ? { ok: true } : { ok: false, status: 500 }; },
    domainQuery: async (domain, method, path, body) => {
      if (method === 'GET') { calls.get.push(path); return { ok: true, data: row ? [row] : [] }; }
      if (method === 'PATCH') { calls.patch.push({ path, body }); return { ok: patchOk, status: patchOk ? 204 : 500 }; }
      return { ok: true, data: [] };
    },
  };
}

describe('storeClientDocBytes (durable capture from extension tab bytes)', () => {
  it('stores bytes + patches storage_path on the matched url_captured row', async () => {
    const deps = makeDeps({ row: { document_id: 7, property_id: 42, document_type: 'lease', file_name: 'L.pdf', storage_path: null } });
    const r = await storeClientDocBytes('gov', { source_url: 'https://cdn/x.pdf', content_base64: b64('%PDF-1.7 hi'), mime_type: 'application/pdf' }, deps);
    assert.equal(r.ok, true);
    assert.equal(r.outcome, 'bytes_captured');
    assert.equal(r.document_id, 7);
    assert.equal(deps.calls.upload.length, 1);
    assert.equal(deps.calls.upload[0].bucket, 'property-documents');
    assert.equal(deps.calls.patch[0].body.ingestion_status, 'bytes_captured');
    assert.ok(deps.calls.patch[0].body.storage_path);
  });

  it('is idempotent — a row already carrying storage_path is a no-op (no upload)', async () => {
    const deps = makeDeps({ row: { document_id: 7, property_id: 42, storage_path: 'gov/lease/42/7.pdf' } });
    const r = await storeClientDocBytes('gov', { source_url: 'https://cdn/x.pdf', content_base64: b64('data'), mime_type: 'application/pdf' }, deps);
    assert.equal(r.outcome, 'already_stored');
    assert.equal(deps.calls.upload.length, 0);
    assert.equal(deps.calls.patch.length, 0);
  });

  it('row_not_found when no property_documents matches the source_url', async () => {
    const deps = makeDeps({ row: null });
    const r = await storeClientDocBytes('dia', { source_url: 'https://cdn/x.pdf', content_base64: b64('data') }, deps);
    assert.equal(r.ok, false);
    assert.equal(r.outcome, 'row_not_found');
  });

  it('rejects a non-absolute url and missing bytes without touching the DB', async () => {
    const deps = makeDeps({ row: { document_id: 1 } });
    assert.equal((await storeClientDocBytes('gov', { source_url: 'x', content_base64: b64('d') }, deps)).outcome, 'no_absolute_url');
    assert.equal((await storeClientDocBytes('gov', { source_url: 'https://cdn/x.pdf' }, deps)).outcome, 'no_bytes');
    assert.equal(deps.calls.get.length, 0);
  });

  it('does not patch when the upload fails (leaves the url_captured row untouched)', async () => {
    const deps = makeDeps({ row: { document_id: 9, property_id: 1, storage_path: null }, uploadOk: false });
    const r = await storeClientDocBytes('gov', { source_url: 'https://cdn/x.pdf', content_base64: b64('d') }, deps);
    assert.equal(r.ok, false);
    assert.equal(r.outcome, 'upload_failed');
    assert.equal(deps.calls.patch.length, 0);
  });
});

describe('backfillDocBytes (server re-fetch, honest about session-bound failures)', () => {
  it('counts session-bound/dead links separately from captures (never silently done)', async () => {
    const rows = [
      { document_id: 1, property_id: 1, source_url: 'https://public/ok.pdf', document_type: 'deed', file_name: 'a.pdf' },
      { document_id: 2, property_id: 2, source_url: 'https://cdn/session.pdf', document_type: 'lease', file_name: 'b.pdf' },
    ];
    const deps = {
      getDomainCredentials: () => CREDS,
      domainQuery: async (domain, method, path) => {
        if (method === 'GET') return { ok: true, data: rows };
        return { ok: true };
      },
      // fetchImpl: first url ok (bytes), second 403 (session-bound)
      fetchImpl: async (u) => u.includes('session')
        ? { ok: false, status: 403, headers: { get: () => null } }
        : { ok: true, status: 200, headers: { get: () => 'application/pdf' }, arrayBuffer: async () => Buffer.from('%PDF ok') },
      uploadImpl: async () => ({ ok: true }),
    };
    const r = await backfillDocBytes('gov', { limit: 10 }, deps);
    assert.equal(r.scanned, 2);
    assert.equal(r.bytes_captured, 1);
    assert.equal(r.session_bound_or_dead, 1);
  });
});

describe('uploadDocBuffer', () => {
  it('rejects empty + oversized buffers before uploading', async () => {
    const deps = { uploadImpl: async () => ({ ok: true }) };
    assert.equal((await uploadDocBuffer('gov', CREDS, { buffer: Buffer.alloc(0) }, deps)).reason, 'empty');
    const big = { buffer: Buffer.alloc(26_000_000), docId: 1 };
    assert.equal((await uploadDocBuffer('gov', CREDS, big, deps)).reason, 'too_large');
  });
});
