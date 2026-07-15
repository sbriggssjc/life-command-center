// Phase 2 Slice 3b (Unit 2) — the SF activity ingest handler maps SF
// Call/Email/Meeting/Note to the right category, resolves the entity via the
// salesforce external_identity (who_id → Contact, what_id → Account), skips
// (no row) when no entity resolves, and dedups on (salesforce, sf_id).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mapSfTypeToCategory, deriveSfCategory, processSfActivityBatch, sfContactAccountMismatch } from '../api/_handlers/sf-activity-ingest.js';

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

describe('deriveSfCategory (OUTREACH #1 RC1)', () => {
  it('keeps concrete SF types (Call/Email/Meeting) regardless of subject', () => {
    assert.equal(deriveSfCategory('Call',  'whatever'), 'call');
    assert.equal(deriveSfCategory('Email', 'whatever'), 'email');
    assert.equal(deriveSfCategory('Meeting', 'Sent RE: x'), 'meeting');
  });
  it('recovers email from a plain Task whose subject is real outreach', () => {
    assert.equal(deriveSfCategory('Task', 'Sent RE: 2nd Client - Summit'), 'email');
    assert.equal(deriveSfCategory('Task', 'Anthony Lewinter sent Re: Assignment'), 'email');
    assert.equal(deriveSfCategory('Task', 'FW: O’Reilly Auto LOI'), 'email');
    assert.equal(deriveSfCategory(null,   'Re: your offering'), 'email');
  });
  it('recovers call from a plain Task whose subject is a call/voicemail', () => {
    assert.equal(deriveSfCategory('Task', 'Call'), 'call');
    assert.equal(deriveSfCategory('Task', 'Left a voicemail for the owner'), 'call');
    assert.equal(deriveSfCategory('Task', 'Cold call to discuss disposition'), 'call');
  });
  it('leaves genuine internal-note Tasks as note (no false outreach)', () => {
    assert.equal(deriveSfCategory('Task', '2 - Medical Buyer/Portfolio'), 'note');
    assert.equal(deriveSfCategory('Task', '3 - DaVita Developer'), 'note');
    assert.equal(deriveSfCategory('Note', 'Internal account notes'), 'note');
    assert.equal(deriveSfCategory('Task', ''), 'note');
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

  it('categorizes a plain Task with an outreach subject as email (RC1, outbound)', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 't1', type: 'Task', subject: 'Sent RE: 2nd Client - Summit', what_id: '001bbb' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    assert.equal(out.inserted, 1);
    assert.equal(calls[0].category, 'email', 'real outreach Task is an email, not a dead note');
    assert.ok(!calls[0].metadata.is_reply, 'outbound "Sent RE:" is not an inbound reply');
    assert.ok(!('skip_cadence_advance' in calls[0].metadata), 'trigger owns the outbound advance');
  });

  it('keeps a genuine internal-note Task as note (no false advance)', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 't2', type: 'Task', subject: '2 - Medical Buyer/Portfolio', what_id: '001bbb' },
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

import {
  isInboundReply,
  sfRecordKind,
  resolveSfOccurredAt,
  normalizeSfRecord,
  tagBulkCompleted,
} from '../api/_handlers/sf-activity-ingest.js';

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

// ===========================================================================
// R63 Unit 3 — grow the cadence from real outreach (the inversion). Scott logs
// SF/Outlook outreach on a real target with NO cadence → seed one + advance it.
// ===========================================================================

describe('processSfActivityBatch grows a cadence from real outreach (Phase 1)', () => {
  const ctx = { workspaceId: 'ws-1', actorId: 'user-1' };

  it('grows a cadence for a real target with no existing cadence', async () => {
    const { fn } = captureAppend();
    const growCalls = [];
    const fakeGrow = async (args) => { growCalls.push(args); return { grown: true, cadence_id: 'c1' }; };

    const out = await processSfActivityBatch([
      { sf_id: 'g1', type: 'Call', subject: 'Spoke with owner', who_id: '003aaa' },
    ], ctx, {
      findEntityBySfId: fakeFindEntity, appendActivityEvent: fn,
      growCadenceFromOutreach: fakeGrow,
    });

    assert.equal(out.cadences_grown, 1, 'a cadence was grown from the outreach');
    assert.equal(growCalls.length, 1);
    assert.equal(growCalls[0].category, 'call', 'the real category is passed to the grow helper');
    assert.equal(growCalls[0].entityId, 'ent-contact-1');
  });

  it('does NOT count a grown cadence when the grow gate declines (no signal)', async () => {
    const { fn } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 'g2', type: 'Email', subject: 'Sent the OM', who_id: '003aaa' },
    ], ctx, {
      findEntityBySfId: fakeFindEntity, appendActivityEvent: fn,
      growCadenceFromOutreach: async () => ({ grown: false, reason: 'not_qualified' }),
    });

    assert.equal(out.cadences_grown, 0, 'no cadence grown for capture noise');
  });

  it('does NOT grow when a cadence already exists (the trigger already advanced it)', async () => {
    const { fn } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 'g3', type: 'Meeting', subject: 'Toured the asset', who_id: '003aaa' },
    ], ctx, {
      findEntityBySfId: fakeFindEntity, appendActivityEvent: fn,
      growCadenceFromOutreach: async () => ({ grown: false, reason: 'cadence_exists' }),
    });

    assert.equal(out.cadences_grown, 0, 'existing cadence → no second owner');
  });
});

