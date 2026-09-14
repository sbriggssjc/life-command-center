import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveGovernmentCreditTier,
  governmentCreditBuckets,
  normalizeGovernmentCreditTier,
} from '../api/_shared/gov-credit-tier.js';

describe('government credit-tier resolver', () => {
  it('normalizes explicit government_type values', () => {
    assert.equal(normalizeGovernmentCreditTier('Federal Government'), 'federal');
    assert.equal(normalizeGovernmentCreditTier('State Credit'), 'state');
    assert.equal(normalizeGovernmentCreditTier('Local / Municipal'), 'municipal');
  });

  it('classifies federal agency variants including singular Veteran Affairs', () => {
    assert.deepEqual(
      deriveGovernmentCreditTier({ agency: 'Department of Veteran Affairs' }).buckets,
      ['federal'],
    );
    assert.deepEqual(
      deriveGovernmentCreditTier({ agency: 'General Services Administration - NOAA' }).buckets,
      ['federal'],
    );
  });

  it('classifies state agencies from tenant text', () => {
    assert.equal(
      deriveGovernmentCreditTier({ agency: 'TX Health and Human Services' }).primaryType,
      'state',
    );
    assert.equal(
      deriveGovernmentCreditTier({ agency: 'Texas Workforce Commission' }).primaryType,
      'state',
    );
  });

  it('classifies municipal agencies from local text', () => {
    assert.equal(
      deriveGovernmentCreditTier({ agency: 'County of Los Angeles Health Services' }).primaryType,
      'municipal',
    );
    assert.equal(
      deriveGovernmentCreditTier({ agency: 'City of Phoenix Police Department' }).primaryType,
      'municipal',
    );
    assert.equal(
      deriveGovernmentCreditTier({ agency: 'Austin Independent School District' }).primaryType,
      'municipal',
    );
  });

  it('returns multiple buckets when a sale has state and federal tenant evidence', () => {
    const result = deriveGovernmentCreditTier({
      tenantNames: [
        'Texas Health and Human Services Commission',
        'Social Security Administration',
      ],
    });
    assert.equal(result.primaryType, null);
    assert.equal(result.isMultiBucket, true);
    assert.deepEqual(result.buckets, ['federal', 'state']);
  });

  it('does not classify private tenants from bare risky words', () => {
    assert.deepEqual(governmentCreditBuckets({ agency: 'Macy Department Store' }), []);
    assert.deepEqual(governmentCreditBuckets({ agency: 'Workforce Housing Partners' }), []);
  });
});
