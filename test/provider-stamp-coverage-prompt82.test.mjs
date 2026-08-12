// Prompt 82 — Close the provider-stamp coverage gap.
//
// Grounding (live, 2026-08-08): since the prompt-61 deploy only 4/15 fresh
// staged_intake_extractions rows carried extraction_snapshot._provider — the
// sidebar / cloud-fallback channels wrote bare snapshots while ollama rows
// stamped. The fix routes EVERY writer through the shared ensureProviderStamp
// helper and re-asserts it at the single DB write site so 100% of persisted
// snapshots carry a `_provider`.
//
// This file has two halves:
//   1. Unit coverage for ensureProviderStamp (shape, idempotency, none-fallback).
//   2. A STRUCTURAL guard: every code path that writes an `extraction_snapshot`
//      to staged_intake_extractions must first pass it through ensureProviderStamp.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ensureProviderStamp, buildProviderStamp,
  stripNonSaleKeys, reconstructProviderStampFromDiagnostics,
} from '../api/_shared/intake-extraction-prompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ---------------------------------------------------------------------------
// #1 — ensureProviderStamp unit behavior
// ---------------------------------------------------------------------------
describe('Prompt 82 — ensureProviderStamp', () => {
  const NOW = '2026-08-08T00:00:00.000Z';

  it('stamps from the ai call sidechannel (same shape as buildProviderStamp + stamped_at)', () => {
    const snap = { document_type: 'om' };
    const info = {
      final_provider: 'openai', final_model: 'gpt-4o-mini', fell_back: true,
      tried: [{ stage: 'primary' }, { stage: 'fallback' }],
    };
    ensureProviderStamp(snap, info, NOW);
    assert.deepEqual(snap._provider, { ...buildProviderStamp(info), stamped_at: NOW });
    assert.equal(snap._provider.final_provider, 'openai');
    assert.equal(snap._provider.fell_back, true);
    assert.deepEqual(snap._provider.chain, ['primary', 'fallback']);
  });

  it('stamps {final_provider:"none"} when there was genuinely no AI call', () => {
    const snap = { document_type: 'om' };
    ensureProviderStamp(snap, null, NOW);
    assert.deepEqual(snap._provider, {
      final_provider: 'none', final_model: null, fell_back: false, chain: [], stamped_at: NOW,
    });
  });

  it('is idempotent — an accurate per-artifact stamp is never overwritten', () => {
    const existing = { final_provider: 'ollama', final_model: 'qwen2.5:14b', fell_back: false, chain: ['local'], stamped_at: '2026-08-07T00:00:00.000Z' };
    const snap = { document_type: 'om', _provider: existing };
    ensureProviderStamp(snap, { final_provider: 'openai' }, NOW);
    assert.deepEqual(snap._provider, existing); // untouched
  });

  it('never omits the stamp on a real snapshot — absence must mean "old row", not "unknown path"', () => {
    for (const info of [null, undefined, {}, { final_provider: 'openai' }]) {
      const snap = { document_type: 'om' };
      ensureProviderStamp(snap, info, NOW);
      assert.ok(snap._provider && typeof snap._provider === 'object', `no _provider for info=${JSON.stringify(info)}`);
      assert.ok('final_provider' in snap._provider);
    }
  });

  it('no-ops on a null/non-object snapshot', () => {
    assert.equal(ensureProviderStamp(null, {}, NOW), null);
    assert.equal(ensureProviderStamp(undefined, {}, NOW), undefined);
  });
});

