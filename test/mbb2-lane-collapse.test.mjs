// MB-b2 — structural guard for the net_lease/broad_net_lease lane-collapse
// migration (2026-09-12, per Scott: the two lanes were redundant and no
// live facts/issues existed under either, so this is a pure constraint +
// view narrowing, no data migration). Mirrors the
// eb1-market-brief-foundation.test.mjs comment-stripping pattern so prose
// in the migration's own header/comments can never satisfy these
// assertions in place of real SQL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const FILES = readdirSync('supabase/migrations').filter((f) => f.includes('lcc_mbb2_lane_collapse_net_lease'));

test('the MB-b2 lane-collapse migration exists exactly once', () => {
  assert.equal(FILES.length, 1, `expected exactly one MB-b2 lane-collapse migration, found: ${FILES.join(', ')}`);
});

const RAW = FILES.map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');
const SQL = RAW.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('chk_mbf_lane and chk_mbi_lane are both re-added with exactly 3 lanes (broad_net_lease gone)', () => {
  for (const constraint of ['chk_mbf_lane', 'chk_mbi_lane']) {
    const m = SQL.match(new RegExp(`ADD CONSTRAINT ${constraint} CHECK \\(lane IN \\(([^)]+)\\)\\)`, 'i'));
    assert.ok(m, `${constraint} re-add not found`);
    const lanes = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    assert.deepEqual(lanes.sort(), ['dialysis', 'government', 'net_lease'].sort());
  }
});

test('both lane constraints are dropped before being re-added (no duplicate-constraint failure on re-run)', () => {
  assert.match(SQL, /DROP CONSTRAINT IF EXISTS chk_mbf_lane/i);
  assert.match(SQL, /DROP CONSTRAINT IF EXISTS chk_mbi_lane/i);
});

test('v_market_brief_staleness lanes CTE is narrowed to the same 3 lanes', () => {
  const m = SQL.match(/unnest\(ARRAY\[([^\]]+)\]\) AS lane/i);
  assert.ok(m, 'lanes unnest not found in v_market_brief_staleness');
  const lanes = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(lanes.sort(), ['dialysis', 'government', 'net_lease'].sort());
});
