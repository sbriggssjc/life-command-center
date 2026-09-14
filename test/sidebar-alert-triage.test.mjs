// Alert-triage fixes (2026-08-06 §3A) — two pure policies:
//
//  Fix 1: normalizePropagationDomain — the propagation dispatcher must accept
//         the SHORT domain codes `entities.domain` actually stores (dia/gov),
//         not just the long forms. A preserve-existing re-capture returns the
//         stored short code; before this fix it hit reason 'unknown_domain' and
//         silently skipped domain-DB propagation.
//
//  Fix 2: shouldAlertPipelineFailure — a thin no_domain capture (CoStar contact
//         fragment: <150 chars, no sale notes, no PDFs) is a correctly-declined
//         out-of-scope page; its per-capture health alert is noise. Suppress it.
//         Substantive no_domain, unknown_domain, and every other reason still
//         alert.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePropagationDomain,
  shouldAlertPipelineFailure,
} from '../api/_handlers/sidebar-pipeline.js';

describe('normalizePropagationDomain (Fix 1 — accept short domain codes)', () => {
  it("short 'dia' → 'dialysis' (the preserve-existing re-capture case)", () => {
    assert.equal(normalizePropagationDomain('dia'), 'dialysis');
  });
  it("short 'gov' → 'government'", () => {
    assert.equal(normalizePropagationDomain('gov'), 'government');
  });
  it("long forms pass through unchanged", () => {
    assert.equal(normalizePropagationDomain('dialysis'), 'dialysis');
    assert.equal(normalizePropagationDomain('government'), 'government');
  });
  it("case / whitespace tolerant", () => {
    assert.equal(normalizePropagationDomain(' DIA '), 'dialysis');
    assert.equal(normalizePropagationDomain('Government'), 'government');
  });
  it("'lcc' / 'cre' / unknown → null (no domain DB — unknown_domain path)", () => {
    assert.equal(normalizePropagationDomain('lcc'), null);
    assert.equal(normalizePropagationDomain('cre'), null);
    assert.equal(normalizePropagationDomain('something'), null);
    assert.equal(normalizePropagationDomain(null), null);
    assert.equal(normalizePropagationDomain(undefined), null);
    assert.equal(normalizePropagationDomain(''), null);
  });
});

describe('shouldAlertPipelineFailure (Fix 2 — thin no_domain is noise)', () => {
  it('thin no_domain capture → NO alert (suppressed, counted)', () => {
    assert.equal(
      shouldAlertPipelineFailure({
        reason: 'no_domain',
        classifierDiag: { searchTextLen: 72, hasSaleNotes: false, hasPdfTexts: false },
      }),
      false);
  });

  it('rich-text no_domain (≥150 chars) → alert (potential classifier gap)', () => {
    assert.equal(
      shouldAlertPipelineFailure({
        reason: 'no_domain',
        classifierDiag: { searchTextLen: 320, hasSaleNotes: false, hasPdfTexts: false },
      }),
      true);
  });

  it('no_domain WITH sale notes → alert even when short', () => {
    assert.equal(
      shouldAlertPipelineFailure({
        reason: 'no_domain',
        classifierDiag: { searchTextLen: 60, hasSaleNotes: true, hasPdfTexts: false },
      }),
      true);
  });

  it('no_domain WITH PDFs → alert even when short', () => {
    assert.equal(
      shouldAlertPipelineFailure({
        reason: 'no_domain',
        classifierDiag: { searchTextLen: 60, hasSaleNotes: false, hasPdfTexts: true },
      }),
      true);
  });

  it('unknown_domain → always alerts (unchanged)', () => {
    assert.equal(
      shouldAlertPipelineFailure({
        reason: 'unknown_domain',
        classifierDiag: { searchTextLen: 40, hasSaleNotes: false, hasPdfTexts: false },
      }),
      true);
  });

  it('other failure reasons (propagation_error, domain_db_not_configured) → alert', () => {
    for (const reason of ['propagation_error', 'domain_db_not_configured', 'propagation_failed']) {
      assert.equal(
        shouldAlertPipelineFailure({ reason, classifierDiag: { searchTextLen: 10 } }),
        true, `reason=${reason} should alert`);
    }
  });

  it('missing classifierDiag on a no_domain → treated as thin (searchTextLen 0) → suppressed', () => {
    assert.equal(shouldAlertPipelineFailure({ reason: 'no_domain' }), false);
  });

  it('boundary: exactly 150 chars is NOT thin → alerts', () => {
    assert.equal(
      shouldAlertPipelineFailure({
        reason: 'no_domain',
        classifierDiag: { searchTextLen: 150, hasSaleNotes: false, hasPdfTexts: false },
      }),
      true);
  });
});
