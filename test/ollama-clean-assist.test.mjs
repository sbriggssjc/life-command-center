import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function cleanAssistBlock() {
  const src = read('api/admin.js');
  const start = src.indexOf('PROMPT 32 — OLLAMA CLEANING-ASSIST TICK');
  const m = src.slice(start).match(/\/\/ =+\r?\n\/\/ PRIORITY BAND/);
  assert.ok(start > 0, 'clean-assist block not found');
  assert.ok(m, 'clean-assist block end not found');
  return src.slice(start, start + m.index);
}

describe('Prompt 32 Ollama cleaning-assist guardrails', () => {
  it('uses invokeExtractionAI and writes proposals, not canonical data', () => {
    const block = cleanAssistBlock();
    // Prompt 61: the seam call now carries a per-surface tag ({ prompt, surface: 'clean_assist' }).
    assert.match(block, /invokeExtractionAI\(\{ prompt(, surface: '[a-z_]+')? \}\)/);
    assert.match(block, /lcc_clean_assist_proposals\?on_conflict=/);
    assert.match(block, /CLEAN_ASSIST_SOURCE\s*=\s*'ollama_clean_assist'/);

    for (const forbidden of [
      'lcc_merge_entity',
      'dia_merge_property',
      'gov_merge_property',
      'lcc_merge_field',
      'apply-change',
      'sales_transactions?',
      'properties?',
    ]) {
      assert.equal(block.includes(forbidden), false, `clean-assist worker must not call ${forbidden}`);
    }
  });

  it('is feature flagged, mounted, and visible in Health', () => {
    const admin = read('api/admin.js');
    const server = read('server.js');
    const migration = read('supabase/migrations/20260804140000_lcc_prompt32_ollama_clean_assist.sql');

    assert.match(admin, /case 'ollama-clean-assist-tick'/);
    assert.match(server, /\/api\/ollama-clean-assist-tick/);
    assert.match(admin, /feature_flags_registry\?flag=eq\.OLLAMA_CLEAN_ASSIST/);
    assert.match(admin, /v_lcc_clean_assist_health/);
    assert.match(migration, /INSERT INTO public\.feature_flags_registry[\s\S]*'OLLAMA_CLEAN_ASSIST'/);
    assert.match(migration, /cron\.schedule\([\s\S]*'ollama-clean-assist-tick'/);
  });

  it('decorates existing Decision Center cards instead of adding a parallel lane', () => {
    const ops = read('ops.js');
    const admin = read('api/admin.js');
    assert.match(ops, /function _cleanAssistHTML/);
    assert.match(ops, /Ollama assist:/);
    assert.match(admin, /attachCleanAssistProposals/);
    assert.doesNotMatch(ops, /ollama_clean_assist['"]/);
  });
});
