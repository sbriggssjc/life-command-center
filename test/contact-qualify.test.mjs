// R28 Unit 2 — contact-qualify tests.
//
// Covers the deps-injected core (performContactQualify): owner resolution +
// contactless-cadence stamp (owner first, else self per R20), terminal
// disposition as the guaranteed effect, and outcome-truthful failure handling.
// Plus the contact-attach onlyContactless extension (stamps only a cadence with
// no contact yet, so qualifying never clobbers an existing owner contact).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { performContactQualify } from '../api/operations.js';
import { stampContactOnActiveCadence } from '../api/_shared/contact-attach.js';

const UUID_A = '11111111-1111-1111-1111-111111111111'; // inbox item
const UUID_P = '22222222-2222-2222-2222-222222222222'; // person
const UUID_PROP = '33333333-3333-3333-3333-333333333333'; // property entity
const UUID_OWNER = '44444444-4444-4444-4444-444444444444'; // owner entity

function recordingDeps(overrides = {}) {
  const calls = { linkPerson: [], stampCadence: [], disposition: [], refresh: 0 };
  const deps = {
    getRow: async () => ({ id: UUID_A, entity_id: UUID_P, status: 'new', metadata: { property_entity_id: UUID_PROP } }),
    resolveOwner: async () => UUID_OWNER,
    linkPerson: async (ownerId, personId) => { calls.linkPerson.push([ownerId, personId]); return { ok: true }; },
    stampCadence: async (entityId, args) => { calls.stampCadence.push([entityId, args]); return { ok: true, cadenceId: 'cad-' + entityId }; },
    dispositionInbox: async (id, patch) => { calls.disposition.push([id, patch]); return { ok: true }; },
    refreshQueue: async () => { calls.refresh += 1; return { ok: true }; },
    ...overrides,
  };
  return { deps, calls };
}

describe('performContactQualify (R28 Unit 2)', () => {
  it('owner + contactless cadence → links person→owner, stamps owner cadence, promotes', async () => {
    const { deps, calls } = recordingDeps();
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.body.linked, true);
    assert.deepEqual(calls.linkPerson[0], [UUID_OWNER, UUID_P]);
    assert.equal(out.body.cadence_stamped.target, 'owner');
    // Owner stamp must request onlyContactless so it never clobbers a contact.
    assert.equal(calls.stampCadence[0][0], UUID_OWNER);
    assert.equal(calls.stampCadence[0][1].onlyContactless, true);
    assert.equal(calls.stampCadence[0][1].contactEntityId, UUID_P);
    // Terminal disposition + staleness refresh fired.
    assert.equal(calls.disposition[0][1].status, 'promoted');
    assert.equal(calls.disposition[0][1].metadata.contact_qualify.source, 'r28_unit2');
    assert.equal(calls.refresh, 1);
  });

  it('owner has NO contactless cadence → falls back to self-stamp (R20)', async () => {
    let n = 0;
    const { deps, calls } = recordingDeps({
      stampCadence: async (entityId, args) => {
        calls.stampCadence.push([entityId, args]); n += 1;
        // First call (owner) finds none; second call (self) stamps.
        return n === 1 ? { ok: false, reason: 'no_active_cadence' } : { ok: true, cadenceId: 'cad-self' };
      },
    });
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.body.cadence_stamped.target, 'self');
    assert.equal(calls.stampCadence[1][0], UUID_P); // self-stamp on the person
    assert.equal(calls.stampCadence[1][1].contactEntityId, UUID_P);
    assert.equal(out.body.linked, true); // still linked to the owner
  });

  it('no owner resolvable → links nothing, self-stamps, still promotes', async () => {
    const { deps, calls } = recordingDeps({ resolveOwner: async () => null });
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.body.linked, false);
    assert.equal(calls.linkPerson.length, 0);
    assert.equal(out.body.cadence_stamped.target, 'self');
    assert.equal(out.body.status, 'promoted');
  });

  it('no owner AND no stampable cadence → still dispositions terminal (guaranteed effect)', async () => {
    const { deps, calls } = recordingDeps({
      resolveOwner: async () => null,
      stampCadence: async () => ({ ok: false, reason: 'no_active_cadence' }),
    });
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.status, 200);
    assert.equal(out.body.cadence_stamped, null);
    assert.equal(out.body.status, 'promoted');
    assert.equal(calls.disposition.length, 1);
    assert.equal(calls.refresh, 0); // no cadence stamped → no queue refresh
  });

  it('already-terminal row → already_qualified, no writes', async () => {
    const { deps, calls } = recordingDeps({ getRow: async () => ({ id: UUID_A, entity_id: UUID_P, status: 'promoted', metadata: {} }) });
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.body.already_qualified, true);
    assert.equal(calls.disposition.length, 0);
    assert.equal(calls.stampCadence.length, 0);
  });

  it('disposition PATCH fails → 502, outcome-truthful (no false promote)', async () => {
    const { deps } = recordingDeps({ dispositionInbox: async () => ({ ok: false, detail: 'boom' }) });
    const out = await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps);
    assert.equal(out.status, 502);
    assert.equal(out.body.error, 'inbox_disposition_failed');
  });

  it('row not found → 404; bad id → 400', async () => {
    const { deps } = recordingDeps({ getRow: async () => null });
    assert.equal((await performContactQualify({ inboxItemId: UUID_A, workspaceId: 'ws' }, deps)).status, 404);
    assert.equal((await performContactQualify({ inboxItemId: 'not-a-uuid', workspaceId: 'ws' }, deps)).status, 400);
  });
});

describe('stampContactOnActiveCadence onlyContactless filter (R28)', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; });

  it('onlyContactless:true restricts the cadence GET to contactless rows', async () => {
    let getUrl = null;
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (u.includes('/touchpoint_cadence') && m === 'GET') {
        getUrl = u;
        return { ok: true, status: 200, headers: { get: () => '0-0/1' }, async text() { return JSON.stringify([{ id: 'cad-x', metadata: {} }]); } };
      }
      if (u.includes('/touchpoint_cadence') && m === 'PATCH') {
        return { ok: true, status: 200, headers: { get: () => '0-0/1' }, async text() { return JSON.stringify([{}]); } };
      }
      throw new Error('unexpected ' + m + ' ' + u);
    };
    const r = await stampContactOnActiveCadence({ entityId: UUID_OWNER, contactEntityId: UUID_P, onlyContactless: true });
    assert.equal(r.ok, true);
    assert.match(getUrl, /contact_id=is\.null/);
    assert.match(getUrl, /sf_contact_id=is\.null/);
  });

  it('onlyContactless defaults off (no contactless filter)', async () => {
    let getUrl = null;
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (u.includes('/touchpoint_cadence') && m === 'GET') {
        getUrl = u;
        return { ok: true, status: 200, headers: { get: () => '0-0/1' }, async text() { return JSON.stringify([{ id: 'cad-x', metadata: {} }]); } };
      }
      if (u.includes('/touchpoint_cadence') && m === 'PATCH') {
        return { ok: true, status: 200, headers: { get: () => '0-0/1' }, async text() { return JSON.stringify([{}]); } };
      }
      throw new Error('unexpected ' + m + ' ' + u);
    };
    await stampContactOnActiveCadence({ entityId: UUID_OWNER, contactEntityId: UUID_P });
    assert.doesNotMatch(getUrl, /contact_id=is\.null/);
  });
});
