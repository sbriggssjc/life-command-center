// Phase 2 folder-feed (Slice 1c) — per-tick max_stage cap on the drain.
//
// A controlled first real drain should stage just 1-2 files so the operator can
// watch stage → extract → match → propagate end to end. This drives the REAL
// handler through a global.fetch mock (the repo's handler-test pattern) and
// asserts:
//   • with max_stage=2 and 3 OM-eligible files → exactly 2 stage, 1 is recorded
//     status='seen' (known-but-deferred), files_deferred === 1.
//   • with NO max_stage → all 3 stage, files_deferred === 0 (behavior unchanged).
//
// Env is set BEFORE the dynamic import because api/_shared/auth.js captures
// OPS_SUPABASE_URL at module load.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const LIST_URL = 'https://pa.example.com/list-folder';
const ROOT = '/sites/TeamBriggs20/Shared Documents/Gv\'t Leased Research/On Market';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.SHAREPOINT_LIST_URL = LIST_URL;
process.env.EXTRACT_RACE_MS = '1000'; // bound the extraction race in stageOmIntake
delete process.env.LCC_ENV;           // development → auth dev-fallback returns a user
delete process.env.SHAREPOINT_FETCH_URL; // extraction can't fetch bytes → fast no-op

const { handleFolderFeedTick } = await import('../api/_handlers/folder-feed.js');

const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) { return headers[name.toLowerCase()] || headers[name] || null; },
    },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

// Three OM-eligible files under one folder (classifyFile keys on '*OM*'/'*flyer*').
function listingItems() {
  return [
    { Name: 'Alpha OM.pdf', ServerRelativeUrl: `${ROOT}/Alpha OM.pdf`, Length: '1000', ETag: 'etag-a' },
    { Name: 'Bravo OM.pdf', ServerRelativeUrl: `${ROOT}/Bravo OM.pdf`, Length: '2000', ETag: 'etag-b' },
    { Name: 'Charlie OM.pdf', ServerRelativeUrl: `${ROOT}/Charlie OM.pdf`, Length: '3000', ETag: 'etag-c' },
  ];
}

// Records the status of every folder_feed_seen row the handler writes.
let seenWrites;
let inboxPosts;

function installFetchMock() {
  seenWrites = [];
  inboxPosts = 0;
  let postId = 0;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();

    // PA "List folder" flow.
    if (u === LIST_URL) {
      return jsonResponse({ ok: true, value: listingItems() });
    }

    // folder_feed_seen — diff GET (not seen) + upsertSeen POST/PATCH.
    if (u.includes('/rest/v1/folder_feed_seen')) {
      if (method === 'POST') {
        seenWrites.push(JSON.parse(opts.body || '{}').status);
        return jsonResponse([], true, 201);
      }
      if (method === 'PATCH') return jsonResponse([], true, 200);
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' }); // diff: unseen
    }

    // inbox_items POST is the once-per-stage-attempt write inside stageOmIntake.
    if (u.includes('/rest/v1/inbox_items') && method === 'POST') {
      inboxPosts++;
      return jsonResponse([{ id: `inbox-${inboxPosts}` }]);
    }

    // Generic OPS responses: GET finds nothing (so stageOmIntake inserts), every
    // POST returns a row with an id so `.data[0].id` reads succeed; the extraction
    // race resolves fast and stageOmIntake returns 200 ok regardless.
    if (method === 'POST') return jsonResponse([{ id: `row-${++postId}` }]);
    return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
  };
}

function mockRes() {
  return {
    _status: null,
    _json: null,
    headersSent: false,
    setHeader() {},
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
  };
}

function mockReq(query) {
  return { method: 'POST', url: '/api/folder-feed-tick', headers: {}, query: { folders: ROOT, ...query } };
}

describe('folder-feed max_stage cap (drain)', () => {
  beforeEach(installFetchMock);
  afterEach(() => { global.fetch = originalFetch; });

  it('caps staging at max_stage=2 and defers the rest as status=seen', async () => {
    const res = mockRes();
    await handleFolderFeedTick(mockReq({ max_stage: '2' }), res);

    assert.equal(res._status, 200);
    const r = res._json;
    assert.equal(r.mode, 'drain');
    assert.equal(r.max_stage, 2, 'effective cap echoed');
    assert.equal(r.files_staged, 2, 'exactly 2 staged');
    assert.equal(r.files_deferred, 1, 'one OM-eligible file deferred');
    assert.ok(r.files_deferred >= 1);

    // Two files recorded 'staged', the deferred one recorded 'seen'.
    assert.equal(seenWrites.filter((s) => s === 'staged').length, 2);
    assert.equal(seenWrites.filter((s) => s === 'seen').length, 1);
    assert.equal(inboxPosts, 2, 'stageOmIntake invoked exactly twice');

    // Per-folder rollup carries the new counters too.
    const folder = r.folders[0];
    assert.equal(folder.staged, 2);
    assert.equal(folder.deferred, 1);
  });

  it('stages everything when max_stage is absent (behavior unchanged)', async () => {
    const res = mockRes();
    await handleFolderFeedTick(mockReq({}), res);

    assert.equal(res._status, 200);
    const r = res._json;
    assert.equal(r.max_stage, null, 'unbounded → null in summary');
    assert.equal(r.files_staged, 3, 'all three staged');
    assert.equal(r.files_deferred, 0, 'nothing deferred');
    assert.equal(seenWrites.filter((s) => s === 'staged').length, 3);
    assert.equal(seenWrites.filter((s) => s === 'seen').length, 0);
    assert.equal(inboxPosts, 3, 'stageOmIntake invoked for every file');
  });
});
