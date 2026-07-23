// Rules of Engagement (Contact 360 Slice 2) — the "don't step on another broker"
// verdict engine. Anchors: (1) brokerClass separates self / another-NM-broker /
// outside / unknown; (2) an account owned by ANOTHER Northmarq broker → do_not_call;
// (3) an unassigned / clear account → safe; (4) mergeTimeline folds LCC + SF into
// one newest-first, broker-labeled stream.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { brokerClass, computeRoe, mergeTimeline, sfActivityCategory } from '../api/_shared/roe.js';

describe('brokerClass', () => {
  it('classifies the operator team (briggs/sjc) as self', () => {
    assert.equal(brokerClass('Scott Briggs'), 'self');
    assert.equal(brokerClass('SJC; Briggs'), 'self');
    assert.equal(brokerClass('SJC'), 'self');
  });
  it('classifies another Northmarq broker as nm_other', () => {
    assert.equal(brokerClass('Stan Johnson'), 'nm_other');
    assert.equal(brokerClass('Northmarq'), 'nm_other');
    assert.equal(brokerClass('Jane Scrivner'), 'nm_other');
  });
  it('classifies a named competitor firm as outside', () => {
    assert.equal(brokerClass('CBRE'), 'outside');
    assert.equal(brokerClass('Cushman & Wakefield'), 'outside');
  });
  it('classifies an unrecognized name as unknown, and blank as none', () => {
    assert.equal(brokerClass('John Q Public'), 'unknown');
    assert.equal(brokerClass(''), 'none');
    assert.equal(brokerClass(null), 'none');
  });
});

describe('computeRoe', () => {
  it('DO NOT CALL when the SF account is owned by another Northmarq broker', () => {
    const r = computeRoe({ accountOwnerName: 'Stan Johnson', dealAssignees: [] });
    assert.equal(r.verdict, 'do_not_call');
    assert.equal(r.assigned_broker, 'Stan Johnson');
    assert.equal(r.assigned_broker_class, 'nm_other');
    assert.equal(r.assigned_broker_source, 'sf_owner');
    assert.match(r.headline, /do not call/i);
    assert.ok(r.reasons.length >= 1);
  });

  it('SAFE when the account owner is the operator team (self)', () => {
    const r = computeRoe({ accountOwnerName: 'Scott Briggs', dealAssignees: [] });
    assert.equal(r.verdict, 'safe');
    assert.equal(r.assigned_broker_class, 'self');
    assert.match(r.headline, /safe/i);
  });

  it('SAFE when unassigned and clear (no owner, no conflicting activity)', () => {
    const r = computeRoe({ accountOwnerName: null, dealAssignees: [] });
    assert.equal(r.verdict, 'safe');
    assert.equal(r.assigned_broker, null);
    assert.equal(r.assigned_broker_source, null);
    assert.equal(r.account_status, null);
  });

  it('falls back to the deal-level assignee when no SF OwnerId (do_not_call on a colleague)', () => {
    const r = computeRoe({
      accountOwnerName: null,
      dealAssignees: [{ name: 'Stan Johnson', date: '2026-06-01' }],
    });
    assert.equal(r.verdict, 'do_not_call');
    assert.equal(r.assigned_broker, 'Stan Johnson');
    assert.equal(r.assigned_broker_source, 'deal_assignee');
    assert.ok(r.last_firm_touch && r.last_firm_touch.broker === 'Stan Johnson');
  });

  it('CAUTION for an outside broker on the account', () => {
    const r = computeRoe({ accountOwnerName: 'CBRE', dealAssignees: [] });
    assert.equal(r.verdict, 'caution');
    assert.equal(r.assigned_broker_class, 'outside');
  });

  it('the most-recent deal assignee drives the verdict (a recent NM colleague → do_not_call)', () => {
    const recent = new Date(Date.now() - 10 * 86400000).toISOString();
    const r = computeRoe({
      accountOwnerName: null,
      dealAssignees: [{ name: 'Stan Johnson', date: recent }, { name: 'Scott Briggs', date: '2026-01-01' }],
    });
    assert.equal(r.verdict, 'do_not_call');
    assert.equal(r.assigned_broker, 'Stan Johnson');
    assert.equal(r.last_firm_touch.broker, 'Stan Johnson');
  });

  it('records the closed/won account status as a reason', () => {
    const r = computeRoe({ accountOwnerName: 'Scott Briggs', dealAssignees: [], accountClosedWon: true });
    assert.equal(r.account_status, 'closed_won');
    assert.ok(r.reasons.some(x => /closed\/won/i.test(x)));
  });
});

describe('sfActivityCategory', () => {
  it('maps email / call / meeting / note from subtype + subject', () => {
    assert.equal(sfActivityCategory({ subject: 'RE: Offer', task_subtype: 'Email' }), 'email');
    assert.equal(sfActivityCategory({ subject: 'Call w/ owner', task_subtype: 'Call' }), 'call');
    assert.equal(sfActivityCategory({ subject: 'Site tour', nm_type: 'Meeting' }), 'meeting');
    assert.equal(sfActivityCategory({ subject: '2 - Medical Buyer/Portfolio', task_subtype: '' }), 'note');
  });
});

describe('mergeTimeline', () => {
  const lcc = [
    { occurred_at: '2026-06-10T00:00:00Z', category: 'call', title: 'LCC call', body: 'notes',
      source_type: 'manual', users: { display_name: 'Scott Briggs' } },
  ];
  const sf = [
    { activity_date: '2026-06-15T00:00:00Z', subject: 'Sent RE: NDA', nm_notes: 'sent it',
      status: 'Completed', assigned_to: 'Stan Johnson', task_subtype: 'Email' },
    { activity_date: '2026-06-01T00:00:00Z', subject: 'Call', assigned_to: 'Scott Briggs',
      task_subtype: 'Call', status: 'Completed' },
  ];

  it('merges LCC + SF into one newest-first stream with source + broker labels', () => {
    const t = mergeTimeline(lcc, sf, { limit: 40 });
    assert.equal(t.length, 3);
    // newest first
    assert.equal(t[0].source, 'sf');
    assert.equal(t[0].title, 'Sent RE: NDA');
    assert.equal(t[0].broker, 'Stan Johnson');
    assert.equal(t[0].category, 'email');
    // the LCC item carries its actor as broker + source 'lcc'
    const lccItem = t.find(x => x.source === 'lcc');
    assert.ok(lccItem);
    assert.equal(lccItem.broker, 'Scott Briggs');
  });

  it('respects the limit cap', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      activity_date: '2026-01-' + String((i % 28) + 1).padStart(2, '0') + 'T00:00:00Z',
      subject: 'x' + i, assigned_to: 'A', task_subtype: 'Note',
    }));
    assert.equal(mergeTimeline([], many, { limit: 40 }).length, 40);
  });

  it('is null/empty tolerant', () => {
    assert.deepEqual(mergeTimeline(null, null), []);
    assert.deepEqual(mergeTimeline(undefined, []), []);
  });
});
