// Phase 2 Slice 2f — On Market INGEST rides the frontier cursor + archive/working
// exclusion. Drives the REAL handler (handleFolderFeedTick) in
// ?source=frontier&mode=ingest through a STATEFUL folder_feed_frontier mock and
// asserts:
//   • the seeded ingest root enqueues its subfolders into the frontier (mode=ingest);
//   • an OM in a live subfolder is STAGED via the ingest path (stageOmIntake) and
//     recorded mode='ingest' — NOT the enrich attach path (a non-OM lease in the
//     same folder is 'skipped', which is the ingest write policy; enrich would
//     ATTACH it);
//   • an /OLD/ archive subfolder and a leading-underscore working subfolder are
//     NEVER enqueued (no frontier POST), and any existing deferred 'seen' rows
//     under them are flipped to 'skipped' (excluded_archive_or_working).
//
// Env set BEFORE import (db helpers capture *_SUPABASE_URL at load; roots/flags
// are read at request time).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const LIST_URL = 'https://pa.example.com/list-folder';
const ROOT = "/sites/TeamBriggs20/Shared Documents/Gv't Leased Research/On Market";
const LIVE = `${ROOT}/Live Deal`;
const OLD  = `${ROOT}/OLD`;
const WORK = `${ROOT}/_added or updated in comps spreadsheet`;

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.SHAREPOINT_LIST_URL = LIST_URL;
process.env.FOLDER_FEED_ROOTS = ROOT;     // ingest root
delete process.env.FOLDER_FEED_ENRICH_ROOTS;  // enrich inert
delete process.env.SHAREPOINT_FETCH_URL;      // extraction can't fetch bytes → fast no-op
delete process.env.LCC_ENV;

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

function listEnvelope({ files = [], folders = [] }) {
  return { ok: true, sp: { d: { Files: { results: files }, Folders: { results: folders } } } };
}

let frontier;       // path -> { status, depth, seq }
let seq;
let seenWrites;     // folder_feed_seen POST bodies
let seenPatches;    // folder_feed_seen PATCH urls
let frontierPosts;  // folder_feed_frontier POST bodies

function oldestPending() {
  let best = null;
  for (const [path, row] of frontier) {
    if (row.status !== 'pending') continue;
    if (!best || row.seq < best.row.seq) best = { path, row };
  }
  return best;
}

