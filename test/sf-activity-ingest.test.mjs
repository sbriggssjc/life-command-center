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
  });
});
