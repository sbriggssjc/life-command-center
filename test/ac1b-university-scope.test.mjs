// AC1b — close the prospecting-scope drift: universities leaking into
// v_lcc_top_seller_prospects and v_lcc_owner_contact_decidability via
// lcc_owner_name_is_public_body directly, instead of the composed
// lcc_owner_name_is_not_prospected (= is_public_body OR is_university), which
// P190 introduced and its own migration explicitly left these two views
// un-repointed to.
//
// MEASURED LIVE (xengecqvemvfknjvbvrq, 2026-09-10), before/after the AC1b fix:
//   v_lcc_top_seller_prospects   university-named rows: 14 -> 1
//     (the 1 residual, "Idaho State University Federal Credit Union", is a
//      credit union — correctly NOT a university — so the fix removed all 13
//      genuine universities and introduced 0 false positives)
//   v_lcc_owner_contact_decidability
//     university-named rows unblocked as public_body: 3 -> 1
//     (the 1 residual, "George Washington University (The)", is a PRE-EXISTING
//      gap in lcc_owner_name_is_university's own regex — the trailing "(The)"
//      defeats its `universit(y|ies)\M\s*$` anchor — unrelated to this two-line
//      predicate swap and out of scope for it)
//
// Anchored on the migration's own CREATE OR REPLACE VIEW bodies, comment-
// stripped first (per CLAUDE.md's standing rule — a raw-source grep would find
// the header's own prose naming `lcc_owner_name_is_public_body` and pass over
// a reverted fix).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = 'supabase/migrations';
const FILE = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && f.includes('ac1b_top_seller_and_decidability'))
  .map((f) => readFileSync(`${MIGRATIONS}/${f}`, 'utf8'))
  .join('\n');

// Strip SQL line comments before matching (A1/A5c/N18/B1 doctrine): this
// migration's own header prose explains the fix by naming the OLD predicate
// several times, so a naive grep for `lcc_owner_name_is_public_body` would
// find it present and pass over a reverted fix.
const SQL = FILE.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('the AC1b migration exists', () => {
  assert.ok(FILE.length > 0, 'AC1b migration not found');
});

/** Slice one CREATE OR REPLACE VIEW body, bounded by the next top-level
 * CREATE (or end of file) — a stable structural boundary, never a line
 * number or a fixed-character window (the block-slice footgun). */
function viewBody(name) {
  const start = SQL.indexOf(`CREATE OR REPLACE VIEW public.${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const rest = SQL.slice(start + 1);
  const nextCreate = rest.search(/CREATE (OR REPLACE )?VIEW/);
  return nextCreate === -1 ? rest : rest.slice(0, nextCreate);
}

test('top seller prospects calls the composed gate, not is_public_body alone', () => {
  const body = viewBody('v_lcc_top_seller_prospects');
  assert.match(body, /lcc_owner_name_is_not_prospected\(e\.name\)/,
    'must call the composed gate (is_public_body OR is_university)');
  assert.doesNotMatch(body, /lcc_owner_name_is_public_body\(/,
    'must not call is_public_body directly — that is the drift this fixes');
});

test('owner contact decidability calls the composed gate in both CASE arms', () => {
  const body = viewBody('v_lcc_owner_contact_decidability');
  // Two CASE columns reference the public-body test: blocked_reason and
  // decidability_note. Both must be repointed, or one surface still leaks.
  const matches = body.match(/lcc_owner_name_is_not_prospected\(t\.owner_name\)/g) || [];
  assert.ok(matches.length >= 2,
    `expected the composed gate in both blocked_reason and decidability_note CASE arms, found ${matches.length}`);
  assert.doesNotMatch(body, /lcc_owner_name_is_public_body\(/,
    'must not call is_public_body directly in either CASE arm');
});

test('the fix does not touch either view column list, predicate-only change', () => {
  const top = viewBody('v_lcc_top_seller_prospects');
  for (const col of ['entity_id', 'owner_name', 'annual_rent', 'asset_count', 'domains',
    'reachable', 'contact_route', 'on_cadence', 'sf_contact_id', 'owned_assets_resolved',
    'pursuit_status', 'named_lead']) {
    assert.match(top, new RegExp(`(AS ${col}\\b|\\.${col}\\b)`), `v_lcc_top_seller_prospects lost column ${col}`);
  }
  const decid = viewBody('v_lcc_owner_contact_decidability');
  for (const col of ['research_task_id', 'entity_id', 'owner_name', 'rank_value',
    'enrichment_action', 'status', 'created_at', 'bench_size', 'usable_candidates',
    'best_candidate_name', 'best_candidate_source', 'best_candidate_role', 'decidable',
    'blocked_reason', 'decidability_note']) {
    assert.match(decid, new RegExp(`(AS ${col}\\b|\\.${col}\\b)`), `v_lcc_owner_contact_decidability lost column ${col}`);
  }
});