// ---------------------------------------------------------------------------
// Prompt 93 — sold_* strip + diagnostics reconstruction
// ---------------------------------------------------------------------------
describe('Prompt 93 — stripNonSaleKeys', () => {
  it('nulls sold_price/sold_cap_rate for an on-market doctype', () => {
    for (const dt of ['om', 'flyer', 'marketing_brochure', 'brochure', 'listing_agreement', 'valuation_proposal']) {
      const snap = { document_type: dt, sold_price: 15730000, sold_cap_rate: 0.06, cap_rate: 0.065 };
      stripNonSaleKeys(snap);
      assert.equal(snap.sold_price, null, dt);
      assert.equal(snap.sold_cap_rate, null, dt);
      assert.equal(snap.cap_rate, 0.065, `${dt} keeps the asking cap`);
    }
  });

  it('leaves a real sale doctype untouched (comp/psa keep sold_*)', () => {
    for (const dt of ['comp', 'psa', 'sale', null]) {
      const snap = { document_type: dt, sold_price: 15730000, sold_cap_rate: 0.06 };
      stripNonSaleKeys(snap);
      assert.equal(snap.sold_price, 15730000, String(dt));
      assert.equal(snap.sold_cap_rate, 0.06, String(dt));
    }
  });

  it('is idempotent and no-ops on a null/non-object snapshot', () => {
    const snap = { document_type: 'om', sold_price: null, sold_cap_rate: null };
    stripNonSaleKeys(snap);
    assert.deepEqual(snap, { document_type: 'om', sold_price: null, sold_cap_rate: null });
    assert.equal(stripNonSaleKeys(null), null);
  });
});

describe('Prompt 93 — reconstructProviderStampFromDiagnostics', () => {
  const NOW = '2026-08-12T00:00:00.000Z';

  it('rebuilds an accurate stamp from the winning diagnostic (fallback burst shape)', () => {
    const diagnostics = [{
      ai_ok: true, ai_final_provider: 'openai', ai_final_model: 'gpt-4o-mini-2024-07-18',
      ai_fell_back: true,
      ai_chain: [{ stage: 'primary', provider: 'edge', status: 400 }, { stage: 'fallback', provider: 'openai', status: 200 }],
    }];
    const stamp = reconstructProviderStampFromDiagnostics(diagnostics, NOW);
    assert.deepEqual(stamp, {
      final_provider: 'openai', final_model: 'gpt-4o-mini-2024-07-18', fell_back: true,
      chain: ['primary', 'fallback'], stamped_at: NOW, reconstructed_from: 'diagnostics',
    });
  });

  it('prefers a successful diagnostic over a failed one', () => {
    const stamp = reconstructProviderStampFromDiagnostics([
      { ai_ok: false, ai_final_provider: 'edge', ai_chain: [] },
      { ai_ok: true, ai_final_provider: 'ollama', ai_final_model: 'qwen2.5:14b', ai_chain: [{ stage: 'local' }] },
    ], NOW);
    assert.equal(stamp.final_provider, 'ollama');
    assert.deepEqual(stamp.chain, ['local']);
  });

  it('returns null when no diagnostic names a provider (unreconstructable)', () => {
    assert.equal(reconstructProviderStampFromDiagnostics([], NOW), null);
    assert.equal(reconstructProviderStampFromDiagnostics(null, NOW), null);
    assert.equal(reconstructProviderStampFromDiagnostics([{ ai_ok: true, ai_final_provider: null }], NOW), null);
  });
});

