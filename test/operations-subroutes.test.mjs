// SUBROUTE-DISPATCH GUARD — this test guards the REPO dispatch only. It does NOT
// verify what is deployed; deploy verification is `scripts/verify-deploy.mjs`
// (compares live /version to the merge SHA + probes that critical routes return
// JSON, not the SPA HTML). The two are complementary: a stale deploy (the real
// 2026-07-20 root cause — four unshipped merges misdiagnosed as dispatch
// regressions) passes this test but fails verify-deploy.
//
// A recurring regression (PR #1408 sf-contact-resolve-tick, PR #1410 three routes,
// PR #1414 sf-list-import, and again after) is that a stale-branch merge reverts
// api/operations.js to a state predating one or more `_route` sub-route dispatches,
// WHILE server.js still mounts those routes into operationsHandler with the `_route`
// query param. With the mount but no matching dispatch, a POST falls through to the
// bridge POST-action `switch` and 400s "Invalid POST action" — exactly the symptom
// the "SF Get Campaign Members" PA flow hit on POST /api/sf-list-import.
//
// This test makes server.js the single source of truth: every `_route` value it
// routes into operationsHandler MUST have a matching dispatch in operations.js,
// positioned BEFORE the bridge action router. If a merge drops a dispatch (or adds
// a mount without one), CI fails here instead of production 400ing silently.
// (Vercel was retired 2026-07-20 — vercel.json is deleted; server.js is the sole
// routing source of truth.)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CRITICAL_SUBROUTES } from './critical-subroutes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

// CRITICAL_SUBROUTES — the routes the task/regression class explicitly names,
// asserted by name too so dropping one from BOTH server.js and operations.js still
// fails (belt + suspenders). Lives in ./critical-subroutes.mjs so the deploy gate
// (scripts/verify-deploy.mjs) can share the exact same list without importing this
// test module (which would run the suite as a side effect).

// Every `_route` value server.js routes into operationsHandler. Matched per-line:
// each mount is a single-line `app.all(..., _route = '<x>'; ... operationsHandler)`.
function serverMountedRoutes() {
  const routes = new Set();
  for (const line of read('server.js').split('\n')) {
    if (!line.includes('operationsHandler')) continue;
    const m = line.match(/req\.query\._route\s*=\s*'([a-z0-9-]+)'/);
    if (m) routes.add(m[1]);
  }
  return routes;
}

// The `_route` values operations.js dispatches, with the source index of each
// `if (req.query._route === '<x>')` check (for the ordering assertion).
function operationsDispatches() {
  const src = read('api/operations.js');
  const map = new Map();
  const re = /req\.query\._route\s*===\s*'([a-z0-9-]+)'/g;
  let m;
  while ((m = re.exec(src))) {
    if (!map.has(m[1])) map.set(m[1], m.index); // first (dispatch) occurrence
  }
  return map;
}

// Index of the bridge POST-action router's "Invalid POST action" default — a
// `_route` dispatch positioned after this point never runs before the fall-through.
function bridgeRouterIndex() {
  const src = read('api/operations.js');
  // Anchor on the FULL default literal ("… Bridge: …"), not the bare phrase — the
  // guard comment blocks above the dispatches also mention "Invalid POST action".
  const idx = src.indexOf('Invalid POST action. Bridge');
  assert.ok(idx > 0, 'could not find the bridge-action "Invalid POST action. Bridge:" default');
  return idx;
}

describe('operations.js sub-route dispatch guard', () => {
  it('every server.js-mounted _route has a dispatch in operations.js', () => {
    const mounted = serverMountedRoutes();
    const dispatched = operationsDispatches();
    assert.ok(mounted.size >= 10, `server.js mounted-route set looks too small (${mounted.size})`);
    const missing = [...mounted].filter((r) => !dispatched.has(r));
    assert.deepEqual(
      missing,
      [],
      `server.js routes these into operationsHandler but operations.js has no ` +
        `\`req.query._route === '<x>'\` dispatch — POSTs would 400 "Invalid POST action": ${missing.join(', ')}`,
    );
  });

  it('every mounted dispatch is positioned BEFORE the bridge action router', () => {
    const mounted = serverMountedRoutes();
    const dispatched = operationsDispatches();
    const bridge = bridgeRouterIndex();
    const late = [...mounted].filter((r) => (dispatched.get(r) ?? Infinity) >= bridge);
    assert.deepEqual(
      late,
      [],
      `these _route dispatches must appear before the bridge action router, else ` +
        `the POST falls through to "Invalid POST action": ${late.join(', ')}`,
    );
  });

  it('the explicitly-named critical sub-routes are all dispatched (regression set)', () => {
    const dispatched = operationsDispatches();
    const bridge = bridgeRouterIndex();
    for (const r of CRITICAL_SUBROUTES) {
      assert.ok(dispatched.has(r), `operations.js is missing the '${r}' _route dispatch`);
      assert.ok(
        dispatched.get(r) < bridge,
        `the '${r}' _route dispatch must come before the bridge action router`,
      );
    }
  });

  it('server.js mounts every critical sub-route (it is the sole routing source of truth)', () => {
    const server = read('server.js');
    for (const r of CRITICAL_SUBROUTES) {
      assert.ok(server.includes(`/api/${r}'`), `server.js does not mount /api/${r}`);
    }
  });
});
