// ============================================================================
// PR12 — field_provenance could not store a value containing a double quote,
//        a newline, a tab or any control character, and it failed SILENTLY.
//
// THE DEFECT
// ----------
// value_text_hash was GENERATED ALWAYS AS
//     encode(sha224(coalesce(value::text,'')::bytea),'hex')
// `value` is jsonb, and rendering jsonb to text emits BACKSLASH escapes
// (\" \n \t \r \b \f \uXXXX \\). The text->bytea cast uses bytea's ESCAPE
// input format, which accepts only \\ and \ooo, so every other escape raised
// 22P02 and aborted the whole lcc_merge_field() call. The JS gate caught the
// non-ok RPC and failed OPEN, so the curated value was written and the
// provenance row vanished with no signal.
//
// Rolled-back controls on the live function (2026-09-02):
//   pre-fix   quoted -> 22P02 invalid input syntax for type bytea; plain -> NO_ERROR
//   post-fix  quoted / newline / jsonb-object-with-quoted-member -> all NO_ERROR
//
// ⚠️ THE SCOPE IS BROADER THAN THE DOUBLE QUOTE THE BACKLOG ROW NAMED, so these
//    guards pin newline / tab / control-char / nested-object cases too. What
//    does NOT break: a jsonb object's own delimiter quotes ({"a": "b"} carries
//    no backslash) and non-ASCII. Rule, validated 14/14 against the live cast:
//    after collapsing '\\' pairs, ANY remaining backslash errors.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE EVERY SOURCE ASSERTION, and here that is
//    load-bearing in BOTH directions: the migration header quotes the removed
//    `value::text::bytea` expression repeatedly while explaining the bug, and it
//    also names `convert_to` in prose. A raw grep would find the banned shape
//    present (false RED) and the required shape present (false GREEN) purely
//    from the explanation. (A5c / N18 / OCR1c.)
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// The gate must run its OFFLINE path: with no ops credentials opsQuery returns
// {ok:false, status:503} without a network call. Deterministic, and it exercises
// the real non-ok branch rather than a mock of it.
delete process.env.OPS_SUPABASE_URL;
delete process.env.OPS_SUPABASE_KEY;

const {
  shouldWriteField,
  describeProvenanceFailure,
  getProvenanceFailureStats,
  resetProvenanceFailureStats,
} = await import('../api/_shared/field-priority-guard.js');

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const PR12_MIGRATION = '20261010120000_lcc_pr12_provenance_hash_bytea_safe.sql';
// The historical CREATE TABLE. It legitimately still states the expression PR12
// removed; exempted by PATH, and the exemption is itself asserted below.
const ORIGINAL_MIGRATION = '20260425210000_lcc_field_provenance_and_priority.sql';
/** The defect shape: a digest over a text value pushed through a bytea CAST.
 *  A bytea LITERAL ('\x..'::bytea) is not this and must not be flagged.
 *  Fresh object each call — a /g regex carries lastIndex between .test()s. */
const BYTEA_HASH_RE = () =>
  /(sha\d+|md5|digest)\s*\([^;]{0,200}?::\s*text[^;]{0,200}?::\s*bytea/gi;
const PR12_RAW = readFileSync(join(MIGRATIONS_DIR, PR12_MIGRATION), 'utf8');

/**
 * Strip SQL `--` line comments and /* *\/ blocks, THEN blank string literals.
 *
 * ⚠️ THE ORDER IS LOAD-BEARING AND BOTH HALVES ARE REQUIRED (OCR1c).
 * Comments first: a bare apostrophe in ordinary prose ("the engine's output")
 * opens a string the scanner never closes and swallows the real code behind it.
 * Literals second: this very migration's `COMMENT ON` text names
 * `value::text::bytea` inside a quoted string while explaining the fix, so a
 * comments-only stripper reports the defect it just removed. Both halves are
 * positive-controlled below.
 */
function stripSqlComments(src) {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
  // $tag$ ... $tag$ dollar-quoted bodies are CODE (the trigger lives in one),
  // so only single-quoted literals are blanked. '' is an escaped quote.
  return noComments.replace(/'(?:''|[^'])*'/g, "''");
}
const PR12_SQL = stripSqlComments(PR12_RAW);

// ---------------------------------------------------------------------------
// Positive controls first — a detector that cannot fail is not a detector.
// ---------------------------------------------------------------------------

