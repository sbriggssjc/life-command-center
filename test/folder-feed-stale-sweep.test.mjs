// Phase 2 folder-feed (Slice 1d) — stale-sweep correctness.
//
// A capped/partial drain used to mark still-existing files 'stale' (terminal →
// lost to ingestion). Two guards now prevent that:
//   • Unit 1 — livePaths is built from the FULL listing up front, so a tick that
//     breaks on the time budget before processing the tail cannot stale a file
//     that is still listed.
//   • Unit 2 — a file must be absent from TWO consecutive full listings before it
//     goes stale (miss_streak), so a single transient/partial List response is
//     harmless. A genuine deletion still stales (on the second consecutive miss).
//
// Drives the REAL handler through a global.fetch mock (the repo's handler-test
// pattern). Env is set BEFORE the dynamic import because auth.js captures
// OPS_SUPABASE_URL at module load.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const LIST_URL = 'https://pa.example.com/list-folder';
const ROOT = '/sites/TeamBriggs20/Shared Documents/Gv\'t Leased Research/On Market';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.SHAREPOINT_LIST_URL = LIST_URL;
process.env.EXTRACT_RACE_MS = '1000';
delete process.env.LCC_ENV;              // development → auth dev-fallback returns a user
delete process.env.SHAREPOINT_FETCH_URL; // extraction can't fetch bytes → fast no-op

const { handleFolderFeedTick } = await import('../api/_handlers/folder-feed.js');

const originalFetch = global.fetch;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    headers: { get(name) { return headers[name.toLowerCase()] || headers[name] || null; } },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

function omItem(name) {
  return { Name: `${name} OM.pdf`, ServerRelativeUrl: `${ROOT}/${name} OM.pdf`, Length: '1000', ETag: `etag-${name}` };
}

// existingRows: what the sweep GET returns (previously-seen rows under ROOT).
// listFolderDelayMs: how long the List flow takes — used to trip the per-file
// time budget deterministically.
let seenWrites;   // statuses written via POST (upsertSeen)
let patchBodies;  // { url, body } for every PATCH (sweep + diff touch)
function installFetchMock({ listing, existingRows = [], listFolderDelayMs = 0 }) {
  seenWrites = [];
  patchBodies = [];
  let postId = 0;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();

    if (u === LIST_URL) {
      if (listFolderDelayMs) await delay(listFolderDelayMs);
      return jsonResponse({ ok: true, value: listing });
    }

    if (u.includes('/rest/v1/folder_feed_seen')) {
      if (method === 'POST') {
        seenWrites.push(JSON.parse(opts.body || '{}').status);
        return jsonResponse([], true, 201);
      }
      if (method === 'PATCH') {
        patchBodies.push({ url: u, body: JSON.parse(opts.body || '{}') });
        return jsonResponse([], true, 200);
      }
      // GET: the stale-sweep pull asks for the miss_streak column; the per-file
      // diff probe does not. Distinguish on that.
      if (u.includes('miss_streak')) {
        const n = existingRows.length;
        return jsonResponse(existingRows, true, 200, { 'content-range': n ? `0-${n - 1}/${n}` : '0-0/0' });
      }
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' }); // diff: unseen
    }

    if (u.includes('/rest/v1/inbox_items') && method === 'POST') {
      return jsonResponse([{ id: `inbox-${++postId}` }]);
    }
    if (method === 'POST') return jsonResponse([{ id: `row-${++postId}` }]);
    return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
  };
}

function mockRes() {
  return {
    _status: null, _json: null, headersSent: false,
    setHeader() {},
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; this.headersSent = true; return this; },
    end() { this.headersSent = true; return this; },
  };
}

function mockReq(query) {
  return { method: 'POST', url: '/api/folder-feed-tick', headers: {}, query: { folders: ROOT, ...query } };
}

const staleCount = () => patchBodies.filter((p) => p.body.status === 'stale').length;

