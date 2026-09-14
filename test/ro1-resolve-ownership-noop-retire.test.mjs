// RO1 (UX-T1c §10, 2026-09-08) — the resolve_ownership lane must read only genuine
// disputes. Measured live: 836 of 1,597 rows proposed the owner ALREADY recorded
// (734 gsa_lessor_change, 95 state_lessor_change, 7 discrepancy) — a confirmation
// presented as a question, on a lane with 0 human verdicts ever.
//
// Two invariants:
//   1. the lane's list fetch AND its badge count both filter
//      `proposal_is_recorded=eq.false` — a badge counting rows the list hides is
//      the P139 lying badge.
//   2. the gov migration restates the WHOLE view and appends the column LAST
//      (CREATE OR REPLACE VIEW is append-only for columns).
// Comments are stripped before matching: the fix's own comment names the filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const admin = stripComments(readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8'));
const branch = (() => {
  const m = admin.match(/if \(type === 'resolve_ownership'\) \{[\s\S]*?return out;\n {2}\}/);
  assert.ok(m, 'resolve_ownership fetch branch must exist');
  return m[0];
})();

test('the list fetch reads only proposal_is_recorded=false rows', () => {
  assert.match(branch, /v_ownership_resolution\?select=/, 'reads the view');
  const filters = branch.match(/proposal_is_recorded=eq\.false/g) || [];
  assert.ok(filters.length >= 2, `filter must appear on the fetch AND the count (found ${filters.length})`);
  // the count call itself carries the filter — not just a nearby literal
  assert.match(branch, /domCnt\('gov', 'v_ownership_resolution\?proposal_is_recorded=eq\.false'\)/,
    'badge counts the same filtered population');
  assert.doesNotMatch(branch, /domCnt\('gov', 'v_ownership_resolution'\)/, 'no unfiltered count');
});

test('the gov migration restates the whole view and appends proposal_is_recorded LAST', () => {
  const sql = readFileSync(new URL(
    '../supabase/migrations/government/20261010120000_gov_ro1_ownership_resolution_proposal_is_recorded.sql',
    import.meta.url), 'utf8').replace(/^\s*--.*$/gm, '');
  assert.match(sql, /CREATE OR REPLACE VIEW public\.v_ownership_resolution AS/);
  // the three arms are all present (whole-view restatement, P194)
  for (const arm of ['deed AS', 'lessor AS', 'disc AS', 'has_discrepancy_signal']) assert.match(sql, new RegExp(arm));
  // the new column is the last projected expression before FROM recon
  assert.match(sql, /AS proposal_is_recorded\s*\n\s*FROM recon;\s*$/, 'proposal_is_recorded must be the final column');
  // lower() BEFORE the [^a-z0-9] strip, on both sides
  const lowers = sql.match(/regexp_replace\(lower\((proposed_owner_name|current_recorded_owner_name)\), '\[\^a-z0-9\]'/g) || [];
  assert.equal(lowers.length, 2, 'both sides lower() then strip');
});
