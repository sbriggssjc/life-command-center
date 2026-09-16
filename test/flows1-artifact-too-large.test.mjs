// FLOWS1-artifact — the Get Artifact flow now answers with metadata-only for a
// file over its chunking cap ({name,size,link,path}, no `ok`/`content_base64`)
// or, once the F1c addendum lands, an explicit {ok:false,reason:'too_large'}.
// LCC must recognize BOTH as a named terminal reason, never the generic
// `pa_fetch_failed` a retry storm would keep hammering every 30 minutes.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = process.env.OPS_SUPABASE_URL || 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = process.env.OPS_SUPABASE_KEY || 'service-key';

import { fetchSharepointBytes } from '../api/_shared/storage-adapter.js';
import { fetchDocBytes, extractDocumentText } from '../api/_shared/document-text.js';
import {
  CRE_CEILING_REASONS,
  CRE_CEILING_RETRY_AFTER_HOURS,
  runPropertyDocText,
} from '../api/_shared/cre-property-doc-text.js';
import { fetchAndStoreDocBytes } from '../api/_handlers/sidebar-pipeline.js';
import { processOneUrlRefetch, ARTIFACT_TOO_LARGE_TERMINAL, URL_EXPIRED_TERMINAL } from '../api/_handlers/document-text.js';

const ORIGINAL_FETCH_URL = process.env.SHAREPOINT_FETCH_URL;

function withFetchUrl(fn) {
  return async () => {
    process.env.SHAREPOINT_FETCH_URL = 'https://example.test/pa-getfile';
    try { await fn(); }
    finally {
      if (ORIGINAL_FETCH_URL === undefined) delete process.env.SHAREPOINT_FETCH_URL;
      else process.env.SHAREPOINT_FETCH_URL = ORIGINAL_FETCH_URL;
    }
  };
}