test('positive control: the stripper removes BOTH comment prose and string literals', () => {
  const sample = "-- was value::text::bytea, fixed with convert_to\nSELECT 1;\n";
  const out = stripSqlComments(sample);
  assert.ok(!out.includes('::bytea'), 'stripper leaves comment prose these guards must see past');
  assert.ok(!out.includes('convert_to'), 'stripper leaves comment prose these guards must see past');
  assert.ok(out.includes('SELECT 1'), 'stripper ate real SQL');

  // the literal half — a COMMENT ON body naming the banned shape
  const lit = "COMMENT ON COLUMN t.c IS 'was value::text::bytea';\nSELECT 2;\n";
  const litOut = stripSqlComments(lit);
  assert.ok(!litOut.includes('::bytea'), 'string literals must be blanked, not only comments');
  assert.ok(litOut.includes('SELECT 2'), 'stripper ate real SQL');

  // the ORDER half — an apostrophe in prose must not open a string that eats code
  const apo = "-- the engine's output is fine\nSELECT convert_to('x','UTF8');\n";
  assert.ok(stripSqlComments(apo).includes('convert_to'),
    'comments must be stripped BEFORE literals, or prose apostrophes swallow the code behind them');
});

test('positive control: the PR12 migration header really does quote the banned shape', () => {
  // If this ever fails the stripping above has gone vacuous and every
  // "banned shape absent" assertion below would pass for the wrong reason.
  assert.ok(PR12_RAW.includes('::bytea'),
    'header no longer quotes the removed expression — re-check the stripper is still doing work');
});

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

