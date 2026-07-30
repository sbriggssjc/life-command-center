// test/next-step-ai.test.mjs
// Unit tests for the Phase 1 content-aware next-step engine (api/_shared/next-step-ai.js).
// Run: node --test test/next-step-ai.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveNextStep, classifyDeterministic, shapeFromIntent, parseModelJson, INTENT_MAP,
} from '../api/_shared/next-step-ai.js';

// --- deterministic classifier ---------------------------------------------

test('classifyDeterministic: "discuss with my partner / get back to you" -> will_get_back', () => {
  assert.equal(
    classifyDeterministic("Thanks Scott — I'll discuss with my partners and get back to you."),
    'will_get_back',
  );
});

test('classifyDeterministic: a counter number -> counter_offer', () => {
  assert.equal(classifyDeterministic('We can do it but we need to be at 8.2M.'), 'counter_offer');
});

test('classifyDeterministic: acceptance -> accepted', () => {
  assert.equal(classifyDeterministic('We accept your offer, let us know next steps.'), 'accepted');
});

test('classifyDeterministic: doc request -> requests_docs', () => {
  assert.equal(classifyDeterministic('Can you send the rent roll and T-12?'), 'requests_docs');
});

test('classifyDeterministic: call request -> wants_call', () => {
  assert.equal(classifyDeterministic('Give me a call tomorrow to talk it through.'), 'wants_call');
});

test('classifyDeterministic: pass -> declined', () => {
  assert.equal(classifyDeterministic('We decided to pass, going a different direction.'), 'declined');
});

test('classifyDeterministic: chit-chat -> null (escalate)', () => {
  assert.equal(classifyDeterministic('Great seeing you at ICSC last week!'), null);
});

test('classifyDeterministic: empty -> null', () => {
  assert.equal(classifyDeterministic(''), null);
  assert.equal(classifyDeterministic(null), null);
});

// --- shapeFromIntent -------------------------------------------------------

test('shapeFromIntent maps to canonical action_type + due offset', () => {
  const s = shapeFromIntent('will_get_back', { confidence: 0.85, source: 'deterministic' });
  assert.equal(s.action_type, 'seller_follow_up');
  assert.equal(s.due_offset, 1);
  assert.equal(s.intent, 'will_get_back');
  assert.equal(s.source, 'deterministic');
  assert.equal(typeof s.next_action, 'string');
});

test('shapeFromIntent: unclear -> null (generic fallback)', () => {
  assert.equal(shapeFromIntent('unclear'), null);
  assert.equal(shapeFromIntent('not_a_real_intent'), null);
});

test('shapeFromIntent honors a due override', () => {
  const s = shapeFromIntent('requests_docs', { dueOverride: 3 });
  assert.equal(s.due_offset, 3);
});

// --- parseModelJson --------------------------------------------------------

test('parseModelJson extracts JSON from a noisy string', () => {
  const j = parseModelJson('Sure! {"intent":"counter_offer","due_offset":0,"confidence":0.9} hope that helps');
  assert.equal(j.intent, 'counter_offer');
});

test('parseModelJson returns null on garbage', () => {
  assert.equal(parseModelJson('no json here'), null);
  assert.equal(parseModelJson(null), null);
});

// --- deriveNextStep (feature gate + fallbacks) ----------------------------

test('deriveNextStep returns null when NEXT_STEP_AI is unset', async () => {
  delete process.env.NEXT_STEP_AI;
  const r = await deriveNextStep('Re: offer', "I'll discuss with my partners and get back to you.", 'Snellville');
  assert.equal(r, null);
});

test('deriveNextStep: deterministic hit resolves without calling AI', async () => {
  process.env.NEXT_STEP_AI = '1';
  let aiCalled = false;
  const r = await deriveNextStep(
    'Re: offer',
    "I'll discuss with my partners and get back to you today.",
    'Snellville',
    { invokeExtractionAI: async () => { aiCalled = true; return { data: { response: '{}' } }; } },
  );
  assert.equal(aiCalled, false, 'deterministic path must not spend AI');
  assert.equal(r.action_type, 'seller_follow_up');
  assert.equal(r.source, 'deterministic');
  delete process.env.NEXT_STEP_AI;
});

test('deriveNextStep: ambiguous message escalates to AI and shapes the result', async () => {
  process.env.NEXT_STEP_AI = 'true';
  const r = await deriveNextStep(
    'quick thought',
    'Been mulling the whole thing over, lot of moving parts on my end.',
    'Snellville',
    { invokeExtractionAI: async () => ({ data: { response: '{"intent":"will_get_back","due_offset":2,"confidence":0.8}' } }) },
  );
  assert.equal(r.action_type, 'seller_follow_up');
  assert.equal(r.due_offset, 2);
  assert.equal(r.source, 'ai');
  delete process.env.NEXT_STEP_AI;
});

test('deriveNextStep: low-confidence AI verdict -> null (generic fallback)', async () => {
  process.env.NEXT_STEP_AI = '1';
  const r = await deriveNextStep(
    'hmm', 'vague words that trip nothing deterministic at all here',
    'Snellville',
    { invokeExtractionAI: async () => ({ data: { response: '{"intent":"counter_offer","due_offset":0,"confidence":0.3}' } }) },
  );
  assert.equal(r, null);
  delete process.env.NEXT_STEP_AI;
});

test('deriveNextStep: AI throwing never propagates -> null', async () => {
  process.env.NEXT_STEP_AI = '1';
  const r = await deriveNextStep(
    'hmm', 'vague words that trip nothing deterministic at all here',
    'Snellville',
    { invokeExtractionAI: async () => { throw new Error('provider 500'); } },
  );
  assert.equal(r, null);
  delete process.env.NEXT_STEP_AI;
});

test('deriveNextStep: AI "unclear" -> null (generic fallback)', async () => {
  process.env.NEXT_STEP_AI = '1';
  const r = await deriveNextStep(
    'hi', 'totally ambiguous filler that matches no keyword',
    'Snellville',
    { invokeExtractionAI: async () => ({ data: { response: '{"intent":"unclear","due_offset":0,"confidence":0.9}' } }) },
  );
  assert.equal(r, null);
  delete process.env.NEXT_STEP_AI;
});

// Sanity: every non-null INTENT_MAP entry has a canonical action_type + numeric due.
test('INTENT_MAP entries are well-formed', () => {
  for (const [k, v] of Object.entries(INTENT_MAP)) {
    if (v == null) continue;
    assert.equal(typeof v.action_type, 'string', `${k}.action_type`);
    assert.equal(typeof v.verb, 'string', `${k}.verb`);
    assert.equal(typeof v.due, 'number', `${k}.due`);
  }
});