// ---------------------------------------------------------------------------
// #2 — Structural guard: every extraction_snapshot writer stamps first.
// ---------------------------------------------------------------------------
// staged_intake_extractions has exactly ONE DB writer (intake-extractor.js).
// This guard fails loudly if a NEW bare writer is introduced, or the write-site
// stamp is removed — the exact regression Prompt 82 closes.
describe('Prompt 82 — structural: no bare extraction_snapshot writer', () => {
  // Files that may legitimately construct/persist an extraction_snapshot write body.
  const writerModules = [
    'api/_handlers/intake-extractor.js',
  ];

  it('the sole DB writer routes the persisted snapshot through ensureProviderStamp', () => {
    const src = readFileSync(join(repoRoot, 'api/_handlers/intake-extractor.js'), 'utf8');
    // The write body is `extraction_snapshot: mergedSnapshot` in the POST to the table.
    const writeIdx = src.indexOf("opsQuery('POST', 'staged_intake_extractions'");
    assert.ok(writeIdx > 0, 'expected a POST to staged_intake_extractions');
    // ensureProviderStamp(mergedSnapshot, ...) must appear shortly BEFORE the write.
    const preamble = src.slice(Math.max(0, writeIdx - 800), writeIdx);
    assert.match(preamble, /ensureProviderStamp\(mergedSnapshot,/,
      'the persisted snapshot must be stamped by ensureProviderStamp before the write');
    assert.match(src, /import\s+\{[^}]*ensureProviderStamp[^}]*\}\s+from\s+'\.\.\/_shared\/intake-extraction-prompt\.js'/,
      'intake-extractor.js must import ensureProviderStamp from the shared module');
    // Prompt 93: the same write site deterministically strips closed-sale keys
    // from an on-market snapshot (the sold_* drift guard) before persisting.
    assert.match(preamble, /stripNonSaleKeys\(mergedSnapshot\)/,
      'the persisted snapshot must pass through stripNonSaleKeys before the write');
  });

  it('no OTHER api module writes staged_intake_extractions without importing the stamp helper', () => {
    // Scan the api tree for any POST/insert to the extractions table; any such
    // module MUST import ensureProviderStamp (the one stamp path). This catches
    // a future sidebar/stage-om/admin re-run writer added bare.
    let hits = '';
    try {
      hits = execSync(
        `grep -rln "staged_intake_extractions" api/ --include=*.js`,
        { cwd: repoRoot, encoding: 'utf8' }
      );
    } catch (_) { /* grep exit 1 = no matches */ }
    const files = hits.split('\n').map(s => s.trim()).filter(Boolean);
    for (const f of files) {
      const src = readFileSync(join(repoRoot, f), 'utf8');
      // Only care about modules that actually WRITE (POST) the table.
      const writes = /opsQuery\(\s*['"]POST['"]\s*,\s*['"]staged_intake_extractions['"]/.test(src)
        || /['"]staged_intake_extractions['"][^;]*\bPrefer\b/.test(src);
      if (!writes) continue;
      assert.ok(
        /ensureProviderStamp/.test(src),
        `${f} writes staged_intake_extractions but does not stamp via ensureProviderStamp`
      );
      assert.ok(
        writerModules.includes(f),
        `${f} is a NEW extraction_snapshot writer — add it to writerModules and confirm it stamps`
      );
    }
  });

  // Prompt 93: the Aug-10 burst escaped because the guard only scanned api/ JS —
  // an EDGE FUNCTION writer (supabase/functions) would not be caught. Extend the
  // net so a Deno/edge writer that persists an extraction_snapshot to
  // staged_intake_extractions cannot ship a bare snapshot unnoticed.
  it('no edge function writes staged_intake_extractions bare', () => {
    let hits = '';
    try {
      hits = execSync(
        `grep -rln "staged_intake_extractions" supabase/functions/ --include=*.ts`,
        { cwd: repoRoot, encoding: 'utf8' }
      );
    } catch (_) { /* grep exit 1 = no matches (the current, correct state) */ }
    const files = hits.split('\n').map(s => s.trim()).filter(Boolean);
    for (const f of files) {
      const src = readFileSync(join(repoRoot, f), 'utf8');
      // Only flag modules that INSERT/UPSERT the table (a POST, PostgREST insert,
      // or supabase-js .from('staged_intake_extractions').insert/upsert).
      const writes = /staged_intake_extractions['"]\s*\)\s*\.\s*(insert|upsert)/.test(src)
        || /(POST|insert|upsert)[^;\n]*staged_intake_extractions/i.test(src);
      if (!writes) continue;
      assert.match(
        src, /_provider|ensureProviderStamp|reconstructProviderStampFromDiagnostics/,
        `${f} (edge fn) writes staged_intake_extractions but never stamps _provider`
      );
    }
  });
});
