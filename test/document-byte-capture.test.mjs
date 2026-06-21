// UW#6-REV — sidebar byte-capture: storage-first read + the doctype-routed
// notify writer. Pure cores with injected deps (no network / Storage needed).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'k';

const { fetchDocBytes, extractDocumentText } = await import('../api/_shared/document-text.js');
const { performDocumentNotify, normalizeNotifyDoctype, isNonDocumentTypeName } = await import('../api/_handlers/intake-document-notify.js');
const { handleIntakePrepareUpload } = await import('../api/_handlers/intake-prepare-upload.js');

const pdfBuf = Buffer.from('%PDF-1.7 fake');

describe('UW#6-REV — storage-first byte fetch', () => {
  it('reads from Storage FIRST and never touches the (dead-token) URL', async () => {
    let urlFetched = false;
    const r = await fetchDocBytes({
      sourceUrl: 'https://ahprd1cdn.csgpimgs.com/d2/deadtoken/Deed.pdf',
      storagePath: 'gov/deed/16500/abc.pdf',
      storageGet: async () => ({ ok: true, buffer: pdfBuf, contentType: 'application/pdf' }),
      fetchImpl: async () => { urlFetched = true; return { ok: true, arrayBuffer: async () => pdfBuf, headers: { get: () => 'application/pdf' } }; },
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'storage');
    assert.equal(urlFetched, false, 'URL must not be fetched when Storage has the bytes');
  });

  it('Storage miss → falls back to the URL (live-token window)', async () => {
    const r = await fetchDocBytes({
      sourceUrl: 'https://cdn/Deed.pdf',
      storagePath: 'gov/deed/1/x.pdf',
      storageGet: async () => ({ ok: false, status: 404 }),
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => pdfBuf, headers: { get: () => 'application/pdf' } }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'url');
  });

  it('extractDocumentText threads storagePath → parses storage bytes (via=storage)', async () => {
    const r = await extractDocumentText(
      { storagePath: 'dia/lease/26955/h.pdf' },
      {
        storageGet: async () => ({ ok: true, buffer: pdfBuf, contentType: 'application/pdf' }),
        pdfTextFromBuffer: async () => ('LEASE AGREEMENT between landlord and tenant for the demised premises, with base rent, escalations, and renewal options as set forth herein. '.repeat(3)),
      }
    );
    assert.equal(r.ok, true);
    assert.equal(r.method, 'pdf_text');
    assert.equal(r.via, 'storage');
  });
});

describe('UW#6-REV — doctype re-validation', () => {
  it('unknown / "?" doctype is filed as other (never mis-routed)', () => {
    assert.equal(normalizeNotifyDoctype('deed'), 'deed');
    assert.equal(normalizeNotifyDoctype('LEASE'), 'lease');
    assert.equal(normalizeNotifyDoctype('?'), 'other');
    assert.equal(normalizeNotifyDoctype('8-K/A'), 'other');
    assert.equal(normalizeNotifyDoctype(null), 'other');
  });

  // UW#6 — reject SEC/IR/press artifacts even when the sidebar sent a KNOWN type.
  it('isNonDocumentTypeName catches press release / 8-K / investor presentation', () => {
    assert.equal(isNonDocumentTypeName('Press Release - Broker.pdf'), true);
    assert.equal(isNonDocumentTypeName('Q3 2024 8-K.pdf'), true);
    assert.equal(isNonDocumentTypeName('Investor Presentation Feb 2024.pdf'), true);
    assert.equal(isNonDocumentTypeName('Prospectus.pdf'), true);
    assert.equal(isNonDocumentTypeName('Grant Deed - 816 Featherstone.pdf'), false);
    assert.equal(isNonDocumentTypeName('Lease Agreement DaVita.pdf'), false);
  });

  it('filename downgrades a mis-typed non-doc to other (press release sent as lease)', () => {
    // The substring "reLEASE" used to type this as `lease`; the filename guard forces `other`.
    assert.equal(normalizeNotifyDoctype('lease', 'Press Release - Broker.pdf'), 'other');
    assert.equal(normalizeNotifyDoctype('deed', 'Grant Deed - 816 Featherstone.pdf'), 'deed');
  });
});

describe('UW#6-REV — document-notify writer', () => {
  const base = { domain: 'gov', property_id: 16500, doctype: 'deed', file_name: 'Deed - 816 Featherstone Rd.pdf', source_url: 'https://cdn/x.pdf', content_hash: 'sha256:abc', storage_path: 'gov/deed/16500/abc.pdf', storage_bucket: 'property-documents' };

  it('no existing row → creates the pointer row', async () => {
    const calls = [];
    const q = async (domain, method, path, body) => {
      calls.push({ method, path });
      if (method === 'GET') return { ok: true, data: [] };            // no existing
      return { ok: true, data: [{ document_id: 99 }] };               // insert
    };
    const r = await performDocumentNotify(base, { domainQuery: q });
    assert.equal(r.ok, true);
    assert.equal(r.outcome, 'created');
    assert.equal(r.document_id, 99);
    assert.equal(r.doctype, 'deed');
    assert.ok(calls.some(c => c.method === 'POST' && c.path.includes('on_conflict=property_id,content_hash')));
  });

  it('existing url_captured row (same file) → ATTACHES bytes, no duplicate', async () => {
    let posted = false;
    const q = async (domain, method, path) => {
      if (method === 'POST') posted = true;
      if (method === 'GET' && path.includes('content_hash=eq')) return { ok: true, data: [] };         // not by hash
      if (method === 'GET' && path.includes('file_name=eq')) return { ok: true, data: [{ document_id: 42, storage_path: null }] };
      if (method === 'PATCH') return { ok: true, data: [{ document_id: 42 }] };
      return { ok: true, data: [] };
    };
    const r = await performDocumentNotify(base, { domainQuery: q });
    assert.equal(r.outcome, 'attached');
    assert.equal(r.document_id, 42);
    assert.equal(posted, false, 'must PATCH the existing row, not insert a duplicate');
  });

  it('same content_hash already stored → idempotent no-op', async () => {
    const q = async (domain, method, path) => {
      if (method === 'GET' && path.includes('content_hash=eq')) return { ok: true, data: [{ document_id: 7, storage_path: 'gov/deed/16500/abc.pdf', ingestion_status: 'text_extracted' }] };
      return { ok: true, data: [] };
    };
    const r = await performDocumentNotify(base, { domainQuery: q });
    assert.equal(r.outcome, 'idempotent');
    assert.equal(r.document_id, 7);
    assert.equal(r.status_repaired, false, 'a downstream status (text_extracted) must NOT be clobbered');
  });

  // UW#6 — the 6-of-7 mislabel: storage_path set but status stuck url_captured.
  it('idempotent row stuck at url_captured → REPAIRS status to bytes_captured', async () => {
    let patched = null;
    const q = async (domain, method, path, body) => {
      if (method === 'GET' && path.includes('content_hash=eq')) return { ok: true, data: [{ document_id: 8, storage_path: 'gov/deed/16500/abc.pdf', ingestion_status: 'url_captured' }] };
      if (method === 'PATCH') { patched = body; return { ok: true }; }
      return { ok: true, data: [] };
    };
    const r = await performDocumentNotify(base, { domainQuery: q });
    assert.equal(r.outcome, 'idempotent');
    assert.equal(r.status_repaired, true);
    assert.equal(patched.ingestion_status, 'bytes_captured');
  });

  it('rejects bad domain / missing property_id / missing storage_path / missing hash', async () => {
    const q = async () => ({ ok: true, data: [] });
    assert.equal((await performDocumentNotify({ ...base, domain: 'xx' }, { domainQuery: q })).error, 'bad_domain');
    assert.equal((await performDocumentNotify({ ...base, property_id: null }, { domainQuery: q })).error, 'missing_property_id');
    assert.equal((await performDocumentNotify({ ...base, storage_path: '' }, { domainQuery: q })).error, 'missing_storage_path');
    assert.equal((await performDocumentNotify({ ...base, content_hash: '' }, { domainQuery: q })).error, 'missing_content_hash');
  });
});

describe('UW#6-REV — prepare-upload domain validation', () => {
  it('property_document target with unconfigured domain → bad_domain (no signed URL minted)', async () => {
    const r = await handleIntakePrepareUpload({
      inputs: { target: 'property_document', domain: 'zz', doctype: 'deed', property_id: 1, file_name: 'Deed.pdf', content_hash: 'h' },
      authContext: { email: 'scott@test' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'bad_domain');
  });

  it('still requires file_name + caller identity (OM path unchanged)', async () => {
    assert.equal((await handleIntakePrepareUpload({ inputs: {}, authContext: { email: 'x' } })).body.error, 'missing_file_name');
    assert.equal((await handleIntakePrepareUpload({ inputs: { file_name: 'a.pdf' }, authContext: {} })).body.error, 'missing_caller_identity');
  });
});
