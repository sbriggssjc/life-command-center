import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

// P129: this used to END-anchor on the far-away '// PRIORITY BAND' banner. That
// was correct when written, but api/admin.js grew and FIVE unrelated assist
// subsystems (match-disambig P80, property-twin P106, junk-prescreen P62,
// naming-hygiene P79, dup-pair P63) landed in between — so the extracted "block"
// swelled to 2,465 lines / 136,932 bytes and the P106 guardrail below started
// catching a NEIGHBOUR's legitimate read (resolveHygieneAddressBatch's
// 'properties?' address lookup, admin.js:3035) as a clean-assist doctrine breach.
// Same failure class as P126 '</table>' and P128 U3: a test that slices a source
// block breaks when the source moves.
//
// Anchor on admin.js's own section-banner convention instead — the PROMPT 32
// banner, its body (which starts at the CLEAN_ASSIST_SOURCE constant the test
// already asserts on), and the NEXT section's opening banner — and then PROVE the
// boundary held, so a future over-run fails loudly instead of silently widening.
const SECTION_BANNER = /^\/\/ ={10,}[ \t]*$/m;

function cleanAssistBlock() {
  const src = read('api/admin.js');
  const start = src.indexOf('PROMPT 32 — OLLAMA CLEANING-ASSIST TICK');
  assert.ok(start > 0, 'clean-assist section start not found');
  // Step past this section's OWN banner box before hunting the next banner.
  const bodyStart = src.indexOf("const CLEAN_ASSIST_SOURCE = 'ollama_clean_assist'", start);
  assert.ok(bodyStart > start, 'clean-assist section body (CLEAN_ASSIST_SOURCE) not found');
  const m = src.slice(bodyStart).match(SECTION_BANNER);
  assert.ok(m, 'clean-assist section end (next section banner) not found');
  const block = src.slice(start, bodyStart + m.index);

  // Boundary proof, self-maintaining (no allowlist of neighbour names to rot):
  // the clean-assist section owns exactly ONE top-level route handler. If the
  // extraction ever swallows an adjacent subsystem again, this trips first and
  // names the real problem instead of mis-reporting a P106 breach.
  const handlers = block.match(/^(?:async )?function (handle[A-Za-z0-9_]*)/gm) || [];
  assert.deepEqual(
    handlers.map((h) => h.replace(/^(?:async )?function /, '')),
    ['handleOllamaCleanAssistTick'],
    'clean-assist block over-ran into an adjacent handler — re-anchor the section boundary',
  );
  return block;
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
