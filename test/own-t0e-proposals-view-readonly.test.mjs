// OWN-T0e (2026-09-08) — the sponsor-family proposals view is a DRY-RUN surface: it must be built
// on the ONE sanctioned gate and must write nothing. Comments stripped first (the header names the
// forbidden writes while explaining why they are forbidden).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL(
  '../supabase/migrations/20260908150000_lcc_own_t0e_sponsor_family_proposals_view.sql', import.meta.url), 'utf8');
const sql = raw.replace(/^\s*--.*$/gm, '');
// the COMMENT ON literal explains the design in prose; blank string literals AFTER comment-stripping (OCR1c order)
const code = sql.replace(/'(?:[^']|'')*'/g, "''");

test('the view uses the A3 gate and no second normaliser', () => {
  assert.match(code, /create or replace view public\.v_lcc_ownt0e_sponsor_family_proposals/);
  assert.match(code, /lcc_ownership_sponsor_token\(/, 'must call the sanctioned proposal gate');
  assert.doesNotMatch(code, /lcc_normalize_entity_name|dup-pair|nameSimilarity|similarity\(/, 'no fuzzy/normaliser identity');
});

test('the view writes nothing and decides the sponsor by a recorded fact', () => {
  assert.doesNotMatch(code, /\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b|lcc_merge_entity\(/i, 'read-only');
  assert.match(code, /lcc_entity_portfolio_facts/, 'sponsor side from portfolio breadth');
  assert.match(code, /'tied'|tied/, 'ties are surfaced, not guessed');
  assert.match(code, /token_entities_fleetwide/, 'blast radius on the row');
  assert.match(code, /same_party_suspect/, 'duplicate-vs-family is visible');
});
