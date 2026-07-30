// W3.3 Unit 2 — gov recorded→true owner resolver normalizer + similarity.
// Guards that exact-normalized matching (auto-link) is distinguished from a
// fuzzy/substring match (route to review), replacing the old unanchored
// `canonical_name=ilike.*X*` first-row-wins substring resolver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { govOwnerStrictCoreJS, nameBigramSimilarity } from '../api/_handlers/sidebar-pipeline.js';

test('govOwnerStrictCoreJS: legal-form variants share a core (auto-link)', () => {
  // pure legal-form differences collapse to the same core -> exact match
  assert.equal(govOwnerStrictCoreJS('Beretta Investment Group LLC'),
               govOwnerStrictCoreJS('Beretta Investment Group'));
  assert.equal(govOwnerStrictCoreJS('AX Madison Greenway L.P.'),
               govOwnerStrictCoreJS('AX MADISON GREENWAY LP'));
  assert.equal(govOwnerStrictCoreJS('Allison Holdings, L.L.C.'),
               govOwnerStrictCoreJS('ALLISON HOLDINGS LLC'));
  assert.equal(govOwnerStrictCoreJS('Sterling Properties LLLP'),
               govOwnerStrictCoreJS('Sterling Properties'));
});

test('govOwnerStrictCoreJS: semantic-token differences do NOT collapse (route to review)', () => {
  // CO / COMPANY / PARTNERSHIP are kept — these are different cores, so the
  // resolver must NOT auto-link them.
  assert.notEqual(govOwnerStrictCoreJS('Cowperwood Co.'),
                  govOwnerStrictCoreJS('Cowperwood Company'));
  assert.notEqual(govOwnerStrictCoreJS('Rooker'),
                  govOwnerStrictCoreJS('Rooker Co.'));
  assert.notEqual(govOwnerStrictCoreJS('Tutvedt Family'),
                  govOwnerStrictCoreJS('Tutvedt Family Partnership'));
  // a bare substring is NOT an exact core (the old bug: "Smith" matched
  // "Smith Medical Holdings")
  assert.notEqual(govOwnerStrictCoreJS('Smith'),
                  govOwnerStrictCoreJS('Smith Medical Holdings LLC'));
});

test('govOwnerStrictCoreJS: empty / legal-only names yield empty core', () => {
  assert.equal(govOwnerStrictCoreJS(''), '');
  assert.equal(govOwnerStrictCoreJS('LLC'), '');
  assert.equal(govOwnerStrictCoreJS(null), '');
});

test('nameBigramSimilarity: bounded [0,1], identical=1, disjoint=0', () => {
  assert.equal(nameBigramSimilarity('abc', 'abc'), 1);
  assert.equal(nameBigramSimilarity('', 'abc'), 0);
  assert.equal(nameBigramSimilarity('abcdef', 'xyzuvw'), 0);
  const s = nameBigramSimilarity('smithmedical', 'smithmedicalholdings');
  assert.ok(s > 0 && s < 1, `expected partial similarity, got ${s}`);
});
