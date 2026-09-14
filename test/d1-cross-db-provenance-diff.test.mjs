// D1 — the cross-database provenance producer-set diff (I2 / playbook Class 20).
//
// WHAT THIS PINS AND WHY.
//
// The detector's whole value is that it fires on a difference nobody has
// explained yet. Three ways it can silently stop being that, each guarded here:
//
//   * the bucket normalizer stops stripping a per-row suffix, so every
//     `county_deed:<uuid>` becomes its own producer and the real signal drowns
//     in thousands of one-row differences;
//   * an acknowledgement is accepted without a REASON, so "explained" decays
//     into "clicked past" and the surface becomes the badge of noise this
//     exists to avoid;
//   * acknowledging starts SILENCING, so a difference we understand and have
//     not fixed disappears from the report instead of staying tracked.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE SOURCE MATCHING. The planner's header
// discusses the dead-column trap, the cardinality guard and the suffix
// normalizer at length while explaining why each exists — so a naive grep would
// match the prose that documents a guard and pass over its deletion. That is the
// A5c/N18 defect (a source detector reporting the bug it just removed) inside a
// test.
//
// Assertions anchor on EXPORTED FUNCTION NAMES and behaviour, never on a line
// number and never on a sliced source region between banners.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROVENANCE_COLUMN_CANDIDATES,
  MAX_PRODUCER_CARDINALITY,
  VERDICTS,
  normalizeBucket,
  resolveProvenanceColumn,
  classifyTable,
  indexAcknowledgements,
  diffTable,
  planProvenanceDiff,
  planIntraTableDiff,
} from '../api/_shared/provenance-diff-planner.js';

const PLANNER_RAW = readFileSync('api/_shared/provenance-diff-planner.js', 'utf8');
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const PLANNER = stripComments(PLANNER_RAW);

const LEDGER = JSON.parse(readFileSync('scripts/d1-provenance-acknowledgements.json', 'utf8'));

// ── the suffix normalizer ───────────────────────────────────────────────────
test('normalizeBucket strips BOTH the : and | per-row suffixes', () => {
  assert.equal(normalizeBucket('county_deed:9f1c-aaaa'), 'county_deed');
  assert.equal(normalizeBucket('gov_master_backfill_r71|h=deadbeef'), 'gov_master_backfill_r71');
  assert.equal(normalizeBucket(null), '(null)');
  assert.equal(normalizeBucket(''), '(null)');
  // Case/whitespace fold: gov returned `costar_export` twice from one GROUP BY,
  // i.e. two raw spellings of one producer.
  assert.equal(normalizeBucket('  CoStar_Export '), 'costar_export');
});

test('a suffixed producer does not split into many one-sided differences', () => {
  const gov = [{ bucket: 'county_deed:aaa', n: 5 }, { bucket: 'county_deed:bbb', n: 7 }];
  const dia = [{ bucket: 'county_deed:ccc', n: 2 }];
  const res = diffTable('t', gov, dia, {});
  assert.equal(res.differences.length, 0, 'one producer, three row-keys — not a difference');
});

// ── the dead-column trap ────────────────────────────────────────────────────
test('resolveProvenanceColumn resolves by POPULATION, not by name order', () => {
  // gov.property_financials carries data_source AND source; `source` is
  // populated on 0 of 98,510 rows.
  const cols = ['data_source', 'source'];
  assert.equal(resolveProvenanceColumn(cols, { data_source: 10530, source: 0 }), 'data_source');
  // and the inverse: if only `source` is live, it must win despite precedence.
  assert.equal(resolveProvenanceColumn(cols, { data_source: 0, source: 676 }), 'source');
});

// ── the precondition failure the original I2 wording missed ─────────────────
test('classifyTable separates "no provenance column" from "table absent"', () => {
  assert.equal(classifyTable('ownership_history',
    { tableExists: true, provenanceColumn: 'data_source' },
    { tableExists: true, provenanceColumn: null }), 'table_exists_no_provenance');
  assert.equal(classifyTable('sam_entities',
    { tableExists: true, provenanceColumn: 'source' },
    { tableExists: false, provenanceColumn: null }), 'table_absent');
  assert.equal(classifyTable('both',
    { tableExists: true, provenanceColumn: 'source' },
    { tableExists: true, provenanceColumn: 'source' }), 'both_provenance');
});

