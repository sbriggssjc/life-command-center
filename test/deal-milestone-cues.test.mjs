// test/deal-milestone-cues.test.mjs — W7.2 deterministic milestone-cue engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMilestoneCues } from '../api/_shared/deal-milestone-cues.js';

const keys = (subj, body) => detectMilestoneCues(subj, body).map((c) => c.key).sort();

test('LOI executed → loi/past', () => {
  const c = detectMilestoneCues('LOI executed', 'The LOI is fully executed as of today.');
  assert.deepEqual(c.map((x) => x.key), ['loi']);
  assert.equal(c[0].status, 'past');
});

test('PSA draft circulated → psa/past', () => {
  const c = detectMilestoneCues('Re: contract', 'Attached is the PSA for your review — first draft of the PSA.');
  assert.equal(c[0].key, 'psa');
});

test('escrow opened + EMD wired both surface via escrow', () => {
  const c = detectMilestoneCues('Update', 'We opened escrow and the earnest money has been wired.');
  assert.deepEqual(c.map((x) => x.key), ['escrow']);
  assert.equal(c[0].status, 'past');
});

test('closing scheduled (future) → close/next', () => {
  const c = detectMilestoneCues('Timeline', 'Closing is scheduled for the 30th.');
  assert.equal(c[0].key, 'close');
  assert.equal(c[0].status, 'next');
});

test('closed (past) → close/past', () => {
  const c = detectMilestoneCues('Closed!', 'We closed the sale this morning and recorded the deed.');
  assert.equal(c[0].key, 'close');
  assert.equal(c[0].status, 'past');
});

test('due diligence started vs deadline', () => {
  assert.equal(detectMilestoneCues('', 'We are starting due diligence Monday.')[0].status, 'past');
  const d = detectMilestoneCues('', 'The due diligence period ends next Friday.');
  assert.equal(d[0].key, 'diligence');
  assert.equal(d[0].status, 'next');
});

test('multiple distinct cues in one message all fire', () => {
  const k = keys('Deal update', 'PSA executed and escrow is now open; targeting a close for June.');
  assert.deepEqual(k, ['close', 'escrow', 'psa']);
});

test('financing commitment', () => {
  assert.equal(detectMilestoneCues('', 'We received the loan commitment from the lender.')[0].key, 'financing');
});

test('marketing launch', () => {
  assert.equal(detectMilestoneCues('', 'The OM is live and we went to market this week.')[0].key, 'marketing');
});

test('no false positive on unrelated chatter', () => {
  assert.deepEqual(detectMilestoneCues('Lunch?', 'Want to grab lunch and discuss the market generally?'), []);
});

test('word-boundary: "employee" does not trip emd', () => {
  assert.deepEqual(detectMilestoneCues('', 'Our employee handled the paperwork.'), []);
});

test('empty input → []', () => {
  assert.deepEqual(detectMilestoneCues('', ''), []);
  assert.deepEqual(detectMilestoneCues(null, null), []);
});
