// SPEC_forsale_om_and_webpage_ingest.md Part B2 — listing-page crawl worker.
// Pure-fn tests (classifyAvailability, sha256Hex) + the deps-injected core
// (performListingPageCrawl) with stubbed opsQuery / fetchImpl / storagePut.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'k';

const {
  classifyAvailability, sha256Hex, performListingPageCrawl,
} = await import('../api/_handlers/listing-page-crawl.js');

// A minimal Response-like object for the injected fetchImpl.
function fakeRes({ ok = true, status = 200, body = '<html>available</html>' } = {}) {
  return { ok, status, text: async () => body };
}

// A recording opsQuery stub. `snapshots` seeds the prior-hash dedup read.
function recordingOps({ pages = [], priorHash = null } = {}) {
  const calls = { get: [], post: [], patch: [] };
  const q = async (method, path, body, opts) => {
    if (method === 'GET' && path.startsWith('v_lcc_listing_page_crawl_worklist')) {
      calls.get.push({ path });
      return { ok: true, status: 200, data: pages };
    }
    if (method === 'GET' && path.startsWith('lcc_listing_page_snapshots')) {
      calls.get.push({ path });
      return { ok: true, status: 200, data: priorHash != null ? [{ content_hash: priorHash }] : [] };
    }
    if (method === 'POST') { calls.post.push({ path, body }); return { ok: true, status: 201, data: null }; }
    if (method === 'PATCH') { calls.patch.push({ path, body }); return { ok: true, status: 200, data: null }; }
    return { ok: true, status: 200, data: null };
  };
  return { q, calls };
}

describe('classifyAvailability (pure)', () => {
  it('404 → unavailable', () => {
    assert.equal(classifyAvailability(404, '<html>whatever</html>'), 'unavailable');
    assert.equal(classifyAvailability(410, ''), 'unavailable');
  });
  it('2xx + SOLD marker → likely_unavailable', () => {
    assert.equal(classifyAvailability(200, '<h1>This property is SOLD</h1>'), 'likely_unavailable');
    assert.equal(classifyAvailability(200, 'now under contract'), 'likely_unavailable');
  });
  it('normal 200 html → available', () => {
    assert.equal(classifyAvailability(200, '<html><body>For sale, great deal</body></html>'), 'available');
  });
  it('non-2xx/non-404 → unknown', () => {
    assert.equal(classifyAvailability(302, ''), 'unknown');
    assert.equal(classifyAvailability(null, ''), 'unknown');
  });
});

describe('sha256Hex (pure, known vector)', () => {
  it('sha256("abc")', () => {
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('stable + deterministic', () => {
    assert.equal(sha256Hex('<html>available</html>'), sha256Hex('<html>available</html>'));
  });
});

describe('performListingPageCrawl (core, stubbed deps)', () => {
  const page = { id: 7, domain: 'gov', property_id: 16500, url: 'https://bouldergroup.com/listing/7', last_availability: null, consecutive_failures: 0 };

  it('crawls a due page: stores 1, inserts snapshot, updates registry, honest counts', async () => {
    const { q, calls } = recordingOps({ pages: [page] });
    const putCalls = [];
    const out = await performListingPageCrawl({}, {
      opsQuery: q,
      fetchImpl: async () => fakeRes({ status: 200, body: '<html>available</html>' }),
      storagePut: async (bucket, path, bytes, ct) => { putCalls.push({ bucket, path, ct, len: bytes.length }); return { ok: true, status: 200 }; },
      now: () => new Date('2026-07-31T12:00:00Z'),
    });

    assert.equal(out.ok, true);
    assert.equal(out.scanned, 1);
    assert.equal(out.crawled, 1);
    assert.equal(out.unchanged, 0);
    assert.equal(out.unavailable, 0);
    assert.equal(out.retired, 0);
    assert.deepEqual(out.failures, []);

    // Stored once, path keyed on domain/property/page/hash.
    assert.equal(putCalls.length, 1);
    assert.equal(putCalls[0].bucket, 'listing-page-snapshots');
    assert.match(putCalls[0].path, /^gov\/16500\/7\/[0-9a-f]{64}\.html$/);

    // Snapshot inserted + registry re-scheduled 7 days out (available).
    assert.equal(calls.post.length, 1);
    assert.equal(calls.post[0].body.availability, 'available');
    assert.equal(calls.patch.length, 1);
    assert.equal(calls.patch[0].body.consecutive_failures, 0);
    assert.equal(calls.patch[0].body.last_availability, 'available');
    assert.equal(new Date(calls.patch[0].body.next_crawl_at).toISOString(), '2026-08-07T12:00:00.000Z');
  });

  it('fetch throws → failure counted, registry failure path, sweep does not throw', async () => {
    const { q, calls } = recordingOps({ pages: [page] });
    let putCalled = false;
    const out = await performListingPageCrawl({}, {
      opsQuery: q,
      fetchImpl: async () => { throw new Error('ECONNRESET'); },
      storagePut: async () => { putCalled = true; return { ok: true }; },
      now: () => new Date('2026-07-31T12:00:00Z'),
    });

    assert.equal(out.ok, true);           // sweep completes, never throws
    assert.equal(out.scanned, 1);
    assert.equal(out.crawled, 0);
    assert.equal(out.failures.length, 1);
    assert.equal(out.failures[0].id, 7);
    assert.equal(out.retired, 0);         // 1 failure, below the retire threshold
    assert.equal(putCalled, false);       // no store on failure
    // Registry patched with the incremented failure count + 1-day retry.
    assert.equal(calls.patch.length, 1);
    assert.equal(calls.patch[0].body.consecutive_failures, 1);
    assert.equal(new Date(calls.patch[0].body.next_crawl_at).toISOString(), '2026-08-01T12:00:00.000Z');
  });

  it('auto-retire: 5th consecutive failure sets active=false', async () => {
    const nearRetire = { ...page, consecutive_failures: 4 };
    const { q, calls } = recordingOps({ pages: [nearRetire] });
    const out = await performListingPageCrawl({}, {
      opsQuery: q,
      fetchImpl: async () => fakeRes({ ok: false, status: 503, body: '' }),
      storagePut: async () => ({ ok: true }),
    });
    assert.equal(out.retired, 1);
    assert.equal(calls.patch[0].body.active, false);
    assert.equal(calls.patch[0].body.consecutive_failures, 5);
  });

  it('unchanged content_hash → unchanged++, storagePut NOT called, no snapshot insert', async () => {
    const html = '<html>available</html>';
    const priorHash = sha256Hex(html);
    const { q, calls } = recordingOps({ pages: [page], priorHash });
    let putCalled = false;
    const out = await performListingPageCrawl({}, {
      opsQuery: q,
      fetchImpl: async () => fakeRes({ status: 200, body: html }),
      storagePut: async () => { putCalled = true; return { ok: true }; },
      now: () => new Date('2026-07-31T12:00:00Z'),
    });

    assert.equal(out.crawled, 0);
    assert.equal(out.unchanged, 1);
    assert.equal(putCalled, false);
    assert.equal(calls.post.length, 0);   // no snapshot insert
    assert.equal(calls.patch.length, 1);  // registry still refreshed
  });
});
