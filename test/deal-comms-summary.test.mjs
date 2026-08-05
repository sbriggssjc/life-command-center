// test/deal-comms-summary.test.mjs — W7.2 summary prompt builder + parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryPrompt, parseSummaryResponse, __test__ } from '../api/_shared/deal-comms-summary.js';

const comm = (i, over = {}) => ({
  activity_id: 'a' + i, occurred_at: `2026-0${(i % 9) + 1}-01T00:00:00Z`,
  subject: 'Subject ' + i, sender: 'sender' + i + '@x.com', body: 'Body text ' + i,
  direction: i % 2 ? 'inbound' : 'outbound', ...over,
});

test('prompt keeps newest detail, compresses older to one-liners', () => {
  const comms = Array.from({ length: 15 }, (_, i) => comm(i));
  const p = buildSummaryPrompt({ deal_name: 'Test Deal' }, comms);
  assert.match(p, /Deal: Test Deal/);
  assert.match(p, /MOST RECENT MESSAGES/);
  assert.match(p, /OLDER THREAD \(compressed to one-liners — 5 message/);
  // no-fabrication contract present
  assert.match(p, /Never write "presumably"/);
});

test('prompt handles empty corpus without throwing', () => {
  const p = buildSummaryPrompt({ deal_name: 'X' }, []);
  assert.match(p, /\(none\)/);
});

test('parse valid response', () => {
  const j = parseSummaryResponse('{"summary":"Buyer countered at 6.2%.","topics":["price","counter"],"milestone_candidates":[{"key":"LOI","label":"LOI received","date":"2026-08-01","confidence":0.9}]}');
  assert.equal(j.summary, 'Buyer countered at 6.2%.');
  assert.deepEqual(j.topics, ['price', 'counter']);
  assert.equal(j.milestone_candidates[0].key, 'loi'); // lowercased
  assert.equal(j.milestone_candidates[0].date, '2026-08-01');
});

test('parse tolerates prose wrapper / code fence', () => {
  const j = parseSummaryResponse('Here you go:\n```json\n{"summary":"ok"}\n```');
  assert.equal(j.summary, 'ok');
});

test('empty summary → null (a skip, never a blank write)', () => {
  assert.equal(parseSummaryResponse('{"summary":""}'), null);
  assert.equal(parseSummaryResponse('{"topics":["x"]}'), null);
  assert.equal(parseSummaryResponse('not json'), null);
  assert.equal(parseSummaryResponse(null), null);
});

test('bad date on candidate is dropped to null, not fabricated', () => {
  const j = parseSummaryResponse('{"summary":"s","milestone_candidates":[{"key":"psa","date":"soon"}]}');
  assert.equal(j.milestone_candidates[0].date, null);
});

test('oneLiner shows direction + date', () => {
  const l = __test__.oneLiner(comm(1));
  assert.match(l, /2026-02-01/);
  assert.match(l, /RECV|SENT/);
});
