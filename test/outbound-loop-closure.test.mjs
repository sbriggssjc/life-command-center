// W7.5 — outbound loop closure. Pure/injectable-dep tests (no live DB / AI).
//
// Invariants:
//   1. advanceOutboundTodos calls lcc_advance_todos (outbound) AND stamps
//      lcc_reconcile_deal_todo — mirroring handleOutlookSent's outbound branch.
//   2. findCrossPathDuplicate finds an existing row logged by the other path.
//   3. touchedActionLabels maps an lcc_advance_todos result to the touched set.
//   4. The action-summary validator drops a summary that references a to-do
//      label NOT actually touched (no fabrication); accepts a clean subset.
//   5. Flag off ⇒ no summary.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { advanceOutboundTodos, findCrossPathDuplicate } from '../api/_shared/outbound-advance.js';
import { touchedActionLabels, generateActionSummary } from '../api/_shared/action-summary.js';

describe('advanceOutboundTodos', () => {
  it('advances outbound to-dos and reconciles the deal_next_step', async () => {
    const calls = [];
    const opsQuery = async (m, path, body) => {
      calls.push({ path, body });
      if (path === 'rpc/lcc_advance_todos') return { ok: true, data: [{ ok: true, resolved_offer_review: true }] };
      return { ok: true, data: [] };
    };
    const r = await advanceOutboundTodos({
      opsQuery, dealEntityId: 'DEAL-1', partyEntityId: 'P-1', activityId: 'ACT-1',
      subject: 'Offer submitted', occurredAt: '2026-08-06T00:00:00Z',
    });
    const advance = calls.find(c => c.path === 'rpc/lcc_advance_todos');
    assert.ok(advance, 'lcc_advance_todos was called');
    assert.equal(advance.body.p_direction, 'outbound');
    assert.equal(advance.body.p_channel, 'email');
    const reconcile = calls.find(c => c.path === 'rpc/lcc_reconcile_deal_todo');
    assert.ok(reconcile, 'lcc_reconcile_deal_todo was called');
    assert.equal(reconcile.body.p_direction, 'outbound');
    assert.equal(r.reconcile, 'stamped');
    assert.ok(r.advance && r.advance.resolved_offer_review === true);
  });

  it('is a best-effort no-op when there is no anchor', async () => {
    let called = false;
    const opsQuery = async () => { called = true; return { ok: true, data: [] }; };
    const r = await advanceOutboundTodos({ opsQuery });
    assert.equal(called, false);
    assert.equal(r.advance, null);
  });
});

describe('findCrossPathDuplicate', () => {
  it('finds a row logged by the other outbound path', async () => {
    const opsQuery = async (m, path) => {
      assert.ok(path.includes('source_type=in.'));
      assert.ok(path.includes('external_id=eq.MSG-9'));
      return { ok: true, data: [{ id: 'A-1', source_type: 'outlook_sent' }] };
    };
    const r = await findCrossPathDuplicate({ opsQuery, workspaceId: 'WS', externalId: 'MSG-9', sourceTypes: ['outlook_sent'] });
    assert.equal(r.id, 'A-1');
    assert.equal(r.source_type, 'outlook_sent');
  });

  it('returns null when nothing matches', async () => {
    const opsQuery = async () => ({ ok: true, data: [] });
    const r = await findCrossPathDuplicate({ opsQuery, workspaceId: 'WS', externalId: 'MSG-X', sourceTypes: ['outlook_tagged'] });
    assert.equal(r, null);
  });
});

describe('touchedActionLabels', () => {
  it('maps resolved flags + created rows to labels', () => {
    const labels = touchedActionLabels({
      resolved_offer_review: true, resolved_reach_follow_up: true,
      created: [{ action_type: 'seller_follow_up' }],
    });
    assert.ok(labels.includes('offer_review'));
    assert.ok(labels.includes('follow_up'));
    assert.ok(labels.includes('seller_follow_up'));
  });
  it('returns [] for a null/empty result', () => {
    assert.deepEqual(touchedActionLabels(null), []);
    assert.deepEqual(touchedActionLabels({ ok: true }), []);
  });
});

describe('action-summary validator', () => {
  const withFlag = async (val, fn) => {
    const prev = process.env.W75_ACTION_SUMMARY;
    if (val === undefined) delete process.env.W75_ACTION_SUMMARY; else process.env.W75_ACTION_SUMMARY = val;
    try { return await fn(); } finally {
      if (prev === undefined) delete process.env.W75_ACTION_SUMMARY; else process.env.W75_ACTION_SUMMARY = prev;
    }
  };

  it('drops a summary that references a to-do NOT touched (no fabrication)', async () => {
    await withFlag('true', async () => {
      const invokeExtractionAI = async () => ({
        ok: true, data: { response: JSON.stringify({ summary: 'Closed the LOI review and the wire instructions.', referenced_todos: ['offer_review', 'wire_instructions'] }) },
      });
      const s = await generateActionSummary({ invokeExtractionAI, subject: 'Offer', touchedLabels: ['offer_review'] });
      assert.equal(s, null, 'fabricated referenced to-do drops the summary');
    });
  });

  it('accepts a summary whose references are a subset of touched labels', async () => {
    await withFlag('true', async () => {
      const invokeExtractionAI = async () => ({
        ok: true, data: { response: JSON.stringify({ summary: 'Submitted the offer, closing the offer-review to-do.', referenced_todos: ['offer_review'] }) },
      });
      const s = await generateActionSummary({ invokeExtractionAI, subject: 'Offer', touchedLabels: ['offer_review', 'follow_up'] });
      assert.equal(s, 'Submitted the offer, closing the offer-review to-do.');
    });
  });

  it('returns null when the flag is off (no AI call)', async () => {
    await withFlag(undefined, async () => {
      let called = false;
      const invokeExtractionAI = async () => { called = true; return { ok: true, data: { response: '{}' } }; };
      const s = await generateActionSummary({ invokeExtractionAI, touchedLabels: ['offer_review'] });
      assert.equal(s, null);
      assert.equal(called, false, 'flag off short-circuits before the AI call');
    });
  });

  it('returns null on AI failure (never throws)', async () => {
    await withFlag('true', async () => {
      const invokeExtractionAI = async () => { throw new Error('ollama down'); };
      const s = await generateActionSummary({ invokeExtractionAI, touchedLabels: ['offer_review'] });
      assert.equal(s, null);
    });
  });
});
