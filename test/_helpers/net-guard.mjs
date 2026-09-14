// TEST-NET-LEAK — makes `npm test` hermetic.
//
// Measured 2026-09-09: the suite reached production 14 times per run (Dialysis_DB
// `ai-copilot/chat`), because two test files assume "no AI key in the test env →
// the extractor throws" while `api/_shared/ai.js`'s edge route needs NO key — it
// just POSTs to the live function and gets a 400, which the fallback chain
// swallows before the assertion sees it. See docs/claude-code/STATUS.md
// (2026-09-09 TEST-NET-LEAK entry) for the full measurement.
//
// This module is loaded via `NODE_OPTIONS=--import` in package.json's `test`
// script, so it wraps `fetch` for every test file before any test runs. Any
// call to a non-loopback host throws instead of completing — a test that
// still reaches the network fails loudly instead of silently phoning home.
//
// Known production/project hosts a test must never reach. Keep this list in
// sync with test/hermetic-suite.test.mjs.
const BLOCKED_HOST_PATTERNS = [
  /\.supabase\.co$/i,
  /\.railway\.app$/i,
  /(^|\.)salesforce\.com$/i,
  /^api\.openai\.com$/i,
  /^api\.anthropic\.com$/i,
];

// Hosts tests are allowed to hit — real loopback, and the fake hostnames
// already used by stubbed-fetch tests elsewhere in the suite.
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'pa.test.local']);

function isBlocked(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false; // not a URL (e.g. a relative path) — nothing to guard
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (ALLOWED_HOSTS.has(u.hostname)) return false;
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(u.hostname))) return true;
  // General rule: any other non-loopback http(s) host is blocked too, so a
  // NEW production host doesn't need a new pattern to be caught.
  return true;
}

const realFetch = globalThis.fetch;

if (typeof realFetch === 'function' && !globalThis.__lccNetGuardInstalled) {
  globalThis.__lccNetGuardInstalled = true;
  globalThis.fetch = function guardedFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (url && isBlocked(url)) {
      const err = new Error(
        `[net-guard] test attempted a live network call to ${url} — ` +
        `the suite is hermetic (TEST-NET-LEAK, 2026-09-09). Stub fetch or ` +
        `set LCC_HERMETIC_TESTS instead of letting this reach the network.`
      );
      err.code = 'LCC_NET_GUARD_BLOCKED';
      throw err;
    }
    return realFetch(input, init);
  };
}

// Also flip the explicit hermetic-tests flag `api/_shared/ai.js` checks, so
// the AI extraction seam refuses BEFORE attempting a fetch at all (belt and
// suspenders — the guard above still catches anything that slips past it,
// or any other unguarded caller).
process.env.LCC_HERMETIC_TESTS = process.env.LCC_HERMETIC_TESTS || '1';
