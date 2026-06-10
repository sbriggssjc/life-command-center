// Phase 2 Slice 2a.1 — folder-feed worker: decouple the enrich budget from ingest.
//
// Two independence guarantees, proven by driving the REAL handler through a
// global.fetch mock (the repo's handler-test pattern):
//
//   • Unit 2 (TIME): ingest is walked FIRST and gets a reserved time slice
//     (TIME_BUDGET_MS - ENRICH_RESERVE_MS). When ingest exhausts that slice, the
//     enrich phase still gets its own reserved window and walks ≥1 folder.
//
//   • Unit 1 (FOLDER): `report.folders_walked` is reporting-only, NOT a gate.
//     Even when ingest walks its FULL limit_folders budget, enrich's own folder
//     budget is honored independently — enrich still walks ≥1 folder. (Under the
//     old shared `folders_walked < limitFolders` gate this collapsed to 0.)
//
// Env set BEFORE import (auth.js / db helpers capture *_SUPABASE_URL at load).
// FOLDER_FEED_ROOTS / FOLDER_FEED_ENRICH_ROOTS / the budget knobs are read at
// REQUEST time, so they're configured per-test.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const LIST_URL = 'https://pa.example.com/list-folder';
const BASE = '/sites/TeamBriggs20/Shared Documents';
const ENRICH_ROOT = `${BASE}/PROPERTIES`;

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
    ok, status,
    headers: { get(n) { return headers[n.toLowerCase()] || headers[n] || null; } },
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

function omFile(folder) {
  return { Name: 'Sample OM.pdf', ServerRelativeUrl: `${folder}/Sample OM.pdf`, Length: '1000', ETag: `etag-${folder}` };
}
function subFolder(path) {
  return { ServerRelativeUrl: path, Name: path.split('/').pop() };
}

// listingFor(folder) → { value:[files], Folders:[subfolders] }. listDelayMs trips
// the per-phase time deadline deterministically.
function installFetchMock(listingFor, listDelayMs = 0) {
  let postId = 0;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u === LIST_URL) {
      if (listDelayMs) await delay(listDelayMs);
      const folder = (JSON.parse(opts.body || '{}').folder_path || '').replace(/''/g, "'");
      return jsonResponse({ ok: true, ...listingFor(folder) });
    }
    if (u.includes('/rest/v1/folder_feed_seen')) {
      if (method === 'POST') return jsonResponse([], true, 201);
      if (method === 'PATCH') return jsonResponse([], true, 200);
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' }); // unseen / no sweep rows
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

const walkedByMode = (report, mode) => report.folders.filter((f) => f.mode === mode).length;

describe('folder-feed phase budgets (Slice 2a.1)', () => {
  beforeEach(() => {
    delete process.env.FOLDER_FEED_TIME_BUDGET_MS;
    delete process.env.FOLDER_FEED_ENRICH_RESERVE_MS;
    delete process.env.FOLDER_FEED_ROOTS;
    delete process.env.FOLDER_FEED_ENRICH_ROOTS;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.FOLDER_FEED_TIME_BUDGET_MS;
    delete process.env.FOLDER_FEED_ENRICH_RESERVE_MS;
    delete process.env.FOLDER_FEED_ROOTS;
    delete process.env.FOLDER_FEED_ENRICH_ROOTS;
  });

  it('Unit 2: ingest exhausting its TIME slice still leaves enrich walking ≥1 folder', async () => {
    // 5 ingest roots, each List takes 250ms; budget 1000, reserve 800 → ingest
    // deadline +200 (so ingest can't finish even its 2nd List), enrich deadline
    // +1000. Ingest is cut off after ~1 folder; enrich gets its reserved window.
    const ingestRoots = Array.from({ length: 5 }, (_, i) => `${BASE}/On Market ${i}`);
    process.env.FOLDER_FEED_ROOTS = ingestRoots.join(',');
    process.env.FOLDER_FEED_ENRICH_ROOTS = ENRICH_ROOT;
    process.env.FOLDER_FEED_TIME_BUDGET_MS = '1000';
    process.env.FOLDER_FEED_ENRICH_RESERVE_MS = '800';

    installFetchMock((folder) => ({ value: [omFile(folder)] }), 250);

    const res = mockRes();
    await handleFolderFeedTick(mockReq({}), res);

    assert.equal(res._status, 200);
    assert.equal(res._json.ingest_roots, 5);
    assert.equal(res._json.enrich_roots, 1);
    const ingestWalked = walkedByMode(res._json, 'ingest');
    const enrichWalked = walkedByMode(res._json, 'enrich');
    assert.ok(ingestWalked >= 1 && ingestWalked < 5, `ingest cut off by its time slice (walked ${ingestWalked} of 5)`);
    assert.ok(enrichWalked >= 1, 'enrich still walked ≥1 folder in its reserved window');
  });

  it('Unit 1: enrich folder budget is honored even when ingest walks its FULL limit_folders', async () => {
    // limit_folders=2: ingest root + 1 subfolder == exactly the ingest budget, so
    // ingest exhausts limit_folders. Under the old shared counter enrich would
    // walk 0; now enrich walks its own budget independently. No time pressure
    // (default 22s budget, no List delay).
    const ingestRoot = `${BASE}/On Market`;
    const ingestSub = `${ingestRoot}/Sub`;
    process.env.FOLDER_FEED_ROOTS = ingestRoot;
    process.env.FOLDER_FEED_ENRICH_ROOTS = ENRICH_ROOT;

    installFetchMock((folder) => {
      if (folder === ingestRoot) return { value: [omFile(folder)], Folders: [subFolder(ingestSub)] };
      return { value: [omFile(folder)] };
    });

    const res = mockRes();
    await handleFolderFeedTick(mockReq({ limit_folders: '2', enrich_limit_folders: '2' }), res);

    assert.equal(res._status, 200);
    const ingestWalked = walkedByMode(res._json, 'ingest');
    const enrichWalked = walkedByMode(res._json, 'enrich');
    assert.equal(ingestWalked, 2, 'ingest walked its full limit_folders (root + subfolder)');
    assert.ok(enrichWalked >= 1, 'enrich walked its own budget despite ingest exhausting limit_folders');
  });
});