// ===========================================================================
// NBT Phase 2 — Tasks of all statuses (Unit 1) + Events (Unit 2)
// ===========================================================================

describe('sfRecordKind (NBT Phase 2 Unit 2)', () => {
  it('classifies an explicit Event sObject (REST attributes / discriminator)', () => {
    assert.equal(sfRecordKind({ attributes: { type: 'Event' }, Subject: 'Tour' }), 'event');
    assert.equal(sfRecordKind({ sobject: 'Event' }), 'event');
    assert.equal(sfRecordKind({ Type: 'Event' }), 'event');
  });
  it('classifies an Event by its field shape (StartDateTime, no Status/IsClosed)', () => {
    assert.equal(sfRecordKind({ Id: 'e1', StartDateTime: '2026-06-10T15:00:00Z', Subject: 'RE: Mtg' }), 'event');
    assert.equal(sfRecordKind({ Id: 'e2', DurationInMinutes: 30 }), 'event');
    assert.equal(sfRecordKind({ Id: 'e3', EventSubtype: 'Email' }), 'event');
  });
  it('defaults to task for canonical Task shapes (type is the channel, not the object)', () => {
    assert.equal(sfRecordKind({ sf_id: 'a1', type: 'Call' }), 'task');
    assert.equal(sfRecordKind({ Id: 't1', TaskSubtype: 'Call' }), 'task');
    assert.equal(sfRecordKind({ Id: 't2', Status: 'Completed', IsClosed: true }), 'task');
    // a Task that also has StartDateTime-shaped noise but a Status stays a task
    assert.equal(sfRecordKind({ Id: 't3', StartDateTime: 'x', Status: 'Open' }), 'task');
  });
});

describe('resolveSfOccurredAt (NBT Phase 2)', () => {
  it('anchors an Event on StartDateTime (then ActivityDate, then CreatedDate)', () => {
    assert.equal(resolveSfOccurredAt({ attributes: { type: 'Event' }, StartDateTime: '2026-06-10T15:00:00Z', ActivityDate: '2026-06-10' }), '2026-06-10T15:00:00Z');
    assert.equal(resolveSfOccurredAt({ attributes: { type: 'Event' }, ActivityDate: '2026-06-11' }), '2026-06-11');
    assert.equal(resolveSfOccurredAt({ attributes: { type: 'Event' }, CreatedDate: '2026-06-12T09:00:00Z' }), '2026-06-12T09:00:00Z');
  });
  it('anchors a Task on ActivityDate then CreatedDate', () => {
    assert.equal(resolveSfOccurredAt({ Id: 't', TaskSubtype: 'Call', ActivityDate: '2026-06-01' }), '2026-06-01');
    assert.equal(resolveSfOccurredAt({ Id: 't', Status: 'Completed', CreatedDate: '2026-05-01T00:00:00Z' }), '2026-05-01T00:00:00Z');
  });
});

