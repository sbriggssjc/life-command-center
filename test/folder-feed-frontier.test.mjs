// Phase 2 Slice 2d (Unit 1) — persisted crawl frontier descends across ticks.
//
// Drives the REAL handler (handleFolderFeedTick) in ?source=frontier mode
// through a STATEFUL folder_feed_frontier mock and asserts the cursor descends:
//   • Tick 1 pops the seeded root, lists it, ENQUEUES its subfolder into the
//     frontier (pending), and marks the root VISITED.
//   • Tick 2 pops the now-oldest pending (the subfolder), lists it, processes its
//     file, and marks the subfolder VISITED — i.e. progress persisted, the crawl
//     went DEEPER instead of re-listing the root.
//   • When nothing is pending, visited rows past revisit_after are re-promoted.
//
// Env set BEFORE import (db helpers + roots are read at request time, but the
// db helpers capture *_SUPABASE_URL at load).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const LIST_URL = 'https://pa.example.com/list-folder';
const ROOT = '/sites/TeamBriggs20/Shared Documents/PROPERTIES';
const SUB  = `${ROOT}/D/DaVita/Tulsa, OK`;

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.SHAREPOINT_LIST_URL = LIST_URL;
process.env.FOLDER_FEED_ENRICH_ROOTS = ROOT;
delete process.env.FOLDER_FEED_ROOTS;          // no ingest roots — frontier is enrich-only
delete process.env.SHAREPOINT_FETCH_URL;
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

// Verbose-OData listing envelope (Files + Folders), the shape listFolder parses.
function listEnvelope({ files = [], folders = [] }) {
  return {
    ok: true,
    sp: { d: {
      Files:   { results: files },
      Folders: { results: folders },
    } },
  };
}

// One stateful frontier table shared across ticks (insertion-ordered Map).
let frontier;   // path -> { status, depth, seq }
let seq;
let seenWrites; // folder_feed_seen POST bodies

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
          folders: [{ Name: 'D', ServerRelativeUrl: `${ROOT}/D` }],
        }));
      }
      if (folder === `${ROOT}/D`) {
        return jsonResponse(listEnvelope({
          folders: [{ Name: 'DaVita', ServerRelativeUrl: `${ROOT}/D/DaVita` }],
        }));
      }
      if (folder === `${ROOT}/D/DaVita`) {
        return jsonResponse(listEnvelope({
          folders: [{ Name: 'Tulsa, OK', ServerRelativeUrl: SUB }],
        }));
      }
      if (folder === SUB) {
        return jsonResponse(listEnvelope({
          files: [{ Name: 'misc-notes.txt', ServerRelativeUrl: `${SUB}/misc-notes.txt`, Length: '50', ETag: 'e1' }],
        }));
      }
      return jsonResponse(listEnvelope({}));
    }

    // ---- folder_feed_frontier (stateful) -----------------------------------
    if (u.includes('/rest/v1/folder_feed_frontier')) {
      if (method === 'POST') {
        // ignore-duplicates seed/enqueue
        const path = body.server_relative_path;
        if (!frontier.has(path)) {
          frontier.set(path, { status: body.status || 'pending', depth: body.depth || 0, seq: seq++ });
        }
        return jsonResponse([], true, 201);
      }
      if (method === 'PATCH') {
        if (u.includes('status=eq.visited') && u.includes('revisit_after=lt')) {
          // re-promote sweep — none past revisit in this test
          return jsonResponse([], true, 200);
        }
        // mark a single row visited (id=eq.<path-as-id>) — we keyed id by path
        const m = u.match(/id=eq\.([^&]+)/);
        const id = m ? decodeURIComponent(m[1]) : null;
        if (id && frontier.has(id)) {
          frontier.set(id, { ...frontier.get(id), status: body.status || 'visited' });
        }
        return jsonResponse([], true, 200);
      }
      // GET pop oldest pending
      if (u.includes('status=eq.pending')) {
        const best = oldestPending();
        if (!best) return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
        // id = path so the PATCH-visited can find it
        return jsonResponse([{ id: best.path, server_relative_path: best.path, depth: best.row.depth }]);
      }
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
    }

    // ---- folder_feed_seen --------------------------------------------------
    if (u.includes('/rest/v1/folder_feed_seen')) {
      if (method === 'POST') { seenWrites.push(body); return jsonResponse([], true, 201); }
      if (method === 'PATCH') return jsonResponse([], true, 200);
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
    }

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

describe('folder-feed frontier crawl (Slice 2d Unit 1)', () => {
  beforeEach(installFetchMock);
  afterEach(() => { global.fetch = originalFetch; });

  it('descends the tree across ticks (root → subfolder → … → leaf)', async () => {
    // Each tick processes exactly ONE folder (limit_folders=1) so we can watch
    // the cursor descend one level per tick.
    const tick = async () => {
      const res = mockRes();
      await handleFolderFeedTick(mockReq({ source: 'frontier', limit_folders: '1' }), res);
      assert.equal(res._status, 200);
      assert.equal(res._json.source, 'frontier');
      return res._json;
    };

    // Tick 1 — seeds + visits the ROOT, enqueues /D.
    const r1 = await tick();
    assert.equal(r1.frontier.folders_visited, 1);
    assert.equal(frontier.get(ROOT)?.status, 'visited', 'root visited after tick 1');
    assert.equal(frontier.get(`${ROOT}/D`)?.status, 'pending', '/D enqueued pending');

    // Ticks 2-4 descend /D → /D/DaVita → /D/DaVita/Tulsa, OK.
    await tick();
    assert.equal(frontier.get(`${ROOT}/D`)?.status, 'visited', '/D visited after tick 2');
    assert.equal(frontier.get(`${ROOT}/D/DaVita`)?.status, 'pending', '/D/DaVita enqueued');

    await tick();
    assert.equal(frontier.get(`${ROOT}/D/DaVita`)?.status, 'visited');
    assert.equal(frontier.get(SUB)?.status, 'pending', 'leaf city folder enqueued');

    const r4 = await tick();
    assert.equal(frontier.get(SUB)?.status, 'visited', 'leaf folder visited after tick 4');
    // The leaf folder held a file → a folder_feed_seen row was written for it.
    assert.ok(seenWrites.length >= 1, 'leaf file recorded in folder_feed_seen');
    assert.ok(seenWrites.every(r => r.mode === 'enrich'), 'frontier crawl tags enrich');
    assert.equal(r4.frontier.folders_visited, 1);
  });

  it('GET dry-run reports frontier counts without mutating', async () => {
    frontier.set(ROOT, { status: 'pending', depth: 0, seq: seq++ });
    const res = mockRes();
    await handleFolderFeedTick(
      { method: 'GET', url: '/api/folder-feed-tick', headers: {}, query: { source: 'frontier' } },
      res,
    );
    assert.equal(res._status, 200);
    assert.equal(res._json.mode, 'dry_run');
    assert.equal(res._json.frontier.mode, 'enrich');
    // No PATCH/POST mutated the single pending row.
    assert.equal(frontier.get(ROOT)?.status, 'pending');
  });
});
