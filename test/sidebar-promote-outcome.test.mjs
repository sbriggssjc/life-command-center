// W1.4-L3b (2026-07-29) — stop the sidebar's "Promote to DB" from failing
// silently on an empty capture.
//
// Repro: a promote ran on a capture with NO extracted content — the domain
// classifier's searchText was just the literal entity name (45 chars,
// hasPdfTexts=false, matchedPattern='none') — and the pipeline wrote
// _pipeline_status='failed' with domain:null, zero DB writes, and NO
// user-visible error in the sidebar.
//
// pipelinePromoteOutcome() is the pure policy that turns the propagation result
// + classified domain into the explicit success/failure the API response
// surfaces to the extension. These tests lock the failed-pipeline response path.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pipelinePromoteOutcome } from '../api/_handlers/sidebar-pipeline.js';

describe('pipelinePromoteOutcome (W1.4-L3b failed-promote response path)', () => {
  it('the exact repro: no domain classified → failed, reason no_domain_classified', () => {
    // allDomains.length === 0 → propagateToDomainDb(null) → { propagated:false, reason:'no_domain' }
    assert.deepEqual(
      pipelinePromoteOutcome({ propagated: false, domain: null, reason: 'no_domain' }),
      { pipeline_status: 'failed', pipeline_failed: true, pipeline_reason: 'no_domain' });
  });

  it('no domain and no reason supplied → synthesizes no_domain_classified', () => {
    assert.deepEqual(
      pipelinePromoteOutcome({ propagated: false, domain: null }),
      { pipeline_status: 'failed', pipeline_failed: true, pipeline_reason: 'no_domain_classified' });
  });

  it('domain classified but write failed → failed, reason surfaced', () => {
    assert.deepEqual(
      pipelinePromoteOutcome({ propagated: false, domain: 'dialysis', reason: 'domain_db_not_configured' }),
      { pipeline_status: 'failed', pipeline_failed: true, pipeline_reason: 'domain_db_not_configured' });
  });

  it('domain classified, write failed, no reason → synthesizes propagation_failed', () => {
    assert.deepEqual(
      pipelinePromoteOutcome({ propagated: false, domain: 'government' }),
      { pipeline_status: 'failed', pipeline_failed: true, pipeline_reason: 'propagation_failed' });
  });

  it('a successful promote is not a failure and carries no reason', () => {
    assert.deepEqual(
      pipelinePromoteOutcome({ propagated: true, domain: 'dialysis', reason: null }),
      { pipeline_status: 'success', pipeline_failed: false, pipeline_reason: null });
  });

  it('success ignores a stray reason (only failures carry one)', () => {
    const out = pipelinePromoteOutcome({ propagated: true, domain: 'government', reason: 'ignored' });
    assert.equal(out.pipeline_status, 'success');
    assert.equal(out.pipeline_failed, false);
    assert.equal(out.pipeline_reason, null);
  });

  it('called with no args defaults to a failure (undefined propagated)', () => {
    // Defensive: an undefined/absent propagation must never read as success.
    const out = pipelinePromoteOutcome();
    assert.equal(out.pipeline_failed, true);
    assert.equal(out.pipeline_status, 'failed');
  });

  it('pipeline_failed is the single boolean the sidebar branches on', () => {
    // The extension checks result.data.pipeline_failed to decide success vs the
    // inline "Promote failed" toast — assert it is always a real boolean.
    for (const propagated of [true, false, undefined, null, 0, 1]) {
      const out = pipelinePromoteOutcome({ propagated, domain: null });
      assert.equal(typeof out.pipeline_failed, 'boolean');
      assert.equal(out.pipeline_failed, !propagated);
    }
  });
});
