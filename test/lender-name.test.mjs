// Lender-name cleaner tests (ORE follow-up, 2026-07-16).
//
// cleanLenderName() sits IN FRONT of resolveOrCreateLender (sidebar-pipeline.js),
// so BOTH the deed-path lender AND the one-time backfill of the ~1,755 messy
// CoStar text-lenders resolve to a clean, dedupable DISPLAY name — or a SKIP
// verdict that leaves the row text-only (surface ambiguity, never guess). The
// cleaner's quality IS the dedup quality, so these lock the real name-shapes
// grounded live: broker-prefix strip, allocation-note strip, lender-arm keep,
// and the multi-lender / placeholder / too-short / broker-only skips.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLenderName, BROKER_PREFIX_RE } from '../api/_shared/lender-name.js';

// Convenience: the cleaned display name (null when skipped).
const clean = (s) => cleanLenderName(s).clean;
const verdict = (s) => { const r = cleanLenderName(s); return r.skip ? `skip:${r.reason}` : r.reason; };

describe('cleanLenderName — broker/intermediary prefix strip', () => {
  it('Marcus & Millichap Capstar Bank → Capstar Bank', () => {
    assert.equal(clean('Marcus & Millichap Capstar Bank'), 'Capstar Bank');
    assert.equal(verdict('Marcus & Millichap Capstar Bank'), 'broker_prefix');
  });
  it('JLL <lender> → <lender>', () =>
    assert.equal(clean('JLL Wells Fargo Bank'), 'Wells Fargo Bank'));
  it('CBRE <lender> → <lender>', () =>
    assert.equal(clean('CBRE Nationwide Life'), 'Nationwide Life'));
  it('Newmark <lender> → <lender>', () =>
    assert.equal(clean('Newmark MetLife Investment Management'), 'MetLife Investment Management'));
  it('Eastdil Secured <lender> → <lender>', () =>
    assert.equal(clean('Eastdil Secured Deutsche Bank'), 'Deutsche Bank'));
  it('idempotent: cleaning the cleaned output is a no-op', () => {
    const once = clean('Marcus & Millichap Capstar Bank');
    assert.equal(clean(once), once);
  });
  it('a name with NO broker prefix is passed through unchanged', () => {
    assert.equal(clean('Capstar Bank'), 'Capstar Bank');
    assert.equal(verdict('Capstar Bank'), 'clean');
  });
  it('BROKER_PREFIX_RE only matches a LEADING prefix (mid-name broker untouched)', () => {
    // "First Cbre National" is not a broker prefix (does not start with the firm).
    assert.equal(clean('First National Bank'), 'First National Bank');
  });
});

describe('cleanLenderName — allocation / amount parentheticals', () => {
  it("JLL CIT Group ($1.5m alloc'd) → CIT Group (broker + alloc)", () => {
    assert.equal(clean("JLL CIT Group ($1.5m alloc'd)"), 'CIT Group');
  });
  it('drops ($1.0m approx)', () =>
    assert.equal(clean('CIT Group ($1.0m approx)'), 'CIT Group'));
  it('drops a bare ($0.5m)', () =>
    assert.equal(clean('Nationwide Life ($0.5m)'), 'Nationwide Life'));
  it('annotates the transform as alloc_note when no broker prefix', () =>
    assert.equal(verdict('Nationwide Life ($0.5m)'), 'alloc_note'));
  it('does NOT strip a state/qualifier parenthetical (AR)', () =>
    assert.equal(clean('Simmons Bank (AR)'), 'Simmons Bank (AR)'));
  it('does NOT strip (MN)', () =>
    assert.equal(clean('Bremer Bank (MN)'), 'Bremer Bank (MN)'));
});

describe('cleanLenderName — real lending arm kept whole', () => {
  it('Marcus & Millichap Capital Corporation is a lender, not a broker prefix', () => {
    assert.equal(clean('Marcus & Millichap Capital Corporation'), 'Marcus & Millichap Capital Corporation');
    assert.equal(verdict('Marcus & Millichap Capital Corporation'), 'lender_arm');
  });
  it('… Capital Corp variant also kept whole', () =>
    assert.equal(clean('Marcus & Millichap Capital Corp'), 'Marcus & Millichap Capital Corp'));
});

