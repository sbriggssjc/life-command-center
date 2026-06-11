// Phase 2 Slice 2b.2 — uploadDocToFolder sends a DYNAMIC Folder Path + File Name
// ({ folder_path, file_name, content_base64 }) so the write-back lands in the
// resolved property folder, not the flow's hardcoded intake zone.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { libraryRelativeFolder, libraryRelativeDocPath, uploadDocToFolder } =
  await import('../api/_shared/storage-adapter.js');

describe('libraryRelativeFolder', () => {
  it('strips the site/library prefix and leading/trailing slashes', () => {
    assert.equal(
      libraryRelativeFolder('/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/DaVita/Chilton, WI'),
      'PROPERTIES/D/DaVita/Chilton, WI'
    );
  });
  it('drops a trailing slash and collapses double slashes', () => {
    assert.equal(
      libraryRelativeFolder('/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/'),
      'PROPERTIES/D'
    );
  });
});

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

  it('POSTs the dynamic body (folder_path/file_name/content_base64) and reads server_relative_url', async () => {
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
    assert.equal(captured.folder_path, 'PROPERTIES/D/DaVita/Chilton, WI');
    assert.equal(captured.file_name, 'Foo [LCC].pdf');
    assert.equal(captured.content_base64, Buffer.from('hello').toString('base64'));
    assert.equal('path' in captured, false);
    assert.equal('content_type' in captured, false);
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