function installFetchMock() {
  frontier = new Map();
  seq = 0;
  seenWrites = [];
  seenPatches = [];
  frontierPosts = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch { /* ignore */ }

    // ---- PA List flow -------------------------------------------------------
    if (u === LIST_URL) {
      const folder = (JSON.parse(opts.body || '{}').folder_path || '').replace(/''/g, "'");
      if (folder === ROOT) {
        return jsonResponse(listEnvelope({
          folders: [
            { Name: 'Live Deal', ServerRelativeUrl: LIVE },
            { Name: 'OLD',       ServerRelativeUrl: OLD },
            { Name: '_added or updated in comps spreadsheet', ServerRelativeUrl: WORK },
          ],
        }));
      }
      if (folder === LIVE) {
        return jsonResponse(listEnvelope({
          files: [
            { Name: 'DaVita Tulsa OM.pdf', ServerRelativeUrl: `${LIVE}/DaVita Tulsa OM.pdf`, Length: '1000', ETag: 'om1' },
            { Name: 'lease abstract.pdf',  ServerRelativeUrl: `${LIVE}/lease abstract.pdf`,  Length: '500',  ETag: 'lz1' },
          ],
        }));
      }
      // OLD / WORK should never be listed (excluded before enqueue).
      return jsonResponse(listEnvelope({}));
    }

    // ---- folder_feed_frontier (stateful) -----------------------------------
    if (u.includes('/rest/v1/folder_feed_frontier')) {
      if (method === 'POST') {
        frontierPosts.push(body);
        const path = body.server_relative_path;
        if (!frontier.has(path)) {
          frontier.set(path, { status: body.status || 'pending', depth: body.depth || 0, seq: seq++ });
        }
        return jsonResponse([], true, 201);
      }
      if (method === 'PATCH') {
        if (u.includes('status=eq.visited') && u.includes('revisit_after=lt')) {
          return jsonResponse([], true, 200);  // re-promote sweep — none this test
        }
        const m = u.match(/id=eq\.([^&]+)/);
        const id = m ? decodeURIComponent(m[1]) : null;
        if (id && frontier.has(id)) frontier.set(id, { ...frontier.get(id), status: body.status || 'visited' });
        return jsonResponse([], true, 200);
      }
      if (u.includes('status=eq.pending')) {
        const best = oldestPending();
        if (!best) return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
        return jsonResponse([{ id: best.path, server_relative_path: best.path, depth: best.row.depth }]);
      }
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
    }

    // ---- folder_feed_seen --------------------------------------------------
    if (u.includes('/rest/v1/folder_feed_seen')) {
      if (method === 'POST') { seenWrites.push(body); return jsonResponse([], true, 201); }
      if (method === 'PATCH') {
        seenPatches.push(u);
        // The excluded-subtree flip reads back patched rows (return=representation).
        if (u.includes('status=in.(seen,error)')) {
          return jsonResponse([{ id: 1 }], true, 200);  // 1 backlog row flipped
        }
        return jsonResponse([], true, 200);
      }
      // diff lookup → unseen
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
    }

    // Any other write (stageOmIntake DB calls) — succeed generically.
    if (method === 'POST') return jsonResponse([{ id: 'row-1' }]);
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
const ingestReq = (query) => ({ method: 'POST', url: '/api/folder-feed-tick', headers: {}, query: { source: 'frontier', mode: 'ingest', ...query } });

describe('folder-feed ingest frontier crawl + exclusion (Slice 2f)', () => {
  beforeEach(installFetchMock);
  afterEach(() => { global.fetch = originalFetch; });

  it('descends On Market via the ingest cursor, excludes archive/working folders', async () => {
    const tick = async () => {
      const res = mockRes();
      await handleFolderFeedTick(ingestReq({ limit_folders: '1' }), res);
      assert.equal(res._status, 200);
      assert.equal(res._json.source, 'frontier');
      assert.equal(res._json.frontier.mode, 'ingest', 'frontier tick runs in ingest mode');
      return res._json;
    };

    // Tick 1 — pops + visits the ROOT, enqueues only the LIVE subfolder. The OLD
    // archive + leading-underscore working folders are NEVER enqueued, and their
    // existing backlog rows are flipped to skipped.
    const r1 = await tick();
    assert.equal(frontier.get(ROOT)?.status, 'visited', 'root visited after tick 1');
    assert.equal(frontier.get(LIVE)?.status, 'pending', 'live deal subfolder enqueued');
    assert.equal(frontier.has(OLD), false, 'OLD archive folder NOT enqueued');
    assert.equal(frontier.has(WORK), false, 'working folder NOT enqueued');
    // Frontier POSTs: the root seed + the LIVE enqueue, both mode=ingest; never OLD/WORK.
    assert.ok(frontierPosts.every(p => p.mode === 'ingest'), 'frontier rows tagged ingest');
    assert.ok(!frontierPosts.some(p => p.server_relative_path === OLD || p.server_relative_path === WORK),
      'no frontier row for excluded folders');
    // Excluded-subtree flips ran for OLD + WORK (status=in.(seen,error) PATCH).
    const flips = seenPatches.filter(u => u.includes('status=in.(seen,error)'));
    assert.equal(flips.length, 2, 'one excluded-subtree flip per excluded subfolder');
    assert.ok(r1.files_excluded >= 2, 'excluded backlog rows counted');

    // Tick 2 — pops the LIVE subfolder, stages the OM via the INGEST path and
    // SKIPS the non-OM lease (ingest write policy; enrich would attach it).
    await tick();
    assert.equal(frontier.get(LIVE)?.status, 'visited', 'live deal visited after tick 2');
    const omRow = seenWrites.find(r => r.server_relative_path === `${LIVE}/DaVita Tulsa OM.pdf`);
    const lzRow = seenWrites.find(r => r.server_relative_path === `${LIVE}/lease abstract.pdf`);
    assert.ok(omRow, 'OM recorded in folder_feed_seen');
    assert.equal(omRow.mode, 'ingest', 'OM staged on the ingest channel');
    assert.equal(omRow.status, 'staged', 'OM went through stageOmIntake (ingest path)');
    assert.ok(lzRow, 'lease recorded in folder_feed_seen');
    assert.equal(lzRow.status, 'skipped', 'non-OM lease skipped (ingest policy, NOT enrich attach)');
    assert.ok(seenWrites.every(r => r.mode === 'ingest'), 'every staged/seen row is ingest mode');
  });

  it('GET dry-run reports ingest frontier counts without mutating', async () => {
    frontier.set(ROOT, { status: 'pending', depth: 0, seq: seq++ });
    const res = mockRes();
    await handleFolderFeedTick(
      { method: 'GET', url: '/api/folder-feed-tick', headers: {}, query: { source: 'frontier', mode: 'ingest' } },
      res,
    );
    assert.equal(res._status, 200);
    assert.equal(res._json.mode, 'dry_run');
    assert.equal(res._json.frontier.mode, 'ingest');
    assert.equal(frontier.get(ROOT)?.status, 'pending', 'dry-run did not mutate the frontier');
  });
});
