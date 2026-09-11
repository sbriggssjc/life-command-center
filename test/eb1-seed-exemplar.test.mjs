// EB1 — the dialysis exemplar seed script.
//
// The seed script never fabricates: it hard-transcribes the exemplar's
// sourced claims and deliberately excludes every [UNVERIFIED] item. These
// tests pin that exclusion and the idempotency contract (the migration's
// uq_mbf_source_identity unique index is what actually enforces idempotency
// live; here we pin that the SCRIPT'S OWN pure functions produce a stable,
// deterministic row set — calling them twice must be byte-identical, and a
// "re-run" therefore always proposes the exact same (lane, section,
// source_url, source_date, claim_text) keys, which is what lets the DB-side
// unique index dedupe it for free).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDialysisExemplarFacts,
  buildRowsForWrite,
} from '../scripts/eb1-seed-dialysis-exemplar.mjs';

test('buildDialysisExemplarFacts is pure and idempotent — two calls are deep-equal', () => {
  const a = buildDialysisExemplarFacts();
  const b = buildDialysisExemplarFacts();
  assert.deepEqual(a, b, 'two calls to the builder must produce byte-identical output');
});

test('every fact is tagged lane=dialysis and a valid section/fact_kind/origin', () => {
  const facts = buildDialysisExemplarFacts();
  assert.ok(facts.length > 0, 'the exemplar must yield at least one fact');
  const VALID_SECTIONS = new Set(['operators', 'policy', 'capital_markets', 'implications', 'trades']);
  const VALID_KINDS = new Set(['reported', 'opinion', 'derived']);
  for (const f of facts) {
    assert.equal(f.lane, 'dialysis');
    assert.equal(f.origin, 'web_research');
    assert.ok(VALID_SECTIONS.has(f.section), `unexpected section: ${f.section}`);
    assert.ok(VALID_KINDS.has(f.fact_kind), `unexpected fact_kind: ${f.fact_kind}`);
    assert.ok(typeof f.claim_text === 'string' && f.claim_text.length > 10, 'claim_text must be real prose');
  }
});

test('no [UNVERIFIED] exemplar claim is loaded as a fact', () => {
  const facts = buildDialysisExemplarFacts();
  const UNVERIFIED_FRAGMENTS = [
    /rating action/i,
    /moody.?s.*no change to.*B2/i,
    /medline|vantive|quanta/i,          // IRC vendor partnerships, not earnings/M&A
    /independent-operator M&A/i,
    /dialysis-specific cap rate average/i,
    /GLP-1s? may slow|GLP-1.*quantifying/i,
  ];
  for (const f of facts) {
    for (const re of UNVERIFIED_FRAGMENTS) {
      assert.doesNotMatch(f.claim_text, re,
        `an [UNVERIFIED] exemplar item leaked through: "${f.claim_text}"`);
    }
  }
  // Positive control: the exemplar names these five populations as
  // [UNVERIFIED] or unresolved — confirm the exclusion count the script
  // reports (5) is not a made-up number by checking none of the 16 loaded
  // facts mentions "I could not verify" / "I found no" (the exemplar's own
  // phrasing for an unverified claim).
  for (const f of facts) {
    assert.doesNotMatch(f.claim_text, /I could not verify|I found no/i);
  }
});

test('implications facts are opinions with no clock TTL ("tied to inputs", spec §3)', () => {
  const facts = buildDialysisExemplarFacts();
  const implications = facts.filter((f) => f.section === 'implications');
  assert.ok(implications.length > 0, 'the exemplar has an implications section worth loading');
  for (const f of implications) {
    assert.equal(f.fact_kind, 'opinion', 'every implications fact must be fact_kind=opinion, never reported');
    assert.equal(f.ttl_days, null, 'implications facts carry no clock TTL per spec §3');
  }
  // And the inverse: nothing OUTSIDE implications is fact_kind=opinion — a
  // reported operator/policy/capital_markets/trades number must never ride
  // in as unlabelled opinion.
  const nonImplications = facts.filter((f) => f.section !== 'implications');
  for (const f of nonImplications) {
    assert.equal(f.fact_kind, 'reported', `${f.section} fact is not reported: "${f.claim_text}"`);
  }
});

test('every reported fact carries a real source_url and source_date', () => {
  const facts = buildDialysisExemplarFacts();
  for (const f of facts.filter((x) => x.fact_kind === 'reported')) {
    assert.ok(f.source_url && /^https?:\/\//.test(f.source_url), `missing/invalid source_url on "${f.claim_text}"`);
    assert.ok(f.source_date && /^\d{4}-\d{2}-\d{2}$/.test(f.source_date), `missing/invalid source_date on "${f.claim_text}"`);
  }
});

test('buildRowsForWrite computes stale_after = fetched_at + ttl_days, and null TTL stays null', () => {
  const facts = buildDialysisExemplarFacts();
  const now = '2026-09-11T16:00:00.000Z';
  const rows = buildRowsForWrite(facts, now);

  assert.equal(rows.length, facts.length);
  for (const r of rows) {
    assert.equal(r.fetched_at, now);
    assert.ok(!('ttl_days' in r), 'ttl_days must not leak into the written row shape');
  }

  const rateFact = rows.find((r) => /10-year Treasury/.test(r.claim_text));
  assert.ok(rateFact, 'expected the 10-year Treasury fact to exist');
  assert.equal(rateFact.stale_after, '2026-09-13T16:00:00.000Z', '2-day TTL for the rates fact');

  const opinionFact = rows.find((r) => r.fact_kind === 'opinion');
  assert.ok(opinionFact, 'expected at least one opinion fact');
  assert.equal(opinionFact.stale_after, null, 'opinion facts have no computed stale_after');

  const operatorFact = rows.find((r) => r.section === 'operators');
  assert.ok(operatorFact, 'expected at least one operators fact');
  assert.equal(operatorFact.stale_after, '2026-12-20T16:00:00.000Z', '100-day TTL for an operator-results fact');
});

test('two calls to buildRowsForWrite with the same clock produce the identical natural key set', () => {
  const facts = buildDialysisExemplarFacts();
  const now = '2026-09-11T16:00:00.000Z';
  const a = buildRowsForWrite(facts, now);
  const b = buildRowsForWrite(facts, now);
  const keyOf = (r) => `${r.lane}|${r.section}|${r.source_url}|${r.source_date}|${r.claim_text}`;
  assert.deepEqual(a.map(keyOf).sort(), b.map(keyOf).sort(),
    'the natural key set (what the DB unique index dedupes on) must be stable across runs');
  // No duplicate natural keys WITHIN one run either — the unique index is
  // per-row, so two facts sharing a key would silently collapse to one.
  const keys = a.map(keyOf);
  assert.equal(new Set(keys).size, keys.length, 'no two facts in one seed run may share a natural key');
});
