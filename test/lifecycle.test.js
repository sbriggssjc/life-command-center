import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES, ACTION_TYPES, ACTION_STATES, INBOX_STATES,
  ACTIVITY_CATEGORIES, CONNECTOR_TYPES,
  canTransitionAction, canTransitionInbox, buildTransitionActivity
} from '../api/_shared/lifecycle.js';

describe('lifecycle enums', () => {
  it('ROLES has exactly 4 canonical roles', () => {
    assert.deepEqual(ROLES, ['owner', 'manager', 'operator', 'viewer']);
  });

  it('ACTION_STATES includes all expected values', () => {
    assert.ok(ACTION_STATES.includes('open'));
    assert.ok(ACTION_STATES.includes('in_progress'));
    assert.ok(ACTION_STATES.includes('waiting'));
    assert.ok(ACTION_STATES.includes('completed'));
    assert.ok(ACTION_STATES.includes('cancelled'));
  });

  it('INBOX_STATES includes triage states', () => {
    assert.ok(INBOX_STATES.includes('new'));
    assert.ok(INBOX_STATES.includes('triaged'));
    assert.ok(INBOX_STATES.includes('promoted'));
    assert.ok(INBOX_STATES.includes('dismissed'));
  });

  it('CONNECTOR_TYPES includes standard connectors', () => {
    assert.ok(CONNECTOR_TYPES.includes('outlook'));
    assert.ok(CONNECTOR_TYPES.includes('salesforce'));
  });
});

describe('canTransitionAction', () => {
  it('allows open → in_progress', () => {
    assert.ok(canTransitionAction('open', 'in_progress'));
  });

  it('allows in_progress → completed', () => {
    assert.ok(canTransitionAction('in_progress', 'completed'));
  });

  it('allows open → waiting', () => {
    assert.ok(canTransitionAction('open', 'waiting'));
  });

  it('allows waiting → in_progress', () => {
    assert.ok(canTransitionAction('waiting', 'in_progress'));
  });

  it('allows completed → open (reopen)', () => {
    assert.ok(canTransitionAction('completed', 'open'));
  });

  it('rejects completed → in_progress', () => {
    assert.ok(!canTransitionAction('completed', 'in_progress'));
  });
});

describe('canTransitionInbox', () => {
  it('allows new → triaged', () => {
    assert.ok(canTransitionInbox('new', 'triaged'));
  });

  it('allows triaged → promoted', () => {
    assert.ok(canTransitionInbox('triaged', 'promoted'));
  });

  it('allows new → dismissed', () => {
    assert.ok(canTransitionInbox('new', 'dismissed'));
  });

  it('rejects new → promoted (must triage first)', () => {
    assert.ok(!canTransitionInbox('new', 'promoted'));
  });

  it('rejects archived → new (terminal state)', () => {
    assert.ok(!canTransitionInbox('archived', 'new'));
  });
});

describe('buildTransitionActivity', () => {
  it('returns activity event with correct fields', () => {
    const activity = buildTransitionActivity({
      item_type: 'action',
      item_id: 'abc-123',
      category: 'status_change',
      title: 'Changed open → in_progress',
      user: { id: 'user-456' },
      workspace_id: 'ws-789'
    });

    assert.equal(activity.category, 'status_change');
    assert.equal(activity.actor_id, 'user-456');
    assert.equal(activity.workspace_id, 'ws-789');
    assert.equal(activity.action_item_id, 'abc-123');
    assert.ok(activity.occurred_at);
  });
});
