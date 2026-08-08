// Prompt 80 — Match-disambiguation pre-rank assist. Unit tests for the PURE
// brain (prompt/parse/normalize the ranking, candidate-key, agree/disagree
// scoring) plus structural guards that admin.js / server.js / ops.js / the
// migration are wired the way the W8 doctrine requires: the assist ANNOTATES
// (never a verdict), the lane sorts by the assist's top confidence, and every
// human verdict records agree/disagree.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  candidateKey, buildMatchDisambigPrompt, parseAssistJson,
  normalizeAssistRanking, cardFromDecision, assistAgreement,
} from '../api/_shared/match-disambig-assist.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CARD = {
  intake_id: '551',
  address: '100 Main St, Tulsa OK',
  tenant: 'SSA',
  candidates: [
    { domain: 'gov', property_id: '24703', address: '100 Main St', tenant: 'SSA', confidence: 0.72 },
    { domain: 'gov', property_id: '24999', address: '100 Maine Ave', tenant: 'DHS', confidence: 0.51 },
    { domain: 'dia', property_id: '8080', address: '100 Main Street', tenant: null, confidence: 0.44 },
  ],
};

describe('candidateKey', () => {
  it('joins domain + property_id stably, tolerating types', () => {
    assert.equal(candidateKey({ domain: 'gov', property_id: 24703 }), 'gov:24703');
    assert.equal(candidateKey({ domain: 'dia', property_id: '8080' }), 'dia:8080');
    assert.equal(candidateKey({}), ':');
    assert.equal(candidateKey(null), ':');
  });
});

describe('buildMatchDisambigPrompt', () => {
  const prompt = buildMatchDisambigPrompt(CARD);
  it('grounds on the card fields and forbids inventing candidates', () => {
    assert.match(prompt, /ONLY annotate/);
    assert.match(prompt, /NEVER invent/);
    assert.match(prompt, /100 Main St/);
    assert.match(prompt, /"recommended_action"|recommended_action/);
  });
  it('embeds every candidate id', () => {
    assert.match(prompt, /24703/);
    assert.match(prompt, /24999/);
    assert.match(prompt, /8080/);
  });
});

describe('parseAssistJson', () => {
  it('parses fenced and bare JSON, null on garbage', () => {
    assert.deepEqual(parseAssistJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseAssistJson('prefix {"b":2} suffix'), { b: 2 });
    assert.equal(parseAssistJson('not json'), null);
    assert.equal(parseAssistJson(''), null);
  });
});

describe('normalizeAssistRanking — bounded, never invents a candidate', () => {
  it('drops a hallucinated candidate not in the card', () => {
    const raw = { ranking: [
      { domain: 'gov', property_id: '24703', confidence: 0.9, reason: 'exact address + SSA' },
      { domain: 'gov', property_id: '99999', confidence: 0.95, reason: 'hallucinated' }, // not a card candidate
    ], recommended_action: 'pick' };
    const a = normalizeAssistRanking(raw, CARD, { model: 'qwen2.5:14b', at: 'T' });
    const keys = a.ranking.map((r) => candidateKey(r));
    assert.ok(!keys.includes('gov:99999'), 'hallucinated candidate must be dropped');
    assert.equal(a.ranking.length, CARD.candidates.length, 'exactly the card candidates');
  });
  it('appends omitted candidates at confidence 0 and ranks best-first', () => {
    const raw = { ranking: [{ domain: 'gov', property_id: '24999', confidence: 0.4, reason: 'ok' }], recommended_action: 'uncertain' };
    const a = normalizeAssistRanking(raw, CARD);
    assert.equal(a.ranking.length, 3);
    // best-first: the 0.4 leads, the two appended 0-confidence follow.
    assert.equal(a.ranking[0].confidence, 0.4);
    assert.equal(a.ranking[1].confidence, 0);
    assert.equal(a.ranking[0].rank, 1);
    assert.equal(a.ranking[2].rank, 3);
  });
  it('clamps confidence and computes top_pick + top_confidence', () => {
    const raw = { ranking: [
      { domain: 'gov', property_id: '24703', confidence: 5, reason: 'x' },
      { domain: 'dia', property_id: '8080', confidence: -2, reason: 'y' },
    ], recommended_action: 'pick' };
    const a = normalizeAssistRanking(raw, CARD);
    assert.equal(a.ranking[0].confidence, 1);
    assert.deepEqual(a.top_pick, { domain: 'gov', property_id: '24703' });
    assert.equal(a.top_confidence, 1);
  });
  it('defaults an unknown recommended_action to uncertain', () => {
    const a = normalizeAssistRanking({ ranking: [], recommended_action: 'merge' }, CARD);
    assert.equal(a.recommended_action, 'uncertain');
  });
});

describe('cardFromDecision', () => {
  it('reads the producer context shape', () => {
    const card = cardFromDecision({ context: { intake_id: 5, address: 'A', tenant: 'T', candidates: [{ domain: 'gov', property_id: 1 }] } });
    assert.equal(card.intake_id, '5');
    assert.equal(card.candidates.length, 1);
  });
  it('is safe on a null/empty context', () => {
    assert.deepEqual(cardFromDecision({}).candidates, []);
    assert.deepEqual(cardFromDecision(null).candidates, []);
  });
});

