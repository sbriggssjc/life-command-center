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
// CACHE DEFENSE (2026-07-20): a gate that exists to detect staleness must not
// itself be fed a cached response. `/version` sets `Cache-Control: no-store`, yet
// something between us and origin (client / proxy / CDN) served a byte-identical
// copy — INCLUDING the `ts` — twice, nearly reporting a current deploy as stale.
// So every request here appends a unique `?_cb=<ts>-<uuid>` cache-buster and
// sends `Cache-Control: no-cache` + `Pragma: no-cache`; and `/version` is read
// TWICE — identical `ts` across two distinct-URL reads proves a cache is in the
// path, so we fail loudly ("cached /version") instead of trusting the SHA.
//
// Exit 0 = deploy matches the repo AND the anti-masking fix is live.
// Exit non-zero = SHA mismatch, a cached /version response, or any critical route
//                 returned HTML.
//
// Usage:
//   node scripts/verify-deploy.mjs [--url <base>] [--sha <sha>] [--timeout <ms>] [--wait[=sec]]
//   npm run verify:deploy

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CRITICAL_SUBROUTES, CRITICAL_ROUTES_NON_OPERATIONS } from '../test/critical-subroutes.mjs';

// Append a unique cache-buster so no URL-keyed cache (client/proxy/CDN) can serve
// a stale copy. Query param is what actually defeated the cache in the incident.
function withCacheBust(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_cb=${Date.now()}-${randomUUID()}`;
}

// Request headers: no-cache (belt to the query-param braces). Callers add accept.
const NOCACHE_HEADERS = { 'cache-control': 'no-cache', pragma: 'no-cache' };

const DEFAULT_URL = 'https://tranquil-delight-production-633f.up.railway.app';

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, sha: null, timeout: 15000, wait: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--sha') args.sha = argv[++i];
    else if (a === '--timeout') args.timeout = parseInt(argv[++i], 10) || args.timeout;
    // --wait[=seconds] — poll /version until it matches, for the interactive
    // push→verify loop where Railway is still building. Bare --wait = 180s.
    else if (a === '--wait') args.wait = 180;
    else if (a.startsWith('--wait=')) args.wait = parseInt(a.slice(7), 10) || 180;
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
    console.log('Usage: node scripts/verify-deploy.mjs [--url <base>] [--sha <sha>] [--timeout <ms>] [--wait[=sec]]');
    console.log('  --wait[=sec]  poll /version until it matches the repo SHA (default 180s).');
    console.log('                For the interactive push→verify loop; CI should NOT use it.');
    process.exit(0);
  }
  const base = args.url.replace(/\/+$/, '');
  const expectedSha = args.sha || localSha();
  const failures = [];

  console.log(`▶ Verifying deploy at ${base}`);

  // 1) /version — deployed commit must match the repo/merge SHA.
  //    Read it TWICE with distinct cache-busters and assert freshness: identical
  //    `ts` across two live reads is impossible (the endpoint stamps Date.now()
  //    per request), so identical `ts` == a cached response we cannot trust.
  async function readVersion() {
    try {
      const res = await fetchWithTimeout(
        withCacheBust(`${base}/version`),
        { headers: { accept: 'application/json', ...NOCACHE_HEADERS } },
        args.timeout,
      );
      const text = await res.text();
      if (!res.ok) return { error: `HTTP ${res.status}` };
      try {
        return { json: JSON.parse(text) };
      } catch {
        return { error: `did not return JSON (got: ${text.slice(0, 120)})` };
      }
    } catch (err) {
      return { error: err.message };
    }
  }

  let deployed = null;
  const readA = await readVersion();
  if (readA.error) {
    failures.push(`GET /version failed: ${readA.error}`);
  } else {
    deployed = readA.json;
    // Freshness: a second read with a different cache-buster must return a
    // different `ts`. Same `ts` ⇒ a cache served both ⇒ the whole comparison is
    // suspect. Best-effort: if the second read can't be obtained we warn but
    // still compare (the buster already defeated a URL-keyed cache for read A).
    const readB = await readVersion();
    if (readB.json) {
      const tsA = readA.json.ts, tsB = readB.json.ts;
      if (tsA != null && tsB != null && tsA === tsB) {
        failures.push(
          `got a cached /version response (identical ts=${tsA} across two distinct-URL reads) — cannot verify deploy`,
        );
      } else {
        console.log('  ✓ /version is live (two reads returned distinct ts — not cached)');
      }
    } else {
      console.log(`  ⚠ could not obtain a second /version read (${readB.error}) — freshness unconfirmed`);
    }
  }

  if (deployed) {
    const live = String(deployed.version || '');
    console.log(`  live version: ${live} (source: ${deployed.source}, git_pinned: ${deployed.git_pinned})`);
    if (!expectedSha) {
      console.log('  ⚠ could not resolve a local SHA (not a git checkout, no --sha) — skipping SHA comparison');
    } else if (deployed.git_pinned === false) {
      failures.push(`deploy is NOT git-pinned (source=${deployed.source}) — cannot confirm it matches ${expectedSha.slice(0, 12)}`);
    } else if (!expectedSha.startsWith(live) && !live.startsWith(expectedSha)) {
      // --wait: poll until Railway finishes rebuilding, instead of failing on a
      // race. Running this straight after `git push` reported a stale deploy
      // twice on 2026-08-20 when Railway was simply still building — the hard
      // fail is right for CI, wrong for the interactive push→verify loop.
      // Default stays hard-fail: you must ASK to wait.
      let matched = false;
      if (args.wait > 0) {
        const deadline = Date.now() + args.wait * 1000;
        process.stdout.write(`  ⏳ live=${live} != repo=${expectedSha.slice(0, 12)} — waiting up to ${args.wait}s for the rebuild`);
        while (Date.now() < deadline && !matched) {
          await new Promise((r) => setTimeout(r, 5000));
          process.stdout.write('.');
          const again = await readVersion();
          const now = String((again.json && again.json.version) || '');
          if (now && (expectedSha.startsWith(now) || now.startsWith(expectedSha))) matched = true;
        }
        console.log('');
      }
      if (matched) {
        console.log(`  ✓ SHA matches repo (${expectedSha.slice(0, 12)}) — after waiting for the rebuild`);
      } else {
        failures.push(`SHA MISMATCH: live=${live} vs repo=${expectedSha.slice(0, 12)} — the deploy is stale (unshipped merges)`
          + (args.wait > 0 ? ` [still stale after ${args.wait}s — this is NOT a build race]` : ' [if you just pushed, Railway may still be building: re-run with --wait]'));
      }
    } else {
      console.log(`  ✓ SHA matches repo (${expectedSha.slice(0, 12)})`);
    }
  }

  // 2) Critical routes must respond with JSON, not the SPA HTML (proves the
  //    API-scoped 404 fix is live and no route falls through to index.html).
  //    Cache-busted + no-cache so a cached 200 can't mask a currently-missing
  //    route (the same masking risk the /version freshness check covers).
  for (const route of [...CRITICAL_SUBROUTES, ...CRITICAL_ROUTES_NON_OPERATIONS]) {
    const url = `${base}/api/${route}`;
    try {
      const res = await fetchWithTimeout(
        withCacheBust(url),
        { headers: { accept: 'application/json', ...NOCACHE_HEADERS } },
        args.timeout,
      );
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

  // 3) EVERY classic <script src> in index.html must actually be served as JS.
  //    W6.5 decomposition ADDS front-end files (dc-lanes.js, detail-rent.js, …).
  //    A newly-added file that does not ship 404s in the browser and every symbol
  //    it defines is undefined at call time — the app breaks — while checks (1)
  //    and (2) stay green, because they only ever probe /version and /api/*.
  //    Found the hard way on 2026-08-20: detail-rent.js had to be curl'd by hand
  //    to confirm it was live, because nothing in this gate looked at it.
  //    The SPA catch-all makes this extra sneaky — a missing .js can come back
  //    HTTP 200 with index.html in the body, so assert on the BODY, not status.
  const scriptSrcs = [...readFileSync('index.html', 'utf8')
    .matchAll(/<script\s+src="([^"?]+\.js)(\?[^"]*)?"/gi)]
    .map((m) => m[1])
    .filter((src) => !/^https?:\/\//i.test(src));   // CDN scripts are not ours
  for (const src of scriptSrcs) {
    const url = `${base}/${src.replace(/^\.?\//, '')}`;
    try {
      const res = await fetchWithTimeout(
        withCacheBust(url), { headers: { ...NOCACHE_HEADERS } }, args.timeout,
      );
      const text = await res.text();
      const ctype = res.headers.get('content-type') || '';
      if (!res.ok) {
        failures.push(`GET /${src} → HTTP ${res.status} — a <script> in index.html is NOT deployed`);
      } else if (bodyLooksLikeHtml(text, ctype)) {
        failures.push(`GET /${src} returned HTML — the SPA catch-all is masking a MISSING script file`);
      } else {
        console.log(`  ✓ /${src} served (${(text.length / 1024).toFixed(0)} KB)`);
      }
    } catch (err) {
      failures.push(`GET /${src} failed: ${err.message}`);
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
