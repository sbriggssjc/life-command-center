// R59 Unit 1 — pickPrimarySignal: which open BD signal the detail page leads
// with. suspected_sale > owner_source_conflict > loan_maturity. Pure, no DB.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';

const { pickPrimarySignal } = await import('../api/operations.js');

describe('pickPrimarySignal', () => {
  it('returns null when no signal is open', () => {
    assert.equal(pickPrimarySignal({}), null);
    assert.equal(pickPrimarySignal(null), null);
    assert.equal(pickPrimarySignal({ loan_maturity: null }), null);
  });

  it('leads with suspected_sale over everything', () => {
    assert.equal(pickPrimarySignal({
      loan_maturity: { type: 'loan_maturity' },
      owner_source_conflict: { type: 'owner_source_conflict' },
      suspected_sale: { type: 'suspected_sale' },
    }), 'suspected_sale');
  });

  it('owner_source_conflict outranks loan_maturity', () => {
    assert.equal(pickPrimarySignal({
      loan_maturity: { type: 'loan_maturity' },
      owner_source_conflict: { type: 'owner_source_conflict' },
    }), 'owner_source_conflict');
  });

  it('falls back to the only present signal', () => {
    assert.equal(pickPrimarySignal({ loan_maturity: { type: 'loan_maturity' } }), 'loan_maturity');
  });
});
