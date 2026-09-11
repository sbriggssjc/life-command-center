// OWN-T0j — classify the gov OWN-T0a sponsor<->SPE disagreement population
// against LCC Opps' confirmed sponsor/SPE families (OWN-T0e).
//
// Pins:
//  1. A property whose true_owner name-keys to a CONFIRMED sponsor_token
//     classifies sponsor_family_confirmed.
//  2. One that doesn't classifies unclassified_rival.
//  3. A property with NO disagreement (name keys equal) appears in NEITHER
//     bucket.
//  4. normalizeGovNameKey is the byte-for-byte port of gov's own key
//     expression (paren-strip, lowercase, strip non-[a-z0-9]) — pinned on
//     named strings, including the exact "Boyd Watterson" / "(The)" shapes
//     this file's own doctrine warns are easy to get wrong (N15c/A2a).
//  5. classifyDisagreementBatch reports BOTH counts, never just the smaller
//     residual, and the two counts sum to the disagreement total.
//
// Anchored on exported function behaviour, not source text — the block-slice
// footgun this repo warns about repeatedly does not apply to pure functions
// invoked directly, but comments are still stripped before any literal-shape
// assertion so a future comment quoting a banned token cannot flip a test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGovNameKey, isDisagreement, buildConfirmedTokenSet,
  classifyDisagreement, classifyDisagreementBatch,
  OWNT0J_CLASS_CONFIRMED, OWNT0J_CLASS_UNCLASSIFIED,
} from '../api/_shared/ownt0j-sponsor-classifier.js';

// ---------------------------------------------------------------------------
// normalizeGovNameKey — named-row port fidelity
// ---------------------------------------------------------------------------
test('normalizeGovNameKey: strips parens, lowercases, strips non-alnum', () => {
  assert.equal(normalizeGovNameKey('Boyd Watterson Asset Management'), 'boydwattersonassetmanagement');
  assert.equal(normalizeGovNameKey('BOYD ASHBURN LLC'), 'boydashburnllc');
  assert.equal(normalizeGovNameKey('George Washington University (The)'), 'georgewashingtonuniversity');
  assert.equal(normalizeGovNameKey('NGP VI FALLS CHURCH VA, LLC'), 'ngpvifallschurchvallc');
  assert.equal(normalizeGovNameKey(null), '');
  assert.equal(normalizeGovNameKey(''), '');
  assert.equal(normalizeGovNameKey(undefined), '');
});

