// test/deal-comms-propagate-tick.test.mjs
// ============================================================================
// W7.2 — deal-comms propagation tick, tested against the REAL ops-db opsQuery,
// mocked at the FETCH level (W7.1 posture). Covers: summary versioning flip,
// deterministic milestone cue → write with detail_ref, LLM-candidate → confirm
// lane (NO milestone write), recent-inbound-only to-do generation + dedupe,
// AI-failure keeps prior summary + counts skip, and empty-batch idempotency.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.supabase.co';
process.env.OPS_SUPABASE_KEY = 'test-key';
process.env.OLLAMA_URL = 'https://ollama.test';      // makes invokeExtractionAI resolve locally (no 35s cloud backoff)
process.env.DEAL_COMMS_PROPAGATE_ENABLED = '1';
delete process.env.NEXT_STEP_AI;                     // deterministic next-step classifier only

const DEAL = 'c3bc3125-c9b9-4c7b-801d-b1d4bf715f59';

// A programmable PostgREST + Ollama fetch mock that records every call.
function installFetch({ deals, summaryJson, todoCreated, replySlaCandidates, replySlaCreated }) {
  const calls = [];
  const list = (arr) => ({ ok: true, status: 200, text: async () => JSON.stringify(arr),
    headers: { get: (h) => (h === 'content-range' ? `0-${Math.max(0, arr.length - 1)}/${arr.length}` : null) } });
  const scalar = (v) => ({ ok: true, status: 200, text: async () => JSON.stringify(v), headers: { get: () => null } });

  global.fetch = async (url, opts) => {
    const u = String(url); const method = opts?.method || 'GET';
    let body = null; try { body = opts?.body ? JSON.parse(opts.body) : null; } catch { body = opts?.body; }
    calls.push({ u, method, body });

    if (u.includes('/v1/chat/completions')) {
      const payload = { choices: [{ message: { content: summaryJson } }], model: 'test' };
      return { ok: true, status: 200, headers: { get: () => null },
        json: async () => payload, text: async () => JSON.stringify(payload) };
    }
    if (u.includes('rpc/lcc_deal_comms_unpropagated')) return scalar(deals);
    if (u.includes('rpc/lcc_deal_reply_sla_candidates')) return list(replySlaCandidates ?? []);
    if (u.includes('rpc/lcc_deal_record_milestone')) return scalar({ outcome: 'inserted', id: 'm1' });
    if (u.includes('rpc/lcc_open_decision')) return scalar(1234);
    if (u.includes('rpc/lcc_party_role')) return scalar(null);
    if (u.includes('rpc/lcc_advance_todos')) {
      const isReplySla = body && body.p_direction === 'reply_sla';
      const created = isReplySla ? (replySlaCreated ?? [{ id: 'r1' }]) : (todoCreated ?? [{ id: 't1' }]);
      return scalar({ ok: true, created });
    }
    if (u.includes('lcc_deal_correspondence_summary')) return list([{ id: 's1' }]);
    if (u.includes('lcc_dossiers')) return list([]); // no stored dossier → dossier step skipped
    if (u.includes('context_packets')) return list([]);
    if (u.includes('lcc_deal_comm_propagated')) return list([]);
    if (u.includes('lcc_deal_comms_propagation_run_log')) return list([{ run_id: 77 }]);
    return list([]);
  };
  return calls;
}

const mkComm = (id, over = {}) => ({
  activity_id: id, occurred_at: new Date().toISOString(), source_type: 'lcc:deal_match',
  is_new: true, is_inbound: false, is_recent: true, subject: 'Subject', sender: 's@x.com',
  body: 'body', direction: 'outbound', party_entity_id: null, ...over,
});

async function runTick(query = {}) {
  const { handleDealCommsPropagateTick } = await import('../api/_handlers/deal-comms-propagate-tick.js');
  let out = null;
  const res = { status(c) { this._s = c; return this; }, json(p) { out = { status: this._s || 200, body: p }; return this; } };
  await handleDealCommsPropagateTick({ query, body: {} }, res);
  return out;
}

const validSummary = JSON.stringify({ summary: 'Buyer engaged; PSA executed.', topics: ['psa'], milestone_candidates: [] });

test('summary refresh flips is_current then inserts a new current row', async () => {
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal', comms: [mkComm('a1', { body: 'general update' })] }];
  const calls = installFetch({ deals, summaryJson: validSummary });
  const out = await runTick();
  assert.equal(out.body.ok, true);
  assert.equal(out.body.summaries_written, 1);
  const patch = calls.find((c) => c.method === 'PATCH' && c.u.includes('lcc_deal_correspondence_summary') && c.u.includes('is_current=eq.true'));
  const post = calls.find((c) => c.method === 'POST' && c.u.includes('lcc_deal_correspondence_summary'));
  assert.ok(patch, 'prior is_current rows are demoted first');
  assert.equal(patch.body.is_current, false);
  assert.ok(post, 'a new summary row is inserted');
  assert.equal(post.body.is_current, true);
  assert.equal(post.body.source, 'comms_tick');
});

