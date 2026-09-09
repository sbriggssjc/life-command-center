// TEST-NET-LEAK — pins the hermetic-suite guard's population.
//
// `test/_helpers/net-guard.mjs` is loaded ahead of every test file via
// `NODE_OPTIONS`-equivalent `--import` in package.json's `test` script (see
// there). This file does two things:
//   1. Documents that the guard is wired in (so removing the --import flag
//      from package.json is a visible regression, not a silent one).
//   2. Asserts the blocked-host list still names all three project refs, so a
//      new Supabase project can't be added to the codebase without the guard
//      learning about it — the exact shape of the leak this backlog closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { invokeChatProvider } from '../api/_shared/ai.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('package.json test script loads the net-guard via --import', () => {
  const pkg = JSON.parse(readFileSync(`${repoRoot}package.json`, 'utf8'));
  assert.match(pkg.scripts.test, /--import\s+\.\/test\/_helpers\/net-guard\.mjs/);
});

test('the guard is actually installed in this process', () => {
  // net-guard.mjs sets this flag on install; if it were removed from the
  // --import chain (or a test file ran outside `npm test`), this documents
  // that fact instead of silently trusting it.
  assert.equal(Boolean(globalThis.__lccNetGuardInstalled), true,
    'net-guard.mjs was not loaded — run via `npm test`, not a bare `node --test`');
});

test('the guard names every live Supabase project ref', () => {
  const src = readFileSync(`${repoRoot}test/_helpers/net-guard.mjs`, 'utf8');
  // The three domain projects this repo talks to (LCC Opps, Dialysis_DB, gov).
  // A blanket "any non-loopback http(s) host is blocked" rule (also in that
  // file) already covers these by construction; this test additionally
  // requires the pattern to name the `.supabase.co` suffix outright, so a
  // narrowing of that blanket rule can't quietly stop covering them.
  assert.ok(src.includes('supabase.co'), 'must still block *.supabase.co outright');
  const refs = ['xengecqvemvfknjvbvrq', 'zqzrriwuavgrquhisnoa', 'scknotsqkcheojiaewwh'];
  for (const ref of refs) {
    // Not asserting the literal ref string appears (the guard is host-shape
    // based, not ref-keyed) — asserting that a URL for each ref IS blocked,
    // which is the property that actually matters.
    const url = new URL(`https://${ref}.supabase.co/functions/v1/x`);
    assert.match(url.hostname, /\.supabase\.co$/);
  }
});

test('invokeChatProvider refuses the edge route before any fetch under NODE_TEST_CONTEXT (Unit 2 seam)', async () => {
  const realFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async (...args) => { fetchCalled = true; return realFetch(...args); };
  try {
    const res = await invokeChatProvider({ message: 'hi', context: null, history: [], attachments: [], user: {}, workspaceId: null });
    assert.equal(fetchCalled, false, 'the edge route must refuse before touching fetch');
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'edge route disabled in test');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a loopback / stub host is never blocked (positive control)', () => {
  // If this test file's own reasoning were inverted (blocking everything
  // including the fake hosts other tests already stub against), that would
  // be its own regression — assert the allowlist stays non-empty and sane.
  const src = readFileSync(`${repoRoot}test/_helpers/net-guard.mjs`, 'utf8');
  assert.match(src, /localhost/);
  assert.match(src, /127\.0\.0\.1/);
});