test('normalizeGovNameKey: two names differing only by parenthetical content key-equal', () => {
  const a = normalizeGovNameKey('Easterly Gov Properties (REIT)');
  const b = normalizeGovNameKey('Easterly Gov Properties');
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// isDisagreement
// ---------------------------------------------------------------------------
test('isDisagreement: identical name keys is NOT a disagreement', () => {
  const row = { transition_grantee_cleaned: 'Boyd Watterson Asset Management', true_owner_name: 'BOYD WATTERSON ASSET MANAGEMENT' };
  assert.equal(isDisagreement(row), false);
});

test('isDisagreement: different name keys IS a disagreement', () => {
  const row = { transition_grantee_cleaned: 'BOYD ASHBURN LLC', true_owner_name: 'Boyd Watterson Asset Management' };
  assert.equal(isDisagreement(row), true);
});

// ---------------------------------------------------------------------------
// classifyDisagreement — the three required behaviours
// ---------------------------------------------------------------------------
test('classifyDisagreement: true_owner name-keys to a CONFIRMED sponsor_token -> sponsor_family_confirmed', () => {
  const row = { transition_grantee_cleaned: 'BOYD ASHBURN LLC', true_owner_name: 'Boyd Watterson Asset Management' };
  const tokens = buildConfirmedTokenSet([{ sponsor_token: 'boyd', confirmed_at: '2026-08-27T14:09:45Z' }]);
  assert.equal(classifyDisagreement(row, tokens), OWNT0J_CLASS_CONFIRMED);
});

test('classifyDisagreement: no confirmed token matches -> unclassified_rival', () => {
  const row = { transition_grantee_cleaned: 'SOME SPE LLC', true_owner_name: 'Totally Unrelated Capital Partners' };
  const tokens = buildConfirmedTokenSet([{ sponsor_token: 'boyd', confirmed_at: '2026-08-27T14:09:45Z' }]);
  assert.equal(classifyDisagreement(row, tokens), OWNT0J_CLASS_UNCLASSIFIED);
});

test('classifyDisagreement: a NON-disagreeing row (name keys equal) returns null — neither bucket', () => {
  const row = { transition_grantee_cleaned: 'Boyd Watterson Asset Management', true_owner_name: 'BOYD WATTERSON ASSET MANAGEMENT' };
  const tokens = buildConfirmedTokenSet([{ sponsor_token: 'boyd', confirmed_at: '2026-08-27T14:09:45Z' }]);
  assert.equal(classifyDisagreement(row, tokens), null);
});

test('classifyDisagreement: a confirmed row with NO confirmed_at is not in the token set (never classifies)', () => {
  const row = { transition_grantee_cleaned: 'BOYD ASHBURN LLC', true_owner_name: 'Boyd Watterson Asset Management' };
  const tokens = buildConfirmedTokenSet([{ sponsor_token: 'boyd', confirmed_at: null }]);
  assert.equal(classifyDisagreement(row, tokens), OWNT0J_CLASS_UNCLASSIFIED);
});

test('classifyDisagreement: an empty true_owner_name on a disagreeing row is unclassified_rival, never a crash', () => {
  const row = { transition_grantee_cleaned: 'BOYD ASHBURN LLC', true_owner_name: null };
  const tokens = buildConfirmedTokenSet([{ sponsor_token: 'boyd', confirmed_at: '2026-08-27T14:09:45Z' }]);
  assert.equal(classifyDisagreement(row, tokens), OWNT0J_CLASS_UNCLASSIFIED);
});

// ---------------------------------------------------------------------------
// classifyDisagreementBatch — both counts, never just the residual
// ---------------------------------------------------------------------------
test('classifyDisagreementBatch: reports BOTH buckets and they sum to the disagreement total', () => {
  const rows = [
    { property_id: 1, transition_grantee_cleaned: 'BOYD ASHBURN LLC', true_owner_name: 'Boyd Watterson Asset Management' },
    { property_id: 2, transition_grantee_cleaned: 'Boyd Watterson Asset Management', true_owner_name: 'BOYD WATTERSON ASSET MANAGEMENT' }, // agrees — excluded
    { property_id: 3, transition_grantee_cleaned: 'RANDOM SPE LLC', true_owner_name: 'Unrelated Rival Capital' },
  ];
  const families = [{ sponsor_token: 'boyd', confirmed_at: '2026-08-27T14:09:45Z' }];
  const { rows: classified, counts } = classifyDisagreementBatch(rows, families);
  assert.equal(counts.comparable, 3);
  assert.equal(counts.disagree, 2);
  assert.equal(counts.sponsor_family_confirmed, 1);
  assert.equal(counts.unclassified_rival, 1);
  assert.equal(counts.sponsor_family_confirmed + counts.unclassified_rival, counts.disagree);
  assert.equal(classified.length, 2);
  assert.ok(classified.every((r) => r.property_id !== 2), 'agreeing row must not appear in the output');
  const confirmedRow = classified.find((r) => r.property_id === 1);
  assert.equal(confirmedRow.classification, OWNT0J_CLASS_CONFIRMED);
  assert.equal(confirmedRow.sponsor_match_token, 'boyd');
});

test('classifyDisagreementBatch: an empty confirmed-token set classifies every disagreement unclassified_rival', () => {
  const rows = [{ property_id: 1, transition_grantee_cleaned: 'BOYD ASHBURN LLC', true_owner_name: 'Boyd Watterson Asset Management' }];
  const { counts } = classifyDisagreementBatch(rows, []);
  assert.equal(counts.sponsor_family_confirmed, 0);
  assert.equal(counts.unclassified_rival, 1);
});
