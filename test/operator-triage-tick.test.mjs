// OC2 — the triage tick's on-box-Ollama classification path, stubbed (no
// network — invokeOnPremGeneration is injected, never the real one).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWithOllama } from '../api/_handlers/operator-triage-tick.js';

function stubGenerate(text, ok = true) {
  return async () => ({ ok, text, provider: 'ollama' });
}

test('classifyWithOllama parses a well-formed JSON verdict', async () => {
  const generate = stubGenerate(JSON.stringify({
    note_type: 'data-gap', lane: 'comps', severity: 'medium', title: 'Missing cap rate on export',
  }));
  const v = await classifyWithOllama({ raw_text: 'the export is missing a cap rate column', context: {} }, generate);
  assert.equal(v.note_type, 'data-gap');
  assert.equal(v.lane, 'comps');
  assert.equal(v.severity, 'medium');
  assert.equal(v.title, 'Missing cap rate on export');
  assert.equal(v.source, 'onprem_ollama');
});

test('classifyWithOllama fails closed on a model error (no cloud fallback)', async () => {
  const generate = async () => ({ ok: false, error: 'OLLAMA_URL unset', text: '' });
  const v = await classifyWithOllama({ raw_text: 'x', context: {} }, generate);
  assert.equal(v, null);
});

test('classifyWithOllama fails closed on unparsable JSON — never guesses', async () => {
  const generate = stubGenerate('not json at all');
  const v = await classifyWithOllama({ raw_text: 'x', context: {} }, generate);
  assert.equal(v, null);
});

test('classifyWithOllama rejects a note_type outside the closed vocabulary', async () => {
  const generate = stubGenerate(JSON.stringify({ note_type: 'feature', severity: 'low' }));
  const v = await classifyWithOllama({ raw_text: 'x', context: {} }, generate);
  assert.equal(v, null);
});

test('classifyWithOllama defaults severity to low when the model omits it', async () => {
  const generate = stubGenerate(JSON.stringify({ note_type: 'idea' }));
  const v = await classifyWithOllama({ raw_text: 'x', context: {} }, generate);
  assert.equal(v.note_type, 'idea');
  assert.equal(v.severity, 'low');
});

test('classifyWithOllama throws are caught by the caller (generate rejects)', async () => {
  const generate = async () => { throw new Error('timeout'); };
  const v = await classifyWithOllama({ raw_text: 'x', context: {} }, generate);
  assert.equal(v, null);
});
