// N18 — a correlated subquery predicate must not compare a column to ITSELF.
//
// WHAT THIS PINS, AND WHY IT IS ANCHORED THE WAY IT IS.
//
// `v_lcc_developer_classification_candidates.attributed_rent` correlated on
// `pof.source_property_id = pof.source_property_id`. Postgres reduces that to a
// `One-Time Filter`, so the scalar subquery returned `max(annual_rent)` over
// EVERY current portfolio fact in the domain and the enclosing `sum()` multiplied
// that constant by the group's property count. The number an operator classifies
// on read `props * domain_max_rent` — $34,920,891.77 on all six live rows —
// instead of the candidate's own rent ($431,643.78 – $2,226,661.54).
//
// Nothing errors, nothing is NULL, and the value is plausibly large, so no
// behavioural assertion catches it. What catches it is the SHAPE: a self-equality
// in a WHERE clause is never meaningful SQL. This guard is therefore a CLASS
// detector over every migration, not a line-anchored check on one file.
//
// TWO THINGS IT HAD TO GET RIGHT:
//
// 1. IT MUST STRIP SQL COMMENTS FIRST. The N18 migration's own header explains
//    the defect and quotes the broken predicate three times in prose. A detector
//    that reads raw text fires on the documentation of the fix and reports the
//    bug it just removed. (A5c hit the mirror image of this: a file's explanatory
//    prose made two assertions pass over a deleted assignment.)
//
// 2. IT NEEDS A POSITIVE CONTROL. After the fix the population is ZERO across the
//    whole migration surface, and an implausibly clean result is a bug signal, not
//    a finding (playbook Class 11 — the P182 deparse trap and the P189
//    `IS NOT DISTINCT FROM` inversion both returned confident, wrong zeros). So
//    the detector is pointed at known positives — including the real pre-fix
//    predicate — and must fire on them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';

// Strip block comments then line comments. Newlines in block comments are
// preserved so reported line numbers stay true to the file.
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, '');
}

// `alias.column = alias.column` — the same qualified reference on both sides.
// Case-insensitive because SQL identifiers are, and tolerant of internal
// whitespace/newlines around the `=`.
const SELF_COMPARISON = /\b([A-Za-z_][A-Za-z0-9_$]*)\.([A-Za-z_][A-Za-z0-9_$]*)\s*=\s*\1\s*\.\s*\2\b/gi;

function findSelfComparisons(sql) {
  const stripped = stripSqlComments(sql);
  const hits = [];
  for (const m of stripped.matchAll(SELF_COMPARISON)) {
    hits.push({
      text: m[0].replace(/\s+/g, ' '),
      line: stripped.slice(0, m.index).split('\n').length,
    });
  }
  return hits;
}

test('detector fires on known positives (Class 11 positive control)', () => {
  // The real pre-fix predicate, verbatim from the live view definition.
  const realDefect = 'WHERE pf.source_domain = pof.source_domain'
    + ' AND pof.source_property_id = pof.source_property_id AND pf.is_current';
  assert.equal(findSelfComparisons(realDefect).length, 1,
    'must fire on the actual N18 defect');

  // Case and whitespace variants must not slip past.
  assert.equal(findSelfComparisons('WHERE A.Id = a.id').length, 1, 'case-insensitive');
  assert.equal(findSelfComparisons('WHERE t.x\n  =\n  t.x').length, 1, 'spans newlines');

  // And it must NOT fire on the correct predicate, or on a genuine self-join
  // between two DIFFERENT aliases of the same table.
  assert.equal(findSelfComparisons('WHERE pf.source_property_id = pof.source_property_id').length, 0,
    'correct predicate is not a hit');
  assert.equal(findSelfComparisons('FROM t a JOIN t b ON a.parent_id = b.id').length, 0,
    'a real self-JOIN between distinct aliases is not a hit');
  assert.equal(findSelfComparisons('WHERE a.x = ab.x').length, 0,
    'alias that merely shares a prefix is not a hit');
});

test('comment stripping: prose describing the defect is not a hit', () => {
  const doc = '-- N18: was `pof.source_property_id = pof.source_property_id`\n'
    + 'WHERE pf.source_property_id = pof.source_property_id';
  assert.deepEqual(findSelfComparisons(doc), [],
    'a migration documenting the defect must not be reported as carrying it');

  const block = '/* pof.source_property_id = pof.source_property_id */\nSELECT 1';
  assert.deepEqual(findSelfComparisons(block), [], 'block comments stripped too');

  // Guard the guard: stripping must not be so eager it blinds the detector to
  // live SQL that merely follows a comment on the same line.
  assert.equal(findSelfComparisons('SELECT 1; -- note\nWHERE t.x = t.x').length, 1,
    'live SQL after a comment is still scanned');
});

test('no migration contains a self-comparison in live SQL', () => {
  const offenders = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    for (const hit of findSelfComparisons(readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8'))) {
      offenders.push(`${file}:${hit.line}  ${hit.text}`);
    }
  }
  assert.deepEqual(offenders, [],
    'a column compared to itself is never meaningful; it silently degenerates the\n'
    + 'predicate to TRUE and returns a plausible, wrong number:\n  ' + offenders.join('\n  '));
});

test('N18 migration carries the fixed predicate and preserves the N15c repoint', () => {
  const file = readdirSync(MIGRATIONS_DIR)
    .find((f) => f.includes('n18_developer_attributed_rent_self_comparison'));
  assert.ok(file, 'N18 migration present');
  const sql = stripSqlComments(readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8'));

  // Anchored on stable identity tokens, never a line number or a sliced region.
  assert.match(sql, /pf\.source_property_id\s*=\s*pof\.source_property_id/,
    'rent subquery correlates on the candidate property');

  // N15c repointed the entity join off `canonical_name` (which another writer
  // owns) onto the computed normalizer: 267 of 277 candidates resolve, vs 196 on
  // `canonical_name` after N15c landed. Re-issuing the view without this arm
  // would silently regress it, which is why the whole body is restated here.
  assert.match(sql, /LEFT JOIN\s+public\.entities\s+e\s+ON\s+public\.lcc_normalize_entity_name\(e\.name\)/,
    'N15c repoint intact');
  assert.doesNotMatch(sql, /ON\s+e\.canonical_name\s*=\s*n\.norm/,
    'must not revert to reading e.canonical_name');

  // The view is read through PostgREST by the classify tick; the invoker setting
  // is part of its contract and must survive a re-issue (P157).
  assert.match(sql, /WITH \(security_invoker = true\)/, 'security_invoker preserved');
});
