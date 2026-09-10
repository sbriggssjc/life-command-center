import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  titleFunctionHint, buildRoleInferencePrompt, parseRoleInferenceResponse,
  resolveCandidateFunction, inferBenchRoles,
} from '../api/_shared/bench-role-inference-planner.js';

// --------------------------------------------------------------------------
// titleFunctionHint — deterministic, no LLM.
// --------------------------------------------------------------------------
test('titleFunctionHint: EVP - Acquisitions & Portfolio Manager classifies as acquisitions (Pulliam\'s real title, not "portfolio manager" -> transaction_dd)', () => {
  const h = titleFunctionHint('Executive Vice President - Acquisitions and Portfolio Manager');
  assert.ok(h);
  assert.equal(h.function, 'acquisitions');
  assert.equal(h.confidence, 'high');
  assert.equal(h.basis, 'title');
});

test('titleFunctionHint: a Due Diligence / Transaction Manager title classifies as transaction_dd', () => {
  const h = titleFunctionHint('Due Diligence and Transaction Manager');
  assert.equal(h.function, 'transaction_dd');
});

test('titleFunctionHint: null/empty title returns null (no hint, must fall to correspondence)', () => {
  assert.equal(titleFunctionHint(null), null);
  assert.equal(titleFunctionHint(''), null);
  assert.equal(titleFunctionHint('   '), null);
});

test('titleFunctionHint: an unmapped title (e.g. a generic "Manager") returns null, not a guess', () => {
  assert.equal(titleFunctionHint('Office Manager'), null);
});

// --------------------------------------------------------------------------
// buildRoleInferencePrompt — pure string builder, no I/O.
// --------------------------------------------------------------------------
test('buildRoleInferencePrompt includes the taxonomy and every subject line', () => {
  const prompt = buildRoleInferencePrompt({
    personName: 'Andrew Pulliam', title: null,
    subjectLines: ['188 Harvest Lane, Williston, VT - Escrow 202500342NCS - Closing Documents', 'draft press release'],
  });
  assert.match(prompt, /acquisitions/);
  assert.match(prompt, /disposition/);
  assert.match(prompt, /transaction_dd/);
  assert.match(prompt, /broker/);
  assert.match(prompt, /Escrow 202500342NCS - Closing Documents/);
  assert.match(prompt, /draft press release/);
});

// --------------------------------------------------------------------------
// parseRoleInferenceResponse — the verbatim-quote guard (W8-U3/EXT1 doctrine).
// --------------------------------------------------------------------------
test('parseRoleInferenceResponse accepts a well-formed response whose quote IS verbatim', () => {
  const subjectLines = ['RE: 188 Harvest Lane, Williston, VT - Escrow 202500342NCS - Closing Documents'];
  const raw = JSON.stringify({
    function: 'acquisitions', confidence: 'medium',
    evidence_quote: '188 Harvest Lane, Williston, VT - Escrow 202500342NCS - Closing Documents',
  });
  const out = parseRoleInferenceResponse(raw, { subjectLines });
  assert.equal(out.function, 'acquisitions');
  assert.equal(out.confidence, 'medium');
  assert.ok(out.evidence_quote);
});

test('parseRoleInferenceResponse DROPS the whole verdict when the quote is not verbatim in any subject line (hallucinated citation)', () => {
  const subjectLines = ['RE: Williston PSA'];
  const raw = JSON.stringify({
    function: 'acquisitions', confidence: 'high',
    evidence_quote: 'a sentence that was never in any subject line',
  });
  const out = parseRoleInferenceResponse(raw, { subjectLines });
  assert.equal(out.function, null);
  assert.equal(out.confidence, null);
  assert.equal(out.evidence_quote, null);
});

test('parseRoleInferenceResponse rejects an out-of-taxonomy function value (never invents a fifth bucket)', () => {
  const raw = JSON.stringify({ function: 'ceo', confidence: 'high', evidence_quote: null });
  const out = parseRoleInferenceResponse(raw, { subjectLines: [] });
  assert.equal(out.function, null);
});

test('parseRoleInferenceResponse returns null (parse failure) on unparseable garbage, distinct from a genuine abstention', () => {
  const out = parseRoleInferenceResponse('not json at all', { subjectLines: [] });
  assert.equal(out, null);
});

test('parseRoleInferenceResponse: an honest abstention (function: null) is preserved, not treated as a parse failure', () => {
  const raw = JSON.stringify({ function: null, confidence: 'low', evidence_quote: null });
  const out = parseRoleInferenceResponse(raw, { subjectLines: [] });
  assert.notEqual(out, null);
  assert.equal(out.function, null);
});

