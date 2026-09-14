// ============================================================================
// PR5 — triage of the registered ladder sources that have never written a field.
//
// Measured live 2026-09-02 on v_field_provenance_effective_source: 68 registered
// sources, 39 never written, 21 write-but-unregistered. The 39 are NOT 39
// defects -- they split into seven causes that read identically as a zero, and
// the migration records the verdict + evidence for each in
// field_source_priority.notes.
//
// These guards pin the properties that make the triage trustworthy, and each one
// exists because getting it wrong produced a WRONG ANSWER during the work:
//
//   1. NOTHING IS DELETED. "Unregistered" is a different BRANCH of
//      lcc_merge_field (may fill a blank, may never override, is itself
//      overridable), not a lower rung -- so removing a rung changes merge
//      outcomes in both directions. A 72-combination rolled-back replay measured
//      four decision classes changing from ONE registration.
//   2. The triage view extracts its verdict by REGEX, not by prefix. The first
//      cut used split_part(notes,'PR5:',2) and 26 rungs across four sources
//      silently read NULL because the PR7 marker stamps the same rows and lands
//      in front. 400 verdicted before, 426 after.
//   3. The costar_sidebar government_type rung is BELOW agency_classifier and
//      says so, because above it a vendor label would override the domain's own
//      deterministic classifier on 6,564 records.
//   4. parseMissingColumn must return null for any non-42703 body, so an auth
//      error can never be laundered into "this table has no orphan columns".
//
// Comments are stripped before matching SQL: the migration's own header quotes
// `split_part`, the deleted branch names and the rung numbers repeatedly while
// explaining them, and a raw grep would match the explanation and pass straight
// over a regression (A5c / N18 / PR8).
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseMissingColumn,
  planTableProbes,
  summarise,
  PR7_BASELINE_2026_09_02,
} from '../scripts/check-field-source-priority-columns.mjs';

const MIGRATION = new URL(
  '../supabase/migrations/20261009120000_lcc_pr5_ladder_source_triage.sql',
  import.meta.url,
).pathname;

function stripSqlComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
}
const RAW  = readFileSync(MIGRATION, 'utf8');
const CODE = stripSqlComments(RAW);

// --- 1. nothing is deleted --------------------------------------------------

test('PR5 migration never DELETEs or re-ranks a field_source_priority rung', () => {
  assert.equal(
    /DELETE\s+FROM\s+public\.field_source_priority/i.test(CODE), false,
    'A rung must be soft-retired via notes, never deleted: deleting it moves the source onto '
    + "lcc_merge_field's unregistered branch, which is a behaviour change in both directions.",
  );
  // The only UPDATEs to the table are notes-only.
  const updates = CODE.match(/UPDATE\s+public\.field_source_priority[\s\S]*?;/gi) || [];
  assert.ok(updates.length >= 2, 'expected the PR5 and PR7 notes updates');
  for (const u of updates) {
    // Bound the inspection to the SET clause. `[\s\S]*?` from SET runs straight
    // into the WHERE, where `f.source = v.source` is a JOIN predicate, not an
    // assignment -- the first cut of this guard failed on its own correct code.
    const setClause = (/\bSET\b([\s\S]*?)(?:\bFROM\b|\bWHERE\b|;)/i.exec(u) || [, ''])[1];
    assert.ok(setClause.length > 0, 'could not isolate the SET clause');
    assert.equal(/\bpriority\s*=/i.test(setClause), false, 'PR5 must not re-rank an existing rung');
    assert.equal(/\bsource\s*=/i.test(setClause), false, 'PR5 must not re-point an existing rung');
    assert.equal(/\benforce_mode\s*=/i.test(setClause), false, 'PR5 must not change enforcement');
    assert.equal(/\btarget_table\s*=/i.test(setClause), false, 'PR5 must not move a rung to another table');
  }
});

