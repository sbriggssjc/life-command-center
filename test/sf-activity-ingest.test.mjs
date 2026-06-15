// Phase 2 Slice 3b (Unit 2) — the SF activity ingest handler maps SF
// Call/Email/Meeting/Note to the right category, resolves the entity via the
// salesforce external_identity (who_id → Contact, what_id → Account), skips
// (no row) when no entity resolves, and dedups on (salesforce, sf_id).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mapSfTypeToCategory, processSfActivityBatch } from '../api/_handlers/sf-activity-ingest.js';

// Fake external_identities (salesforce) → entity map.
const SF_TO_ENTITY = {
  'Contact|003aaa': { entityId: 'ent-contact-1' },
  'Account|001bbb': { entityId: 'ent-account-1' },
};
async function fakeFindEntity(_ws, sourceType, sfId) {
  return SF_TO_ENTITY[`${sourceType}|${sfId}`] || null;
}

function captureAppend() {
  const calls = [];
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

describe('mapSfTypeToCategory', () => {
  it('maps Call/Email/Meeting and collapses Task/Note/other to note', () => {
    assert.equal(mapSfTypeToCategory('Call'), 'call');
    assert.equal(mapSfTypeToCategory('Email'), 'email');
    assert.equal(mapSfTypeToCategory('Meeting'), 'meeting');
    assert.equal(mapSfTypeToCategory('Event'), 'meeting');
    assert.equal(mapSfTypeToCategory('Task'), 'note');
    assert.equal(mapSfTypeToCategory('Note'), 'note');
    assert.equal(mapSfTypeToCategory('Whatever'), 'note');
    assert.equal(mapSfTypeToCategory(null), 'note');
  });
});

describe('processSfActivityBatch (Unit 2)', () => {
  const ctx = { workspaceId: 'ws-1', actorId: 'user-1' };

  it('resolves the entity via who_id (Contact) and maps the category', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 'a1', type: 'Call', subject: 'Intro call', who_id: '003aaa', activity_date: '2026-06-01' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });

    assert.equal(out.matched, 1);
    assert.equal(out.inserted, 1);
    assert.equal(out.skipped_no_entity, 0);
    assert.equal(calls[0].entityId, 'ent-contact-1');
    assert.equal(calls[0].category, 'call');
    assert.equal(calls[0].sourceType, 'salesforce');
    assert.equal(calls[0].externalId, 'a1');
    assert.equal(calls[0].metadata.resolved_via, 'contact');
  });

  it('falls back to what_id (Account) when who_id does not resolve', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 'a2', type: 'Email', subject: 'Sent OM', who_id: 'unknown999', what_id: '001bbb' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });

    assert.equal(out.matched, 1);
    assert.equal(out.inserted, 1);
    assert.equal(calls[0].entityId, 'ent-account-1');
    assert.equal(calls[0].category, 'email');
    assert.equal(calls[0].metadata.resolved_via, 'account');
  });

  it('maps a Note to category note and resolves via account', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 'a3', type: 'Note', subject: 'Call notes', what_id: '001bbb' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    assert.equal(out.inserted, 1);
    assert.equal(calls[0].category, 'note');
  });

  it('skips (no row) when neither who_id nor what_id resolves an entity', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 'a4', type: 'Call', who_id: 'nope', what_id: 'alsonope' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });

    assert.equal(out.matched, 0);
    assert.equal(out.skipped_no_entity, 1);
    assert.equal(out.inserted, 0);
    assert.equal(calls.length, 0);                    // never appends against a guess
  });

  it('dedups on (salesforce, sf_id) when the same record is re-sent', async () => {
    const { fn } = captureAppend();
    const batch = [{ sf_id: 'dup1', type: 'Call', who_id: '003aaa' }];
    const first  = await processSfActivityBatch(batch, ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    const second = await processSfActivityBatch(batch, ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    assert.equal(first.inserted, 1);
    assert.equal(first.deduped, 0);
    assert.equal(second.inserted, 0);
    assert.equal(second.deduped, 1);
  });

  it('skips records with no sf_id and reports honest counts', async () => {
    const { fn } = captureAppend();
    const out = await processSfActivityBatch([
      { type: 'Call', who_id: '003aaa' },             // no sf_id
      { sf_id: 'ok1', type: 'Call', who_id: '003aaa' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    assert.equal(out.total, 2);
    assert.equal(out.skipped_no_id, 1);
    assert.equal(out.inserted, 1);
  });

  it('accepts Salesforce-native field names (Id/Subject/WhoId/...)', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { Id: 'sf9', TaskSubtype: 'Call', Subject: 'Native', WhoId: '003aaa', ActivityDate: '2026-06-02' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    assert.equal(out.inserted, 1);
    assert.equal(calls[0].externalId, 'sf9');
    assert.equal(calls[0].category, 'call');
    assert.equal(calls[0].occurredAt, '2026-06-02');
    // useful raw fields ride along in metadata for the timeline
    assert.equal(calls[0].metadata.sf_type, 'Call');
    assert.equal(calls[0].metadata.who_id, '003aaa');
    assert.equal(calls[0].metadata.activity_date, '2026-06-02');
  });

  it('falls back to the raw SF Type field when TaskSubtype is absent', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { Id: 'sf10', Type: 'Email', Subject: 'Raw type', WhoId: '003aaa', Description: 'body', Status: 'Completed' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    assert.equal(out.inserted, 1);
    assert.equal(calls[0].category, 'email');
    assert.equal(calls[0].title, 'Raw type');
    assert.equal(calls[0].body, 'body');
    assert.equal(calls[0].metadata.sf_status, 'Completed');
  });

  it('stores OwnerId (and Owner.Name when present) from a raw SF record', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { Id: 'own1', TaskSubtype: 'Call', Subject: 'Owned', WhoId: '003aaa',
        OwnerId: '005xxTEAM', Owner: { Name: 'Scott Briggs' } },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    assert.equal(out.inserted, 1);
    assert.equal(calls[0].metadata.owner_id, '005xxTEAM');
    assert.equal(calls[0].metadata.owner_name, 'Scott Briggs');
  });

  it('stores owner_id from the canonical owner_id field', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 'own2', type: 'Email', who_id: '003aaa', owner_id: '005yyDEBT', owner_name: 'NorthMarq Debt' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    assert.equal(out.inserted, 1);
    assert.equal(calls[0].metadata.owner_id, '005yyDEBT');
    assert.equal(calls[0].metadata.owner_name, 'NorthMarq Debt');
  });

  it('records owner_id:null when the SF record carries no owner', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 'own3', type: 'Call', who_id: '003aaa' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    assert.equal(out.inserted, 1);
    assert.equal(calls[0].metadata.owner_id, null);
    assert.equal(calls[0].metadata.owner_name, null);
  });

  it('handles a mixed batch of canonical + raw SF records', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 'mix1', type: 'Call', subject: 'Canonical', who_id: '003aaa' },
      { Id: 'mix2', TaskSubtype: 'Email', Subject: 'Raw', WhatId: '001bbb', ActivityDate: '2026-06-03' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    assert.equal(out.total, 2);
    assert.equal(out.matched, 2);
    assert.equal(out.inserted, 2);
    assert.equal(calls[0].externalId, 'mix1');
    assert.equal(calls[0].category, 'call');
    assert.equal(calls[0].entityId, 'ent-contact-1');
    assert.equal(calls[1].externalId, 'mix2');
    assert.equal(calls[1].category, 'email');
    assert.equal(calls[1].entityId, 'ent-account-1');
    assert.equal(calls[1].metadata.resolved_via, 'account');
  });
});