test('the hash is built with convert_to(...,UTF8), never a text->bytea cast', () => {
  assert.match(PR12_SQL, /convert_to\(\s*COALESCE\(\s*NEW\.value::text/i,
    'the trigger must hash convert_to(value::text,...), which does not parse escapes');
  assert.doesNotMatch(PR12_SQL, /::\s*bytea/i,
    'a text->bytea cast is the defect: bytea escape input rejects jsonb\'s \\" \\n \\t with 22P02');
  assert.match(PR12_SQL, /sha224\(\s*\n?\s*convert_to\(/i,
    'sha224 must take the convert_to bytea directly');
});

test('the column is converted in place — no rewrite of a 1,025 MB table', () => {
  // DROP EXPRESSION is metadata-only: probed live, pg_relation_filenode
  // unchanged and every stored value byte-identical. DROP COLUMN + ADD COLUMN
  // ... GENERATED, or PG17's SET EXPRESSION, would rewrite 1,270,785 rows on a
  // database whose documented worst failure is disk-full -> sign-in lockout.
  assert.match(PR12_SQL, /ALTER\s+COLUMN\s+value_text_hash\s+DROP\s+EXPRESSION/i,
    'must convert the generated column in place');
  assert.doesNotMatch(PR12_SQL, /ADD\s+COLUMN\s+value_text_hash/i,
    'ADD COLUMN ... GENERATED STORED rewrites the whole table — that is the path this avoids');
  assert.doesNotMatch(PR12_SQL, /SET\s+EXPRESSION/i,
    'PG17 SET EXPRESSION also rewrites the whole table');
  assert.doesNotMatch(PR12_SQL, /\bUPDATE\s+public\.field_provenance\b/i,
    'no backfill: 0 of 1,270,785 stored values contain a backslash, so every hash is already correct');
});

test('one trigger owns value_text_hash, and it fires on INSERT and on UPDATE OF value', () => {
  assert.match(PR12_SQL, /CREATE\s+TRIGGER\s+trg_field_provenance_value_text_hash/i);
  assert.match(PR12_SQL, /BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+value\s+ON\s+public\.field_provenance/i,
    'UPDATE OF value is required — a value edited in place must re-hash');
  assert.match(PR12_SQL, /NEW\.value_text_hash\s*:=/,
    'the trigger must assign unconditionally: a caller-supplied hash is ignored, never trusted, '
    + 'which is the one guarantee a BEFORE trigger owes that GENERATED ALWAYS gave for free');
});

// ---------------------------------------------------------------------------
// Class-wide: no migration may reintroduce the shape
// ---------------------------------------------------------------------------

test('no migration hashes a jsonb-derived text through a bytea CAST', () => {
  const offenders = [];
  let scanned = 0;
  for (const f of readdirSync(MIGRATIONS_DIR).filter(n => n.endsWith('.sql'))) {
    if (f === ORIGINAL_MIGRATION) continue;   // exempt BY PATH — see below
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    scanned++;
    // The defect shape: a digest over `<something>::text ... ::bytea`, i.e. a
    // cast rather than convert_to()/decode(). A bytea LITERAL ('\x..'::bytea)
    // is fine and must not be flagged.
    if (BYTEA_HASH_RE().test(sql)) offenders.push(f);
  }
  assert.ok(scanned > 100, `expected to scan the migration corpus, scanned ${scanned}`);
  assert.deepEqual(offenders, [],
    'use convert_to(<text>,\'UTF8\'); a text->bytea cast parses backslash escapes and raises 22P02');
});

test('the one exempted migration is exempt because it still CARRIES the shape', () => {
  // P182: exclude a legitimate file BY PATH, never by weakening the pattern.
  // 20260425210000 is the historical CREATE TABLE and must keep stating what it
  // built; PR12 supersedes it. An allowlist entry that no longer matches has
  // rotted into a lie, so assert the exemption is doing real work.
  const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, ORIGINAL_MIGRATION), 'utf8'));
  assert.ok(BYTEA_HASH_RE().test(sql),
    `${ORIGINAL_MIGRATION} no longer contains the pre-PR12 expression — drop the exemption`);
});

test('positive control: that class-wide detector fires on the pre-PR12 expression', () => {
  const pre = "encode(sha224(coalesce(value::text,'')::bytea), 'hex')";
  assert.ok(BYTEA_HASH_RE().test(stripSqlComments(pre)),
    'the detector cannot see the very expression PR12 removed — it would return a comfortable zero');
});

// ---------------------------------------------------------------------------
// The JS half: fail open, but never silently
// ---------------------------------------------------------------------------

test('the DB\'s own SQLSTATE is captured, not the HTTP status', () => {
  // PostgREST returns the DB error body on a non-2xx. A status code cannot name
  // a cause — the same lesson as "a 409 is not necessarily a conflict".
  const res = { ok: false, status: 400, data: {
    code: '22P02', message: 'invalid input syntax for type bytea', details: null } };
  const cause = describeProvenanceFailure(res, null);
  assert.equal(cause.code, '22P02');
  assert.equal(cause.message, 'invalid input syntax for type bytea');

  // and it degrades honestly when the DB said nothing
  const bare = describeProvenanceFailure({ ok: false, status: 503, data: null }, null);
  assert.equal(bare.code, 'http_503');
  assert.match(bare.message, /no DB message/);
});

test('a failed provenance write still fails OPEN — the curated value is never lost', async () => {
  resetProvenanceFailureStats();
  const gate = await shouldWriteField({
    targetDb: 'dia_db', targetTable: 'dia.parcel_records', recordPk: 'pr12',
    fieldName: 'zoning', value: '"C" - Commercial', source: 'costar_sidebar', confidence: 0.6,
  });
  assert.equal(gate.write, true,
    'losing a curated value to a provenance failure is worse than losing the provenance');
  assert.equal(gate.provenanceRecorded, false,
    'the caller must be able to tell "recorded" from "failed open"');
  assert.ok(gate.failureCode, 'the failure must name its cause');
});

test('a failed provenance write is COUNTED — provenance_failed goes non-zero', async () => {
  resetProvenanceFailureStats();
  assert.equal(getProvenanceFailureStats().total, 0, 'stats must start clean');
  for (const fieldName of ['zoning', 'owner_name']) {
    await shouldWriteField({
      targetDb: 'dia_db', targetTable: 'dia.parcel_records', recordPk: 'pr12',
      fieldName, value: 'x', source: 'costar_sidebar', confidence: 0.6,
    });
  }
  const stats = getProvenanceFailureStats();
  assert.equal(stats.total, 2, 'every dropped provenance write must be counted');
  assert.equal(stats.byCode.length, 1, 'failures group by the DB\'s own code');
  assert.deepEqual(stats.byCode[0].targets.sort(),
    ['dia.parcel_records.owner_name', 'dia.parcel_records.zoning'],
    'the affected columns must be nameable, or the count is unactionable');
});

test('a successful gate decision does not count as a failure', async () => {
  resetProvenanceFailureStats();
  // Missing required arguments short-circuits BEFORE the RPC — a no-op, not a
  // dropped write. Counting it would make provenance_failed unreadable.
  const gate = await shouldWriteField({ targetTable: null, fieldName: null, source: null });
  assert.equal(gate.write, true);
  assert.equal(getProvenanceFailureStats().total, 0,
    'a short-circuit is not a dropped provenance write');
});
