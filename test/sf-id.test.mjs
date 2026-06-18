// CONNECTIVITY #3 Unit 0 — Salesforce id matching + classification helper.
// The 15↔18 checksum cases are anchored against REAL ids from the live LCC
// external_identities(salesforce, Account) store (verified 2026-06-18):
//   0011I00000h7mHE → 0011I00000h7mHEQAY   (suffix QAY)
//   0011I00000h7yOi → 0011I00000h7yOiQAI   (suffix QAI)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sf15, sfIdsMatch, toSf18, classifySfId, isAccountId, isContactId } from '../api/_shared/sf-id.js';

describe('sf15', () => {
  it('returns the 15-char base of a 15 or 18-char id', () => {
    assert.equal(sf15('0011I00000h7mHE'), '0011I00000h7mHE');
    assert.equal(sf15('0011I00000h7mHEQAY'), '0011I00000h7mHE');
  });
  it('rejects malformed / empty', () => {
    assert.equal(sf15(''), null);
    assert.equal(sf15(null), null);
    assert.equal(sf15('short'), null);
    assert.equal(sf15(undefined), null);
  });
});

describe('toSf18 (standard SF checksum, anchored to live ids)', () => {
  it('expands 15 → 18 with the correct checksum suffix', () => {
    assert.equal(toSf18('0011I00000h7mHE'), '0011I00000h7mHEQAY');
    assert.equal(toSf18('0011I00000h7yOi'), '0011I00000h7yOiQAI');
  });
  it('returns an already-18 id unchanged', () => {
    assert.equal(toSf18('0011I00000h7mHEQAY'), '0011I00000h7mHEQAY');
  });
  it('returns null for non-15/18 input', () => {
    assert.equal(toSf18('001'), null);
    assert.equal(toSf18(''), null);
    assert.equal(toSf18(null), null);
  });
});

describe('sfIdsMatch (15↔18, case-sensitive)', () => {
  it('matches a 15-char domain id to its 18-char LCC counterpart', () => {
    assert.equal(sfIdsMatch('0011I00000h7mHE', '0011I00000h7mHEQAY'), true);
    assert.equal(sfIdsMatch('0011I00000h7mHEQAY', '0011I00000h7mHE'), true);
  });
  it('does NOT match different ids', () => {
    assert.equal(sfIdsMatch('0011I00000h7mHE', '0011I00000h7mHX'), false);
    assert.equal(sfIdsMatch('0011I00000h7mHEQAY', '0011I00000h7mHXQAY'), false);
  });
  it('is case-sensitive on the 15-char base (SF ids ARE case-significant)', () => {
    assert.equal(sfIdsMatch('0011I00000h7mHE', '0011I00000h7MhE'), false);
  });
  it('null / malformed never matches', () => {
    assert.equal(sfIdsMatch(null, '0011I00000h7mHEQAY'), false);
    assert.equal(sfIdsMatch('bad', 'bad'), false);
  });
});

describe('classifySfId', () => {
  it('classifies by key prefix', () => {
    assert.equal(classifySfId('0011I00000h7mHE').kind, 'Account');
    assert.equal(classifySfId('0031I00000h7mHE').kind, 'Contact');
    assert.equal(classifySfId('00Q1I00000h7mHE').kind, 'Lead');
    assert.equal(classifySfId('0061I00000h7mHE').kind, 'Opportunity');
    assert.equal(classifySfId('0091I00000h7mHE').kind, 'other');
  });
  it('flags malformed ids invalid', () => {
    assert.equal(classifySfId('001').kind, 'invalid');
    assert.equal(classifySfId('').kind, 'invalid');
    assert.equal(classifySfId(null).kind, 'invalid');
  });
  it('isAccountId / isContactId convenience', () => {
    assert.equal(isAccountId('0011I00000h7mHE'), true);
    assert.equal(isAccountId('0031I00000h7mHE'), false);
    assert.equal(isContactId('0031I00000h7mHE'), true);
    assert.equal(isContactId('0011I00000h7mHE'), false);
  });
});