// --------------------------------------------------------------------------
// THE CORE GUARD (P181): a NULL-title, correspondence-only candidate must
// never report high confidence — regardless of what the model itself claims.
// --------------------------------------------------------------------------
test('resolveCandidateFunction: title present and mapped -> high confidence, basis=title', () => {
  const r = resolveCandidateFunction({ title: 'EVP - Acquisitions', aiResult: null });
  assert.equal(r.function, 'acquisitions');
  assert.equal(r.confidence, 'high');
  assert.equal(r.basis, 'title');
});

test('resolveCandidateFunction: NO title, AI claims high confidence -> CAPPED to medium, never high', () => {
  const r = resolveCandidateFunction({
    title: null,
    aiResult: { function: 'acquisitions', confidence: 'high', evidence_quote: 'quoted text' },
  });
  assert.equal(r.function, 'acquisitions');
  assert.notEqual(r.confidence, 'high');
  assert.equal(r.confidence, 'medium');
  assert.equal(r.basis, 'correspondence_inferred');
});

test('resolveCandidateFunction: title present but UNMAPPED (e.g. "Office Manager"), AI claims high -> still capped, basis says title_unmapped', () => {
  const r = resolveCandidateFunction({
    title: 'Office Manager',
    aiResult: { function: 'transaction_dd', confidence: 'high', evidence_quote: 'x' },
  });
  assert.notEqual(r.confidence, 'high');
  assert.equal(r.basis, 'title_unmapped_correspondence_inferred');
});

test('resolveCandidateFunction: no title, no AI result at all -> null function, null confidence, never fabricated', () => {
  const r = resolveCandidateFunction({ title: null, aiResult: null });
  assert.equal(r.function, null);
  assert.equal(r.confidence, null);
  assert.equal(r.basis, 'no_title_no_evidence');
});

test('resolveCandidateFunction: AI abstains (function: null) even with no title -> honoured as null, not overridden', () => {
  const r = resolveCandidateFunction({
    title: null,
    aiResult: { function: null, confidence: 'low', evidence_quote: null },
  });
  assert.equal(r.function, null);
  assert.equal(r.confidence, null);
});

test('resolveCandidateFunction: AI low/medium confidence with no title is passed through unchanged (only "high" is capped)', () => {
  const low = resolveCandidateFunction({ title: null, aiResult: { function: 'broker', confidence: 'low', evidence_quote: null } });
  assert.equal(low.confidence, 'low');
  const med = resolveCandidateFunction({ title: null, aiResult: { function: 'broker', confidence: 'medium', evidence_quote: null } });
  assert.equal(med.confidence, 'medium');
});

// --------------------------------------------------------------------------
// inferBenchRoles — orchestration with an injectable `invoke` (no real Ollama
// call in tests).
// --------------------------------------------------------------------------
test('inferBenchRoles: a titled candidate never calls the AI at all (deterministic path short-circuits)', async () => {
  let called = false;
  const invoke = async () => { called = true; return { data: { response: '{}' } }; };
  const out = await inferBenchRoles(
    [{ name: 'X', title: 'EVP - Acquisitions', subject_lines: ['hello'] }],
    { invoke },
  );
  assert.equal(called, false);
  assert.equal(out[0].inferred_function, 'acquisitions');
  assert.equal(out[0].inferred_function_confidence, 'high');
  assert.equal(out[0].inferred_function_basis, 'title');
});

test('inferBenchRoles: an untitled candidate with subject lines calls the AI and CAPS its confidence', async () => {
  const invoke = async () => ({
    data: {
      response: JSON.stringify({
        function: 'acquisitions', confidence: 'high', evidence_quote: 'Closing Documents',
      }),
    },
  });
  const out = await inferBenchRoles(
    [{ name: 'Andrew Pulliam', title: null, subject_lines: ['RE: 188 Harvest Lane - Closing Documents'] }],
    { invoke },
  );
  assert.equal(out[0].inferred_function, 'acquisitions');
  assert.notEqual(out[0].inferred_function_confidence, 'high');
  assert.equal(out[0].inferred_function_confidence, 'medium');
  assert.equal(out[0].inferred_function_basis, 'correspondence_inferred');
});

test('inferBenchRoles: an untitled candidate with NO subject lines at all (Shuler-shaped: never resolves) never calls the AI and abstains honestly', async () => {
  let called = false;
  const invoke = async () => { called = true; return { data: { response: '{}' } }; };
  const out = await inferBenchRoles([{ name: 'Lucas Shuler', title: null, subject_lines: [] }], { invoke });
  assert.equal(called, false);
  assert.equal(out[0].inferred_function, null);
  assert.equal(out[0].inferred_function_confidence, null);
  assert.equal(out[0].inferred_function_basis, 'no_title_no_evidence');
});

test('inferBenchRoles: a throwing invoke never crashes the batch and abstains for that candidate', async () => {
  const invoke = async () => { throw new Error('network down'); };
  const out = await inferBenchRoles(
    [{ name: 'X', title: null, subject_lines: ['a subject'] }],
    { invoke },
  );
  assert.equal(out[0].inferred_function, null);
});
