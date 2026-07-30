// Guards logInboundCorrespondenceDualAnchor — the inbound mirror of
// handleOutlookSent (relationship-primary, deal-subfilter). Pure logic over
// injected deps (no live DB / SF).
//
// Invariants asserted:
//   1. An external sender resolves the PARTY + OPEN deal and stamps BOTH on the
//      row (entity_id = open deal; metadata.party_entity_id + deal_entity_id).
//   2. Internal (northmarq) / empty senders are skipped — never a BD party.
//   3. A missing internet_message_id is skipped (no un-deduped inbound rows).
//   4. A resolver miss still logs the raw inbound touch with null anchors, so a
//      later re-drain can attach the party without losing the touch.
//   5. source_type is 'outlook_inbound' and dedups via appendActivityEvent's
//      (workspace, source_type, external_id) unique key.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logInboundCorrespondenceDualAnchor } from '../api/_shared/intake-correspondence.js';

function harness(resolvePacket) {
  const calls = { append: [], resolve: [] };
  const deps = {
    opsQuery: async (_m, path, body) => {
      calls.resolve.push({ path, body });
      return { ok: true, data: [resolvePacket || {}] };
    },
    appendActivityEvent: async (row) => {
      calls.append.push(row);
      return { ok: true, inserted: true, id: 'A1' };
    },
  };
  return { deps, calls };
}

describe('logInboundCorrespondenceDualAnchor', () => {
  it('stamps the dual anchor for an external sender', async () => {
    const { deps, calls } = harness({ party_entity_id: 'PARTY-1', primary_deal: 'DEAL-9' });
    const r = await logInboundCorrespondenceDualAnchor({
      workspaceId: 'W', actorId: 'U',
      emailContext: {
        internet_message_id: 'MID1', subject: 'Re: Snellville',
        from: 'frankm@rcgventures.com', to: 'teambriggs@northmarq.com',
        received_at: '2026-07-30T00:00:00Z', body_snippet: 'hi',
      },
    }, deps);
    assert.equal(r.ok, true);
    assert.equal(r.party_entity_id, 'PARTY-1');
    assert.equal(r.deal_entity_id, 'DEAL-9');
    const row = calls.append[0];
    assert.equal(row.sourceType, 'outlook_inbound');
    assert.equal(row.externalId, 'MID1');
    assert.equal(row.entityId, 'DEAL-9');                       // open-deal anchor
    assert.equal(row.metadata.party_entity_id, 'PARTY-1');       // durable party
    assert.equal(row.metadata.deal_entity_id, 'DEAL-9');
    assert.equal(row.metadata.direction, 'inbound');
    assert.equal(calls.resolve[0].body.p_email, 'frankm@rcgventures.com');
  });

  it('skips internal (northmarq) senders', async () => {
    const { deps, calls } = harness({ party_entity_id: 'X' });
    const r = await logInboundCorrespondenceDualAnchor({
      workspaceId: 'W', actorId: 'U',
      emailContext: { internet_message_id: 'MID2', from: 'colleague@northmarq.com' },
    }, deps);
    assert.equal(r.skipped, 'internal_or_no_sender');
    assert.equal(calls.append.length, 0);
  });

  it('skips a missing internet_message_id (no un-deduped rows)', async () => {
    const { deps, calls } = harness({ party_entity_id: 'X' });
    const r = await logInboundCorrespondenceDualAnchor({
      workspaceId: 'W', actorId: 'U',
      emailContext: { from: 'someone@external.com' },
    }, deps);
    assert.equal(r.skipped, 'no_message_id');
    assert.equal(calls.append.length, 0);
  });

  it('logs the raw touch with null anchors when the resolver finds nothing', async () => {
    const { deps, calls } = harness({});                         // empty packet
    const r = await logInboundCorrespondenceDualAnchor({
      workspaceId: 'W', actorId: 'U',
      emailContext: { internet_message_id: 'MID4', from: 'new@broker.com' },
    }, deps);
    assert.equal(r.ok, true);
    assert.equal(r.party_entity_id, null);
    assert.equal(r.deal_entity_id, null);
    const row = calls.append[0];
    assert.equal(row.sourceType, 'outlook_inbound');
    assert.equal(row.entityId, null);
    assert.equal(row.metadata.party_entity_id, null);
  });

  it('still logs the touch when the resolver throws', async () => {
    const calls = { append: [] };
    const deps = {
      opsQuery: async () => { throw new Error('resolver down'); },
      appendActivityEvent: async (row) => { calls.append.push(row); return { ok: true, inserted: true }; },
    };
    const r = await logInboundCorrespondenceDualAnchor({
      workspaceId: 'W', actorId: 'U',
      emailContext: { internet_message_id: 'MID5', from: 'a@b.com' },
    }, deps);
    assert.equal(r.ok, true);
    assert.equal(calls.append.length, 1);          // resolver failure never blocks the log
    assert.equal(calls.append[0].metadata.party_entity_id, null);
  });
});
