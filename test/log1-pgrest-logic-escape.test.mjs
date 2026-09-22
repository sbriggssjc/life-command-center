// LOG1 regression test — PostgREST logical-operator value escaping.
// Root cause: encodeURIComponent hides reserved characters from the URL
// transport layer only; PostgREST decodes the query string before parsing
// its own and=/or= grammar, so a literal comma or paren inside a value used
// inside and=(...)/or=(...) still splits the expression and returns 400.
// See mcp/deal-email-matcher.js's pgrestLogicEsc for the fix and full context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pgrestLogicEsc } from '../mcp/deal-email-matcher.js';

test('LOG1: pgrestLogicEsc backslash-escapes commas', () => {
  assert.equal(pgrestLogicEsc('Midland Ave, Glenwood'), 'Midland Ave\\, Glenwood');
});

test('LOG1: pgrestLogicEsc backslash-escapes parentheses', () => {
  assert.equal(pgrestLogicEsc('ABC (Holdings) LLC'), 'ABC \\(Holdings\\) LLC');
});

test('LOG1: pgrestLogicEsc leaves plain values untouched', () => {
  assert.equal(pgrestLogicEsc('DaVita'), 'DaVita');
  assert.equal(pgrestLogicEsc('Fort Worth'), 'Fort Worth');
});

test('LOG1: pgrestLogicEsc escapes an existing backslash first (no double-unescape)', () => {
  assert.equal(pgrestLogicEsc('a\\,b'), 'a\\\\\\,b');
});

test('LOG1: pgrestLogicEsc handles null/undefined like String() would', () => {
  assert.equal(pgrestLogicEsc(null), 'null');
  assert.equal(pgrestLogicEsc(undefined), 'undefined');
});