test('deterministic milestone cue → lcc_deal_record_milestone with detail_ref; no confirm lane', async () => {
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal',
    comms: [mkComm('a1', { subject: 'PSA', body: 'The PSA is fully executed.' })] }];
  const calls = installFetch({ deals, summaryJson: validSummary });
  const out = await runTick();
  assert.equal(out.body.milestones_written, 1);
  const ms = calls.find((c) => c.u.includes('rpc/lcc_deal_record_milestone'));
  assert.ok(ms, 'milestone writer called');
  assert.equal(ms.body.p_key, 'psa');
  assert.equal(ms.body.p_source, 'comms_tick');
  assert.equal(ms.body.p_detail_ref, 'a1', 'detail_ref points at the activity');
  assert.ok(!calls.some((c) => c.u.includes('rpc/lcc_open_decision')), 'no confirm lane for a deterministic cue');
});

test('LLM-only candidate → milestone_confirm lane, NO milestone write', async () => {
  const summ = JSON.stringify({ summary: 'Escrow likely soon per call.', topics: [],
    milestone_candidates: [{ key: 'escrow', label: 'Escrow opening', date: '2026-08-10', confidence: 0.7 }] });
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal',
    comms: [mkComm('a1', { body: 'we spoke on the phone' })] }]; // no deterministic escrow cue
  const calls = installFetch({ deals, summaryJson: summ });
  const out = await runTick();
  assert.equal(out.body.milestone_candidates, 1);
  assert.equal(out.body.milestones_written, 0);
  const dec = calls.find((c) => c.u.includes('rpc/lcc_open_decision'));
  assert.ok(dec, 'a confirm lane decision is opened');
  assert.equal(dec.body.p_decision_type, 'milestone_confirm');
  assert.equal(dec.body.p_subject_ref, `mstone:${DEAL}:escrow:2026-08-10`);
  assert.ok(!calls.some((c) => c.u.includes('rpc/lcc_deal_record_milestone')), 'LLM candidate never writes a milestone');
});

test('to-do generated only for recent inbound matcher-backfill comms', async () => {
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal', comms: [
    mkComm('recent_in', { is_inbound: true, is_recent: true, direction: 'inbound', subject: 'Re: your listing' }),
    mkComm('old_in', { is_inbound: true, is_recent: false, direction: 'inbound' }),      // too old → no to-do
    mkComm('recent_out', { is_inbound: false, is_recent: true, direction: 'outbound' }), // sent → no to-do
  ] }];
  const calls = installFetch({ deals, summaryJson: validSummary, todoCreated: [{ id: 't1' }] });
  const out = await runTick();
  const advances = calls.filter((c) => c.u.includes('rpc/lcc_advance_todos'));
  assert.equal(advances.length, 1, 'exactly one to-do path — only the recent inbound comm');
  assert.equal(advances[0].body.p_activity_id, 'recent_in');
  assert.equal(out.body.todos_generated, 1);
  assert.equal(out.body.todos_deduped, 0);
});

test('already-todo`d inbound comm counts as deduped (existence-guard returns no created rows)', async () => {
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal',
    comms: [mkComm('recent_in', { is_inbound: true, is_recent: true, direction: 'inbound' })] }];
  installFetch({ deals, summaryJson: validSummary, todoCreated: [] }); // guard deduped
  const out = await runTick();
  assert.equal(out.body.todos_generated, 0);
  assert.equal(out.body.todos_deduped, 1);
});

test('AI failure (unparseable summary) keeps prior summary and counts skip', async () => {
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal', comms: [mkComm('a1')] }];
  const calls = installFetch({ deals, summaryJson: 'the model is down, no json here' });
  const out = await runTick();
  assert.equal(out.body.summary_skipped, 1);
  assert.equal(out.body.summaries_written, 0);
  assert.ok(!calls.some((c) => c.method === 'POST' && c.u.includes('lcc_deal_correspondence_summary')),
    'no summary row written when the model output is unusable');
});

test('new comms are ledgered (consumed) on a live tick', async () => {
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal', comms: [mkComm('a1'), mkComm('a2')] }];
  const calls = installFetch({ deals, summaryJson: validSummary });
  const out = await runTick();
  assert.equal(out.body.comms_consumed, 2);
  const led = calls.find((c) => c.method === 'POST' && c.u.includes('lcc_deal_comm_propagated'));
  assert.ok(led, 'ledger insert happened');
  assert.equal(led.body.length, 2, 'both new comms ledgered');
});

