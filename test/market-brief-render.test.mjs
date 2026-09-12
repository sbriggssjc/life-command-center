// MB-b — pure fact-selection/diff helpers for the Lane Briefs email block
// and the homepage Market Briefs tab. No DB, no network (mirrors the
// market-brief-tick-handlers.test.mjs convention: DB-dependent flow is
// verified live).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_LANES,
  LANE_LABELS,
  TOP_FACT_SECTION_WEIGHT,
  isGapFact,
  selectTopFacts,
  selectGapFacts,
  diffFactSets,
} from '../api/_shared/market-brief-render.js';

test('KNOWN_LANES matches the EB1 chk_mbf_lane CHECK constraint (4 lanes)', () => {
  assert.deepEqual(KNOWN_LANES, ['dialysis', 'government', 'net_lease', 'broad_net_lease']);
  for (const lane of KNOWN_LANES) assert.ok(LANE_LABELS[lane], `LANE_LABELS missing a label for ${lane}`);
});

test('isGapFact is true only for unit=gap_marker', () => {
  assert.equal(isGapFact({ unit: 'gap_marker' }), true);
  assert.equal(isGapFact({ unit: 'count' }), false);
  assert.equal(isGapFact({ unit: 'decimal_cap_rate' }), false);
  assert.equal(isGapFact(null), false);
});

test('selectTopFacts excludes gap_marker facts entirely', () => {
  const facts = [
    { section: 'operators', unit: 'gap_marker', claim_text: 'DaVita stale', fetched_at: '2026-09-12T00:00:00Z' },
    { section: 'capital_markets', unit: 'decimal_cap_rate', claim_text: 'TTM cap band', fetched_at: '2026-09-12T00:00:00Z' },
  ];
  const top = selectTopFacts(facts);
  assert.equal(top.length, 1);
  assert.equal(top[0].claim_text, 'TTM cap band');
});

test('selectTopFacts ranks by section weight first, recency second', () => {
  const facts = [
    { section: 'implications', unit: 'x', claim_text: 'low weight, newest', fetched_at: '2026-09-12T12:00:00Z' },
    { section: 'capital_markets', unit: 'x', claim_text: 'high weight, older', fetched_at: '2026-09-10T00:00:00Z' },
    { section: 'capital_markets', unit: 'x', claim_text: 'high weight, newer', fetched_at: '2026-09-11T00:00:00Z' },
  ];
  const top = selectTopFacts(facts, 3);
  assert.deepEqual(top.map((f) => f.claim_text), ['high weight, newer', 'high weight, older', 'low weight, newest']);
});

test('selectTopFacts honors the limit', () => {
  const facts = Array.from({ length: 10 }, (_, i) => ({ section: 'operators', unit: 'x', claim_text: `f${i}`, fetched_at: '2026-09-12T00:00:00Z' }));
  assert.equal(selectTopFacts(facts, 2).length, 2);
});

test('selectGapFacts returns only gap_marker facts, preserving order', () => {
  const facts = [
    { unit: 'gap_marker', claim_text: 'gap a' },
    { unit: 'count', claim_text: 'not a gap' },
    { unit: 'gap_marker', claim_text: 'gap b' },
  ];
  assert.deepEqual(selectGapFacts(facts).map((f) => f.claim_text), ['gap a', 'gap b']);
});

test('diffFactSets: a fact only in current is "added"', () => {
  const changes = diffFactSets({
    priorFacts: [{ fact_id: '1', claim_text: 'old' }],
    currentFacts: [{ fact_id: '1', claim_text: 'old' }, { fact_id: '2', claim_text: 'new' }],
  });
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], { fact_id: '2', claim_text: 'new', section: undefined, action: 'added' });
});

test('diffFactSets: a fact only in prior is "superseded_or_expired"', () => {
  const changes = diffFactSets({
    priorFacts: [{ fact_id: '1', claim_text: 'gone now' }],
    currentFacts: [],
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'superseded_or_expired');
  assert.equal(changes[0].claim_text, 'gone now');
});

test('diffFactSets: identical fact_id sets produce no changes', () => {
  const facts = [{ fact_id: 'a', claim_text: 'x' }];
  assert.deepEqual(diffFactSets({ priorFacts: facts, currentFacts: facts }), []);
});

test('diffFactSets: no prior issue (first-ever render) reports every current fact as added, nothing removed', () => {
  const changes = diffFactSets({ priorFacts: [], currentFacts: [{ fact_id: '1', claim_text: 'x' }] });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'added');
});

// ---------------------------------------------------------------------------
// Source-shape guards: the freeze upsert must key on the EB1 unique index
// (lane, issue_type, issue_date) with a merge-duplicates resolution — that
// structural property IS the "idempotent per day" guarantee (a same-day
// re-render upserts the SAME row rather than accumulating a second one). The
// DB round trip itself is not exercised here (mirrors the repo's own stated
// convention for this file family — DB-dependent flow is verified live), but
// a change that drops the on_conflict clause or the merge-duplicates
// resolution would silently re-introduce accumulation, so it is pinned.
// ---------------------------------------------------------------------------

const RENDER_SRC = readFileSync(
  fileURLToPath(new URL('../api/_shared/market-brief-render.js', import.meta.url)), 'utf8');

test('freezeDailyIssue upserts on (lane, issue_type, issue_date) — the idempotency key', () => {
  assert.match(RENDER_SRC, /market_brief_issues\?on_conflict=lane,issue_type,issue_date/);
});

test('freezeDailyIssue uses Prefer: resolution=merge-duplicates (upsert, never a blind insert)', () => {
  assert.match(RENDER_SRC, /resolution=merge-duplicates/);
});

test('freezeDailyIssue never freezes an issue for a lane with no facts', () => {
  assert.match(RENDER_SRC, /if\s*\(!factIds\s*\|\|\s*!factIds\.length\)\s*return\s*\{\s*ok:\s*false,\s*skipped:\s*'no_facts'\s*\};/);
});

test('buildLaneBriefContext reads v_market_brief_live only — never a raw market_brief_facts select for the render path', () => {
  assert.match(RENDER_SRC, /fetchLaneLiveFacts/);
  assert.match(RENDER_SRC, /v_market_brief_live\?lane=eq\./);
});