describe('processSfActivityBatch — completed Tasks of all statuses (Unit 1)', () => {
  const ctx = { workspaceId: 'ws-1', actorId: 'user-1' };

  it('ingests a COMPLETED deal-linked Task (never dropped) and captures soft completion', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { Id: 'c1', TaskSubtype: 'Call', Subject: 'Discussed disposition', WhoId: '003aaa', WhatId: '001bbb',
        Status: 'Completed', IsClosed: true, ActivityDate: '2026-04-01',
        CompletedDateTime: '2026-04-01T18:00:00Z' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });

    assert.equal(out.inserted, 1, 'a completed Task is the prospecting record, never dropped');
    assert.equal(calls[0].category, 'call');
    assert.equal(calls[0].entityId, 'ent-contact-1', 'WhoId contact resolved');
    assert.equal(calls[0].metadata.resolved_via, 'contact');
    assert.equal(calls[0].metadata.sf_status, 'Completed');
    assert.equal(calls[0].metadata.sf_is_closed, true, 'completion captured as a soft signal');
    assert.equal(calls[0].metadata.sf_completed_at, '2026-04-01T18:00:00Z');
    assert.ok(!calls[0].metadata.is_reply, 'completion is never treated as "responded"');
    assert.ok(!('skip_cadence_advance' in calls[0].metadata), 'the trigger still owns the advance');
  });

  it('ingests a STANDALONE (deal-unlinked) completed Task via WhoId, null WhatId tolerated', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { sf_id: 'c2', type: 'Email', subject: 'Sent the OM', who_id: '003aaa',
        status: 'Completed', is_closed: true },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });

    assert.equal(out.inserted, 1);
    assert.equal(calls[0].metadata.what_id, null, 'standalone Task has no deal link');
    assert.equal(calls[0].metadata.resolved_via, 'contact');
    assert.equal(calls[0].metadata.sf_is_closed, true);
  });

  it('flags an admin bulk auto-completion (same modifier + LastModifiedDate across many)', async () => {
    const { fn, calls } = captureAppend();
    const bulk = [];
    for (let i = 0; i < 6; i++) {
      bulk.push({ Id: `b${i}`, TaskSubtype: 'Call', Subject: `Old task ${i}`, WhoId: '003aaa',
        Status: 'Completed', IsClosed: true,
        LastModifiedById: '005ADMIN', LastModifiedDate: '2026-06-20T03:00:00Z' });
    }
    // a control row: closed but a DIFFERENT modify signature → not bulk
    bulk.push({ Id: 'solo', TaskSubtype: 'Call', Subject: 'Real call', WhoId: '003aaa',
      Status: 'Completed', IsClosed: true,
      LastModifiedById: '005SCOTT', LastModifiedDate: '2026-06-19T20:11:00Z' });

    const out = await processSfActivityBatch(bulk, ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });
    assert.equal(out.inserted, 7);
    const bulkFlags = calls.filter(c => c.metadata.bulk_completed === true);
    assert.equal(bulkFlags.length, 6, 'the 6 identically-stamped rows are flagged');
    const solo = calls.find(c => c.metadata.sf_id === 'solo');
    assert.ok(!('bulk_completed' in solo.metadata), 'the distinct real touch is NOT flagged');
  });

  it('does not flag a small set of completed tasks below the bulk threshold', async () => {
    const items = [0, 1].map(i => normalizeSfRecord({
      Id: `s${i}`, TaskSubtype: 'Call', Status: 'Completed', IsClosed: true,
      LastModifiedById: '005ADMIN', LastModifiedDate: '2026-06-20T03:00:00Z',
    }));
    tagBulkCompleted(items);
    assert.equal(items.every(it => it.bulkCompleted === false), true);
  });
});