// ── the acknowledgement contract ────────────────────────────────────────────
test('an acknowledgement without a non-empty reason is REJECTED', () => {
  const { byKey, invalid } = indexAcknowledgements([
    { table: 't', bucket: 'b', present_in: 'gov', verdict: 'legitimate', reason: '   ' },
    { table: 't', bucket: 'c', present_in: 'gov', verdict: 'legitimate' },
    { table: 't', bucket: 'd', present_in: 'gov', verdict: 'legitimate', reason: 'a real reason' },
  ]);
  assert.equal(byKey.size, 1);
  assert.equal(invalid.length, 2);
  assert.ok(invalid.every((i) => i.why === 'missing_reason'));
});

test('an acknowledgement with an unknown verdict is REJECTED', () => {
  const { byKey, invalid } = indexAcknowledgements([
    { table: 't', bucket: 'b', present_in: 'gov', verdict: 'wontfix', reason: 'x' },
  ]);
  assert.equal(byKey.size, 0);
  assert.equal(invalid[0].why, 'bad_verdict');
});

test('acknowledging is NOT silencing — unexplained/unwired keep rendering', () => {
  const tables = [{ name: 't', gov: { tableExists: true, provenanceColumn: 's' }, dia: { tableExists: true, provenanceColumn: 's' } }];
  const plan = planProvenanceDiff({
    tables,
    govBuckets: { t: [{ bucket: 'shared', n: 1 }, { bucket: 'quiet', n: 9 }, { bucket: 'tracked', n: 5 }] },
    diaBuckets: { t: [{ bucket: 'shared', n: 1 }] },
    ledger: { acknowledged: [
      { table: 't', bucket: 'quiet', present_in: 'gov', verdict: 'legitimate', reason: 'gov-only source' },
      { table: 't', bucket: 'tracked', present_in: 'gov', verdict: 'unwired', reason: 'known gap, not yet built' },
    ] },
  });
  assert.equal(plan.unacknowledged.length, 0, 'both are acknowledged');
  const stillOpen = plan.known.filter((k) => k.verdict !== 'legitimate');
  assert.equal(stillOpen.length, 1);
  assert.equal(stillOpen[0].bucket, 'tracked');
  assert.ok(stillOpen[0].reason, 'the reason travels with the rendered row');
});

test('a NEW difference is unacknowledged and fails the run', () => {
  const tables = [{ name: 't', gov: { tableExists: true, provenanceColumn: 's' }, dia: { tableExists: true, provenanceColumn: 's' } }];
  const plan = planProvenanceDiff({
    tables,
    govBuckets: { t: [{ bucket: 'brand_new_feeder', n: 400 }] },
    diaBuckets: { t: [{ bucket: 'other', n: 3 }] },
    ledger: { acknowledged: [{ table: 't', bucket: 'other', present_in: 'dia', verdict: 'legitimate', reason: 'r' }] },
  });
  assert.equal(plan.unacknowledged.length, 1);
  assert.equal(plan.unacknowledged[0].bucket, 'brand_new_feeder');
});

// ── the cardinality guard ───────────────────────────────────────────────────
test('a provenance column holding data values is EXCLUDED and reported, never silently dropped', () => {
  const many = Array.from({ length: MAX_PRODUCER_CARDINALITY + 5 }, (_, i) => ({ bucket: `entity_name_${i}`, n: 1 }));
  const res = diffTable('entity_match_candidates', many, [{ bucket: 'x', n: 1 }], {});
  assert.equal(res.excluded, 'provenance_column_is_a_data_value');
  assert.ok(res.cardinality > MAX_PRODUCER_CARDINALITY, 'the cardinality is reported with the exclusion');
  assert.equal(res.differences.length, 0);
});

test('both-empty tables yield no difference; one-empty is flagged, not treated as a producer gap', () => {
  assert.equal(diffTable('t', [], [], {}).excluded, 'both_sides_empty');
  const res = diffTable('t', [{ bucket: 'a', n: 3 }], [], {});
  assert.ok(res.differences.every((d) => d.counterpart_empty === true));
});

// ── the shipped ledger ──────────────────────────────────────────────────────
test('every shipped ledger entry carries a verdict AND a non-empty reason', () => {
  const { invalid } = indexAcknowledgements(LEDGER.acknowledged);
  assert.deepEqual(invalid, [], 'the committed ledger must contain no rejected entry');
  assert.ok(LEDGER.acknowledged.length > 0);
  for (const a of LEDGER.acknowledged) assert.ok(VERDICTS.includes(a.verdict));
});

test('every shipped synonym carries a reason — folding two producers into one is a claim', () => {
  for (const s of LEDGER.synonyms || []) {
    assert.ok(s.canonical && Array.isArray(s.aliases) && s.aliases.length, 'synonym needs a canonical and aliases');
    assert.ok(typeof s.reason === 'string' && s.reason.trim().length > 20,
      `synonym ${s.canonical} must state why the two labels are ONE producer`);
  }
});


