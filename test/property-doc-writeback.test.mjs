// Phase 2 Slice 2b — property-doc write-back: [LCC] tag/dedup, effect-first DB
// write, and the re-ingest guard.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';

const { classifyFile, ensureLccTag, dedupeFileName, hasLccTag } =
  await import('../api/_shared/folder-feed-classify.js');
const { performDocWriteback } = await import('../api/_handlers/property-doc-writeback.js');

describe('ensureLccTag', () => {
  it('inserts the [LCC] marker before the extension', () => {
    assert.equal(ensureLccTag('DaVita Chilton BOV.pdf'), 'DaVita Chilton BOV [LCC].pdf');
  });
  it('is idempotent — does not double-tag', () => {
    assert.equal(ensureLccTag('Memo [LCC].pdf'), 'Memo [LCC].pdf');
  });
  it('tags an extensionless name by appending', () => {
    assert.equal(ensureLccTag('Master Sheet'), 'Master Sheet [LCC]');
  });
});

describe('dedupeFileName (never overwrite)', () => {
  it('returns the name unchanged when there is no collision', () => {
    assert.equal(dedupeFileName('OM [LCC].pdf', new Set(['other.pdf'])), 'OM [LCC].pdf');
  });
  it('appends a dated suffix on a collision', () => {
    const out = dedupeFileName('OM [LCC].pdf', new Set(['om [lcc].pdf']));
    assert.match(out, /^OM \[LCC\] \(\d{4}-\d{2}-\d{2}\)\.pdf$/);
  });
  it('adds a counter when the dated name also collides', () => {
    const date = new Date().toISOString().slice(0, 10);
    const existing = new Set(['om [lcc].pdf', `om [lcc] (${date}).pdf`]);
    const out = dedupeFileName('OM [LCC].pdf', existing);
    assert.equal(out, `OM [LCC] (${date}-2).pdf`);
  });
});

describe('re-ingest guard (classifyFile)', () => {
  it('classifies an [LCC]-tagged file as skipped/lcc_generated, never om', () => {
    assert.deepEqual(classifyFile('DaVita Chilton OM [LCC].pdf'), { type: 'lcc_generated', isOm: false });
    assert.deepEqual(classifyFile('GSA BOV [LCC].xlsx'), { type: 'lcc_generated', isOm: false });
    assert.equal(hasLccTag('DaVita Chilton OM [LCC].pdf'), true);
  });
  it('still stages a normal (untagged) OM', () => {
    assert.deepEqual(classifyFile('DaVita Chilton OM.pdf'), { type: 'om', isOm: true });
  });
});

// --- performDocWriteback (effect-first / outcome-truthful) ------------------
const FOLDER = '/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI';

function baseDeps(overrides = {}) {
  return {
    resolveFolder:    async () => ({ ok: true, folder_path: FOLDER, source: 'known_property_document' }),
    listNames:        async () => new Set(),
    uploadDoc:        async ({ fileName }) => ({ ok: true, server_relative_url: `${FOLDER}/${fileName}` }),
    insertDoc:        async () => ({ ok: true, document_id: 555 }),
    recordProvenance: async () => true,
    ...overrides,
  };
}

const ARGS = { domain: 'dialysis', propertyId: 29841, fileName: 'BOV.pdf', docType: 'bov', contentBase64: Buffer.from('hi').toString('base64') };

describe('performDocWriteback', () => {
  it('happy path → 200, [LCC]-tagged name, links the doc + provenance', async () => {
    const r = await performDocWriteback(ARGS, baseDeps());
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.file_name, 'BOV [LCC].pdf');
    assert.equal(r.body.server_relative_url, `${FOLDER}/BOV [LCC].pdf`);
    assert.equal(r.body.document_id, 555);
    assert.equal(r.body.provenance, true);
    assert.equal(r.body.folder_path, FOLDER);
  });

  it('REFUSES (422) when the folder is unresolved — no upload, no DB write', async () => {
    let uploaded = false, inserted = false;
    const r = await performDocWriteback(ARGS, baseDeps({
      resolveFolder: async () => ({ ok: false, reason: 'folder_unresolved' }),
      uploadDoc: async () => { uploaded = true; return { ok: true, server_relative_url: 'x' }; },
      insertDoc: async () => { inserted = true; return { ok: true, document_id: 1 }; },
    }));
    assert.equal(r.status, 422);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, 'folder_unresolved');
    assert.equal(uploaded, false);
    assert.equal(inserted, false);
  });

  it('upload failure → 502 and writes NOTHING to the DB', async () => {
    let inserted = false;
    const r = await performDocWriteback(ARGS, baseDeps({
      uploadDoc: async () => ({ ok: false, status: 500, detail: 'pa_upload_failed' }),
      insertDoc: async () => { inserted = true; return { ok: true, document_id: 1 }; },
    }));
    assert.equal(r.status, 502);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, 'upload_failed');
    assert.equal(inserted, false);
  });

  it('upload OK + DB link fail → 207, returns the uploaded path so it is not lost', async () => {
    const r = await performDocWriteback(ARGS, baseDeps({
      insertDoc: async () => ({ ok: false, status: 500, detail: 'pgrst write failed' }),
    }));
    assert.equal(r.status, 207);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.uploaded, true);
    assert.equal(r.body.doc_attach, false);
    assert.equal(r.body.server_relative_url, `${FOLDER}/BOV [LCC].pdf`);
  });

  it('de-dups against an existing file in the destination folder', async () => {
    const r = await performDocWriteback(ARGS, baseDeps({
      listNames: async () => new Set(['bov [lcc].pdf']),
    }));
    assert.equal(r.status, 200);
    assert.match(r.body.file_name, /^BOV \[LCC\] \(\d{4}-\d{2}-\d{2}\)\.pdf$/);
  });
});