describe('processSfActivityBatch — Events (Unit 2)', () => {
  const ctx = { workspaceId: 'ws-1', actorId: 'user-1' };

  it('ingests an Event as a meeting, anchored on StartDateTime, never the Task subject-inference', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { Id: 'ev1', attributes: { type: 'Event' }, Subject: 'RE: site tour', WhoId: '003aaa', WhatId: '001bbb',
        StartDateTime: '2026-06-10T15:00:00Z', Description: 'walkthrough' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });

    assert.equal(out.inserted, 1);
    assert.equal(calls[0].category, 'meeting', 'an Event is a meeting, even with an "RE:" subject');
    assert.equal(calls[0].occurredAt, '2026-06-10T15:00:00Z', 'anchored on StartDateTime, not now()');
    assert.equal(calls[0].entityId, 'ent-contact-1', 'WhoId contact resolved');
    assert.equal(calls[0].metadata.sf_kind, 'event');
    assert.ok(!calls[0].metadata.is_reply, 'a meeting is never an inbound email reply');
  });

  it('resolves an Event via WhatId when WhoId is absent and falls back to ActivityDate', async () => {
    const { fn, calls } = captureAppend();
    const out = await processSfActivityBatch([
      { Id: 'ev2', sobject: 'Event', Subject: 'Lender call', WhatId: '001bbb', ActivityDate: '2026-06-11' },
    ], ctx, { findEntityBySfId: fakeFindEntity, appendActivityEvent: fn });

    assert.equal(out.inserted, 1);
    assert.equal(calls[0].category, 'meeting');
    assert.equal(calls[0].occurredAt, '2026-06-11', 'StartDateTime absent → ActivityDate');
    assert.equal(calls[0].entityId, 'ent-account-1');
    assert.equal(calls[0].metadata.resolved_via, 'account');
  });
});

// ===========================================================================
// SF-CONTACT-RECONCILE — mint WhoId contacts (Unit 1), reconcile by email
// (Unit 2), flag SF account/email disagreements (Unit 3)
// ===========================================================================

describe('sfContactAccountMismatch (SF-CONTACT-RECONCILE Unit 3 detector)', () => {
  it('flags an @firm.com contact filed under a different SF account (Dowling → Arbor)', () => {
    const mm = sfContactAccountMismatch({ email: 'edowling@boydwatterson.com', accountName: 'Arbor Realty Trust' });
    assert.equal(mm.mismatch, true);
    assert.equal(mm.email_domain, 'boydwatterson.com');
    assert.equal(mm.account_name, 'Arbor Realty Trust');
  });
  it('does NOT flag when the email domain agrees with the account (Capra → Boyd)', () => {
    assert.equal(sfContactAccountMismatch({ email: 'jcapra@boydwatterson.com', accountName: 'Boyd Watterson Asset Management LLC' }).mismatch, false);
  });
  it('does NOT flag a generic/role inbox or a personal-mail domain (no firm signal)', () => {
    assert.equal(sfContactAccountMismatch({ email: 'info@boydwatterson.com', accountName: 'Arbor Realty Trust' }).mismatch, false);
    assert.equal(sfContactAccountMismatch({ email: 'ericdowling@gmail.com', accountName: 'Arbor Realty Trust' }).mismatch, false);
  });
  it('does NOT flag when a signal is missing/too short', () => {
    assert.equal(sfContactAccountMismatch({ email: '', accountName: 'Arbor Realty Trust' }).mismatch, false);
    assert.equal(sfContactAccountMismatch({ email: 'a@x.co', accountName: 'Arbor Realty Trust' }).mismatch, false);
    assert.equal(sfContactAccountMismatch({ email: 'edowling@boydwatterson.com', accountName: '' }).mismatch, false);
  });
});

