// P189 — `v_lcc_merge_candidates` was STRUCTURALLY BLIND to 1,089 live organisations
// carrying $185.1M of annual rent, because it filters `WHERE norm_name IS NOT NULL` and
// `lcc_normalize_entity_name()` returns NULL for any acronym-named firm (it strips
// group/partners/capital/holdings ON TOP OF legal forms, leaving nothing). RMR Group,
// GI Partners, AVG Partners and NGP Capital could never appear. Playbook Class 11: the
// zero was the instrument, not a finding.
//
// The fix adds a namespaced `dc:<lcc_owner_domain_core>` fallback key for exactly that
// population. The SAFETY PROPERTY that made it shippable is what these tests pin:
//
//   `lcc_apply_fuzzy_merges()` loops `WHERE auto_mergeable = true` and calls
//   `lcc_merge_entity()` on every loser. A fallback-keyed group must therefore NEVER be
//   auto_mergeable — `lcc_owner_domain_core` is a GROUPING key, not an identity key
//   (CLAUDE.md: grouping-for-review and identity-for-write are different jobs). If a
//   future edit drops the `NOT via_fallback` guard, 121 ungraded groups silently become
//   eligible for destructive auto-merge. That is the regression worth a test.
//
// GUARD DESIGN (per the CLAUDE.md block-slice footgun): no line numbers, no sliced source
// regions. Every assertion anchors on a STABLE structural token — a column alias or a
// view name — so moving the SQL around cannot make this stale, while removing the guard
// goes red. Verified RED against the pre-P189 view body.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FALLBACK_MIG = 'supabase/migrations/20260827080000_lcc_p189_merge_candidates_fallback_key.sql';
const BLIND_MIG    = 'supabase/migrations/20260827020000_lcc_p189_merge_candidates_normalizer_blind.sql';

const sql = readFileSync(FALLBACK_MIG, 'utf8');
// Strip line comments so prose in the migration header can never satisfy an assertion.
const body = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

/** Text of the select-list expression aliased `AS <alias>`, back to the previous
 *  depth-0 comma. Anchors on the alias, which is stable; line position is not. */
function expressionFor(alias) {
  const end = body.search(new RegExp(`AS\\s+${alias}\\b`, 'i'));
  assert.ok(end > -1, `no expression aliased AS ${alias}`);
  let depth = 0;
  for (let i = end - 1; i >= 0; i--) {
    const c = body[i];
    if (c === ')') depth++;
    else if (c === '(') depth--;
    else if (c === ',' && depth === 0) return body.slice(i + 1, end);
  }
  return body.slice(0, end);
}

describe('P189 fallback grouping key', () => {
  test('a fallback-keyed group can never be auto_mergeable (destructive-path guard)', () => {
    const expr = expressionFor('auto_mergeable').replace(/\s+/g, ' ');
    assert.match(
      expr, /NOT\s+via_fallback/i,
      'auto_mergeable lost its `NOT via_fallback` guard — lcc_apply_fuzzy_merges() would ' +
      'auto-merge 121 ungraded domain-core groups via lcc_merge_entity()',
    );
  });

  test('fallback rows carry a review_reason naming why they are review-only', () => {
    const expr = expressionFor('review_reason');
    assert.match(expr, /via_fallback/i, 'review_reason no longer branches on via_fallback');
    assert.match(expr, /normalizer_blind_review_only/,
      'the fallback review_reason token changed — the lane loses the reason on the card');
  });

  test('the fallback key is NAMESPACED so it cannot collide with a norm_name key', () => {
    // lcc_normalize_entity_name strips punctuation, so it can never emit a colon.
    assert.match(body, /'dc:'\s*\|\|/, 'fallback key lost its `dc:` namespace prefix');
  });

  test('only the previously-EXCLUDED population gets the fallback key', () => {
    // Guarded rows must still be keyed on norm_name when they have one, or existing
    // groups would be re-keyed and the 3,053 auto_mergeable set would shift.
    const expr = expressionFor('group_key').replace(/\s+/g, ' ');
    assert.match(expr, /norm_name\s+IS\s+NOT\s+NULL/i,
      'group_key no longer prefers norm_name — existing groups would be re-keyed');
    assert.match(expr, /THEN\s+n\.norm_name/i);
  });

  test('group_basis is appended LAST (CREATE OR REPLACE VIEW is append-only for columns)', () => {
    const aliases = [...body.matchAll(/AS\s+([a-z_]+)\s*(?:,|\n?FROM\s+scored)/gi)].map((m) => m[1]);
    assert.equal(aliases.at(-1), 'group_basis',
      'group_basis must stay the final column or the view fails to replace (42P16)');
  });

  test('the core-length floor matches the blind view — one definition, not two', () => {
    // Two definitions of one population is the normaliser drift this repo keeps hitting.
    const floorOf = (s) => (s.match(/length\(\s*(?:n\.)?(?:lcc_owner_domain_core\([^)]*\)|domain_core)\s*\)\s*>=\s*(\d+)/i) || [])[1];
    const a = floorOf(body);
    const b = floorOf(readFileSync(BLIND_MIG, 'utf8'));
    assert.ok(a, 'fallback migration lost its domain-core length floor');
    assert.equal(a, b, `core-length floor drifted: fallback=${a} blind=${b}`);
  });
});
