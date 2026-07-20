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
