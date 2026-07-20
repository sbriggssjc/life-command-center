#!/usr/bin/env node
// verify-deploy.mjs — the one-command deploy gate.
//
// Why this exists (2026-07-20 incident): four "the _route dispatch regressed"
// bugs were actually four unshipped Railway deploys. Nothing in CI or the repo
// caught it — `test/operations-subroutes.test.mjs` guards the REPO dispatch and
// passes green forever while production serves week-old code. And a GET to an
// unmounted /api/* path returned the SPA HTML with a 200, so every "is the route
// live?" check that read a status code was lied to.
//
// This script compares the LIVE deploy to the repo:
//   1. Fetch <BASE>/version and compare its `version` (the deployed commit, 12
//      chars) against the local `git rev-parse HEAD` (or --sha for CI's merge SHA).
//      A mismatch = the deploy is stale (the real root cause).
//   2. GET each critical route and assert the response is JSON, not the SPA HTML.
//      With the server.js API-scoped 404 in place, a missing route returns a real
//      JSON 404; an HTML body means either that fix isn't deployed or the SPA
//      catch-all is still masking the route.
//
// Exit 0 = deploy matches the repo AND the anti-masking fix is live.
// Exit non-zero = SHA mismatch or any critical route returned HTML.
//
// Usage:
//   node scripts/verify-deploy.mjs [--url <base>] [--sha <sha>] [--timeout <ms>]
//   npm run verify:deploy

import { execSync } from 'node:child_process';
import { CRITICAL_SUBROUTES } from '../test/critical-subroutes.mjs';

const DEFAULT_URL = 'https://tranquil-delight-production-633f.up.railway.app';

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, sha: null, timeout: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--sha') args.sha = argv[++i];
    else if (a === '--timeout') args.timeout = parseInt(argv[++i], 10) || args.timeout;
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function localSha() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function bodyLooksLikeHtml(text, contentType) {
  if (contentType && contentType.toLowerCase().includes('text/html')) return true;
  const head = (text || '').trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<head');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/verify-deploy.mjs [--url <base>] [--sha <sha>] [--timeout <ms>]');
    process.exit(0);
  }
  const base = args.url.replace(/\/+$/, '');
  const expectedSha = args.sha || localSha();
  const failures = [];

  console.log(`▶ Verifying deploy at ${base}`);

  // 1) /version — deployed commit must match the repo/merge SHA.
  let deployed = null;
  try {
    const res = await fetchWithTimeout(`${base}/version`, { headers: { accept: 'application/json' } }, args.timeout);
    const text = await res.text();
    if (!res.ok) {
      failures.push(`GET /version returned HTTP ${res.status}`);
    } else {
      try {
        deployed = JSON.parse(text);
      } catch {
        failures.push(`GET /version did not return JSON (got: ${text.slice(0, 120)})`);
      }
    }
  } catch (err) {
    failures.push(`GET /version failed: ${err.message}`);
  }

  if (deployed) {
    const live = String(deployed.version || '');
    console.log(`  live version: ${live} (source: ${deployed.source}, git_pinned: ${deployed.git_pinned})`);
    if (!expectedSha) {
      console.log('  ⚠ could not resolve a local SHA (not a git checkout, no --sha) — skipping SHA comparison');
    } else if (deployed.git_pinned === false) {
      failures.push(`deploy is NOT git-pinned (source=${deployed.source}) — cannot confirm it matches ${expectedSha.slice(0, 12)}`);
    } else if (!expectedSha.startsWith(live) && !live.startsWith(expectedSha)) {
      failures.push(`SHA MISMATCH: live=${live} vs repo=${expectedSha.slice(0, 12)} — the deploy is stale (unshipped merges)`);
    } else {
      console.log(`  ✓ SHA matches repo (${expectedSha.slice(0, 12)})`);
    }
  }

  // 2) Critical routes must respond with JSON, not the SPA HTML (proves the
  //    API-scoped 404 fix is live and no route falls through to index.html).
  for (const route of CRITICAL_SUBROUTES) {
    const url = `${base}/api/${route}`;
    try {
      const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, args.timeout);
      const text = await res.text();
      if (bodyLooksLikeHtml(text, res.headers.get('content-type'))) {
        failures.push(`GET /api/${route} returned HTML (status ${res.status}) — SPA catch-all is masking the route / fix not deployed`);
      } else {
        console.log(`  ✓ /api/${route} → JSON (HTTP ${res.status})`);
      }
    } catch (err) {
      failures.push(`GET /api/${route} failed: ${err.message}`);
    }
  }

  if (failures.length) {
    console.error('\n✖ Deploy verification FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n✓ Deploy verification passed — live deploy matches the repo.');
}

main().catch((err) => {
  console.error(`✖ verify-deploy crashed: ${err.stack || err.message}`);
  process.exit(2);
});