describe('fetchSharepointBytes — dual response shapes', () => {
  it('accepts the pre-F1c metadata-only shape as a named too_large terminal', withFetchUrl(async () => {
    const r = await fetchSharepointBytes({
      storageRef: '/sites/TeamBriggs20/Shared Documents/big.pdf',
      fetchImpl: async () => new Response(
        JSON.stringify({ name: 'big.pdf', size: 87654321, link: 'https://sp.test/big.pdf', path: '/sites/x/big.pdf' }),
        { status: 200 },
      ),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too_large');
    assert.equal(r.size, 87654321);
    assert.equal(r.name, 'big.pdf');
  }));

  it('accepts the F1c explicit ok:false/reason:too_large shape', withFetchUrl(async () => {
    const r = await fetchSharepointBytes({
      storageRef: '/sites/TeamBriggs20/Shared Documents/big.pdf',
      fetchImpl: async () => new Response(
        JSON.stringify({ ok: false, reason: 'too_large', size: 99999999, name: 'big.pdf' }),
        { status: 200 },
      ),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too_large');
    assert.equal(r.size, 99999999);
  }));

  it('still accepts the byte shape (small file) unchanged', withFetchUrl(async () => {
    const r = await fetchSharepointBytes({
      storageRef: '/sites/TeamBriggs20/Shared Documents/small.pdf',
      fetchImpl: async () => new Response(
        JSON.stringify({ ok: true, content_base64: Buffer.from('hi').toString('base64'), content_type: 'application/pdf' }),
        { status: 200 },
      ),
    });
    assert.equal(r.ok, true);
    assert.equal(r.buffer.toString(), 'hi');
    assert.equal(r.reason, undefined);
  }));

  it('a genuine failure (non-2xx, no recognizable shape) stays a generic pa_fetch_failed', withFetchUrl(async () => {
    const r = await fetchSharepointBytes({
      storageRef: '/sites/x/dead.pdf',
      fetchImpl: async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 }),
    });
    assert.equal(r.ok, false);
    assert.notEqual(r.reason, 'too_large');
  }));
});

describe('fetchDocBytes / extractDocumentText — propagate the too_large reason', () => {
  it('fetchDocBytes carries the SharePoint fetch reason + size through unmangled', withFetchUrl(async () => {
    const r = await fetchDocBytes({
      storageRef: '/sites/x/big.pdf',
      fetchImpl: async () => new Response(
        JSON.stringify({ ok: false, reason: 'too_large', size: 55555, name: 'big.pdf' }),
        { status: 200 },
      ),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too_large');
    assert.equal(r.size, 55555);
  }));

  it('extractDocumentText surfaces too_large as its own reason, not the generic fetch_failed', async () => {
    const r = await extractDocumentText(
      { storagePath: null, sourceUrl: null, storageRef: '/sites/x/big.pdf' },
      { fetchDocBytes: async () => ({ ok: false, reason: 'too_large', size: 12345, detail: 'sp too_large' }) },
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too_large');
    assert.equal(r.size, 12345);
  });
});

describe('CRE doc-text backlog — too_large is a ceiling marker, not a 24h transient', () => {
  it('too_large is registered as a CEILING reason (long expiry, self-clearing)', () => {
    assert.ok(CRE_CEILING_REASONS.includes('too_large'));
  });

  it('a too_large fetch writes a ceiling-expiry marker, not the 24h transient one, and reports the ceiling hours', async () => {
    const writes = [];
    const r = await runPropertyDocText(11, {
      registryRow: { id: 11, cre_property_id: 110, document_type: 'lease', source_url: '/sites/x/11.pdf' },
      extractDocumentText: async () => ({ ok: false, reason: 'too_large', detail: 'sp too_large', size: 87654321 }),
      opsQuery: async (method, _path, body) => {
        if (method === 'POST') { writes.push(body); return { ok: true }; }
        return { ok: true, data: [] };   // sidecarStatus: absent
      },
      now: () => Date.now(),
    });

    assert.equal(r.outcome, 'fetch_failed');
    assert.equal(r.reason, 'too_large');
    assert.equal(r.retry_marked, true);
    assert.equal(r.retry_after_hours, CRE_CEILING_RETRY_AFTER_HOURS,
      'a file whose size never changes must not be re-asked on the 24h transient cadence');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].reason, 'too_large', 'the marker itself must be keyed on the real reason, not a blanket fetch_failed');
  });
});

describe('document-text-tick — the SharePoint too-large retire path', () => {
  it('fetchAndStoreDocBytes surfaces too_large distinctly, not sharepoint_fetch_failed', async () => {
    const r = await fetchAndStoreDocBytes('dialysis', {
      docId: 1, propertyId: 2, sourceUrl: '/sites/x/big.pdf', documentType: 'lease', fileName: 'big.pdf',
    }, {
      getDomainCredentials: () => ({ url: 'https://x.test', key: 'k' }),
      fetchSharepointBytes: async () => ({ ok: false, reason: 'too_large', size: 12345678, name: 'big.pdf' }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too_large');
    assert.equal(r.size, 12345678);
  });

  it('retires a too-large SharePoint artifact under its OWN terminal, never the misleading url_expired', async () => {
    const patches = [];
    const r = await processOneUrlRefetch('dialysis', {
      document_id: 42, property_id: 1, source_url: '/sites/x/big.pdf', document_type: 'lease', file_name: 'big.pdf',
    }, {
      fetchAndStoreDocBytes: async () => ({ ok: false, reason: 'too_large', size: 12345678 }),
      domainQuery: async (_domain, method, path, body) => {
        if (method === 'PATCH') { patches.push({ path, body }); return { ok: true }; }
        return { ok: true, data: [] };
      },
    });
    assert.equal(r.outcome, 'retired_too_large');
    assert.equal(patches.length, 1);
    assert.equal(patches[0].body.ingestion_status, ARTIFACT_TOO_LARGE_TERMINAL);
    assert.notEqual(patches[0].body.ingestion_status, URL_EXPIRED_TERMINAL,
      'a real, reachable, over-cap file must never be recorded as a dead/expired link');
  });

  it('a genuinely dead link is still retired as url_expired, unchanged', async () => {
    const patches = [];
    const r = await processOneUrlRefetch('dialysis', {
      document_id: 43, property_id: 1, source_url: 'https://cdn.test/dead.pdf', document_type: 'deed', file_name: 'dead.pdf',
    }, {
      fetchAndStoreDocBytes: async () => ({ ok: false, reason: 'fetch_non_ok', status: 404 }),
      domainQuery: async (_domain, method, path, body) => {
        if (method === 'PATCH') { patches.push({ path, body }); return { ok: true }; }
        return { ok: true, data: [] };
      },
    });
    assert.equal(r.outcome, 'retired_url_expired');
    assert.equal(patches[0].body.ingestion_status, URL_EXPIRED_TERMINAL);
  });
});