// R24 Unit 2 — inbound-reply capture: a reply detected in the SF mirror tags
// the activity skip_cadence_advance (so the SQL trigger doesn't also advance),
// resolves the cadence, and advances it via the single JS advance owner.

import { isInboundReply } from '../api/_handlers/sf-activity-ingest.js';

describe('isInboundReply (R24 Unit 2)', () => {
  it('detects reply prefixes and explicit inbound flags on email only', () => {
    assert.equal(isInboundReply('email', {}, 'RE: your OM'), true);
    assert.equal(isInboundReply('email', {}, 're: thanks'), true);
    assert.equal(isInboundReply('email', { Incoming: true }, 'New thread'), true);
    assert.equal(isInboundReply('email', { direction: 'Inbound' }, 'New thread'), true);
    assert.equal(isInboundReply('email', {}, 'New outreach'), false);
    // non-email categories never count as an email reply
    assert.equal(isInboundReply('call', {}, 'RE: call'), false);
  });
});

describe('processSfActivityBatch reply capture (R24 Unit 2)', () => {
  const ctx = { workspaceId: 'ws-1', actorId: 'user-1' };

  it('tags skip_cadence_advance and advances the cadence on a fresh inbound reply', async () => {
    const { fn, calls } = captureAppend();
    const advanceCalls = [];
    const fakeAdvance = async (cadenceId, touchData) => { advanceCalls.push({ cadenceId, touchData }); return { ok: true }; };
    const fakeResolve = async (entityId) => ({ id: `cad-for-${entityId}`, entity_id: entityId });

    const out = await processSfActivityBatch([
      { sf_id: 'r1', type: 'Email', subject: 'RE: your offering', who_id: '003aaa', activity_date: '2026-06-05' },
    ], ctx, {
      findEntityBySfId: fakeFindEntity, appendActivityEvent: fn,
      advanceCadence: fakeAdvance, resolveCadenceForEntity: fakeResolve,
    });

    assert.equal(out.matched, 1);
    assert.equal(out.inserted, 1);
    assert.equal(out.replies_captured, 1, 'the reply advanced a cadence');
    assert.equal(calls[0].metadata.is_reply, true);
    assert.equal(calls[0].metadata.skip_cadence_advance, 'true', 'trigger must not double-advance');
    assert.equal(advanceCalls.length, 1);
    assert.equal(advanceCalls[0].cadenceId, 'cad-for-ent-contact-1');
    assert.equal(advanceCalls[0].touchData.outcome, 'replied');
    assert.equal(advanceCalls[0].touchData.direction, 'inbound');
  });

  it('records the activity but does not advance when no cadence resolves', async () => {
    const { fn } = captureAppend();
    const advanceCalls = [];
    const fakeAdvance = async (id, td) => { advanceCalls.push({ id, td }); return { ok: true }; };
    const fakeResolveNone = async () => null;

    const out = await processSfActivityBatch([
      { sf_id: 'r2', type: 'Email', subject: 'RE: hello', who_id: '003aaa' },
    ], ctx, {
      findEntityBySfId: fakeFindEntity, appendActivityEvent: fn,
      advanceCadence: fakeAdvance, resolveCadenceForEntity: fakeResolveNone,
    });

    assert.equal(out.inserted, 1, 'activity still mirrored');
    assert.equal(out.replies_captured, 0, 'no cadence → no advance');
    assert.equal(advanceCalls.length, 0);
  });

  it('does NOT treat an outbound email as a reply', async () => {
    const { fn, calls } = captureAppend();
    const advanceCalls = [];
    const fakeAdvance = async () => { advanceCalls.push(1); return { ok: true }; };
    const fakeResolve = async (e) => ({ id: `cad-${e}` });

    const out = await processSfActivityBatch([
      { sf_id: 'o1', type: 'Email', subject: 'Sent you the OM', who_id: '003aaa' },
    ], ctx, {
      findEntityBySfId: fakeFindEntity, appendActivityEvent: fn,
      advanceCadence: fakeAdvance, resolveCadenceForEntity: fakeResolve,
    });

    assert.equal(out.replies_captured, 0);
    assert.equal(advanceCalls.length, 0, 'outbound email is not a reply advance');
    assert.ok(!calls[0].metadata.is_reply, 'no reply tag on outbound');
    assert.ok(!('skip_cadence_advance' in calls[0].metadata), 'trigger still owns outbound advance');
  });
});
