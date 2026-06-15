// Multi-tenant deal-folder contamination guard (2026-06-15).
//
// Drives the REAL handler (handleFolderFeedTick) on the enrich channel and
// asserts the Unit-1 folder-class gate: a LEASE living under a /Multi/ (or
// /Portfolio/) deal folder is NEVER promoted to a domain lease (no extraction,
// no create/fill). It is parked as a non-promoting outcome
// (status='skipped', detected_type='multitenant_deferred') surfaced for
// mis-ingestion review — the Hertz-in-"DaVita Anchored - Springfield, IL" case.
//
// Env set BEFORE import (auth.js / db helpers capture *_SUPABASE_URL at load).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const LIST_URL = 'https://pa.example.com/list-folder';
// Comma-free folder so ?folders= (comma-separated) targets it directly; the
// /Multi/ segment is what trips the guard regardless of the deeper folders.
const MULTI_DIR = '/sites/TeamBriggs20/Shared Documents/PROPERTIES/Multi';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';
process.env.SHAREPOINT_LIST_URL = LIST_URL;
process.env.EXTRACT_RACE_MS = '1000';
delete process.env.LCC_ENV;
delete process.env.SHAREPOINT_FETCH_URL;
delete process.env.FOLDER_FEED_ENRICH_ROOTS;

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

// A genuine co-tenant lease sitting in a multi-tenant deal folder.
function listingItems(root) {
  return [{ Name: 'Hertz - First Amendment to Lease - 2936 S 6th St Springfield IL.pdf',
    ServerRelativeUrl: `${root}/Hertz - First Amendment to Lease - 2936 S 6th St Springfield IL.pdf`,
    Length: '2000', ETag: 'etag-hertz' }];
}

let seenRows;  // folder_feed_seen POST bodies
function installFetchMock() {
  seenRows = [];
  let postId = 0;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u === LIST_URL) {
      const folder = (JSON.parse(opts.body || '{}').folder_path || '').replace(/''/g, "'");
      return jsonResponse({ ok: true, value: listingItems(folder) });
    }
    if (u.includes('/rest/v1/folder_feed_seen')) {
      if (method === 'POST') { seenRows.push(JSON.parse(opts.body || '{}')); return jsonResponse([], true, 201); }
      if (method === 'PATCH') return jsonResponse([], true, 200);
      return jsonResponse([], true, 200, { 'content-range': '0-0/0' });
    }
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
const mockReq = (query, method = 'POST') => ({ method, url: '/api/folder-feed-tick', headers: {}, query });

describe('folder-feed multi-tenant deal-folder guard', () => {
  beforeEach(installFetchMock);
  afterEach(() => { global.fetch = originalFetch; });

  it('a lease under /Multi/ is parked (skipped/multitenant_deferred), never promoted', async () => {
    const res = mockRes();
    await handleFolderFeedTick(mockReq({ folders: MULTI_DIR, mode: 'enrich', lease_extract: '1' }), res);

    assert.equal(res._status, 200);
    assert.equal(res._json.files_staged || 0, 0, 'nothing staged');
    assert.equal(res._json.files_attached || 0, 0, 'no domain lease attach');
    const lease = seenRows.find(r => /Hertz/.test(r.server_relative_path || ''));
    assert.ok(lease, 'the Hertz lease was recorded');
    assert.equal(lease.status, 'skipped');
    assert.equal(lease.detected_type, 'multitenant_deferred');
    assert.equal(lease.subject_hint?.skip_reason, 'multitenant_deal_folder');
  });

  it('dry-run reports the lease as skipped, writes nothing', async () => {
    const res = mockRes();
    await handleFolderFeedTick(mockReq({ folders: MULTI_DIR, mode: 'enrich', lease_extract: '1' }, 'GET'), res);

    assert.equal(res._status, 200);
    assert.equal(res._json.mode, 'dry_run');
    assert.equal(res._json.files_staged || 0, 0);
    assert.equal(res._json.files_attached || 0, 0);
    assert.equal(seenRows.length, 0, 'dry-run wrote no folder_feed_seen rows');
  });
});
