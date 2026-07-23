// Build 1 — capture deed/document bytes at ingestion (stop losing the capture).
// Unit 1: fetch + store bytes on the just-upserted property_documents row.
// Unit 2: refetch-or-retire the url-only backlog on the document-text-tick worker.
// Pure cores with injected deps (no network / Storage / DB needed).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'k';

const {
  documentObjectPath, fetchAndStoreDocBytes, captureDocumentBytesAtIngest,
} = await import('../api/_handlers/sidebar-pipeline.js');
const {
  fetchUrlBackfillDocs, processOneUrlRefetch, URL_EXPIRED_TERMINAL,
} = await import('../api/_handlers/document-text.js');

const pdf = Buffer.from('%PDF-1.7 fake deed bytes');
const creds = { url: 'https://gov.test.local', key: 'svc' };

// A minimal Response-like object for the injected fetchImpl.
function fakeRes({ ok = true, status = 200, body = pdf, contentLength = null, contentType = 'application/pdf' } = {}) {
  return {
    ok, status,
    headers: { get: (h) => (h.toLowerCase() === 'content-length' ? (contentLength == null ? null : String(contentLength)) : contentType) },
    arrayBuffer: async () => body,
  };
}

describe('Build 1 Unit 1 — documentObjectPath (deterministic, idempotent)', () => {
  it('keys on dom/doctype/property_id/document_id + ext from filename', () => {
    assert.equal(
      documentObjectPath({ domain: 'government', documentType: 'deed', propertyId: 16500, docId: 99, fileName: 'Grant Deed.pdf' }),
      'gov/deed/16500/99.pdf',
    );
    assert.equal(
      documentObjectPath({ domain: 'dia', documentType: 'Lease Agreement', propertyId: 24703, docId: 7, fileName: 'x.PDF' }),
      'dia/lease-agreement/24703/7.pdf',
    );
  });
  it('same (property,doc) → same path (x-upsert overwrite, no duplicate)', () => {
    const a = documentObjectPath({ domain: 'gov', documentType: 'deed', propertyId: 1, docId: 42, sourceUrl: 'https://cdn/d.pdf' });
    const b = documentObjectPath({ domain: 'gov', documentType: 'deed', propertyId: 1, docId: 42, sourceUrl: 'https://cdn/d.pdf' });
    assert.equal(a, b);
  });
  it('extension falls back to pdf, from url when filename lacks one', () => {
    assert.equal(
      documentObjectPath({ domain: 'gov', documentType: 'deed', propertyId: 1, docId: 5, fileName: 'label-no-ext', sourceUrl: 'https://cdn/deed.tiff?token=abc' }).endsWith('/5.tiff'),
      true,
    );
    assert.equal(
      documentObjectPath({ domain: 'gov', documentType: 'deed', propertyId: 1, docId: 5, fileName: 'label', sourceUrl: 'https://cdn/x' }).endsWith('/5.pdf'),
      true,
    );
  });
});