describe('assistAgreement — self-measuring loop', () => {
  const assistPick = { recommended_action: 'pick', top_pick: { domain: 'gov', property_id: '24703' } };
  it('agrees when the human picks the assist top pick', () => {
    const ag = assistAgreement(assistPick, { action: 'pick', domain: 'gov', property_id: '24703' });
    assert.equal(ag.measured, true);
    assert.equal(ag.agreed, true);
  });
  it('disagrees when the human picks a different candidate', () => {
    const ag = assistAgreement(assistPick, { action: 'pick', domain: 'dia', property_id: '8080' });
    assert.equal(ag.measured, true);
    assert.equal(ag.agreed, false);
  });
  it('disagrees when human creates a property but the assist recommended pick', () => {
    const ag = assistAgreement(assistPick, { action: 'create_property' });
    assert.equal(ag.measured, true);
    assert.equal(ag.agreed, false);
  });
  it('agrees when both say create_property', () => {
    const ag = assistAgreement({ recommended_action: 'create_property' }, { action: 'create_property' });
    assert.equal(ag.agreed, true);
  });
  it('does not measure a research/defer verdict', () => {
    assert.equal(assistAgreement(assistPick, { action: 'research' }).measured, false);
  });
  it('does not measure when there is no assist', () => {
    assert.equal(assistAgreement(null, { action: 'pick', domain: 'gov', property_id: '1' }).measured, false);
  });
});

// ---------------------------------------------------------------------------
// Structural wiring guards — the doctrine is enforced at the code boundary.
// ---------------------------------------------------------------------------
describe('structural wiring guards (admin.js + server.js + ops.js + migration)', () => {
  const admin = readFileSync(join(root, 'api/admin.js'), 'utf8');
  const server = readFileSync(join(root, 'server.js'), 'utf8');
  const ops = readFileSync(join(root, 'ops.js'), 'utf8');
  const mig = readFileSync(join(root, 'supabase/migrations/20260808120000_lcc_prompt80_match_disambig_assist.sql'), 'utf8');

  it('the tick route is mounted in server.js and dispatched in admin.js', () => {
    assert.match(server, /\/api\/match-disambig-assist-tick'/);
    assert.match(admin, /case 'match-disambig-assist-tick':\s*return handleMatchDisambigAssistTick/);
  });

  it('the tick is flag-gated (MATCH_DISAMBIG_ASSIST) and no-ops OFF on POST', () => {
    assert.match(admin, /MATCH_DISAMBIG_ASSIST/);
    assert.match(admin, /matchDisambigAssistEnabled/);
    assert.match(admin, /skipped:\s*'feature_flag_off'/);
  });

  it('the annotation writes ONLY via the metadata-only RPC, NEVER a verdict RPC', () => {
    // Isolate the tick handler body and assert it never records a verdict.
    const start = admin.indexOf('async function handleMatchDisambigAssistTick');
    assert.ok(start > 0, 'handler present');
    const end = admin.indexOf('\n// ====', start);
    const body = admin.slice(start, end > start ? end : start + 6000);
    assert.match(body, /rpc\/lcc_annotate_match_disambig_assist/);
    assert.ok(!/lcc_record_decision_verdict/.test(body), 'the assist tick must never record a decision verdict');
    assert.ok(!/staged_intake_matches/.test(body), 'the assist tick must never write a match');
  });

  it('the annotation SQL writer is metadata-only (cannot touch verdict/status)', () => {
    const fnStart = mig.indexOf('FUNCTION public.lcc_annotate_match_disambig_assist');
    const fnEnd = mig.indexOf('$fn$;', fnStart);
    const fn = mig.slice(fnStart, fnEnd);
    assert.match(fn, /SET metadata =/);
    // The SET clause (everything between SET and the WHERE gate) may only assign
    // metadata + updated_at — never verdict/status. The WHERE legitimately gates
    // on status = 'open', so scope the check to the assignment region.
    const setClause = fn.slice(fn.indexOf('SET '), fn.indexOf('WHERE'));
    assert.ok(!/\bverdict\b/.test(setClause), 'annotation writer must not set verdict');
    assert.ok(!/\bstatus\b/.test(setClause), 'annotation writer must not set status');
    assert.match(fn, /decision_type = 'match_disambiguation'/);
    assert.match(fn, /status = 'open'/);
  });

  it('the lane list selects metadata and orders match_disambiguation by the assist top confidence', () => {
    assert.match(admin, /context,metadata,rank_value/);
    assert.match(admin, /metadata->assist_top_conf\.desc\.nullslast/);
  });

  it('the verdict handler records agree/disagree via the metadata-only RPC', () => {
    assert.match(admin, /rpc\/lcc_record_match_assist_agreement/);
    assert.match(admin, /recordAssistAgreement\(\{ action: 'pick'/);
    assert.match(admin, /recordAssistAgreement\(\{ action: 'create_property'/);
  });

  it('ops.js renders the assist rank/reason and a one-click "assist agrees" confirm', () => {
    assert.match(ops, /metadata[\s\S]{0,40}assist/);
    assert.match(ops, /Assist agrees/);
    assert.match(ops, /assist #/);
  });

  it('the migration registers the feature flag and the U4 accuracy view', () => {
    assert.match(mig, /feature_flags_registry/);
    assert.match(mig, /'MATCH_DISAMBIG_ASSIST'/);
    assert.match(mig, /v_lcc_w8_u4_match_assist_accuracy/);
  });
});
