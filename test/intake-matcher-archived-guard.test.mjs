import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activePropsClause } from '../api/_handlers/intake-matcher.js';

// ============================================================================
// TIER 1 · Unit 3 — OM-intake matcher excludes archived/quarantined gov shells
//
// The gov property book carries ~6,657 status='archived' junk-shell rows. The
// matcher must never resolve/promote an OM onto one. activePropsClause() emits
// the gov-only, NULL-safe PostgREST status guard appended to every candidate
// query; dia has no `status` column so the guard is empty there (a status
// filter would 400 the dia request).
// ============================================================================

describe('activePropsClause (Tier 1 Unit 3 archived guard)', () => {
  it('emits a NULL-safe not-archived clause for the government domain', () => {
    assert.equal(activePropsClause('government'), 'or=(status.is.null,status.neq.archived)');
  });

  it('emits nothing for dialysis (no status column → a filter would 400)', () => {
    assert.equal(activePropsClause('dialysis'), '');
  });

  it('emits nothing for the LCC-native / unknown domains', () => {
    assert.equal(activePropsClause('lcc'), '');
    assert.equal(activePropsClause(undefined), '');
  });

  it('is NULL-safe: keeps active AND null-status rows, drops only archived', () => {
    // Mirrors the views COALESCE(status,'active')<>'archived' semantics — the
    // or=() group keeps status IS NULL rows that a bare status=neq.archived
    // would silently drop.
    const clause = activePropsClause('government');
    assert.match(clause, /status\.is\.null/);
    assert.match(clause, /status\.neq\.archived/);
    // never excludes the legit non-junk statuses (cmbs_discovery / inactive)
    assert.doesNotMatch(clause, /cmbs_discovery|inactive/);
  });
});