describe('Build 1 Unit 1 — fetchAndStoreDocBytes (bounded, best-effort)', () => {
  const base = { docId: 99, propertyId: 16500, sourceUrl: 'https://ahprd1cdn.csgpimgs.com/d2/tok/Deed.pdf', documentType: 'deed', fileName: 'Deed.pdf' };

  it('happy path → uploads to the domain property-documents bucket, returns storage descriptor', async () => {
    let uploadArgs = null;
    const r = await fetchAndStoreDocBytes('government', base, {
      getDomainCredentials: () => creds,
      fetchImpl: async () => fakeRes(),
      uploadImpl: async (a) => { uploadArgs = a; return { ok: true, storage_path: `${a.bucket}/${a.objectPath}` }; },
    });
    assert.equal(r.ok, true);
    assert.equal(r.storage_bucket, 'property-documents');
    assert.equal(r.storage_path, 'gov/deed/16500/99.pdf', 'storage_path is the object path WITHIN the bucket (no bucket prefix)');
    assert.equal(uploadArgs.bucket, 'property-documents');
    assert.equal(uploadArgs.opsUrl, creds.url);
    assert.equal(uploadArgs.opsKey, creds.key);
    assert.equal(r.bytes, pdf.length);
  });

  it('no absolute url / no doc id / unconfigured domain → guarded, no fetch', async () => {
    let fetched = false;
    const dep = { getDomainCredentials: () => creds, fetchImpl: async () => { fetched = true; return fakeRes(); }, uploadImpl: async () => ({ ok: true }) };
    assert.equal((await fetchAndStoreDocBytes('government', { ...base, sourceUrl: 'ftp://x' }, dep)).reason, 'no_absolute_url');
    assert.equal((await fetchAndStoreDocBytes('government', { ...base, docId: null }, dep)).reason, 'no_doc_id');
    assert.equal((await fetchAndStoreDocBytes('government', base, { ...dep, getDomainCredentials: () => null }).then(x => x.reason)), 'domain_db_not_configured');
    assert.equal(fetched, false);
  });

  it('dead link (non-2xx) → fetch_non_ok, no upload', async () => {
    let uploaded = false;
    const r = await fetchAndStoreDocBytes('government', base, {
      getDomainCredentials: () => creds,
      fetchImpl: async () => fakeRes({ ok: false, status: 403 }),
      uploadImpl: async () => { uploaded = true; return { ok: true }; },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'fetch_non_ok');
    assert.equal(r.status, 403);
    assert.equal(uploaded, false);
  });

  it('fetch throws (timeout/abort) → fetch_threw, never throws upward', async () => {
    const r = await fetchAndStoreDocBytes('government', base, {
      getDomainCredentials: () => creds,
      fetchImpl: async () => { throw new Error('aborted'); },
      uploadImpl: async () => ({ ok: true }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'fetch_threw');
  });

  it('over the size cap (content-length) → too_large, no upload', async () => {
    let uploaded = false;
    const r = await fetchAndStoreDocBytes('government', base, {
      getDomainCredentials: () => creds,
      fetchImpl: async () => fakeRes({ contentLength: 999_000_000 }),
      uploadImpl: async () => { uploaded = true; return { ok: true }; },
    });
    assert.equal(r.reason, 'too_large');
    assert.equal(uploaded, false);
  });

  it('empty body → empty', async () => {
    const r = await fetchAndStoreDocBytes('government', base, {
      getDomainCredentials: () => creds,
      fetchImpl: async () => fakeRes({ body: Buffer.alloc(0) }),
      uploadImpl: async () => ({ ok: true }),
    });
    assert.equal(r.reason, 'empty');
  });

  it('upload failure → upload_failed (transient, not a link problem)', async () => {
    const r = await fetchAndStoreDocBytes('government', base, {
      getDomainCredentials: () => creds,
      fetchImpl: async () => fakeRes(),
      uploadImpl: async () => ({ ok: false, status: 500, detail: 'storage down' }),
    });
    assert.equal(r.reason, 'upload_failed');
  });
});

describe('Build 1 Unit 1 — captureDocumentBytesAtIngest (attach + PATCH)', () => {
  const row = { document_id: 99, property_id: 16500, source_url: 'https://cdn/Deed.pdf', document_type: 'deed', file_name: 'Deed.pdf', storage_path: null };

  it('captures bytes → PATCHes storage_path/storage_bucket/bytes_captured', async () => {
    let patched = null;
    const r = await captureDocumentBytesAtIngest('government', row, {
      getDomainCredentials: () => creds,
      fetchImpl: async () => fakeRes(),
      uploadImpl: async (a) => ({ ok: true, storage_path: `${a.bucket}/${a.objectPath}` }),
      domainQuery: async (dom, method, path, body) => { if (method === 'PATCH') patched = { path, body }; return { ok: true }; },
    });
    assert.equal(r.ok, true);
    assert.equal(r.outcome, 'bytes_captured');
    assert.ok(patched.path.includes('document_id=eq.99'));
    assert.equal(patched.body.storage_path, 'gov/deed/16500/99.pdf');
    assert.equal(patched.body.storage_bucket, 'property-documents');
    assert.equal(patched.body.ingestion_status, 'bytes_captured');
  });

  it('idempotent — a row that already has storage_path is NOT re-downloaded', async () => {
    let fetched = false;
    const r = await captureDocumentBytesAtIngest('government', { ...row, storage_path: 'gov/deed/16500/99.pdf' }, {
      getDomainCredentials: () => creds,
      fetchImpl: async () => { fetched = true; return fakeRes(); },
      uploadImpl: async () => ({ ok: true }),
      domainQuery: async () => ({ ok: true }),
    });
    assert.equal(r.outcome, 'already_stored');
    assert.equal(fetched, false);
  });

  it('capture failure → capture_skipped, NO PATCH (url_captured row left untouched)', async () => {
    let patched = false;
    const r = await captureDocumentBytesAtIngest('government', row, {
      getDomainCredentials: () => creds,
      fetchImpl: async () => fakeRes({ ok: false, status: 404 }),
      uploadImpl: async () => ({ ok: true }),
      domainQuery: async (dom, method) => { if (method === 'PATCH') patched = true; return { ok: true }; },
    });
    assert.equal(r.ok, false);
    assert.equal(r.outcome, 'capture_skipped');
    assert.equal(r.reason, 'fetch_non_ok');
    assert.equal(patched, false, 'a failed capture must not PATCH — the row stays url_captured');
  });
});

describe('Build 1 Unit 2 — fetchUrlBackfillDocs (the url-only backlog)', () => {
  it('selects url-only, un-retired docs (storage_path null + source_url not null)', async () => {
    let seen = null;
    const q = async (dom, method, path) => { seen = path; return { ok: true, data: [{ document_id: 1 }] }; };
    const r = await fetchUrlBackfillDocs('government', { limit: 25, doctype: 'deed' }, { domainQuery: q });
    assert.equal(r.ok, true);
    assert.ok(seen.includes('raw_text=is.null'));
    assert.ok(seen.includes('storage_path=is.null'));
    assert.ok(seen.includes('source_url=not.is.null'));
    assert.ok(seen.includes(URL_EXPIRED_TERMINAL), 'excludes already-retired rows');
    assert.ok(seen.includes('document_type=ilike.*deed*'));
  });
});

describe('Build 1 Unit 2 — processOneUrlRefetch (refetch-or-retire)', () => {
  const row = { document_id: 42, property_id: 16500, source_url: 'https://cdn/Deed.pdf', document_type: 'deed', file_name: 'Deed.pdf' };

  it('live link → refetched, PATCH storage_path + bytes_captured', async () => {
    let patched = null;
    const r = await processOneUrlRefetch('government', row, {
      fetchAndStoreDocBytes: async () => ({ ok: true, storage_path: 'gov/deed/16500/42.pdf', storage_bucket: 'property-documents' }),
      domainQuery: async (dom, method, path, body) => { if (method === 'PATCH') patched = body; return { ok: true }; },
    });
    assert.equal(r.outcome, 'refetched');
    assert.equal(patched.storage_path, 'gov/deed/16500/42.pdf');
    assert.equal(patched.ingestion_status, 'bytes_captured');
  });

  it('dead link → retired_url_expired (terminal, drops out of pending)', async () => {
    let patched = null;
    const r = await processOneUrlRefetch('government', row, {
      fetchAndStoreDocBytes: async () => ({ ok: false, reason: 'fetch_non_ok', status: 403 }),
      domainQuery: async (dom, method, path, body) => { if (method === 'PATCH') patched = body; return { ok: true }; },
    });
    assert.equal(r.outcome, 'retired_url_expired');
    assert.equal(patched.ingestion_status, URL_EXPIRED_TERMINAL);
  });

  it('transient upload failure → still_pending, NOT retired', async () => {
    let patched = false;
    const r = await processOneUrlRefetch('government', row, {
      fetchAndStoreDocBytes: async () => ({ ok: false, reason: 'upload_failed', status: 500 }),
      domainQuery: async (dom, method) => { if (method === 'PATCH') patched = true; return { ok: true }; },
    });
    assert.equal(r.outcome, 'still_pending');
    assert.equal(patched, false, 'a transient upload failure must not retire the link');
  });

  it('unconfigured domain → still_pending, not retired', async () => {
    const r = await processOneUrlRefetch('government', row, {
      fetchAndStoreDocBytes: async () => ({ ok: false, reason: 'domain_db_not_configured' }),
      domainQuery: async () => ({ ok: true }),
    });
    assert.equal(r.outcome, 'still_pending');
  });
});