test('empty batch → zero work, nothing ledgered (idempotent re-run contract)', async () => {
  const calls = installFetch({ deals: [], summaryJson: validSummary });
  const out = await runTick();
  assert.equal(out.body.deals_scanned, 0);
  assert.equal(out.body.comms_consumed, 0);
  assert.ok(!calls.some((c) => c.u.includes('lcc_deal_comm_propagated')), 'no ledger writes on an empty batch');
});

test('dry_run reports without writing or ledgering', async () => {
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal',
    comms: [mkComm('a1', { subject: 'PSA', body: 'PSA is fully executed.' })] }];
  const calls = installFetch({ deals, summaryJson: validSummary });
  const out = await runTick({ dry_run: '1' });
  assert.equal(out.body.dry_run, true);
  assert.equal(out.body.deals[0].deterministic_cues, 1);
  assert.ok(!calls.some((c) => c.u.includes('rpc/lcc_deal_record_milestone')), 'dry run writes nothing');
  assert.ok(!calls.some((c) => c.u.includes('lcc_deal_comm_propagated')), 'dry run ledgers nothing');
});

test('reply-SLA generates a reply_overdue to-do per tripping deal (dedupe left to the guard)', async () => {
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal', comms: [mkComm('a1')] }];
  const calls = installFetch({
    deals, summaryJson: validSummary,
    replySlaCandidates: [{ entity_id: DEAL, deal_name: 'Test Deal', last_inbound_at: '2026-08-01T00:00:00Z', last_sender: 'buyer@x.com', business_days: 4 }],
    replySlaCreated: [{ id: 'r1' }],
  });
  const out = await runTick();
  assert.equal(out.body.reply_overdue_generated, 1);
  const sla = calls.find((c) => c.u.includes('rpc/lcc_advance_todos') && c.body?.p_direction === 'reply_sla');
  assert.ok(sla, 'reply_sla advance_todos called');
  assert.equal(sla.body.p_next_type, 'reply_overdue');
  assert.ok(String(sla.body.p_next_action).startsWith('Reply overdue — Test Deal:'), 'title shape');
  assert.equal(sla.body.p_next_due_offset, 3, 'threshold constant passed');
});

test('reply-SLA guard-deduped (no created rows) → 0 generated', async () => {
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal', comms: [mkComm('a1')] }];
  installFetch({
    deals, summaryJson: validSummary,
    replySlaCandidates: [{ entity_id: DEAL, deal_name: 'Test Deal', last_inbound_at: '2026-08-01T00:00:00Z', last_sender: 'b@x', business_days: 5 }],
    replySlaCreated: [],   // existence-guard already had an open reply_overdue
  });
  const out = await runTick();
  assert.equal(out.body.reply_overdue_generated, 0);
});

test('reply-SLA dry-count reported, nothing written', async () => {
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal', comms: [mkComm('a1')] }];
  const calls = installFetch({
    deals, summaryJson: validSummary,
    replySlaCandidates: [{ entity_id: DEAL, deal_name: 'Test Deal', last_inbound_at: '2026-08-01T00:00:00Z', last_sender: 'b@x', business_days: 6 }],
  });
  const out = await runTick({ dry_run: '1' });
  assert.equal(out.body.reply_sla_candidates, 1);
  assert.ok(!calls.some((c) => c.u.includes('rpc/lcc_advance_todos')), 'dry run generates no reply_overdue to-do');
});

test('milestone rolled_up outcome is counted separately from written', async () => {
  const deals = [{ entity_id: DEAL, deal_name: 'Test Deal',
    comms: [mkComm('a1', { subject: 'LOI', body: 'sending you the LOI' })] }];
  global.__ROLLUP = true;
  const calls = installFetch({ deals, summaryJson: validSummary });
  // override the milestone RPC to report a roll-up
  const base = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('rpc/lcc_deal_record_milestone')) {
      return { ok: true, status: 200, headers: { get: () => null },
        text: async () => JSON.stringify({ outcome: 'rolled_up', id: 'm1' }) };
    }
    return base(url, opts);
  };
  const out = await runTick();
  assert.equal(out.body.milestones_written, 0);
  assert.equal(out.body.milestones_rolled_up, 1);
  void calls;
});

test('flag off (no force/dry_run) → skipped', async () => {
  delete process.env.DEAL_COMMS_PROPAGATE_ENABLED;
  installFetch({ deals: [], summaryJson: validSummary });
  const out = await runTick();
  assert.equal(out.body.skipped, 'flag_off');
  process.env.DEAL_COMMS_PROPAGATE_ENABLED = '1';
});
