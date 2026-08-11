// Single source of truth for the critical `_route` sub-routes — the recurring
// regression set (PR #1408/#1410/#1414/#1415). Imported by BOTH the repo-dispatch
// guard (test/operations-subroutes.test.mjs) AND the deploy gate
// (scripts/verify-deploy.mjs) so the list is never duplicated. Kept in a plain
// data module (no node:test side effects) so the script can import it without
// running the test suite.
export const CRITICAL_SUBROUTES = [
  'sf-list-import',
  'sf-account-import',
  'sf-contact-resolve-tick',
  'owner-reconcile-tick',
  'owner-reconcile-engine-tick',
  'institution-contact-tick',
];

// Critical routes that must be probed by the deploy gate but dispatch OUTSIDE
// api/operations.js — so they must NOT go in CRITICAL_SUBROUTES. The dispatch
// guard (test/operations-subroutes.test.mjs) asserts every CRITICAL_SUBROUTES
// entry has a matching `req.query._route === '<x>'` dispatch in operations.js;
// a route that lives in another handler would fail that assertion. The deploy
// gate (scripts/verify-deploy.mjs) probes BOTH lists identically (GET
// /api/<name>, assert JSON-not-HTML), since staleness is a per-route property
// regardless of which handler serves it.
//   - intake-sf-cis → server.js mounts it onto intakeHandler with
//     `_route = 'sf-cis'` (dispatched by api/intake.js case 'sf-cis').
export const CRITICAL_ROUTES_NON_OPERATIONS = [
  'intake-sf-cis',
  'pipeline/ingest-deal-parties',
  'pipeline/ingest-deal-contacts',
];
