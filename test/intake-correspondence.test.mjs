// Phase 2 Slice 3b (Unit 1) — the email-OM intake logs the email itself as an
// `email` activity on a confident entity match; unmatched intakes append
// nothing; the dedup key is the internet_message_id (so re-processing the same
// email is a no-op at the DB unique index).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { logEmailIntakeCorrespondence } from '../api/_shared/intake-correspondence.js';

function captureAppend() {
  const calls = [];
  // Simulate the activity_events unique index on (workspace, source_type,
  // external_id): the first append for a key inserts, repeats dedup.
  const seen = new Set();
  const fn = async (args) => {
    calls.push(args);
    const key = `${args.workspaceId}|${args.sourceType}|${args.externalId}`;
    if (seen.has(key)) return { ok: true, inserted: false };
    seen.add(key);
    return { ok: true, inserted: true, id: `evt-${calls.length}` };
  };
  return { fn, calls };
}

const BASE = {
  channel: 'email',
  matchedEntityId: 'ent-123',
  matchedDomain: 'government',
  workspaceId: 'ws-1',
  actorId: 'user-1',
  intakeId: 'intake-9',
  emailContext: {
    internet_message_id: '<abc@mail>',
    subject: 'OM — 123 Main St, GSA',
    body_snippet: 'Please see attached offering memorandum.',
    web_link: 'https://outlook.office.com/mail/x',
    received_at: '2026-06-11T12:00:00Z',
    from: 'broker@example.com',
    to: 'scott@northmarq.com',
  },
};

describe('logEmailIntakeCorrespondence (Unit 1)', () => {
  it('appends an email activity with the right entity, category and externalId', async () => {
    const { fn, calls } = captureAppend();
    const res = await logEmailIntakeCorrespondence(BASE, { appendActivityEvent: fn });
    assert.equal(res.ok, true);
    assert.equal(res.inserted, true);
    assert.equal(calls.length, 1);
    const c = calls[0];
    assert.equal(c.category, 'email');
    assert.equal(c.entityId, 'ent-123');
    assert.equal(c.sourceType, 'email_intake');
    assert.equal(c.externalId, '<abc@mail>');         // the dedup key
    assert.equal(c.title, 'OM — 123 Main St, GSA');
    assert.equal(c.domain, 'gov');                     // normalized from 'government'
    assert.equal(c.metadata.intake_id, 'intake-9');
    assert.equal(c.metadata.from, 'broker@example.com');
  });

  it('normalizes dialysis domain to dia', async () => {
    const { fn, calls } = captureAppend();
    await logEmailIntakeCorrespondence({ ...BASE, matchedDomain: 'dialysis' }, { appendActivityEvent: fn });
    assert.equal(calls[0].domain, 'dia');
  });

  it('passes domain=null for an lcc-direct / unknown match', async () => {
    const { fn, calls } = captureAppend();
    await logEmailIntakeCorrespondence({ ...BASE, matchedDomain: null }, { appendActivityEvent: fn });
    assert.equal(calls[0].domain, null);
  });

  it('re-running the same internet_message_id is a dedup no-op', async () => {
    const { fn, calls } = captureAppend();
    const first  = await logEmailIntakeCorrespondence(BASE, { appendActivityEvent: fn });
    const second = await logEmailIntakeCorrespondence(BASE, { appendActivityEvent: fn });
    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);             // deduped at the unique index
    assert.equal(calls.length, 2);
    assert.equal(calls[0].externalId, calls[1].externalId); // identical dedup key
  });

  it('appends nothing for an unmatched intake (no entity)', async () => {
    const { fn, calls } = captureAppend();
    const res = await logEmailIntakeCorrespondence({ ...BASE, matchedEntityId: null }, { appendActivityEvent: fn });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, 'no_entity_match');
    assert.equal(calls.length, 0);
  });

  it('appends nothing for a non-email channel', async () => {
    const { fn, calls } = captureAppend();
    const res = await logEmailIntakeCorrespondence({ ...BASE, channel: 'sidebar' }, { appendActivityEvent: fn });
    assert.equal(res.ok, false);
    assert.equal(res.skipped, 'not_email_channel');
    assert.equal(calls.length, 0);
  });

  it('appends nothing when the email has no message id', async () => {
    const { fn, calls } = captureAppend();
    const res = await logEmailIntakeCorrespondence(
      { ...BASE, emailContext: { ...BASE.emailContext, internet_message_id: null, message_id: null } },
      { appendActivityEvent: fn }
    );
    assert.equal(res.ok, false);
    assert.equal(res.skipped, 'no_message_id');
    assert.equal(calls.length, 0);
  });
});
