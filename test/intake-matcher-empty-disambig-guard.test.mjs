import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitMatchDisambiguation } from '../api/_handlers/intake-matcher.js';

// ============================================================================
// Prompt 91 — producer guard: never mint an empty-candidate match_disambiguation
//
// A disambiguation card with ZERO candidates is unworkable by construction (the
// human is asked to "pick one of nothing"; the assist tick rightly refuses it),
// yet it inflates the lane badge — an honest-counts violation and a producer bug
// (the matcher minted "pick one of nothing" instead of routing to its no-match
// path). emitMatchDisambiguation is the single choke point for every caller
// (intake-matcher, intake-promoter enrich, folder-feed-attach, lease-extractor),
// so the guard lives there and returns { emitted } for callers to honor.
//
// The guard short-circuits BEFORE any opsQuery, so an empty list is asserted with
// no DB configured. A non-empty list reaches the POST (which returns 503 in this
// unconfigured test env, without throwing) and reports emitted:true.
// ============================================================================

describe('emitMatchDisambiguation — empty-candidate producer guard (Prompt 91)', () => {
  it('refuses to mint when candidates is an empty array', async () => {
    const r = await emitMatchDisambiguation('intake-1', '100 Main St', 'SSA', []);
    assert.deepEqual(r, { emitted: false, skipped: 'empty_candidates' });
  });

  it('refuses to mint when candidates is null/undefined/non-array', async () => {
    assert.equal((await emitMatchDisambiguation('i', 'a', 't', null)).emitted, false);
    assert.equal((await emitMatchDisambiguation('i', 'a', 't', undefined)).emitted, false);
    assert.equal((await emitMatchDisambiguation('i', 'a', 't', 'nope')).emitted, false);
  });

  it('refuses to mint when the array holds only falsy entries', async () => {
    const r = await emitMatchDisambiguation('i', 'a', 't', [null, undefined, false]);
    assert.equal(r.emitted, false);
    assert.equal(r.skipped, 'empty_candidates');
  });

  it('proceeds to emit when at least one real candidate exists', async () => {
    // Ops DB is unconfigured in the test env, so the POST returns 503 without
    // throwing; the guard has already been passed, so emitted is true.
    const r = await emitMatchDisambiguation('intake-2', '100 Main St', 'SSA', [
      { domain: 'gov', property_id: '24703', address: '100 Main St', confidence: 0.72 },
    ]);
    assert.equal(r.emitted, true);
  });
});
