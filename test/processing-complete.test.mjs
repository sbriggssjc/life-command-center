import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { targetFolderFor } from '../api/_shared/processing-complete.js';

describe('targetFolderFor — outcome → Outlook folder mapping', () => {
  it('needs_review leaves the email in place (null folder)', () => {
    assert.equal(targetFolderFor('needs_review', { channel: 'infra', domain: 'infra' }), null);
    assert.equal(targetFolderFor('needs_review', {}), null);
  });

  it('duplicate → Processed/Duplicates regardless of domain', () => {
    assert.equal(targetFolderFor('duplicate', {}), 'Processed/Duplicates');
    assert.equal(targetFolderFor('duplicate', { channel: 'om', domain: 'dia' }), 'Processed/Duplicates');
  });

  it('filed infra → Processed/Infra', () => {
    assert.equal(targetFolderFor('filed', { channel: 'infra', domain: 'infra' }), 'Processed/Infra');
    assert.equal(targetFolderFor('filed', { domain: 'infra' }), 'Processed/Infra');
  });

  it('filed lead/news/marketplace channels → Processed/Leads', () => {
    for (const key of ['lead', 'leads', 'news_alert', 'news-alert', 'crexi', 'loopnet']) {
      assert.equal(targetFolderFor('filed', { channel: key }), 'Processed/Leads', key);
    }
  });

  it('filed deal channels (OM/lease/closing/dia/gov/netlease) → Processed/Deals', () => {
    for (const key of ['om', 'lease', 'deal', 'deal_closing', 'dia', 'dialysis',
                       'gov', 'government', 'netlease']) {
      assert.equal(targetFolderFor('filed', { channel: key }), 'Processed/Deals', key);
    }
    // domain wins over channel when both present
    assert.equal(targetFolderFor('filed', { channel: 'om', domain: 'gov' }), 'Processed/Deals');
  });

  it('filed with no domain hint → Processed/General', () => {
    assert.equal(targetFolderFor('filed', {}), 'Processed/General');
    assert.equal(targetFolderFor('filed', { channel: 'something_unknown' }), 'Processed/General');
  });

  it('is case-insensitive on channel/domain', () => {
    assert.equal(targetFolderFor('filed', { domain: 'INFRA' }), 'Processed/Infra');
    assert.equal(targetFolderFor('filed', { channel: 'LoopNet' }), 'Processed/Leads');
  });

  it('unknown outcome is treated as leave-in-place (null)', () => {
    assert.equal(targetFolderFor('whatever', { channel: 'om' }), null);
  });
});
