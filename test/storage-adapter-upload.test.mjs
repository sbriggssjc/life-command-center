// Phase 2 Slice 2b.1 — uploadDocToFolder speaks the proven Save-flow contract
// ({ path, content_base64, content_type }) and derives a LIBRARY-relative path.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { libraryRelativeDocPath, uploadDocToFolder } =
  await import('../api/_shared/storage-adapter.js');

describe('libraryRelativeDocPath', () => {
  it('strips the site/library prefix and joins the file name', () => {
    assert.equal(
      libraryRelativeDocPath(
        '/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI',
        'Foo [LCC].pdf'
      ),
      'PROPERTIES/D/DaVita/Chilton, WI/Foo [LCC].pdf'
    );
  });
  it('collapses double slashes from a trailing-slash folder', () => {
    assert.equal(
      libraryRelativeDocPath('/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/', 'Bar.pdf'),
      'PROPERTIES/D/Bar.pdf'
    );
  });
});

describe('uploadDocToFolder', () => {
  const FOLDER = '/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI';

  it('503s when SHAREPOINT_UPLOAD_URL is unset', async () => {
    const prev = process.env.SHAREPOINT_UPLOAD_URL;
    delete process.env.SHAREPOINT_UPLOAD_URL;
    const r = await uploadDocToFolder({ folderPath: FOLDER, fileName: 'x.pdf', bytes: Buffer.from('hi') });
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
    if (prev !== undefined) process.env.SHAREPOINT_UPLOAD_URL = prev;
  });

  it('POSTs the Save-flow body (path/content_base64/content_type) and reads server_relative_url', async () => {
    process.env.SHAREPOINT_UPLOAD_URL = 'https://pa.test.local/upload';
    let captured = null;
    const fetchImpl = async (_url, opts) => {
      captured = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, server_relative_url: `${FOLDER}/Foo [LCC].pdf`, item_id: 7 }),
      };
    };
    const r = await uploadDocToFolder({
      folderPath: FOLDER, fileName: 'Foo [LCC].pdf', bytes: Buffer.from('hello'), fetchImpl,
    });
    assert.equal(r.ok, true);
    assert.equal(r.server_relative_url, `${FOLDER}/Foo [LCC].pdf`);
    assert.equal(captured.path, 'PROPERTIES/D/DaVita/Chilton, WI/Foo [LCC].pdf');
    assert.equal(captured.content_base64, Buffer.from('hello').toString('base64'));
    assert.equal(captured.content_type, 'application/pdf');
    assert.equal('folder_path' in captured, false);
    assert.equal('file_name' in captured, false);
    delete process.env.SHAREPOINT_UPLOAD_URL;
  });

  it('returns ok:false on an upstream non-2xx (caller writes nothing)', async () => {
    process.env.SHAREPOINT_UPLOAD_URL = 'https://pa.test.local/upload';
    const fetchImpl = async () => ({ ok: false, status: 400, text: async () => 'bad request' });
    const r = await uploadDocToFolder({
      folderPath: FOLDER, fileName: 'Foo [LCC].pdf', bytes: Buffer.from('hello'), fetchImpl,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    delete process.env.SHAREPOINT_UPLOAD_URL;
  });
});