describe('folder-feed stale sweep — Unit 1 (livePaths from full listing)', () => {
  afterEach(() => { global.fetch = originalFetch; delete process.env.FOLDER_FEED_TIME_BUDGET_MS; });

  it('does NOT stale the un-processed tail when the time budget trips early', async () => {
    // 5 listed-and-previously-seen files; the per-file budget trips before the
    // loop processes any of them (List flow takes 40ms, budget is 10ms). Old
    // code built livePaths incrementally → it would stale all 5. With Unit 1
    // livePaths holds the full listing, so none are staled.
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
    const listing = names.map(omItem);
    const existingRows = names.map((n, i) => ({
      id: 100 + i, server_relative_path: `${ROOT}/${n} OM.pdf`, miss_streak: 0,
    }));
    process.env.FOLDER_FEED_TIME_BUDGET_MS = '10';
    installFetchMock({ listing, existingRows, listFolderDelayMs: 40 });

    const res = mockRes();
    await handleFolderFeedTick(mockReq({}), res);

    assert.equal(res._status, 200);
    assert.equal(res._json.files_stale, 0, 'no live file staled');
    assert.equal(staleCount(), 0, 'no stale PATCH issued for the un-processed tail');
  });
});

describe('folder-feed stale sweep — Unit 2 (two consecutive misses)', () => {
  afterEach(() => { global.fetch = originalFetch; delete process.env.FOLDER_FEED_TIME_BUDGET_MS; });

  it('a genuine deletion stales on the second consecutive miss', async () => {
    // Listing of 3 files; a previously-seen 4th child is absent. It already has
    // miss_streak=1 (missed once before) → this miss bumps to 2 → stale.
    const listing = ['Alpha', 'Bravo', 'Charlie'].map(omItem);
    const existingRows = [
      ...['Alpha', 'Bravo', 'Charlie'].map((n, i) => ({ id: 200 + i, server_relative_path: `${ROOT}/${n} OM.pdf`, miss_streak: 0 })),
      { id: 299, server_relative_path: `${ROOT}/Deleted OM.pdf`, miss_streak: 1 },
    ];
    installFetchMock({ listing, existingRows });

    const res = mockRes();
    await handleFolderFeedTick(mockReq({}), res);

    assert.equal(res._status, 200);
    assert.equal(res._json.files_stale, 1, 'the absent 4th child is staled');
    const stalePatch = patchBodies.find((p) => p.body.status === 'stale');
    assert.ok(stalePatch && stalePatch.url.includes('id=eq.299'), 'staled the right row');
    assert.equal(stalePatch.body.miss_streak, 2, 'staled on the second miss');
  });

  it('first miss only bumps miss_streak; status is left untouched', async () => {
    // Same absent 4th child, but miss_streak starts at 0 → first miss → bumped
    // to 1, NOT staled.
    const listing = ['Alpha', 'Bravo', 'Charlie'].map(omItem);
    const existingRows = [
      ...['Alpha', 'Bravo', 'Charlie'].map((n, i) => ({ id: 300 + i, server_relative_path: `${ROOT}/${n} OM.pdf`, miss_streak: 0 })),
      { id: 399, server_relative_path: `${ROOT}/Maybe Gone OM.pdf`, miss_streak: 0 },
    ];
    installFetchMock({ listing, existingRows });

    const res = mockRes();
    await handleFolderFeedTick(mockReq({}), res);

    assert.equal(res._status, 200);
    assert.equal(res._json.files_stale, 0, 'a single miss never stales');
    assert.equal(staleCount(), 0);
    const bump = patchBodies.find((p) => p.url.includes('id=eq.399'));
    assert.ok(bump, 'the missed row was PATCHed');
    assert.equal(bump.body.miss_streak, 1, 'streak bumped to 1');
    assert.equal(bump.body.status, undefined, 'status left untouched on the first miss');
  });
});