test('PR5 migration inserts exactly one new rung, and it is the government_type one', () => {
  const inserts = CODE.match(/INSERT\s+INTO\s+public\.field_source_priority[\s\S]*?;/gi) || [];
  assert.equal(inserts.length, 1, 'exactly one registration is in scope for PR5');
  const ins = inserts[0];
  assert.match(ins, /'gov\.properties'\s*,\s*'government_type'\s*,\s*'costar_sidebar'\s*,\s*95\b/);
});

// --- 2. verdict extraction is not position-anchored -------------------------

test('the triage view extracts pr5_verdict by regex, not by a fixed prefix', () => {
  const view = CODE.slice(CODE.indexOf('CREATE OR REPLACE VIEW public.v_field_source_priority_triage'));
  assert.ok(view.length > 0, 'the view must be defined in this migration');
  assert.match(view, /substring\(\s*f\.notes\s+from\s+'PR5:\(\[a-z_\]\+\)'\s*\)/,
    'pr5_verdict must come from a token-anchored regex over the whole note');
  assert.equal(
    /split_part\(\s*split_part\(\s*f\.notes/i.test(view), false,
    'A fixed-position parse silently returned NULL for the 26 rungs the PR7 marker stamps in front of.',
  );
  assert.match(view, /f\.notes\s+LIKE\s+'%PR7:orphan_column%'/,
    'the orphan flag must match anywhere in the note, for the same reason');
});

// --- 3. the one rung's rank is deliberate and below the classifier ----------

test('costar_sidebar government_type is ranked BELOW agency_classifier@90', () => {
  const m = /'gov\.properties'\s*,\s*'government_type'\s*,\s*'costar_sidebar'\s*,\s*(\d+)/.exec(CODE);
  assert.ok(m, 'the registration must be present');
  const priority = Number(m[1]);
  assert.ok(priority > 90,
    `rung ${priority} would let a CoStar page label override agency_classifier@90, which today `
    + 'holds the value on 6,564 of 6,581 records and has never once been overridden.');
});

test('the migration records that this rung is paired with agency_classifier', () => {
  // The pairing lives in the shipped notes VALUE, not in a comment, so it
  // survives into the database where the next reader of the ladder will see it.
  const ins = (CODE.match(/INSERT\s+INTO\s+public\.field_source_priority[\s\S]*?;/i) || [''])[0];
  const mentions = (ins.match(/agency_classifier/g) || []).length;
  assert.ok(mentions >= 2,
    'The stored note must name the source this rung is ranked against BOTH where it states the '
    + 'rank and where it states the pairing — if PR10 re-ranks agency_classifier and only one '
    + `mention survived, the reader could miss the dependency. Found ${mentions}.`);
});

// --- 4. every one of the 39 carries a verdict from the closed vocabulary ----

const VERDICTS = new Set([
  'exercised_elsewhere', 'refused_by_decision', 'retired_by_decision',
  'keep_structural', 'writer_live_zero_rows', 'build_pending', 'retire',
]);

test('all 39 never-written sources carry a verdict from the closed vocabulary', () => {
  const rows = [...CODE.matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'/g)]
    .filter(([, , verdict]) => VERDICTS.has(verdict));
  const sources = new Set(rows.map(([, s]) => s));
  assert.equal(sources.size, 39,
    `expected 39 triaged sources, got ${sources.size} — the measured never-written set was 39 on 2026-09-02`);
  for (const [, , verdict] of rows) assert.ok(VERDICTS.has(verdict), `unknown verdict ${verdict}`);
});

test('county_records is refused, never retired or left unlabelled', () => {
  assert.match(CODE, /\(\s*'county_records'\s*,\s*'refused_by_decision'/,
    'PR1/PR8 refused this source on measurement; PR5 must not quietly downgrade that to `retire`, '
    + 'which reads as "nobody wants it" rather than "arming it would promote gpt-4o output at rung 5".');
});

test('gliner_extract is retired_by_decision, not retire', () => {
  // Its rung was kept ON PURPOSE after W5.1b measured the lane ~80% entity-wrong.
  // Collapsing that into plain `retire` would lose the reason and invite a
  // future cleanup to delete a rung somebody deliberately preserved.
  assert.match(CODE, /\(\s*'gliner_extract'\s*,\s*'retired_by_decision'/);
});

// --- 5. the orphan-column probe cannot launder an error into "clean" -------

test('parseMissingColumn returns the column only for a 42703 body', () => {
  assert.equal(
    parseMissingColumn({ code: '42703', message: 'column properties.recorded_owner_name does not exist' }),
    'recorded_owner_name',
  );
  assert.equal(
    parseMissingColumn({ code: '42703', message: 'column "sold_cap_rate" does not exist' }),
    'sold_cap_rate',
  );
});

test('parseMissingColumn returns null for a non-42703 body, so auth errors abort', () => {
  assert.equal(parseMissingColumn({ code: '42501', message: 'permission denied for table properties' }), null);
  assert.equal(parseMissingColumn({ message: 'JWT expired' }), null);
  assert.equal(parseMissingColumn(null), null);
  assert.equal(parseMissingColumn('column x does not exist'), null);
  // ⚠️ The decisive case, and the one that keeps the code check load-bearing: a
  // MISSING TABLE (42P01) also says "does not exist". Without the code guard the
  // regex reads the TABLE name as a missing column and the script reports a
  // phantom orphan while the real problem is that the table is gone or renamed.
  // A mutation removing the code check survived until this case existed.
  assert.equal(parseMissingColumn({ code: '42P01', message: 'relation "properties" does not exist' }), null);
  assert.equal(parseMissingColumn({ code: '42501', message: 'column "x" does not exist' }), null);
});

test('planTableProbes groups by physical table and filters to the domain prefix', () => {
  const rungs = [
    { target_table: 'dia.properties', field_name: 'year_built' },
    { target_table: 'dia.properties', field_name: 'year_built' },
    { target_table: 'dia.properties', field_name: 'city' },
    { target_table: 'gov.properties', field_name: 'agency' },
    { target_table: 'entities',       field_name: 'email' },
    { target_table: 'lcc.lcc_property_owner', field_name: 'owner_entity_id' },
  ];
  assert.deepEqual(planTableProbes(rungs, 'dia'), [{ table: 'properties', columns: ['city', 'year_built'] }]);
  assert.deepEqual(planTableProbes(rungs, 'gov'), [{ table: 'properties', columns: ['agency'] }]);
  // An UNPREFIXED rung (`entities`, `comp_provenance`, ...) lives on LCC Opps or
  // is a logical Salesforce namespace -- it is not a domain column and must never
  // be probed against a domain database, or every one would report as an orphan.
  for (const prefix of ['dia', 'gov']) {
    const probed = planTableProbes(rungs, prefix).flatMap((p) => p.columns);
    assert.equal(probed.includes('email'), false, 'an unprefixed rung must not be probed');
    assert.equal(probed.includes('owner_entity_id'), false, 'an lcc.-prefixed rung must not be probed as a domain column');
  }
});

test('summarise separates NEW orphans from the measured baseline', () => {
  const out = summarise(['gov.properties.recorded_owner_name', 'gov.properties.brand_new_column']);
  assert.deepEqual(out.newSinceBaseline, ['gov.properties.brand_new_column']);
  assert.ok(out.clearedSinceBaseline.includes('dia.sales_transactions.sold_cap_rate'));
});

test('the PR7 baseline and the migration name the same orphan pairs', () => {
  // The migration is the record; the script's constant is a convenience. If they
  // drift, the operator check reports a NEW orphan that was already known, or
  // stays quiet about one that is not.
  const fromMigration = new Set(
    [...CODE.matchAll(/\(\s*'((?:dia|gov)\.[a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'(?:LIVE|STOPPED|NEVER)/g)]
      .map(([, t, f]) => `${t}.${f}`),
  );
  assert.equal(fromMigration.size, 19, 'the migration must mark all 19 measured orphan pairs');
  assert.deepEqual([...fromMigration].sort(), [...PR7_BASELINE_2026_09_02].sort());
});