describe('cleanLenderName — SKIP verdicts (leave text-only, never invent a lender)', () => {
  it('multi-lender (semicolon) → skip', () => {
    assert.equal(clean('Wells Fargo; JPMorgan Chase'), null);
    assert.equal(verdict('Wells Fargo; JPMorgan Chase'), 'skip:multi_lender');
  });
  it('placeholder Private/Other → skip', () => {
    assert.equal(clean('Private/Other'), null);
    assert.equal(verdict('Private/Other'), 'skip:placeholder_generic');
  });
  it('bare "Private" → skip', () =>
    assert.equal(verdict('Private'), 'skip:placeholder_generic'));
  it('bare generic "Bank" → skip', () =>
    assert.equal(verdict('Bank'), 'skip:placeholder_generic'));
  it('bare "Bank NA" → skip', () =>
    assert.equal(verdict('Bank NA'), 'skip:placeholder_generic'));
  it('too-short fragment → skip', () =>
    assert.equal(verdict('BB'), 'skip:too_short'));
  it('empty / whitespace → skip', () => {
    assert.equal(verdict(''), 'skip:empty');
    assert.equal(verdict('   '), 'skip:empty');
    assert.equal(verdict(null), 'skip:empty');
    assert.equal(verdict(undefined), 'skip:empty');
  });
  it('broker with a bare-generic remainder → broker_only skip (no garbage lender)', () => {
    assert.equal(clean('Marcus & Millichap Capital'), null);
    assert.equal(verdict('Marcus & Millichap Capital'), 'skip:broker_only');
  });
  it('a broker firm alone (nothing after) → broker_only skip', () =>
    assert.equal(verdict('CBRE'), 'skip:broker_only'));
});

describe('cleanLenderName — CMBS / securitization trust codes → skip', () => {
  it('bare series code (CGCMT 2015-GC29) → cmbs_code', () =>
    assert.equal(verdict('CGCMT 2015-GC29'), 'skip:cmbs_code'));
  it('broker-prefixed CMBS (CBRE Wachovia 2005-C20) → cmbs_code (whole)', () => {
    assert.equal(clean('CBRE Wachovia 2005-C20'), null);
    assert.equal(verdict('CBRE Wachovia 2005-C20'), 'skip:cmbs_code');
  });
  it('shelf acronym + year (MS 2006-TOP23) → cmbs_code', () =>
    assert.equal(verdict('MS 2006-TOP23'), 'skip:cmbs_code'));
  it('LDP series (Jones Lang LaSalle JPMCC 2007-LDP11) → cmbs_code', () =>
    assert.equal(verdict('Jones Lang LaSalle JPMCC 2007-LDP11'), 'skip:cmbs_code'));
  it('a real bank name with NO year-series is NOT flagged CMBS', () => {
    assert.equal(verdict('Wells Fargo Bank'), 'clean');
    assert.equal(verdict('Bank of America'), 'clean');
  });
});

describe('cleanLenderName — co-broker chains (looping strip) + trademark', () => {
  it('pipe-joined co-brokers (CBRE | Colliers) both stripped', () =>
    assert.equal(clean('CBRE Colliers ServisFirst Bank'), 'ServisFirst Bank'));
  it('trademark symbol removed (Matthews™ US Bancorp → US Bancorp)', () =>
    assert.equal(clean('Matthews™ US Bancorp'), 'US Bancorp'));
  it('Cassidy Turley <lender> → <lender>', () =>
    assert.equal(clean('Cassidy Turley PNC Financial Services'), 'PNC Financial Services'));
  it('Grubb & Ellis First Community Bank → First Community Bank', () =>
    assert.equal(clean('Grubb & Ellis First Community Bank'), 'First Community Bank'));
});

describe('cleanLenderName — expanded placeholders', () => {
  it('Government Agency → skip', () =>
    assert.equal(verdict('Government Agency'), 'skip:placeholder_generic'));
  it('bare Insurance → skip', () =>
    assert.equal(verdict('Insurance'), 'skip:placeholder_generic'));
  it('bare CMBS word (no year series) → placeholder skip', () =>
    assert.equal(verdict('CMBS'), 'skip:placeholder_generic'));
});

describe('cleanLenderName — leading junk + whitespace normalization', () => {
  it('strips a leading dash/bullet ("- HTLF" → "HTLF")', () =>
    assert.equal(clean('- HTLF'), 'HTLF'));
  it('collapses internal whitespace', () =>
    assert.equal(clean('Wells   Fargo   Bank'), 'Wells Fargo Bank'));
  it('never throws on odd input (object/number coerced)', () => {
    assert.doesNotThrow(() => cleanLenderName(12345));
    assert.doesNotThrow(() => cleanLenderName({}));
  });
});
