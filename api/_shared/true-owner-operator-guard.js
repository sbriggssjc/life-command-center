// api/_shared/true-owner-operator-guard.js
// ============================================================================
// PDR2 (2026-09-14) — the single, shared definition of "is this domain
// true_owners row an OPERATOR/TENANT, not the landlord" (P113: dia files the
// tenant in the owner slot at scale — measured 2026-09-14, 7,937 dia
// properties resolve true_owner_id -> an operator-flagged row, of which
// 4,022 also have recorded_owner_id NULL).
//
// This mirrors two pre-existing, independently-written copies of the same
// predicate (api/_handlers/entities-handler.js §1.6 read only
// `is_operator_not_owner`; api/_handlers/sf-link-reconcile.js::isOperator()
// OR'd all three signals). Extracted here so there is ONE definition instead
// of a third divergent copy — never re-derive this inline.
//
// gov's `true_owners` table has NO `is_operator_not_owner` / `owner_type`
// column at all (confirmed live 2026-09-14) — only `owner_role`. Selecting a
// nonexistent column 400s PostgREST, so `trueOwnerOperatorSelectFields` is
// domain-scoped and the predicate itself degrades to reading whichever
// signals are present on the row (never throws on a missing key).
// ============================================================================

// Columns to request from `true_owners` per domain so a caller doesn't 400
// PostgREST by asking gov for a column it doesn't have.
const TRUE_OWNER_OPERATOR_SELECT_FIELDS = {
  dia: 'is_operator_not_owner,owner_type,owner_role',
  dialysis: 'is_operator_not_owner,owner_type,owner_role',
  gov: 'owner_role',
  government: 'owner_role',
};

export function trueOwnerOperatorSelectFields(domain) {
  return TRUE_OWNER_OPERATOR_SELECT_FIELDS[domain] || 'owner_role';
}

// The shared predicate. Accepts a partial true_owners row (any subset of the
// three signal columns — undefined/missing keys are simply not true) and
// NEVER throws.
export function isTrueOwnerOperator(row) {
  if (!row || typeof row !== 'object') return false;
  return !!row.is_operator_not_owner
    || String(row.owner_type || '').toLowerCase() === 'operator'
    || String(row.owner_role || '').toLowerCase() === 'operator';
}

export { TRUE_OWNER_OPERATOR_SELECT_FIELDS };