// ── the out-of-scope decision list ──────────────────────────────────────────
test('an out-of-scope table is EXCLUDED but still EMITTED with its reason', () => {
  // gov.ingestion_tracker.source holds temp file paths at ~41 buckets — a data
  // value at MODEST cardinality, which the cardinality guard cannot catch.
  const tables = [{ name: 'ingestion_tracker', gov: { tableExists: true, provenanceColumn: 's' }, dia: { tableExists: true, provenanceColumn: 's' } }];
  const plan = planProvenanceDiff({
    tables,
    govBuckets: { ingestion_tracker: [{ bucket: '/tmp/tmpaaa.json', n: 1 }] },
    diaBuckets: { ingestion_tracker: [{ bucket: '/tmp/tmpbbb.json', n: 1 }] },
    ledger: { out_of_scope: [{ table: 'ingestion_tracker', reason: 'holds the runner, not a producer' }] },
  });
  assert.equal(plan.unacknowledged.length, 0, 'an out-of-scope table generates no differences');
  const row = plan.tableDiffs.find((t) => t.table === 'ingestion_tracker');
  assert.equal(row.excluded, 'out_of_scope_by_decision');
  assert.ok(row.reason, 'the exclusion is EMITTED with its reason, never silently dropped');
  assert.equal(plan.counts.out_of_scope, 1, 'and it is counted, so it cannot vanish from the report');
});

test('an out-of-scope entry without a reason is REJECTED, not honoured', () => {
  const tables = [{ name: 't', gov: { tableExists: true, provenanceColumn: 's' }, dia: { tableExists: true, provenanceColumn: 's' } }];
  const plan = planProvenanceDiff({
    tables,
    govBuckets: { t: [{ bucket: 'a', n: 1 }] }, diaBuckets: { t: [{ bucket: 'b', n: 1 }] },
    ledger: { out_of_scope: [{ table: 't', reason: '  ' }] },
  });
  assert.ok(plan.invalidAcknowledgements.some((i) => i.why === 'out_of_scope_missing_reason'),
    'excluding a whole table is a bigger claim than acknowledging one bucket — it needs a reason too');
  assert.ok(plan.unacknowledged.length > 0, 'and the table is diffed anyway rather than silently skipped');
});

test('every shipped out-of-scope decision carries a reason', () => {
  for (const o of LEDGER.out_of_scope || []) {
    assert.ok(o.table, 'out_of_scope needs a table');
    assert.ok(typeof o.reason === 'string' && o.reason.trim().length > 20,
      `out_of_scope ${o.table} must state why its provenance column is not a producer label`);
  }
});

// ── the positive control ────────────────────────────────────────────────────
test('B5 signature fires: dia derives from sales_transactions_seller_exit, gov does not', () => {
  // Live rows from lcc_entity_portfolio_facts, measured 2026-08-29.
  const rows = [
    { source_domain: 'dia', src_bucket: 'sales_transactions_seller_exit', n_facts: 2310 },
    { source_domain: 'dia', src_bucket: 'lcc_property_owner', n_facts: 477 },
    { source_domain: 'gov', src_bucket: 'gsa_lease_diff', n_facts: 4243 },
    { source_domain: 'gov', src_bucket: 'lcc_property_owner', n_facts: 1402 },
  ];
  const { oneSided } = planIntraTableDiff(rows);
  const b5 = oneSided.find((o) => o.bucket === 'sales_transactions_seller_exit');
  assert.ok(b5, 'the detector must still see B5 — a run that surfaces nothing is a bug signal');
  assert.equal(b5.present_in, 'dia');
  assert.deepEqual(b5.absent_from, ['gov']);
});

// ── source invariants ───────────────────────────────────────────────────────
test('the candidate-column list keeps the columns each domain actually uses', () => {
  // gov `properties` uses data_source; dia `properties` uses source. Dropping
  // either from the candidate list makes a whole domain invisible.
  for (const c of ['data_source', 'source', 'source_system', 'provenance', 'source_name', 'ingest_source']) {
    assert.ok(PROVENANCE_COLUMN_CANDIDATES.includes(c), `${c} must stay a candidate provenance column`);
  }
});

test('the planner resolves the provenance column rather than hard-coding one', () => {
  assert.ok(/export function resolveProvenanceColumn/.test(PLANNER),
    'resolving per table from the catalogue is what makes the cross-DB form work at all');
  assert.ok(!/['"]data_source['"]\s*;/.test(PLANNER.replace(/PROVENANCE_COLUMN_CANDIDATES[\s\S]*?\];/, '')),
    'no single provenance column may be hard-coded outside the candidate list');
});
