// ID3e — offline structural guard over the county/city vocabulary fold migrations.
// Reads the committed SQL text (no DB, no network) so it runs in `npm test` unconditionally.
// The live positive-control run against real data is in test/sql/id3e-place-vocab-fold.live.test.mjs
// (not globbed by `npm test`; run manually against a reachable Supabase project).
//
// This guards the mechanism, not the data: a migration matching this shape is structurally
// unable to key on name-alone (I14's "never county alone" rule), and structurally unable to
// destroy the "(city)"/"city" token that keeps a VA independent city apart from a same-named
// county.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GOV_SQL = readFileSync(
  path.join(ROOT, 'supabase/migrations/government/20260912120000_gov_id3e_county_city_vocab_fold.sql'),
  'utf8'
);
const DIA_SQL = readFileSync(
  path.join(ROOT, 'supabase/migrations/dialysis/20260912120000_dia_id3e_city_vocab_fold.sql'),
  'utf8'
);

// Strip SQL line comments before matching, so a comment discussing the hazard can't itself
// satisfy an assertion about the code that guards it (the A5c/N18 "strip comments first" rule).
function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

for (const [label, sql] of [['gov', GOV_SQL], ['dia', DIA_SQL]]) {
  const code = stripSqlComments(sql);

  test(`ID3e ${label}: the fold key is ALWAYS a (name, state) pair, never name alone`, () => {
    // The generated column expression must concatenate the normalized name with the state,
    // separated by a literal delimiter — not just emit the normalized name.
    assert.match(
      code,
      /generated always as \([\s\S]*?_normalize_place_token\([\s\S]*?\)\s*\|\|\s*'\|'\s*\|\|\s*lower\(trim\(coalesce\(state,''\)\)\)/,
      `${label}: generated column must concatenate normalized name || '|' || state, never the name alone`
    );
  });

  test(`ID3e ${label}: punctuation is normalized to a space, never deleted (the "(city)"/"city" token survives)`, () => {
    // regexp_replace(... , '[^a-z0-9]+', ' ', 'g') — replacement is a SPACE, not the empty string.
    const m = code.match(/regexp_replace\(lower\(coalesce\(p_text, ''\)\), '\[\^a-z0-9\]\+', '([^']*)', 'g'\)/);
    assert.ok(m, `${label}: expected the normalize function's regexp_replace call`);
    assert.equal(m[1], ' ', `${label}: punctuation must be replaced with a space, not deleted — deleting it would merge "RICHMOND(CITY)" into a bare "richmondcity" token instead of "richmond city"`);
  });

  test(`ID3e ${label}: the normalizer function is IMMUTABLE (required for a STORED generated column, and for correctness of the fold key)`, () => {
    assert.match(code, /language sql\s+immutable/i, `${label}: normalize function must be declared immutable`);
  });

  test(`ID3e ${label}: corrupted-state rows are routed to a review view, never silently repaired`, () => {
    assert.match(code, /create or replace view v_(gov|dia)_place_vocab_state_review/, `${label}: expected the state review view`);
    assert.match(code, /!~\s*'\^\[a-z\]\{2\}\$'/, `${label}: review view must test for a non-2-letter state, and nothing here may UPDATE the state column`);
    assert.doesNotMatch(code, /update\s+(properties|medicare_clinics)\s+set\s+state/i, `${label}: this migration must never write to the state column`);
  });

  test(`ID3e ${label}: no destructive rewrite of the source name/state columns`, () => {
    assert.doesNotMatch(code, /update\s+(properties|medicare_clinics)\s+set\s+(county|city)\s*=/i, `${label}: this migration must be additive (generated columns + views only), never rewrite county/city in place`);
  });

  test(`ID3e ${label}: parity/audit views exist so a consumer can see exactly what the fold merged`, () => {
    assert.match(code, /create or replace view v_(gov|dia)_(county|city)_fold_groups/, `${label}: expected at least one fold-groups parity view`);
    assert.match(code, /having count\(distinct (county|city)\) > 1/, `${label}: parity view must expose the raw variant count per group`);
  });
}

test('ID3e dia migration does not touch properties.property_type (scoped out as a taxonomy question)', () => {
  assert.doesNotMatch(
    stripSqlComments(DIA_SQL),
    /property_type/,
    'property_type is a semantic taxonomy decision (ID3e-property-type-taxonomy), not a vocabulary fold — this migration must not touch it'
  );
});
