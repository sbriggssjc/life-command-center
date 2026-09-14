// OC1 — the Outlook operator-note channel's category/subject detection.
// Pure function, no live DB. Also the dormancy-diagnosis regression test:
// asserts the pre-existing LCC/LCC:<hint> gate could never match an
// `LCC-Note` category (the bug this fix closes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOperatorNoteChannel } from '../api/_handlers/intake-tagged-comm.js';
import { parseLccCategoryHint } from '../api/_shared/deal-resolve.js';

test('DORMANCY DIAGNOSIS: the pre-existing LCC/LCC:<hint> regex never matched "LCC-Note"', () => {
  // This is the mechanism that made the LCC-Note category silently drop
  // every note for as long as the category existed — proven directly
  // against the SAME function the deal-resolution gate still uses below.
  const { tagged } = parseLccCategoryHint('LCC-Note');
  assert.equal(tagged, false, 'parseLccCategoryHint must NOT match LCC-Note (that is the dormancy cause)');
});

test('classifyOperatorNoteChannel recognizes the LCC-Note category, case/spacing-insensitive', () => {
  for (const cat of ['LCC-Note', 'lcc note', 'LCC_NOTE', ' Lcc-Note ']) {
    const r = classifyOperatorNoteChannel(cat, 'whatever subject');
    assert.equal(r.isLccNoteCategory, true, `expected ${JSON.stringify(cat)} to match`);
  }
});

test('classifyOperatorNoteChannel finds the category inside an array or a delimited string', () => {
  assert.equal(classifyOperatorNoteChannel(['Other', 'LCC-Note'], 'x').isLccNoteCategory, true);
  assert.equal(classifyOperatorNoteChannel('Other;LCC-Note', 'x').isLccNoteCategory, true);
});

test('classifyOperatorNoteChannel does not treat a plain LCC deal tag as a note', () => {
  const r = classifyOperatorNoteChannel('LCC', 'x');
  assert.equal(r.isLccNoteCategory, false);
  const r2 = classifyOperatorNoteChannel('LCC:DaVita Tulsa', 'x');
  assert.equal(r2.isLccNoteCategory, false);
});

test('classifyOperatorNoteChannel recognizes a reply to a briefing subject with no LCC tag', () => {
  const r = classifyOperatorNoteChannel(null, 'RE: Daily Briefing — 2026-09-11');
  assert.equal(r.isBriefingReply, true);
});

test('classifyOperatorNoteChannel requires BOTH "Re:" and a briefing subject marker', () => {
  assert.equal(classifyOperatorNoteChannel(null, 'Daily Briefing — 2026-09-11').isBriefingReply, false); // not a reply
  assert.equal(classifyOperatorNoteChannel(null, 'RE: Lunch tomorrow?').isBriefingReply, false); // not a briefing
});

test('classifyOperatorNoteChannel prefers the LCC-Note category over the briefing-reply arm', () => {
  const r = classifyOperatorNoteChannel('LCC-Note', 'RE: Daily Briefing — 2026-09-11');
  assert.equal(r.isLccNoteCategory, true);
  assert.equal(r.isBriefingReply, false);
});

test('classifyOperatorNoteChannel is false/false for an ordinary unrelated message', () => {
  const r = classifyOperatorNoteChannel('LCC', 'RE: Purchase agreement');
  assert.equal(r.isLccNoteCategory, false);
  assert.equal(r.isBriefingReply, false);
});
