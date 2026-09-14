// test/deal-comms-incremental-summary.test.mjs
// W7.2c — incremental summary compression: the prompt feeds the compressed
// history + only the new slice, and the parser round-trips compressed_block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIncrementalSummaryPrompt, parseSummaryResponse } from '../api/_shared/deal-comms-summary.js';

const mk = (id, on, over = {}) => ({
  activity_id: id, occurred_at: on, subject: `S-${id}`, body: `body ${id}`,
  sender: 's@x.com', direction: 'inbound', ...over,
});

test('incremental prompt includes the compressed block and only the new slice', () => {
  const deal = { entity_id: 'e1', deal_name: 'Banning Medical' };
  const compressed = 'PRIOR: LOI executed 2025-02-20; PSA circulated 2025-03-10.';
  const newComms = [mk('n1', '2026-03-30'), mk('n2', '2026-03-31')];
  const prompt = buildIncrementalSummaryPrompt(deal, newComms, compressed);
  assert.ok(prompt.includes('COMPRESSED HISTORY'), 'has the compressed-history section');
  assert.ok(prompt.includes(compressed), 'restates the prior compressed block');
  assert.ok(prompt.includes('NEW MESSAGES SINCE THE LAST UPDATE (2)'), 'feeds only the 2 new comms');
  assert.ok(prompt.includes('S-n1') && prompt.includes('S-n2'), 'new comms present');
  assert.ok(prompt.includes('"compressed_block"'), 'asks for an updated compressed block');
  assert.ok(/no-fabrication/i.test(prompt), 'no-fabrication contract present');
});

test('parser round-trips compressed_block alongside summary/topics/candidates', () => {
  const raw = JSON.stringify({
    summary: 'PSA fully executed; escrow opening next week.',
    topics: ['psa', 'escrow'],
    compressed_block: 'HISTORY: LOI 2025-02-20; PSA executed 2026-03-31.',
    milestone_candidates: [{ key: 'psa', label: 'PSA executed', date: '2026-03-31', confidence: 0.9 }],
  });
  const p = parseSummaryResponse(raw);
  assert.equal(p.summary, 'PSA fully executed; escrow opening next week.');
  assert.equal(p.compressed_block, 'HISTORY: LOI 2025-02-20; PSA executed 2026-03-31.');
  assert.deepEqual(p.topics, ['psa', 'escrow']);
  assert.equal(p.milestone_candidates[0].key, 'psa');
});

test('parser tolerates a missing compressed_block (→ null)', () => {
  const p = parseSummaryResponse(JSON.stringify({ summary: 'x', topics: [] }));
  assert.equal(p.compressed_block, null);
});