describe('processSfActivityBatch — mint + reconcile the WhoId contact (Unit 1/2)', () => {
  const ctx = { workspaceId: 'ws-1', actorId: 'user-1' };
  // No existing SF entity for this WhoId, so the mint path is exercised.
  const noEntity = async () => null;

  it('mints a new contact entity when the feed carries the WhoId name/email (Capra)', async () => {
    const { fn, calls } = captureAppend();
    const mintCalls = [];
    const fakeMint = async (args) => {
      mintCalls.push(args);
      return { entityId: 'ent-capra', createdEntity: true, resolvedByEmail: false };
    };
    const out = await processSfActivityBatch([
      { sf_id: 't-capra', type: 'Task', subject: 'Sent RE: Boyd deal',
        who_id: '003capra', who_name: 'Joseph Capra', who_email: 'jcapra@boydwatterson.com', what_id: '001boyd' },
    ], ctx, {
      findEntityBySfId: noEntity, appendActivityEvent: fn,
      resolveOrCreateSfContact: fakeMint,
      growCadenceFromOutreach: async () => ({ grown: false }),
    });
    assert.equal(out.contacts_minted, 1, 'the WhoId contact was minted');
    assert.equal(out.contacts_reconciled, 0);
    assert.equal(out.matched, 1, 'the activity now resolves to the minted entity');
    assert.equal(out.skipped_no_entity, 0);
    assert.equal(calls[0].entityId, 'ent-capra');
    assert.equal(calls[0].metadata.resolved_via, 'contact_minted');
    assert.equal(mintCalls[0].email, 'jcapra@boydwatterson.com');
  });

  it('reconciles by email — attaches the SF contact to an existing CoStar/RCA person (Dowling), no duplicate', async () => {
    const { fn, calls } = captureAppend();
    const fakeMint = async () => ({ entityId: 'ent-dowling-costar', createdEntity: false, resolvedByEmail: true });
    const out = await processSfActivityBatch([
      { sf_id: 't-dowling', type: 'Task', subject: 'Call',
        who_id: '003dowling', who_name: 'Eric Dowling', who_email: 'edowling@boydwatterson.com', what_id: '001arbor' },
    ], ctx, {
      findEntityBySfId: noEntity, appendActivityEvent: fn,
      resolveOrCreateSfContact: fakeMint,
      growCadenceFromOutreach: async () => ({ grown: false }),
    });
    assert.equal(out.contacts_reconciled, 1, 'attached to the existing person by email');
    assert.equal(out.contacts_minted, 0, 'no new entity — no duplicate');
    assert.equal(out.matched, 1);
    assert.equal(calls[0].entityId, 'ent-dowling-costar');
    assert.equal(calls[0].metadata.resolved_via, 'contact_reconciled_email');
  });

  it('is byte-identical (no mint) when the feed omits the contact name/email', async () => {
    const { fn } = captureAppend();
    let minted = false;
    const out = await processSfActivityBatch([
      { sf_id: 't-bare', type: 'Task', subject: 'Sent RE: x', who_id: '003bare' },
    ], ctx, {
      findEntityBySfId: noEntity, appendActivityEvent: fn,
      resolveOrCreateSfContact: async () => { minted = true; return null; },
    });
    assert.equal(minted, false, 'the mint dep is never called without contact identity fields');
    assert.equal(out.contacts_minted, 0);
    assert.equal(out.skipped_no_entity, 1, 'unchanged: no entity → skip, never fabricated');
  });

  it('flags the SF account/email disagreement (Dowling on Arbor) via a mismatch decision', async () => {
    const { fn } = captureAppend();
    const fakeMint = async () => ({ entityId: 'ent-dowling-costar', createdEntity: false, resolvedByEmail: true });
    const mismatchCalls = [];
    const out = await processSfActivityBatch([
      { sf_id: 't-dowling2', type: 'Task', subject: 'Call',
        who_id: '003dowling', who_name: 'Eric Dowling', who_email: 'edowling@boydwatterson.com',
        what_id: '001arbor', what_name: 'Arbor Realty Trust' },
    ], ctx, {
      findEntityBySfId: noEntity, appendActivityEvent: fn,
      resolveOrCreateSfContact: fakeMint,
      openSfMismatchDecision: async (args) => { mismatchCalls.push(args); return true; },
      growCadenceFromOutreach: async () => ({ grown: false }),
    });
    assert.equal(out.mismatches_flagged, 1);
    assert.equal(mismatchCalls.length, 1);
    assert.equal(mismatchCalls[0].entityId, 'ent-dowling-costar');
    assert.equal(mismatchCalls[0].detail.email_domain, 'boydwatterson.com');
    assert.equal(mismatchCalls[0].detail.account_name, 'Arbor Realty Trust');
  });

  it('does NOT flag when the SF account agrees with the email domain (Capra on Boyd)', async () => {
    const { fn } = captureAppend();
    const mismatchCalls = [];
    const out = await processSfActivityBatch([
      { sf_id: 't-capra2', type: 'Task', subject: 'Sent the memo',
        who_id: '003capra', who_name: 'Joseph Capra', who_email: 'jcapra@boydwatterson.com',
        what_id: '001boyd', what_name: 'Boyd Watterson Asset Management LLC' },
    ], ctx, {
      findEntityBySfId: noEntity, appendActivityEvent: fn,
      resolveOrCreateSfContact: async () => ({ entityId: 'ent-capra', createdEntity: true, resolvedByEmail: false }),
      openSfMismatchDecision: async (args) => { mismatchCalls.push(args); return true; },
      growCadenceFromOutreach: async () => ({ grown: false }),
    });
    assert.equal(out.mismatches_flagged, 0);
    assert.equal(mismatchCalls.length, 0);
  });
});
