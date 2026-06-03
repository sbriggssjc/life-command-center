// QA#5 + QA#7 — global fetch interceptor in auth.js.
//
// Covers the two resilience behaviors added to the window.fetch patch:
//   * transient 5xx retry for GET /api/ requests (502/503/504 + network throw)
//   * coalescing of concurrent identical GET /api/ requests
//
// auth.js is browser code (no exports). We stub the minimal browser globals
// it touches, then drive the patched window.fetch directly. A swappable
// `impl` lets each test control what the underlying fetch returns.

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// --- Minimal browser global stubs (must exist before importing auth.js) ---
let impl = async () => mockResp(200);

function mockResp(status, tag) {
  return {
    status,
    ok: status >= 200 && status < 300,
    _tag: tag,
    clone() { return mockResp(status, tag); }
  };
}

globalThis.location = { origin: 'https://app.example.com' };
globalThis.window = {
  fetch: (...args) => impl(...args), // stable dispatcher captured as _originalFetch
};
// Mirror the document/LCC_USER absence — the interceptor guards with typeof.

let patchedFetch;

before(async () => {
  await import('../auth.js'); // side effect: patches window.fetch
  patchedFetch = globalThis.window.fetch;
});

describe('auth.js global fetch interceptor — retry', () => {
  beforeEach(() => { impl = async () => mockResp(200); });

  it('retries a GET /api/ request on 503 and returns the eventual 200', async () => {
    let calls = 0;
    impl = async () => {
      calls += 1;
      return calls < 3 ? mockResp(503) : mockResp(200, 'recovered');
    };
    const resp = await patchedFetch('/api/treasury?history=true');
    assert.equal(resp.status, 200);
    assert.equal(resp._tag, 'recovered');
    assert.equal(calls, 3, 'two retries after the initial failure');
  });

  it('retries on a network throw then resolves', async () => {
    let calls = 0;
    impl = async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      return mockResp(200, 'ok-after-throw');
    };
    const resp = await patchedFetch('/api/queue-v2?view=work_counts');
    assert.equal(resp.status, 200);
    assert.equal(calls, 2);
  });

  it('returns the last 5xx when retries are exhausted', async () => {
    let calls = 0;
    impl = async () => { calls += 1; return mockResp(504); };
    const resp = await patchedFetch('/api/admin?_route=auth-config');
    assert.equal(resp.status, 504);
    assert.equal(calls, 3, 'initial + 2 retries');
  });

  it('never retries a non-GET request', async () => {
    let calls = 0;
    impl = async () => { calls += 1; return mockResp(503); };
    const resp = await patchedFetch('/api/intake', { method: 'POST' });
    assert.equal(resp.status, 503);
    assert.equal(calls, 1, 'POST is dispatched exactly once');
  });

  it('does not touch non-/api/ URLs', async () => {
    let calls = 0;
    impl = async () => { calls += 1; return mockResp(503); };
    const resp = await patchedFetch('https://cdn.example.com/lib.js');
    assert.equal(resp.status, 503);
    assert.equal(calls, 1);
  });
});

describe('auth.js global fetch interceptor — coalescing', () => {
  beforeEach(() => { impl = async () => mockResp(200); });

  it('collapses concurrent identical GET /api/ requests to one network call', async () => {
    let calls = 0;
    impl = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return mockResp(200, 'shared');
    };
    const [a, b, c] = await Promise.all([
      patchedFetch('/api/queue-v2?view=work_counts'),
      patchedFetch('/api/queue-v2?view=work_counts'),
      patchedFetch('/api/queue-v2?view=work_counts'),
    ]);
    assert.equal(calls, 1, 'three concurrent callers → one underlying fetch');
    // Each consumer gets its own clone (distinct object), same payload.
    assert.notEqual(a, b);
    assert.equal(a._tag, 'shared');
    assert.equal(c.status, 200);
  });

  it('does not coalesce different URLs', async () => {
    let calls = 0;
    impl = async () => { calls += 1; return mockResp(200); };
    await Promise.all([
      patchedFetch('/api/admin?_route=auth-config'),
      patchedFetch('/api/admin?_route=treasury'),
    ]);
    assert.equal(calls, 2);
  });

  it('issues a fresh network call once the in-flight request settles', async () => {
    let calls = 0;
    impl = async () => { calls += 1; return mockResp(200); };
    await patchedFetch('/api/admin?_route=review-counts');
    await patchedFetch('/api/admin?_route=review-counts');
    assert.equal(calls, 2, 'sequential calls are not coalesced');
  });

  it('does not coalesce non-GET requests', async () => {
    let calls = 0;
    impl = async () => { calls += 1; return mockResp(200); };
    await Promise.all([
      patchedFetch('/api/intake', { method: 'POST' }),
      patchedFetch('/api/intake', { method: 'POST' }),
    ]);
    assert.equal(calls, 2);
  });
});
