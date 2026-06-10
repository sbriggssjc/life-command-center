// Phase 2 folder-feed (Slice 1b) — REST list-response parser + path forms.
// The PA "List folder" flow was rebuilt on "Send an HTTP request to SharePoint"
// (REST); the worker must read the OData *verbose* envelope (sp.d.Files.results
// / sp.d.Folders.results), coerce the STRING `Length`, tag folders for the walk,
// and double apostrophes for the OData string literal. Verified shape from a
// live run 2026-06-10.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseListFolderResponse, toServerRelative } from '../api/_handlers/folder-feed.js';

const PREFIX = '/sites/TeamBriggs20/Shared Documents';

function liveEnvelope() {
  return {
    ok: true,
    sp: { d: {
      Name: 'Ad-Hoc Analyst Requests',
      ServerRelativeUrl: `${PREFIX}/Ad-Hoc Analyst Requests`,
      ItemCount: 4,
      Files: { results: [
        { Name: 'DaVita Tulsa OM.pdf', ServerRelativeUrl: `${PREFIX}/PROPERTIES/D/DaVita/Tulsa, OK/DaVita Tulsa OM.pdf`,
          Length: '208384', TimeCreated: '2026-05-01T09:00:00Z', TimeLastModified: '2026-06-01T12:00:00Z',
          UniqueId: 'file-guid', ETag: '"{GUID},3"', MajorVersion: 3 },
      ] },
      Folders: { results: [
        { Name: "Storage OM's", ServerRelativeUrl: `${PREFIX}/Storage OM's`, ItemCount: 12,
          UniqueId: 'folder-guid', TimeLastModified: '2026-06-01T12:00:00Z' },
      ] },
    } },
  };
}

describe('folder-feed parseListFolderResponse (REST verbose envelope)', () => {
  it('reads files + folders from sp.d.Files.results / sp.d.Folders.results', () => {
    const items = parseListFolderResponse(liveEnvelope());
    assert.equal(items.length, 2);
    const file = items.find(i => !i.is_folder);
    const folder = items.find(i => i.is_folder);
    assert.ok(file && folder, 'one file + one folder');
    assert.equal(file.path, `${PREFIX}/PROPERTIES/D/DaVita/Tulsa, OK/DaVita Tulsa OM.pdf`);
    assert.equal(file.name, 'DaVita Tulsa OM.pdf');
    assert.equal(file.etag, '"{GUID},3"');
    assert.equal(file.modified, '2026-06-01T12:00:00Z');
    assert.equal(folder.path, `${PREFIX}/Storage OM's`);
  });

  it('coerces the STRING `Length` to a finite int; folders have null size', () => {
    const items = parseListFolderResponse(liveEnvelope());
    const file = items.find(i => !i.is_folder);
    const folder = items.find(i => i.is_folder);
    assert.strictEqual(file.size, 208384);
    assert.strictEqual(folder.size, null);
  });

  it('tags folders is_folder:true so the walk enqueues them, not the classifier', () => {
    const items = parseListFolderResponse(liveEnvelope());
    assert.equal(items.filter(i => i.is_folder).length, 1);
    assert.equal(items.filter(i => !i.is_folder).length, 1);
  });

  it('tolerates a future nometadata switch (sp.Files / sp.Folders, no .results)', () => {
    const items = parseListFolderResponse({ ok: true, sp: {
      Files: [{ Name: 'a.pdf', ServerRelativeUrl: `${PREFIX}/a.pdf`, Length: '10' }],
      Folders: [{ Name: 'Sub', ServerRelativeUrl: `${PREFIX}/Sub` }],
    } });
    assert.equal(items.length, 2);
    assert.equal(items.find(i => !i.is_folder).size, 10);
  });

  it('tolerates the legacy flat shapes (json.items / lowercase fields)', () => {
    const items = parseListFolderResponse({ ok: true, items: [
      { name: 'old.pdf', path: `${PREFIX}/old.pdf`, size: 5, etag: 'x', modified: '2026-01-01T00:00:00Z' },
    ] });
    assert.equal(items.length, 1);
    assert.equal(items[0].path, `${PREFIX}/old.pdf`);
    assert.equal(items[0].size, 5);
    assert.equal(items[0].is_folder, false);
  });

  it('drops rows with no resolvable path', () => {
    const items = parseListFolderResponse({ ok: true, sp: { d: { Files: { results: [
      { Name: 'no-path.pdf', Length: '1' },
    ] } } } });
    assert.equal(items.length, 0);
  });
});

describe('folder-feed toServerRelative (OData literal form)', () => {
  it('prefixes a bare folder name with the site document library', () => {
    assert.equal(toServerRelative('PROPERTIES'), `${PREFIX}/PROPERTIES`);
  });

  it('doubles apostrophes for the OData string literal', () => {
    assert.equal(toServerRelative("Storage OM's"), `${PREFIX}/Storage OM''s`);
  });

  it('is idempotent on a full server-relative path and on pre-doubled apostrophes', () => {
    const want = `${PREFIX}/Storage OM''s`;
    assert.equal(toServerRelative(`${PREFIX}/Storage OM's`), want);
    assert.equal(toServerRelative(`${PREFIX}/Storage OM''s`), want);
  });

  it('normalizes backslashes and strips a trailing slash', () => {
    assert.equal(toServerRelative(`${PREFIX}\\Dialysis Research\\`), `${PREFIX}/Dialysis Research`);
  });
});
