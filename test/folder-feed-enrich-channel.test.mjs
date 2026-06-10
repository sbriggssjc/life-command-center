// Phase 2 Slice 2a — folder-feed worker: enrich channel routing + mode tagging.
//
// Drives the REAL handler (handleFolderFeedTick) through a global.fetch mock and
// asserts the Unit-1 channel behaviour:
//   • ?folders=<dir>&mode=enrich  → files staged on the enrich channel; every
//     folder_feed_seen row records mode='enrich'.
//   • default ?folders=<dir>      → mode='ingest' (the Slice-1 behaviour).
//   • SAFETY: with FOLDER_FEED_ENRICH_ROOTS unset and no ?folders override, the
//     cron path walks ingest roots only (enrich_roots === 0) — the PROPERTIES
//     tree is inert until Scott opts in.
//
// Env set BEFORE import (auth.js / db helpers capture *_SUPABASE_URL at load).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const LIST_URL = 'https://pa.example.com/list-folder';
// Comma-free folder: ?folders= uses comma as its list separator, so a manual
// drain targets the tenant folder and lets the BFS recurse into "City, ST".
const PROP_DIR = '/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/DaVita';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.SHAREPOINT_LIST_URL = LIST_URL;
process.env.EXTRACT_RACE_MS = '1000';
delete process.env.LCC_ENV;
delete process.env.SHAREPOINT_FETCH_URL;
delete process.env.FOLDER_FEED_ENRICH_ROOTS; // default: enrich channel inert

const { handleFolderFeedTick } = await import('../api/_handlers/folder-feed.js');

const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok, status,
    headers: { get(n) { return headers[n.toLowerCase()] || headers[n] || null; } },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

function listingItems(root) {
  return [{ Name: 'DaVita Tulsa OM.pdf', ServerRelativeUrl: `${root}/DaVita Tulsa OM.pdf`, Length: '1000', ETag: 'etag-a' }];
}

let seenRows; // folder_feed_seen POST bodies
function installFetchMock() {
  seenRows = [];
  let postId = 0;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u === LIST_URL) {
      const folder = JSON.parse(opts.body || '{}').folder_path || '';
      // The flow inlines server-relative paths with doubled apostrophes; strip
      // back to the real path for the listing fixture.
      const root = folder.replace(/''/g, "'");
      return jsonResponse({ ok: true, value: listingItems(root) });
    }
    if (u.includes('/rest/v1/folder_feed_seen')) {
      if (method === 'POST') { seenRows.push(JSON.parse(opts.body || '{}')); return jsonResponse([], true, 201); }
      if (method === 'PATCH') return jsonResponse([], true, 200);
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
    }
    if (u.includes('/rest/v1/inbox_items') && method === 'POST') return jsonResponse([{ id: `inbox-${++postId}` }]);
    if (method === 'POST') return jsonResponse([{ id: `row-${++postId}` }]);
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
const mockReq = (query) => ({ method: 'POST', url: '/api/folder-feed-tick', headers: {}, query });

describe('folder-feed enrich channel (Slice 2a)', () => {
  beforeEach(installFetchMock);
  afterEach(() => { global.fetch = originalFetch; });

  it('?folders=<dir>&mode=enrich routes the file on the enrich channel', async () => {
    const res = mockRes();
    await handleFolderFeedTick(mockReq({ folders: PROP_DIR, mode: 'enrich' }), res);

    assert.equal(res._status, 200);
    assert.equal(res._json.enrich_roots, 1);
    assert.equal(res._json.ingest_roots, 0);
    assert.equal(res._json.files_staged, 1);
    assert.ok(seenRows.length >= 1);
    assert.ok(seenRows.every(r => r.mode === 'enrich'), 'every seen row tagged enrich');
  });

  it('default mode tags the seen row ingest', async () => {
    const res = mockRes();
    await handleFolderFeedTick(mockReq({ folders: PROP_DIR }), res);

    assert.equal(res._status, 200);
    assert.equal(res._json.ingest_roots, 1);
    assert.equal(res._json.enrich_roots, 0);
    assert.ok(seenRows.length >= 1);
    assert.ok(seenRows.every(r => r.mode === 'ingest'), 'every seen row tagged ingest');
  });

  it('SAFETY: enrich channel is inert when the env is unset (cron path)', async () => {
    const res = mockRes();
    await handleFolderFeedTick(mockReq({}), res);

    assert.equal(res._status, 200);
    assert.equal(res._json.enrich_roots, 0, 'no enrich roots without FOLDER_FEED_ENRICH_ROOTS');
    assert.ok(res._json.ingest_roots >= 1, 'ingest channel still walks the defaults');
  });
});
